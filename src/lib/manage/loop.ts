// Manager loop driver — mgr101 minimal scaffold.
//
// Public surface (pinned by this story):
//   runManagerOnce(opts)      — single tick. Reads state, "reconciles"
//                                (placeholder, mgr103 fills in), writes
//                                manager.json + heartbeat.json, emits one
//                                stdout summary line. Returns TickResult.
//   runManagerLoop(opts)      — calls runManagerOnce at tickIntervalS
//                                cadence; AbortSignal aborts the sleep
//                                mid-tick; current tick drains; resolves
//                                cleanly.
//
// mgr102 will replace state IO atomicity hardening + bounded ticks log.
// mgr103 fills in reconcile() — desiredSpawns / desiredKills /
// statusLogUpdates from current state + DEV.md.
// mgr104 wires spawn() — child_process.spawn('claude', ['/devx', hash], …).
// mgr105 adds the on('exit') handler with backoff + max-restarts gate.
// mgr106 hardens lock.ts with stale-PID detection + PID-recycling check.
//
// The summary-line format is locked from party-mode (PM lens, mgr101 AC #7):
// `tick <generation>: no work` | `tick <generation>: spawned <hash>` |
// `tick <generation>: maintained <hash> (pid <pid>)`. mgr101 ships only the
// "no work" branch; the others land with mgr103/104. The exact regex shape
// of all three branches is exported below as `TICK_SUMMARY_RE` so mgr103/104
// must update one centralized regex if they touch the format — soft
// contract drift is the regression vector this guards against.

import {
  type Heartbeat,
  type ManagerState,
  type TickOutcome,
  nextGeneration,
  readManagerState,
  writeHeartbeat,
  writeManagerState,
} from "./state.js";

/**
 * Regex matching every valid per-tick stdout summary line (PM-lens AC #7).
 * Pinned here so mgr103/104 can't drift the wording without updating this
 * file. Anchors ^/$ exclude trailing newlines — callers writing via
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
  /** Test seam: now() injection for deterministic timestamps. */
  now?: () => Date;
  /** Test seam: sink for the one-line summary. Defaults to process.stdout. */
  out?: (line: string) => void;
}

export interface TickResult {
  generation: number;
  outcome: TickOutcome;
  summary: string;
}

const TICKS_LOG_BOUND = 100;

export async function runManagerOnce(opts: RunManagerOnceOpts = {}): Promise<TickResult> {
  const cacheDir = opts.cacheDir ?? ".devx-cache";
  const nowFn = opts.now ?? (() => new Date());
  const out = opts.out ?? ((line: string) => process.stdout.write(line + "\n"));

  const prev = readManagerState(cacheDir);
  const generation = nextGeneration(prev);
  const ts = nowFn().toISOString();

  // mgr101: no reconcile, no spawn — always "no work". mgr103/104 replace.
  const outcome: TickOutcome = "no-work";
  const summary = `tick ${generation}: no work`;

  const ticks = [...(prev.ticks ?? []), { generation, ts, outcome }];
  const trimmedTicks = ticks.slice(-TICKS_LOG_BOUND);
  const next: ManagerState = {
    generation,
    started_at: prev.started_at ?? ts,
    last_tick_at: ts,
    ticks: trimmedTicks,
    roster: prev.roster ?? [],
    lock: prev.lock,
  };
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
      now: opts.now,
      out: opts.out,
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
