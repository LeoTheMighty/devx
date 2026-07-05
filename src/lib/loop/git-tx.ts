// Transactional git for the overnight loop (v2l101) — gnhf's git.ts shape,
// devx-flavored.
//
// Hang-immunity + injection rules (v2/04 §4, all mandatory):
//
//   * Every git call goes through the one `git()` helper below, which uses
//     an argv ARRAY through the injectable Exec seam (spawnSync — no shell).
//     Agent-derived strings (commit messages, summaries) are data, never
//     shell syntax. Do NOT add a code path that builds a shell command
//     string from agent-provided input — test/loop-git-tx.test.ts carries
//     the injection regression test.
//   * GIT_TERMINAL_PROMPT=0 is injected into EVERY git subprocess so a
//     misconfigured credential helper or HTTPS auth challenge can't hang
//     the loop on a TTY prompt overnight.
//   * `-c commit.gpgsign=false -c tag.gpgsign=false` on commits — GPG is a
//     separate prompt pathway (pinentry) that GIT_TERMINAL_PROMPT doesn't
//     cover.
//   * Push never forces, never pulls. A push failure surfaces as
//     PushFailedError; the driver aborts the item AFTER preserving the
//     local commit (v2/04 §4).
//   * Refs / branch names that could plausibly come from parsed state are
//     rejected when they start with `-` (argv flag-smuggling guard).
//
// Every iteration logs a snapshot (head/branch/commit-count) via
// statusSnapshot() — catches "the reset didn't land / wrong branch" bugs
// that otherwise look identical to agent failures (v2/04 §4).
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md §4

import { type Exec, type ExecResult, realExec } from "../tour/exec.js";

export type { Exec, ExecResult } from "../tour/exec.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitTxError extends Error {
  /** Full stdout+stderr detail from the failing git invocation. */
  readonly detail: string;
  readonly args: string[];
  constructor(args: string[], detail: string) {
    super(`git ${args.join(" ")} failed: ${firstLine(detail)}`);
    this.name = "GitTxError";
    this.detail = detail;
    this.args = args;
  }
}

export class CommitFailedError extends Error {
  readonly detail: string;
  constructor(detail: string, cause?: unknown) {
    super(`git commit failed: ${firstLine(detail)}`, { cause });
    this.name = "CommitFailedError";
    this.detail = detail;
  }
}

export class PushFailedError extends Error {
  readonly detail: string;
  constructor(detail: string, cause?: unknown) {
    super(`git push failed: ${firstLine(detail)}`, { cause });
    this.name = "PushFailedError";
    this.detail = detail;
  }
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? text
  );
}

// ---------------------------------------------------------------------------
// The one git helper
// ---------------------------------------------------------------------------

const REF_FLAG_RE = /^-/;

function assertSafeRef(name: string, value: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`git-tx: ${name} must be a non-empty string`);
  }
  if (REF_FLAG_RE.test(value)) {
    // A ref starting with `-` would be parsed as a flag by git even under
    // argv exec. Loop-owned refs never look like this; reject outright.
    throw new Error(`git-tx: ${name} ${JSON.stringify(value)} looks like a flag — refusing`);
  }
}

/**
 * Run one git command via the injectable exec seam. Throws GitTxError on
 * non-zero exit. GIT_TERMINAL_PROMPT=0 is always injected; callers may add
 * more env (merged over process.env by the real exec).
 */
export function git(
  exec: Exec,
  cwd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): string {
  const r = exec("git", args, {
    cwd,
    env: { GIT_TERMINAL_PROMPT: "0", ...(extraEnv ?? {}) },
  });
  if (r.exitCode !== 0) {
    throw new GitTxError(args, combineOutput(r));
  }
  return r.stdout.trim();
}

