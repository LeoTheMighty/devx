---
hash: sgr101
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Parser completion + hardening (splitHashes, parallel-safe, heading tolerance)"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 1
status: ready
blocked_by: []
branch: feat/dev-sgr101
---

## Goal

Complete the backlog-row grammar where it lives (`src/lib/backlog/parse.ts`)
so every consumer — gather, reconcile, scope, and the new graph — inherits
it. Plan phase 1 of workstream story-graph — read
`_devx/workstreams/story-graph/plan.md` §Phase 1 and `design.md`
§Architecture before starting. Pure parser PR: no graph code in this phase.
The RED evals E-3/E-4 assert this tokenization end-to-end through the Phase
3 CLI; this phase carries its own unit-test verification.

## Acceptance criteria

- [ ] AC 1: `splitHashes` (parse.ts:427) is exported and hardened — strips
      `~~`, `**`, and trailing punctuation before matching, so the audited
      markup shapes (`~~rsh101~~`, `**now debug-rshred1**:`, spec-path
      blockers) recover their real hashes (T1.1).
- [ ] AC 2: `PARALLEL_TEXT_RE` (symmetric with `BLOCKED_BY_TEXT_RE`
      parse.ts:134) parses `Parallel-safe with …` row annotations into a
      new optional `DevRow.parallel_with?: string[]` field (optional-field
      back-compat per the mlc106 `epicSlug` precedent) (T1.2).
- [ ] AC 3: `parseEpicHeadings` (parse.ts:303) + `epicSectionFor` tolerate
      the audited ffm/palateful heading variants: optional `Epic — ` prefix,
      `##`/`###` depth, `(workstream <hash>)` alongside `(plan: <hash>)`,
      prose suffixes after the paren group (T1.3).
- [ ] AC 4: New unit tests in `test/backlog-parse.test.ts` +
      `test/backlog-parse-epic.test.ts` cover markup-wrapped hashes,
      spec-path blockers, trailing punctuation, `Parallel-safe with` rows,
      and both audited heading variants (T1.4).
- [ ] AC 5: Full suite + typecheck green; existing consumer tests updated
      only where recovered edges are the correct new truth.
- [ ] AC 6: Live-repo before/after verdict diff (T1.5): a throwaway
      scratchpad tsx script drives `parseDevMd` + gather-side blocker
      resolution over all backlog rows before and after the change; every
      flipped blocked/unblocked verdict is explained by a recovered edge in
      the PR body. Script is NOT committed.

## Technical notes

- Hardened tokenization intentionally changes existing consumers — edges
  that today fail to parse start resolving, which can newly flip
  blocked/unblocked verdicts in `devx next`/reconcile/scope (design
  Migration §1: "the encoding becoming truthful").
- There is no CLI surface for all-row verdicts (`devx next` emits a single
  decision, no `--format` flag) — hence the scratchpad script for AC 6.

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage (workstream 62bcd1).
