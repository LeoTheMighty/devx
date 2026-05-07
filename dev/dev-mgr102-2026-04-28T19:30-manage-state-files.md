---
hash: mgr102
type: dev
created: 2026-04-28T19:30:00-07:00
title: State persistence: schedule.json + manager.json + heartbeat.json with atomic writes
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-05-07T0940-37390
blocked_by: [mgr101]
branch: feat/dev-mgr102
---

## Goal

Ship `src/lib/manage/state.ts` with schemas + IO for `.devx-cache/state/`. Atomic writes (`*.tmp` + `rename`); crash-mid-write recovery covered by tests.

## Acceptance criteria

- [x] `src/lib/manage/state.ts` exports `readState()`, `writeState(state)`, `writeHeartbeat()`. All writes atomic.
- [x] Schemas:
  - `schedule.json` — desired roster: `{generation, computed_at, slots: [{spec_hash, worker_class, priority, since}], hard_cap: 1}`.
  - `manager.json` — actual state: `{generation, started_at, model, ticks: [...recent], roster: [{pid, spec_hash, worker_class, started_at, crash_count, last_exit_code?}], lock: {pid, acquired_at}}`. Bounded ≤ 1 MB by trimming `ticks` log to last 100.
  - `heartbeat.json` — `{ts, pid, generation}`. Single-line replace.
- [x] Crash-mid-write recovery: leftover `*.tmp` detected on read; either ignored (if `<state>.json` exists) or used (rename half-completed before crash). Tests cover both paths.
- [x] Tests: read-empty (no file → empty default state); read-leftover-tmp; write+read roundtrip; concurrent-write protection (atomic rename guarantees it).
- [x] Reuses the supervisor-internal.ts SHA-256-on-disk idempotency pattern from sup* (LEARN.md cross-epic). *Caveat: the load-bearing reuse is `writeAtomic` (tmp+rename); the SHA-256 idempotency check itself doesn't apply to mutating tick state where every write changes content. Acceptance Auditor flagged the wording as decorative-not-load-bearing; the implementation correctly extracted the applicable half of the cross-epic pattern.*

## Technical notes

- `*.tmp` + `rename` is the same primitive as supervisor-internal.ts's installer pattern — extends to manager state with no new code.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-07T09:40:58-06:00 — claimed by /devx in session /devx-2026-05-07T0940-37390
- 2026-05-07T09:42 — phase 2: canary=off, shouldCreateStory=project_shape=empty-dream + 5 ACs + no story file → bmad-create-story INVOKED (canary=off; helper decision logged not honored)
- 2026-05-07T09:42 — phase 2 override: bmad-create-story SKIPPED in practice — consistent with cross-epic 44/44 silent-skip pattern (LEARN.md cross-epic; spec ACs are the working artifact). Canary=off means dvx102 helper decision is logged but not honored; v0 behavior preserved by skipping per established empirical convention. Behavior shift to honor helper requires canary flip ("active") which is user-review-required.
- 2026-05-07T09:54 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — surface size ~530 LoC across state.ts + tests, multiple recovery branches → above the single-pass threshold per CLAUDE.md. ~21 in-scope unique findings across reviewers (5 HIGH, 8 MED, 7 LOW; Acceptance Auditor: 5/5 PASS). ALL in-scope findings fixed in-place. Most load-bearing fixes: explicit per-field projection in readManagerState (drops untrusted/unknown fields instead of spreading raw obj — closes BH-M1/ECH-H2 tunneling vector for mgr103+/mobile-mirror consumers); pre-promotion shape check on tmp recovery (skips JSON-parseable-but-non-object tmps before rename — BH-H2); EXDEV fallback in promoteTmp (copyFile+unlink when cross-device rename fails — BH-M3/ECH-M3); rename-corrupt-tmp-to-`.corrupt` cleanup fallback so the recovery loop doesn't re-parse a poisoned blob every read (ECH-L4); nextGeneration safety guards rejecting Infinity/NaN/non-integer/MAX_SAFE_INTEGER+1 → 1 (ECH-H3); TickOutcome forward-compat — read accepts any non-empty string for mgr103+ extension (ECH-H1/ECH-M4); defensive slots cap on writeScheduleState (max(1000, hard_cap*8) — ECH-L3); ENOENT-only swallow in readdirSync (ENOTDIR/EACCES propagate so corrupt-layout failures surface — ECH-M6); mtime tiebreaker via filename lex order (BH-M2/ECH-M2). 3 findings deferred with explicit rationale: ECH-M5 (Math.random in writeAtomic — supervisor-internal scope, ~2^41 collision space never hit at single-writer-per-process); BH-L1 (emptyScheduleState computed_at sentinel — AC-pinned schema, mgr103 reconcile uses generation not timestamp as freshness key); ECH-L6 (test imports tmp-suffix helper from supervisor-internal — would require exporting from supervisor-internal; out of mgr102 scope). Re-review clean.
- 2026-05-07T09:55 — phase 5: local CI green — npm test (schema smoke + config-io + config-validate + tsc build + vitest) on touched cli surface; 1128/1128 vitest tests pass (+19 net vs main: 12 mgr101 manage-state + 37 new manage-state-mgr102 + 28 manage-loop + 5 manage-lock = 82 manage-* tests post-mgr102, vs 45 pre-mgr102). Mobile + worker projects untouched per touched-surface diff.
- 2026-05-07T10:01 — phase 7: PR #54 opened against main (https://github.com/LeoTheMighty/devx/pull/54); body rendered via devx pr-body (zero unresolved placeholders).
- 2026-05-07T10:02 — phase 7: first CI run 25507077238 failed at typecheck step — `tsc --noEmit` (which includes test files via tsconfig.json) caught `as Record<string, unknown>` overlap mismatch on the projection test that local `npm test` (tsconfig.build.json, excludes tests) didn't gate. Fix-forward c1d943f relaxed the cast to `as unknown as Record<string, unknown>`. Pattern observation for /devx-learn: package.json's local CI gate should run `npm run typecheck` so this CI-vs-local gap closes structurally.
- 2026-05-07T10:03 — phase 7: devx-ci run 25507152772 completed conclusion=success (https://github.com/LeoTheMighty/devx/actions/runs/25507152772).
- 2026-05-07T10:04 — phase 8: merge-gate exit 0 ({"merge":true}); merged via PR #54 (squash → 4366ae5). gh pr merge exited 1 from worktree as expected per feedback_gh_pr_merge_in_worktree; gh pr view confirmed state=MERGED + mergeCommit.oid=4366ae570f05c81d53a1ab777971b5d386242487. Worktree force-removed (status-log post-commit edit was salvaged into main spec); local feat/dev-mgr102 branch deleted.
