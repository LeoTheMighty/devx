---
hash: mgr105
type: dev
created: 2026-04-28T19:30:00-07:00
title: Plain-crash restart logic + max-restarts-per-spec gate
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [mgr104]
branch: feat/dev-mgr105
---

## Goal

Implement crash detection + backoff respawn + max-restarts-per-spec gate. Closes the loop on plain process crashes (exit code != 0); rot detection is Phase 2.

## Acceptance criteria

- [ ] `child.on("exit")` handler updates `manager.json` atomically: clears the roster slot; on `code !== 0`, increments `crash_count` and re-queues the spec for next tick.
- [ ] Backoff respected: `worker_crash_backoff_s: [10, 30, 90, 300]` from devx.config.yaml — `crash_count == 1 → 10s; == 2 → 30s; ...; > 4 → 300s`. Reconcile compares wall-clock to `last_exit_at + backoff[crash_count]` before respawning.
- [ ] After `manager.max_restarts_per_spec` (default 5) consecutive crashes for the same spec: mark spec `blocked` in DEV.md (`[/]`→`[-]`), set spec frontmatter `status: blocked`, append status-log line `manager: max restarts exceeded (5x exit-<lastCode>)`, append INTERVIEW.md entry asking the user to investigate.
- [ ] Integration test: stub `claude` binary that always exits 42; assert respawn cycle (crash 1 → wait 10s → respawn → crash 2 → wait 30s → ... → crash 5 → mark blocked + INTERVIEW).
- [ ] Test uses fake-timers / wall-clock mocks to avoid real backoff waits.
- [ ] **Locked from party-mode (Dev lens):** Manager-restart PID-recovery on init — every roster entry's PID is checked via `process.kill(pid, 0)` (signal 0 = check existence); dead PIDs trigger a synthetic exit event with code = "manager-restart-detected" and increment `crash_count` accordingly. Lost-exit events are recovered.
- [ ] **Locked from party-mode (Murat lens):** backoff respect is unit-tested via `reconcile.ts`'s pure decision (given `{last_exit_at, crash_count, now}` → "spawn" or "wait"). Integration test verifies backoff is enforced in `loop.ts` but doesn't measure timing precision (real clock with shortened `tickIntervalS`).

## Technical notes

- crash_count resets on a successful run (exit 0 with spec → done).

## Status log

- 2026-04-28T19:30 — created by /devx-plan
