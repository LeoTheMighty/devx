---
hash: aud101
type: dev
created: 2026-04-26T19:35:00-07:00
title: Inventory BMAD modules + workflows
from: _bmad-output/planning-artifacts/epic-bmad-audit.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
branch: develop/dev-aud101
---

## Goal

Walk `_bmad/{core,bmm,tea}/` and produce a complete inventory of every workflow, skill, and agent — name + 1-line purpose — as the first section of `_bmad-output/planning-artifacts/bmad-audit.md`.

## Acceptance criteria

- [ ] `_bmad/core/`, `_bmad/bmm/`, `_bmad/tea/` walked exhaustively
- [ ] Every workflow has: module / path / name / one-line purpose (extracted from `workflow.yaml` description or first-heading of corresponding md file)
- [ ] BMAD module versions captured (read `_bmad/_cfg/manifest.yaml` or equivalent)
- [ ] Section 1 of `_bmad-output/planning-artifacts/bmad-audit.md` written

## Technical notes

- Inventory drift between docs and reality has been observed in Phase 2 research — treat the directory walk as authoritative; document discrepancies as risks (handed off to aud103).
- Don't classify yet — that's aud102. This story is *just* listing what exists.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
