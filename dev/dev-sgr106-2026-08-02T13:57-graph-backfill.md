---
hash: sgr106
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Backfill — adds-only idempotent edge completion + attended devx-repo run"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 6
status: done
owner: /devx-2026-08-05T1125-93383
blocked_by: [sgr103]
branch: feat/dev-sgr106
---

## Goal

Complete the durable edge set mechanically (FR-5): the adds-only,
idempotent `devx graph backfill` plus the attended devx-repo run in the
same PR. Plan phase 6 of workstream story-graph — read
`_devx/workstreams/story-graph/plan/agent.md` §Phase 6; the RED artifact
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
- 2026-08-05T09:12 — phase 2: spec ACs direct (v2 native); 7 ACs; workstream=story-graph; red-artifacts=evals/E-6_backfill.ts. Re-ran E-6 NOW: RED for the stated reason — `devx graph backfill --dry-run` exits 1 with `unknown option '--dry-run'` (the subcommand does not exist), plus 6 downstream assertion failures. Honest RED, not harness breakage.
- 2026-08-05T11:25:20-06:00 — claimed by /devx in session /devx-2026-08-05T1125-93383
- 2026-08-05T11:40 — phase 3: implemented T6.1–T6.6. New `src/lib/graph/backfill.ts` (pass 1 reads the missing side straight off `buildGraphModel`'s per-source edge tags rather than re-unioning; pass 2 reports; all writes through the fs seam / `writeAtomic`). `EnginePatch.blocked_by` + hyphen-key re-spelling in `engine/frontmatter.ts` (T6.2). `devx graph backfill [--dry-run]` in `commands/graph.ts` (T6.5). Single-sourced three primitives instead of forking them: exported `BLOCKED_BY_TEXT_RE` (parse.ts), `readSpecFrontmatterMap` + `specFilenameHash` + `SETTLED_STATUSES` (model.ts). E-6 GREEN; `test/graph-backfill.test.ts` new, 36 cases.
- 2026-08-05T12:20 — phase 4: single-pass adversarial review (subagent fan-out is disabled for this session by standing instruction, so the 3-agent threshold shape was replaced by a rigorous single pass PLUS the attended real-repo dry run used as an empirical review leg — which is what caught the two most serious findings). 14 findings (7 HIGH, 5 MED, 2 LOW); ALL fixed in-place. Most load-bearing: the first real dry run proposed 4 derived phase-ordering edges, and 3 of them directly contradicted an explicit `Parallel-safe with` row annotation (hfi104↔hfi103, rtl102↔rtl101, rtl106↔rtl105) — plan phase ordinals are labels, not declared dependencies. Added two suppression rules (declared parallel-safety refutes an inference; never infer onto a settled spec, where nobody will ever correct it) and a reported `Suppressed inferences` block so the declines are visible rather than silent. Other HIGHs: workstream plan specs were counted as members (every workstream's own plan spec would have been reported underivable); stricken/off-board specs were completion targets; a plan.md pointer could relabel another workstream's spec and rank it on a foreign phase numbering; unparseable frontmatter was treated as "incomplete" (promising writes `applyEnginePatch` would throw on) and double-reported in pass 2; the CLI collapsed model-build failure and cycle-refusal into one exit code. MEDs: the plan-pointer regex matched `Phase <n>` in narrative prose (anchored to the checklist row); an empty `Blocked-by: .` spliced to `Blocked-by: , x.`; a CRLF row spliced after the carriage return; `BacklogLockTimeoutError` escaped as an uncaught stack trace under peer contention. LOW: yaml re-padded `[a, b]` → `[ a, b ]` on EVERY engine patch, silently reformatting untouched lists (fixed at the shared serializer with `flowCollectionPadding: false`). Re-review clean.
- 2026-08-05T13:05 — phase 5: local gates. Lint is the cli301 no-op echo. `npm test`: 3098/3122 passed. The 24 failures are 4 subprocess-spawn files (loop-worker, manage-spawn, manage-spawn-integration, manage-crash-restart-loop) — verified NOT a regression by four independent checks: those files pass 61/61 isolated in this worktree, 61/61 isolated on main, no main commit since the branch point touches those surfaces, and the failure count fell 29→24 as concurrent peer load dropped (26 → 0 competing vitest processes). Documented load pathology (debug-7c1e93, debug-5c8b21). Everything the diff can reach is green: 7 graph/backlog-parse files (240 tests) + 22 engine write-path consumer files (568 tests), the latter covering every `applyEnginePatch` caller affected by the `flowCollectionPadding` change. QA walkthrough emitted at `test/test-2e7b45-2026-08-05T12:22-sgr106-qa-walkthrough.md` — 6 machine checks executed inline with real output, 2 human checks outstanding; TEST.md row added.
- 2026-08-05T13:10 — phase 6/7: AC 7 attended run complete. Fixed 5 shipped specs with unparseable frontmatter (mgr102, mgr103, cfg204, cli303, cli304), then ran backfill: 3 mechanical edits (b01000 += a01000; db36af += dc7514; d40ret row += d40007), each verified edge-by-edge against the side that already stated it; 0 derived edges; 4 inferences suppressed; second run wrote 0 files; `devx graph --check` green (188 nodes / 388 edges / 22 groups after rebase). Filed debug-9f24c7 for the unparseable-frontmatter class + DEBUG.md row. Rebased onto origin/main (DEBUG.md conflict was two additive rows, both kept; GRAPH.md re-rendered rather than hand-merged, per the plan's Phase 6 note). PR: https://github.com/LeoTheMighty/devx/pull/120
- 2026-08-05T13:35 — phase 7/8: remote CI green (devx-ci run 31039103749), then two peer merges (#119, PR-117 tail) forced a re-rebase — TEST.md/DEBUG.md conflicts were additive rows on BOTH sides (kept both); GRAPH.md re-rendered via `devx graph`, never hand-merged, per plan Phase 6's note. CI green again on the rebased head (run 31039408817). check-hold 0, `devx merge-gate sgr106` → `{"merge":true}`. merged via PR #120 (squash → 66720bd). `gh pr merge` exited non-zero from the worktree ("'main' is already used by worktree") — the documented artifact; `gh pr view` confirmed state MERGED before any bookkeeping ran.
