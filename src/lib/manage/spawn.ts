// Manager worker spawn — mgr104.
//
// Wraps `child_process.spawn('claude', ['/devx', hash], …)` for a single
// detached worker:
//   - Resolves a per-worker log path under the platform-conventional log
//     directory (`~/Library/Logs/devx` on darwin, `~/.local/state/devx`
//     elsewhere — matches `defaultLogPath()` in supervisor.ts).
//   - Pre-rotates the log to `<path>.<iso-ts>` if it crossed 1 MB before
//     the previous run, then opens the fresh log in append mode.
//   - Spawns detached + unref'd so manager death does not propagate to
//     workers (epic locked decision: "Detached child means Manager death
//     does not kill workers — they continue + are reaped by OS supervisor
//     on next Manager restart").
//   - Atomically registers `{pid, spec_hash, started_at, crash_count: 0,
//     worker_class}` into manager.json's roster before resolving (AC #4).
//   - Wires a minimal on-exit handler that clears the roster slot on any
//     exit. mgr105 extends this with crash_count + backoff index; mgr106
//     adds the manager-restart PID-existence sweep that recovers lost
//     exit events when the manager itself crashed mid-window.
//
// Design notes (the parts a future reader will want to know):
//
//  * **Why spawnWorker writes manager.json itself** — AC #4 pins "PID +
//    start time persisted to manager.json atomically before spawnWorker
//    returns." The loop driver re-reads the state after spawn returns to
//    fold in tick metadata, accepting a microsecond-scale race window where
//    a child that exits simultaneously could double-write. Race is benign:
//    on-exit's write cleans up either order; mgr105's PID-existence sweep
//    catches any orphan slot on the next tick.
//
//  * **Why we close the parent's log fd after spawn** — `spawn(..., {stdio:
//    ['ignore', fd, fd]})` dup's the fd into the child. Holding the parent
//    copy leaks one fd per worker for the lifetime of the manager process.
//    Close in `finally` so a synchronous spawn throw doesn't leak either.
//
//  * **Why the on-exit handler is best-effort** — the manager process can
//    crash between the child's exit and the state write. The next manager
//    boot reads stale roster; mgr106's `process.kill(pid, 0)` sweep on init
//    detects the absent PID and recovers via a synthetic exit event. This
//    is the "Manager-restart PID-recovery on init" locked decision (epic
//    party-mode #13).
//
//  * **Why log rotation runs pre-spawn, not post-write** — rotation here is
//    purely size-driven (`worker-<hash>.log` ≥ 1 MB → rename to
//    `worker-<hash>.log.<iso-ts>`). Doing it post-write would require a
//    file watcher; doing it pre-spawn means the new run always starts in
//    a fresh small log. The 1 MB threshold is generous for short worker
//    runs (most exit < 100 KB) and bounded enough that an out-of-control
//    worker doesn't fill /var.
//
// Spec: dev/dev-mgr104-2026-04-28T19:30-manage-spawn-worker.md
// Epic: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md

import {
  type ChildProcess,
  type SpawnOptions,
  spawn as nodeSpawn,
} from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  type ManagerState,
  type RosterEntry,
  readManagerState,
  writeManagerState,
} from "./state.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const LOG_ROTATION_BYTES = 1024 * 1024; // 1 MB (AC #3)

const DEFAULT_CLAUDE_BIN = "claude";
const DEFAULT_WORKER_CLASS = "dev";

/**
 * Allowed hash format. Mirrors the parser regex in `src/lib/backlog/parse.ts`
 * (`[a-z0-9]{3,12}`). Validating here is the load-bearing guard against
 * (a) path traversal — `../etc/passwd` becomes a worker-log path outside
 * `logDir`; (b) argv injection — a leading `-` makes `claude /devx -evil`
 * ambiguous to flag parsers downstream. The natural `desiredSpawn.spec_hash`
 * from reconcile + parseDevMd already passes; this guard catches programmatic
 * callers that synthesize a DesiredSpawn from a different source.
 */
const HASH_FORMAT_RE = /^[a-z0-9]{3,12}$/;

export interface SpawnWorkerResult {
  pid: number;
}

