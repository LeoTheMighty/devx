// Manager singleton lock — mgr101 scaffold + mgr106 stale-PID hardening.
// debug-9c4e21 extracts the O_EXCL + stale-PID machinery into the generic
// `acquirePathLock` / `acquirePathLockBlocking` so other short-critical-
// section writers (appendManualEntry's MANUAL.md read-check-write) can
// reuse it instead of growing their own lock; `acquireManagerLock` is now
// a thin wrapper that keeps its historical error type + warn prefix.
//
// O_EXCL create on `.devx-cache/locks/manager.lock` writing `{pid,
// acquired_at}` JSON. release() deletes the file. mgr106 adds:
//
//   1. Stale-PID detection — if the lock holder's PID is no longer alive,
//      WARN, delete the lock, retry once. Bounded retry (single cleanup
//      pass) prevents infinite loops if the cleanup unlinkSync itself fails.
//   2. PID-recycling cross-check — if the holder PID is alive but its
//      process started AFTER `acquired_at`, the PID was recycled (original
//      holder died, OS reused the PID); WARN, delete, retry once.
//
// Both cross-checks share the same retry budget (`MAX_STALE_RETRIES = 1`):
// at most one cleanup pass before we surface the held error
// (ManagerLockHeldError for the manager path, PathLockHeldError generically).

import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { classifyExistingLock, defaultPidAlive } from "../locks/classify.js";
import { probePidStartedAt } from "./pid-uptime.js";

export interface LockHandle {
  release(): void;
}

/**
 * Optional injectable seams for test-driven coverage of stale-PID +
 * recycling-detection paths. Production callers leave these unset.
 */
export interface AcquireExtra {
  /** Override the live-PID probe. Default: `process.kill(pid, 0)`. */
  pidAlive?: (pid: number) => boolean;
  /** Override the PID start-time probe. Default: platform-dispatched. */
  pidStartedAt?: (pid: number) => Date | null;
  /** Override the WARN sink. Default: `process.stderr.write`. */
  warn?: (msg: string) => void;
}

export class PathLockHeldError extends Error {
  public readonly path: string;
  constructor(path: string, message?: string) {
    super(message ?? `lock already held: ${path}`);
    this.name = "PathLockHeldError";
    this.path = path;
  }
}

export class ManagerLockHeldError extends PathLockHeldError {
  constructor(path: string) {
    super(path, `manager lock already held: ${path}`);
    this.name = "ManagerLockHeldError";
  }
}

// No `.devx-cache` default on either function (mlc101): a cwd-relative
// fallback is exactly the forked-universe foothold R1 is about — every
// caller must say which universe it means.
export function managerLockPath(cacheDir: string): string {
  return join(cacheDir, "locks", "manager.lock");
}

const MAX_STALE_RETRIES = 1;

export function acquireManagerLock(
  cacheDir: string,
  opts: AcquireExtra = {},
): LockHandle {
  return acquirePathLock(managerLockPath(cacheDir), {
    warn: (msg) => process.stderr.write(`manage: ${msg}\n`),
    ...opts,
    heldError: (p) => new ManagerLockHeldError(p),
  });
}

/**
 * Generic O_EXCL path lock with the full mgr106 stale-PID posture:
 * unparseable / dead-PID / recycled-PID locks are reaped (one bounded
 * retry); live-holder locks throw `heldError(path)` (default
 * PathLockHeldError). Non-blocking — see acquirePathLockBlocking for the
 * short-critical-section retry shape.
 */
