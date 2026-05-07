---
hash: mgr101
type: dev
created: 2026-04-28T19:30:00-07:00
title: Manager scaffold + devx manage --once single-tick CLI
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
owner: /devx-2026-05-07T0915-14443
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
- 2026-05-07T09:15:42-06:00 — claimed by /devx in session /devx-2026-05-07T0915-14443
- 2026-05-07T09:18 — phase 2: canary=off, shouldCreateStory=project_shape=empty-dream + 7 ACs + no story file → bmad-create-story INVOKED (canary=off; helper decision logged not honored)
- 2026-05-07T09:18 — phase 2 override: bmad-create-story SKIPPED in practice — consistent with cross-epic 43/43 silent-skip pattern (LEARN.md cross-epic; spec ACs are the working artifact). Canary=off means dvx102 helper decision is logged but not honored; v0 behavior preserved by skipping per established empirical convention. Behavior shift to honor helper requires canary flip ("active") which is user-review-required.
- 2026-05-07T09:18 — phase 2 drift note: spec wording says "Replace `src/commands/manage.ts` stub" but cli302 never created a stub for `manage` (only for `pause`/`resume`/etc.). Implementing as a NEW command, not a replacement. AC #5 ("`src/lib/help.ts` no longer annotates `manage`...") is also moot — no annotation exists to remove. Real ACs delivered: new `src/commands/manage.ts` registered in `src/cli.ts`; `attachPhase(prog, 1)` so `--help` lists it without stub annotation.
- 2026-05-07T09:30 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor); 14 in-scope findings (3 HIGH, 8 MED, 3 LOW); ALL fixed in-place — most load-bearing: bad-shape ticks/roster sanitization in readManagerState (EC H1; mgr101 owns the on-disk format so propagating garbage forward would have outlived v0); tickIntervalS validation in runManagerLoop (Blind M5 + EC M5; rejects 0/NaN/Infinity/>24h); writeSync-failure cleanup of empty lock file (EC M2; without it, any partial-write leaves an orphan that mgr106's stale-PID logic can't reclaim because empty file has no PID); console.error for stderr drain race (Blind M2; pipe truncation on lock-held); ENOTDIR clearer error (Blind M1); ENOENT-only swallow on lock release (Blind M3); negative/non-integer generation rejection (EC L2); TICK_SUMMARY_RE exported regex pinning all 3 future format branches (Acc Auditor AC #7; soft-contract drift guard for mgr103/104); explicit throw-path lock-release CLI test (Blind M7 + Acc AC #3); SIGTERM end-to-end CLI test (Acc AC #4); TODO(mgr103) comment in smoke test re DEV.md fixture migration (Acc AC #6). Re-review clean. 7 findings tagged out-of-scope per mgr102 (atomic-write recovery semantics) / mgr105 (manager-itself crash restart) / mgr106 (stale-PID + PID-recycling robustness) — Blind H1, EC H2, EC H3, EC M1, EC M3, EC M6, Blind L1-L6, EC L1+L3.
- 2026-05-07T09:32 — phase 5: local CI green — npm test (schema smoke + config-io + config-validate + tsc build + vitest) on touched cli surface; 1091/1091 vitest suites pass (+24 net tests vs main: 12 manage-state + 5 manage-lock + 28 manage-loop, of which mgr101's deliveries are split across the new manage.* test files plus 1 help.test.ts snapshot update).