function combineOutput(r: ExecResult): string {
  return [r.stdout, r.stderr]
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// Transactional primitives
// ---------------------------------------------------------------------------

export interface CommitResult {
  /** false when the tree was already clean (nothing staged after add -A). */
  committed: boolean;
  /** HEAD sha after the operation. */
  head: string;
}

/**
 * `git add -A` + commit with signing disabled. The commit message is
 * agent-derived data — it travels as a single argv element and is never
 * shell-interpreted. A clean tree returns `{committed: false}` (the caller
 * decides whether clean-after-success means no-op).
 */
export function commitAll(exec: Exec, cwd: string, message: string): CommitResult {
  if (typeof message !== "string" || message.trim() === "") {
    throw new Error("git-tx: commit message must be a non-empty string");
  }
  git(exec, cwd, ["add", "-A"]);
  // `diff --cached --quiet` exits 1 when there ARE staged changes.
  const staged = exec("git", ["diff", "--cached", "--quiet"], {
    cwd,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  if (staged.exitCode === 0) {
    return { committed: false, head: getHead(exec, cwd) };
  }
  try {
    git(exec, cwd, [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "tag.gpgsign=false",
      "commit",
      "-m",
      message,
    ]);
  } catch (e) {
    if (e instanceof GitTxError) throw new CommitFailedError(e.detail, e);
    throw e;
  }
  return { committed: true, head: getHead(exec, cwd) };
}

/**
 * Full rollback: `reset --hard HEAD` + `clean -fd`. Discards every
 * uncommitted change AND every untracked file/dir the iteration created.
 * Committed work is untouched (preserve-don't-delete on failure applies to
 * commits; uncommitted failure output is exactly what this discards).
 */
export function resetHard(exec: Exec, cwd: string): void {
  git(exec, cwd, ["reset", "--hard", "HEAD"]);
  git(exec, cwd, ["clean", "-fd"]);
}

/**
 * Push the current branch to origin. NEVER forces, NEVER pulls (v2/04 §4).
 * First push sets upstream (`-u origin HEAD`); subsequent pushes reuse it.
 * Failure → PushFailedError; the driver preserves the local commit and
 * aborts the item.
 */
export function pushCurrentBranch(exec: Exec, cwd: string): void {
  let hasUpstream = true;
  try {
    git(exec, cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  } catch {
    hasUpstream = false;
  }
  try {
    if (hasUpstream) {
      git(exec, cwd, ["push"]);
    } else {
      git(exec, cwd, ["push", "-u", "origin", "HEAD"]);
    }
  } catch (e) {
    if (e instanceof GitTxError) throw new PushFailedError(e.detail, e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Snapshots & queries
// ---------------------------------------------------------------------------

export interface GitSnapshot {
  head: string;
  branch: string;
  /** Commits unique to this branch since baseRef (0 when baseRef omitted). */
  commitCount: number;
  /** True when `status --porcelain` is non-empty. */
  dirty: boolean;
}

export function getHead(exec: Exec, cwd: string): string {
  return git(exec, cwd, ["rev-parse", "HEAD"]);
}

export function getCurrentBranch(exec: Exec, cwd: string): string {
  try {
    return git(exec, cwd, ["symbolic-ref", "--short", "HEAD"]);
  } catch {
    return git(exec, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  }
}

export function hasUncommittedChanges(exec: Exec, cwd: string): boolean {
  const out = git(exec, cwd, ["status", "--porcelain"]);
  return out !== "";
}

export function getCommitCount(exec: Exec, cwd: string, baseRef: string): number {
  assertSafeRef("baseRef", baseRef);
  const out = git(exec, cwd, ["rev-list", "--count", "--first-parent", `${baseRef}..HEAD`]);
  const n = Number.parseInt(out, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cheap per-iteration diagnostic snapshot for the JSONL lifecycle log.
 * Never throws — a snapshot failure must not look like an agent failure;
 * the error lands in the snapshot itself.
 */
export function statusSnapshot(
  exec: Exec,
  cwd: string,
  baseRef?: string,
): GitSnapshot | { error: string } {
  try {
    return {
      head: getHead(exec, cwd),
      branch: getCurrentBranch(exec, cwd),
      commitCount: baseRef !== undefined ? getCommitCount(exec, cwd, baseRef) : 0,
      dirty: hasUncommittedChanges(exec, cwd),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export interface DiffStat {
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
}

/** Diff stats for the morning report (base..HEAD). Never throws. */
export function diffStat(exec: Exec, cwd: string, baseRef: string): DiffStat {
  const empty: DiffStat = { filesChanged: 0, linesAdded: 0, linesDeleted: 0 };
  try {
    assertSafeRef("baseRef", baseRef);
    const out = git(exec, cwd, ["diff", "--numstat", `${baseRef}..HEAD`]);
    const stat = { ...empty };
    for (const line of out.split("\n")) {
      if (line.trim() === "") continue;
      const [added, deleted] = line.split("\t");
      stat.filesChanged++;
      if (added !== "-" && deleted !== "-") {
        stat.linesAdded += Number.parseInt(added ?? "0", 10) || 0;
        stat.linesDeleted += Number.parseInt(deleted ?? "0", 10) || 0;
      }
    }
    return stat;
  } catch {
    return empty;
  }
}

export { realExec };
