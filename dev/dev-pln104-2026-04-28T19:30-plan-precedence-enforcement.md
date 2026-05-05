---
hash: pln104
type: dev
created: 2026-04-28T19:30:00-07:00
title: Source-of-truth-precedence enforcement at planning time
from: _bmad-output/planning-artifacts/epic-devx-plan-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
blocked_by: [pln103]
branch: feat/dev-pln104
owner: /devx-2026-05-05
---

## Goal

When `/devx-plan` Phase 6 (party-mode) locks a decision conflicting with the plan frontmatter or a draft AC, the skill body explicitly updates the epic file's "Locked decisions" section AND propagates the override to spec ACs. `validate-emit` (pln103) catches the case where the epic locked-decision and spec AC disagree.

## Acceptance criteria

- [ ] `.claude/commands/devx-plan.md` Phase 6 section explicitly documents the override flow:
  1. Party-mode locks decision X.
  2. Skill checks decision X against draft epic ACs + spec ACs.
  3. If conflict: update epic file's "Locked decisions" with the override + status-log line; rewrite affected spec ACs to match.
  4. `validate-emit` runs at end of Phase 6; flags any remaining mismatches.
- [ ] Test fixture: a draft epic with AC "X" + a party-mode that flips to "not X". Run /devx-plan Phase 6 simulation; assert: epic file's locked-decisions records the override, spec AC reflects "not X", status log contains an override line.
- [ ] **Closes LEARN.md cross-epic pattern**: `[high] [docs] Source-of-truth precedence rule` — making it enforced at planning time, not at `/devx` claim time.

## Technical notes

- Source-of-truth precedence (highest to lowest): spec AC > epic locked decisions > plan frontmatter > devx.config.yaml > skill defaults. The override path always pushes the higher-priority artifact.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-05T00:00 — claimed by /devx (epic-devx-plan-skill)
