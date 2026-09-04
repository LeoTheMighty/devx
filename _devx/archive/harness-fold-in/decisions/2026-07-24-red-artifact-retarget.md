# Decision — RED artifacts retargeted from `test/*.test.ts` to `evals/*.ts` (2026-07-24, RED stage open)

## What changed

The plan's Expectation-coverage table originally named the permanent vitest
suites (`test/*.test.ts`) as the seven RED eval artifacts. At RED open this
was retargeted via `devx revise eac479 --touched plan.md` to standalone tsx
acceptance scripts under `_devx/workstreams/harness-fold-in/evals/`
(`E-1_todo-scaffold.ts` … `E-7_skill-todo-discipline.ts`), run by the
`workstream-evals` runner (`npx tsx`). The E-blocks' Verified-by fields in
`expectations.md` are unchanged — each phase still lands its permanent
suite at that exact path, and each acceptance script asserts that suite
exists in addition to probing the behavior.

## Why

Committing failing vitest suites at `test/*.test.ts` puts them inside the
default `npm test` glob (`vitest.config.ts` include `test/**/*.test.ts`)
and the `tsconfig.json` typecheck include (`test/**/*.ts`). Both run in
`devx-ci.yml` on every push/PR. RED-by-design tests there would:

1. Turn `main` red the moment the RED-stage commit lands, and keep every
   intermediate phase PR red until Phase 5 ships — deadlocking the YOLO
   merge gate (CI green is the only gate).
2. Fail for the wrong reason at the gate: the `cli` runner's command
   (`npm test --silent <file>`) runs the full compound script including
   `npm run typecheck`, so a test importing a not-yet-existing module dies
   as a TS compile error, not an observed missing behavior.

This is the exact failure class the `workstream-evals` runner was created
for (v2e102; `devx.config.yaml` comment: "standalone tsx scripts under
`_devx/workstreams/*/evals/`, never part of `npm test`") and the pattern
portability-install's plan codified ("RED artifacts don't break CI across
this workstream's five PRs — the v2x101 precedent").

## Mechanics honored

- Retargeting an agreed artifact path requires `devx revise` (RED stage
  rule 1) — done; cascade reset `plan_verified`, replay re-runs
  `devx gate coverage eac479` (plan mode) before `devx gate evals`.
- P0 floor is unaffected: `.ts` scripts under a `projects:` runner are
  mechanically runnable.
