---
hash: mlc102
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Backlog mutation lock + atomic-writer conversion"
status: in-progress
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: [mlc101]
branch: feat/dev-mlc102
owner: /devx-2026-07-28T1020-28370
---
## Goal

One blocking cross-process critical section (`locks/backlog.lock`) for
every backlog/spec mutation and main-checkout git operation; remaining
plain `writeFileSync` writers convert to `writeAtomic` (races R3/R4/R10
dead). Plan phase 2 of workstream multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: `src/lib/backlog/mutate.ts` exports `withBacklogLock(cacheDir,
      label, fn)` built on `acquirePathLockBlocking` (30s/20ms constants;
      timeout diagnostic names the holder pid), tested in
      `test/backlog-mutate.test.ts`.
- [ ] AC 2: the claim transaction (`src/lib/devx/claim.ts`) and the
      driver's `setBacklogRow` / `markBacklogRowDone` / `commitOnMain` /
      `pushMain` / `finalizeMerged` mutation blocks run inside it.
- [ ] AC 3: `src/lib/manage/loop.ts` writers (spec/DEV.md/INTERVIEW.md)
      and the gate's engine-frontmatter patch write convert to
      `writeAtomic` and run inside the lock.
- [ ] AC 4: an interleaved dual-writer test reproduces R3 (lost DEV.md
      update) against the old path shape and proves zero lost updates
      under the lock.
- [ ] AC 5: `npm test` green (existing call sites mechanically updated).

## Technical notes

Design §Architecture 2. Worktree-cwd git-tx stays lock-free (per-item
isolation). Wrap `acquirePathLockBlocking` (`src/lib/manage/lock.ts:211`)
— wrap-don't-duplicate.

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 2).
- 2026-07-28T10:20:26-06:00 — claimed by /devx in session /devx-2026-07-28T1020-28370

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
