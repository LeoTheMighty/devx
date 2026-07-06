// `devx outcome arm|score <hash>` — the outcome loop's CLI passthrough
// (v2o101; v2/02-engine.md §4.10). Thin driver over the pure evaluators in
// src/lib/engine/outcome.ts: resolve hash → workstream, read prd.md /
// expectations.md / the results template, call the pure fns, apply the
// frontmatter flips + write RESULTS.md, emit JSON.
//
//   devx outcome arm <hash> [--measure-by <YYYY-MM-DD|+Nw>]
//     At workstream close (stage: done): outcome → {status: pending,
//     measure_by: <date>} (default +4 weeks). Re-arming a pending outcome
//     updates measure_by; a scored outcome refuses.
//
//   devx outcome score <hash> --verdict keep|tune|restart|retire
//       --goal G-1=<actual> [--goal G-2=<actual> ...]
//       [--source G-1=<where> ...] [--result G-1=hit|miss|partial ...]
//       [--reopen E-1,E-2] [--successor <slug>]
//       [--reason <1-2 sentences>] [--notes <reading prose>]
//       [--disposition <prose>]
//     Scores every prd.md G- goal (bidirectional coverage required), writes
//     `_devx/workstreams/<slug>/RESULTS.md` from the shipped template, and
//     flips outcome.status. tune additionally clears evals_red + rolls the
//     stage back to red (replay path in the JSON); restart stamps
//     successor/superseded_by on this spec and learns_from on the successor
//     spec when one exists.
//
// Exit codes (the engine-wide gate contract):
//   0 — armed / scored; JSON on stdout. (Crash-residue RESULTS.md — on
//       disk while outcome.status is still unscored — is backed up to
//       RESULTS.md.stale-<date> and overwritten, reported in the JSON.)
//   1 — refusal: wrong stage, already scored, goal-coverage gap, unknown
//       E-id, ambiguous successor claim. Nothing written.
//   2 — error: unresolvable hash/workstream, bad flag shape (incl. tune
//       without --reopen / restart without --successor), missing
//       template/prd, config load failure, frontmatter patch failure.
//
// Spec: dev/dev-v2o101-2026-07-05T13:07-outcome-loop.md
// Design: v2/02-engine.md §4.10; v2/06-phases.md §V2.6

import { join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { applyEnginePatch, readEngineState } from "../lib/engine/frontmatter.js";
import {
  type GoalRowVerdict,
  type OutcomeVerdict,
  OUTCOME_VERDICTS,
  OutcomeError,
  OutcomeRefusal,
  computeArm,
  computeGoalRows,
  computeTune,
  defaultStatusReason,
  isOutcomeVerdict,
  parsePrdGoals,
  renderResults,
} from "../lib/engine/outcome.js";
import {
  type EngineFs,
  SLUG_RE,
  WorkstreamError,
  realEngineFs,
  resolveWorkstream,
} from "../lib/engine/workstream.js";
import { formatDate } from "../lib/engine/verdict.js";

export interface RunOutcomeOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  /** Injectable clock — no Date.now() below this seam. */
  now?: () => Date;
}

interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  fs: EngineFs;
  now: () => Date;
}

