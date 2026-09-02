# Deferred PRD/design corrections — Docs Layout Resolution (a494be)

**Date**: 2026-09-02
**Owner decision**: 2026-09-01 (PRD corrections), 2026-09-02 (design
correction). Both deferred rather than propagated.

## Why deferred

`CASCADE_TABLE`'s `PRD_REL` row (`src/lib/engine/revise.ts:44-48`) resets
**all four** gate flags — `prd_validated`, `design_verified`, `plan_verified`,
`evals_red`. The `DESIGN_REL` row resets three. So `devx revise --touched prd`
returns the workstream to the PRD stage and costs a full re-run of Gates 1 and
2 (the coverage gate needs a freshly judged table), and `--touched design`
costs Gate 2.

None of the corrections below changes a goal, use case, capability or
functional requirement's *intent*. They correct counts and site lists. The
plan carries the corrected numbers; this file exists so `devx outcome` scoring
has a source that is not the plan.

## What is stale, and where the truth lives

### In `prd/agent.md` and `expectations.md`

| Claim | Stated | Actual | Truth lives in |
|---|---|---|---|
| **G-2 baseline** — orphaned exports | 2 (`projectAgentRel`, `projectHumanRel`) | 8 exported resolvers with zero callers: `stageFileRel`, `outlineRel`, `outlineCritiqueRel`, `humanRel`, `projectAgentRel`, `projectHumanRel`, `projectOutlineCritiqueRel`, `checkpointsDirAbs`. Only `projectOutlineRel` has callers (`lib/engine/outline.ts:169`, `commands/outline.ts:243`). Plus dead constants `CHECKPOINTS_DIR_REL`, `RESULTS_REL`, `RED_REPORT_BASENAME`. | `plan/agent.md` Current state; risk R-9 |
| **G-2 is a dated goal** scored by `devx outcome` against this baseline | — | **Score G-2 against the corrected baseline (8), not the PRD's 2.** | this file |
| **FR-5 / E-3 baseline** — hand-join sites | 4, including `lib/graph/backfill.ts:350,363` | **Five**, and a different set. `backfill.ts:350` is a workstream-*base* join feeding the resolver correctly — not a bypass; its real defect is the enumeration at `:312-318`. The real five: `commands/todo.ts:86`, `lib/devx/mark-done.ts:525`, `lib/plan/validate-emit.ts:184`, `lib/engine/todo-truth.ts:49` (omitted by the PRD, and the highest-traffic of all), `commands/outcome.ts:492`. | `plan/agent.md` Current state; risks R-6, R-9 |
| **FR-2** — `docsLayoutFrom()` callers | "all five of its callers" | seven | `design/agent.md` |
| **UC-1** | not noted as blocked | **blocked today** by `createWorkstream`'s directory-existence refusal | `design/agent.md`; `plan/agent.md` Phase 4 |

### In `design/agent.md`

| Claim | Stated | Actual | Truth lives in |
|---|---|---|---|
| **Flat-era guards** | three sites "read a root `prd.md` as unambiguous evidence of an unmigrated repo" | **Two**, and only one of them needs the layout discriminator. `createWorkstream`'s refusal (`workstream.ts:323-331`) probes `join(wsAbs, "<stage>.md")` where `wsAbs` is the repo root under `project-level` — it genuinely misfires. `detectFlatWorkstreams` (`doctor/detect.ts:374-388`) scans `_devx/workstreams/<slug>/<stage>.md` and **never reads a repo-root file** — it cannot misfire; its only defect is the hardcoded root. `STAGE_SHORTHAND` is a key-identity problem, not a root-`prd.md` guard. | `plan/agent.md` Current state; T3.4, T3.5 |
| **`*Abs()` helpers** | nine | **ten** — `checkpointsDirAbs` (`artifacts.ts:198`) is missing from the design's accounting and has zero callers | `plan/agent.md` Current state; T4.2 |
| **Blast radius** | ~51 `*Abs()` sites, 40+ `*_REL` sites | **33 `*Abs()` call sites**; **72 lines / 93 occurrences** of the seven stage-shaped `*_REL` constants, across 17 modules | `plan/agent.md` Current state |
| **`mark-done.ts:525` failure mode** | "silently drops the file from the merge-cleanup commit, leaving it uncommitted on `main`" | **Unreachable.** `TODO_REL` is `todo.md` in both layouts over a base that already resolves to the repo root, so the hand-join produces the correct path. It is closed for representational reasons, not correctness. | `plan/agent.md` Current state |
| **`artifactAbs` privatization** | not mentioned; "hand-joining becomes unrepresentable" claimed on the `*_REL` constants alone | `artifactAbs(wsAbs, rel)` (`artifacts.ts:182`) is exported and takes an arbitrary rel, so it must go private too or the claim is overstated | `plan/agent.md` Phase 5; T5.6 |

## What must happen if this is ever propagated

Run `devx revise --touched prd` (resets four flags) and re-earn Gates 1 and 2,
or `devx revise --touched design` (resets three) for the design-only rows.
Do **not** hand-edit `prd/agent.md`, `expectations.md` or `design/agent.md`
without the cascade — `CASCADE_TABLE`'s own comment names that as the failure
it exists to prevent: stale gate flags standing over a rewritten artifact.

## Consequence for the RED stage

Two evals must be authored against **this file**, not against
`expectations.md`'s thresholds:

- **E-2** — assert 1 layout-key reader and 0 orphaned exported resolvers.
  The "down from 2" in the threshold is narrative and wrong (it is 8).
- **E-3** — assert **0 offending sites globally**, and be
  **negative-controlled**: demonstrated flagging all five real hand-joins
  before they are closed, and demonstrated *not* flagging `backfill.ts:350`
  or the two template-source sites. Without the negative control, an
  allowlist tuned against the stale four-site list can hide
  `todo-truth.ts:49` and still report 0.
