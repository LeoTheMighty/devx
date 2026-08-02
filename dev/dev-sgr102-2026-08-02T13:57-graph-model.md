---
hash: sgr102
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Graph model — buildGraphModel nodes/edges/groups/warnings"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 2
status: in-progress
owner: /devx-2026-08-02T1444-58225
blocked_by: [sgr101]
branch: feat/dev-sgr102
---

## Goal

The one genuinely new read-model: `buildGraphModel()` in
`src/lib/graph/model.ts` (new) assembling nodes/edges/groups/warnings from
the hardened parsers. Pure library, no CLI yet. Plan phase 2 of workstream
story-graph — read `_devx/workstreams/story-graph/plan.md` §Phase 2 and
`design.md` §Data (the GraphModel interface is pinned there, including the
four warning codes `unknown-blocker` / `edge-drift` / `hyphen-key` /
`heading-fallback`).

## Acceptance criteria

- [ ] AC 1: Cross-dir spec index — `SPEC_TYPE_DIRS` (frontmatter.ts:428) ×
      readdir × `readEngineState`, plus a YAML-aware read for keys
      `readEngineState` doesn't carry (`from:`, `spawned:`, `title:`,
      hyphen `blocked-by:`) using the same `parseDocument` approach —
      NOT `parseFrontmatterValue` (single-line scalar reader; cannot see
      `spawned:` block-lists or inline arrays) (T2.1).
- [ ] AC 2: Nodes carry `effectiveStatus` (gather.ts:191 precedence);
      struck (`~~…~~`) rows are excluded (T2.2).
- [ ] AC 3: Blocking-edge union — row + frontmatter, both through
      `splitHashes`, deduped, per-source tagged, validated against the
      known-hash set (unknowns dropped + warned naming the source row);
      drift warnings where the two sources disagree (T2.3).
- [ ] AC 4: Parallel + lineage edges — `parallel_with` rows; `spawned:`
      both value forms (bare hash and block-list) (T2.4).
- [ ] AC 5: Groups via hardened `parseEpicHeadings` +
      `resolveSpecWorkstream` (workstream.ts:565); all-settled groups
      collapse to summary nodes; INTERVIEW/MANUAL badges via
      `parseInterviewMd` (:490) / `parseManualMd` (:541) reverse `Blocks:`
      edges (T2.5).
- [ ] AC 6: DFS cycle check over blocking edges only →
      `{ok:false, cycle:[...]}` enumerating every member, incl. the
      self-block case (T2.6).
- [ ] AC 7: `test/graph-model.test.ts` (new) fixture-repo unit coverage:
      union + dedup + tagging, phantom drop + warning, drift warning,
      hyphen-key warning, `heading-fallback` warning, group membership via
      both heading variants and the `from:` bridge, `spawned:` both forms,
      collapse rule, badge attachment, cycle + self-block errors (T2.7).
      Full suite + typecheck green.

## Technical notes

- All I/O behind the `EngineFs`-style seam (testable without disk).
- Backlog rows: compose `parseDevMd` directly over DEV/PLAN/TEST/DEBUG —
  `readBacklogRows` (gather.ts:452) is private and reads only three of the
  four; the ~10-line loop is re-composed here deliberately (TEST.md
  indexing is new).
- Deliberate narrowing (recorded): todo.md pointers are NOT read at
  model-build time — backfill (phase 6) materializes pointer-derived edges
  into frontmatter.
- The graph is a map, not a dispatcher: renders the validated edge union +
  `effectiveStatus`; re-implements no resolver's "runnable" verdict.
- `readEngineState` stays underscore-only; hyphen keys are read here.

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage (workstream 62bcd1).
- 2026-08-02T14:44:12-06:00 — claimed by /devx in session /devx-2026-08-02T1444-58225
