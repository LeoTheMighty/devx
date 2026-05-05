---
hash: dvx102
type: dev
created: 2026-04-28T19:30:00-07:00
title: Conditional bmad-create-story with canary flag
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
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
