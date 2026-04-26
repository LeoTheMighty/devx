---
hash: e02000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Phase 10 — Polish + dogfood"
status: deferred
from: docs/ROADMAP.md#phase-10--polish--dogfood-week-9
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [frontend, backend, infra]
blocked_by: [d02000]
---

## Goal

Continuous polish — empty states, stuck-agent escalation, CLAUDE.md compaction, monorepo support, eject CLI, public README polish. Run incrementally throughout; this plan exists to capture remainders for a final pass.

## Scope

Six epics from [`ROADMAP.md § Phase 10`](../docs/ROADMAP.md#phase-10--polish--dogfood-week-9):

- `epic-empty-state-copy` — first-impression copy for every backlog file + INTERVIEW-empty + MANUAL-empty.
- `epic-stuck-agent-detection` — worker unchanged for >2h or `max_restarts_per_spec` exceeded → MANUAL escalation.
- `epic-claude-md-compaction` — LearnAgent quarterly compact pass when CLAUDE.md > 1000 lines.
- `epic-monorepo-config` — `devx.config.yaml → projects:` per-subtree commands.
- `epic-eject-cli` — `devx eject` removes all devx-specific state, leaves vanilla BMAD project.
- `epic-public-readme-pass` — final README polish; honest-ROI numbers calibrated against real dogfood data.

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed.

## Acceptance criteria

- [ ] Fresh devx-init repo has friendly empty-state copy in every backlog file.
- [ ] Eject command leaves a working BMAD project; `bmad` slash commands still operate.
- [ ] Public README claim numbers (5min init, 30min first feature, 2-week felt benefit) hit on dogfood.

## Status log

- 2026-04-26T19:30 — Phase 10 placeholder created
