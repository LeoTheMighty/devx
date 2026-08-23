// Backlog mutation lock (mlc102) — ONE blocking cross-process critical
// section for every backlog/spec mutation and every git operation on the
// main checkout. Kills the unlocked read-modify-write races R3 (lost
// DEV.md update), R4 (torn multi-file claim vs a concurrent reader) and
// R10 (torn gate frontmatter patch) from the multi-loop-concurrency
// design (§Architecture 2).
//
// Shape: `withBacklogLock(cacheDir, label, fn)` wraps
// `acquirePathLockBlocking` (mgr106 O_EXCL + stale-PID posture — wrap,
// don't duplicate) on `<cacheDir>/locks/backlog.lock`. Timeout 30s /
// poll 20ms are CONSTANTS, not knobs (plan §What we're NOT doing): the
// guarded sections are file splices and local git ops; the long pole is
// a claim's `git push` (network), which 30s accommodates.
//
// Re-entrancy: the lock is re-entrant WITHIN a process (per lock path).
// The driver's composite sections (finalizeMerged) call helpers that
// guard themselves (commitOnMain, pushMain, releaseSpecLock) — without
// re-entrancy the outer hold would self-deadlock for the full timeout.
// A module-level held-set is safe here because every guarded section is
// synchronous (no awaits inside fn); there is no interleaving point at
// which a second logical task in the same process could observe the set.
//
// Spec: dev/dev-mlc102-2026-07-28T09:02-backlog-mutation-lock.md
// Design: _devx/workstreams/multi-loop-concurrency/design/agent.md §Architecture 2

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  type BlockingAcquireOpts,
  PathLockHeldError,
  acquirePathLockBlocking,
} from "../manage/lock.js";

/** Constants, not knobs (design §Architecture 2). */
export const BACKLOG_LOCK_TIMEOUT_MS = 30_000;
export const BACKLOG_LOCK_POLL_MS = 20;

export function backlogLockPath(cacheDir: string): string {
  return join(cacheDir, "locks", "backlog.lock");
}

/**
 * Thrown when the backlog lock stays held past the 30s deadline. Names the
 * holder pid (read from the lock body) so the operator can `ps` the wedged
 * process instead of guessing — the AC 1 timeout diagnostic.
 */
export class BacklogLockTimeoutError extends Error {
  readonly lockPath: string;
  readonly label: string;
  readonly holderPid: number | null;
  constructor(lockPath: string, label: string, holderPid: number | null) {
    const holder =
      holderPid !== null ? `held by pid ${holderPid}` : "holder pid unreadable";
    super(
      `backlog lock timeout after ${BACKLOG_LOCK_TIMEOUT_MS}ms waiting for '${label}': ${lockPath} (${holder})`,
    );
    this.name = "BacklogLockTimeoutError";
    this.lockPath = lockPath;
    this.label = label;
    this.holderPid = holderPid;
  }
}

/** Seam type for callers that must run lock-free in fake-fs tests —
 *  identity implementation: `(label, fn) => fn()`. */
export type BacklogLockFn = <T>(label: string, fn: () => T) => T;

/** Lock paths this process currently holds (re-entrancy — see header). */
const heldPaths = new Set<string>();

/**
 * Run `fn` while holding the cross-process backlog mutation lock at
 * `<cacheDir>/locks/backlog.lock`. Blocking with the 30s/20ms constants;
 * stale (dead-PID / recycled-PID) holders are reaped by the underlying
 * acquire. Re-entrant within the process: a nested call on the same lock
 * path runs `fn` directly under the outer hold.
 *
 * `fn` MUST be synchronous — the lock is released when `fn` returns, so a
 * returned Promise would escape the critical section.
 */
export function withBacklogLock<T>(
  cacheDir: string,
  label: string,
  fn: () => T,
  opts: BlockingAcquireOpts = {},
): T {
  const path = resolve(backlogLockPath(cacheDir));
  if (heldPaths.has(path)) {
    return fn();
  }
  let handle;
  try {
    handle = acquirePathLockBlocking(path, {
      timeoutMs: BACKLOG_LOCK_TIMEOUT_MS,
      pollMs: BACKLOG_LOCK_POLL_MS,
      ...opts,
    });
  } catch (err) {
    if (err instanceof PathLockHeldError) {
      throw new BacklogLockTimeoutError(path, label, readHolderPid(path));
    }
    throw err;
  }
  heldPaths.add(path);
  try {
    return fn();
  } finally {
    heldPaths.delete(path);
    try {
      handle.release();
    } catch (e) {
      // Release is best-effort (review BH-LOW-4): a rethrown unlink failure
      // here would supersede fn's SUCCESSFUL return — e.g. a fully durable
      // claim (pushed, worktree created) reported as failed. The lock file
      // left behind holds our live pid, so peers wait it out / the stale
      // reaper handles it once we exit; WARN so the operator sees why.
      process.stderr.write(
        `devx backlog-lock: WARN — failed to release ${path} after '${label}': ${e instanceof Error ? e.message : String(e)}; remove it by hand if it outlives pid ${process.pid}\n`,
      );
    }
  }
}

/** Best-effort holder-pid read for the timeout diagnostic. The body is the
 *  acquirePathLock JSON `{pid, acquired_at}`; anything unreadable or
 *  unparseable (vanished file, corrupt body) degrades to null. */
function readHolderPid(lockPath: string): number | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { pid?: unknown }).pid === "number"
    ) {
      return (parsed as { pid: number }).pid;
    }
    return null;
  } catch {
    return null;
  }
}
