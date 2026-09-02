<!-- todo.md — Docs Layout Resolution working memory (harness-fold-in FR-1).

  Contract (design §"todo.md parse contract"):
  - Auto-maintained: `devx todo sync <hash>` trues the derived lines below.
    Derived = top-level lines matching `- [ ] Stage:|Gate:|Phase <n>: …`;
    their checkboxes mirror spec frontmatter + linked dev-spec state.
    Free-nested items (any deeper checkbox) belong to skills and humans —
    sync never touches them.
  - Never a gate input: no `devx gate` code path reads this file.
  - Pointers, not copies: phase lines point at emitted dev specs
    (`  - [ ] Phase <n>: <title> → <dev-hash>`); content lives in the spec.
  - Done = checked; abandoned = deleted. This file is NOT append-only.
  - Hand-edits are legal — the next writer reconciles.
-->

- [x] Stage: PRD
- [x] Gate: prd
- [x] Stage: Design
- [x] Gate: coverage(design)
- [x] Stage: Plan
  - [x] Owner Q: phase shape → 6 phases, layered
  - [x] Owner Q: 4 PRD baseline corrections → deferred (no `devx revise`)
  - [x] Owner Q: `lay101` sequencing → local predicate, deleted on adoption
  - [x] Profile delta recorded: `docs.human_render`, `plan.wave_execution`, `plan.risks_depth`
  - [x] Ground the blast radius: 33 `*Abs()` + 72 `*_REL` across 17 modules
  - [x] Draft `plan/agent.md` (7 phases, 4 waves, interrogated Risks)
  - [x] Critique step (4 lenses) — 26 findings applied, 1 declined
  - [x] Judge E-id → phase coverage table (8/8 covered after the E-3 re-order)
  - [x] Refresh `plan/human.md`
- [x] Gate: coverage(plan)
- [x] Stage: RED
  - [x] Profile delta recorded: `evals.validation_source: both`
  - [x] Scaffold `evals/outline.md`; offer it to the owner
  - [x] Author `evals/E-1_gate-subjects.ts` (P0, phase 2)
  - [x] Author `evals/E-2_single-reader.ts` (P0, phase 5)
  - [x] Author `evals/E-3_no-hand-joins.ts` (P0, phase 4)
  - [x] Author `evals/E-4_resolve-workstream.ts` (P0, phase 3)
  - [x] Author `evals/E-5_scaffold.ts` (P0, phase 4)
  - [x] Author `evals/E-6_migrate.ts` (P0, phase 6)
  - [x] Author `evals/E-7_migrate-refusals.ts` (P0, phase 6)
  - [x] Author `evals/E-8_docs-truth.ts` (P1, phase 7)
  - [x] Confirm every P0 fails for the STATED reason, not harness breakage
  - [x] Write `evals/RED-report.md` + `evals/human.md`
- [x] Gate: evals
- [ ] Stage: Execute
  - [ ] Phase 1: The artifact map and the single layout reader -> dlr101
    - [x] T1.1 `ArtifactKind` / `stageSubject()` / `pathToArtifactKind()`
    - [x] T1.2 `resolveDocsLayout()`; `docsLayoutFrom()` reduced to a wrapper
    - [x] T1.3 `docsLayout` + `layoutSource` on `EngineConfig`, above both guards
    - [x] T1.4 `docsLayoutUnset()` deleted; nag moved onto `layoutSource`
    - [x] T1.5 duplicate `DocsLayout` type replaced by a re-export
    - [x] T1.6 9 hand-built `engine` literals re-typed; `layoutWarnings()` rewritten
    - [x] Unplanned: a THIRD reader (`init-write.ts` `renderInitConfig`) closed
  - [ ] Phase 2: Gate subject resolution -> dlr102
  - [ ] Phase 3: Workstream resolution and the flat-era guard -> dlr103
  - [ ] Phase 4: Consumer sweep and layout-aware scaffolding -> dlr104
  - [ ] Phase 5: Identity re-key and privatization -> dlr105
  - [ ] Phase 6: `devx layout migrate` -> dlr106
  - [ ] Phase 7: Doc truth -> dlr107
  - [ ] Retro story -> dlrret
- [ ] Stage: Retro
- [ ] Stage: Outcome
