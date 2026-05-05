// Pure helper for the conditional bmad-create-story decision invoked by
// `/devx` Phase 2 (dvx102). Closes the LEARN.md cross-epic regression
// where bmad-create-story was silently skipped 25/25 times in Phase 0
// (always for the same reason: spec ACs already covered the surface so a
// generated story would only re-encode them) — this helper makes the
// decision explicit, testable, and canary-gated.
//
// Surface:
//
//   shouldCreateStory(config, spec)
//     Pure decision over project.shape + AC count + story-file presence.
//     Independent of canary state — the canary controls whether the
//     decision is honored, not the decision itself. The contract from
//     dev/dev-dvx102-...md AC #1: returns invoke=false ONLY when shape is
//     `empty-dream` AND ACs ≥ 3 actionable AND no existing story file;
//     otherwise invoke=true with one of three documented reason strings.
//
//   readCanary(config)
//     Resolves `_internal.skip_create_story_canary` to a CanaryState.
//     Defaults to "off" (the post-dvx102 ship state) on missing or
//     unrecognized values.
//
//   effectivePhase2Action(canary, decision)
//     Combines (canary, helper decision) into the concrete action /devx
//     Phase 2 should take ("invoke" | "read-existing" | "skip") plus the
//     status-log fragment matching the spec AC #5 format (`phase 2:
//     canary=<state>, shouldCreateStory=<reason> → bmad-create-story
//     <SKIPPED|INVOKED>`). Story-file presence is encoded in
//     `decision.reason === "story-file-exists"`; the function does not
//     take a separate hasStoryFile parameter to avoid caller-desync.
//
// The 3 × 6 truth-table the spec AC #6 requires is exercised in
// test/devx-should-create-story.test.ts via shouldCreateStory + the
// effectivePhase2Action router.
//
// Spec: dev/dev-dvx102-2026-04-28T19:30-devx-conditional-create-story.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

export type CanaryState = "off" | "active" | "default";

export interface ShouldCreateStoryConfig {
  project?: { shape?: string };
  _internal?: { skip_create_story_canary?: string };
}

export interface ShouldCreateStorySpecInput {
  /** Count of `- [ ]` checkbox items under `## Acceptance criteria`. */
  acCount: number;
  /** Whether `_bmad-output/implementation-artifacts/story-<hash>.md` exists. */
  hasStoryFile: boolean;
}

export interface ShouldCreateStoryDecision {
  invoke: boolean;
  /**
   * One of:
   *   - "shape-not-empty-dream"
   *   - "story-file-exists"
   *   - "few-actionable-acs"
   *   - "project_shape=empty-dream + <N> ACs + no story file"  (skip case)
   * Kept as `string` to allow the formatted skip-case message; consumers
   * branch on `invoke` first.
   */
  reason: string;
}

export type Phase2Action = "invoke" | "skip" | "read-existing";

export interface EffectiveAction {
  /** Concrete step /devx Phase 2 should take. */
  action: Phase2Action;
  /**
   * Status-log line to append to the spec, per spec AC #5:
   *   `phase 2: canary=<state>, shouldCreateStory=<reason> → bmad-create-story <SKIPPED|INVOKED> [(detail)]`
   * "SKIPPED" can mean either "skipped by helper" (canary honored, decision was invoke=false)
   * or "skipped because story-file-exists supersedes". Detail parenthetical disambiguates.
   */
  statusLog: string;
}

const ACTIONABLE_AC_THRESHOLD = 3;

const VALID_CANARY: ReadonlySet<CanaryState> = new Set([
  "off",
  "active",
  "default",
]);

