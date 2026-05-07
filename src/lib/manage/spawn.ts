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
  type CrashRecord,
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

  // mgr105 — on-exit handler does three things in one atomic state write:
  //   1. clears the roster slot for this PID (mgr104 baseline);
  //   2. on success (`code === 0`), clears any prior crash record for this
  //      spec_hash — a green run resets the backoff counter (Technical
  //      notes on the spec: "crash_count resets on a successful run");
  //   3. on failure (non-zero `code` OR signal-terminated), increments the
  //      crash record's `crash_count`, sets `last_exit_at` to nowFn(), and
  //      stores `last_exit_code` (number for plain exits, `signal:<NAME>`
  //      string for signal-terminated children).
  //
  // Errors are swallowed (best-effort) because the handler runs after a
  // potentially-crashed child — we don't want to crash the manager on a
  // state-file IO blip that the next tick will reconcile anyway.
  //
  // The `handled` once-flag de-duplicates between `'exit'` and `'error'`:
  // Node may fire both for the same failure (most commonly when the
  // executable resolves but exec(2) fails — `'error'` then `'exit'` with
  // null code + null signal). Without the flag, we'd double-increment
  // crash_count. EC-M12 fix.
  let handled = false;
  const handleExit = (
    code: number | string | null,
    signal: NodeJS.Signals | null,
  ): void => {
    if (handled) return;
    handled = true;
    try {
      applyExitToState(cacheDir, hash, code, signal, nowFn);
    } catch {
      // best-effort
    }
  };
  child.on("exit", (code, signal) => handleExit(code, signal));
  // 'error' fires when the spawn fails async (executable not found post-
  // fork, EACCES on the binary, etc.). Without a listener, Node treats
  // unhandled 'error' as a fatal exception in the parent — crashing the
  // manager. We synthesize a `-1` exit so the slot is cleared and a
  // crashes record is upserted; the next tick respects backoff like any
  // other crash.
  child.on("error", () => handleExit(-1, null));

  if (opts.onSpawn) opts.onSpawn(child);

  return { pid: myPid };
}

// ---------------------------------------------------------------------------
// Public helpers (consumed by loop.ts mgr105 PID-recovery sweep)
// ---------------------------------------------------------------------------

/**
 * Apply a worker exit (real or synthetic) to manager state in one atomic
 * write. Pure of fork/spawn — only state-file IO. The PID-recovery sweep in
 * `loop.ts` calls this with a synthetic `code === "manager-restart-detected"`
 * for roster slots whose PIDs are no longer alive (lost-exit recovery).
 *
 * Behavior:
 *   - Roster: drop every entry matching `spec_hash` (clears the slot
 *     unconditionally — same on success or crash).
 *   - Success path (`code === 0`, no signal): drop the crashes-record entry
 *     for `spec_hash` if any. Resets backoff for future runs.
 *   - Crash path (non-zero code OR signal OR string-coded synthetic exit):
 *     upsert the crashes-record entry — increment crash_count, set
 *     last_exit_at = nowFn(), set last_exit_code (number for code, signal
 *     `signal:<NAME>` for signal-only, string verbatim for synthetic).
 */
export function applyExitToState(
  cacheDir: string,
  spec_hash: string,
  code: number | string | null,
  signal: NodeJS.Signals | null,
  now: () => Date,
): void {
  const cur = readManagerState(cacheDir);
  const nextRoster = cur.roster.filter((r) => r.spec_hash !== spec_hash);
  const exitCode = computeExitCode(code, signal);
  const isSuccess = exitCode === 0;
  const prevCrashes = cur.crashes ?? [];
  let nextCrashes: CrashRecord[];
  if (isSuccess) {
    nextCrashes = prevCrashes.filter((c) => c.spec_hash !== spec_hash);
  } else {
    const others = prevCrashes.filter((c) => c.spec_hash !== spec_hash);
    const prior = prevCrashes.find((c) => c.spec_hash === spec_hash);
    const updated: CrashRecord = {
      spec_hash,
      crash_count: (prior?.crash_count ?? 0) + 1,
      last_exit_at: now().toISOString(),
      last_exit_code: exitCode,
    };
    nextCrashes = [...others, updated];
  }
  const next: ManagerState = { ...cur, roster: nextRoster };
  if (nextCrashes.length > 0) next.crashes = nextCrashes;
  else delete next.crashes;
  writeManagerState(cacheDir, next);
}

/**
 * Translate Node's child-exit `(code, signal)` pair into the value stored on
 * `CrashRecord.last_exit_code`. Synthetic string codes from the PID-recovery
 * sweep (e.g. `"manager-restart-detected"`) pass through verbatim.
 *
 * Order matters (BH-L12 defensive ordering): if Node ever surfaces both a
 * `code === 0` AND a signal (rare but observed across some Node patches),
 * we want the signal to dominate — a SIGKILL'd child with code=0 should
 * NOT clear the crashes record via the success path. By probing string-
 * code → signal → number-code → fallback, we make the signal-terminated
 * case observable as a crash even when the kernel reports code=0.
 */
function computeExitCode(
  code: number | string | null,
  signal: NodeJS.Signals | null,
): number | string {
  if (typeof code === "string" && code.length > 0) return code;
  if (signal) return `signal:${signal}`;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  // Both null and signal absent — defensive default. Treat as crash so the
  // backoff path fires; Node's docs guarantee at least one of code/signal,
  // so this is unreachable in practice.
  return -1;
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
