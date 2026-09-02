---
gate: PASS
status_reason: 'All 8 source IDs fully covered in plan mode.'
reviewer: 'devx gate coverage (plan mode)'
updated: 2026-09-02
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/docs-layout-resolution — 2026-09-02

## Subject

`plan/agent.md` reviewed against `design/agent.md + expectations.md` (plan mode; workstream `a494be`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| E-1 | ✅ | Phase 2 (T2.1-T2.4) | Grep-verified that Phase 2 owns exactly the 12 *Abs() subject reads in src/commands/gate.ts (:203,204,278,279,314,315,361,363,489,496,550,552) and the 19 location: fields in gate-prd.ts, which is the whole surface deciding whether each of the four gates finds its subject; the success criteria pin all 8 layout x gate combinations to PASS on a good fixture AND to FAIL on a deliberately-broken one, closing the mutual-failure loophole an equality-only threshold would leave open. |
| E-2 | ✅ | Phase 5 (T5.1, T5.6), single-reader half also asserted in Phase 1 (T1.2, T1.4) | Judged against the corrected orphan count from decisions/2026-09-02-deferred-prd-corrections.md (8 orphaned exported resolvers, not the threshold's stale 2); grep confirmed exactly two layout-key readers today (docsLayoutFrom at artifacts.ts:168 and the private docsLayoutUnset at gather.ts:1160) and that stageFileRel/outlineRel/outlineCritiqueRel/humanRel/projectAgentRel/projectHumanRel/projectOutlineCritiqueRel/checkpointsDirAbs have zero src callers, and R-9 correctly re-homes the orphan half into Phase 5 where Phase 4's sweep has given the map real callers, making it satisfiable. |
| E-3 | ✅ | Phase 4 (T4.1 authors the scan RED + negative control; T4.5 closes the five sites); Phase 5 (criteria require it stays green after privatization) | Judged against the corrected five-site list rather than E-3's stale four (todo-truth.ts:49, todo.ts:86, mark-done.ts:525, validate-emit.ts:184, outcome.ts:492 all grep-confirmed live, and backfill.ts:350 confirmed to be planAbs(join(root, slug)) — a workstream-base join, correctly excluded); the amendment resolves my earlier finding because T4.1 now strictly precedes T4.5 inside one phase, so the scan is genuinely RED when authored and the negative control has the five live sites to control against, with Phase 5 reduced to a stays-green check and no second authoring. Residual nit only: Phase 4's Files list still names just the E-5 pair as new and omits the two E-3 files, which T4.1 itself spells out — bookkeeping, not executability. |
| E-4 | ✅ | Phase 3 (T3.1-T3.3) | Phase 3's success criteria restate all three frontmatter states verbatim including the absent-key case producing '.' and never <root>/<slug>, and T3.3 re-signatures planFilenameWorkstreamRel() — grep-confirmed as the exact fallback resolveWorkstream reaches at workstream.ts:471 when state.workstream is null, with 4 call sites across 3 files (workstream.ts:471,678, gather.ts:858, status.ts:117) exactly as the plan claims. |
| E-5 | ✅ | Phase 4 (T4.2, T4.9, T4.10) | Both threshold halves are pinned explicitly (6-of-6 root artifacts plus a plan spec with workstream: '.'; exit 1 with text containing 'engine.docs_layout: workstream'), and T4.10 is load-bearing and correctly identified — grep confirms commands/workstream.ts:101 declares .argument("<slug>") and :44-49 returns 2 on args.length !== 1, so without moving that check the no-slug cases are unreachable and the exit code would be 2 rather than the threshold's 1. |
| E-6 | ✅ | Phase 6 (T6.1, T6.2, T6.4, T6.5) | Phase 6 owns the entire surface (grep confirms no src/lib/layout/ or src/commands/layout.ts exists and that the only 'git mv' occurrences in src/ are advice strings in doctor/detect.ts:395 and workstream.ts:328), and the criteria restate the 8-of-8, empty-gate_status/gate_verdicts-diff, and follow-on 'devx gate coverage runs to a verdict' halves; the one soft edge is that the phrase '§15-table counterparts' points at a doc Phase 7 has not yet corrected, so the counterpart paths must in practice come from Phase 1's ArtifactKind map. |
| E-7 | ✅ | Phase 6 (T6.1, T6.3, T6.5) | T6.3 makes the three refusals a pure predicate computed before any move, and the success criteria pin all three of the threshold's conditions plus the byte-identical `git status` before/after check and the --dry-run-moves-0-files case, with the no---force stance closing the obvious escape hatch. |
| E-8 | ✅ | Phase 7 (T7.1-T7.3) | Verified against the real docs: §15's table today has 12 rows and no checkpoints/ or RESULTS.md row, and both docs/CONFIG.md rule 5 and _devx/config-schema.json:940 assert layout-aware gate resolution that no code implements — so the plan's correction of FR-8's 'gains two rows' framing into a 13-row restructure is right, and the criteria pin the 13-of-13 set equality (the RED-bearing half), 0 false claims, and enum agreement with DOCS_LAYOUTS. |

## Extras requiring product approval

- New `layout-tree-mismatch` doctor finding (fixable: false) — no FR or expectation asks for a new doctor finding; FR-6 only asks the existing flat-era guards to discriminate on layout, and no E-block verifies this finding. — Phase 3 (T3.6)
- Honoring `engine.workstreams_root` in `detectFlatWorkstreams` instead of the hardcoded join(repoRoot, "_devx", "workstreams") — grep-confirmed as a real pre-existing defect at doctor/detect.ts, but it is orthogonal to layout resolution and no PRD id or expectation covers it. — Phase 3 (T3.5)
- Deduplicating the hand-written `DocsLayout` type in src/lib/init-questions.ts against artifacts.ts — grep-confirmed the duplicate exists, but G-2/FR-2 are about layout *readers* and EngineConfig, not type duplication; nothing asserts it. — Phase 1 (T1.5)
- Filing a new dev spec + DEV.md entry for the nine skill-body hardcoded path references — explicitly listed under 'What we're NOT doing', so no FR or expectation asks the plan to schedule the filing work. — Phase 7 (T7.4)

## Verdict detail

PASS — every source ID is ✅ covered.
