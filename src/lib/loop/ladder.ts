// The failure ladder (v2l101) — pure. Stolen whole from gnhf's orchestrator
// (v2/04-overnight-loop.md §3), reshaped as a reducer + decision table so
// test/loop-ladder.test.ts can drive the full truth table without I/O.
//
//   | Class                | Response                        | Counts toward            |
//   |----------------------|---------------------------------|--------------------------|
//   | success              | continue; counters reset        | —                        |
//   | reported-failure     | rollback; continue immediately  | consecutive-failures     |
//   | no-op                | treated as reported failure     | consecutive-failures     |
//   | hard-error           | rollback; exponential backoff   | failures + errors        |
//   | permanent-error      | abort the whole loop NOW        | immediate abort          |
//   | commit-failure       | preserve; next iter = repair    | consecutive-failures     |
//
//   * maxConsecutiveFailures (default 3) on one item ⇒ abandon-item (the
//     driver releases the claim, flips the spec `[-]` blocked, PRESERVES the
//     worktree, records the path).
//   * MAX_CONSECUTIVE_ABANDONED_ITEMS (3) ⇒ stop-loop (systemic problem).
//
// The reducer (nextLadderState) and the decision (ladderDecision) are
// separate on purpose: the driver applies the reducer first, then asks for
// the decision against the NEW state — so "3rd consecutive failure" is
// decided on the state that already includes it.
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md §3

import { MAX_CONSECUTIVE_ABANDONED_ITEMS } from "./config.js";

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type IterationClass =
  | "success"
  | "reported-failure"
  | "no-op"
  | "hard-error"
  | "permanent-error"
  | "commit-failure";

export interface ClassifyInput {
  /** Validated report, when the worker produced one. */
  report?: {
    success: boolean;
    key_learnings: string[];
  };
  /** Worker process crashed / threw / report unrecoverable. */
  error?: { message: string };
  /** Did the iteration leave file changes in the tree (pre-commit probe)? */
  filesChanged: boolean;
  /** Did the loop's commit of a successful iteration fail? */
  commitFailed?: boolean;
}

/**
 * Permanent-error markers — credit/auth exhaustion patterns that mean "never
 * grind a dead API until dawn" (v2/04 §3). Deliberately narrow: transient
 * rate limits and 5xx storms should ride the hard-error backoff instead.
 * Matched case-insensitively against the error message + cause chain text
 * the driver assembles.
 */
export const PERMANENT_ERROR_MARKERS: readonly RegExp[] = [
  /credit balance is too low/i,
  /insufficient credits?/i,
  /billing.{0,40}(issue|problem|disabled|suspended)/i,
  /invalid (api key|x-api-key)/i,
  /authentication[_ ]error/i,
  /account.{0,40}(disabled|suspended|deactivated)/i,
  /oauth token.{0,40}(revoked|expired)/i,
  /please run \/login/i,
];

export function isPermanentErrorMessage(message: string): boolean {
  return PERMANENT_ERROR_MARKERS.some((re) => re.test(message));
}

/**
 * Return the matched marker text (bounded by the regex) from a blob of
 * worker OUTPUT, or null. The driver uses this on raw transcripts:
 * credit/auth exhaustion from a `claude -p` session surfaces as printed
 * text + a non-zero exit, never as a thrown spawn error — without scanning
 * the output, the permanent-error rung would be unreachable for its
 * motivating case (BH-HIGH-2).
 */
