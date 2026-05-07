// Manager loop driver — mgr101 scaffold + mgr103 reconcile + mgr104 spawn.
//
// Public surface (pinned across mgr101–mgr104):
//   runManagerOnce(opts)      — single tick. Reads state + parses the three
//                                backlog files, runs reconcile() (mgr103),
//                                spawns at most one worker via spawnWorker
//                                (mgr104), writes manager.json +
//                                heartbeat.json, emits one stdout summary
//                                line. Returns TickResult.
//   runManagerLoop(opts)      — calls runManagerOnce at tickIntervalS
//                                cadence; AbortSignal aborts the sleep
//                                mid-tick; current tick drains; resolves
//                                cleanly.
//
// mgr105 adds the on('exit') handler with backoff + max-restarts gate.
// mgr106 hardens lock.ts with stale-PID detection + PID-recycling check.
//
// The summary-line format is locked from party-mode (PM lens, mgr101 AC #7):
// `tick <generation>: no work` | `tick <generation>: spawned <hash>` |
// `tick <generation>: maintained <hash> (pid <pid>)`. mgr101 shipped only
// the "no work" branch; mgr104 fills in spawned + maintained. The exact
// regex shape of all three branches is exported below as `TICK_SUMMARY_RE`
// so future stories must update one centralized regex if they touch the
// format — soft contract drift is the regression vector this guards
// against.
//
// **Backlog cwd separation.** The loop reads DEV.md / INTERVIEW.md /
// MANUAL.md from `opts.cwd` (default: `process.cwd()`). State files live
// under `opts.cacheDir` (default: `.devx-cache`). Tests pass an empty
// tmpdir as cwd to avoid reading the real project's backlog files.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseBacklogSnapshot } from "../backlog/parse.js";
import { enforceHardCap, reconcile } from "./reconcile.js";
import { type SpawnFn, spawnWorker } from "./spawn.js";
import {
  type Heartbeat,
  type ManagerState,
  type RosterEntry,
  type TickOutcome,
  nextGeneration,
  readManagerState,
  writeHeartbeat,
  writeManagerState,
} from "./state.js";

/**
 * Regex matching every valid per-tick stdout summary line (PM-lens AC #7).
 * Pinned here so future stories can't drift the wording without updating
 * this file. Anchors ^/$ exclude trailing newlines — callers writing via
 * `process.stdout.write(line + "\n")` should test with the line trimmed.
 *
 *   tick 1: no work
 *   tick 12: spawned a1b2c3
 *   tick 99: maintained a1b2c3 (pid 12345)
 */
export const TICK_SUMMARY_RE =
  /^tick (?<gen>\d+): (?:no work|spawned [0-9a-f]+|maintained [0-9a-f]+ \(pid \d+\))$/;

export interface RunManagerOnceOpts {
  /** Override `.devx-cache` root for tests. */
  cacheDir?: string;
  /** Working directory used to resolve DEV.md / INTERVIEW.md / MANUAL.md.
   *  Defaults to `process.cwd()`. Tests pass an empty tmpdir. */
  cwd?: string;
  /** Test seam: now() injection for deterministic timestamps. */
  now?: () => Date;
  /** Test seam: sink for the one-line summary. Defaults to process.stdout. */
  out?: (line: string) => void;
  /** Default worker model when state.model isn't set. Loop driver plumbs
   *  this from `devx.config.yaml → capacity.models.dev`. */
  model?: string;
  /** Override the `claude` executable path passed to spawnWorker. */
  claudeBin?: string;
  /** Override the worker log directory. Tests use a tmpdir. */
  workerLogDir?: string;
  /** Test seam — pass-through to spawnWorker. */
  spawnFn?: SpawnFn;
  /** Test seam — pass-through to spawnWorker (`onSpawn` for child capture). */
  onSpawn?: (child: import("node:child_process").ChildProcess) => void;
  /** Test seam — pass-through to spawnWorker (`detached` override). */
  spawnDetached?: boolean;
  /** Test seam — short-circuit the spawn step. Reconcile still runs. */
  disableSpawn?: boolean;
}

export interface TickResult {
  generation: number;
  outcome: TickOutcome;
  summary: string;
}

const TICKS_LOG_BOUND = 100;

