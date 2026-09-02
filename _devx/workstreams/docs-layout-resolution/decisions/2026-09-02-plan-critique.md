# Plan-stage critique — Docs Layout Resolution (a494be)

**Date**: 2026-09-02
**Lenses**: pm, architect, dev, qa (`engine.critique.lenses`), run as four
parallel subagents against `plan/agent.md` draft 1.
**Why it ran at `thoroughness: send-it`**: the plan touches ≥
`engine.critique.min_surfaces` (2) surfaces — `src/lib/engine`,
`src/lib/doctor`, `src/lib/graph`, `src/lib/plan`, `src/lib/next`,
`src/commands`, `docs/`, `_devx/config-schema.json`.

Every lens ran under the grounding rule (a claim citing a file, line, symbol
or count is grep-verified or dropped). Findings the coordinator re-verified
independently before applying are marked ✔.

## Applied — structural

| # | Lens(es) | Finding | Change |
|---|---|---|---|
| 1 | qa ✔ | Every eval artifact named `test/engine-layout-*.test.ts` would resolve to the `cli` runner (`resolveRunner` longest-prefix; `.` matches everything), and `npm test` is an `&&` chain whose file argument reaches only `test:blocking`, whose `include` is the hand-maintained `SYNC_BLOCKING_TESTS`. The gate would record the whole suite's exit code, not the artifact's. | Eval artifacts moved to `evals/E-N_*.ts` (`npx tsx`, the `workstream-evals` runner), each also asserting its companion `test/` file exists. |
| 2 | architect ✔, pm, qa, dev | Phase 1 was declared "purely additive" but E-2's orphan-count half is structurally unsatisfiable there, and adding required `EngineConfig` fields re-types 8 hand-built test literals — plus `next-dispatch.test.ts`'s `layoutWarnings()` helper varies `merged` against a *fixed* `engine` literal, so moving the nag onto `layoutSource` breaks its four assertions. | E-2 moved to Phase 5. Phase 1 carries the single-reader half only, lists the 9 test-file sites, and claims runtime-unchanged rather than caller-unchanged. New risk R-9. |
| 3 | architect ✔ | Phase 2 could not deliver E-1: the gate *subject reads* are 12 `*Abs()` calls in `commands/gate.ts` that the draft deferred to Phase 4's sweep, so `devx gate prd` would refuse under `project-level` — itself a verdict difference. | Phase 2 owns those 12 sites; they are excluded from the sweep. New risk R-3. |
| 4 | pm ✔, architect ✔ | The `ArtifactKind`-driven template list breaks template *source* lookup: `workstream.ts:348-350` derives both destination and shipped-template source from one rel, and templates live in workstream shape (`_devx/templates/engine/prd/agent.md`; no `prd.md`). | Phase 4 Context pins destination-resolves / source-never, the rule already stated for `commands/todo.ts:94`. |
| 5 | pm ✔ | R-2's mitigation was self-falsifying: it claimed the Phase 3→4 window was unreachable because no repo is on `project-level`, when Phase 3 *was* the phase shipping the scaffolder that makes it reachable. | Restructured rather than argued: layout-aware scaffolding (E-5) moved out of Phase 3 into Phase 4, after the sweep. |
| 6 | architect ✔ | Phase 4 too large for one PR; the natural seam is the compile break. | Split into Phase 4 (behavior-preserving sweep + scaffolding) and Phase 5 (identity re-key + privatization). Seven phases; the departure from the owner's coarse 6-phase choice is stated in the plan's Phase checklist. |
| 7 | dev ✔ | `devx workstream new`'s slug is a commander **required** argument (`.argument("<slug>")`, plus an `args.length !== 1` check), so E-5's no-slug cases are unreachable and `src/commands/workstream.ts` appeared in no phase. | Added to Phase 4 with T4.9. |
| 8 | pm, architect ✔ | G-3 (the real ClassyLights migration) was owned by no task — Phase 5's criteria were entirely fixture-based, and the run is cross-repo and irreversible. | Phase 6 success criteria name `MANUAL.md` MV-a494be.1 as G-3's evidence; T6.6 files it. |
| 9 | pm ✔, architect ✔ | The artifact-*authoring* surfaces were unplanned: `.claude/commands/devx-plan.md` (6 refs) and `devx.md` (3) hardcode the folder shape, so under `project-level` agents write the folder shape while the CLI reads the flat one. | Recorded in "What we're NOT doing" with the S-1 prose-budget reason, and T7.4 files the follow-up spec rather than leaving it implicit. `RETRO-<date>.md` recorded as deliberately layout-independent. |

## Applied — accuracy corrections to the draft's own claims

