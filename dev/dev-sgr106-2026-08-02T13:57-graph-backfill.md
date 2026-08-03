---
hash: sgr106
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Backfill — adds-only idempotent edge completion + attended devx-repo run"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 6
status: ready
blocked_by: [sgr103]
branch: feat/dev-sgr106
---

## Goal

Complete the durable edge set mechanically (FR-5): the adds-only,
idempotent `devx graph backfill` plus the attended devx-repo run in the
same PR. Plan phase 6 of workstream story-graph — read
`_devx/workstreams/story-graph/plan.md` §Phase 6; the RED artifact
`evals/E-6_backfill.ts` defines the contract and must flip green. This is
the FR-5 exception to the render-time warn-only fence.

**Attended-only: loop must `--exclude`** — T6.7's backfill-remainder
review needs a human resolving the pass-2 report in the PR.

Parallel-safe with sgr104/sgr105/sgr107 modulo shared generated/backlog
surfaces (GRAPH.md, DEV.md/MANUAL.md). On rebase conflict in GRAPH.md,
never merge by hand — re-run `devx graph`.

## Acceptance criteria

- [ ] AC 1: `src/lib/graph/backfill.ts` (new) pass 1 — per spec, union of
      row + frontmatter edges minus what each side has; write the missing
      side: frontmatter in canonical `blocked_by` underscore form
      (normalizing hyphen keys), row-side only onto live
      `Blocked-by:`-bearing rows (ffm done rows get frontmatter only). All
      writes `writeAtomic`; never deletes an edge (T6.1).
- [ ] AC 2: `src/lib/engine/frontmatter.ts` — `EnginePatch`/
      `applyEnginePatch` (:107-121) extended with a `blocked_by` field so
      canonical-form writes reuse the engine's splice rather than a
      parallel writer (T6.2).
- [ ] AC 3: Derived edges only from durable state: `phase:` ordering
      within a workstream, plan.md `(dev spec: <hash>)` pointers, todo.md
      pointers via `parseTodo()` → `TodoItem.pointer` (todo.ts:34-48;
      `POINTER_RE` is private); workstream discovery via
      `resolveSpecWorkstream` (works without PLAN.md rows or plan.md
      files) (T6.3).
- [ ] AC 4: Pass 2 — underivable-spec report, never guessed (D-9 spirit);
      tolerates non-directory files in the workstreams root and plan-less
      workstream dirs (T6.4).
- [ ] AC 5: CLI wiring — `devx graph backfill` subcommand + `--dry-run`
      (computes + reports, writes 0 files) (T6.5).
- [ ] AC 6: E-6 re-run RED first, then green: exact mechanical union
      written, ≥1 underivable reported, 0 deletions, second run a 0-file
      no-op, exit 0 on drifted fixtures, dry-run writes nothing;
      `test/graph-backfill.test.ts` (new) green; full suite + typecheck
      green (T6.6).
- [ ] AC 7: Attended devx-repo backfill in this PR (T6.7): pass-1 diff
      reviewed edge-by-edge; second run a no-op; `devx graph --check`
      green after; attended remainder resolved or explicitly deferred in
      the PR body. GRAPH.md + touched specs/backlogs committed with the
      code.

## Technical notes

- Idempotency is the review contract: second run = 0 file writes.
- Phase 6 extends `src/lib/engine/frontmatter.ts`, which phases 4/5 don't
  touch — the file split keeping this parallel-safe was deliberate.

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage (workstream 62bcd1).
