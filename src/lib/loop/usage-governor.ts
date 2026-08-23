// Usage-window governor (uwg102 / c8e2d4) — the pause itself.
//
// `planPause` is PURE and holds every bound, so all of E-3/E-5/E-6 is
// testable without a clock and without sleeping. `runPause` is the only part
// that touches time, and it sleeps in chunks.
//
// WHY CHUNKED, specifically. `project_devx_loop_sleep_kills_iterations`
// records that machine sleep has killed whole loop runs on this box. A
// single `await sleep(fiveHours)` cannot notice that four of those hours
// were spent suspended — it wakes when the timer says so, which after a
// suspend is the wrong instant. Re-reading the wall clock on every chunk
// makes the pause self-correcting for free, the same way dc7514 made the
// iteration ceiling sleep-aware.
//
// Spec: dev/dev-uwg102-2026-08-21T14:30-uwg102.md
// Design: _devx/workstreams/usage-window-governor/design/agent.md § Architecture 2
// Decision: decisions/D-UW1-pre-ladder-interception.md

import type { UsageWindowHit } from "./usage-window.js";

/** The four `loop:` knobs this needs. Narrowed to exactly what is read, so a
 *  caller cannot accidentally depend on the whole loop config here. */
export interface UsageGovernorConfig {
  /** Kill switch. `false` reproduces pre-governor behavior exactly — and it
   *  is checked by the CALLER, before any of this module runs, so "identical
   *  to today" is structural rather than a thing to verify. */
  resumeOnReset: boolean;
  /** Probe cadence when no reset time could be parsed. */
  usageProbeIntervalMs: number;
  /** Cumulative pause after which the run aborts rather than holding the
   *  machine — the "this is the weekly limit, not the 5-hour window" rail. */
  usageMaxPauseMs: number;
  /** Slack added after a parsed reset, so we do not wake one second early
   *  and bounce straight off the wall again. */
  usageResetSlackMs: number;
}

export interface PauseContext {
  now: Date;
  /** How long this RUN has already spent paused, across all segments. The
   *  cap is cumulative, not per-pause: five 90-minute pauses is a night
   *  spent asleep, whatever the individual segments looked like. */
  elapsedPausedMs: number;
  /** The `--until` deadline, or null when the run is unbounded. */
  deadline: Date | null;
}

export type PausePlan =
  /** Sleep until `wakeAt`, then resume the same item. */
  | { kind: "sleep"; wakeAt: Date; source: "parsed" }
  /** No usable reset time: re-probe every `intervalMs` until one succeeds. */
  | { kind: "probe"; intervalMs: number; wakeAt: Date; source: "probe" }
  /** The `--until` deadline lands before the reset would. */
  | { kind: "deadline"; reason: string }
  /** Cumulative pause has exceeded the cap. */
  | { kind: "abort"; reason: string };

/**
 * Decide what a usage-window hit should do. Pure.
 *
 * ORDER MATTERS and is not arbitrary:
 *
 *   1. **cap first** — a run that has already spent its whole pause budget
 *      must abort even if this particular reset looks close, because the
 *      cap is what distinguishes "the 5-hour window" from "the weekly
 *      limit", and the weekly limit is not something to wait out.
 *   2. **deadline second** — the loop must never hold a machine past the
 *      hour its operator named. A reset after the deadline is not a pause,
 *      it is the end of the run.
 *   3. then sleep-to-reset, or probe.
 */