export function acquirePathLock(
  path: string,
  opts: AcquireExtra & { heldError?: (path: string) => Error } = {},
): LockHandle {
  const heldError = opts.heldError ?? ((p: string) => new PathLockHeldError(p));
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR" || code === "EEXIST") {
      throw new Error(
        `lock dir is not a directory: ${dirname(path)} (${code})`,
      );
    }
    throw err;
  }

  const pidAlive = opts.pidAlive ?? defaultPidAlive;
  const pidStartedAt = opts.pidStartedAt ?? ((pid) => probePidStartedAt(pid));
  const warn = opts.warn ?? ((msg) => process.stderr.write(`devx lock: ${msg}\n`));

  let staleRetries = 0;

  while (true) {
    let fd: number;
    try {
      fd = openSync(path, "wx");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      // Lock held — examine whether it's stale.
      if (staleRetries >= MAX_STALE_RETRIES) {
        // Already cleaned up once; treat as genuinely held to avoid an
        // infinite loop (worst case: another writer keeps re-creating the
        // lock between our unlink and reopen).
        throw heldError(path);
      }
      const decision = classifyExistingLock(path, pidAlive, pidStartedAt);
      if (decision.kind === "held") {
        throw heldError(path);
      }
      // stale (unparseable / dead-pid / recycled) — WARN + unlink + retry.
      warn(decision.message);
      try {
        unlinkSync(path);
      } catch (unlinkErr) {
        const ucode = (unlinkErr as NodeJS.ErrnoException).code;
        // ENOENT = a peer already removed it (benign — proceed to retry).
        // Anything else means we can't reclaim the lock; surface as held
        // so the operator sees a real error rather than an infinite loop.
        if (ucode !== "ENOENT") {
          throw heldError(path);
        }
      }
      staleRetries++;
      continue;
    }
    // Acquired — write the body and return the handle. Track close state
    // so a writeSync that throws AFTER closeSync would have run doesn't
    // double-close the fd (BH-H4: kernels recycle fd numbers, double-close
    // can land on an unrelated open file).
    let closed = false;
    const safeClose = (): void => {
      if (closed) return;
      closed = true;
      try {
        closeSync(fd);
      } catch {
        // FD may already be invalid after a writeSync failure on some kernels.
      }
    };
    try {
      const body =
        JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }) + "\n";
      writeSync(fd, body);
      safeClose();
    } catch (err) {
      // writeSync (or close) failure leaves an empty lock file behind —
      // cleanup so subsequent acquires don't see EEXIST forever. Mirrors
      // mgr101's posture; mgr106's stale-PID retry would also reap it on
      // next acquire, but proactive unlink is cheaper.
      safeClose();
      try {
        unlinkSync(path);
      } catch {
        // best-effort
      }
      throw err;
    }
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        try {
          unlinkSync(path);
        } catch (err) {
          // ENOENT = already gone (fine — release is best-effort). Anything
          // else (EACCES, EISDIR) is a real bug worth surfacing.
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") throw err;
        }
      },
    };
  }
}

export interface BlockingAcquireOpts extends AcquireExtra {
  /** Give up and rethrow the held error after this long. Default 5s —
   *  callers guard sub-millisecond critical sections, so a healthy queue
   *  drains orders of magnitude faster; hitting the deadline means a
   *  wedged holder the stale-PID reaper couldn't classify. */
  timeoutMs?: number;
  /** Sleep between acquire attempts. Default 20ms. */
  pollMs?: number;
  /** Test seam — monotonic-ish clock for the deadline. */
  nowMs?: () => number;
  /** Test seam — synchronous sleep. Default Atomics.wait. */
  sleep?: (ms: number) => void;
}

/**
 * Blocking flavor of acquirePathLock for short critical sections: retry on
 * held (live holder) with a small synchronous sleep until timeoutMs, then
 * rethrow the held error. Stale locks are still reaped by each underlying
 * attempt, so a crashed holder delays a caller by at most one poll interval.
 */
export function acquirePathLockBlocking(
  path: string,
  opts: BlockingAcquireOpts = {},
): LockHandle {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const pollMs = opts.pollMs ?? 20;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const sleep = opts.sleep ?? sleepSync;
  const deadline = nowMs() + timeoutMs;
  while (true) {
    try {
      return acquirePathLock(path, opts);
    } catch (err) {
      if (!(err instanceof PathLockHeldError)) throw err;
      if (nowMs() >= deadline) throw err;
      sleep(pollMs);
    }
  }
}

/** Synchronous sleep without burning CPU — Node permits Atomics.wait on the
 *  main thread (unlike browsers). The array value never changes, so the wait
 *  always runs to its timeout. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// classifyExistingLock + defaultPidAlive + RECYCLING_GRACE_MS moved to
// src/lib/locks/classify.ts (mlc103) so spec locks share the identical
// mgr106 liveness posture. The manager lock's default JSON body
// `{pid, acquired_at}` is the classifier's default parse, so behavior
// here is byte-identical to the pre-extraction code.
