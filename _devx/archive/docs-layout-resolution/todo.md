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
- [x] Stage: Execute
  - [x] Phase 1: The artifact map and the single layout reader → dlr101
    - [x] T1.1 `ArtifactKind` / `stageSubject()` / `pathToArtifactKind()`
    - [x] T1.2 `resolveDocsLayout()`; `docsLayoutFrom()` reduced to a wrapper
    - [x] T1.3 `docsLayout` + `layoutSource` on `EngineConfig`, above both guards
    - [x] T1.4 `docsLayoutUnset()` deleted; nag moved onto `layoutSource`
    - [x] T1.5 duplicate `DocsLayout` type replaced by a re-export
    - [x] T1.6 9 hand-built `engine` literals re-typed; `layoutWarnings()` rewritten
    - [x] Unplanned: a THIRD reader (`init-write.ts` `renderInitConfig`) closed
  - [x] Phase 2: Gate subject resolution → dlr102
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
  - [x] Phase 3: Workstream resolution and the flat-era guard → dlr103
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
  - [x] Phase 4: Consumer sweep and layout-aware scaffolding → dlr104
  - [x] Phase 5: Identity re-key and privatization → dlr105
    - [x] Confirm E-2's RED is honest (2 readers + 16 orphans + missing companion test)
    - [x] T5.2 `CASCADE_TABLE` re-keyed on `ArtifactKind`; `display` projection added
    - [x] T5.2 `STAGE_SHORTHAND` onto identities; flat-era names dropped (index owns them)
    - [x] T5.3 the three `entry.artifact` consumers through `stageSubject`/`artifactRel`
    - [x] T5.4 `TODO_FILENAME` re-export deleted; template source via `artifactRel("workstream", …)`
    - [x] T5.5 remaining `*_REL` refs migrated (`workstream`, `outcome`, `plan-helper`, 2 test files)
    - [x] T5.6 six `*_REL` + `artifactAbs` privatized; six orphaned `*Abs` deleted
    - [x] Unplanned: `buildArtifactKindIndex` + reverse map extracted to `artifact-index.ts`
          — E-2's orphan floor cannot hold for an export whose only caller is a test
    - [x] Unplanned: `init-write`'s `renderInitConfig` routed through `resolveDocsLayout`;
          the G-2 allowlist is now empty rather than maintained
    - [x] T5.1 `test/engine-layout-single-reader.test.ts` (6 tests, both invariants)
    - [x] Phase 4: sequential multi-lens review — 7 findings, all fixed in-place
    - [x] Narrowed the reverse lookup to an EXACT spelling (`--touched PLAN.md` was cascading)
    - [x] Inherited red fixed: dlr104's missing `phase 4:` line; escape route → debug-5284ae
  - [x] Phase 6: `devx layout migrate` → dlr106
  - [x] Phase 7: Doc truth → dlr107
    - [ ] T7.1 companion test `test/engine-layout-docs-truth.test.ts` (E-8 exists)
    - [ ] T7.1a `ARTIFACT_KINDS` runtime export — E-8's preferred shape; the
      type alias erases to 5 tagged matches, so 13-row set-equality needs it
    - [ ] T7.2 §15 table → 13 `ArtifactKind` rows + migrate invocation +
      `RETRO-<date>.md` recorded as layout-independent
    - [ ] T7.3 rewrite `docs_layout` schema description (no version bump)
    - [ ] T7.4 follow-up spec for the 9 skill-body path references
  - [ ] Retro story -> dlrret
- [x] Stage: Retro
- [x] Stage: Outcome
