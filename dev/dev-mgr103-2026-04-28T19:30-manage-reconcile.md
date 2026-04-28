---
hash: mgr103
type: dev
created: 2026-04-28T19:30:00-07:00
title: Reconcile loop: read backlogs + compute diff + detect unblocks
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [mgr102]
branch: feat/dev-mgr103
---

## Goal

Ship `src/lib/manage/reconcile.ts → reconcile(state, backlogSnapshot): {desiredSpawns, desiredKills, statusLogUpdates}` as the pure reconcile function. Hard cap = 1 enforced inside.

## Acceptance criteria

- [ ] `src/lib/manage/reconcile.ts` exports `reconcile(state, backlogSnapshot)`.
- [ ] Inputs: current `manager.json` state + parsed DEV.md (rows + statuses) + parsed INTERVIEW.md (answered Qs) + parsed MANUAL.md (checked items).
- [ ] Outputs:
  - `desiredSpawns`: at most one `(spec_hash, worker_class, model)` triple. Empty if hard cap full or no ready specs.
  - `desiredKills`: PIDs whose target spec reached `done` / `blocked` / `deleted` / superseded.
  - `statusLogUpdates`: appended-line directives `(spec_hash, line)` for state transitions Manager observed (e.g., `manager: detected MANUAL M1.2 checked → spec dev-a10004 unblocked`).
- [ ] Pure function — no I/O; tests cover ≥ 8 fixtures: empty backlog; one ready; one ready + worker running; INTERVIEW unblock; MANUAL unblock; superseded entry; blocked-by chain; cap full.
- [ ] **Hard cap = 1** as constant `HARD_CAP_PHASE_1` with comment block: "Phase 1: hard cap. Phase 3 epic-capacity-management replaces this with `capacity.max_concurrent` from devx.config.yaml. Do not change without bumping the phase reference."
- [ ] Test asserts spawn-2 attempt is rejected with the exact "Phase 1 hard cap: cannot spawn second worker (running: <hash1>)" error message.
- [ ] **Locked from party-mode (Architect lens):** backlog parsing extracted into `src/lib/backlog/parse.ts` (pure parser, returns structured rows). Shared with dvx101's claim path. Phase 2's epic-events-stream extends with event emission; Phase 1 ships parsing only.

## Technical notes

- Reconcile is the load-bearing logic; spawn/kill execution is mgr104+105.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
