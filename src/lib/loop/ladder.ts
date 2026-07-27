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
//   | infra-error          | rollback; backoff; NOT the      | consecutive-infra only   |
//   |                      | item's fault (dc7514)           | (never failures)         |
//   | permanent-error      | abort the whole loop NOW        | immediate abort          |
//   | commit-failure       | preserve; next iter = repair    | consecutive-failures     |
//
//   * maxConsecutiveFailures (default 3) on one item ⇒ abandon-item (the
//     driver releases the claim, flips the spec `[-]` blocked, PRESERVES the
//     worktree, records the path).
//   * MAX_CONSECUTIVE_ABANDONED_ITEMS (3) ⇒ stop-loop (systemic problem).
//     The streak counts PROGRESS-LESS abandonments plus failure-shaped tail
//     hand-offs (gh/CI outage — the driver maps tail `handed-off-failure`
//     through afterItemAbandoned too); an abandoned item that committed ≥1
//     successful iteration does NOT count (it was just big — the system
//     demonstrably works). merged / handed-off-ok reset the streak.
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
  | "infra-error"
  | "permanent-error"
  | "commit-failure";

/** Output-token floor below which a report-less worker death reads as "the
 *  session never really ran" — an environment failure, not the item's fault
 *  (dc7514: the hfi103 hangs produced ~32 tokens each against this floor). */
export const INFRA_OUTPUT_TOKEN_FLOOR = 1000;

/** N consecutive infra-errors ⇒ abort the RUN (the environment is broken;
 *  grinding the backlog through it just wrongly burns items). Not
 *  configurable — a safety rail, not a budget (same posture as
 *  MAX_CONSECUTIVE_ABANDONED_ITEMS). */
export const MAX_CONSECUTIVE_INFRA_ERRORS = 3;

/** Evidence that the worker PROCESS died report-less (dc7514). */
export interface InfraSignal {
  /** The worker call itself rejected (timeout kill / spawn failure) — as
   *  opposed to a session that ran to exit but produced an unusable report. */
  workerDied: boolean;
  /** Output tokens produced before the death — real per-message usage when
   *  the stream emitted any (debug-494590), else a chars/4 estimate; 0 for
   *  spawn failures where nothing was ever captured. */
  outputTokens: number;
  /** Machine-suspend time detected during the session (worker.ts heartbeat
   *  probe). Any positive value excuses a timeout kill: the ceiling fired
   *  against a slept machine, not a stuck item. */
  sleepGapMs: number;
}

