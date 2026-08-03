---
hash: sgr102
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Graph model — buildGraphModel nodes/edges/groups/warnings"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 2
status: done
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
- 2026-08-02T14:48 — phase 2: spec ACs direct (v2 native); 7 ACs; workstream=story-graph (plan 62bcd1, phase 2); red-artifacts=E-1_render-deterministic.ts, E-3_edge-hardening.ts, E-4_source-union.ts (all three assert this model end-to-end through the Phase 3 CLI and stay RED until sgr103; plan §Phase 2 "Type: tests-after", so this phase carries its own unit-test verification). Read design.md §Data for the pinned GraphModel interface and the three evals for the behavior they will demand: `blocks` edge direction (from=blocked, to=blocker), drift firing only where BOTH sources speak, and no `heading-fallback` on the `(workstream <hash>)` variant.
- 2026-08-02T15:01 — phase 3: implemented T2.1–T2.7 in new `src/lib/graph/model.ts` (865 lines). Cross-dir spec index over SPEC_TYPE_DIRS × readdir × readEngineState plus a memoized `parseDocument` read for the keys readEngineState doesn't carry (`from:`/`spawned:`/`title:`/`superseded_by:`/hyphen `blocked-by:`) — AC 1's explicit "NOT parseFrontmatterValue" (it cannot see block-lists or inline arrays); every frontmatter value routed through the exported `splitHashes` so spec-path-shaped blockers stop being lost (the frontmatter.ts:248-255 divergence). Nodes carry gather.ts:191 effectiveStatus precedence with struck-row exclusion; blocking edges union row+frontmatter with per-source tagging and known-hash validation; parallel edges canonicalized to one undirected pair; lineage from `from:`/`spawned:`/`superseded_by:` deduped across the reciprocal pair; groups via resolveSpecWorkstream with the epic heading as fallback and a `standalone` bucket; iterative Tarjan cycle check (blocking edges only) returning every member of every cycle. T2.7: +41 unit tests in new `test/graph-model.test.ts`, all against an in-memory GraphFs.
- 2026-08-02T15:05 — phase 4: single-pass adversarial self-review (session policy forbids subagent fan-out; the >500-line + multi-regex threshold would otherwise call for the 3-agent shape — same constraint recorded at sgr101). 4 findings, ALL fixed in-place — 1 HIGH, 2 MED, 1 LOW, plus 3 defects found by running the model over the live repo. HIGH F1 (most load-bearing): an unreadable-but-present backlog file was swallowed into "contributes nothing", which renders a clean, plausible, EMPTY board — the exact chmod-000-DEV.md failure gather.ts had to fix, and unfixable by warning here because the four warning codes are pinned; now throws so the Phase-3 CLI can exit 2, while a single unreadable SPEC still degrades gracefully (its row keeps the node). MED F2: `MERGED_LINE_RE` only matched the `/devx` dialect, so every `devx loop`-merged item reported `lastMerged: null` (retro-listener, live); widened to `merged via …PR` and switched first-match `exec` → `matchAll` max so a fix-forward story's LATEST merge wins. MED F3: heading-fallback fired on all 14 unlinked epic headings including 10 closed Phase-0/1 epics nobody will re-link — deferred until groups are known and suppressed for collapsed/memberless groups, taking the live board from 15 warnings to 5. LOW F4: hoisted a per-file RegExp compile; simplified the title-precedence expression; noted why `matchAll` is the only safe reader for a module-level /g regex. +5 regression tests (46 total). Re-review of the changed hunks clean.
- 2026-08-02T15:20 — phase 5: local CI green on the touched project (`cli`) — full suite **137 files / 2991 tests passed** via `npm test` (schema smoke + config-io + config-validate + build + typecheck + vitest), exit 0. Baseline at sgr101 was 136/2945, so this story is +1 file / +46 tests. Coverage not configured for this project (informational under YOLO regardless). No QA walkthrough emitted: pure library with no user-visible surface — `buildGraphModel` has no CLI until sgr103 (plan §Phase 2: "Pure library, no CLI yet"), and the `_devx/templates/engine/qa-walkthrough.md` template is not on this branch. Live-repo verification instead (throwaway scratchpad script, not committed): builds this repo's real board in **134ms** (design budget 2s) — 175 nodes, 378 edges (239 blocks / 122 lineage / 17 parallel), 22 groups, no cycle, 5 warnings (1 real edge-drift on d40ret, 4 actionable heading-fallbacks). Spot-checked the sgr epic's own edges: sgr102→sgr101 blocks tagged row+frontmatter, the sgr104/105/106/107 parallel-safe mesh, and 62bcd1→sgr1xx lineage all resolve correctly.
- 2026-08-02T15:44 — merged via PR #111 (squash → dea72c1). Remote CI devx-ci run 30767596923 success; check-hold `{"hold":false}`; merge-gate `{"merge":true}`. Review tour published to `devx-tours` at `tours/sgr102/tour.html` (8 stops, 6 decisions, 1 grep-verified trail).
