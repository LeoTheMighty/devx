---
hash: eac479
type: plan
created: 2026-07-24T09:57:56-06:00
title: Harness Fold In
status: in-progress
stage: executing
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: true
  plan_verified: true
  evals_red: true
outcome:
  status: null
  measure_by: null
workstream: _devx/workstreams/harness-fold-in
---

## Goal

Workstream 'Harness Fold In' — PRD stage next. Artifacts live in `_devx/workstreams/harness-fold-in/`.

## Status log

- 2026-07-24T09:57 — workstream scaffolded by `devx workstream new harness-fold-in`.
- 2026-07-24T10:12 — PRD stage: `devx gate prd eac479` → PASS on first run (`prd_validated` flipped, `stage: design`). Artifacts: `_devx/workstreams/harness-fold-in/prd.md` + `expectations.md` (7 E-blocks: 3×P0, 3×P1, 1×P2). Seed: 2026-07-24 session digest of `mycase/8am-harness` PRs #20–#27. 4 intake decisions resolved interactively with the user: /devx-learn runs anywhere but framework-fix PRs only in the devx repo; todo drift detection lives in `devx next` (advisory); gate verdicts persist as an additive frontmatter sibling map; learn nudge is friction-observed-only. Critique step skipped (thoroughness: send-it). PLAN.md row added under Cross-cutting plans.
- 2026-07-24T12:40 — Design stage: `devx gate coverage eac479 --table` (design mode) → PASS (`design_verified` flipped, `stage: plan`). Artifacts: `_devx/workstreams/harness-fold-in/design.md` + `decisions/2026-07-24-design-verify.md` (22/22 covered after one fix round: FR-5 renderFocusLine + devx-next wiring, FR-8 self-trigger clause + bucket destinations). 3 deferred decisions resolved with the user: `gate_verdicts:` uses gate-name keys (prd/design/plan/evals); consumer-repo learn proposals → `docs/updates/<date>-<slug>.md` (shared with locked-machinery guard); `devx status` gets a minimal real implementation (stage + gates + focus). Design-added primitives: `devx todo sync <hash>`, `devx learn-helper slug`.
- 2026-07-24T14:05 — Plan stage: `devx gate coverage eac479 --table` (plan mode) → PASS on first run (`plan_verified` flipped, `stage: red`). Artifacts: `_devx/workstreams/harness-fold-in/plan.md` (5 phases, user-approved cut: todo core / gate verdicts / todo sync + renderers + status / devx-learn / skill wiring; P2 parallel-safe with P1, P4 parallel-safe with P1–P3) + `checkpoints/plan-coverage-table.json` + `decisions/2026-07-24-plan-verify.md` (7/7 E-ids covered, 0 extras; all 7 eval artifacts are `test/*.test.ts` tests-first paths). Critique step skipped — sizing call: touched surface is the `cli` project only, 1 stack layer < `engine.critique.min_surfaces: 2` at thoroughness send-it.
- 2026-07-24 — RED stage: retargeted all 7 eval artifacts `test/*.test.ts` → `evals/E-*.ts` via `devx revise eac479 --touched plan.md` (failing vitest suites in the default glob would deadlock CI-green merges across all 5 phase PRs; workstream-evals runner is the codified v2x101 precedent — see `decisions/2026-07-24-red-artifact-retarget.md`); replay `devx gate coverage eac479 --table` (plan mode) → PASS (`plan_verified` re-flipped). `devx gate evals eac479` → PASS on first run, 7/7 right-reason RED (`evals_red` flipped, `stage: executing`). Artifacts: `evals/E-1_todo-scaffold.ts` … `E-7_skill-todo-discipline.ts` + `evals/RED-report.md`. Emitted: dev specs hfi101–hfi105 (one per phase, dependency order) + hfiret retro co-emitted via `devx plan-helper emit-retro-story`; `DEV.md § Cross-cutting plans § Epic — harness-fold-in`; `devx plan-helper validate-emit harness-fold-in` ok; PLAN.md row flipped `[x]`.
