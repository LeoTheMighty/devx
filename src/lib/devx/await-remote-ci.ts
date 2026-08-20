// Three-state remote-CI probe consumed by `/devx` Phase 7 (dvx105). The
// skill body's prose used to inline three branching cases (no workflow /
// runs-not-yet-scheduled / runs-returned-poll-til-completed); centralising
// the state machine here makes the dispatch explicit, testable, and
// version-able. Same wrapper-not-fork pattern as merge-gate.ts (mrg101)
// and coverage-touched.ts (dvx104) — pure-ish primitive + thin CLI.
//
// Surface:
//
//   probeRemoteCi(branch, opts)
//     Single-probe — runs `gh run list --branch <branch> --limit <N>` once
//     and returns one of six states (no-workflow / empty / pr-conflicting /
//     sha-mismatch / in-progress / completed). The CLI `--once` mode and the
//     skill-body's ScheduleWakeup-driven outer loop both consume this.
//
//     c94f14: `empty` used to absorb two very different situations — GitHub
//     silently not firing a configured workflow (unexplained; INTERVIEW) and
//     GitHub *correctly* not firing because the PR is CONFLICTING and there
//     is no merge ref to build (mechanical; self-serviceable). PR #118 burned
//     41 probes over ~50 minutes on the second one reported as the first.
//     The probe now asks `gh pr view --json number,mergeable,mergeStateStatus`
//     on the empty path and splits `pr-conflicting` out.
//
//     arci1: the probe folds EVERY run at the branch's headSha, not just
//     the newest one. A repo with two workflows on the same PR (this repo
//     runs `CI & Deploy` and `devx-ci`) used to report the newest run's
//     conclusion as the whole verdict, so a green `CI & Deploy` masked a
//     red `devx-ci` and Phase 7 concluded "CI green, proceed to merge"
//     while `devx merge-gate` — which aggregates every check — correctly
//     said `merge:false`. Fold order (failure-safe, AC #4): any run still
//     running wins → `in-progress`; otherwise any non-success conclusion
//     wins → `completed` with that conclusion + that run's workflowName;
//     all-success → `completed`/`success`.
//
//   awaitRemoteCi(branch, opts)
//     Multi-probe driver — composes probeRemoteCi with a `sleep` seam.
//     Returns one of four terminal states (three per dvx105 AC #1, plus
//     c94f14's `pr-conflicting`):
//       - {state:"no-workflow"}                — no `.github/workflows/*.yml`.
//       - {state:"workflow-no-run"}            — workflows present but
//                                                 `gh run list` returned
//                                                 nothing within the
//                                                 60s + one retry window,
//                                                 OR runs returned but
//                                                 their headSha doesn't
//                                                 match `git rev-parse
//                                                 HEAD` (per AC #3).
//       - {state:"completed", conclusion}      — runs returned + matched
//                                                 + status == "completed".
//       - {state:"pr-conflicting", prNumber,   — no runs BECAUSE the PR is
//          mergeable, mergeStateStatus}          unmergeable (CONFLICTING /
//                                                 DIRTY). Terminal: no amount
//                                                 of waiting builds a merge
//                                                 ref that can't exist.
//
// Polling discipline (AC #2): the SKILL BODY's outer poll uses the
// harness `ScheduleWakeup` 120s delay so the prompt cache stays warm
// (Anthropic cache TTL = 5min; 120s × 2 ≤ 5min). This module's `sleep`
// seam is the test-injectable hook for that — production passes
// `setTimeout`-based sleep, tests pass `() => Promise.resolve()` or a
// counter-incrementing fake.
//
// Spec: dev/dev-dvx105-2026-04-28T19:30-devx-await-remote-ci.md
//       debug/debug-c94f14-2026-08-05T14:05-await-remote-ci-conflicting-pr-blind.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { withGhRetry } from "../gh-retry.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One workflow run at the probed commit. Carried on `in-progress` and
 * `completed` states so a consumer can name every workflow without a second
 * `gh` call (arci1 AC #2) — the Phase 7 status-log line is written straight
 * from this array.
 */
export interface RunSummary {
  runId: number;
  workflowName: string;
  status: string;
  conclusion: string | null;
  url: string;
}

export type ProbeState =
  | { state: "no-workflow" }
  | { state: "empty" }
  | {
      /**
       * debug-c94f14: workflows are configured and `gh run list` returned
       * nothing — because the PR is CONFLICTING, so GitHub can't build the
       * merge ref and `pull_request`-triggered workflows never fire. Distinct
       * from `empty` (genuinely unexplained silence) because the fix is
       * mechanical and self-serviceable: merge the base branch in, resolve,
       * push, re-probe.
       */
      state: "pr-conflicting";
      prNumber: number;
      /** GitHub's `mergeable` enum: MERGEABLE | CONFLICTING | UNKNOWN. */
      mergeable: string;
      /** GitHub's `mergeStateStatus`: DIRTY | BLOCKED | BEHIND | CLEAN | … */
      mergeStateStatus: string;
    }
  | { state: "sha-mismatch"; runHeadSha: string; headSha: string }
  | {
      state: "in-progress";
      runId: number;
      status: string;
      url: string;
      workflowName: string;
      /** Every run at `headSha`, newest-first (gh's order). */
      runs: RunSummary[];
    }
  | {
      state: "completed";
      conclusion: string;
      runId: number;
      url: string;
      workflowName: string;
      /** Every run at `headSha`, newest-first (gh's order). */
      runs: RunSummary[];
    };

export type AwaitState =
  | { state: "no-workflow" }
  | { state: "workflow-no-run"; reason: "no-runs" | "sha-mismatch" }
  | {
      /**
       * debug-c94f14 — terminal. The driver does NOT retry a conflicted PR:
       * no amount of waiting makes GitHub schedule a run against an
       * unbuildable merge ref. The caller resolves the conflict and
       * re-invokes.
       */
      state: "pr-conflicting";
      prNumber: number;
      mergeable: string;
      mergeStateStatus: string;
    }
  | {
      state: "completed";
      conclusion: string;
      runId: number;
      url: string;
      workflowName: string;
      /** Every run at `headSha`, newest-first (gh's order). */
      runs: RunSummary[];
    };

export interface AwaitRemoteCiFs {
  exists(path: string): boolean;
  readdir(path: string): string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => ExecResult;

export interface AwaitRemoteCiOpts {
  /** Project repo root — `.github/workflows/` and `git rev-parse` resolve here. */
  repoRoot: string;
  /** Test seam — partial fs override (real fs for unspecified keys). */
  fs?: Partial<AwaitRemoteCiFs>;
  /** Test seam — replacement for the real `gh`/`git` shell-out. */
  exec?: Exec;
  /** Test seam — async sleep used between polls. Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Test seam — explicit local HEAD sha. When omitted, computed via
   * `git rev-parse HEAD` in `repoRoot`. Lets tests skip the git invocation.
   */
  headSha?: string;
  /**
   * How many runs `gh run list` returns per probe. Must cover every
   * workflow that fires on one commit, with headroom for pushes that
   * landed after the pinned sha (their runs sort ahead of ours). Default
   * 30 — a repo would need 30 runs newer than the probed commit on the
   * same branch before the fold loses sight of it, and at that point the
   * probe degrades to `sha-mismatch`, which is the safe direction.
   */
  runLimit?: number;
  /**
   * Multi-probe driver only: ms to sleep when `gh run list` returned
   * nothing on the first probe (the empty-but-workflows-exist case).
   * Default 60_000 — the 60s budget AC #1 specifies.
   */
  emptyRetryMs?: number;
  /**
   * Multi-probe driver only: ms to sleep between in-progress polls.
   * Default 120_000 — the cache-warm window AC #2 specifies.
   */
  pollMs?: number;
  /**
   * debug-c94f14: how many times `gh pr view --json mergeable,…` is asked
   * before an `UNKNOWN` mergeability is accepted as unknown. GitHub computes
   * mergeability lazily, so the first read right after a push is routinely
   * `UNKNOWN`. Total attempts including the first. Default 3.
   */
  mergeableAttempts?: number;
  /**
   * debug-c94f14: ms to sleep between mergeability re-reads. Only slept when
   * the previous read said `UNKNOWN`. Default 2_000 — the whole bounded
   * re-poll costs at most ~4s, and only on the `empty` path.
   */
  mergeableRetryMs?: number;
  /**
   * Multi-probe driver only: hard cap on poll iterations. Defaults to a
   * large value (effectively "wait forever") so production runs aren't
   * artificially time-boxed; tests pass a small N.
   */
  maxPolls?: number;
}

// ---------------------------------------------------------------------------
// Real-IO defaults
// ---------------------------------------------------------------------------

const realFs: AwaitRemoteCiFs = {
  exists: (p) => existsSync(p),
  readdir: (p) => readdirSync(p),
};

const realExec: Exec = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: opts?.cwd });
  if (r.error || r.status === null) {
    const detail = r.error ? r.error.message : "spawn returned null status";
    return { stdout: r.stdout ?? "", stderr: detail, exitCode: 127 };
  }
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exitCode: r.status,
  };
};

