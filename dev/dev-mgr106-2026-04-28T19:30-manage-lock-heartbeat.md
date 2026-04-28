---
hash: mgr106
type: dev
created: 2026-04-28T19:30:00-07:00
title: Manager lock + heartbeat + SIGTERM-clean
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [mgr101]
branch: feat/dev-mgr106
---

## Goal

Ship `src/lib/manage/lock.ts → acquireManagerLock()` (O_EXCL atomic create with stale-PID detection). Heartbeat writes per tick. SIGTERM-clean exit drains pending tick + releases lock.

## Acceptance criteria

- [ ] `src/lib/manage/lock.ts` exports `acquireManagerLock(): Promise<{release}>`. O_EXCL create on `.devx-cache/locks/manager.lock` writing `{pid, acquired_at}`.
- [ ] Stale-PID detection: lock exists but `pid` not in `ps` → log WARN, delete file, retry acquire once. Bounded retry to prevent infinite loop.
- [ ] Heartbeat: `loop.ts` writes `heartbeat.json` (single-line replace) at end of each tick. Format: `{ts: <iso>, pid, generation}`.
- [ ] SIGTERM handler in `manage.ts` signals the loop's AbortController; loop drains current tick + releases lock + exits 0. Exits non-0 if SIGTERM during init (couldn't acquire lock yet).
- [ ] Test: spawn `devx manage` as a subprocess; verify `manager.lock` exists; SIGTERM; verify `manager.lock` removed; verify exit 0.
- [ ] Heartbeat format pinned for Phase 2 mutual-watchdog consumption.
- [ ] **Locked from party-mode (Infra lens):** stale-PID detection cross-checks PID-recycling — lock file's `acquired_at` timestamp vs `process.uptime` of the PID. If PID exists but its process started after `acquired_at`, treat as recycled → log WARN, delete lock, retry. Per-platform: macOS `ps -o etime= -p <pid>`; Linux `/proc/<pid>/stat`; WSL `ps -o lstart -p <pid>`. Reuse `supervisor.ts → platformDetect()` to dispatch.
- [ ] **Locked from party-mode (Murat lens):** SIGTERM-clean drain semantics — SIGTERM sets the AbortController; current tick's promise chain runs to completion (spawn or no-spawn); no new tick starts; lock released; exit 0. Test uses fake "slow tick" (mocked spawn taking 500ms) and asserts SIGTERM mid-tick still produces clean shutdown.

## Technical notes

- Phase 2's mutual-watchdog reads `heartbeat.json` freshness; v0 just writes correctly.
- Lock format pinned for Phase 3 reuse.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
