// Trust-gradient override tests for mergeGateFor() (mrg101).
//
// The trust-gradient override is the highest-priority check — it runs BEFORE
// mode logic so that the audit log records "needs INTERVIEW approval" rather
// than e.g. "lockdown active" when both apply. This file isolates that axis:
//   - override-applies: count < initialN under any mode → blocked with advice
//   - override-overrides-mode-success: a configuration that would otherwise
//     return merge=true (YOLO + ci=success) is blocked by the override
//   - override-not-applicable: count >= initialN means the override is silent
//
// Spec: dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md

import { describe, expect, it } from "vitest";

import { type GateSignals, mergeGateFor } from "../src/lib/merge-gate.js";

function baseSignals(overrides: Partial<GateSignals>): GateSignals {
  return {
    ciConclusion: "success",
    lockdownActive: false,
    blockingReviewComments: 0,
    coveragePctTouched: 1.0,
    count: 0,
    initialN: 0,
    ...overrides,
  };
}

describe("trust-gradient override", () => {
  describe("override applies (count < initialN)", () => {
    it("blocks YOLO + green CI that would otherwise merge", () => {
      const decision = mergeGateFor(
        "YOLO",
        baseSignals({ count: 0, initialN: 3 }),
      );
      expect(decision.merge).toBe(false);
      expect(decision.advice).toEqual(["file INTERVIEW for approval"]);
      // No reason field per AC — the advice is the audit log entry.
      expect(decision.reason).toBeUndefined();
    });

    it("blocks BETA + green CI + zero comments that would otherwise merge", () => {
      const decision = mergeGateFor(
        "BETA",
        baseSignals({ count: 1, initialN: 5 }),
      );
      expect(decision.merge).toBe(false);
      expect(decision.advice).toEqual(["file INTERVIEW for approval"]);
    });

    it("blocks PROD + green CI + 100% coverage that would otherwise merge", () => {
      const decision = mergeGateFor(
        "PROD",
        baseSignals({ count: 2, initialN: 10, coveragePctTouched: 1.0 }),
      );
      expect(decision.merge).toBe(false);
      expect(decision.advice).toEqual(["file INTERVIEW for approval"]);
    });

    it("returns trust-gradient advice (NOT lockdown reason) when both would block", () => {
      // Per spec technical note: "the override returns the trust-gradient
      // reason instead of LOCKDOWN reason for clarity in the audit log".
      const decision = mergeGateFor(
        "LOCKDOWN",
        baseSignals({ count: 0, initialN: 3 }),
      );
      expect(decision.merge).toBe(false);
      expect(decision.advice).toEqual(["file INTERVIEW for approval"]);
      expect(decision.reason).toBeUndefined();
    });

    it("blocks unknown mode too (override runs before mode validation)", () => {
      const decision = mergeGateFor(
        "STAGING",
        baseSignals({ count: 0, initialN: 3 }),
      );
      expect(decision.merge).toBe(false);
      expect(decision.advice).toEqual(["file INTERVIEW for approval"]);
      expect(decision.reason).toBeUndefined();
    });
  });

  describe("override does not apply (count >= initialN)", () => {
    it("count == initialN: override silent, mode logic decides (YOLO merges)", () => {
      const decision = mergeGateFor(
        "YOLO",
        baseSignals({ count: 3, initialN: 3 }),
      );
      expect(decision.merge).toBe(true);
      expect(decision.advice).toBeUndefined();
    });

    it("count > initialN: override silent, mode logic decides", () => {
      const decision = mergeGateFor(
        "YOLO",
        baseSignals({ count: 100, initialN: 3 }),
      );
      expect(decision.merge).toBe(true);
    });

    it("override silent + LOCKDOWN: LOCKDOWN reason returned", () => {
      const decision = mergeGateFor(
        "LOCKDOWN",
        baseSignals({ count: 5, initialN: 3 }),
      );
      expect(decision.merge).toBe(false);
      expect(decision.reason).toBe("lockdown active; manual merge required");
      expect(decision.advice).toBeUndefined();
    });

    it("count == 0 AND initialN == 0 (full-autonomy config): override silent", () => {
      // Full-autonomy config (count=0, initialN=0) is degenerate but valid —
      // the override must NOT fire because count >= initialN holds. Mode
      // logic alone decides. This is the YOLO default per docs/MODES.md and
      // is what this project ships with.
      const decision = mergeGateFor(
        "YOLO",
        baseSignals({ count: 0, initialN: 0 }),
      );
      expect(decision.merge).toBe(true);
    });
  });
});
