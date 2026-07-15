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

import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

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

export function managerLockPath(cacheDir: string = ".devx-cache"): string {
  return join(cacheDir, "locks", "manager.lock");
}

const MAX_STALE_RETRIES = 1;

export function acquireManagerLock(
  cacheDir: string = ".devx-cache",
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

interface LockBody {
  pid: number;
  acquired_at: string;
}

type LockClassification =
  | { kind: "held" }
  | { kind: "stale"; message: string };

/**
 * Examine the existing lock file and decide whether to (a) accept it as
 * genuinely held or (b) reap it as stale. The only reaping cases are:
 *   - lock file unparseable (corrupt / hand-edited)
 *   - lock holder's PID isn't running
 *   - lock holder's PID is running BUT its process started after
 *     `acquired_at` (recycled)
 *
 * Conservative posture: any uncertainty (probe returns null, ISO timestamp
 * unparseable) defaults to "held" — better to surface a spurious
 * ManagerLockHeldError than to clobber a peer manager's lock.
 */
function classifyExistingLock(
  path: string,
  pidAlive: (pid: number) => boolean,
  pidStartedAt: (pid: number) => Date | null,
): LockClassification {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    // Lock file disappeared between EEXIST and read (a peer reaped it).
    // Treat as stale → caller's retry will succeed on the open.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { kind: "stale", message: `lock at ${path} vanished between EEXIST and read; retrying` };
    }
    // EACCES, EIO etc. — can't determine, treat as held (conservative).
    return { kind: "held" };
  }
  // Empty / whitespace-only content is the signature of a peer's
  // mid-write race: openSync(O_EXCL|O_CREAT) creates the file empty, then
  // writeSync populates it. A reader that lands inside that window sees
  // an empty file. Reaping here would clobber the peer's lock once their
  // write lands → two-manager scenario (BH-H3). Conservative posture:
  // empty content → "held". Cost: a truly corrupt empty lock from a
  // catastrophic mid-write crash sticks until manually deleted, but
  // mgr101's cleanup-on-throw already reaps that case proactively, and
  // the operator can always `rm .devx-cache/locks/manager.lock`.
  if (raw.trim().length === 0) {
    return { kind: "held" };
  }
  const body = parseLockBody(raw);
  if (!body) {
    return {
      kind: "stale",
      message: `lock at ${path} is unparseable; deleting and retrying`,
    };
  }
  if (!pidAlive(body.pid)) {
    return {
      kind: "stale",
      message: `lock at ${path} holds pid ${body.pid} (not running); deleting and retrying`,
    };
  }
  // PID alive — cross-check against PID-recycling.
  //
  // Grace window: `ps -o etime=` has 1-second resolution. A process that
  // started < 1s ago reports elapsed=0, so probePidStartedAt returns
  // `now()` — which is later than `acquired_at` if any time passed
  // between the lock write and the probe (always true). Without a grace
  // window, every same-process re-acquire would false-positive as
  // recycled. RECYCLING_GRACE_MS subsumes etime's 1s resolution + clock
  // jitter; real PID recycling involves seconds-to-minutes deltas (the
  // PID counter has to wrap or the process has to be reaped + a new fork
  // claim the slot), so a 2s threshold doesn't compromise detection.
  const startedAt = pidStartedAt(body.pid);
  const acquiredAt = new Date(body.acquired_at);
  if (
    startedAt &&
    Number.isFinite(acquiredAt.getTime()) &&
    startedAt.getTime() > acquiredAt.getTime() + RECYCLING_GRACE_MS
  ) {
    return {
      kind: "stale",
      message:
        `lock at ${path} holds pid ${body.pid} but its process started ` +
        `${startedAt.toISOString()} (after acquired_at ${body.acquired_at}); ` +
        `pid recycled — deleting and retrying`,
    };
  }
  return { kind: "held" };
}

const RECYCLING_GRACE_MS = 2_000;

function parseLockBody(raw: string): LockBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) return null;
  // Reject whitespace-only acquired_at (EC: would fall through to
  // Number.isFinite(NaN) === false → conservative held forever, even if
  // the PID is recyclable). Trim-and-length-check forces unparseable.
  if (typeof o.acquired_at !== "string" || o.acquired_at.trim().length === 0) return null;
  return { pid: o.pid, acquired_at: o.acquired_at };
}

/**
 * Default PID-existence probe — `process.kill(pid, 0)` is the POSIX idiom
 * (signal 0 performs permission + existence checks without delivering
 * anything). Mirrors loop.ts's `defaultPidAlive`; kept locally to avoid a
 * cross-module dep cycle (loop.ts imports lock.ts in production via the
 * acquire path; the reverse import would close a cycle).
 *
 *   ESRCH → no such process → false
 *   EPERM → process exists but we lack permission to signal → true
 *           (conservative: don't false-positive a stale-lock reap)
 *   anything else → swallow + true (don't reap on a kernel hiccup)
 */
function defaultPidAlive(pid: number): boolean {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return true;
  }
}
