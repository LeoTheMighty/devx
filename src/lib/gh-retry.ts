// Bounded retry for transient GitHub API failures (debug-d7e8e5).
//
// ── The bug ───────────────────────────────────────────────────────────────
// Observed 2026-08-05 ~12:00 during sgr107's Phase 8: GitHub's GraphQL
// endpoint intermittently answered "HTTP 401: Requires authentication" for
// ~half of all calls over ~15 minutes while REST calls succeeded and the
// token was valid (a direct `gh api graphql` and `gh pr view 117` both
// worked seconds later). `devx devx-helper check-hold 117` exited 2 three
// times in a row and `devx merge-gate sgr107` exited 2 once; every one of
// them succeeded on a manual retry with no state change.
//
// ── Root cause (AC 2) ─────────────────────────────────────────────────────
// There is no retry layer anywhere in the gh shell-out path. `realExec` in
// src/lib/exec.ts is single-shot spawnSync; every gh consumer — hold-check's
// `gh pr view --json comments,reviews`, `devx merge-gate`'s two signal calls
// (`gh pr list --head` + `gh pr view --json statusCheckRollup,reviews`),
// await-remote-ci's `gh run list`, and the loop tail's probes — surfaces the
// FIRST non-zero exit as a terminal failure: HoldCheckError / GhProbeError /
// `safeFailureExit("gh signal collection failed")` → exit 2. Failing safe on
// an uncertain signal is correct; treating a one-off flake as certain-enough
// to stop is not. Attended, the cost is a human retry loop. Unattended (the
// `devx loop` merge tail) the cost is a green item stranded as an open PR
// overnight — the "attended-era contracts break on first unattended contact"
// class from LEARN.md § Cross-epic patterns.
//
// ── The fix ───────────────────────────────────────────────────────────────
// One shared wrapper, not a retry loop per caller: `withGhRetry(exec)`
// decorates any `Exec` and re-runs a failed call with exponential backoff
// when BOTH of two independent predicates say yes:
//
//   1. `isRetryableGhInvocation(cmd, args)` — is this a read-only `gh`
//      invocation? Retrying a read costs latency; retrying `gh pr merge` or
//      `gh pr comment` risks a duplicate side effect on a call that may well
//      have landed server-side before the error surfaced. Allowlist, not
//      denylist: an unrecognized subcommand is not retried. Non-`gh` commands
//      (git plumbing shares this seam) pass straight through.
//   2. `classifyGhFailure(result)` — does the output look like a transient
//      class (GraphQL 401, HTTP 5xx/429, network/DNS/TLS error)? Anything
//      else — 404, permission denied, malformed flags, `gh` not installed
//      (exitCode 127 from the spawn seam) — is terminal and fails now, at
//      the same speed as before.
//
// Two predicates rather than one means neither has to be perfect: a
// mis-classified transient on a mutation still can't double-fire, and a
// mis-classified terminal on a read costs only the backoff budget.
//
// Spec: debug/debug-d7e8e5-2026-08-05T12:20-gh-transient-401-merge-tail.md

import type { Exec, ExecResult } from "./exec.js";

/** Total attempts including the first — 3 attempts ≈ 2 retries. */
export const DEFAULT_ATTEMPTS = 3;
/** Delay before the FIRST retry; subsequent delays multiply by FACTOR. */
export const DEFAULT_BASE_DELAY_MS = 1_000;
export const DEFAULT_FACTOR = 3;

export type GhFailureClass = "ok" | "transient" | "terminal";

export interface GhRetryInfo {
  cmd: string;
  args: string[];
  /** 1-based index of the attempt that just failed. */
  attempt: number;
  /** ms this wrapper is about to sleep before re-running. */
  delayMs: number;
  result: ExecResult;
}

export interface GhRetryOpts {
  attempts?: number;
  baseDelayMs?: number;
  factor?: number;
  /** Test seam — synchronous sleep. Default blocks via Atomics.wait. */
  sleep?: (ms: number) => void;
  /** Observability seam — called just before each backoff sleep. */
  onRetry?: (info: GhRetryInfo) => void;
}

/**
 * Read-only `gh` subcommands, keyed by command group. Retrying these is
 * free of side effects. Deliberately NOT here:
 *   • every mutation (`pr create|merge|close|comment|edit|review|ready`,
 *     `run rerun|cancel`, `issue create|close`, …) — a retry could
 *     double-fire an operation the server already applied;
 *   • `gh api` — the same verb covers GET and POST (and `gh api graphql`
 *     carries mutations as easily as queries), so the invocation alone
 *     doesn't prove idempotence. A future caller that wants retried
 *     `gh api` reads should shell them through `gh pr`/`gh run` or extend
 *     this table with a method check, not weaken the guard.
 */
const READ_ONLY_GH: ReadonlyMap<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>([
  ["pr", new Set(["view", "list", "checks", "diff", "status"])],
  ["run", new Set(["view", "list"])],
  ["issue", new Set(["view", "list", "status"])],
  ["repo", new Set(["view"])],
  ["release", new Set(["view", "list"])],
  ["workflow", new Set(["view", "list"])],
  ["search", new Set(["prs", "issues", "repos", "code", "commits"])],
  ["auth", new Set(["status"])],
]);