export async function runManagerOnce(opts: RunManagerOnceOpts = {}): Promise<TickResult> {
  const cacheDir = opts.cacheDir ?? ".devx-cache";
  const cwd = opts.cwd ?? process.cwd();
  const nowFn = opts.now ?? (() => new Date());
  const out = opts.out ?? ((line: string) => process.stdout.write(line + "\n"));

  const prev = readManagerState(cacheDir);
  const generation = nextGeneration(prev);
  const ts = nowFn().toISOString();

  // mgr103: parse the three backlog files + reconcile against current state.
  // Missing files → empty content; reconcile yields zero desiredSpawns.
  const snapshot = parseBacklogSnapshot({
    devMd: readBacklogFile(cwd, "DEV.md"),
    interviewMd: readBacklogFile(cwd, "INTERVIEW.md"),
    manualMd: readBacklogFile(cwd, "MANUAL.md"),
  });
  const recon = reconcile(prev, snapshot, { defaultModel: opts.model });

  let outcome: TickOutcome = "no-work";
  let summary = `tick ${generation}: no work`;

  if (recon.desiredSpawns.length > 0 && !opts.disableSpawn) {
    const desired = recon.desiredSpawns[0]!;
    // Belt-and-suspenders cap check (AC #5). reconcile already enforces
    // this in mgr103 — the explicit check here ensures a programmatic
    // bypass throws BEFORE invoking child_process.spawn. Error message
    // is verbatim "Phase 1 hard cap: cannot spawn second worker
    // (running: <hash>)" per reconcile.ts:enforceHardCap.
    enforceHardCap(prev.roster, recon.desiredSpawns);

    await spawnWorker(desired.spec_hash, desired.model, {
      cacheDir,
      logDir: opts.workerLogDir,
      claudeBin: opts.claudeBin,
      now: opts.now,
      spawnFn: opts.spawnFn,
      onSpawn: opts.onSpawn,
      detached: opts.spawnDetached,
    });
    outcome = "spawned";
    summary = `tick ${generation}: spawned ${desired.spec_hash}`;
  } else if (livingRoster(prev.roster).length > 0) {
    // mgr101 shipped only "no work"; mgr104 adds the maintained branch.
    // We surface the FIRST living roster entry — hard cap = 1 keeps this
    // unambiguous. Phase 3 (epic-capacity-management) widens to N entries
    // and the format evolves at that boundary.
    const r = livingRoster(prev.roster)[0]!;
    outcome = "maintained";
    summary = `tick ${generation}: maintained ${r.spec_hash} (pid ${r.pid})`;
  }

  // Re-read state at the latest possible moment so the tick-write picks up
  // any roster mutation made by spawnWorker (registerRosterEntry) AND any
  // subsequent on-exit handler that fired during the await window. The
  // alternative — caching the post-spawn read in `workingState` and writing
  // its `roster` back — has been the regression vector identified in
  // adversarial review (Blind Hunter F1 / Edge Case Hunter F1): a fast
  // exiting child can land its on-exit write between the cache and the
  // tick-write, and the cached roster then resurrects the dead PID.
  // Reading freshly here narrows the race window to microseconds (still
  // present until mgr106's lock; mgr105's PID-existence sweep mops up).
  const fresh = readManagerState(cacheDir);
  const ticks = [...(fresh.ticks ?? []), { generation, ts, outcome }];
  const trimmedTicks = ticks.slice(-TICKS_LOG_BOUND);
  const next: ManagerState = {
    generation,
    started_at: fresh.started_at ?? ts,
    last_tick_at: ts,
    ticks: trimmedTicks,
    roster: fresh.roster ?? [],
    lock: fresh.lock,
  };
  // Preserve model field from fresh state (set by spawnWorker on first
  // spawn) or fall back to opts.model (so a fresh state with a configured
  // model gets persisted). Skip when neither is set — keeps fresh state
  // schema clean.
  if (fresh.model !== undefined) next.model = fresh.model;
  else if (opts.model !== undefined) next.model = opts.model;

  writeManagerState(cacheDir, next);

  const heartbeat: Heartbeat = { ts, pid: process.pid, generation };
  writeHeartbeat(cacheDir, heartbeat);

  out(summary);

  return { generation, outcome, summary };
}

export interface RunManagerLoopOpts extends RunManagerOnceOpts {
  /** Tick interval in seconds. */
  tickIntervalS: number;
  /** AbortSignal that triggers a clean drain + return. */
  signal: AbortSignal;
}

export async function runManagerLoop(opts: RunManagerLoopOpts): Promise<void> {
  // Reject obviously-wrong tickIntervalS values that would either spin the
  // CPU (≤ 0, NaN) or silently misinterpret a millisecond value as seconds
  // (`tickIntervalS = 60_000` would sleep 16+ hours). Programmatic callers
  // are the audience here — `readTickIntervalS()` in commands/manage.ts
  // already pre-filters CLI input.
  if (
    typeof opts.tickIntervalS !== "number" ||
    !Number.isFinite(opts.tickIntervalS) ||
    opts.tickIntervalS <= 0
  ) {
    throw new Error(
      `runManagerLoop: tickIntervalS must be a positive finite number (seconds); got ${String(opts.tickIntervalS)}`,
    );
  }
  if (opts.tickIntervalS > 86400) {
    // 24h sanity ceiling — anyone passing a value this large probably meant
    // milliseconds. Better to fail fast than to sleep for a day.
    throw new Error(
      `runManagerLoop: tickIntervalS=${opts.tickIntervalS}s exceeds 24h ceiling — did you mean milliseconds?`,
    );
  }
  while (!opts.signal.aborted) {
    await runManagerOnce({
      cacheDir: opts.cacheDir,
      cwd: opts.cwd,
      now: opts.now,
      out: opts.out,
      model: opts.model,
      claudeBin: opts.claudeBin,
      workerLogDir: opts.workerLogDir,
      spawnFn: opts.spawnFn,
      onSpawn: opts.onSpawn,
      spawnDetached: opts.spawnDetached,
      disableSpawn: opts.disableSpawn,
    });
    if (opts.signal.aborted) return;
    await sleepInterruptible(opts.tickIntervalS * 1000, opts.signal);
  }
}

function sleepInterruptible(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let timer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort);
  });
}

function readBacklogFile(cwd: string, name: string): string {
  try {
    return readFileSync(join(cwd, name), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "";
    throw err;
  }
}

// Filter out any roster entry the loop should treat as "not currently
// running" for summary purposes. Phase 1 has no PID-existence check
// (mgr106 adds it), so this currently passes everything through. Kept as
// a named hook so mgr106's sweep wires here without touching the summary
// branching logic.
function livingRoster(roster: RosterEntry[] | undefined): RosterEntry[] {
  return roster ?? [];
}
