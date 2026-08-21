// RED artifact — usage-window governor (c8e2d4, E-1 … E-6).
//
// Authored at the RED stage, BEFORE any implementation. Every test here must
// fail for the stated reason — "the module does not exist" / "the driver
// does not pause" — and not because the harness is broken. A RED that fails
// for the wrong reason is worse than no RED: three wrong-reason shapes are
// already on record in `LEARN.md § Cross-epic patterns`.
//
// What is being pinned, and why each matters:
//
//   E-1 (P0) A window hit pauses, the SAME item resumes, and every counter
//            stays put. This is the whole point: today a usage limit rides
//            the hard-error ladder, burns consecutiveFailures, abandons the
//            item after 3 strikes and kills the run after 3 abandons —
//            hours of walltime lost to weather.
//   E-2 (P0) A transcript that merely MENTIONS a usage-limit string and
//            ends with a valid report is a SUCCESS, not a pause. This one
//            fires whenever someone edits the governor's own source, so it
//            is not hypothetical.
//   E-3      No parseable reset → probe cadence, bounded by max-pause, with
//            a clean weekly-limit abort rather than holding the machine.
//   E-4      A paused loop reads ALIVE. Reporting it crashed is how a human
//            kills a run that was working.
//   E-5      The kill switch reproduces today's behavior exactly.
//   E-6      `--until` clamps a pause that would outlive the deadline. The
//            loop must never hold a machine past the hour its operator
//            named.
//
// Spec: plan/plan-c8e2d4-2026-07-14T10:41-usage-window-governor.md
// Design: _devx/workstreams/usage-window-governor/design.md (D-UW1)

import { describe, expect, it } from "vitest";

// These modules do not exist yet. The import failure IS the RED signal for
// the detection half, and it names the missing artifact.
import {
  USAGE_LIMIT_MARKERS,
  detectUsageWindowHit,
  firstUsageMarkerInTail,
  parseResetTime,
} from "../src/lib/loop/usage-window.js";
import { planPause, runPause } from "../src/lib/loop/usage-governor.js";

const NOW = new Date("2026-08-21T01:00:00.000Z");
const RESET = new Date("2026-08-21T06:00:00.000Z");

/** A worker transcript whose TAIL carries a usage-limit marker and which
 *  produced no valid trailing report — the corroborated shape. */
function limitTail(suffix = ""): string {
  return [
    "…implementing the thing…",
    `Claude AI usage limit reached${suffix}`,
    "",
  ].join("\n");
}

/** A transcript that MENTIONS the marker mid-stream (e.g. while editing the
 *  governor's own source) and then ends with a valid report envelope. */
