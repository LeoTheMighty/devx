// `devx gate <prd|coverage|evals> <hash>` — CLI passthroughs for the three
// engine gates (v2e101). Thin drivers over the pure evaluators in
// src/lib/engine/: resolve hash → workstream, read inputs, call the pure
// fn, apply frontmatter flips + write report artifacts, emit JSON.
//
// Shared exit-code contract (spec AC, all three subcommands):
//   0 — gate passed (PASS, or CONCERNS: the gate advances with the concern
//       recorded — D-9 semantics).
//   1 — gate failed / refused (FAIL verdict, predecessor gate open, no
//       open gate). Precise gap report in the JSON. An *evaluated* FAIL
//       records its verdict in the spec's `gate_verdicts:` map (hfi102) —
//       gate_status booleans and stage stay untouched; refusals (missing
//       inputs, open predecessor) write nothing.
//   2 — error: unresolvable hash/workstream, malformed --table, missing
//       config. Nothing written. One exception: an evaluated FAIL whose
//       verdict write fails still prints its gap JSON (and keeps any report
//       already on disk) before exiting 2 — the spec is never half-written,
//       but the diagnostics are never swallowed either.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.2, §4.4, §4.6

import { dirname, join, posix } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import * as artifacts from "../lib/engine/artifacts.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  FLAG_TO_GATE_KEY,
  type GateKey,
  type Stage,
  applyEnginePatch,
  stageIndex,
} from "../lib/engine/frontmatter.js";
import { parseExpectations } from "../lib/engine/expectations.js";
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
  donePhasesFor,
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
import { withBacklogLock } from "../lib/backlog/mutate.js";

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

/**
 * Every artifact a gate names, resolved ONCE through `engine.docs_layout`.
 *
 * The layout is never a gate INPUT: only subject resolution branches on it.
 * Each gate below reads `.abs` and prints `.rel`, and none of them — nor any
 * of the pure evaluators they call — is handed the layout itself. That is
 * what makes the verdicts layout-independent for identical content, which is
 * the whole contract of docs/CONFIG.md §15 rule 5 (E-1).
 */
interface GateSubjects {
  /** The doc set itself, normalized: `.` at the repo root under
   *  `project-level`, `_devx/workstreams/<slug>` under `workstream`.
   *  Derived through `stageSubject` rather than off `ws.workstreamRel`, so
   *  it passes through the SAME normalizer every artifact path does — a
   *  `workstream: ./` pointer must not resolve subjects one way and be
   *  string-compared another (review EC-2). */
  docSetRel: string;
  docSetAbs: string;
  /** How a committed record NAMES its workstream in a heading. `.` is a
   *  true path but a useless title, and these reports are read weeks later
   *  (review BH-1 / AA / EC-3). Unchanged under `workstream`. */
  docSetLabel: string;
  prd: artifacts.StageSubject;
  design: artifacts.StageSubject;
  plan: artifacts.StageSubject;
  expectations: artifacts.StageSubject;
  evalsDir: artifacts.StageSubject;
  decisionsDir: artifacts.StageSubject;
  redReport: artifacts.StageSubject;
}

function subjectsFor(
  repoRoot: string,
  ws: ResolvedWorkstream,
  layout: artifacts.DocsLayout,
): GateSubjects {
  // `workstreamRel` is `.` under project-level; `stageSubject` normalizes it
  // away, so `rel` is a plain repo-root path rather than `./prd.md`.
  const base = { repoRoot, workstreamRel: ws.workstreamRel };
  const at = (kind: artifacts.ArtifactKind): artifacts.StageSubject =>
    artifacts.stageSubject(layout, base, kind);
  // The expectations artifact sits at the doc-set root in BOTH layouts, so
  // its parent IS the normalized base — read back out of the resolver
  // instead of re-deriving it, which is how two spellings of one directory
  // get started. It is deliberately the anchor: a Gate-1 subject these
  // gates already resolve, rather than some other artifact whose location
  // the gates would then have to know about.
  const expectations = at({ kind: "expectations" });
  const docSetRel = posix.dirname(expectations.rel);
  return {
    docSetRel,
    docSetAbs: dirname(expectations.abs),
    docSetLabel: docSetRel === "." ? "<repo root>" : docSetRel,
    prd: at({ kind: "agent", stage: "prd" }),
    design: at({ kind: "agent", stage: "design" }),
    plan: at({ kind: "agent", stage: "plan" }),
    expectations,
    evalsDir: at({ kind: "evals-dir" }),
    decisionsDir: at({ kind: "decisions-dir" }),
    redReport: at({ kind: "red-report" }),
  };
}