export function firstPermanentErrorMatch(text: string): string | null {
  if (typeof text !== "string" || text === "") return null;
  for (const re of PERMANENT_ERROR_MARKERS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/**
 * Classify one finished iteration. Precedence (most-fatal first):
 *   permanent-error → hard-error → commit-failure → reported-failure →
 *   no-op → success.
 *
 * No-op detection (v2/04 §2.4): a "success" with no file changes AND no new
 * learnings is counted as a failure — kills the burn-tokens-declaring-
 * victory failure mode.
 */
export function classifyIteration(input: ClassifyInput): IterationClass {
  if (input.error) {
    return isPermanentErrorMessage(input.error.message)
      ? "permanent-error"
      : "hard-error";
  }
  if (input.commitFailed === true) return "commit-failure";
  const report = input.report;
  if (!report) {
    // Defensive: no report and no error shouldn't happen (the driver maps a
    // failed retry to `error`), but if it does, it's a hard error — not a
    // silent success.
    return "hard-error";
  }
  if (!report.success) return "reported-failure";
  if (!input.filesChanged && report.key_learnings.length === 0) return "no-op";
  return "success";
}

// ---------------------------------------------------------------------------
// Ladder state + reducer
// ---------------------------------------------------------------------------

export interface LadderState {
  /** Consecutive non-success iterations on the CURRENT item. */
  consecutiveFailures: number;
  /** Consecutive hard errors on the current item — drives the backoff index. */
  consecutiveErrors: number;
  /** Consecutive abandoned items across the whole run. */
  consecutiveAbandonedItems: number;
}

export function emptyLadderState(): LadderState {
  return {
    consecutiveFailures: 0,
    consecutiveErrors: 0,
    consecutiveAbandonedItems: 0,
  };
}

/**
 * Fold one iteration class into the ladder state. Pure.
 *
 *   - success resets both per-item counters AND the abandoned-items streak
 *     (a good iteration proves the system is healthy again).
 *   - only hard errors escalate consecutiveErrors — an agent-reported
 *     failure means the loop is healthy (the agent tried and concluded it
 *     couldn't), so the error streak resets (gnhf recordFailure semantics).
 *   - permanent-error is terminal; the counters still update for the log's
 *     sake but the decision below aborts regardless.
 */
export function nextLadderState(
  state: LadderState,
  cls: IterationClass,
): LadderState {
  if (cls === "success") {
    return {
      consecutiveFailures: 0,
      consecutiveErrors: 0,
      consecutiveAbandonedItems: 0,
    };
  }
  const failures = state.consecutiveFailures + 1;
  const errors =
    cls === "hard-error" || cls === "permanent-error"
      ? state.consecutiveErrors + 1
      : 0;
  return {
    consecutiveFailures: failures,
    consecutiveErrors: errors,
    consecutiveAbandonedItems: state.consecutiveAbandonedItems,
  };
}

/** Fold an item abandonment into the run-level streak. */
export function afterItemAbandoned(state: LadderState): LadderState {
  return {
    consecutiveFailures: 0,
    consecutiveErrors: 0,
    consecutiveAbandonedItems: state.consecutiveAbandonedItems + 1,
  };
}

/** Fold a successfully-finished item (acs_met → tail) into the run streak. */
export function afterItemCompleted(state: LadderState): LadderState {
  return {
    consecutiveFailures: 0,
    consecutiveErrors: 0,
    consecutiveAbandonedItems: 0,
  };
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type LadderDecision =
  | { kind: "continue" }
  | { kind: "backoff"; ms: number; index: number }
  | { kind: "repair-iteration" }
  | { kind: "abandon-item"; reason: string }
  | { kind: "abort-loop"; reason: string };

export interface LadderConfig {
  maxConsecutiveFailures: number;
  backoffMs: number[];
}

/**
 * Decide the loop's next move given the iteration class and the state AFTER
 * the reducer ran. Precedence:
 *
 *   1. permanent-error → abort-loop (never grind a dead API until dawn).
 *   2. consecutiveFailures ≥ max → abandon-item.
 *   3. commit-failure → repair-iteration (the one no-rollback path).
 *   4. hard-error → backoff(index = consecutiveErrors - 1, clamped).
 *   5. everything else → continue.
 */
export function ladderDecision(
  cls: IterationClass,
  state: LadderState,
  cfg: LadderConfig,
): LadderDecision {
  if (cls === "permanent-error") {
    return {
      kind: "abort-loop",
      reason: "permanent error (credits/auth) — aborting the loop now",
    };
  }
  if (cls === "success") return { kind: "continue" };
  if (state.consecutiveFailures >= Math.max(1, cfg.maxConsecutiveFailures)) {
    return {
      kind: "abandon-item",
      reason: `${state.consecutiveFailures} consecutive failures on this item`,
    };
  }
  if (cls === "commit-failure") return { kind: "repair-iteration" };
  if (cls === "hard-error") {
    const backoff =
      cfg.backoffMs.length > 0 ? cfg.backoffMs : [60_000, 120_000, 240_000];
    const index = Math.min(
      Math.max(state.consecutiveErrors - 1, 0),
      backoff.length - 1,
    );
    return { kind: "backoff", ms: backoff[index], index };
  }
  return { kind: "continue" };
}

/**
 * Run-level decision after an item was abandoned: 3 consecutive abandoned
 * items ⇒ stop the loop (v2/04 §3 — systemic problem; don't churn the
 * entire backlog into blocked).
 */
export function shouldStopAfterAbandonment(state: LadderState): boolean {
  return state.consecutiveAbandonedItems >= MAX_CONSECUTIVE_ABANDONED_ITEMS;
}