function mentionsButSucceeds(): string {
  return [
    "editing src/lib/loop/usage-window.ts",
    "  + /claude ai usage limit reached/i,",
    "…900 more lines…",
    JSON.stringify({ success: true, key_learnings: ["did the thing"] }),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// E-2 (P0) — the false-positive guard. Detector-only, so it lands in Phase 1.
// ---------------------------------------------------------------------------

describe("E-2 (P0): a mid-transcript marker with a valid trailing report is NOT a pause", () => {
  it("classifies by the report, not by the mention", () => {
    const hit = detectUsageWindowHit({
      rawOutput: mentionsButSucceeds(),
      report: { success: true, key_learnings: ["did the thing"] },
      exitCode: 0,
    });
    expect(hit).toBeNull();
  });

  it("only scans the TAIL — a marker outside it is invisible", () => {
    const buried = `Claude AI usage limit reached\n${"x".repeat(50_000)}\n`;
    expect(firstUsageMarkerInTail(buried, 4_000)).toBeNull();
  });

  it("requires corroboration: a tail marker WITH a valid report is still not a hit", () => {
    // The marker being in the tail is necessary but not sufficient. This is
    // the same rule `driver.ts` applies to permanent errors, and it is what
    // makes the marker set safe to widen later.
    const hit = detectUsageWindowHit({
      rawOutput: limitTail(),
      report: { success: true, key_learnings: [] },
      exitCode: 0,
    });
    expect(hit).toBeNull();
  });

  it("IS a hit when the tail marker is corroborated by a missing report — and the PAYLOAD is right", () => {
    // The first cut asserted only `not.toBeNull()` AND used a stale 2025
    // epoch, so `source` was always "probe": nothing in the suite ever
    // observed a parsed reset, and deleting the parse call entirely kept
    // every test green (review EC-LOW-7 / F3). Assert the whole payload.
    const epoch = Math.floor(RESET.getTime() / 1000);
    const hit = detectUsageWindowHit({
      rawOutput: limitTail(`|${epoch}`),
      exitCode: 1,
      now: NOW,
    });
    expect(hit).toEqual({
      resetAt: RESET,
      source: "parsed",
      matched: "Claude AI usage limit reached",
    });
  });

  it("a report claiming SUCCESS clears the hit; nothing else does", () => {
    // The corroboration rule, as a truth table. It changed under review in
    // BOTH directions: `exitCode` used to override a valid report (stricter
    // than the driver's own `classifyIteration`, so the governor could pause
    // an iteration the driver calls healthy), while `report.success === false`
    // was ignored (so a reported failure naming a real limit rode the
    // reported-failure ladder — E-1's exact failure mode).
    const raw = limitTail("|1900000000");
    const hit = (report: unknown, exitCode: number | null | undefined) =>
      detectUsageWindowHit({
        rawOutput: raw,
        report: report as never,
        exitCode,
        now: NOW,
      }) !== null;

    // success clears, whatever the exit code says
    expect(hit({ success: true, key_learnings: [] }, 0)).toBe(false);
    expect(hit({ success: true, key_learnings: [] }, 1)).toBe(false);
    expect(hit({ success: true, key_learnings: [] }, null)).toBe(false);
    // everything else corroborates
    expect(hit({ success: false, key_learnings: [] }, 0)).toBe(true);
    expect(hit(undefined, 0)).toBe(true);
    expect(hit(null, 0)).toBe(true);
    expect(hit({ malformed: true }, 0)).toBe(true);
  });

  it("a devx SPEC FILENAME 20KB back does not become the reset time", () => {
    // The HIGH, found independently by all three reviewers. A devx spec path
    // IS an ISO-8601 timestamp: `dev-uwg101-2026-08-21T14:30-uwg101.md`. The
    // parse used to run over the whole transcript, so a worker that edited
    // any spec file and then hit the wall paused until a FILENAME — reported
    // as `parsed` (precise) rather than `probe`.
    const poisoned =
      "Read dev/dev-uwg101-2026-08-21T14:30-uwg101.md\n" +
      "x".repeat(20_000) +
      "\nClaude AI usage limit reached — resets 6am\n";
    const hit = detectUsageWindowHit({ rawOutput: poisoned, now: NOW });
    expect(hit?.source).toBe("parsed");
    // 6am LOCAL, from "resets 6am" — the wall-clock form is local by design,
    // which is exactly why a bare ISO string (parsed as local) was such a
    // dangerous thing to be scraping out of arbitrary transcript text.
    expect(hit?.resetAt?.getHours()).toBe(6);
    expect(hit?.resetAt?.getMinutes()).toBe(0);
    // And emphatically NOT 14:30, the filename's timestamp.
    expect(hit?.resetAt?.getHours()).not.toBe(14);
  });

  it("never throws on non-string input — it runs on every iteration", () => {
    expect(detectUsageWindowHit({ rawOutput: undefined as never })).toBeNull();
    expect(detectUsageWindowHit({ rawOutput: null as never })).toBeNull();
  });

  it("tailChars of 0 scans NOTHING — `slice(-0)` is the whole string", () => {
    // The natural config spelling for "disable" would have maximised the
    // false-positive surface instead of eliminating it.
    const buried = `Claude AI usage limit reached${"x".repeat(9_000)}`;
    expect(firstUsageMarkerInTail(buried, 0)).toBeNull();
    expect(firstUsageMarkerInTail(buried, -5)).toBeNull();
  });

  it("ships a non-empty marker set", () => {
    expect(USAGE_LIMIT_MARKERS.length).toBeGreaterThan(0);
    expect(USAGE_LIMIT_MARKERS.every((r) => r instanceof RegExp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reset parsing — FR-2, feeding E-1 and E-3.
// ---------------------------------------------------------------------------

describe("parseResetTime — three shapes, and a past time is NOT a reset", () => {
  it("parses the unix-epoch suffix form", () => {
    const epoch = Math.floor(RESET.getTime() / 1000);
    expect(parseResetTime(`usage limit reached|${epoch}`, NOW)?.toISOString()).toBe(
      RESET.toISOString(),
    );
  });

  it("parses the ISO form", () => {
    expect(
      parseResetTime(`usage limit reached, resets ${RESET.toISOString()}`, NOW)?.toISOString(),
    ).toBe(RESET.toISOString());
  });

  it("parses the wall-clock next-occurrence form — with the actual HOUR pinned", () => {
    // Asserting only `> NOW` left a mutation that always added 12 (6am → 6pm)
    // passing (review EC-LOW-8). Pin the local hour, and the next-occurrence
    // rule separately.
    const got = parseResetTime("usage limit reached — resets 6am", NOW);
    expect(got).not.toBeNull();
    expect(got!.getHours()).toBe(6);
    expect(got!.getMinutes()).toBe(0);

    // NEXT occurrence: said AT 6am local, it means tomorrow's 6am.
    const at6 = new Date(NOW);
    at6.setHours(6, 0, 0, 0);
    const tomorrow = parseResetTime("resets 6am", at6);
    expect(tomorrow!.getDate()).toBe(new Date(at6.getTime() + 86_400_000).getDate());
    expect(tomorrow!.getHours()).toBe(6);

    // 12am/12pm are the classic off-by-twelve.
    expect(parseResetTime("resets 12am", NOW)!.getHours()).toBe(0);
    expect(parseResetTime("resets 12pm", NOW)!.getHours()).toBe(12);
  });

  it("falls THROUGH a stale shape to a usable later one", () => {
    // Each branch used to return unconditionally, so one past epoch anywhere
    // discarded a perfectly good wall-clock reset sitting right after it.
    const got = parseResetTime("prev|1600000000 … usage limit reached, resets 6am", NOW);
    expect(got).not.toBeNull();
    expect(got!.getHours()).toBe(6);
  });

  it("matches an en-dash separator, not only the em-dash", () => {
    expect(parseResetTime("usage limit reached – resets 6am", NOW)!.getHours()).toBe(6);
  });

  it("returns null for a PAST timestamp — a stale reset must not spin a zero-length pause", () => {
    const past = Math.floor(new Date("2026-08-20T06:00:00.000Z").getTime() / 1000);
    expect(parseResetTime(`usage limit reached|${past}`, NOW)).toBeNull();
  });

  it("returns null when there is nothing to parse", () => {
    expect(parseResetTime("usage limit reached", NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// planPause — every bound is pure, so the bounds are testable without a clock.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// E-1 (P0) and E-4 — driver-level. These need the Phase 2/3 seams and are
// authored here so Phase 2 has a RED to drive against.
// ---------------------------------------------------------------------------

const CFG = {
  resumeOnReset: true,
  usageProbeIntervalMs: 900_000,
  usageMaxPauseMs: 21_600_000,
  usageResetSlackMs: 60_000,
};

describe("planPause — bounds (E-3, E-6)", () => {
  it("wakes at reset + slack when the reset is parseable", () => {
    const plan = planPause(
      { resetAt: RESET, source: "parsed" },
      CFG,
      { now: NOW, elapsedPausedMs: 0, deadline: null },
    );
    // Narrowed rather than optional-chained: `plan.wakeAt?` on a union
    // would silently pass if the plan were a `deadline` (no wakeAt at all).
    expect(plan.kind).toBe("sleep");
    if (plan.kind !== "sleep") throw new Error(`expected sleep, got ${plan.kind}`);
    expect(plan.wakeAt.getTime()).toBe(RESET.getTime() + CFG.usageResetSlackMs);
    expect(plan.source).toBe("parsed");
  });

  it("E-3: falls back to the probe cadence when the reset is unknown", () => {
    const plan = planPause(
      { resetAt: null, source: "probe" },
      CFG,
      { now: NOW, elapsedPausedMs: 0, deadline: null },
    );
    expect(plan.kind).toBe("probe");
    if (plan.kind !== "probe") throw new Error(`expected probe, got ${plan.kind}`);
    expect(plan.intervalMs).toBe(CFG.usageProbeIntervalMs);
    expect(plan.source).toBe("probe");
  });

  it("E-3: aborts with the weekly-limit reason once cumulative pause exceeds the cap", () => {
    const plan = planPause(
      { resetAt: null, source: "probe" },
      CFG,
      { now: NOW, elapsedPausedMs: CFG.usageMaxPauseMs + 1, deadline: null },
    );
    expect(plan.kind).toBe("abort");
    if (plan.kind !== "abort") throw new Error(`expected abort, got ${plan.kind}`);
    expect(plan.reason).toMatch(/weekly/i);
  });

  it("E-6: a reset landing after --until takes the deadline path, not a pause", () => {
    const deadline = new Date(RESET.getTime() - 60 * 60 * 1000); // an hour before reset
    const plan = planPause(
      { resetAt: RESET, source: "parsed" },
      CFG,
      { now: NOW, elapsedPausedMs: 0, deadline },
    );
    // The loop must never hold a machine past the hour its operator named.
    expect(plan.kind).toBe("deadline");
  });

  it("E-5: the kill switch means planPause is never consulted at all", () => {
    // Asserted here as a contract statement; the driver-side proof is in the
    // Phase 2 seam test. `resumeOnReset:false` short-circuits BEFORE any
    // governor code runs, so "byte-identical to today" is structural.
    expect(() =>
      planPause({ resetAt: RESET, source: "parsed" }, { ...CFG, resumeOnReset: false }, {
        now: NOW,
        elapsedPausedMs: 0,
        deadline: null,
      }),
    ).toThrow(/kill switch|resume_on_reset/i);
  });
});

describe("E-1 (P0): a window hit pauses, the same item resumes, counters stay put", () => {
  it.todo(
    "fake worker emits a limit marker with a parseable reset on the initial attempt AND the retry; " +
      "after the fake clock passes reset the SAME item hash resumes; " +
      "consecutiveFailures == consecutiveErrors == consecutiveAbandonedItems == 0; " +
      "no [FAIL]/[ERROR] status-log lines; windowPauses.length == 1 with durationMs > 0; " +
      "the morning report carries a 'Usage-window pauses' section; loop exits 0",
  );

  it.todo(
    "the interrupted iteration is NOT charged against maxIterationsPerItem, " +
      "and pendingRepair survives the pause",
  );

  it.todo(
    "ladder.ts has zero diff: nextLadderState is never called for a window hit " +
      "(D-UW1 — a rung that moves nothing is a bypass wearing a rung's costume)",
  );
});

describe("E-4: a paused loop reads ALIVE, never crashed", () => {
  it.todo(
    "gather returns live == true for a paused heartbeat aged < 3x the heartbeat interval, " +
      "and live == false once aged beyond it — paused-and-stale still reads dead",
  );

  it.todo("exactly one loop:usage-pause event in events.jsonl per pause segment");
});

describe("E-5: the kill switch restores today's behavior", () => {
  it.todo(
    "with loop.resume_on_reset:false the decision sequence is identical to a pre-governor run " +
      "on the same script (backoff sleeps from loop.backoff_ms, counters move as today); " +
      "windowPauses.length == 0",
  );
});

// ---------------------------------------------------------------------------
// runPause — the chunked sleep. Fake clock + fake sleep, so this is fast and
// deterministic; the point is the wall-clock re-read, not the waiting.
// ---------------------------------------------------------------------------

describe("runPause — chunked, wall-clock-driven, sleep-aware", () => {
  /** A fake clock the test advances explicitly. `sleep(ms)` advances it by
   *  `ms` unless a scenario says otherwise — which is how machine suspend is
   *  simulated below. */
  function fakeTime(start: Date) {
    let t = start.getTime();
    const slept: number[] = [];
    return {
      slept,
      now: () => new Date(t),
      advance: (ms: number) => {
        t += ms;
      },
      sleep: async (ms: number) => {
        slept.push(ms);
        t += ms;
      },
    };
  }

  const START = new Date("2026-08-21T01:00:00.000Z");

  it("sleeps in chunks rather than one long sleep", async () => {
    const clock = fakeTime(START);
    const res = await runPause(
      { kind: "sleep", wakeAt: new Date(START.getTime() + 5 * 60_000), source: "parsed" },
      { now: clock.now, sleep: clock.sleep },
    );
    expect(res.kind).toBe("resumed");
    // 5 minutes at a 60s chunk = 5 sleeps, not 1 × 300_000.
    expect(clock.slept).toEqual([60_000, 60_000, 60_000, 60_000, 60_000]);
    expect(res.durationMs).toBe(5 * 60_000);
  });

  it("SELF-CORRECTS after a machine suspend — the wall clock decides, not the sleep total", async () => {
    // The whole reason for chunking. `project_devx_loop_sleep_kills_iterations`
    // records that machine sleep has killed loop runs here. A single long
    // sleep wakes when its timer says so, which after a suspend is the wrong
    // instant; re-reading the clock each chunk means a suspend that jumps
    // past the wake time ends the pause immediately.
    const clock = fakeTime(START);
    const wakeAt = new Date(START.getTime() + 5 * 60 * 60_000); // 5 hours out
    let first = true;
    const res = await runPause(
      { kind: "sleep", wakeAt, source: "parsed" },
      {
        now: clock.now,
        sleep: async (ms) => {
          clock.slept.push(ms);
          // First chunk: the machine suspends for 6 hours instead of 1 min.
          clock.advance(first ? 6 * 60 * 60_000 : ms);
          first = false;
        },
      },
    );
    expect(res.kind).toBe("resumed");
    // ONE chunk. It woke up, saw the clock was past the target, and stopped —
    // it did not go on to sleep the remaining 299 planned minutes.
    expect(clock.slept).toHaveLength(1);
    expect(res.durationMs).toBe(6 * 60 * 60_000);
  });

  it("beats the heartbeat every chunk, so a paused loop can read ALIVE", async () => {
    const clock = fakeTime(START);
    const beats: number[] = [];
    await runPause(
      { kind: "sleep", wakeAt: new Date(START.getTime() + 3 * 60_000), source: "parsed" },
      { now: clock.now, sleep: clock.sleep, beat: (ms) => beats.push(ms) },
    );
    expect(beats).toEqual([60_000, 120_000, 180_000]);
  });

  it("a successful probe resumes early; the parsed path has nothing to ask", async () => {
    const clock = fakeTime(START);
    let calls = 0;
    const res = await runPause(
      {
        kind: "probe",
        intervalMs: 60_000,
        wakeAt: new Date(START.getTime() + 10 * 60_000),
        source: "probe",
      },
      {
        now: clock.now,
        sleep: clock.sleep,
        probe: async () => ++calls >= 3,
      },
    );
    expect(res.kind).toBe("resumed");
    expect(calls).toBe(3);
    expect(clock.slept).toHaveLength(3); // stopped early, not at 10
  });

  it("an aborted signal ends the pause without waiting it out", async () => {
    const clock = fakeTime(START);
    const ctrl = new AbortController();
    const res = await runPause(
      { kind: "sleep", wakeAt: new Date(START.getTime() + 60 * 60_000), source: "parsed" },
      {
        now: clock.now,
        sleep: async (ms) => {
          clock.slept.push(ms);
          clock.advance(ms);
          ctrl.abort();
        },
        signal: ctrl.signal,
      },
    );
    expect(res.kind).toBe("aborted-by-signal");
    expect(clock.slept).toHaveLength(1);
  });

  it("deadline and abort plans do not sleep at all", async () => {
    const clock = fakeTime(START);
    const deadline = await runPause(
      { kind: "deadline", reason: "past --until" },
      { now: clock.now, sleep: clock.sleep },
    );
    const abort = await runPause(
      { kind: "abort", reason: "weekly limit" },
      { now: clock.now, sleep: clock.sleep },
    );
    expect(deadline).toMatchObject({ kind: "deadline", durationMs: 0 });
    expect(abort).toMatchObject({ kind: "abort", durationMs: 0 });
    expect(clock.slept).toEqual([]);
  });

  it("measures REAL elapsed time, not planned — a suspend is reported honestly", async () => {
    const clock = fakeTime(START);
    const res = await runPause(
      { kind: "sleep", wakeAt: new Date(START.getTime() + 2 * 60_000), source: "parsed" },
      {
        now: clock.now,
        sleep: async (ms) => {
          clock.slept.push(ms);
          clock.advance(ms * 10); // every chunk takes 10x longer than asked
        },
      },
    );
    // durationMs is what the clock says, so the run summary and the morning
    // report tell the truth about a night that was mostly suspended.
    expect(res.durationMs).toBe(600_000);
  });
});
