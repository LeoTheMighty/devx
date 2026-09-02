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
  - [x] Phase 2: Gate subject resolution -> dlr102
    - [x] Confirm E-1's RED is honest (names the missing feature, not infra)
    - [x] T2.2 12 `commands/gate.ts` `*Abs()` reads through `stageSubject()`
    - [x] T2.2 the two lying refusal strings (gate prd input-missing, gate evals expectations)
    - [x] T2.3 `gate-prd.ts` 19 `location:` + 6 `message:` onto the resolved subject
    - [x] T2.4 `gate-coverage.ts` refusals + verify-report Subject onto `subject.rel`
    - [x] T2.1 `test/engine-layout-gate-subjects.test.ts` (28 tests; 8 combinations)
    - [x] Negative control: disable the layout branch -> 15/28 red
    - [x] Negative control: break BOTH layouts identically -> 9 red (AC 2)
    - [x] AC 5: devx's own gates diffed against `main` on a scratch copy
    - [x] Phase 4: 3-agent parallel review — 12 findings, all fixed in-place
    - [x] Closed the leg-(c) blind spot (`path.join` eats `./`) with a spelling assertion
    - [x] Re-anchored the doc-set base off `todo.md` after the firewall test flagged it
  - [ ] Phase 3: Workstream resolution and the flat-era guard -> dlr103
    - [x] Confirm E-4's RED is honest (names the missing feature, not infra)
    - [x] T3.1 `test/engine-layout-resolve-workstream.test.ts` RED
    - [x] T3.2 `resolveWorkstream()` + `resolveSpecWorkstream()` branch on layout
    - [x] T3.3 `planFilenameWorkstreamRel()` re-signatured; 4 call sites updated
    - [x] Unplanned: `planSpecWorkstreamRel()` + `workstreamSlugFor()` — the `??`
          fallback and the slug tail moved off the call sites too
    - [x] T3.4 flat-era refusal layout-discriminated; stage list derived (`SUBJECT_STAGES`)
    - [x] T3.5 `detectFlatWorkstreams` honors `workstreams_root`; early-return
    - [x] T3.6 `layout-tree-mismatch` finding (`fixable: false`)
    - [x] AC 6: devx's own `doctor`/`status`/`next` diffed byte-identical vs main
  - [ ] Phase 4: Consumer sweep and layout-aware scaffolding -> dlr104
  - [ ] Phase 5: Identity re-key and privatization -> dlr105
  - [ ] Phase 6: `devx layout migrate` -> dlr106
  - [ ] Phase 7: Doc truth -> dlr107
  - [ ] Retro story -> dlrret
- [ ] Stage: Retro
- [ ] Stage: Outcome
