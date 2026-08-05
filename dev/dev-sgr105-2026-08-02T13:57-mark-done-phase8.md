---
hash: sgr105
type: dev
created: 2026-08-02T13:57:00-06:00
title: "mark-done helper + Phase-8 rewrite (merge-cleanup mechanical host)"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 5
status: in-progress
owner: /devx-2026-08-05T1113-94741
blocked_by: [sgr104]
branch: feat/dev-sgr105
---

## Goal

Merge-cleanup's first mechanical host (FR-4's third flow): `devx
devx-helper mark-done`, plus the Phase-8 skill-prose rewrite that invokes
it. E-5 goes green here. Closes the `git add -A` cleanup-commit class
structurally (the 2026-07-29 erratum `ba3c65b`). Plan phase 5 of
workstream story-graph — read
`_devx/workstreams/story-graph/plan.md` §Phase 5; the RED artifact
`evals/E-5_loop-freshness.ts` defines the three-flow contract and must
flip green.

## Acceptance criteria

- [ ] AC 1: `src/lib/devx/mark-done.ts` (new) — fat lib (thin-command/
      fat-lib pattern, mirroring claim): under `withBacklogLock`
      (mutate.ts:82), spec `status: done` flip + status-log append; DEV.md
      `[/]→[x]` flip + PR URL append (extend `flipDevMdRow` (claim.ts:354)
      or a sibling — today it only does `[ ]→[/]` and throws otherwise);
      in-process todo sync via `runTodoSync` (src/commands/todo.ts:55)
      when the item has a workstream; GRAPH.md regen via `regenerateGraph`
      (warn-and-continue) (T5.1).
- [ ] AC 2: `src/commands/devx-helper.ts` — `mark-done <hash> --pr <n>
      --merge-sha <sha>` (fifth subcommand; registration pattern at :645);
      stdout JSON `{hash, paths, todoSynced}`; exit 0 / 1 (state mismatch)
      / 2 (resolution) (T5.2).
- [ ] AC 3: `.claude/commands/devx.md` Phase 8 after-merge steps 4–7
      rewritten to invoke `mark-done` + commit its `paths` by explicit
      pathspec; `skills/devx.md` via `npm run sync:skills`;
      skill-discipline tests updated where the Phase-8 contract grew
      (T5.3).
- [ ] AC 4: E-5 re-run RED first, then green: claim, cleanup
      (`mark-done`), and emission each leave `devx graph --check` exiting
      0 with no manual regen between (T5.4).
- [ ] AC 5: `test/devx-helper-mark-done.test.ts` (new): happy path,
      state-mismatch exit 1, lock contention, workstream-less skip of todo
      sync, regen-failure warn-and-continue. `npm run sync:skills --
      --check` green; full suite + typecheck green.

## Technical notes

- Severability (recorded cut line): FR-4's minimum is regen having a
  mechanical host on the cleanup flow; the bookkeeping mechanization is
  justified by the `git add -A` incident class and is severable if this
  phase runs long.
- `mark-done` is write-only in v1: the skill keeps owning commit + push
  (symmetric with owning the merge). Revisit is a recorded non-blocking
  question in design.md.

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage (workstream 62bcd1).
- 2026-08-05T11:13:48-06:00 — claimed by /devx in session /devx-2026-08-05T1113-94741
