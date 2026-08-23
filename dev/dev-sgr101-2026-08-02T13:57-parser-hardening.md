---
hash: sgr101
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Parser completion + hardening (splitHashes, parallel-safe, heading tolerance)"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 1
status: done
owner: /devx-2026-08-02T1414-83162
blocked_by: []
branch: feat/dev-sgr101
---

## Goal

Complete the backlog-row grammar where it lives (`src/lib/backlog/parse.ts`)
so every consumer — gather, reconcile, scope, and the new graph — inherits
it. Plan phase 1 of workstream story-graph — read
`_devx/workstreams/story-graph/plan/agent.md` §Phase 1 and `design.md`
§Architecture before starting. Pure parser PR: no graph code in this phase.
The RED evals E-3/E-4 assert this tokenization end-to-end through the Phase
3 CLI; this phase carries its own unit-test verification.

## Acceptance criteria

- [x] AC 1: `splitHashes` (parse.ts:427) is exported and hardened — strips
      `~~`, `**`, and trailing punctuation before matching, so the audited
      markup shapes (`~~rsh101~~`, `**now debug-rshred1**:`, spec-path
      blockers) recover their real hashes (T1.1).
- [x] AC 2: `PARALLEL_TEXT_RE` (symmetric with `BLOCKED_BY_TEXT_RE`
      parse.ts:134) parses `Parallel-safe with …` row annotations into a
      new optional `DevRow.parallel_with?: string[]` field (optional-field
      back-compat per the mlc106 `epicSlug` precedent) (T1.2).
- [x] AC 3: `parseEpicHeadings` (parse.ts:303) + `epicSectionFor` tolerate
      the audited ffm/palateful heading variants: optional `Epic — ` prefix,
      `##`/`###` depth, `(workstream <hash>)` alongside `(plan: <hash>)`,
      prose suffixes after the paren group (T1.3).

      **Narrowing (deliberate, see PR body):** the `Epic — ` prefix is
      optional *when the heading carries a `(workstream <hash>)` linkage* —
      the audited ffm form. Making it unconditionally optional would promote
      every heading to an epic, inventing `--epic` keys out of container
      headings that really do exist here (`## Phase 0 — Foundation (plan:
      plan-a01000)`) and downstream (`## Loose ends from executed epics`).
- [x] AC 4: New unit tests in `test/backlog-parse.test.ts` +
      `test/backlog-parse-epic.test.ts` cover markup-wrapped hashes,
      spec-path blockers, trailing punctuation, `Parallel-safe with` rows,
      and both audited heading variants (T1.4).
- [x] AC 5: Full suite + typecheck green; existing consumer tests updated
      only where recovered edges are the correct new truth.
- [x] AC 6: Live-repo before/after verdict diff (T1.5): a throwaway
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
- 2026-08-02T14:14:56-06:00 — claimed by /devx in session /devx-2026-08-02T1414-83162
- 2026-08-02T14:20 — phase 2: spec ACs direct (v2 native); 6 ACs; workstream=story-graph (plan 62bcd1, phase 1); red-artifacts=E-3_edge-hardening.ts, E-4_source-union.ts (assert this tokenization end-to-end through the Phase 3 CLI — stay RED until sgr103; this phase carries its own unit-test verification per plan §Phase 1 "Type: tests-after").
- 2026-08-02T14:26 — phase 3: implemented T1.1–T1.3 in `src/lib/backlog/parse.ts`. `splitHashes` exported + hardened (edge-only markup/punctuation trim, `/` and en/em-dash separators, parenthetical rationale excluded, `<type>-<hash>` prefix gated to real spec types); `PARALLEL_TEXT_RE` + optional `DevRow.parallel_with` (mlc106 `epicSlug` optional-field precedent); epic-heading tolerance via a hash-exact linkage-parenthetical helper (`(workstream <hash>)` accepted alongside `(plan: <hash>)`, and sufficient on its own for the no-`Epic —`-prefix downstream form). T1.4: +34 unit tests across the two parser test files (57 → 91).
- 2026-08-02T14:29 — phase 4: single-pass adversarial self-review (session policy forbids subagent fan-out; the >500-line threshold would otherwise call for the 3-agent shape). 3 findings, ALL fixed in-place — 2 HIGH, 1 LOW. HIGH F1: `PARALLEL_TEXT_RE` accepted `Parallel[-\s]with`, so ordinary row prose ("runs in parallel with the loop driver") matched and manufactured peers out of the following words — now requires the hyphen in both named spellings. HIGH F3 (most load-bearing): the linkage-parenthetical lookahead keyed on the bare WORD `workstream`, so `Epic — devx (workstreams overview) engine` truncated to `devx` — reintroducing the exact EC#7 epic-collapse bug mlc106 fixed; replaced with `linkageParenIn()`, which defines "carries a linkage" by the two hash regexes themselves. LOW F19: refreshed the stale heading-shape comment block. Both HIGH findings got dedicated regression tests; re-review clean.
- 2026-08-02T14:36 — phase 5: local CI green on the touched project (`cli`) — full suite 136 files / 2945 tests passed, `npm test` incl. build + typecheck; coverage not configured for this project (informational under YOLO regardless). No QA walkthrough emitted: pure library/parser change with no user-visible surface of its own (the `_devx/templates/engine/qa-walkthrough.md` template is not on this branch either). AC 6 live-repo before/after verdict diff run over 3 real repos instead — devx, friend-finder-mesh, palateful; script kept in gitignored scratch, not committed. Every flip is unresolved → resolved and explained by a recovered edge; zero rows gained a blocker, zero epicSlugs regressed. `devx next` smoke-run exits 0 on the new parser.
- 2026-08-02T14:52 — merged via PR #110 (squash → 93b0aa4). CI green (devx-ci run 30766074530); merge gate `{"merge":true}`; hold check clear. Review tour published to `devx-tours` at `tours/sgr101/tour.html`.