export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface SpawnWorkerOpts {
  /** `.devx-cache` root for state-file IO. Defaults to `.devx-cache`. */
  cacheDir?: string;
  /** Log directory for worker stdout+stderr. Defaults per platform. */
  logDir?: string;
  /** Override the `claude` executable path. Tests inject a stub script. */
  claudeBin?: string;
  /** Test seam — replaces `child_process.spawn`. */
  spawnFn?: SpawnFn;
  /** Test seam — clock injection for deterministic timestamps + rotation. */
  now?: () => Date;
  /**
   * Called once spawnWorker has the ChildProcess in hand, AFTER the on-exit
   * handler is registered. Tests use this to await child completion before
   * driving the next tick. Production callers leave it unset.
   */
  onSpawn?: (child: ChildProcess) => void;
  /**
   * Override `detached`. Defaults to true (production semantics —
   * `child.unref()` so the manager can exit without waiting). Tests pass
   * false when they need the child tied to the parent for synchronization.
   */
  detached?: boolean;
  /** Worker-class label persisted alongside the PID. Defaults to "dev". */
  workerClass?: string;
}

/**
 * Resolve the platform-conventional worker log directory. Mirrors
 * `defaultLogPath()` in supervisor.ts:
 *   darwin → `~/Library/Logs/devx`
 *   linux + win32-WSL → `~/.local/state/devx`
 *
 * Note: kept here (rather than imported from supervisor.ts) because that
 * helper takes a `role` argument and returns a per-role file path; we want
 * the bare directory.
 */
export function defaultWorkerLogDir(opts: { home?: string; platform?: NodeJS.Platform } = {}): string {
  // `||` not `??` so an empty-string HOME (common in stripped launchd
  // contexts and minimal Docker images) falls through to homedir().
  // `??` would treat `""` as "set" and pollute cwd with relative log paths.
  const home = opts.home || process.env.HOME || homedir();
  const platform = opts.platform ?? process.platform;
  if (platform === "darwin") return join(home, "Library", "Logs", "devx");
  return join(home, ".local", "state", "devx");
}

export function workerLogPath(hash: string, opts: { logDir?: string; home?: string; platform?: NodeJS.Platform } = {}): string {
  const dir = opts.logDir ?? defaultWorkerLogDir({ home: opts.home, platform: opts.platform });
  return join(dir, `worker-${hash}.log`);
}

/**
 * Rotate `<logPath>` to `<logPath>.<iso-ts>` if its current size is at or
 * above the 1 MB threshold. Returns true iff rotation happened. Best-effort:
 * a stat or rename failure leaves the existing log in place and returns
 * false — the worker still gets a working append handle, just possibly
 * past the threshold for one more run. Production callers don't depend on
 * the boolean; tests assert it.
 */
