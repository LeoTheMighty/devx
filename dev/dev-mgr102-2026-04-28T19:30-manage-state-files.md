---
hash: mgr102
type: dev
created: 2026-04-28T19:30:00-07:00
title: State persistence: schedule.json + manager.json + heartbeat.json with atomic writes
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [mgr101]
branch: feat/dev-mgr102
---

## Goal

Ship `src/lib/manage/state.ts` with schemas + IO for `.devx-cache/state/`. Atomic writes (`*.tmp` + `rename`); crash-mid-write recovery covered by tests.

## Acceptance criteria

- [ ] `src/lib/manage/state.ts` exports `readState()`, `writeState(state)`, `writeHeartbeat()`. All writes atomic.
- [ ] Schemas:
  - `schedule.json` — desired roster: `{generation, computed_at, slots: [{spec_hash, worker_class, priority, since}], hard_cap: 1}`.
  - `manager.json` — actual state: `{generation, started_at, model, ticks: [...recent], roster: [{pid, spec_hash, worker_class, started_at, crash_count, last_exit_code?}], lock: {pid, acquired_at}}`. Bounded ≤ 1 MB by trimming `ticks` log to last 100.
  - `heartbeat.json` — `{ts, pid, generation}`. Single-line replace.
- [ ] Crash-mid-write recovery: leftover `*.tmp` detected on read; either ignored (if `<state>.json` exists) or used (rename half-completed before crash). Tests cover both paths.
- [ ] Tests: read-empty (no file → empty default state); read-leftover-tmp; write+read roundtrip; concurrent-write protection (atomic rename guarantees it).
- [ ] Reuses the supervisor-internal.ts SHA-256-on-disk idempotency pattern from sup* (LEARN.md cross-epic).

## Technical notes

- `*.tmp` + `rename` is the same primitive as supervisor-internal.ts's installer pattern — extends to manager state with no new code.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
