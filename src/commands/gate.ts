// `devx gate <prd|coverage|evals> <hash>` — CLI passthroughs for the three
// engine gates (v2e101). Thin drivers over the pure evaluators in
// src/lib/engine/: resolve hash → workstream, read inputs, call the pure
// fn, apply frontmatter flips + write report artifacts, emit JSON.
//
// Shared exit-code contract (spec AC, all three subcommands):
//   0 — gate passed (PASS, or CONCERNS: the gate advances with the concern
//       recorded — D-9 semantics).
//   1 — gate failed / refused (FAIL verdict, predecessor gate open, no
//       open gate). Precise gap report in the JSON; frontmatter untouched.
//   2 — error: unresolvable hash/workstream, malformed --table, missing
//       config. Nothing written.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.2, §4.4, §4.6

import { join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  type Stage,
  applyEnginePatch,
  stageIndex,
} from "../lib/engine/frontmatter.js";
import { evaluateGatePrd } from "../lib/engine/gate-prd.js";
import {
  computeCoverageVerdict,
  detectCoverageMode,
  expectationPriorities,
  extractSourceIds,
  parseCoverageTable,
  renderVerifyReport,
} from "../lib/engine/gate-coverage.js";
import {
  type ShellExec,
  projectRunnersFrom,
  realShellExec,
  renderRedReport,
  runGateEvals,
} from "../lib/engine/gate-evals.js";
import { formatDate } from "../lib/engine/verdict.js";
import {
  type EngineFs,
  type ResolvedWorkstream,
  WorkstreamError,
  realEngineFs,
  resolveWorkstream,
} from "../lib/engine/workstream.js";

export interface RunGateOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  now?: () => Date;
  /** Test seam for gate evals' runner subprocesses. */
  exec?: ShellExec;
}

interface GateIo {
  out: (s: string) => void;
  err: (s: string) => void;
  fs: EngineFs;
  now: () => Date;
}

function ioFrom(opts: RunGateOpts): GateIo {
  return {
    out: opts.out ?? ((s) => process.stdout.write(s)),
    err: opts.err ?? ((s) => process.stderr.write(s)),
    fs: { ...realEngineFs, ...(opts.fs ?? {}) },
    now: opts.now ?? (() => new Date()),
  };
}

type Resolution =
  | { ok: true; ws: ResolvedWorkstream; repoRoot: string; merged: unknown; expectationsMin: number }
  | { ok: false; code: number };

function resolveOrFail(
  hash: string,
  usage: string,
  opts: RunGateOpts,
  io: GateIo,
): Resolution {
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    io.err(`${usage}: ${ctx.error}\n`);
    return { ok: false, code: 2 };
  }
  try {
    const ws = resolveWorkstream(
      ctx.ctx.repoRoot,
      hash,
      ctx.ctx.engine,
      opts.fs ?? {},
    );
    return {
      ok: true,
      ws,
      repoRoot: ctx.ctx.repoRoot,
      merged: ctx.ctx.merged,
      expectationsMin: ctx.ctx.engine.expectationsMin,
    };
  } catch (e) {
    if (e instanceof WorkstreamError) {
      io.err(`${usage}: ${e.message}\n`);
      return { ok: false, code: 2 };
    }
    throw e;
  }
}

/** Advance the stage forward-only: never regress an already-later stage. */
function advanceStage(current: Stage | null, target: Stage): Stage {
  if (current === null) return target;
  return stageIndex(current) < stageIndex(target) ? target : current;
}

// ---------------------------------------------------------------------------
// devx gate prd <hash>
// ---------------------------------------------------------------------------

