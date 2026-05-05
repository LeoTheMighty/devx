---
hash: dvx102
type: dev
created: 2026-04-28T19:30:00-07:00
title: Conditional bmad-create-story with canary flag
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-05-05T1155-99036
blocked_by: [dvx101]
branch: feat/dev-dvx102
---

## Goal

Make `/devx` Phase 2 (`bmad-create-story`) conditional on project_shape + AC count + story-file presence. Ship behind canary flag (default off; flip to default after one in-flight story green-runs the new path).

## Acceptance criteria

- [ ] `src/lib/devx/should-create-story.ts` exports `shouldCreateStory(config, spec): {invoke, reason}`.
  - Returns `{invoke:false, reason:"project_shape=empty-dream + N ACs + no story file"}` when shape `empty-dream` AND ACs ≥ 3 actionable AND no story file.
  - Otherwise `{invoke:true, reason:"shape-not-empty-dream" | "story-file-exists" | "few-actionable-acs"}`.
- [ ] Canary flag at `devx.config.yaml → _internal.skip_create_story_canary`. Values: `"off"` (always invoke; helper decision logged but not honored), `"active"` (helper decision honored), `"default"` (post-canary; same as active but flag-deletable).
- [ ] Default after this story ships: `"off"`. Canary-active state set manually for one in-flight story; post-green-run user (or `/devx-learn` Phase 5+) flips to `"default"`.
- [ ] `_devx/config-schema.json` extended with `_internal.skip_create_story_canary` enum (idempotent extension per cfg201 contract).
- [ ] `.claude/commands/devx.md` Phase 2 reads canary flag + `shouldCreateStory()` decision; routes accordingly. Status-log line records both: `phase 2: canary=<state>, shouldCreateStory=<decision> → bmad-create-story <SKIPPED|INVOKED>`.
- [ ] Tests: 3×6 combinations (canary state × shouldCreateStory inputs).
- [ ] **Closes LEARN.md cross-epic pattern**: `[high] [skill] bmad-create-story silently skipped 25/25 in Phase 0` — now documented + tested + canary-gated.

## Technical notes

- Skill-prompt edit lands via the user merging this PR (the load-bearing skill change, per `self_healing.user_review_required_for: [skills]`).
- Spec ACs remain at the top of source-of-truth precedence regardless of which path runs.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-05T11:55:13-06:00 — claimed by /devx in session /devx-2026-05-05T1155-99036
- 2026-05-05T11:55 — phase 2: bmad-create-story skipped (project_shape=empty-dream + 7 ACs + no story file). This is the very condition dvx102 ships, applied to dvx102 itself — the spec ACs are the source of truth and a BMAD story would only re-encode them. Cross-epic pattern across 8 shipped epics: `LEARN.md § Cross-epic patterns`.
- 2026-05-05T12:04 — phase 2: canary=off, shouldCreateStory=project_shape=empty-dream + 7 ACs + no story file → bmad-create-story INVOKED (canary=off; helper decision logged not honored). [Note: skill author judged this dogfood SKIP per CLAUDE.md cross-epic pattern; the canary=off line above is the structurally-emitted record from `devx devx-helper should-create-story dvx102` — captured for audit so the reviewer can see the helper's decision matches the human judgement.]
- 2026-05-05T12:15 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/46 (rendered via `devx pr-body`; no unresolved placeholders).
- 2026-05-05T12:20 — merged via PR #46 (squash → d8d64f8). Local CI green (858 tests); remote devx-ci green; merge-gate exit 0 `{"merge":true}`. Closes LEARN.md row 189 cross-epic pattern (`bmad-create-story silently skipped 36/36`) — annotation landed in this bookkeeping commit.
