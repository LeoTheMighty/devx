// Truth-table for mergeGateFor() across all 4 modes (mrg101).
//
// Each row is a (mode, signals) tuple with the expected GateDecision shape.
// The trust-gradient override is held neutral here (count == initialN, both
// zero) — it gets its own test file to keep the table single-axis.
//
// 16+ rows per the spec AC. Each row is documented with the AC clause it
// covers so a reader can map a regression back to the contract.
//
// Spec: dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md

import { describe, expect, it } from "vitest";

import {
  type GateDecision,
  type GateSignals,
  type Mode,
  mergeGateFor,
} from "../src/lib/merge-gate.js";

/** Neutral trust-gradient (override doesn't apply). */
const NEUTRAL = { count: 0, initialN: 0 };

function signals(overrides: Partial<GateSignals>): GateSignals {
  return {
    ciConclusion: "success",
    lockdownActive: false,
    blockingReviewComments: 0,
    coveragePctTouched: null,
    ...NEUTRAL,
    ...overrides,
  };
}

interface Row {
  name: string;
  mode: string;
  signals: GateSignals;
  expect: GateDecision | { merge: boolean; reasonContains?: string };
}

const rows: Row[] = [
  // ---------- YOLO (AC: merge=true iff ci ∈ {success,null} AND !lockdown) ----------
  {
    name: "YOLO + ci=success + lockdown=false → merge",
    mode: "YOLO",
    signals: signals({}),
    expect: { merge: true },
  },
  {
    name: "YOLO + ci=null (no remote CI configured) + lockdown=false → merge",
    mode: "YOLO",
    signals: signals({ ciConclusion: null }),
    expect: { merge: true },
  },
  {
    name: "YOLO + ci=failure → block",
    mode: "YOLO",
    signals: signals({ ciConclusion: "failure" }),
    expect: { merge: false, reasonContains: "CI" },
  },
  {
    name: "YOLO + ci=success + lockdownActive=true → block (runtime lockdown)",
    mode: "YOLO",
    signals: signals({ lockdownActive: true }),
    expect: { merge: false, reasonContains: "runtime lockdown" },
  },

  // ---------- BETA (AC: YOLO conditions + blockingReviewComments == 0) ----------
  {
    name: "BETA + ci=success + comments=0 → merge",
    mode: "BETA",
    signals: signals({ blockingReviewComments: 0 }),
    expect: { merge: true },
  },
  {
    name: "BETA + ci=success + comments=3 → block (plural reason text)",
    mode: "BETA",
    signals: signals({ blockingReviewComments: 3 }),
    expect: { merge: false, reasonContains: "3 blocking reviewer comments" },
  },
  {
    name: "BETA + ci=success + comments=1 → block (singular reason text)",
    mode: "BETA",
    signals: signals({ blockingReviewComments: 1 }),
    expect: { merge: false, reasonContains: "1 blocking reviewer comment" },
  },
  {
    name: "BETA + ci=failure (BETA picks up YOLO's CI block) → block",
    mode: "BETA",
    signals: signals({ ciConclusion: "failure", blockingReviewComments: 0 }),
    expect: { merge: false, reasonContains: "CI" },
  },
  {
    name: "BETA + ci=success + lockdownActive=true → block (YOLO inheritance)",
    mode: "BETA",
    signals: signals({ lockdownActive: true }),
    expect: { merge: false, reasonContains: "runtime lockdown" },
  },

  // ---------- PROD (AC: BETA conditions + coverage >= 1.0) ----------
  {
    name: "PROD + ci=success + comments=0 + cov=1.0 → merge",
    mode: "PROD",
    signals: signals({ coveragePctTouched: 1.0 }),
    expect: { merge: true },
  },
  {
    name: "PROD + ci=success + comments=0 + cov=0.85 → block",
    mode: "PROD",
    signals: signals({ coveragePctTouched: 0.85 }),
    expect: { merge: false, reasonContains: "coverage" },
  },
  {
    name: "PROD + cov=null → distinct reason 'PROD: coverage data missing'",
    mode: "PROD",
    signals: signals({ coveragePctTouched: null }),
    expect: { merge: false, reasonContains: "coverage data missing" },
  },
  {
    name: "PROD + comments=3 + cov=1.0 → block on comments (BETA inheritance)",
    mode: "PROD",
    signals: signals({ blockingReviewComments: 3, coveragePctTouched: 1.0 }),
    expect: { merge: false, reasonContains: "comment" },
  },
  {
    name: "PROD + ci=failure + cov=1.0 → block on CI (YOLO inheritance)",
    mode: "PROD",
    signals: signals({ ciConclusion: "failure", coveragePctTouched: 1.0 }),
    expect: { merge: false, reasonContains: "CI" },
  },
  {
    name: "PROD + cov=1.0 exactly → merge (>= boundary)",
    mode: "PROD",
    signals: signals({ coveragePctTouched: 1.0 }),
    expect: { merge: true },
  },

  // ---------- LOCKDOWN (AC: always merge=false, fixed reason) ----------
  {
    name: "LOCKDOWN + ci=success → block, fixed reason",
    mode: "LOCKDOWN",
    signals: signals({}),
    expect: {
      merge: false,
      reason: "lockdown active; manual merge required",
    },
  },
  {
    name: "LOCKDOWN + ci=failure → still block, same fixed reason",
    mode: "LOCKDOWN",
    signals: signals({ ciConclusion: "failure" }),
    expect: {
      merge: false,
      reason: "lockdown active; manual merge required",
    },
  },

  // ---------- Unknown mode (AC: fail closed with reason) ----------
  {
    name: "unknown mode 'yolo' (case-sensitive; lowercase fails) → block",
    mode: "yolo",
    signals: signals({}),
    expect: { merge: false, reason: "unknown mode: yolo" },
  },
  {
    name: "unknown mode 'STAGING' → block",
    mode: "STAGING",
    signals: signals({}),
    expect: { merge: false, reason: "unknown mode: STAGING" },
  },
];

describe("mergeGateFor truth table", () => {
  // Coverage check the AC asks for (>= 16 rows).
  it("covers ≥ 16 distinct rows", () => {
    expect(rows.length).toBeGreaterThanOrEqual(16);
  });

  it.each(rows)("$name", (row) => {
    const decision = mergeGateFor(row.mode as Mode, row.signals);
    expect(decision.merge).toBe(row.expect.merge);

    if ("reason" in row.expect && row.expect.reason !== undefined) {
      expect(decision.reason).toBe(row.expect.reason);
    }
    if (
      "reasonContains" in row.expect &&
      row.expect.reasonContains !== undefined
    ) {
      expect(decision.reason ?? "").toContain(row.expect.reasonContains);
    }
  });
});
