// Pure decision function: given mode + a snapshot of merge-relevant signals,
// returns whether a PR may be merged. Used by /devx Phase 8 today and by
// /devx-manage promotion when that lands.
//
// No I/O. No imports beyond TS types — verified by test/merge-gate-no-io.test.ts.
//
// Order of evaluation is load-bearing for the audit log:
//   1. Trust-gradient override (count < initialN) — runs BEFORE mode logic so
//      the audit log records "needs INTERVIEW approval" rather than e.g.
//      "lockdown active" when both apply.
//   2. Mode validation — fail closed on unknown values.
//   3. LOCKDOWN — fixed reason, short-circuit.
//   4. YOLO conditions (CI green + !lockdownActive) — apply to YOLO/BETA/PROD.
//   5. BETA additional condition (no blocking review comments) — apply to
//      BETA/PROD.
//   6. PROD additional condition (touched-line coverage >= 1.0) — distinct
//      reason when coverage data is missing entirely vs below threshold.
//
// Spec: dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md

export type Mode = "YOLO" | "BETA" | "PROD" | "LOCKDOWN";

export interface GateSignals {
  /** GitHub Actions conclusion for the PR's head SHA, or `null` when no
   *  remote CI is configured (per /devx Phase 7's three-state probe — local
   *  CI is authoritative in that case). */
  ciConclusion: string | null;
  /** Runtime lockdown flag. Distinct from `mode === "LOCKDOWN"` — concierge
   *  or ManageAgent can flip this without changing the configured mode. */
  lockdownActive: boolean;
  /** Count of unresolved blocking reviewer comments on the PR. */
  blockingReviewComments: number;
  /** Touched-line coverage in [0, 1], or `null` if not measured. */
  coveragePctTouched: number | null;
  /** Trust-gradient: number of clean promotions so far. */
  count: number;
  /** Trust-gradient: threshold below which agent merges require approval. */
  initialN: number;
}

export interface GateDecision {
  merge: boolean;
  /** Single canonical reason for why merge is blocked. Absent when
   *  `merge: true`, or when the trust-gradient override fires (uses
   *  `advice` instead — see spec technical notes). */
  reason?: string;
  /** Auxiliary advice for the operator. Used by the trust-gradient override
   *  to point at INTERVIEW.md without populating `reason`. */
  advice?: string[];
}

const KNOWN_MODES: ReadonlySet<string> = new Set([
  "YOLO",
  "BETA",
  "PROD",
  "LOCKDOWN",
]);

export function mergeGateFor(
  mode: string,
  signals: GateSignals,
): GateDecision {
  // 1. Trust-gradient override — highest priority, runs before mode logic.
  if (signals.count < signals.initialN) {
    return { merge: false, advice: ["file INTERVIEW for approval"] };
  }

  // 2. Mode validation — fail closed.
  if (!KNOWN_MODES.has(mode)) {
    return { merge: false, reason: `unknown mode: ${mode}` };
  }

  // 3. LOCKDOWN — fixed reason, short-circuit.
  if (mode === "LOCKDOWN") {
    return { merge: false, reason: "lockdown active; manual merge required" };
  }

  // 4. YOLO conditions — applied to YOLO, BETA, PROD.
  const ciOk =
    signals.ciConclusion === "success" || signals.ciConclusion === null;
  if (!ciOk) {
    return {
      merge: false,
      reason: `CI not green (conclusion=${signals.ciConclusion})`,
    };
  }
  if (signals.lockdownActive) {
    // Distinct from mode==LOCKDOWN above so the audit log can tell a runtime
    // flag flip apart from a configured-mode lockdown.
    return {
      merge: false,
      reason: "runtime lockdown flag set; manual merge required",
    };
  }

  if (mode === "YOLO") return { merge: true };

  // 5. BETA additional condition.
  if (signals.blockingReviewComments !== 0) {
    const n = signals.blockingReviewComments;
    const noun = n === 1 || n === -1 ? "comment" : "comments";
    return {
      merge: false,
      reason: `${n} blocking reviewer ${noun} unresolved`,
    };
  }

  if (mode === "BETA") return { merge: true };

  // 6. PROD additional condition (coverage).
  if (signals.coveragePctTouched == null) {
    return { merge: false, reason: "PROD: coverage data missing" };
  }
  if (signals.coveragePctTouched < 1.0) {
    const pct = (signals.coveragePctTouched * 100).toFixed(1);
    return {
      merge: false,
      reason: `PROD: touched-line coverage ${pct}% < 100%`,
    };
  }
  return { merge: true };
}