export function runGatePrd(args: string[], opts: RunGateOpts = {}): number {
  const io = ioFrom(opts);
  if (args.length !== 1) {
    io.err("usage: devx gate prd <hash>\n");
    return 2;
  }
  const r = resolveOrFail(args[0], "devx gate prd", opts, io);
  if (!r.ok) return r.code;
  const { ws } = r;

  // Missing Gate-1 inputs are a refusal with a precise gap (exit 1), not an
  // error: the artifact simply hasn't been authored yet (/devx prd is next).
  const prdAbs = join(ws.workstreamAbs, "prd.md");
  const expAbs = join(ws.workstreamAbs, "expectations.md");
  const missing: string[] = [];
  if (!io.fs.exists(prdAbs)) missing.push("prd.md");
  if (!io.fs.exists(expAbs)) missing.push("expectations.md");
  if (missing.length > 0) {
    const gaps = missing.map((m) => ({
      check: "gate-input-missing",
      message: `${ws.workstreamRel}/${m} does not exist — run \`/devx prd ${ws.hash}\` first`,
    }));
    io.out(`${JSON.stringify({ gate: "FAIL", hash: ws.hash, gaps })}\n`);
    return 1;
  }

  const result = evaluateGatePrd({
    prd: io.fs.readFile(prdAbs),
    expectations: io.fs.readFile(expAbs),
    blockedBy: ws.state.blockedBy,
    expectationsMin: r.expectationsMin,
  });

  if (result.verdict === "FAIL") {
    io.out(
      `${JSON.stringify({ gate: "FAIL", hash: ws.hash, gaps: result.gaps })}\n`,
    );
    return 1;
  }

  // PASS: flip prd_validated + stage: design in one frontmatter patch.
  const newStage = advanceStage(ws.state.stage, "design");
  try {
    const updated = applyEnginePatch(ws.content, {
      gateStatus: { prd_validated: true },
      stage: newStage,
    });
    io.fs.writeFile(ws.specAbs, updated);
  } catch (e) {
    io.err(
      `devx gate prd: PASS computed but frontmatter write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
  io.out(
    `${JSON.stringify({
      gate: "PASS",
      hash: ws.hash,
      flipped: { prd_validated: true, stage: newStage },
      spec: ws.specRel,
    })}\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// devx gate coverage <hash> [--table <json-path>]
// ---------------------------------------------------------------------------

export function runGateCoverage(
  args: string[],
  flags: { table?: string },
  opts: RunGateOpts = {},
): number {
  const io = ioFrom(opts);
  if (args.length !== 1) {
    io.err("usage: devx gate coverage <hash> [--table <json-path>]\n");
    return 2;
  }
  const r = resolveOrFail(args[0], "devx gate coverage", opts, io);
  if (!r.ok) return r.code;
  const { ws } = r;

  const designAbs = join(ws.workstreamAbs, "design.md");
  const planAbs = join(ws.workstreamAbs, "plan.md");
  const detected = detectCoverageMode({
    state: ws.state,
    designExists: io.fs.exists(designAbs),
    planExists: io.fs.exists(planAbs),
  });
  if (detected.mode === null) {
    io.out(
      `${JSON.stringify({ gate: "FAIL", hash: ws.hash, refusal: detected.refusal })}\n`,
    );
    return 1;
  }
  const mode = detected.mode;

  if (!flags.table) {
    io.err(
      `devx gate coverage: --table <json-path> is required — the covered/partial judgment comes from the skill's schema-constrained subagent; the CLI computes the verdict mechanically\n`,
    );
    return 2;
  }
  let tableJson: string;
  try {
    tableJson = io.fs.readFile(flags.table);
  } catch (e) {
    io.err(
      `devx gate coverage: cannot read --table '${flags.table}': ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
  const parsed = parseCoverageTable(tableJson);
  if (!parsed.ok) {
    io.err(`devx gate coverage: ${parsed.error}\n`);
    return 2;
  }

  const prdAbs = join(ws.workstreamAbs, "prd.md");
  const expAbs = join(ws.workstreamAbs, "expectations.md");
  const files = {
    prd: io.fs.exists(prdAbs) ? io.fs.readFile(prdAbs) : "",
    expectations: io.fs.exists(expAbs) ? io.fs.readFile(expAbs) : "",
  };
  const sourceIds = extractSourceIds(mode, files);
  if (sourceIds.length === 0) {
    io.err(
      `devx gate coverage: no source IDs found in ${mode === "design" ? "prd.md" : "expectations.md"} — nothing to verify\n`,
    );
    return 2;
  }
  const priorities = expectationPriorities(files.expectations);
  const computation = computeCoverageVerdict(
    mode,
    sourceIds,
    parsed.table,
    priorities,
  );

  // Completeness is mechanical: an incomplete or ambiguous table is invalid
  // input from the judgment layer, not a gate verdict.
  if (computation.missingRowIds.length > 0) {
    io.err(
      `devx gate coverage: table is incomplete — no row for: ${computation.missingRowIds.join(", ")}\n`,
    );
    return 2;
  }
  if (computation.duplicateRowIds.length > 0) {
    io.err(
      `devx gate coverage: table has duplicate rows for: ${computation.duplicateRowIds.join(", ")}\n`,
    );
    return 2;
  }

  // Write the verify report — the record of this gate run, PASS or FAIL.
  const date = formatDate(io.now());
  const report = renderVerifyReport({
    mode,
    hash: ws.hash,
    workstreamRel: ws.workstreamRel,
    date,
    computation,
    extras: parsed.table.extras,
  });
  const reportRel = `${ws.workstreamRel}/decisions/${date}-${mode}-verify.md`;
  const reportAbs = join(ws.workstreamAbs, "decisions", `${date}-${mode}-verify.md`);
  try {
    io.fs.mkdirRecursive(join(ws.workstreamAbs, "decisions"));
    io.fs.writeFile(reportAbs, report);
  } catch (e) {
    io.err(
      `devx gate coverage: report write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }

  let flipped: Record<string, unknown> | null = null;
  if (computation.verdict !== "FAIL") {
    const flag = mode === "design" ? "design_verified" : "plan_verified";
    const targetStage: Stage = mode === "design" ? "plan" : "red";
    const newStage = advanceStage(ws.state.stage, targetStage);
    try {
      const updated = applyEnginePatch(ws.content, {
        gateStatus: { [flag]: true },
        stage: newStage,
      });
      io.fs.writeFile(ws.specAbs, updated);
      flipped = { [flag]: true, stage: newStage };
    } catch (e) {
      io.err(
        `devx gate coverage: verdict computed but frontmatter write failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 2;
    }
  }

  io.out(
    `${JSON.stringify({
      gate: computation.verdict,
      mode,
      hash: ws.hash,
      report: reportRel,
      reasons: computation.reasons,
      flipped,
    })}\n`,
  );
  return computation.verdict === "FAIL" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// devx gate evals <hash> [--dry-run]
// ---------------------------------------------------------------------------

export function runGateEvalsCli(
  args: string[],
  flags: { dryRun?: boolean },
  opts: RunGateOpts = {},
): number {
  const io = ioFrom(opts);
  if (args.length !== 1) {
    io.err("usage: devx gate evals <hash> [--dry-run]\n");
    return 2;
  }
  const r = resolveOrFail(args[0], "devx gate evals", opts, io);
  if (!r.ok) return r.code;
  const { ws } = r;

  // Predecessor gates must have passed (tenet 2).
  if (!ws.state.gateStatus.plan_verified) {
    const open = !ws.state.gateStatus.prd_validated
      ? "Gate 1 (prd)"
      : !ws.state.gateStatus.design_verified
        ? "Gate 2 (design coverage)"
        : "Gate 3 (plan coverage)";
    io.out(
      `${JSON.stringify({
        gate: "FAIL",
        hash: ws.hash,
        refusal: `${open} has not passed — the RED gate can't run before its predecessors`,
      })}\n`,
    );
    return 1;
  }

  const expAbs = join(ws.workstreamAbs, "expectations.md");
  if (!io.fs.exists(expAbs)) {
    io.err(
      `devx gate evals: ${ws.workstreamRel}/expectations.md not found — workstream state is inconsistent (plan_verified is true without Gate-1 inputs)\n`,
    );
    return 2;
  }
  const planAbs = join(ws.workstreamAbs, "plan.md");

  const result = runGateEvals({
    repoRoot: r.repoRoot,
    workstreamAbs: ws.workstreamAbs,
    expectations: io.fs.readFile(expAbs),
    plan: io.fs.exists(planAbs) ? io.fs.readFile(planAbs) : null,
    runners: projectRunnersFrom(r.merged),
    exec: opts.exec ?? realShellExec,
    exists: (p) => io.fs.exists(p),
    dryRun: flags.dryRun === true,
  });

  if (flags.dryRun === true) {
    io.out(
      `${JSON.stringify({
        dryRun: true,
        hash: ws.hash,
        planned: result.runs.map((run) => ({
          eId: run.eId,
          artifact: run.artifact,
          command: run.command,
        })),
        deferred: result.deferred.map((run) => ({
          eId: run.eId,
          redVerdict: run.redVerdict,
        })),
      })}\n`,
    );
    return 0;
  }

  // Write the RED report — the record of the observed runs, PASS or FAIL.
  const date = formatDate(io.now());
  const reportRel = `${ws.workstreamRel}/evals/RED-report.md`;
  try {
    io.fs.mkdirRecursive(join(ws.workstreamAbs, "evals"));
    io.fs.writeFile(
      join(ws.workstreamAbs, "evals", "RED-report.md"),
      renderRedReport({ workstreamRel: ws.workstreamRel, date, result }),
    );
  } catch (e) {
    io.err(
      `devx gate evals: RED-report write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }

  let flipped: Record<string, unknown> | null = null;
  if (result.verdict !== "FAIL") {
    const newStage = advanceStage(ws.state.stage, "executing");
    try {
      const updated = applyEnginePatch(ws.content, {
        gateStatus: { evals_red: true },
        stage: newStage,
      });
      io.fs.writeFile(ws.specAbs, updated);
      flipped = { evals_red: true, stage: newStage };
    } catch (e) {
      io.err(
        `devx gate evals: verdict computed but frontmatter write failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 2;
    }
  }

  io.out(
    `${JSON.stringify({
      gate: result.verdict,
      hash: ws.hash,
      report: reportRel,
      reasons: result.reasons,
      flipped,
    })}\n`,
  );
  return result.verdict === "FAIL" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function register(program: Command): void {
  const sub = program
    .command("gate")
    .description(
      "Engine gate validators (v2). prd = Gate 1 (mechanical PRD checks); coverage = Gates 2/3 (two-mode tri-state verify); evals = Gate 4 (RED runner). Exit 0 pass / 1 fail / 2 error.",
    );

  sub
    .command("prd")
    .description(
      "Gate 1: placeholder/E-block/EARS/threshold/ID-resolution checks on prd.md + expectations.md; pass flips prd_validated + stage: design.",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .action((hash: string) => {
      const code = runGatePrd([hash]);
      if (code !== 0) process.exit(code);
    });

  sub
    .command("coverage")
    .description(
      "Gates 2/3: state-aware design|plan coverage verify. --table supplies the subagent's tri-state judgment; verdict + P0 floor are mechanical.",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .option("--table <json-path>", "tri-state coverage table JSON from the judgment subagent")
    .action((hash: string, cmdOpts: { table?: string }) => {
      const code = runGateCoverage([hash], { table: cmdOpts.table });
      if (code !== 0) process.exit(code);
    });

  sub
    .command("evals")
    .description(
      "Gate 4 (RED): run every expectation's Verified-by target via projects: runners; P0s must be observed failing; writes evals/RED-report.md.",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .option("--dry-run", "resolve artifacts + commands, run nothing, write nothing")
    .action((hash: string, cmdOpts: { dryRun?: boolean }) => {
      const code = runGateEvalsCli([hash], { dryRun: cmdOpts.dryRun });
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