| # | Lens(es) | Correction |
|---|---|---|
| 10 | architect ✔ | **Two flat-era guards, not three.** `detectFlatWorkstreams` scans `_devx/workstreams/<slug>/<stage>.md` and never reads a repo-root file, so it cannot misfire under `project-level`; its only defect is the hardcoded root. `createWorkstream`'s refusal probes `join(wsAbs, "<stage>.md")` and genuinely does misfire. The draft (following the design) gave the discriminator to the wrong one. |
| 11 | dev ✔, architect ✔ | **Ten `*Abs()` helpers, not nine** — `checkpointsDirAbs` (`artifacts.ts:198`) has zero callers anywhere and is absent from the design's accounting. |
| 12 | dev ✔ | **72 lines / 93 occurrences.** The draft's total and its per-symbol breakdown were in incompatible units; 10 multi-symbol import lines are double-counted by the breakdown. Inclusion rule stated: `EVALS_DIR_REL` and `CHECKPOINTS_DIR_REL` stay exported. |
| 13 | dev ✔, architect ✔ | **Five hand-joins, not four** — `commands/outcome.ts:492` is the fifth, and the design itself calls it "a genuine hand-join". |
| 14 | architect ✔ | **Three of the five are layout-invariant**: `todo.md` is the same basename in both layouts over a base that already resolves to the repo root, so `todo-truth.ts:49`, `commands/todo.ts:86` and `mark-done.ts:525` produce correct paths today. The design's claim that `mark-done.ts:525` "silently drops the file from the merge-cleanup commit" is **unreachable**. Only `validate-emit.ts:184,306` (which joins `PLAN_REL`) is correctness-bearing. All five are still closed, for the representational reason the design gives. |
| 15 | dev ✔, architect ✔ | **`artifactAbs` must go private too.** It takes an arbitrary rel, so privatizing the constants alone leaves `artifactAbs(wsAbs, "prd/agent.md")` expressible and the "unrepresentable" claim overstated. |
| 16 | dev ✔, architect ✔ | **T4.7 named the wrong module.** `src/lib/engine/next.ts` has zero `*Abs()` calls (reason strings only); the probes are in `src/commands/next.ts:282,292-295,305,347`. |
| 17 | dev ✔ | **`gate-prd.ts` has 19 `location:` fields and 6 `message:` strings from 9 constant usages**, not "ten `location:` fields". The 15 built from the `loc` local at `:248` and the message strings were both missed. |
| 18 | dev ✔ | **Four test files import the `*_REL` constants by name** and break at compile time — `engine-artifacts`, `workstream-migration-integrity`, plus `next-todo-drift` and `todo-sync`, which no lens listed. Owned by T5.5. |
| 19 | qa ✔ | **`vitest.shared.ts`'s `SYNC_BLOCKING_TESTS`** is a hand-maintained set that `test/vitest-split.test.ts` set-equality-checks; the git-driving and exit-code-asserting tests must be registered or the suite goes red. Added to Phases 4 and 6. |
| 20 | qa | **E-1's "0 verdict differences" was equality-only** and would go green if a regression broke both layouts identically. Criteria now pin all 8 combinations to `PASS` plus a deliberately-broken fixture pinned to `FAIL` per layout. |
| 21 | qa | **E-3's threshold is wrong in both directions** — names `backfill.ts:350` (not a bypass), omits `todo-truth.ts:49` (a real one). "Assert 0 globally" fixes the false positive but not the false negative. Criteria now require the scan to be **negative-controlled**. R-6 rewritten. |
| 22 | qa | **E-8's RED is partly born green**: Phases 2 and 4 implement rule 5 before Phase 7 runs, so the claim-check passes at authoring time. Phase 7 now states the 13-row set-equality is the RED-bearing assertion. |
| 23 | qa ✔ | **E-5's trigger covers 4 combinations, the threshold pinned 2.** Slug-supplied-under-`project-level` was unspecified everywhere. Criterion added. |
| 24 | qa ✔ | **Phase 7's prose-budget criterion was vacuous** — the canary measures `_devx/templates/engine/**` and `.claude/commands/devx-plan.md`, neither of which that phase edits. Dropped; moved to T7.4 where it bites. |
| 25 | pm | The PRD-corrections deferral was defensible on cost but its stated reason ("only baseline counts") was too generous. Reworded to name what goes stale, with `decisions/2026-09-02-deferred-prd-corrections.md` as outcome scoring's source. |
| 26 | architect | Phase 7 documented `devx layout migrate` before Phase 6 shipped it. Sequenced 7 after 6; recorded as R-10. |

## Not applied

- **architect: drop the "three flat-era guards read a root prd.md" framing
  from Current state.** Applied in substance (finding 10), but the framing is
  the *design's*, not just the plan's. Correcting `design/agent.md` would
  require `devx revise --touched design`, which resets `design_verified`,
  `plan_verified` and `evals_red`. Same cost calculus as the deferred PRD
  corrections; recorded here and in
  `decisions/2026-09-02-deferred-prd-corrections.md` instead.

## Unchanged, and confirmed sound by more than one lens

- The wave graph's dependency shape (1 → {2,3} → … → {6,7}).
- Placement of the `CASCADE_TABLE` re-key with the privatization rather than
  with the other flat-era guard — `CASCADE_TABLE` is literally keyed on the
  imported constants and `cascadeFor()` does string identity against them, so
  the two are one edit.
- R-5's refusal to describe the migration phase as revert-safe.
- The per-symbol `*Abs()` counts (33 total), the 17-module list, the four
  originally-cited hand-join line numbers, `engineConfigFrom()`'s two guards
  and the legacy-answer-loss hazard, `planFilenameWorkstreamRel`'s 4 call
  sites in 3 files, the 7 + 5 resolver call sites, and §15's 12 current rows —
  all independently re-derived and exact.
