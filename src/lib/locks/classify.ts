// Shared lock-liveness primitives — mlc103 extraction of the mgr106
// stale-PID machinery from src/lib/manage/lock.ts:
//   - classifyExistingLock: the manager-lock body classifier, verbatim
//     (manage/lock.ts re-imports it; behavior byte-identical).
//   - RECYCLING_GRACE_MS + defaultPidAlive: the liveness primitives BOTH
//     lock families build on.
//
// Spec locks (src/lib/devx/spec-lock.ts) deliberately implement their own
// classifier ON TOP of these primitives rather than through this function:
// they need richer verdicts (missing/empty/unknown-pid/live-with-age for
// pick-time masking, `devx doctor`, and drift rows) and a DIFFERENT
// recycling posture (recorded pid_started_at preferred; legacy bodies are
// liveness-only — E-3(b)). The decision trees are separate BY DESIGN; what
// must never fork is the grace window and the PID probes, which live only
// here. If you change a liveness rule, check both classifiers.
//
// Classification decides whether an existing lock file is (a) genuinely
// held or (b) reapable-stale. The only reaping cases are:
//   - lock file unparseable (corrupt / hand-edited)
//   - lock holder's PID isn't running
//   - lock holder's PID is running BUT its process provably started after
//     the lock was taken (PID recycled)
//
// Conservative posture (mgrret cross-epic lesson): any uncertainty — probe
// returns null, timestamps unparseable, empty body (a peer's mid-write
// race window) — defaults to "held". Better a spurious held error than
// clobbering a live peer's lock.

import { readFileSync } from "node:fs";

interface LockBody {
  pid: number;
  acquired_at: string;
}

export type LockClassification =
  | { kind: "held" }
  | { kind: "stale"; message: string };

/**
 * Grace window for the recycling cross-check: `ps -o etime=` has 1-second
 * resolution, so a probe of a just-started process lands within ~1s of the
 * recorded timestamp. Real PID recycling involves seconds-to-minutes deltas
 * (the PID counter has to wrap or the process be reaped + a new fork claim
 * the slot), so 2s doesn't compromise detection. Load-bearing on macOS —
 * see the mgr106 retro.
 */
export const RECYCLING_GRACE_MS = 2_000;

/**
 * Examine the existing lock file at `path` and decide held vs stale.
 * Extracted verbatim from the mgr106 manager-lock acquire path.
 */
export function classifyExistingLock(
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
      return {
        kind: "stale",
        message: `lock at ${path} vanished between EEXIST and read; retrying`,
      };
    }
    // EACCES, EIO etc. — can't determine, treat as held (conservative).
    return { kind: "held" };
  }
  // Empty / whitespace-only content is the signature of a peer's
  // mid-write race: openSync(O_EXCL|O_CREAT) creates the file empty, then
  // writeSync populates it. A reader that lands inside that window sees
  // an empty file. Reaping here would clobber the peer's lock once their
  // write lands → two-holder scenario (BH-H3). Conservative posture:
  // empty content → "held". Cost: a truly corrupt empty lock from a
  // catastrophic mid-write crash sticks until manually deleted, but the
  // writers' cleanup-on-throw already reaps that case proactively, and
  // the operator can always rm the lock file.
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
  // PID alive — cross-check against PID-recycling: a holder that started
  // after the lock was taken can't be the process that took it. Probe
  // null → skip the cross-check entirely (never clobber on "can't
  // determine").
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
 * anything).
 *
 *   ESRCH → no such process → false
 *   EPERM → process exists but we lack permission to signal → true
 *           (conservative: don't false-positive a stale-lock reap)
 *   anything else → swallow + true (don't reap on a kernel hiccup)
 */
export function defaultPidAlive(pid: number): boolean {
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