function ioFrom(opts: RunOutcomeOpts): Io {
  return {
    out: opts.out ?? ((s) => process.stdout.write(s)),
    err: opts.err ?? ((s) => process.stderr.write(s)),
    fs: { ...realEngineFs, ...(opts.fs ?? {}) },
    now: opts.now ?? (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// arm
// ---------------------------------------------------------------------------

export interface ArmFlags {
  measureBy?: string;
}

export function runOutcomeArm(
  hash: string,
  flags: ArmFlags,
  opts: RunOutcomeOpts = {},
): number {
  const io = ioFrom(opts);
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    io.err(`devx outcome arm: ${ctx.error}\n`);
    return 2;
  }
  let ws;
  try {
    ws = resolveWorkstream(ctx.ctx.repoRoot, hash, ctx.ctx.engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      io.err(`devx outcome arm: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  let computation;
  try {
    computation = computeArm(ws.state, flags.measureBy, io.now());
  } catch (e) {
    if (e instanceof OutcomeRefusal) {
      io.err(`devx outcome arm: ${e.message}\n`);
      return 1;
    }
    if (e instanceof OutcomeError) {
      io.err(`devx outcome arm: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  if (!computation.noop) {
    try {
      const updated = applyEnginePatch(ws.content, {
        outcome: { status: "pending", measure_by: computation.measureBy },
      });
      io.fs.writeFile(ws.specAbs, updated);
    } catch (e) {
      // e.g. scalar `outcome: pending` frontmatter (yaml setIn can't
      // descend into a scalar) — clean exit 2, not a raw stack (EC#2).
      io.err(
        `devx outcome arm: frontmatter patch failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 2;
    }
  }
  io.out(
    `${JSON.stringify({
      hash: ws.hash,
      armed: true,
      measure_by: computation.measureBy,
      noop: computation.noop,
      spec: ws.specRel,
    })}\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// score
// ---------------------------------------------------------------------------

export interface ScoreFlags {
  verdict?: string;
  /** Repeated `G-<n>=<value>` entries. */
  goals: string[];
  sources: string[];
  results: string[];
  reopen?: string;
  successor?: string;
  reason?: string;
  notes?: string;
  disposition?: string;
}

const GOAL_KV_RE = /^(G-\d+)=(.*)$/i;
const GOAL_RESULTS = new Set<GoalRowVerdict>(["hit", "miss", "partial"]);

function parseGoalKv(
  entries: string[],
  flag: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) {
    const m = GOAL_KV_RE.exec(entry.trim());
    if (!m || m[2].trim() === "") {
      throw new OutcomeError(
        `${flag} '${entry}' — expected ${flag} G-<n>=<value>`,
      );
    }
    const id = m[1].toUpperCase();
    if (out.has(id)) {
      throw new OutcomeError(`${flag} names '${id}' twice`);
    }
    out.set(id, m[2].trim());
  }
  return out;
}

export function runOutcomeScore(
  hash: string,
  flags: ScoreFlags,
  opts: RunOutcomeOpts = {},
): number {
  const io = ioFrom(opts);
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    io.err(`devx outcome score: ${ctx.error}\n`);
    return 2;
  }
  let ws;
  try {
    ws = resolveWorkstream(ctx.ctx.repoRoot, hash, ctx.ctx.engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      io.err(`devx outcome score: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  try {
    return scoreResolved(ws, ctx.ctx.repoRoot, ctx.ctx.engine.workstreamsRoot, flags, io);
  } catch (e) {
    if (e instanceof OutcomeRefusal) {
      io.err(`devx outcome score: ${e.message}\n`);
      return 1;
    }
    if (e instanceof OutcomeError) {
      io.err(`devx outcome score: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

function scoreResolved(
  ws: ReturnType<typeof resolveWorkstream>,
  repoRoot: string,
  workstreamsRoot: string,
  flags: ScoreFlags,
  io: Io,
): number {
  // ---- Flag validation (exit 2 on shape problems). -----------------------
  if (!flags.verdict || !isOutcomeVerdict(flags.verdict)) {
    throw new OutcomeError(
      `--verdict is required and must be one of ${OUTCOME_VERDICTS.join(" | ")} (got '${flags.verdict ?? ""}')`,
    );
  }
  const verdict: OutcomeVerdict = flags.verdict;
  const actuals = parseGoalKv(flags.goals, "--goal");
  const sources = parseGoalKv(flags.sources, "--source");
  const rawResults = parseGoalKv(flags.results, "--result");
  const results = new Map<string, GoalRowVerdict>();
  for (const [id, v] of rawResults) {
    const lowered = v.toLowerCase() as GoalRowVerdict;
    if (!GOAL_RESULTS.has(lowered)) {
      throw new OutcomeError(
        `--result ${id}=${v} — expected hit | miss | partial`,
      );
    }
    results.set(id, lowered);
  }
  if (verdict !== "tune" && flags.reopen !== undefined) {
    throw new OutcomeError("--reopen applies to verdict 'tune' only");
  }
  if (verdict === "tune" && (!flags.reopen || flags.reopen.trim() === "")) {
    // Symmetric with restart's missing --successor: a missing required
    // flag is a usage error (2), not an engine refusal (1) (EC#9).
    throw new OutcomeError(
      "verdict 'tune' requires --reopen with at least one E-id (e.g. --reopen E-1,E-2)",
    );
  }
  if (verdict !== "restart" && flags.successor !== undefined) {
    throw new OutcomeError("--successor applies to verdict 'restart' only");
  }
  if (verdict === "restart") {
    if (!flags.successor || !SLUG_RE.test(flags.successor) || flags.successor.length > 50) {
      throw new OutcomeError(
        "verdict 'restart' requires --successor <slug> (kebab-case, ≤50 chars)",
      );
    }
  }

  // ---- State refusals. ----------------------------------------------------
  if (isOutcomeVerdict(ws.state.outcome.status)) {
    throw new OutcomeRefusal(
      `outcome is already scored ('${ws.state.outcome.status}') — a recorded verdict is history; revise by hand if it was wrong`,
    );
  }
  if (ws.state.stage !== "done") {
    throw new OutcomeRefusal(
      `outcome score requires stage 'done' — stage is '${ws.state.stage ?? "unset"}' (close the workstream first)`,
    );
  }
  // A RESULTS.md on disk while outcome.status is still unscored is crash
  // residue: a prior run wrote RESULTS.md and died in the fs-failure window
  // before the spec flip below. Refusing would wedge the score permanently
  // (nothing is re-runnable, and the dispatcher keeps emitting the same
  // command — adversarial-review BH#3); frontmatter status is the source of
  // truth, so overwrite and report it. A RESULTS.md with a SCORED status
  // never reaches this line — the already-scored refusal above is the
  // artifact's real protection.
  const resultsAbs = join(ws.workstreamAbs, "RESULTS.md");
  const overwroteStaleResults = io.fs.exists(resultsAbs);

  // ---- Inputs. -------------------------------------------------------------
  const prdAbs = join(ws.workstreamAbs, "prd.md");
  if (!io.fs.exists(prdAbs)) {
    throw new OutcomeError(`${ws.workstreamRel}/prd.md not found — nothing to score against`);
  }
  const goals = parsePrdGoals(io.fs.readFile(prdAbs));
  const { rows } = computeGoalRows(goals, { actuals, sources, results });

  const templateAbs = join(repoRoot, "_devx", "templates", "engine", "results.md");
  if (!io.fs.exists(templateAbs)) {
    throw new OutcomeError(
      "engine template missing at _devx/templates/engine/results.md — run `devx init` (v2 scaffold) first",
    );
  }
  const template = io.fs.readFile(templateAbs);

  // ---- Verdict-specific computation. ---------------------------------------
  let tune: ReturnType<typeof computeTune> | null = null;
  if (verdict === "tune") {
    const expAbs = join(ws.workstreamAbs, "expectations.md");
    if (!io.fs.exists(expAbs)) {
      throw new OutcomeError(
        `${ws.workstreamRel}/expectations.md not found — tune's --reopen E-ids can't be validated`,
      );
    }
    tune = computeTune(
      ws.state,
      flags.reopen ?? "",
      io.fs.readFile(expAbs),
      ws.hash,
    );
  }

  let successorHash: string | null = null;
  let successorSpecRel: string | null = null;
  const successorWs =
    verdict === "restart" ? `${workstreamsRoot}/${flags.successor}` : null;
  if (verdict === "restart" && successorWs !== null) {
    // Adoption walk (same shape as createWorkstream's no-hash path): the
    // successor's plan spec is the one whose workstream: pointer claims
    // the successor dir. Scaffold-later is legal — lineage on the successor
    // side is stamped only when the spec exists now.
    const planDir = join(repoRoot, "plan");
    const claimants: Array<{ hash: string | null; rel: string }> = [];
    if (io.fs.exists(planDir)) {
      for (const name of [...io.fs.readdir(planDir)].sort()) {
        if (!name.endsWith(".md")) continue;
        let st;
        try {
          st = readEngineState(io.fs.readFile(join(planDir, name)));
        } catch {
          continue;
        }
        if (st.workstream === successorWs) {
          claimants.push({ hash: st.hash, rel: `plan/${name}` });
        }
      }
    }
    if (claimants.length > 1) {
      // Stamping lineage onto an arbitrary (filename-sort-first) claimant
      // would record wrong history silently (adversarial-review BH#4).
      throw new OutcomeRefusal(
        `${claimants.length} plan specs claim workstream '${successorWs}' (${claimants.map((c) => c.rel).join(", ")}) — resolve the duplicate claim before stamping lineage`,
      );
    }
    if (claimants.length === 1) {
      if (claimants[0].hash === null) {
        // A claimant with no readable hash would half-stamp lineage
        // (learns_from without superseded_by) silently (EC#7).
        throw new OutcomeRefusal(
          `${claimants[0].rel} claims workstream '${successorWs}' but has no readable hash frontmatter — fix it before stamping lineage`,
        );
      }
      successorHash = claimants[0].hash;
      successorSpecRel = claimants[0].rel;
    }
    if (successorHash === ws.hash || successorWs === ws.workstreamRel) {
      // Second clause: a spec resolved via the filename-slug fallback has
      // no workstream: frontmatter and matches no claimant, so the hash
      // check alone lets `--successor <own-slug>` through (EC#8).
      throw new OutcomeRefusal(
        `--successor '${flags.successor}' resolves to this workstream itself — a workstream can't be its own successor`,
      );
    }
  }

  // ---- Compute EVERY write before performing ANY (a throw mid-sequence
  //      must not leave RESULTS.md on disk with the spec unflipped — the
  //      exists-refusal above would then block the re-run). ------------------
  const date = formatDate(io.now());
  const statusReason = flags.reason?.trim() || defaultStatusReason(verdict, rows);
  const title = ws.workstreamRel.split("/").pop() ?? ws.hash;
  const reading =
    flags.notes?.trim() ||
    "(no reading recorded — pass --notes with what the numbers mean)";
  const disposition = flags.disposition?.trim() || defaultDisposition(verdict, tune, flags.successor);
  const resultsContent = renderResults({
    template,
    workstreamTitle: title,
    date,
    verdict,
    statusReason,
    rows,
    reading,
    disposition,
    reopened: tune?.reopened ?? [],
    successor: verdict === "restart" ? (flags.successor ?? null) : null,
  });

  let patched: string;
  let succAbs: string | null = null;
  let succPatched: string | null = null;
  try {
    patched = applyEnginePatch(ws.content, {
      outcome: { status: verdict },
    });
    if (tune !== null) {
      const gatePatch: Record<string, boolean> = {};
      for (const flag of tune.flagsCleared) gatePatch[flag] = false;
      patched = applyEnginePatch(patched, {
        gateStatus: gatePatch,
        stage: tune.stage,
      });
    }
    if (verdict === "restart") {
      patched = applyEnginePatch(patched, {
        successor: flags.successor as string,
        ...(successorHash !== null ? { supersededBy: successorHash } : {}),
      });
    }
    // Successor-side lineage (learns_from) when the successor spec exists.
    if (verdict === "restart" && successorSpecRel !== null) {
      succAbs = join(repoRoot, ...successorSpecRel.split("/"));
      succPatched = applyEnginePatch(io.fs.readFile(succAbs), {
        learnsFrom: ws.hash,
      });
    }
  } catch (e) {
    // Corrupted frontmatter on either spec → exit 2, nothing written
    // (RESULTS.md included — compute-then-write keeps the run re-runnable).
    throw new OutcomeError(
      `frontmatter patch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // ---- Perform the writes (all inputs validated + rendered above). --------
  // Crash residue is *usually* a dead prior run, but it could be a
  // hand-authored RESULTS.md whose spec flip was forgotten — back it up
  // rather than clobber (EC#1).
  let staleBackupRel: string | null = null;
  if (overwroteStaleResults) {
    const backupName = `RESULTS.md.stale-${date}`;
    io.fs.writeFile(join(ws.workstreamAbs, backupName), io.fs.readFile(resultsAbs));
    staleBackupRel = `${ws.workstreamRel}/${backupName}`;
  }
  io.fs.writeFile(resultsAbs, resultsContent);
  io.fs.writeFile(ws.specAbs, patched);
  // The verdict is recorded at this point — a successor-side lineage write
  // failure must not fail the whole score (the verdict would then disagree
  // with disk); degrade to a note the caller can act on (BH#3 sibling).
  let successorLineageError: string | null = null;
  if (succAbs !== null && succPatched !== null) {
    try {
      io.fs.writeFile(succAbs, succPatched);
    } catch (e) {
      successorLineageError = `learns_from write to ${successorSpecRel} failed (${e instanceof Error ? e.message : String(e)}) — stamp learns_from: ${ws.hash} on it manually`;
    }
  }

  io.out(
    `${JSON.stringify({
      hash: ws.hash,
      verdict,
      results: `${ws.workstreamRel}/RESULTS.md`,
      ...(overwroteStaleResults
        ? { overwrote_stale_results: true, stale_backup: staleBackupRel }
        : {}),
      ...(successorLineageError !== null
        ? { successor_lineage_error: successorLineageError }
        : {}),
      goals: rows.map((r) => ({
        id: r.id,
        actual: r.actual,
        source: r.source,
        verdict: r.verdict,
        derivation: r.derivation,
      })),
      ...(tune !== null
        ? {
            reopened: tune.reopened,
            reopen_artifacts: tune.reopenArtifacts,
            flags_cleared: tune.flagsCleared,
            stage: tune.stage,
            replay: tune.replay,
          }
        : {}),
      ...(verdict === "restart"
        ? {
            successor: flags.successor,
            successor_spec: successorSpecRel,
            successor_hash: successorHash,
            ...(successorSpecRel === null
              ? {
                  note: `no plan spec claims ${successorWs} yet — run \`devx workstream new ${flags.successor}\`, then stamp learns_from: ${ws.hash} on the new spec AND superseded_by: <its hash> on ${ws.specRel} (both lineage directions)`,
                }
              : {}),
          }
        : {}),
      spec: ws.specRel,
    })}\n`,
  );
  return 0;
}

function defaultDisposition(
  verdict: OutcomeVerdict,
  tune: ReturnType<typeof computeTune> | null,
  successor: string | undefined,
): string {
  switch (verdict) {
    case "keep":
      return "keep — goals hold as measured; no reopen, no successor.";
    case "tune":
      return `tune — reopening ${tune?.reopened.join(", ") ?? ""} (artifacts: ${
        tune?.reopenArtifacts.join(", ") || "(none named)"
      }); evals_red cleared, stage rolled back to ${tune?.stage ?? "red"}; replay: ${
        tune?.replay.join(" → ") ?? ""
      }.`;
    case "restart":
      return `restart — superseded by workstream '${successor ?? ""}'; lineage stamped (successor/superseded_by here, learns_from on the successor spec when present).`;
    case "retire":
      return "retire — outcome recorded; the workstream ends without a successor.";
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

export function register(program: Command): void {
  const outcome = program
    .command("outcome")
    .description(
      "Outcome loop (v2 engine, §4.10): arm measure_by at workstream close; score the PRD's G- goals vs reality into RESULTS.md with verdict keep|tune|restart|retire.",
    );

  outcome
    .command("arm")
    .description(
      "Arm the outcome at workstream close: outcome → {status: pending, measure_by: <date>} (default +4 weeks).",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .option("--measure-by <when>", "YYYY-MM-DD or +Nw (weeks from now); default +4w")
    .action((hash: string, cmdOpts: { measureBy?: string }) => {
      const code = runOutcomeArm(hash, { measureBy: cmdOpts.measureBy });
      if (code !== 0) process.exit(code);
    });

  outcome
    .command("score")
    .description(
      "Score every prd.md G- goal vs reality, write RESULTS.md, and flip outcome.status. tune reopens via --reopen E-ids; restart links --successor lineage.",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .requiredOption(
      "--verdict <verdict>",
      `one of ${OUTCOME_VERDICTS.join(" | ")}`,
    )
    .option(
      "--goal <G-n=actual>",
      "measured actual for a goal (repeatable; every prd.md goal required)",
      collect,
      [] as string[],
    )
    .option(
      "--source <G-n=where>",
      "where the actual came from (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--result <G-n=verdict>",
      "explicit per-goal hit|miss|partial (overrides the comparator inference)",
      collect,
      [] as string[],
    )
    .option("--reopen <E-ids>", "tune only: comma-separated missed E-ids to reopen")
    .option("--successor <slug>", "restart only: successor workstream slug")
    .option("--reason <text>", "status_reason for the RESULTS.md verdict block")
    .option("--notes <text>", "Reading section prose (what the numbers mean)")
    .option("--disposition <text>", "Disposition section prose")
    .action(
      (
        hash: string,
        cmdOpts: {
          verdict: string;
          goal: string[];
          source: string[];
          result: string[];
          reopen?: string;
          successor?: string;
          reason?: string;
          notes?: string;
          disposition?: string;
        },
      ) => {
        const code = runOutcomeScore(hash, {
          verdict: cmdOpts.verdict,
          goals: cmdOpts.goal,
          sources: cmdOpts.source,
          results: cmdOpts.result,
          reopen: cmdOpts.reopen,
          successor: cmdOpts.successor,
          reason: cmdOpts.reason,
          notes: cmdOpts.notes,
          disposition: cmdOpts.disposition,
        });
        if (code !== 0) process.exit(code);
      },
    );

  attachPhase(outcome, 1);
}
