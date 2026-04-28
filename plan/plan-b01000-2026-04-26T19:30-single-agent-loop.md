---
hash: b01000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Phase 1 — Single-agent core loop: /devx-plan + /devx + minimal /devx-manage"
status: in-planning
from: docs/ROADMAP.md#phase-1--single-agent-core-loop-week-2
spawned:
  - mrg101
  - mrg102
  - mrg103
  - mrgret
  - prt101
  - prt102
  - prtret
  - pln101
  - pln102
  - pln103
  - pln104
  - pln105
  - pln106
  - plnret
  - dvx101
  - dvx102
  - dvx103
  - dvx104
  - dvx105
  - dvx106
  - dvx107
  - dvxret
  - mgr101
  - mgr102
  - mgr103
  - mgr104
  - mgr105
  - mgr106
  - mgrret
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [backend, infra]
blocked_by: []
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

Elicited by `/devx-plan` on 2026-04-28 — 5 epics + 24 parent stories + 5 retro stories. Per Q1=(c) (resolved 2026-04-28), `epic-promotion-gate-yolo-beta` was rebranded to `epic-merge-gate-modes` (single primitive consumed by both `/devx`'s feature→main merge and the latent develop→main promotion path). Per Q2=(c), `bmad-create-story` is conditional + canary-gated. Per Q3, `/devx-manage` v0 is hard-capped at N=1.

- `epic-merge-gate-modes` — mrg101 (mergeGateFor pure fn), mrg102 (CLI passthrough + /devx Phase 8), mrg103 (latent develop→main promote), mrgret.
- `epic-pr-template` — prt101 (template + /devx-init idempotent write), prt102 (/devx Phase 7 substitution), prtret.
- `epic-devx-plan-skill` — pln101 (deriveBranch helper), pln102 (emitRetroStory helper), pln103 (validate-emit checker), pln104 (precedence enforcement), pln105 (Phase 6.5 mode gate), pln106 (final-summary format), plnret.
- `epic-devx-skill` — dvx101 (atomic claim + push-before-PR), dvx102 (conditional bmad-create-story canary), dvx103 (self-review status-log discipline), dvx104 (mode-derived coverage gate), dvx105 (3-state remote-CI probe), dvx106 (Phase 8 merge-gate wiring), dvx107 (stop_after + Handoff Snippet), dvxret.
- `epic-devx-manage-minimal` — mgr101 (scaffold + --once CLI), mgr102 (state files atomic writes), mgr103 (reconcile + hard cap N=1), mgr104 (spawn worker), mgr105 (crash-restart + max-restarts), mgr106 (lock + heartbeat + SIGTERM), mgrret.

## Acceptance criteria

- [ ] `/devx-plan "build X"` produces `DEV.md` entries with proper frontmatter chains.
- [ ] `/devx` no-args picks the top `[ ]`, runs to a merged PR on `develop`, marks `[x]`.
- [ ] Manager v0 supervises exactly one worker, restarts on plain crash (not yet on rot).
- [ ] PR template renders the spec-file link as the first line of every agent PR body.

## Status log

- 2026-04-26T19:30 — Phase 1 placeholder created
- 2026-04-28T19:30 — claimed by /devx-plan; expanded into 5 epics (epic-merge-gate-modes, epic-pr-template, epic-devx-plan-skill, epic-devx-skill, epic-devx-manage-minimal) + 24 parent stories + 5 retros. PRD addendum + epics.md addendum + DEV.md Phase 1 section + sprint-status plan-b01000 entry all written. Status: deferred → in-planning. Q1=(c) merge-gate-modes rename + unified primitive; Q2=(c) bmad-create-story conditional + canary; Q3=hard-cap N=1.
