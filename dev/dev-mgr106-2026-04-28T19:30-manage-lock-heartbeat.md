---
hash: mgr106
type: dev
created: 2026-04-28T19:30:00-07:00
title: Manager lock + heartbeat + SIGTERM-clean
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-05-07T1631-26321
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
- 2026-05-07T16:31:40-06:00 — claimed by /devx in session /devx-2026-05-07T1631-26321
- 2026-05-07T16:32:00-06:00 — phase 2: canary=off, shouldCreateStory=project_shape=empty-dream + 8 ACs + no story file → bmad-create-story SKIPPED (canary=off; helper decision logged not honored; v0 behavior — proceeding with spec ACs as working artifact per CLAUDE.md cross-epic pattern reaffirmed in every retro to date)
- 2026-05-07T16:51:00-06:00 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) on the lock+pid-uptime surface (~430 LoC production); BH found 4 actionable issues, EC enumerated all branches with 5 actionable gaps, AA cleared 6/8 ACs MET + 2 NOTE (literal-spec wording mismatches: Promise<>-vs-sync, platformDetect-vs-defaultDetectOs); 4 fixes applied in-place — most load-bearing: empty/whitespace lock content treated as conservative held instead of stale (BH-H3 — closes the open→write race window where a peer reading mid-write would have reaped the new lock and produced a two-manager scenario); double-close fd protection via `safeClose` + `closed` flag (BH-H4 — kernels recycle fd numbers, double-close lands on unrelated open file); strict-digit regex validation in parseEtimeToSeconds (BH-H5 — Number.parseInt would silently accept "5e2:00" as 5 minutes); whitespace-only acquired_at rejected by parseLockBody (EC — would have fallen through to held-forever even on dead-PID); +4 net tests; re-review clean (1307 passing, was 1303).
- 2026-05-07T16:55:00-06:00 — phase 7: PR #58 opened against main: https://github.com/LeoTheMighty/devx/pull/58 (rendered via `devx pr-body`; no unresolved placeholders).
- 2026-05-07T16:55:30-06:00 — phase 7: CI red on macos-latest — 2 mgr101 baseline tests in `test/manage-lock.test.ts` failed (`acquireManagerLock > throws ManagerLockHeldError when lock is already held` + `... surfacing the lock file path`). Root cause: `ps -o etime=` 1-second resolution → probe returns `now()` for a < 1s old process, trips recycling cross-check on every same-process re-acquire. Fix: 2s grace window in `classifyExistingLock` (subsumes etime resolution + clock jitter; real PID recycling involves seconds-to-minutes deltas). +2 net regression tests pinning grace bounds; 1309 passing locally. Commit 38b3b8b pushed.
- 2026-05-07T17:00:00-06:00 — merged via PR #58 (squash → 1a0fff4). Closes epic-devx-manage-minimal 6/7 — only mgrret remains.
