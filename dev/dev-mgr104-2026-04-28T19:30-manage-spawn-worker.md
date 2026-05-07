---
hash: mgr104
type: dev
created: 2026-04-28T19:30:00-07:00
title: Spawn one worker (hard cap N=1) + claude /devx <hash> subprocess
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-05-07T1143-94008
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
- 2026-05-07T11:43:22-06:00 — claimed by /devx in session /devx-2026-05-07T1143-94008
- 2026-05-07T11:44 — phase 2: canary=off, shouldCreateStory=project_shape=empty-dream + 6 ACs + no story file → bmad-create-story SKIPPED (canary=off; cross-epic empirical pattern across 9 prior epics — spec ACs are working artifact; tracked in LEARN.md § Cross-epic patterns)
- 2026-05-07T12:03 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) on 559-LoC production surface; 6 findings (2 HIGH, 3 MED, 1 LOW); ALL fixed in-place — most load-bearing fix: loop.ts roster-overwrite race (BH#1 + EC#F1) where a fast-exiting child's on-exit handler could be silently overwritten by the loop's tick-write, resurrecting a dead PID into the roster; restructured loop.ts to read fresh state at the write boundary instead of caching the post-spawn snapshot. Other fixes: hash-format regex guard against path traversal + argv injection (BH#2 + EC#F8), HOME="" fallthrough using `||` not `??` (EC#F4), child.pid snapshot before on-exit listener (BH#4), rotation timestamp collision counter (EC#F5), stale state.model overwrite (EC#F10). Re-review clean (1217 tests pass; +13 net for the review fixes — 10 hash-validator negatives + 1 rotation collision + 1 HOME-fallthrough + 1 race regression). Acceptance Auditor found 6/6 ACs MET (one minor architectural divergence on supervisor.ts logDir reuse documented inline).
- 2026-05-07T12:05 — phase 7: PR #56 opened against main: https://github.com/LeoTheMighty/devx/pull/56 (rendered via `devx pr-body`; no unresolved placeholders).
- 2026-05-07T12:08 — phase 7: remote CI run 25513388534 failed on `npm run typecheck` step — `Parameters<typeof runManagerOnce>[0]["spawnFn"]` indexes into `undefined` (RunManagerOnceOpts | undefined). Local `npm test` doesn't run `tsc --noEmit`, hence missed. Fix-forward commit a194050 swaps to direct `SpawnFn` import. Pattern (typecheck-only failure not gated by local CI) filed as DEBUG entry post-merge so /devx-learn can wire `npm run typecheck` into projects[*].pre_push.
- 2026-05-07T12:13 — phase 7: remote CI run 25513576415 success after fix-forward.
- 2026-05-07T12:13 — phase 8: merge-gate returned {"merge":true} (exit 0); merged via PR #56 (squash → 3be0b9f). gh pr merge exited non-zero from worktree per documented quirk; gh pr view confirmed state=MERGED with mergeCommit oid.
