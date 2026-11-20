// `devx outcome arm|score <hash>` — the outcome loop's CLI passthrough
// (v2o101; v2/02-engine.md §4.10). Thin driver over the pure evaluators in
// src/lib/engine/outcome.ts: resolve hash → workstream, read prd/agent.md /
// expectations.md / the results template, call the pure fns, apply the
// frontmatter flips + write RESULTS.md, emit JSON.
//
//   devx outcome arm <hash> [--measure-by <YYYY-MM-DD|+Nw>]
//     At workstream close (stage: done): outcome → {status: pending,
//     measure_by: <date>} (default +4 weeks). Re-arming a pending outcome
//     updates measure_by; a scored outcome refuses.
//
//   devx outcome score <hash> --verdict keep|tune|restart|retire
//       [--run] [--goal G-1=<actual> ...] [--attested G-1 ...]
//       [--source G-1=<where> ...] [--result G-1=hit|miss|partial ...]
//       [--reopen E-1,E-2] [--successor <slug>]
//       [--reason <1-2 sentences>] [--notes <reading prose>]
//       [--disposition <prose>]
//     With `--run`, every goal that NAMES a runnable measure (an
//     expectations `Measure:` one-liner, or a `(measured at outcome)` step in
//     its `Verified by:` eval manifest) is measured by EXECUTING it here, and
//     the command + value + window + timestamp become its Source cell — "a
//     hand-typed figure is not a result" (A18 / upstream §16). A goal with a
//     measure refuses a `--goal` flag whether or not `--run` was passed; the
//     recorded escape is `--attested G-n` with a `--source`, for a figure a
//     human vouched for because the measure cannot run. A measure that exits
//     nonzero or prints nothing refuses the whole score rather than guessing.
//     Scores every prd/agent.md G- goal (bidirectional coverage required), writes
//     `_devx/workstreams/<slug>/RESULTS.md` from the shipped template, and
//     flips outcome.status. tune additionally clears evals_red + erases
//     gate_verdicts.evals (hfi102 — no stale PASS survives the reopen) +
//     rolls the stage back to red (replay path in the JSON); restart stamps
//     successor/superseded_by on this spec and learns_from on the successor
//     spec when one exists.
//
// Exit codes (the engine-wide gate contract):
//   0 — armed / scored; JSON on stdout. (Crash-residue RESULTS.md — on
//       disk while outcome.status is still unscored — is backed up to
//       RESULTS.md.stale-<date> and overwritten, reported in the JSON.)
//   1 — refusal: wrong stage, already scored, goal-coverage gap, unknown
//       E-id, ambiguous successor claim, a hand-typed figure for a goal with
//       a runnable measure, an un-run measure, two measures for one goal, or
//       a measure that would not produce a number. Nothing written.
//   2 — error: unresolvable hash/workstream, bad flag shape (incl. tune
//       without --reopen / restart without --successor), missing
//       template/prd, config load failure, frontmatter patch failure.
//
// Spec: dev/dev-v2o101-2026-07-05T13:07-outcome-loop.md
// Design: v2/02-engine.md §4.10; v2/06-phases.md §V2.6

import { basename, dirname, join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import * as artifacts from "../lib/engine/artifacts.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { type EngineConfig } from "../lib/engine/config.js";
import { applyEnginePatch, readEngineState } from "../lib/engine/frontmatter.js";
import {
  type GoalMeasure,
  type GoalRowVerdict,
  type MeasuredValue,
  type OutcomeVerdict,
  OUTCOME_VERDICTS,
  OutcomeError,
  OutcomeRefusal,
  computeArm,
  computeGoalRows,
  computeTune,
  defaultStatusReason,
  isOutcomeVerdict,
  measuredAtStamp,
  measuredValueFrom,
  parsePrdGoals,
  renderResults,
  resolveGoalMeasures,
} from "../lib/engine/outcome.js";
import { parseExpectations } from "../lib/engine/expectations.js";
import {
  type ShellExec,
  realShellExec,
  resolveArtifactPath,
} from "../lib/engine/gate-evals.js";
import {
  type EngineFs,
  PROJECT_LEVEL_WORKSTREAM_REL,
  SLUG_RE,
  WorkstreamError,
  realEngineFs,
  resolveWorkstream,
  workstreamSlugFor,
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
  /** Injectable shell for `--run`. Shares gate-evals' ShellExec shape so a
   *  measure and an eval are executed through one seam, not two. */
  exec?: ShellExec;
}

interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  fs: EngineFs;
  now: () => Date;
  exec: ShellExec;
}

