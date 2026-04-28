---
hash: mgr104
type: dev
created: 2026-04-28T19:30:00-07:00
title: Spawn one worker (hard cap N=1) + claude /devx <hash> subprocess
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [mgr103]
branch: feat/dev-mgr104
---

## Goal

Ship `src/lib/manage/spawn.ts → spawnWorker(hash, model)`. Wraps `child_process.spawn` with detached child + log piping + manager.json PID registration.

## Acceptance criteria

- [ ] `src/lib/manage/spawn.ts` exports `spawnWorker(hash, model): Promise<{pid}>`.
- [ ] Implementation: `child_process.spawn("claude", ["/devx", hash], {detached: true, stdio: ["ignore", logFd, logFd]})`.
- [ ] Stdout + stderr piped to `<logDir>/worker-<hash>.log` (rotated at 1 MB; on rotation, rename to `worker-<hash>.log.<iso-ts>`).
- [ ] PID + start time persisted to `manager.json` atomically before `spawnWorker` returns.
- [ ] Hard-cap test: fixture state with one running worker + a `desiredSpawn` for a second hash produces the "Phase 1 hard cap" error from `reconcile.ts`. Spawn never called.
- [ ] Integration test: `runManagerOnce()` against fixture DEV.md with one ready spec + a stub `claude` binary (shell script that sleeps 5s, exits 0); assert PID recorded, log file written, exit-0 detected on next tick → slot released.

## Technical notes

- `logDir()` reused from `src/lib/supervisor.ts`.
- Detached child means Manager death does not kill workers — they continue + are reaped by OS supervisor on next Manager restart.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