type Resolution =
  | {
      ok: true;
      ws: ResolvedWorkstream;
      repoRoot: string;
      merged: unknown;
      expectationsMin: number;
      subjects: GateSubjects;
    }
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
    // 9f24c7 / D-13: the reader stays soft so a half-edited spec can never
    // crash a gate — but a gate that silently reads `stage: null` /
    // `gate_status: all-false` off an unparseable block is asserting an
    // empty state it cannot actually see. Every gate resolves through here,
    // so one warning covers prd/coverage/evals. Advisory only: it does not
    // change the verdict or the exit code.
    if (ws.frontmatterError !== null) {
      io.err(
        `${usage}: warning: ${ws.specRel} frontmatter does not parse (${ws.frontmatterError}) — engine state below the error is unreadable, so stage/gate flags read from this spec may be silently absent; fix the YAML before trusting this verdict\n`,
      );
    }
    return {
      ok: true,
      ws,
      repoRoot: ctx.ctx.repoRoot,
      merged: ctx.ctx.merged,
      expectationsMin: ctx.ctx.engine.expectationsMin,
      subjects: subjectsFor(ctx.ctx.repoRoot, ws, ctx.ctx.engine.docsLayout),
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

/** mlc102: spec-frontmatter patches are backlog/spec mutations — the write
 *  runs under the cross-process backlog lock so a gate run can't interleave
 *  with a concurrent loop's or /devx's write to the same spec (R10). The
 *  patch content is still composed from the resolve-time read; serializing
 *  the read too is mlc103+ territory — the lock here closes the torn/lost
 *  WRITE, which is what the race inventory names. */
function writeSpecPatchLocked(
  repoRoot: string,
  io: GateIo,
  specAbs: string,
  contents: string,
): void {
  withBacklogLock(join(repoRoot, ".devx-cache"), "gate-spec-patch", () =>
    io.fs.writeFile(specAbs, contents),
  );
}

/** Record an evaluated FAIL in `gate_verdicts:` — verdict-only patch;
 *  gate_status booleans and stage are untouched (hfi102). Returns false when
 *  the frontmatter write fails, in which case the caller exits 2. */
function writeFailVerdict(
  repoRoot: string,
  ws: ResolvedWorkstream,
  key: GateKey,
  usage: string,
  io: GateIo,
): boolean {
  try {
    const updated = applyEnginePatch(ws.content, {
      gateVerdicts: { [key]: "FAIL" },
    });
    writeSpecPatchLocked(repoRoot, io, ws.specAbs, updated);
    return true;
  } catch (e) {
    io.err(
      `${usage}: FAIL verdict computed but frontmatter write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return false;
  }
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
  const { ws, subjects } = r;

  // Missing Gate-1 inputs are a refusal with a precise gap (exit 1), not an
  // error: the artifact simply hasn't been authored yet (/devx prd is next).
  const missing: string[] = [];
  if (!io.fs.exists(subjects.prd.abs)) missing.push(subjects.prd.rel);
  if (!io.fs.exists(subjects.expectations.abs)) {
    missing.push(subjects.expectations.rel);
  }
  if (missing.length > 0) {
    // `rel` is already repo-relative — re-prefixing `workstreamRel` here is
    // what made this refusal lie under project-level (`./prd/agent.md`).
    const gaps = missing.map((m) => ({
      check: "gate-input-missing",
      message: `${m} does not exist — run \`/devx prd ${ws.hash}\` first`,
    }));
    io.out(`${JSON.stringify({ gate: "FAIL", hash: ws.hash, gaps })}\n`);
    return 1;
  }

  const result = evaluateGatePrd({
    prd: io.fs.readFile(subjects.prd.abs),
    expectations: io.fs.readFile(subjects.expectations.abs),
    blockedBy: ws.state.blockedBy,
    expectationsMin: r.expectationsMin,
    prdRel: subjects.prd.rel,
    expectationsRel: subjects.expectations.rel,
  });

  if (result.verdict === "FAIL") {
    // Gap diagnostics print BEFORE the verdict write: a spec whose
    // frontmatter can't be patched must not swallow the reason the gate
    // failed (adversarial review — the write failure exits 2 after).
    io.out(
      `${JSON.stringify({ gate: "FAIL", hash: ws.hash, gaps: result.gaps })}\n`,
    );
    return writeFailVerdict(r.repoRoot, ws, "prd", "devx gate prd", io) ? 1 : 2;
  }

  // PASS: flip prd_validated + stage: design + verdict in one patch.
  const newStage = advanceStage(ws.state.stage, "design");
  try {
    const updated = applyEnginePatch(ws.content, {
      gateStatus: { prd_validated: true },
      stage: newStage,
      gateVerdicts: { prd: result.verdict },
    });
    writeSpecPatchLocked(r.repoRoot, io, ws.specAbs, updated);
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
  const { ws, subjects } = r;

  const detected = detectCoverageMode({
    state: ws.state,
    designExists: io.fs.exists(subjects.design.abs),
    planExists: io.fs.exists(subjects.plan.abs),
    designRel: subjects.design.rel,
    planRel: subjects.plan.rel,
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

  const files = {
    prd: io.fs.exists(subjects.prd.abs) ? io.fs.readFile(subjects.prd.abs) : "",
    expectations: io.fs.exists(subjects.expectations.abs)
      ? io.fs.readFile(subjects.expectations.abs)
      : "",
  };
  const sourceIds = extractSourceIds(mode, files);
  if (sourceIds.length === 0) {
    io.err(
      `devx gate coverage: no source IDs found in ${mode === "design" ? subjects.prd.rel : subjects.expectations.rel} — nothing to verify\n`,
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
    workstreamRel: subjects.docSetLabel,
    date,
    computation,
    extras: parsed.table.extras,
    subjects: {
      prdRel: subjects.prd.rel,
      designRel: subjects.design.rel,
      planRel: subjects.plan.rel,
      expectationsRel: subjects.expectations.rel,
    },
  });
  const reportName = `${date}-${mode}-verify.md`;
  const reportRel = `${subjects.decisionsDir.rel}/${reportName}`;
  const reportAbs = join(subjects.decisionsDir.abs, reportName);
  try {
    io.fs.mkdirRecursive(subjects.decisionsDir.abs);
    io.fs.writeFile(reportAbs, report);
  } catch (e) {
    io.err(
      `devx gate coverage: report write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }

  let flipped: Record<string, unknown> | null = null;
  const flag = mode === "design" ? ("design_verified" as const) : ("plan_verified" as const);
  if (computation.verdict !== "FAIL") {
    const targetStage: Stage = mode === "design" ? "plan" : "red";
    const newStage = advanceStage(ws.state.stage, targetStage);
    try {
      const updated = applyEnginePatch(ws.content, {
        gateStatus: { [flag]: true },
        stage: newStage,
        gateVerdicts: { [FLAG_TO_GATE_KEY[flag]]: computation.verdict },
      });
      writeSpecPatchLocked(r.repoRoot, io, ws.specAbs, updated);
      flipped = { [flag]: true, stage: newStage };
    } catch (e) {
      io.err(
        `devx gate coverage: verdict computed but frontmatter write failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 2;
    }
  }

  // The result JSON (which names the just-written report) prints BEFORE the
  // FAIL verdict write: a spec whose frontmatter can't be patched must not
  // swallow the gap diagnostics or the report pointer (adversarial review).
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
  if (
    computation.verdict === "FAIL" &&
    !writeFailVerdict(r.repoRoot, ws, FLAG_TO_GATE_KEY[flag], "devx gate coverage", io)
  ) {
    return 2;
  }
  return computation.verdict === "FAIL" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// devx gate evals <hash> [--dry-run]
// ---------------------------------------------------------------------------

export function runGateEvalsCli(
  args: string[],
  flags: {
    dryRun?: boolean;
    waive?: string[];
    reason?: string;
    approver?: string;
  },
  opts: RunGateOpts = {},
): number {
  const io = ioFrom(opts);
  if (args.length !== 1) {
    io.err(
      "usage: devx gate evals <hash> [--dry-run] [--waive <E-n> --reason <text> [--approver <name>]]\n",
    );
    return 2;
  }
  // D-9 waiver flags: --waive is repeatable / comma-separable; a waiver
  // without a recorded reason or a named approver is exactly the hand-edit
  // gap this path exists to close, so both are hard requirements.
  const waive = (flags.waive ?? [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toUpperCase())
    .filter((v) => v !== "");
  if (waive.length === 0 && (flags.reason !== undefined || flags.approver !== undefined)) {
    io.err("devx gate evals: --reason/--approver only apply with --waive <E-n>\n");
    return 2;
  }
  if (waive.length > 0) {
    const malformed = waive.filter((v) => !/^E-\d+$/.test(v));
    if (malformed.length > 0) {
      io.err(
        `devx gate evals: --waive expects E-<n> ids, got: ${malformed.join(", ")}\n`,
      );
      return 2;
    }
    if (!flags.reason || flags.reason.trim() === "") {
      io.err(
        "devx gate evals: --waive requires --reason <text> (D-9: a WAIVED verdict records why)\n",
      );
      return 2;
    }
    if (!flags.approver || flags.approver.trim() === "") {
      io.err(
        "devx gate evals: waiver needs a named approver (D-9) — pass --approver <name>\n",
      );
      return 2;
    }
  }
  const r = resolveOrFail(args[0], "devx gate evals", opts, io);
  if (!r.ok) return r.code;
  const { ws, subjects } = r;

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

  if (!io.fs.exists(subjects.expectations.abs)) {
    io.err(
      `devx gate evals: ${subjects.expectations.rel} not found — workstream state is inconsistent (plan_verified is true without Gate-1 inputs)\n`,
    );
    return 2;
  }
  const expectations = io.fs.readFile(subjects.expectations.abs);

  // A typo'd --waive must not silently waive nothing and then demand RED
  // from the eval the operator meant — refuse before evaluating anything.
  if (waive.length > 0) {
    const known = new Set(
      parseExpectations(expectations).map((b) => b.id.toUpperCase()),
    );
    const unknown = waive.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      io.err(
        `devx gate evals: cannot waive ${unknown.join(", ")} — no such expectation in ${subjects.expectations.rel}\n`,
      );
      return 2;
    }
  }

  const result = runGateEvals({
    repoRoot: r.repoRoot,
    workstreamAbs: subjects.docSetAbs,
    expectations,
    plan: io.fs.exists(subjects.plan.abs)
      ? io.fs.readFile(subjects.plan.abs)
      : null,
    runners: projectRunnersFrom(r.merged),
    exec: opts.exec ?? realShellExec,
    exists: (p) => io.fs.exists(p),
    donePhases: donePhasesFor(io.fs, r.repoRoot, subjects.docSetRel),
    waived: new Set(waive),
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
  const reportRel = subjects.redReport.rel;
  try {
    io.fs.mkdirRecursive(subjects.evalsDir.abs);
    io.fs.writeFile(
      subjects.redReport.abs,
      renderRedReport({
        workstreamRel: subjects.docSetLabel,
        date,
        result,
        waiver:
          waive.length > 0
            ? { approver: flags.approver!, reason: flags.reason! }
            : undefined,
      }),
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
        gateVerdicts: { evals: result.verdict },
      });
      writeSpecPatchLocked(r.repoRoot, io, ws.specAbs, updated);
      flipped = { evals_red: true, stage: newStage };
    } catch (e) {
      io.err(
        `devx gate evals: verdict computed but frontmatter write failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 2;
    }
  }

  // Same print-before-verdict-write ordering as gate coverage: the JSON
  // names the RED report already on disk and must survive a failed patch.
  io.out(
    `${JSON.stringify({
      gate: result.verdict,
      hash: ws.hash,
      report: reportRel,
      reasons: result.reasons,
      flipped,
      ...(waive.length > 0 ? { waived: waive } : {}),
    })}\n`,
  );
  if (
    result.verdict === "FAIL" &&
    !writeFailVerdict(r.repoRoot, ws, "evals", "devx gate evals", io)
  ) {
    return 2;
  }
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
      // Registered before any config is read, so no layout is resolvable
      // here — name the ARTIFACTS rather than one layout's spelling of
      // them, which under `project-level` would name files that don't
      // exist (review BH-3 / AA / EC-LOW2).
      "Gate 1: placeholder/E-block/EARS/threshold/ID-resolution checks on the PRD + expectations artifacts; pass flips prd_validated + stage: design.",
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
      "Gate 4 (RED): run every expectation's Verified-by target via projects: runners; P0s must be observed failing; writes the RED report into the workstream's evals dir.",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .option("--dry-run", "resolve artifacts + commands, run nothing, write nothing")
    .option(
      "--waive <e-id>",
      "record a D-9 WAIVED verdict for this expectation instead of demanding RED (repeatable)",
      (v: string, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option("--reason <text>", "waiver reason (required with --waive)")
    .option("--approver <name>", "waiver approver (default: $USER)")
    .action(
      (
        hash: string,
        cmdOpts: {
          dryRun?: boolean;
          waive: string[];
          reason?: string;
          approver?: string;
        },
      ) => {
        const code = runGateEvalsCli([hash], {
          dryRun: cmdOpts.dryRun,
          waive: cmdOpts.waive,
          reason: cmdOpts.reason,
          approver:
            cmdOpts.approver ??
            (cmdOpts.waive.length > 0 ? process.env.USER : undefined),
        });
        if (code !== 0) process.exit(code);
      },
    );

  attachPhase(sub, 1);
}