export interface ClassifyInput {
  /** Validated report, when the worker produced one. */
  report?: {
    success: boolean;
    key_learnings: string[];
  };
  /** Worker process crashed / threw / report unrecoverable. */
  error?: { message: string };
  /** Present when the worker call rejected — routes the infra-error rung. */
  infra?: InfraSignal;
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

/** How much of the transcript tail the driver scans for permanent-error
 *  markers. An API-level credit/auth failure is always the LAST thing a
 *  dying `claude -p` prints; marker text in the middle of a transcript is
 *  far more likely the worked-on code itself (this very file's marker list,
 *  a test fixture, quoted docs). */
export const PERMANENT_ERROR_SCAN_TAIL_CHARS = 2000;

/**
 * Tail-bounded variant of {@link firstPermanentErrorMatch} (review finding
 * MED-3): scanning the WHOLE transcript false-positives whenever the code
 * under work contains marker strings (e.g. an iteration editing ladder.ts
 * echoes "credit balance is too low" into its transcript). Real
 * credit/auth exhaustion terminates the session, so the marker lands in
 * the final ~screenful. Callers must additionally corroborate (non-zero
 * exit OR no parseable report, after the report retry also failed) before
 * classifying permanent.
 */
export function firstPermanentErrorMatchInTail(
  text: string,
  tailChars: number = PERMANENT_ERROR_SCAN_TAIL_CHARS,
): string | null {
  if (typeof text !== "string" || text === "") return null;
  return firstPermanentErrorMatch(text.slice(-Math.max(1, tailChars)));
}

/**
 * Classify one finished iteration. Precedence (most-fatal first):
 *   permanent-error → infra-error → hard-error → commit-failure →
 *   reported-failure → no-op → success.
 *
 * No-op detection (v2/04 §2.4): a "success" with no file changes AND no new
 * learnings is counted as a failure — kills the burn-tokens-declaring-
 * victory failure mode.
 *
 * Infra-error (dc7514): a report-less worker DEATH (timeout kill, spawn
 * failure) that either spanned a machine suspend or produced near-zero
 * output AND left no file changes is an environment failure, not
 * attributable to the item — it must not burn the item's failure budget.
 * The filesChanged guard is load-bearing (review EC-HIGH-1, updated by
 * debug-494590): with stream-json accounting the kill path carries REAL
 * per-message output tokens, so a worked-then-hung session usually
 * exceeds the floor on tokens alone and is correctly charged as a
 * hard-error; the guard remains for kills that land before any usage
 * event (hung-at-startup and worked-then-hung both read near-zero there,
 * but only the latter leaves tracked changes in the tree). Permanent-
 * error still wins precedence (both abort the run; credits/auth is the
 * more actionable diagnosis).
 */
export function classifyIteration(input: ClassifyInput): IterationClass {
  if (input.error) {
    if (isPermanentErrorMessage(input.error.message)) return "permanent-error";
    if (
      input.infra !== undefined &&
      input.infra.workerDied &&
      (input.infra.sleepGapMs > 0 ||
        (input.infra.outputTokens < INFRA_OUTPUT_TOKEN_FLOOR &&
          !input.filesChanged))
    ) {
      return "infra-error";
    }
    return "hard-error";
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
  /** Consecutive infra-errors (report-less worker deaths) — never charged to
   *  the item; N of them abort the RUN (dc7514). */
  consecutiveInfraErrors: number;
  /** Consecutive abandoned items across the whole run. */
  consecutiveAbandonedItems: number;
}

export function emptyLadderState(): LadderState {
  return {
    consecutiveFailures: 0,
    consecutiveErrors: 0,
    consecutiveInfraErrors: 0,
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
 *   - infra-error is NOT the item's fault (dc7514): consecutiveFailures and
 *     consecutiveErrors are left untouched; only the infra streak grows.
 *     Any class where the worker demonstrably RAN (success, reported
 *     failure, even a hard error from an unusable report) resets the infra
 *     streak — the environment works.
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
      consecutiveInfraErrors: 0,
      consecutiveAbandonedItems: 0,
    };
  }
  if (cls === "infra-error") {
    return {
      consecutiveFailures: state.consecutiveFailures,
      consecutiveErrors: state.consecutiveErrors,
      consecutiveInfraErrors: state.consecutiveInfraErrors + 1,
      consecutiveAbandonedItems: state.consecutiveAbandonedItems,
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
    consecutiveInfraErrors: 0,
    consecutiveAbandonedItems: state.consecutiveAbandonedItems,
  };
}

/**
 * Fold an item abandonment into the run-level streak.
 *
 * `madeProgress` (review finding MED-4): an abandoned item that had ≥1
 * successful COMMITTED iteration does NOT increment the systemic streak —
 * a good iteration proves the worker/API/git pipeline works and the item
 * was simply bigger than its budget. Without this, three big-but-
 * progressing items would trip the "systemic problem" 3-stop and abort a
 * healthy night. The per-item counters still reset either way. A
 * progress-less abandonment (all iterations failed/errored) increments as
 * before. Note this is preserve-not-reset: progress on one item doesn't
 * erase evidence from neighbouring progress-less items.
 */
export function afterItemAbandoned(
  state: LadderState,
  opts: { madeProgress: boolean },
): LadderState {
  return {
    consecutiveFailures: 0,
    consecutiveErrors: 0,
    consecutiveInfraErrors: 0,
    consecutiveAbandonedItems: opts.madeProgress
      ? state.consecutiveAbandonedItems
      : state.consecutiveAbandonedItems + 1,
  };
}

/** Fold a successfully-finished item (acs_met → tail) into the run streak. */
export function afterItemCompleted(state: LadderState): LadderState {
  return {
    consecutiveFailures: 0,
    consecutiveErrors: 0,
    consecutiveInfraErrors: 0,
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
  | { kind: "abort-loop"; reason: string }
  /** dc7514: the environment (not the item) is broken — abort the RUN and
   *  roll the in-flight item's claim back to ready. */
  | { kind: "abort-run-environment"; reason: string };

export interface LadderConfig {
  maxConsecutiveFailures: number;
  backoffMs: number[];
}

/**
 * Decide the loop's next move given the iteration class and the state AFTER
 * the reducer ran. Precedence:
 *
 *   1. permanent-error → abort-loop (never grind a dead API until dawn).
 *   2. infra-error → abort-run-environment at the streak cap, else backoff
 *      (indexed by consecutiveInfraErrors — an environment blip may clear;
 *      a broken one trips the cap). Never reaches the abandon-item rung:
 *      infra iterations don't touch consecutiveFailures (dc7514).
 *   3. consecutiveFailures ≥ max → abandon-item.
 *   4. commit-failure → repair-iteration (the one no-rollback path).
 *   5. hard-error → backoff(index = consecutiveErrors - 1, clamped).
 *   6. everything else → continue.
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
  if (cls === "infra-error") {
    if (state.consecutiveInfraErrors >= MAX_CONSECUTIVE_INFRA_ERRORS) {
      return {
        kind: "abort-run-environment",
        reason: `environment failure: ${state.consecutiveInfraErrors} consecutive report-less worker deaths (timeout/spawn, ~zero output) — the item is not at fault; aborting the run`,
      };
    }
    const backoff =
      cfg.backoffMs.length > 0 ? cfg.backoffMs : [60_000, 120_000, 240_000];
    const index = Math.min(
      Math.max(state.consecutiveInfraErrors - 1, 0),
      backoff.length - 1,
    );
    return { kind: "backoff", ms: backoff[index], index };
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
