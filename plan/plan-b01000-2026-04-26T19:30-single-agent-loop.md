---
hash: b01000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Phase 1 — Single-agent core loop: /devx-plan + /devx + minimal /devx-manage"
status: deferred
from: docs/ROADMAP.md#phase-1--single-agent-core-loop-week-2
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [backend, infra]
blocked_by: [a01000]
---

## Goal

One worker at a time, full discipline, real PRs landing on `develop`. Manager runs but caps at N=1. Validates the spec-file-as-state contract before parallelism arrives in Phase 2/3.

## Scope

Five epics from [`ROADMAP.md § Phase 1`](../docs/ROADMAP.md#phase-1--single-agent-core-loop-week-2):

- `epic-devx-plan-skill` — `/devx-plan` from raw idea → DEV.md entries.
- `epic-devx-skill` — `/devx` claims, worktree, RGR, push, CI, merge.
- `epic-devx-manage-minimal` — `/devx-manage` v0: pick + spawn one worker, write `schedule.json` + `manager.json`, heartbeat. No restart-on-rot yet.
- `epic-pr-template` — `.github/pull_request_template.md` with spec link + mode stamp.
- `epic-promotion-gate-yolo-beta` — develop→main gate for YOLO + BETA modes.

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed.

## Acceptance criteria

- [ ] `/devx-plan "build X"` produces `DEV.md` entries with proper frontmatter chains.
- [ ] `/devx` no-args picks the top `[ ]`, runs to a merged PR on `develop`, marks `[x]`.
- [ ] Manager v0 supervises exactly one worker, restarts on plain crash (not yet on rot).
- [ ] PR template renders the spec-file link as the first line of every agent PR body.

## Status log

- 2026-04-26T19:30 — Phase 1 placeholder created
