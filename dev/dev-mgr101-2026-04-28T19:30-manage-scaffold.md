---
hash: mgr101
type: dev
created: 2026-04-28T19:30:00-07:00
title: Manager scaffold + devx manage --once single-tick CLI
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [dvxret]
branch: feat/dev-mgr101
---

## Goal

Replace `src/commands/manage.ts` stub with a real implementation. Add `runManagerOnce()` and `runManagerLoop()` in `src/lib/manage/loop.ts`. Single-tick is testable; loop is exercised by OS supervisor unit.

## Acceptance criteria

- [ ] `src/lib/manage/loop.ts` exports `runManagerOnce()` and `runManagerLoop({tickIntervalS, signal})`.
- [ ] `src/commands/manage.ts` (replacing stub) registers `devx manage` with `--once` flag.
- [ ] `--once` mode: acquires lock, runs one tick, releases lock, exits 0.
- [ ] Default (no flags): runs loop until SIGTERM; AbortSignal propagates the signal; pending tick drains; exits 0.
- [ ] `src/lib/help.ts` no longer annotates `manage` with `(coming in Phase 2 — epic-devx-manage-minimal)`.
- [ ] Smoke test: `devx manage --once` against an empty `.devx-cache/state/` produces `manager.json` + `heartbeat.json` (no spawn since fixture DEV.md has no ready specs), exits 0.
- [ ] **Locked from party-mode (PM lens):** `devx manage --once` prints a one-line stdout summary per tick: `tick <generation>: spawned <hash>` | `tick <generation>: no work` | `tick <generation>: maintained <hash> (pid <pid>)`. Grep-able trail in launchd log.

## Technical notes

- Loop driver is ~150 lines of TS — exhaustively testable.
- Reuse `logDir()` from `src/lib/supervisor.ts` for log-file paths.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