export function rotateWorkerLogIfNeeded(
  logPath: string,
  now: () => Date = () => new Date(),
): boolean {
  if (!existsSync(logPath)) return false;
  let size: number;
  try {
    size = statSync(logPath).size;
  } catch {
    return false;
  }
  if (size < LOG_ROTATION_BYTES) return false;
  // Probe a counter suffix when two rotations land within the same
  // millisecond (manager restart loop, NTP step, back-to-back tests).
  // Without this guard, renameSync silently overwrites the previous
  // archive on POSIX. Bound at 100 to avoid an infinite loop on a
  // misbehaving filesystem; at that point we accept overwrite.
  const ts = now().toISOString();
  let archived = `${logPath}.${ts}`;
  for (let i = 1; i < 100 && existsSync(archived); i++) {
    archived = `${logPath}.${ts}.${i}`;
  }
  try {
    renameSync(logPath, archived);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// spawnWorker
// ---------------------------------------------------------------------------

export async function spawnWorker(
  hash: string,
  model: string,
  opts: SpawnWorkerOpts = {},
): Promise<SpawnWorkerResult> {
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error("spawnWorker: hash must be a non-empty string");
  }
  if (!HASH_FORMAT_RE.test(hash)) {
    // Reject before path-construction or argv-construction so a malicious
    // or malformed DesiredSpawn can't escape the log dir or smuggle a
    // leading `-` into argv. Same restriction the backlog parser enforces.
    throw new Error(
      `spawnWorker: hash must match ${HASH_FORMAT_RE.source}; got ${JSON.stringify(hash)}`,
    );
  }
  if (typeof model !== "string" || model.length === 0) {
    throw new Error("spawnWorker: model must be a non-empty string");
  }

  const cacheDir = opts.cacheDir ?? ".devx-cache";
  const nowFn = opts.now ?? (() => new Date());
  const claudeBin = opts.claudeBin ?? process.env.DEVX_CLAUDE_BIN ?? DEFAULT_CLAUDE_BIN;
  const detached = opts.detached ?? true;
  const workerClass = opts.workerClass ?? DEFAULT_WORKER_CLASS;
  const spawnImpl: SpawnFn = opts.spawnFn ?? (nodeSpawn as unknown as SpawnFn);

  const logDir = opts.logDir ?? defaultWorkerLogDir();
  // mkdirSync recursive is idempotent — second call against an existing
  // dir does nothing. ENOTDIR (file at one of the path components) bubbles.
  mkdirSync(logDir, { recursive: true });

  const logPath = join(logDir, `worker-${hash}.log`);
  rotateWorkerLogIfNeeded(logPath, nowFn);

  // Open append-mode log fd for the child's stdio. The fd survives spawn
  // because Node dup's it into the child; we close our copy in finally.
  const fd = openSync(logPath, "a");

  let child: ChildProcess;
  try {
    child = spawnImpl(claudeBin, ["/devx", hash], {
      detached,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Some kernels invalidate the parent fd after the dup. Best-effort.
    }
  }

  // Spawn returns synchronously; failure surfaces as no PID + an async
  // 'error' event. Throw early so the caller doesn't register an entry
  // for a worker that never started.
  if (!child.pid) {
    throw new Error(
      `spawnWorker: child_process.spawn returned no PID (claudeBin=${claudeBin}, hash=${hash})`,
    );
  }
  // Snapshot the PID before any async hop. `child.pid` is documented to
  // remain stable after spawn, but some Node patches null it after exit;
  // the on-exit handler closes over `myPid` to avoid filtering against
  // `undefined` (which would silently match nothing → leak the slot).
  const myPid = child.pid;
  if (detached) child.unref();

  // Atomically register PID + start time in manager.json roster. AC #4
  // pins this happens before spawnWorker resolves.
  const startedAt = nowFn().toISOString();
  const newEntry: RosterEntry = {
    pid: myPid,
    spec_hash: hash,
    started_at: startedAt,
    crash_count: 0,
    worker_class: workerClass,
  };
  registerRosterEntry(cacheDir, newEntry, model);

  // Minimal on-exit handler: clear the roster slot for this PID. mgr105
  // extends with crash_count + last_exit_code + backoff index. Errors are
  // swallowed because the handler runs after a (potentially crashed)
  // child — we don't want to crash the manager on a state-file IO blip
  // that the next tick will reconcile anyway.
  child.on("exit", () => {
    try {
      const cur = readManagerState(cacheDir);
      const filtered = cur.roster.filter((r) => r.pid !== myPid);
      writeManagerState(cacheDir, { ...cur, roster: filtered });
    } catch {
      // best-effort
    }
  });

  if (opts.onSpawn) opts.onSpawn(child);

  return { pid: myPid };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function registerRosterEntry(
  cacheDir: string,
  entry: RosterEntry,
  model: string,
): void {
  const cur = readManagerState(cacheDir);
  // Replace any existing entry for this spec_hash — defensive against a
  // re-entrant spawn against the same hash (shouldn't happen under hard cap
  // but defends against programmatic bugs). PID equality is the kill key
  // for the on-exit handler so we use spec_hash here for de-dup.
  const roster = cur.roster.filter((r) => r.spec_hash !== entry.spec_hash);
  roster.push(entry);
  // Persist the caller's model — `model` is sourced from the current
  // reconcile result (state.model fallback or opts.defaultModel from CLI).
  // Always-write rather than `cur.model ?? model` so a config change
  // (`capacity.models.dev` updated, manager restarted) propagates: the
  // first spawn after restart writes the fresh model rather than
  // permanently sticking to whatever was first persisted on disk.
  const next: ManagerState = {
    ...cur,
    roster,
    model,
  };
  writeManagerState(cacheDir, next);
}