export function planPause(
  hit: Pick<UsageWindowHit, "resetAt" | "source">,
  cfg: UsageGovernorConfig,
  ctx: PauseContext,
): PausePlan {
  if (!cfg.resumeOnReset) {
    // The caller is supposed to short-circuit before reaching here. Throwing
    // rather than quietly returning a plan makes a mis-wired kill switch a
    // loud test failure instead of a silent pause on a run that asked for
    // today's behavior.
    throw new Error(
      "planPause called with resume_on_reset disabled — the kill switch must " +
        "short-circuit at the driver seam, before any governor code runs",
    );
  }

  if (ctx.elapsedPausedMs > cfg.usageMaxPauseMs) {
    return {
      kind: "abort",
      reason:
        `usage-window pauses have totalled ${Math.round(ctx.elapsedPausedMs / 60_000)}min, ` +
        `past the ${Math.round(cfg.usageMaxPauseMs / 60_000)}min cap — this reads as a WEEKLY ` +
        `limit rather than the 5-hour window, and waiting it out would hold the machine for days`,
    };
  }

  const wakeAt =
    hit.resetAt !== null
      ? new Date(hit.resetAt.getTime() + cfg.usageResetSlackMs)
      : new Date(ctx.now.getTime() + cfg.usageProbeIntervalMs);

  if (ctx.deadline !== null && wakeAt.getTime() > ctx.deadline.getTime()) {
    return {
      kind: "deadline",
      reason:
        `the usage window reopens at ${wakeAt.toISOString()}, after the --until deadline ` +
        `${ctx.deadline.toISOString()} — exiting via the deadline path rather than holding the machine`,
    };
  }

  if (hit.resetAt !== null) {
    return { kind: "sleep", wakeAt, source: "parsed" };
  }
  return {
    kind: "probe",
    intervalMs: cfg.usageProbeIntervalMs,
    wakeAt,
    source: "probe",
  };
}

/** How long a single sleep chunk runs. Short enough that a machine suspend
 *  is noticed promptly on wake; long enough that a five-hour pause is not
 *  thousands of timer wakeups. */
export const PAUSE_CHUNK_MS = 60_000;

export interface RunPauseDeps {
  now: () => Date;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  /** Called once per chunk — the loop's heartbeat, so a paused run keeps
   *  reading ALIVE rather than crashed (uwg103 wires the `paused` status). */
  beat?: (elapsedMs: number) => void;
  /** Probe for "is the window open again?" when no reset time was parsed.
   *  Returning true resumes early. Defaults to never — the cadence alone
   *  then governs, which is the honest v1 behavior until a real probe
   *  exists (FR-7/FR-8). */
  probe?: () => Promise<boolean>;
}

export interface PauseResult {
  kind: "resumed" | "deadline" | "abort" | "aborted-by-signal";
  /** Wall-clock ms actually spent paused — measured, not planned, so a
   *  machine suspend during the pause is reflected honestly in the summary. */
  durationMs: number;
  reason?: string;
}

/**
 * Execute a pause plan.
 *
 * Sleeps in `PAUSE_CHUNK_MS` slices, re-reading the wall clock each time.
 * The loop condition is `now < wakeAt`, NOT "have I slept the planned
 * total" — after a machine suspend those two disagree, and only the first
 * one is right.
 */
export async function runPause(
  plan: PausePlan,
  deps: RunPauseDeps,
): Promise<PauseResult> {
  const startedAt = deps.now().getTime();
  const elapsed = (): number => deps.now().getTime() - startedAt;

  if (plan.kind === "deadline" || plan.kind === "abort") {
    return { kind: plan.kind, durationMs: 0, reason: plan.reason };
  }

  const target = plan.wakeAt.getTime();
  while (deps.now().getTime() < target) {
    if (deps.signal?.aborted === true) {
      return { kind: "aborted-by-signal", durationMs: elapsed() };
    }
    const remaining = target - deps.now().getTime();
    await deps.sleep(Math.min(PAUSE_CHUNK_MS, remaining), deps.signal);
    deps.beat?.(elapsed());

    // Probe path: a successful probe resumes early. On the parsed path there
    // is nothing to ask — the reset time IS the answer.
    if (plan.kind === "probe" && deps.probe !== undefined) {
      if (await deps.probe()) return { kind: "resumed", durationMs: elapsed() };
    }
  }

  return { kind: "resumed", durationMs: elapsed() };
}
