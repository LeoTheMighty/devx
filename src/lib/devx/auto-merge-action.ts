// Phase 8 advice-array routing (dvx106).
//
// `mergeGateFor()` (mrg101) only populates `advice` for the trust-gradient
// override. Every other `merge: false` case carries a free-text `reason` but
// no routing keyword. dvx106 wires `/devx` Phase 8 to dispatch *purely on the
// advice array* per AC #3, which means we need a deterministic mapping from
// every gate-block reason to one of three canonical keywords:
//
//   • "file INTERVIEW for approval" — human approval required (trust-gradient
//     gate; the override is the only block that already populates this from
//     mergeGateFor).
//   • "wait for CI"                  — CI is pending or non-success and is
//     expected to resolve automatically (re-poll). /devx Phase 7 already
//     fix-forwards on CI failure, so this advice in Phase 8 means "Phase 7
//     should have caught this; re-enter the polling loop."
//   • "manual merge required"       — block requires human action that
//     /devx itself can't take: lift lockdown, resolve reviewer comments,
//     fix coverage config, fix mode config.
//
// The derivation lives here (not in mrg101) because it's a /devx-shaped
// projection of the gate's decision, not a pure mode rule. promoteIntegrationToDefault
// (mrg103) consumes mergeGateFor directly without these keywords — its caller
// is /devx-manage, which has its own routing language. Keeping the routing
// out of mrg101 preserves that separation.
//
// Spec: dev/dev-dvx106-2026-04-28T19:30-devx-auto-merge-gate.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import type { GateDecision } from "../merge-gate.js";

/**
 * The three canonical advice keywords parsed by `/devx` Phase 8 per AC #3.
 * The skill body dispatches on exact-string match, so any change here MUST
 * land in `.claude/commands/devx.md` Phase 8 simultaneously — the discipline
 * test in `test/devx-skill-phase8-discipline.test.ts` enforces that.
 */
export const ADVICE_INTERVIEW = "file INTERVIEW for approval" as const;
export const ADVICE_WAIT_CI = "wait for CI" as const;
export const ADVICE_MANUAL = "manual merge required" as const;

export type AdviceKeyword =
  | typeof ADVICE_INTERVIEW
  | typeof ADVICE_WAIT_CI
  | typeof ADVICE_MANUAL;

/**
 * Derive the canonical advice array for a `GateDecision`. Pure; no I/O.
 *
 *   • `merge: true` → `[]` (no advice on merge).
 *   • `merge: false` with explicit `advice` from mergeGateFor (trust-gradient)
 *     → preserved (filtered for canonicity, defaulting to `["manual merge
 *     required"]` if every entry is non-canonical — never falls through to
 *     reason-matching, which would silently downgrade the gate's explicit
 *     decision).
 *   • `merge: false` with reason `CI not green (conclusion=failure|pending)`
 *     → `["wait for CI"]` (re-pollable; Phase 7 fix-forward path handles).
 *   • `merge: false` with reason `CI not green (conclusion=cancelled|action_required|...)`
 *     → `["manual merge required"]` (cancelled = user intervention; action_required
 *     = human approval gate; neither auto-resolves — re-polling would loop).
 *   • Everything else (`merge: false`) → `["manual merge required"]`.
 *
 * Reason matching is intentional: we don't take a parallel structured signal
 * because mergeGateFor only emits `reason` strings for non-trust-gradient
 * blocks. Anchoring on the canonical reason prefixes mrg101 emits ("CI not
 * green", "PROD: coverage data missing", "<n> blocking reviewer comment(s)
 * unresolved", "lockdown active; manual merge required", "runtime lockdown
 * flag set; manual merge required", "unknown mode: <m>") makes the routing
 * deterministic. New reasons added to mrg101 default to "manual merge
 * required" — the safe-default that asks for human action.
 */
export function deriveMergeAdvice(decision: GateDecision): AdviceKeyword[] {
  if (decision.merge) return [];

  // Trust-gradient (or any future mode that uses `advice` directly) — the
  // gate already made an explicit routing decision. Preserve it; never fall
  // through to reason-matching, which would silently overwrite the gate's
  // decision when every advice entry is non-canonical (would have produced
  // `[ADVICE_MANUAL]` and lost the original "INTERVIEW" intent). When the
  // filter is empty we default to MANUAL — the safe ask-for-human path —
  // not a derived guess from `reason`.
  if (decision.advice !== undefined) {
    const filtered = decision.advice.filter((a): a is AdviceKeyword =>
      a === ADVICE_INTERVIEW || a === ADVICE_WAIT_CI || a === ADVICE_MANUAL,
    );
    return filtered.length > 0 ? filtered : [ADVICE_MANUAL];
  }

  const reason = decision.reason ?? "";

  // CI-not-green: distinguish auto-resolvable (failure/pending — Phase 7's
  // fix-forward / re-poll loop handles) from terminal (cancelled — user
  // cancelled, won't auto-restart; action_required — workflow needs human
  // approval). Routing the terminal cases to "wait for CI" would create an
  // infinite poll loop in Phase 8.
  const ciMatch = /^CI not green \(conclusion=([^)]*)\)/.exec(reason);
  if (ciMatch) {
    const concl = ciMatch[1];
    if (concl === "failure" || concl === "pending") return [ADVICE_WAIT_CI];
    return [ADVICE_MANUAL];
  }

  // Everything else: human action required. This includes:
  //   - lockdown active (mode or runtime flag)
  //   - blocking reviewer comments (reviewer must resolve)
  //   - coverage missing/below threshold (test/coverage config or new tests)
  //   - unknown mode (config fix)
  // (A spec-resolution miss is exit 2 — investigation — since debug-6a913f;
  // it never reaches advice derivation.)
  return [ADVICE_MANUAL];
}
