# uwg102 RED — `planPause` bounds (E-3, E-5, E-6)

Authored at the RED stage with the rest of `test/loop-usage-window.test.ts`
and moved here when uwg101 shipped, so Phase 1 could go green without
deleting Phase 2's RED. **A RED that has to be re-derived from memory is not
a RED** — that is the whole point of writing it before the code.

Paste back into `test/loop-usage-window.test.ts` (replacing the matching
`it.todo` block) as the first act of uwg102, confirm it fails because
`usage-governor.js` does not exist, and only then write the module.

```ts
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
    expect(plan.kind).toBe("sleep");
    expect(plan.wakeAt?.getTime()).toBe(RESET.getTime() + CFG.usageResetSlackMs);
  });

  it("E-3: falls back to the probe cadence when the reset is unknown", () => {
    const plan = planPause(
      { resetAt: null, source: "probe" },
      CFG,
      { now: NOW, elapsedPausedMs: 0, deadline: null },
    );
    expect(plan.kind).toBe("probe");
    expect(plan.intervalMs).toBe(CFG.usageProbeIntervalMs);
  });

  it("E-3: aborts with the weekly-limit reason once cumulative pause exceeds the cap", () => {
    const plan = planPause(
      { resetAt: null, source: "probe" },
      CFG,
      { now: NOW, elapsedPausedMs: CFG.usageMaxPauseMs + 1, deadline: null },
    );
    expect(plan.kind).toBe("abort");
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

```