// debug-d7e8e5: the probe's `gh run list` is a read; a transient 401/5xx
// used to raise GhProbeError and be reported as an operator-actionable gh
// outage. Retry it a bounded number of times first.
const retryingExec: Exec = withGhRetry(realExec);

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const DEFAULT_RUN_LIMIT = 30;
const DEFAULT_MERGEABLE_ATTEMPTS = 3;
const DEFAULT_MERGEABLE_RETRY_MS = 2_000;
const DEFAULT_EMPTY_RETRY_MS = 60_000;
const DEFAULT_POLL_MS = 120_000;
// Effectively "wait forever" — production runs poll until the gh API says
// the run is terminal. Tests cap this to bound runtime.
const DEFAULT_MAX_POLLS = 1_000_000;

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

/**
 * Thrown when `gh run list` exits non-zero (auth failure, network error,
 * rate limit) or returns malformed JSON. Distinct from any of the
 * legitimate states — gh failure is operator-actionable, not a CI signal.
 * Caller (CLI passthrough) maps this to a non-zero exit so the skill body
 * surfaces `gh auth status` advice rather than treating it as workflow-no-run.
 */
export class GhProbeError extends Error {
  readonly stage: "gh-run-list" | "gh-parse" | "git-rev-parse";
  constructor(
    stage: "gh-run-list" | "gh-parse" | "git-rev-parse",
    message: string,
  ) {
    super(`gh probe failed at stage '${stage}': ${message}`);
    this.name = "GhProbeError";
    this.stage = stage;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Inspect `<repoRoot>/.github/workflows/` for any `.yml`/`.yaml` file.
 * Pure over fs seam (no exec). Returns `false` when:
 *   - the directory doesn't exist, OR
 *   - the directory exists but is empty, OR
 *   - the directory contains only non-workflow files (README.md, .gitkeep).
 *
 * GitHub Actions only registers workflows from `.yml`/`.yaml` files
 * directly in `.github/workflows/` (not subdirectories). The matcher
 * mirrors that — case-insensitive on the suffix because some operators
 * use `.YML`. Files starting with `.` (like `.tmp.swp` from a hung editor)
 * are excluded — they're not real workflow definitions.
 *
 * Limitation (intentional): we don't parse YAML to verify the file IS a
 * workflow. A non-workflow `.yml` (a stale `_template.yml`, a misplaced
 * `Dockerfile.yml`) returns `true` and triggers a remote-CI probe; the
 * `gh run list` step then returns no runs and the driver maps to
 * `workflow-no-run` (after retry). This is the "fail safe to local-CI
 * gate" direction — the only user-visible cost is one INTERVIEW filing
 * when a repo has stale workflow-shaped files. Parsing YAML to filter
 * is out of scope for dvx105; revisit if false-positive rate proves
 * load-bearing.
 */
export function hasWorkflowFiles(
  fs: AwaitRemoteCiFs,
  repoRoot: string,
): boolean {
  const dir = join(repoRoot, ".github", "workflows");
  if (!fs.exists(dir)) return false;
  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch {
    // Permission errors etc. — treat as "no workflow detectable" rather
    // than throw; the skill body will fall through to local-CI-is-gate.
    return false;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const lower = name.toLowerCase();
    if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return true;
  }
  return false;
}

interface GhRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  url: string;
  headSha: string;
  workflowName: string;
}

/**
 * Parse `gh run list --json ...` output into a typed run shape. The CLI
 * always emits a JSON array (possibly empty). Throws GhProbeError on
 * malformed input — the skill body shouldn't silently treat unparseable
 * gh output as "no runs".
 *
 * Whitespace-only stdout (`"\n"`, `"   "`) is treated as `[]` — `gh` is
 * deterministic but a future shim or wrapper might emit a stray trailing
 * newline before the bracket; failing closed there would be hostile.
 */
export function parseGhRunList(stdout: string): GhRun[] {
  let parsed: unknown;
  try {
    const trimmed = stdout.trim();
    parsed = JSON.parse(trimmed || "[]");
  } catch (e) {
    throw new GhProbeError(
      "gh-parse",
      `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new GhProbeError(
      "gh-parse",
      `expected array, got ${typeof parsed}`,
    );
  }
  return parsed.map((raw, i) => coerceGhRun(raw, i));
}

const SHA_RE = /^[0-9a-f]{40}$/;

function coerceGhRun(raw: unknown, idx: number): GhRun {
  if (!raw || typeof raw !== "object") {
    throw new GhProbeError(
      "gh-parse",
      `run[${idx}] is not an object: ${JSON.stringify(raw)}`,
    );
  }
  const r = raw as Record<string, unknown>;
  // databaseId: positive integer. `Number.isFinite(1.5)` is true (a
  // floating-point ID would crash `gh run view <id>` opaquely downstream),
  // so use Number.isInteger + > 0.
  const databaseId =
    typeof r.databaseId === "number" && Number.isInteger(r.databaseId)
      ? r.databaseId
      : NaN;
  if (!Number.isInteger(databaseId) || databaseId <= 0) {
    throw new GhProbeError(
      "gh-parse",
      `run[${idx}] has invalid databaseId (expected positive integer): ${JSON.stringify(raw)}`,
    );
  }
  // status: non-empty string (transient like "queued"/"in_progress" or
  // terminal "completed"). Empty/missing is a parse anomaly.
  if (typeof r.status !== "string" || r.status === "") {
    throw new GhProbeError(
      "gh-parse",
      `run[${idx}] has missing/invalid status: ${JSON.stringify(raw)}`,
    );
  }
  const status = r.status;
  // conclusion: string OR null OR undefined (missing key). Numbers/
  // booleans are parse errors — silently coercing them to "" lets a
  // useless empty conclusion flow through to the success/failure check.
  // Missing key is intentionally tolerated as `null` for forward-compat:
  // gh always emits `conclusion: null` for in-progress runs today, but
  // a future schema simplification that drops the field for non-terminal
  // runs would still parse cleanly here. Terminal runs always have a
  // conclusion string from the API.
  let conclusion: string | null;
  if (typeof r.conclusion === "string") {
    conclusion = r.conclusion;
  } else if (r.conclusion === null || r.conclusion === undefined) {
    conclusion = null;
  } else {
    throw new GhProbeError(
      "gh-parse",
      `run[${idx}] has invalid conclusion (expected string|null): ${JSON.stringify(raw)}`,
    );
  }
  // headSha: 40-char lowercase hex. An empty headSha would compare unequal
  // against any local sha and produce a confusing "sha-mismatch with empty
  // run sha" INTERVIEW; reject as parse error.
  if (typeof r.headSha !== "string" || !SHA_RE.test(r.headSha)) {
    throw new GhProbeError(
      "gh-parse",
      `run[${idx}] has missing/invalid headSha (expected 40-char hex): ${JSON.stringify(raw)}`,
    );
  }
  const headSha = r.headSha;
  const url = typeof r.url === "string" ? r.url : "";
  const workflowName =
    typeof r.workflowName === "string" ? r.workflowName : "";
  return { databaseId, status, conclusion, url, headSha, workflowName };
}

/**
 * Fold every run at one commit into a single verdict (arci1).
 *
 * `runs` must be non-empty and must already be filtered to the probed
 * commit — the caller owns sha matching so the sha-mismatch state keeps
 * its own diagnostic shape.
 *
 * Precedence, most-dominant first:
 *
 *   1. **Any run not `completed` → `in-progress`.** A still-running sibling
 *      means the aggregate verdict isn't knowable yet, so the wait
 *      continues (AC #4). This holds even when another run has already
 *      failed: resolving early would report a partial view, and the extra
 *      poll costs one 120s wake-up against the risk of a wrong terminal
 *      state. The representative run is the first non-completed one.
 *   2. **Any completed run whose conclusion isn't `success` → that
 *      conclusion**, with that run as the representative. The skill body's
 *      Phase 7 dispatch treats `conclusion != "success"` as red, so
 *      `skipped` / `neutral` / `action_required` fold the same way a single
 *      run with that conclusion always has. Failure-safe: a null conclusion
 *      on a completed run folds to `""`, which is also not `success`.
 *   3. **All success → `success`**, represented by the newest run.
 *
 * The representative fields (`runId`, `url`, `workflowName`) exist so the
 * existing single-workflow consumers keep working unchanged; `runs` carries
 * the full picture.
 */
export function foldRunsAtSha(
  runs: RunSummary[],
): Extract<ProbeState, { state: "in-progress" | "completed" }> {
  if (runs.length === 0) {
    throw new Error("foldRunsAtSha: runs must be non-empty");
  }
  // GitHub Actions terminal status is the literal string "completed".
  // Anything else (queued, in_progress, waiting, requested, pending) is
  // transient. We don't enumerate the transient set — the spec is "not
  // completed yet" and treating unknown statuses as transient is the
  // failure-safe direction (we'll just keep polling).
  const pending = runs.find((r) => r.status !== "completed");
  if (pending) {
    return {
      state: "in-progress",
      runId: pending.runId,
      status: pending.status,
      url: pending.url,
      workflowName: pending.workflowName,
      runs,
    };
  }
  const failing = runs.find((r) => r.conclusion !== "success");
  const decider = failing ?? runs[0];
  return {
    state: "completed",
    conclusion: decider.conclusion ?? "",
    runId: decider.runId,
    url: decider.url,
    workflowName: decider.workflowName,
    runs,
  };
}

// ---------------------------------------------------------------------------
// PR mergeability (debug-c94f14)
// ---------------------------------------------------------------------------

/** One `gh pr view --json number,mergeable,mergeStateStatus` read. */
export interface PrMergeability {
  prNumber: number;
  /** MERGEABLE | CONFLICTING | UNKNOWN (GitHub's enum, verbatim). */
  mergeable: string;
  /** DIRTY | BLOCKED | BEHIND | CLEAN | DRAFT | HAS_HOOKS | UNSTABLE | UNKNOWN. */
  mergeStateStatus: string;
}

/**
 * Parse `gh pr view --json number,mergeable,mergeStateStatus` stdout.
 * Returns `null` — never throws — on anything unexpected: this read is a
 * *diagnostic refinement* of the `empty` state, so an unparseable answer must
 * degrade to plain `empty` rather than turn a CI wait into a probe failure.
 */
export function parsePrView(stdout: string): PrMergeability | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim() || "null");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const r = parsed as Record<string, unknown>;
  if (typeof r.number !== "number" || !Number.isInteger(r.number) || r.number <= 0) {
    return null;
  }
  const mergeable = typeof r.mergeable === "string" ? r.mergeable : "";
  const mergeStateStatus =
    typeof r.mergeStateStatus === "string" ? r.mergeStateStatus : "";
  if (mergeable === "" && mergeStateStatus === "") return null;
  return { prNumber: r.number, mergeable, mergeStateStatus };
}

/**
 * True when GitHub cannot build the PR's merge ref, which is exactly the
 * condition under which `pull_request` workflows never fire (PR #118,
 * 2026-08-05: `mergeable: CONFLICTING` / `mergeStateStatus: DIRTY`, zero runs
 * across 41 probes over ~50 minutes).
 *
 * Either field alone is enough — they're computed together but a future gh
 * version could surface only one, and both readings mean "resolve the
 * conflict" so there's no ambiguity to preserve.
 */
export function isPrConflicting(pr: PrMergeability): boolean {
  return pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
}

/**
 * Read the branch's PR mergeability, re-polling a bounded number of times
 * while GitHub answers `UNKNOWN` (it computes mergeability lazily, so the
 * first read right after a push routinely is).
 *
 * Returns `null` when there's nothing trustworthy to say — no PR for the
 * branch (`gh pr view` exits non-zero), the exec seam threw, or the payload
 * didn't parse. Every one of those degrades the caller to plain `empty`,
 * which is the pre-c94f14 behaviour: this check can only ever *add*
 * diagnosis, never remove a state the caller already handled.
 *
 * NOTE: this is the single exception to `probeRemoteCi`'s "does not sleep"
 * contract, and it is deliberately tiny (≤ ~4s by default, only on the
 * `empty` path). Without it a `--once` caller reads `UNKNOWN` and mis-reports
 * a conflicted PR as `empty` for another 120s wake-up cycle — the exact
 * 50-minute blindness this spec exists to kill.
 */
export function resolveMergeabilityOpts(opts: AwaitRemoteCiOpts): {
  attempts: number;
  retryMs: number;
} {
  const attempts = opts.mergeableAttempts ?? DEFAULT_MERGEABLE_ATTEMPTS;
  const retryMs = opts.mergeableRetryMs ?? DEFAULT_MERGEABLE_RETRY_MS;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(
      `opts.mergeableAttempts must be a positive integer (got ${attempts})`,
    );
  }
  if (!Number.isFinite(retryMs) || retryMs < 0) {
    throw new Error(
      `opts.mergeableRetryMs must be a non-negative finite number (got ${retryMs})`,
    );
  }
  return { attempts, retryMs };
}

export async function probePrMergeability(
  branch: string,
  opts: AwaitRemoteCiOpts,
): Promise<PrMergeability | null> {
  const { attempts, retryMs } = resolveMergeabilityOpts(opts);
  const exec = opts.exec ?? retryingExec;
  const sleep = opts.sleep ?? realSleep;

  let last: PrMergeability | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(retryMs);
    let result: ExecResult;
    try {
      result = exec(
        "gh",
        [
          "pr",
          "view",
          branch,
          "--json",
          "number,mergeable,mergeStateStatus",
        ],
        { cwd: opts.repoRoot },
      );
    } catch {
      // Exec seam blew up (no gh on PATH under a test fake, spawn failure).
      // Diagnostic-only read — stay silent.
      return null;
    }
    if (result.exitCode !== 0) {
      // Most commonly "no pull requests found for branch" — the probe is
      // running before the PR exists. Nothing to diagnose.
      return null;
    }
    const parsed = parsePrView(result.stdout);
    if (!parsed) return null;
    if (parsed.mergeable !== "UNKNOWN") return parsed;
    last = parsed;
  }
  // Still UNKNOWN after the bounded re-poll. Hand it back anyway — the caller
  // only acts on CONFLICTING, so an UNKNOWN falls through to `empty`.
  return last;
}

// ---------------------------------------------------------------------------
// Single-probe
// ---------------------------------------------------------------------------

/**
 * One-shot probe — does NOT sleep, does NOT retry. The driver
 * `awaitRemoteCi` composes this with a sleep seam. The skill body's
 * `ScheduleWakeup`-driven outer loop also consumes this directly via the
 * CLI's `--once` mode.
 *
 * Order of evaluation (matters because each step is more expensive than
 * the last):
 *   1. fs probe `.github/workflows/` — no exec. Cheap.
 *   2. exec `gh run list` — network round-trip. Skipped if step 1 said
 *      "no-workflow".
 *   2b. exec `gh pr view` — network round-trip, and ONLY on the empty path
 *       (c94f14). Diagnoses "no run because the PR is unmergeable"; a
 *       non-empty run list never pays for it.
 *   3. exec `git rev-parse HEAD` — local. Skipped if step 2 returned no runs.
 */
export async function probeRemoteCi(
  branch: string,
  opts: AwaitRemoteCiOpts,
): Promise<ProbeState> {
  if (!branch || branch.trim() === "") {
    throw new Error("probeRemoteCi: branch must be non-empty");
  }
  if (!opts.repoRoot) {
    throw new Error("probeRemoteCi: opts.repoRoot is required");
  }
  // Validate caller-supplied headSha at the boundary. Without this, an
  // uppercase / short / non-hex value would flow through to the unequal
  // compare and produce a confusing sha-mismatch INTERVIEW. Mirror the
  // git-rev-parse-output validation downstream.
  if (opts.headSha !== undefined && !SHA_RE.test(opts.headSha)) {
    throw new Error(
      `probeRemoteCi: opts.headSha must be 40-char lowercase hex (got ${JSON.stringify(opts.headSha)})`,
    );
  }

  const runLimit = opts.runLimit ?? DEFAULT_RUN_LIMIT;
  if (!Number.isInteger(runLimit) || runLimit < 1) {
    throw new Error(
      `probeRemoteCi: opts.runLimit must be a positive integer (got ${runLimit})`,
    );
  }
  // Validate the c94f14 mergeability knobs EAGERLY — they're only consumed on
  // the empty path, and a bad value surfacing as a mid-wait throw (mapped to
  // CLI exit 2 `stage:"unknown"`) reads as a gh outage rather than the caller
  // error it is.
  try {
    resolveMergeabilityOpts(opts);
  } catch (e) {
    throw new Error(
      `probeRemoteCi: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const fs: AwaitRemoteCiFs = { ...realFs, ...(opts.fs ?? {}) };
  const exec = opts.exec ?? retryingExec;

  // Step 1: workflows present?
  if (!hasWorkflowFiles(fs, opts.repoRoot)) {
    return { state: "no-workflow" };
  }

  // Step 2: gh run list. `--limit` is deliberately > 1 (arci1): a commit
  // with two workflows produces two runs, and folding both is the whole
  // point. gh returns them newest-first across the branch, so the list can
  // also contain runs for older commits — step 3 filters by headSha.
  const ghResult = exec(
    "gh",
    [
      "run",
      "list",
      "--branch",
      branch,
      "--limit",
      String(runLimit),
      "--json",
      "databaseId,status,conclusion,url,headSha,workflowName",
    ],
    { cwd: opts.repoRoot },
  );
  if (ghResult.exitCode !== 0) {
    throw new GhProbeError(
      "gh-run-list",
      `gh exited ${ghResult.exitCode}: ${ghResult.stderr.trim() || "(no stderr)"}`,
    );
  }
  const runs = parseGhRunList(ghResult.stdout);
  if (runs.length === 0) {
    // Step 2b (debug-c94f14): workflows exist but nothing ran. Before
    // reporting the undiagnosed `empty`, ask the mechanical question that
    // explains most of these — is the PR conflicted? GitHub can't build a
    // merge ref for a CONFLICTING PR, so `pull_request` workflows never
    // start, and the fix is self-serviceable (merge base in, resolve, push).
    const pr = await probePrMergeability(branch, opts);
    if (pr && isPrConflicting(pr)) {
      return {
        state: "pr-conflicting",
        prNumber: pr.prNumber,
        mergeable: pr.mergeable,
        mergeStateStatus: pr.mergeStateStatus,
      };
    }
    return { state: "empty" };
  }

  // Step 3: headSha verification.
  // Use `git rev-parse <branch>` (not `HEAD`) so the result is independent
  // of the cwd's current branch. The skill body invokes this CLI from the
  // worktree on the feature branch — `HEAD` would be correct there — but
  // we don't want correctness to depend on cwd state. The branch ref
  // resolves to the local branch tip, which is what we just pushed in
  // Phase 7 step 1 (`git push -u origin <branch>`).
  let headSha = opts.headSha;
  if (headSha === undefined) {
    const headResult = exec("git", ["rev-parse", branch], {
      cwd: opts.repoRoot,
    });
    if (headResult.exitCode !== 0) {
      throw new GhProbeError(
        "git-rev-parse",
        `git rev-parse ${branch} exited ${headResult.exitCode}: ${headResult.stderr.trim() || "(no stderr)"}`,
      );
    }
    const trimmed = headResult.stdout.trim();
    if (!SHA_RE.test(trimmed)) {
      // git could emit a ref name in detached/orphan states or under a
      // misconfigured shim. Reject anything that isn't a 40-char lowercase
      // hex to avoid spurious sha-mismatch INTERVIEW filings.
      throw new GhProbeError(
        "git-rev-parse",
        `git rev-parse ${branch} returned non-sha output: ${JSON.stringify(trimmed)}`,
      );
    }
    headSha = trimmed;
  }
  // Keep only the runs for the commit we're waiting on. `sha-mismatch`
  // still reports the newest run's sha — that's the diagnostic the skill
  // body cites in its INTERVIEW entry.
  const atSha = runs.filter((r) => r.headSha === headSha);
  if (atSha.length === 0) {
    return {
      state: "sha-mismatch",
      runHeadSha: runs[0].headSha,
      headSha,
    };
  }

  // Step 4: fold every run at the commit into one state.
  return foldRunsAtSha(
    atSha.map((r) => ({
      runId: r.databaseId,
      workflowName: r.workflowName,
      status: r.status,
      conclusion: r.conclusion,
      url: r.url,
    })),
  );
}

// ---------------------------------------------------------------------------
// Multi-probe driver
// ---------------------------------------------------------------------------

/**
 * Run the full state machine — probe, retry-once on empty, poll on
 * in-progress until completed (or maxPolls). Returns one of the three
 * terminal states from spec AC #1.
 *
 * State transitions:
 *
 *                      ┌── no-workflow ───────────────────► RETURN no-workflow
 *                      │
 *                      ├── pr-conflicting ────────────────► RETURN pr-conflicting
 *                      │                                    (terminal; c94f14)
 *   probe ─► (empty) ──┤                                  (sleep emptyRetryMs)
 *                      └── empty (1st time) ─► probe ─┬── empty       ─► RETURN workflow-no-run
 *                                                     ├── no-workflow  ─► RETURN no-workflow
 *                                                     │                  (rare: workflow added between probes)
 *                                                     ├── sha-mismatch ─► RETURN workflow-no-run
 *                                                     ├── pr-conflicting ─► RETURN pr-conflicting
 *                                                     ├── in-progress  ─► poll loop
 *                                                     └── completed    ─► RETURN completed
 *                      ├── sha-mismatch ─────────────────► RETURN workflow-no-run
 *                      ├── in-progress (sleep pollMs) ──► probe (loop)
 *                      └── completed ────────────────────► RETURN completed
 *
 * Note: a sha-mismatch always maps to `workflow-no-run` (per AC #3) — the
 * CI run we found is for a different commit, so from this branch's
 * perspective there's effectively no run yet. The skill body files
 * INTERVIEW for either reason; the discriminator on the AwaitState lets
 * an audit trail capture which.
 */
/** Lift a `pr-conflicting` ProbeState into the terminal AwaitState. */
function liftConflicting(
  probe: Extract<ProbeState, { state: "pr-conflicting" }>,
): AwaitState {
  return {
    state: "pr-conflicting",
    prNumber: probe.prNumber,
    mergeable: probe.mergeable,
    mergeStateStatus: probe.mergeStateStatus,
  };
}

export async function awaitRemoteCi(
  branch: string,
  opts: AwaitRemoteCiOpts,
): Promise<AwaitState> {
  const sleep = opts.sleep ?? realSleep;
  const emptyRetryMs = opts.emptyRetryMs ?? DEFAULT_EMPTY_RETRY_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const maxPolls = opts.maxPolls ?? DEFAULT_MAX_POLLS;

  if (!Number.isInteger(maxPolls) || maxPolls < 1) {
    throw new Error(
      `awaitRemoteCi: maxPolls must be a positive integer (got ${maxPolls})`,
    );
  }
  if (!Number.isFinite(pollMs) || pollMs < 0) {
    throw new Error(
      `awaitRemoteCi: pollMs must be a non-negative finite number (got ${pollMs})`,
    );
  }
  if (!Number.isFinite(emptyRetryMs) || emptyRetryMs < 0) {
    throw new Error(
      `awaitRemoteCi: emptyRetryMs must be a non-negative finite number (got ${emptyRetryMs})`,
    );
  }
  // Production safety: if no sleep seam was supplied (real setTimeout will
  // run), reject pollMs / emptyRetryMs < 1s — a busy loop hammering
  // `gh run list` will burn rate-limit + cost. Tests pass `noopSleep`
  // so these gates don't affect them. Empty-retry runs once per call so
  // it's a milder hammer than poll, but the same rationale applies.
  if (!opts.sleep && pollMs > 0 && pollMs < 1000) {
    throw new Error(
      `awaitRemoteCi: pollMs must be >= 1000 in production mode (got ${pollMs}); pass an explicit sleep seam to bypass`,
    );
  }
  if (!opts.sleep && emptyRetryMs > 0 && emptyRetryMs < 1000) {
    throw new Error(
      `awaitRemoteCi: emptyRetryMs must be >= 1000 in production mode (got ${emptyRetryMs}); pass an explicit sleep seam to bypass`,
    );
  }
  // Caller-supplied headSha is also validated by probeRemoteCi, but
  // failing fast here gives a clearer error (the validation failure
  // surfaces before the first gh round-trip and before the rev-parse).
  if (opts.headSha !== undefined && !SHA_RE.test(opts.headSha)) {
    throw new Error(
      `awaitRemoteCi: opts.headSha must be 40-char lowercase hex (got ${JSON.stringify(opts.headSha)})`,
    );
  }

  // Pin the headSha ONCE at the start of the wait. Without pinning, a
  // fix-forward push during polling shifts the local branch tip, the
  // next probe sees a "sha-mismatch" against the (correct, just newer)
  // HEAD, and the driver maps that to workflow-no-run — silently
  // discarding the run we were polling. Pinning keeps the semantics
  // "we wait for the run on the commit we started polling on"; if the
  // user wants to track the new HEAD they re-invoke /devx Phase 7.
  let pinnedOpts = opts;
  if (opts.headSha === undefined) {
    const exec = opts.exec ?? retryingExec;
    const r = exec("git", ["rev-parse", branch], { cwd: opts.repoRoot });
    if (r.exitCode !== 0) {
      throw new GhProbeError(
        "git-rev-parse",
        `git rev-parse ${branch} exited ${r.exitCode}: ${r.stderr.trim() || "(no stderr)"}`,
      );
    }
    const trimmed = r.stdout.trim();
    if (!SHA_RE.test(trimmed)) {
      throw new GhProbeError(
        "git-rev-parse",
        `git rev-parse ${branch} returned non-sha output: ${JSON.stringify(trimmed)}`,
      );
    }
    pinnedOpts = { ...opts, headSha: trimmed };
  }

  // First probe.
  let probe = await probeRemoteCi(branch, pinnedOpts);
  if (probe.state === "no-workflow") {
    return { state: "no-workflow" };
  }
  if (probe.state === "pr-conflicting") {
    // Terminal — retrying can't make GitHub schedule a run against an
    // unbuildable merge ref (debug-c94f14). Return immediately instead of
    // burning the 60s empty-retry on a state we've already diagnosed.
    return liftConflicting(probe);
  }
  if (probe.state === "sha-mismatch") {
    return { state: "workflow-no-run", reason: "sha-mismatch" };
  }
  if (probe.state === "completed") {
    return {
      state: "completed",
      conclusion: probe.conclusion,
      runId: probe.runId,
      url: probe.url,
      workflowName: probe.workflowName,
      runs: probe.runs,
    };
  }
  if (probe.state === "empty") {
    await sleep(emptyRetryMs);
    probe = await probeRemoteCi(branch, pinnedOpts);
    // Re-evaluate the second probe through the full discriminator. A
    // workflow added between probes is rare but possible (operator pushed
    // .github/workflows/ci.yml meanwhile); honour it.
    if (probe.state === "no-workflow") {
      return { state: "no-workflow" };
    }
    if (probe.state === "empty") {
      return { state: "workflow-no-run", reason: "no-runs" };
    }
    if (probe.state === "pr-conflicting") {
      return liftConflicting(probe);
    }
    if (probe.state === "sha-mismatch") {
      return { state: "workflow-no-run", reason: "sha-mismatch" };
    }
    if (probe.state === "completed") {
      return {
        state: "completed",
        conclusion: probe.conclusion,
        runId: probe.runId,
        url: probe.url,
        workflowName: probe.workflowName,
        runs: probe.runs,
      };
    }
    // fall through to in-progress polling
  }

  // Poll until terminal. probe.state must be "in-progress" here.
  let iter = 0;
  while (probe.state === "in-progress") {
    if (iter >= maxPolls) {
      // maxPolls is a test cap; production sets it to ~1M (effectively
      // never). When tripped in tests it indicates the fake exec didn't
      // transition — surface a clear error rather than infinite-loop.
      throw new Error(
        `awaitRemoteCi: maxPolls (${maxPolls}) exceeded while waiting for run ${probe.runId} to complete`,
      );
    }
    await sleep(pollMs);
    iter += 1;
    probe = await probeRemoteCi(branch, pinnedOpts);
    // Mid-poll, the run could disappear (rare: cancelled + pruned). Treat
    // empty/sha-mismatch the same as the post-empty branch above.
    if (probe.state === "no-workflow") {
      return { state: "no-workflow" };
    }
    if (probe.state === "empty") {
      return { state: "workflow-no-run", reason: "no-runs" };
    }
    if (probe.state === "pr-conflicting") {
      return liftConflicting(probe);
    }
    if (probe.state === "sha-mismatch") {
      return { state: "workflow-no-run", reason: "sha-mismatch" };
    }
  }
  // probe.state === "completed"
  return {
    state: "completed",
    conclusion: probe.conclusion,
    runId: probe.runId,
    url: probe.url,
    workflowName: probe.workflowName,
    runs: probe.runs,
  };
}
