// Review-hold check (v2t101) — the D-5 merge-tail gate from
// v2/07-decisions.md: "YOLO auto-merge stays the default; review becomes
// possible, not mandatory: a `devx: hold` comment or a requested-changes
// review before CI-green blocks the merge tail; silence merges as today."
//
// Consumed by /devx Phase 8 AFTER `devx merge-gate <hash>` says merge:true —
// the hold check is a /devx-loop discipline (pause THIS merge for the human),
// not a mode rule, so it deliberately lives beside the advice-array routing
// (auto-merge-action.ts) rather than inside mergeGateFor(): merge-gate
// answers "may this merge under the mode?", check-hold answers "did the
// human ask us to wait?". Under BETA/PROD the requested-changes half is
// already a merge-gate signal (blockingReviewComments); under YOLO this is
// the only review brake — and silence merges.
//
// Two hold triggers, checked over `gh pr view --json comments,reviews`:
//   (a) any PR conversation comment (or review body) containing the
//       `devx: hold` marker;
//   (b) an unresolved requested-changes review — latest review per reviewer
//       is CHANGES_REQUESTED (same dismissal semantics as merge-gate's
//       blockingReviewCount, which we reuse rather than duplicate).
//
// Release is the normal GitHub flow: dismiss/approve the review, or reply
// and delete/edit the hold comment. Re-running the check picks that up.
//
// Known bounds (documented, accepted for v1 — self-review findings Blind
// Hunter #11 / Edge Case Hunter #4):
//   • `gh pr view --json comments,reviews` returns a capped page (~100 of
//     each, no pagination). A hold buried past the cap on a very chatty PR
//     would be missed. Solo-YOLO PRs are nowhere near the bound; revisit
//     with `gh api --paginate` when multi-agent PRs get chatty.
//   • Inline review-THREAD comments are not part of either JSON field — a
//     `devx: hold` typed only into an inline diff comment doesn't trigger.
//     Conversation comments + review bodies (what D-5 describes) do.
//   • A CHANGES_REQUESTED review whose author account was deleted
//     (author: null) is skipped — inherited from merge-gate's
//     blockingReviewCount semantics.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md
// Design: v2/03-review-tour.md §4; D-5 in v2/07-decisions.md

import { blockingReviewCount } from "../../commands/merge-gate.js";
import { type Exec, realExec } from "../tour/exec.js";

/** The literal marker a human drops in a PR comment to block the merge
 *  tail. Matched case-insensitively with flexible whitespace after the
 *  colon (`devx:  hold` still holds) — a human typing convention, not a
 *  machine protocol, so be forgiving. */
export const HOLD_MARKER = "devx: hold";
const HOLD_RE = /devx:\s*hold/i;

export interface HoldCheckResult {
  hold: boolean;
  /** Human-readable trigger, present iff hold is true. */
  reason?: string;
}

export class HoldCheckError extends Error {
  readonly stage: "gh-view" | "gh-parse";
  constructor(stage: HoldCheckError["stage"], message: string) {
    super(`hold check failed at stage '${stage}': ${message}`);
    this.name = "HoldCheckError";
    this.stage = stage;
  }
}

export interface HoldCheckOpts {
  /** Project repo root — gh resolves the repo from here. */
  repoRoot: string;
  /** Test seam — replacement for the real `gh` shell-out. */
  exec?: Exec;
}

interface GhComment {
  body?: string;
  author?: { login?: string } | null;
}

interface GhReview {
  state?: string;
  body?: string;
  author?: { login?: string } | null;
}

/** Does a body carry the hold marker? Exported for direct testing. */
export function containsHoldMarker(body: string): boolean {
  return HOLD_RE.test(body);
}

export function checkHold(
  prNumber: number,
  opts: HoldCheckOpts,
): HoldCheckResult {
  const exec = opts.exec ?? realExec;

  const r = exec(
    "gh",
    ["pr", "view", String(prNumber), "--json", "comments,reviews"],
    { cwd: opts.repoRoot },
  );
  if (r.exitCode !== 0) {
    throw new HoldCheckError(
      "gh-view",
      `gh pr view ${prNumber} exited ${r.exitCode}: ${r.stderr.trim() || "(no stderr)"}`,
    );
  }

  let payload: { comments?: unknown; reviews?: unknown };
  try {
    const j = JSON.parse(r.stdout || "{}");
    if (!j || typeof j !== "object" || Array.isArray(j)) {
      throw new Error("non-object payload");
    }
    payload = j as { comments?: unknown; reviews?: unknown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HoldCheckError(
      "gh-parse",
      `gh pr view returned malformed JSON: ${msg}`,
    );
  }

  const comments: GhComment[] = Array.isArray(payload.comments)
    ? (payload.comments as GhComment[])
    : [];
  const reviews: GhReview[] = Array.isArray(payload.reviews)
    ? (payload.reviews as GhReview[])
    : [];

  // (a) `devx: hold` marker — conversation comments first, then review
  // bodies (a hold typed into a review's summary text counts too).
  for (const c of comments) {
    if (typeof c.body === "string" && containsHoldMarker(c.body)) {
      const who = c.author?.login ? ` by ${c.author.login}` : "";
      return {
        hold: true,
        reason: `'${HOLD_MARKER}' comment${who} on PR #${prNumber}`,
      };
    }
  }
  for (const rv of reviews) {
    if (typeof rv.body === "string" && containsHoldMarker(rv.body)) {
      const who = rv.author?.login ? ` by ${rv.author.login}` : "";
      return {
        hold: true,
        reason: `'${HOLD_MARKER}' review${who} on PR #${prNumber}`,
      };
    }
  }

  // (b) unresolved requested-changes — reuse merge-gate's latest-review-
  // per-reviewer dismissal semantics (don't duplicate business logic).
  const blocking = blockingReviewCount(reviews);
  if (blocking > 0) {
    const noun = blocking === 1 ? "review" : "reviews";
    return {
      hold: true,
      reason: `${blocking} unresolved requested-changes ${noun} on PR #${prNumber}`,
    };
  }

  // D-5: silence merges.
  return { hold: false };
}
