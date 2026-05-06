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
//     Single-probe — runs `gh run list --branch <branch> --limit 1` once
//     and returns one of five states (no-workflow / empty / sha-mismatch /
//     in-progress / completed). The CLI `--once` mode and the
//     skill-body's ScheduleWakeup-driven outer loop both consume this.
//
//   awaitRemoteCi(branch, opts)
//     Multi-probe driver — composes probeRemoteCi with a `sleep` seam.
//     Returns one of three terminal states per spec AC #1:
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
//
// Polling discipline (AC #2): the SKILL BODY's outer poll uses the
// harness `ScheduleWakeup` 120s delay so the prompt cache stays warm
// (Anthropic cache TTL = 5min; 120s × 2 ≤ 5min). This module's `sleep`
// seam is the test-injectable hook for that — production passes
// `setTimeout`-based sleep, tests pass `() => Promise.resolve()` or a
// counter-incrementing fake.
//
// Spec: dev/dev-dvx105-2026-04-28T19:30-devx-await-remote-ci.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProbeState =
  | { state: "no-workflow" }
  | { state: "empty" }
  | { state: "sha-mismatch"; runHeadSha: string; headSha: string }
  | {
      state: "in-progress";
      runId: number;
      status: string;
      url: string;
      workflowName: string;
    }
  | {
      state: "completed";
      conclusion: string;
      runId: number;
      url: string;
      workflowName: string;
    };

export type AwaitState =
  | { state: "no-workflow" }
  | { state: "workflow-no-run"; reason: "no-runs" | "sha-mismatch" }
  | {
      state: "completed";
      conclusion: string;
      runId: number;
      url: string;
      workflowName: string;
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

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

  const fs: AwaitRemoteCiFs = { ...realFs, ...(opts.fs ?? {}) };
  const exec = opts.exec ?? realExec;

  // Step 1: workflows present?
  if (!hasWorkflowFiles(fs, opts.repoRoot)) {
    return { state: "no-workflow" };
  }

  // Step 2: gh run list.
  const ghResult = exec(
    "gh",
    [
      "run",
      "list",
      "--branch",
      branch,
      "--limit",
      "1",
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
    return { state: "empty" };
  }
  const run = runs[0];

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
  if (run.headSha !== headSha) {
    return {
      state: "sha-mismatch",
      runHeadSha: run.headSha,
      headSha,
    };
  }

  // Step 4: completed vs in-progress.
  // GitHub Actions terminal status is the literal string "completed".
  // Anything else (queued, in_progress, waiting, requested, pending) is
  // transient. We don't enumerate the transient set — the spec is "not
  // completed yet" and treating unknown statuses as transient is the
  // failure-safe direction (we'll just keep polling).
  if (run.status === "completed") {
    return {
      state: "completed",
      conclusion: run.conclusion ?? "",
      runId: run.databaseId,
      url: run.url,
      workflowName: run.workflowName,
    };
  }
  return {
    state: "in-progress",
    runId: run.databaseId,
    status: run.status,
    url: run.url,
    workflowName: run.workflowName,
  };
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
 *   probe ─► (empty) ──┤                                  (sleep emptyRetryMs)
 *                      └── empty (1st time) ─► probe ─┬── empty       ─► RETURN workflow-no-run
 *                                                     ├── no-workflow  ─► RETURN no-workflow
 *                                                     │                  (rare: workflow added between probes)
 *                                                     ├── sha-mismatch ─► RETURN workflow-no-run
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
    const exec = opts.exec ?? realExec;
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
  };
}