/**
 * Pure decision over project.shape + spec inputs. The 4 outcomes:
 *
 *   1. Story file already exists → invoke=true, reason="story-file-exists".
 *      (The skill body's existing "read existing" path handles this; the
 *      helper doesn't differentiate "create" from "read" — it just says
 *      "don't structurally short-circuit Phase 2".)
 *   2. Shape != "empty-dream" → invoke=true, reason="shape-not-empty-dream".
 *   3. Shape == "empty-dream" AND ACs < 3 → invoke=true,
 *      reason="few-actionable-acs". (Spec ACs are too thin to drive impl
 *      directly; let bmad-create-story expand them.)
 *   4. Shape == "empty-dream" AND ACs ≥ 3 AND no story file → invoke=false,
 *      reason="project_shape=empty-dream + <N> ACs + no story file". The
 *      LEARN.md cross-epic skip case, now structurally encoded.
 *
 * Order matters: case 1 (story-file-exists) wins over case 2/3/4 because
 * the existing-story short-circuit supersedes shape/AC checks. Case 2
 * wins over case 3/4 because non-empty-dream projects always need a
 * formal story regardless of AC count.
 */
export function shouldCreateStory(
  config: ShouldCreateStoryConfig,
  spec: ShouldCreateStorySpecInput,
): ShouldCreateStoryDecision {
  if (spec.hasStoryFile) {
    return { invoke: true, reason: "story-file-exists" };
  }
  const shape = config.project?.shape;
  if (shape !== "empty-dream") {
    return { invoke: true, reason: "shape-not-empty-dream" };
  }
  if (spec.acCount < ACTIONABLE_AC_THRESHOLD) {
    return { invoke: true, reason: "few-actionable-acs" };
  }
  return {
    invoke: false,
    reason: `project_shape=empty-dream + ${spec.acCount} ACs + no story file`,
  };
}

/**
 * Resolve the canary state from config. Defaults to "off" (post-dvx102
 * ship state) on missing OR unrecognized values — silently rejecting
 * typos protects against a hand-edit accidentally enabling the
 * conditional path before the canary is ready.
 */
export function readCanary(config: ShouldCreateStoryConfig): CanaryState {
  const raw = config._internal?.skip_create_story_canary;
  if (typeof raw === "string" && (VALID_CANARY as Set<string>).has(raw)) {
    return raw as CanaryState;
  }
  return "off";
}

/**
 * Combine canary state + helper decision into the effective Phase 2
 * action. The 3 × 6 = 18-cell truth-table the spec AC #6 tests:
 *
 *   - canary "off"       → helper decision LOGGED but NOT honored. Action
 *                          falls back to v0 behavior: read-existing if
 *                          story file present (decision.reason ==
 *                          "story-file-exists"), else invoke.
 *   - canary "active"    → helper decision IS honored. invoke=false →
 *                          action="skip" (short-circuit Phase 2). invoke=
 *                          true → action="invoke" (or "read-existing"
 *                          when reason=story-file-exists).
 *   - canary "default"   → identical to "active". The flag is
 *                          flag-deletable post-canary but until then
 *                          treated the same as "active".
 *
 * Note: `hasStoryFile` is encoded in the decision — `shouldCreateStory`
 * always returns `reason: "story-file-exists"` first when a story file
 * is present, before any shape/AC checks. So `decision.reason ==
 * "story-file-exists"` is the canonical signal here. Earlier drafts of
 * this function took `hasStoryFile` as a separate parameter, which
 * created a desync hazard if the caller computed it differently.
 */
export function effectivePhase2Action(
  canary: CanaryState,
  decision: ShouldCreateStoryDecision,
): EffectiveAction {
  const hasStoryFile = decision.reason === "story-file-exists";
  let action: Phase2Action;
  let outcome: string;

  if (hasStoryFile) {
    action = "read-existing";
    outcome = "SKIPPED (story-file-exists; read existing)";
  } else if (canary === "off") {
    action = "invoke";
    outcome = "INVOKED (canary=off; helper decision logged not honored)";
  } else if (decision.invoke) {
    action = "invoke";
    outcome = "INVOKED";
  } else {
    action = "skip";
    outcome = "SKIPPED (helper)";
  }

  const statusLog =
    `phase 2: canary=${canary}, shouldCreateStory=${decision.reason} → ` +
    `bmad-create-story ${outcome}`;
  return { action, statusLog };
}
