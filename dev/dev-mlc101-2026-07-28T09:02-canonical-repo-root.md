---
hash: mlc101
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Canonical repo root + worktree refusal"
status: in-progress
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: []
branch: feat/dev-mlc101
owner: /devx-2026-07-28T0929-23201
---
## Goal

Every devx process resolves one repo root and one `.devx-cache` via git's
common dir; `devx loop` and `devx manage` refuse to start from a linked
worktree (race R1 dead). Plan phase 1 of workstream multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: `src/lib/repo-root.ts` exports `resolveRepoRoot(cwd)` (git
      `rev-parse --git-common-dir --show-toplevel`) returning `{root,
      cacheDir, isLinkedWorktree}`, unit-tested in `test/repo-root.test.ts`
      (fixture repo + linked worktree).
- [ ] AC 2: `devx loop` and `devx manage` started with cwd inside a linked
      worktree refuse with exit != 0 and an error naming the main checkout
      path; `--allow-worktree-root` (test-only, documented) overrides.
- [ ] AC 3: `src/commands/manage.ts` passes the canonical cacheDir into
      `acquireManagerLock` (no more cwd-relative ".devx-cache" default).
- [ ] AC 4: claim path asserts the passed repoRoot is the canonical main
      root (defense in depth).
- [ ] AC 5: eval `_devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts`
      flips GREEN; `npm test` green.

## Technical notes

Design: `_devx/workstreams/multi-loop-concurrency/design.md` §Architecture 1.
`findProjectConfig` (`src/lib/config-io.ts:43`) stays for config discovery;
the canonical root check wraps it.

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 1).
- 2026-07-28T09:29:57-06:00 — claimed by /devx in session /devx-2026-07-28T0929-23201

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