/**
 * Transient-class markers. Matched against stderr AND stdout because `gh`
 * sometimes prints the API error on stdout when `--json` is in play.
 *
 * The 401 entry is the headline case and looks alarming next to "an expired
 * token is 401 too" — deliberately so. A genuinely dead token fails all
 * three attempts and reports the same error ~4s later; a real GraphQL flake
 * clears on attempt 2. `gh`'s not-logged-in path doesn't reach here at all
 * (it prints "not logged into any GitHub hosts" with no HTTP status), so the
 * cost of the ambiguity is bounded to a few seconds on an already-broken
 * setup.
 */
const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /HTTP 401\b/i, // the observed GraphQL flake
  /HTTP 5\d\d\b/i, // 500/502/503/504 — server-side
  /HTTP 429\b/i, // rate limited
  /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|ENETDOWN)\b/,
  /connection reset by peer/i,
  /TLS handshake timeout/i,
  /\bi\/o timeout\b/i,
  /request timed out/i,
  /Client\.Timeout exceeded/i,
  /unexpected EOF/i,
  /(?:bad gateway|service unavailable|gateway time-?out)/i,
  /server error: /i,
  // GitHub's own wording when GraphQL falls over without an HTTP status —
  // it comes back on the `errors` array, so `gh` prints it as a plain
  // "GraphQL: …" line with no code to match on.
  /something went wrong while executing your query/i,
];

/**
 * The command's bare name: strip any directory prefix (both separators —
 * this runs on Windows too) and a Windows executable suffix, so
 * `C:\\hostedtoolcache\\gh.exe` and `/opt/homebrew/bin/gh` both read as
 * "gh". Callers pass a bare "gh" today; an absolute path shouldn't silently
 * turn the retry layer off.
 */
function binName(cmd: string): string {
  const last = cmd.split(/[\\/]/).pop() ?? cmd;
  return last.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "");
}

/**
 * Would retrying this exact invocation be side-effect free?
 *
 * The scan looks for the first token that NAMES a known command group, then
 * takes the next bare token as its subcommand. "First known group" rather
 * than "first bare word" because a global flag's value is itself a bare word
 * — `gh --repo o/r pr view 3` must classify the same as `gh pr view 3`, and
 * we can't know which flags take separated values. Anything the scan can't
 * place (an unknown group, a missing subcommand, `gh` behind a `--`
 * terminator) is not retried: this is an allowlist, and silence means no.
 */
export function isRetryableGhInvocation(cmd: string, args: string[]): boolean {
  if (binName(cmd) !== "gh") return false;
  let group: string | null = null;
  for (const a of args) {
    if (a === "--") break;
    if (a.startsWith("-")) continue;
    if (group === null) {
      if (READ_ONLY_GH.has(a)) group = a;
      continue;
    }
    return READ_ONLY_GH.get(group)?.has(a) === true;
  }
  return false;
}

/**
 * Does this result look like a transient GitHub/network failure?
 *
 * exitCode 0 is "ok" (nothing to retry). exitCode 127 is the spawn seam's
 * own marker for "the process never ran" (ENOENT — gh isn't installed,
 * EACCES) — always terminal, since no amount of backoff installs a binary.
 */
export function classifyGhFailure(r: ExecResult): GhFailureClass {
  if (r.exitCode === 0) return "ok";
  if (r.exitCode === 127) return "terminal";
  const text = `${r.stderr ?? ""}\n${r.stdout ?? ""}`;
  return TRANSIENT_PATTERNS.some((re) => re.test(text))
    ? "transient"
    : "terminal";
}

/** Blocking sleep — the Exec seam is synchronous (spawnSync), so the retry
 *  backoff has to be too. Atomics.wait on a SharedArrayBuffer is the only
 *  precise sync sleep in Node; a busy-wait would burn a core. */
export function sleepSync(ms: number): void {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Decorate an `Exec` with bounded retry on transient gh failures.
 *
 * Pass-through for everything else: non-gh commands, gh mutations, terminal
 * failures, and successes all return the inner result on the first call, so
 * wrapping a seam is behavior-preserving except in exactly the flake case.
 */
export function withGhRetry(inner: Exec, opts: GhRetryOpts = {}): Exec {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const factor = opts.factor ?? DEFAULT_FACTOR;
  const sleep = opts.sleep ?? sleepSync;

  return (cmd, args, execOpts) => {
    let result = inner(cmd, args, execOpts);
    for (let attempt = 1; attempt < attempts; attempt++) {
      if (classifyGhFailure(result) !== "transient") return result;
      if (!isRetryableGhInvocation(cmd, args)) return result;
      const delayMs = Math.round(baseDelayMs * factor ** (attempt - 1));
      opts.onRetry?.({ cmd, args, attempt, delayMs, result });
      sleep(delayMs);
      result = inner(cmd, args, execOpts);
    }
    return result;
  };
}
