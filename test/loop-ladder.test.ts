// Failure-ladder truth table (v2l101 — src/lib/loop/ladder.ts).
//
// Every class × counter state, per v2/04 §3. Pure module — no I/O.

import { describe, expect, it } from "vitest";

import {
  PERMANENT_ERROR_MARKERS,
  afterItemAbandoned,
  afterItemCompleted,
  classifyIteration,
  emptyLadderState,
  firstPermanentErrorMatch as ladderFirstMatch,
  firstPermanentErrorMatchInTail,
  isPermanentErrorMessage,
  ladderDecision,
  nextLadderState,
  shouldStopAfterAbandonment,
  type IterationClass,
  type LadderState,
} from "../src/lib/loop/ladder.js";

const CFG = { maxConsecutiveFailures: 3, backoffMs: [60_000, 120_000, 240_000] };

function state(failures: number, errors: number, abandoned = 0): LadderState {
  return {
    consecutiveFailures: failures,
    consecutiveErrors: errors,
    consecutiveAbandonedItems: abandoned,
  };
}

// ---------------------------------------------------------------------------
// classifyIteration
// ---------------------------------------------------------------------------

describe("classifyIteration", () => {
  const okReport = { success: true, key_learnings: ["l"] };

  it("success: reported success with file changes", () => {
    expect(classifyIteration({ report: okReport, filesChanged: true })).toBe("success");
  });

  it("success: no file changes but new learnings (not a no-op)", () => {
    expect(
      classifyIteration({ report: { success: true, key_learnings: ["found X"] }, filesChanged: false }),
    ).toBe("success");
  });

  it("no-op: success ∧ no file changes ∧ no learnings ⇒ failure class", () => {
    expect(
      classifyIteration({ report: { success: true, key_learnings: [] }, filesChanged: false }),
    ).toBe("no-op");
  });

  it("reported-failure: success:false regardless of file changes", () => {
    expect(
      classifyIteration({ report: { success: false, key_learnings: ["a"] }, filesChanged: true }),
    ).toBe("reported-failure");
  });

  it("hard-error: worker threw / crashed", () => {
    expect(
      classifyIteration({ error: { message: "TypeError: fetch failed" }, filesChanged: false }),
    ).toBe("hard-error");
  });

  it("permanent-error: credit/auth exhaustion patterns", () => {
    for (const msg of [
      "Your credit balance is too low to access the API",
      "invalid api key provided",
      "authentication_error: unauthorized",
      "OAuth token has expired — please run /login",
    ]) {
      expect(classifyIteration({ error: { message: msg }, filesChanged: false })).toBe(
        "permanent-error",
      );
    }
  });

  it("transient noise stays hard-error (rate limits ride the backoff)", () => {
    for (const msg of ["429 rate_limit_error", "overloaded_error", "ECONNRESET"]) {
      expect(classifyIteration({ error: { message: msg }, filesChanged: false })).toBe("hard-error");
    }
  });

  it("commit-failure wins over the report", () => {
    expect(
      classifyIteration({ report: okReport, filesChanged: true, commitFailed: true }),
    ).toBe("commit-failure");
  });

  it("error wins over everything (precedence)", () => {
    expect(
      classifyIteration({
        report: okReport,
        error: { message: "boom" },
        filesChanged: true,
        commitFailed: true,
      }),
    ).toBe("hard-error");
  });

  it("no report + no error is a hard error, never a silent success", () => {
    expect(classifyIteration({ filesChanged: true })).toBe("hard-error");
  });

  it("marker list is non-trivial and case-insensitive", () => {
    expect(PERMANENT_ERROR_MARKERS.length).toBeGreaterThanOrEqual(5);
    expect(isPermanentErrorMessage("CREDIT BALANCE IS TOO LOW")).toBe(true);
    expect(isPermanentErrorMessage("all good")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

describe("nextLadderState", () => {
  it("success resets everything (including the abandoned-items streak)", () => {
    expect(nextLadderState(state(2, 2, 2), "success")).toEqual(state(0, 0, 0));
  });

  it("reported-failure bumps failures, resets errors (agent tried — loop is healthy)", () => {
    expect(nextLadderState(state(1, 2, 1), "reported-failure")).toEqual(state(2, 0, 1));
  });

  it("no-op counts exactly like a reported failure", () => {
    expect(nextLadderState(state(0, 0), "no-op")).toEqual(state(1, 0, 0));
  });

  it("hard-error bumps both counters", () => {
    expect(nextLadderState(state(1, 1), "hard-error")).toEqual(state(2, 2, 0));
  });

  it("commit-failure bumps failures only", () => {
    expect(nextLadderState(state(0, 1), "commit-failure")).toEqual(state(1, 0, 0));
  });

  it("progress-less abandonment resets per-item counters and bumps the run streak", () => {
    expect(afterItemAbandoned(state(3, 1, 1), { madeProgress: false })).toEqual(state(0, 0, 2));
  });

  it("abandonment WITH committed progress does NOT bump the run streak (MED-4: big ≠ broken)", () => {
    // ≥1 successful committed iteration proves the pipeline works — the
    // item was just bigger than its budget. Streak preserved, not reset:
    // neighbouring progress-less abandonments keep their evidence.
    expect(afterItemAbandoned(state(3, 1, 1), { madeProgress: true })).toEqual(state(0, 0, 1));
    expect(afterItemAbandoned(state(2, 0, 0), { madeProgress: true })).toEqual(state(0, 0, 0));
  });

  it("three big-but-progressing abandonments never reach the 3-stop", () => {
    let s = state(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      s = afterItemAbandoned(s, { madeProgress: true });
      expect(shouldStopAfterAbandonment(s)).toBe(false);
    }
    // ...while three progress-less ones do.
    let bad = state(0, 0, 0);
    for (let i = 0; i < 3; i++) bad = afterItemAbandoned(bad, { madeProgress: false });
    expect(shouldStopAfterAbandonment(bad)).toBe(true);
  });

  it("a completed item resets the abandoned streak", () => {
    expect(afterItemCompleted(state(1, 1, 2))).toEqual(state(0, 0, 0));
  });
});

// ---------------------------------------------------------------------------
// Decision truth table: every class × counter states
// ---------------------------------------------------------------------------

describe("ladderDecision — truth table", () => {
  const CLASSES: IterationClass[] = [
    "success",
    "reported-failure",
    "no-op",
    "hard-error",
    "permanent-error",
    "commit-failure",
  ];

  it("permanent-error aborts the loop at ANY counter state", () => {
    for (const s of [state(0, 0), state(2, 2), state(3, 3, 2)]) {
      const d = ladderDecision("permanent-error", s, CFG);
      expect(d.kind).toBe("abort-loop");
    }
  });

  it("success always continues", () => {
    for (const s of [state(0, 0), state(2, 2)]) {
      expect(ladderDecision("success", s, CFG).kind).toBe("continue");
    }
  });

  it("reported-failure / no-op continue below the cap (immediately — no backoff)", () => {
    for (const cls of ["reported-failure", "no-op"] as const) {
      expect(ladderDecision(cls, state(1, 0), CFG).kind).toBe("continue");
      expect(ladderDecision(cls, state(2, 0), CFG).kind).toBe("continue");
    }
  });

  it("3 consecutive failures abandon the item — for EVERY failure class", () => {
    for (const cls of ["reported-failure", "no-op", "hard-error", "commit-failure"] as const) {
      const d = ladderDecision(cls, state(3, cls === "hard-error" ? 3 : 0), CFG);
      expect(d.kind).toBe("abandon-item");
      if (d.kind === "abandon-item") expect(d.reason).toMatch(/3 consecutive failures/);
    }
  });

  it("abandon-item wins over backoff and repair at the cap", () => {
    expect(ladderDecision("hard-error", state(3, 1), CFG).kind).toBe("abandon-item");
    expect(ladderDecision("commit-failure", state(3, 0), CFG).kind).toBe("abandon-item");
  });

  it("hard-error backoff walks [60s, 120s, 240s] and clamps at the last entry", () => {
    const one = ladderDecision("hard-error", state(1, 1), CFG);
    const two = ladderDecision("hard-error", state(2, 2), CFG);
    expect(one).toEqual({ kind: "backoff", ms: 60_000, index: 0 });
    expect(two).toEqual({ kind: "backoff", ms: 120_000, index: 1 });
    // Clamp: 5 consecutive errors with a permissive failure cap.
    const clamped = ladderDecision("hard-error", state(1, 5), {
      ...CFG,
      maxConsecutiveFailures: 10,
    });
    expect(clamped).toEqual({ kind: "backoff", ms: 240_000, index: 2 });
  });

  it("commit-failure below the cap gets a repair iteration (the no-rollback path)", () => {
    expect(ladderDecision("commit-failure", state(1, 0), CFG).kind).toBe("repair-iteration");
    expect(ladderDecision("commit-failure", state(2, 0), CFG).kind).toBe("repair-iteration");
  });

  it("a degenerate maxConsecutiveFailures of 0 clamps to 1 (block on first failure)", () => {
    const d = ladderDecision("reported-failure", state(1, 0), {
      ...CFG,
      maxConsecutiveFailures: 0,
    });
    expect(d.kind).toBe("abandon-item");
  });

  it("empty backoff array falls back to the design defaults", () => {
    const d = ladderDecision("hard-error", state(1, 1), {
      maxConsecutiveFailures: 3,
      backoffMs: [],
    });
    expect(d).toEqual({ kind: "backoff", ms: 60_000, index: 0 });
  });

  it("every class yields exactly one decision kind (exhaustiveness)", () => {
    for (const cls of CLASSES) {
      const d = ladderDecision(cls, state(1, 1), CFG);
      expect(["continue", "backoff", "repair-iteration", "abandon-item", "abort-loop"]).toContain(
        d.kind,
      );
    }
  });
});

describe("shouldStopAfterAbandonment", () => {
  it("stops the loop at 3 consecutive abandoned items", () => {
    expect(shouldStopAfterAbandonment(state(0, 0, 2))).toBe(false);
    expect(shouldStopAfterAbandonment(state(0, 0, 3))).toBe(true);
    expect(shouldStopAfterAbandonment(state(0, 0, 4))).toBe(true);
  });

  it("a fresh run never stops", () => {
    expect(shouldStopAfterAbandonment(emptyLadderState())).toBe(false);
  });
});

describe("firstPermanentErrorMatch (BH-HIGH-2 — markers scanned against raw worker output)", () => {
  it("returns the matched marker text from a transcript", () => {
    const raw = "some progress...\nAPI Error: Your credit balance is too low to continue.\n";
    expect(isPermanentErrorMessage(raw)).toBe(true);
    const m = ladderFirstMatch(raw);
    expect(m).toMatch(/credit balance is too low/i);
  });

  it("returns null for healthy / transient output and empty strings", () => {
    expect(ladderFirstMatch("")).toBeNull();
    expect(ladderFirstMatch("429 rate limited, retrying")).toBeNull();
  });
});

describe("firstPermanentErrorMatchInTail (MED-3 — tail-bounded marker scan)", () => {
  it("ignores marker text buried mid-transcript (worked-on code echoing markers)", () => {
    // A worker editing ladder.ts echoes the marker list into its transcript,
    // then does 3000 chars of honest work after it.
    const raw =
      "editing ladder.ts: /credit balance is too low/i added to markers\n" +
      "x".repeat(3000) +
      "\nall tests green";
    expect(firstPermanentErrorMatchInTail(raw)).toBeNull();
    // The whole-text scan would have matched — that's the false positive.
    expect(ladderFirstMatch(raw)).toMatch(/credit balance is too low/i);
  });

  it("matches a marker in the final ~2000 chars (a dying session prints it last)", () => {
    const raw =
      "y".repeat(5000) +
      "\nAPI Error: Your credit balance is too low to access the Anthropic API.\n";
    expect(firstPermanentErrorMatchInTail(raw)).toMatch(/credit balance is too low/i);
    expect(firstPermanentErrorMatchInTail("")).toBeNull();
  });
});