function ioFrom(opts: RunOutcomeOpts): Io {
  return {
    out: opts.out ?? ((s) => process.stdout.write(s)),
    err: opts.err ?? ((s) => process.stderr.write(s)),
    fs: { ...realEngineFs, ...(opts.fs ?? {}) },
    now: opts.now ?? (() => new Date()),
    exec: opts.exec ?? realShellExec,
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
  /** Execute each goal's declared measure instead of taking a figure. */
  run?: boolean;
  /** Repeated bare `G-<n>` ids: record a human-attested figure for a goal
   *  that HAS a measure. Requires --goal and --source for the same id.
   *  Optional, like `run`, so a caller predating the flag still compiles. */
  attested?: string[];
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

const GOAL_ID_RE = /^G-\d+$/i;

function parseGoalIds(entries: string[], flag: string): Set<string> {
  const out = new Set<string>();
  for (const raw of entries) {
    for (const part of raw.split(",")) {
      const id = part.trim().toUpperCase();
      if (id === "") continue;
      if (!GOAL_ID_RE.test(id)) {
        throw new OutcomeError(`${flag} '${part.trim()}' — expected ${flag} G-<n>`);
      }
      out.add(id);
    }
  }
  return out;
}

/**
 * Execute each goal's measure and capture its value of record.
 *
 * Refuses (exit 1) rather than guessing in both failure shapes:
 *
 *  - **nonzero exit** — upstream §14's rule is "if the source cannot run
 *    right now, stop and come back", and the reason is that an outcome
 *    verdict is permanent: `score` refuses to re-run over a recorded one.
 *    Scoring a goal `miss` because its measurement script was broken would
 *    carve a wrong verdict into history and reopen the wrong expectations.
 *  - **no output** — a command that exits 0 and prints nothing has produced
 *    no number. Treating empty as `0` is the single most dangerous default
 *    available here: for a "reduce X" goal it reads as a perfect result.
 *
 * Nothing is written before every measure has run, so a refusal leaves the
 * outcome re-runnable (the compute-then-write rule the rest of this file
 * already follows).
 */
function runGoalMeasures(
  measures: ReadonlyMap<string, GoalMeasure>,
  repoRoot: string,
  io: Io,
): Map<string, MeasuredValue> {
  const out = new Map<string, MeasuredValue>();
  // Sorted so a multi-goal run executes in a stable order — the JSON and
  // any partial-failure message then read the same way twice.
  for (const goalId of [...measures.keys()].sort()) {
    const measure = measures.get(goalId) as GoalMeasure;
    const result = io.exec(measure.command, repoRoot);
    if (result.exitCode !== 0) {
      const tail = `${result.stdout}\n${result.stderr}`
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .slice(-5)
        .join(" | ");
      throw new OutcomeRefusal(
        `${goalId}: measure \`${measure.command}\` (${measure.origin}) exited ${result.exitCode} — a broken measurement is not a missed goal, and an outcome verdict cannot be re-scored once recorded; fix the measure and re-run, or pass --attested ${goalId} --goal ${goalId}=<value> --source ${goalId}=<who/where>${tail === "" ? "" : `. Last output: ${tail}`}`,
      );
    }
    const value = measuredValueFrom(result.stdout);
    if (value === null) {
      throw new OutcomeRefusal(
        `${goalId}: measure \`${measure.command}\` (${measure.origin}) exited 0 but printed nothing — there is no number to record; a measure must print its value as its last line of stdout`,
      );
    }
    out.set(goalId, { measure, value, measuredAt: measuredAtStamp(io.now()) });
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
    return scoreResolved(ws, ctx.ctx.repoRoot, ctx.ctx.engine, flags, io);
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
  // The whole EngineConfig, not just `workstreamsRoot`: the successor pointer
  // and the record's title both have to be resolved through the LAYOUT, and a
  // bare root cannot answer either (review BH#5).
  engine: EngineConfig,
  flags: ScoreFlags,
  io: Io,
): number {
  const workstreamsRoot = engine.workstreamsRoot;
  // ---- Flag validation (exit 2 on shape problems). -----------------------
  if (!flags.verdict || !isOutcomeVerdict(flags.verdict)) {
    throw new OutcomeError(
      `--verdict is required and must be one of ${OUTCOME_VERDICTS.join(" | ")} (got '${flags.verdict ?? ""}')`,
    );
  }
  const verdict: OutcomeVerdict = flags.verdict;
  const actuals = parseGoalKv(flags.goals, "--goal");
  const sources = parseGoalKv(flags.sources, "--source");
  const attested = parseGoalIds(flags.attested ?? [], "--attested");
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
  // Subjects, not concatenations: `rel` is what the operator reads and `abs`
  // is what we open, and deriving one from the other by hand is how a flat
  // repo gets told to look at `./RESULTS.md` for a file at `RESULTS.md` —
  // or, worse, at a workstream directory it does not have (dlr104).
  const at = (kind: artifacts.ArtifactKind): artifacts.StageSubject =>
    artifacts.stageSubject(ws.layout, ws, kind);
  // Exact-name under `project-level`, where these sit at the repo root beside
  // devx's own backlogs and `fs.exists` is case-blind (artifacts.ts).
  const has = (kind: artifacts.ArtifactKind): boolean =>
    artifacts.artifactExists(io.fs, ws, kind);
  const resultsFile = at({ kind: "results" });
  const overwroteStaleResults = has({ kind: "results" });

  // ---- Inputs. -------------------------------------------------------------
  const prd = at({ kind: "agent", stage: "prd" });
  if (!has({ kind: "agent", stage: "prd" })) {
    throw new OutcomeError(`${prd.rel} not found — nothing to score against`);
  }
  const goals = parsePrdGoals(io.fs.readFile(prd.abs));

  // ---- Runnable measures (A18). -------------------------------------------
  // Resolved from expectations.md whenever it exists — this is NOT gated on
  // `--run`, because the refusal has to fire for an un-run measure too. An
  // absent expectations.md simply yields no measures, which is how a
  // grandfathered workstream keeps today's hand-typed path.
  const expectationsSubject = at({ kind: "expectations" });
  const eBlocks = has({ kind: "expectations" })
    ? parseExpectations(io.fs.readFile(expectationsSubject.abs))
    : [];
  const measures = resolveGoalMeasures(
    goals,
    eBlocks,
    (verifiedBy) => {
      // Same resolver Gate 4 uses, so a manifest the RED gate ran is a
      // manifest this command can find — `evals/…` against the doc set,
      // everything else against the repo root.
      const { abs } = resolveArtifactPath(
        repoRoot,
        dirname(expectationsSubject.abs),
        verifiedBy,
      );
      if (!io.fs.exists(abs)) return null;
      try {
        return io.fs.readFile(abs);
      } catch {
        return null;
      }
    },
    // Attested goals are resolved past, not refused over — an ambiguous
    // goal the operator has chosen to attest must not still block.
    attested,
  );
  // An attested goal is deliberately NOT measured, even under `--run`: the
  // operator has said a human is vouching for this one.
  const measured =
    flags.run === true && measures.size > 0
      ? runGoalMeasures(measures, repoRoot, io)
      : new Map<string, MeasuredValue>();

  const { rows } = computeGoalRows(goals, {
    actuals,
    sources,
    results,
    measured,
    unrun: measures,
    attested,
  });

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
    const expectations = at({ kind: "expectations" });
    if (!has({ kind: "expectations" })) {
      throw new OutcomeError(
        `${expectations.rel} not found — tune's --reopen E-ids can't be validated`,
      );
    }
    tune = computeTune(
      ws.state,
      flags.reopen ?? "",
      io.fs.readFile(expectations.abs),
      ws.hash,
    );
  }

  let successorHash: string | null = null;
  let successorSpecRel: string | null = null;
  // Projected through the layout, like every other workstream pointer: under
  // `project-level` there are no slug directories, so a raw
  // `<root>/<slug>` marker matches NO spec (they all carry `workstream: .`).
  // Left raw, `--successor` stamped no lineage while reporting success, and
  // the self-successor guard below went dead — a workstream could be made its
  // own successor (review BH#5).
  const successorWs =
    verdict === "restart"
      ? ws.layout === "project-level"
        ? PROJECT_LEVEL_WORKSTREAM_REL
        : `${workstreamsRoot}/${flags.successor}`
      : null;
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
  // Through the shared helper: the tail of `.` is `.`, so under
  // `project-level` a hand-rolled tail titles the outcome record "." — the
  // slug lives in the plan spec's filename there. Same form `devx todo sync`
  // already uses (review BH#5).
  const title =
    workstreamSlugFor(basename(ws.specAbs), ws.workstreamRel, engine) ?? ws.hash;
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
      // Erase the reopened gate's verdict too (hfi102) — a stale
      // `gate_verdicts.evals: PASS` must not render as passed while the
      // reopen rolls the stage back to red.
      const verdictPatch: Record<string, null> = {};
      for (const key of tune.verdictsCleared) verdictPatch[key] = null;
      patched = applyEnginePatch(patched, {
        gateStatus: gatePatch,
        gateVerdicts: verdictPatch,
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
    // Sibling by construction — suffixed onto the resolved subject rather
    // than re-joined against the workstream dir, so the backup lands beside
    // the file it backs up in either layout and its `rel` cannot spell that
    // directory a second, different way.
    io.fs.writeFile(`${resultsFile.abs}.stale-${date}`, io.fs.readFile(resultsFile.abs));
    staleBackupRel = `${resultsFile.rel}.stale-${date}`;
  }
  io.fs.writeFile(resultsFile.abs, resultsContent);
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
      results: resultsFile.rel,
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
        provenance: r.provenance,
      })),
      // What ran, and what had no measure at all. The second list is the
      // measurability gap Gate 1 now warns about, reported again at the one
      // moment it actually costs something.
      measured: [...measured.values()].map((m) => ({
        id: m.measure.goalId,
        command: m.measure.command,
        value: m.value,
        window: m.measure.window,
        measured_at: m.measuredAt,
        origin: m.measure.origin,
      })),
      goals_without_measure: goals
        .map((g) => g.id)
        .filter((id) => !measures.has(id)),
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
      "Score every prd/agent.md G- goal vs reality, write RESULTS.md, and flip outcome.status. --run executes each goal's declared measure instead of taking a figure; tune reopens via --reopen E-ids; restart links --successor lineage.",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .requiredOption(
      "--verdict <verdict>",
      `one of ${OUTCOME_VERDICTS.join(" | ")}`,
    )
    .option(
      "--run",
      "execute each goal's declared measure (expectations `Measure:` or a `(measured at outcome)` manifest step) and record command + value + window + timestamp as its source",
    )
    .option(
      "--goal <G-n=actual>",
      "actual for a goal with NO runnable measure (repeatable; refused for a goal that has one)",
      collect,
      [] as string[],
    )
    .option(
      "--attested <G-n>",
      "record this goal's figure as human-attested instead of measured (repeatable; requires --goal + --source for the same id)",
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
          run?: boolean;
          goal: string[];
          attested: string[];
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
          run: cmdOpts.run,
          goals: cmdOpts.goal,
          attested: cmdOpts.attested,
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
