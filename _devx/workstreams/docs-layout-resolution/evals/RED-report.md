---
gate: PASS
status_reason: 'Every runnable expectation observed RED for the right reason (8 run(s), 0 deferred).'
reviewer: 'devx gate evals'
updated: 2026-09-02
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/docs-layout-resolution — 2026-09-02

## Runs

### E-1: A gate resolves its subject through the layout (P0)

- **Artifact**: _devx/workstreams/docs-layout-resolution/evals/E-1_gate-subjects.ts
- **Command**: `npx tsx docs-layout-resolution/evals/E-1_gate-subjects.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
    - coverage-design under 'project-level' (good) printed 'design/agent.md', which does not exist on the fixture disk — the gate's output contract still names the folder layout
    - coverage-design (good fixture): verdict differs by layout — workstream=PASS, project-level=FAIL. Content is byte-identical; only the path moved.
    - coverage-design under 'project-level' (broken) printed 'design/agent.md', which does not exist on the fixture disk — the gate's output contract still names the folder layout
    - coverage-plan under 'project-level' (good fixture) returned FAIL, expected PASS — exit 1: {"gate":"FAIL","hash":"b7e38f","refusal":"plan gate is open but plan/agent.md does not exist — run `/devx plan` first"}
    - coverage-plan under 'project-level' (good) printed 'plan/agent.md', which does not exist on the fixture disk — the gate's output contract still names the folder layout
    - coverage-plan (good fixture): verdict differs by layout — workstream=PASS, project-level=FAIL. Content is byte-identical; only the path moved.
    - coverage-plan under 'project-level' (broken) printed 'plan/agent.md', which does not exist on the fixture disk — the gate's output contract still names the folder layout
    - evals under 'project-level' (good fixture) returned FAIL, expected PASS — exit 1: {"gate":"FAIL","hash":"b7e38f","report":"./evals/RED-report.md","reasons":["E-1 artifact 'evals/E-1_deferred.ts' does not exist on disk — author it (/devx red) before this gate can pass","E-2 artifact 'evals/E-2_deferred.ts' does not exist on disk","E-3 artifact 'evals/E-3_deferred.ts' does not exis
    - evals (good fixture): verdict differs by layout — workstream=PASS, project-level=FAIL. Content is byte-identical; only the path moved.
    - test/engine-layout-gate-subjects.test.ts missing — the 8-combination verdict-equality invariant is not pinned in `npm test` (feature missing, T2.1)
  ```
- **RED verdict**: right-reason

### E-2: Exactly one function reads the layout key (P0)

- **Artifact**: _devx/workstreams/docs-layout-resolution/evals/E-2_single-reader.ts
- **Command**: `npx tsx docs-layout-resolution/evals/E-2_single-reader.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-2 RED — the layout key still has more than one reader:
    - 3 functions read the layout key; G-2 requires exactly 1. Found: src/lib/engine/artifacts.ts:169 (docsLayoutFrom), src/lib/init-write.ts:510 (renderInitConfig), src/lib/next/gather.ts:1169 (docsLayoutUnset)
    - 8 exported resolver(s) in src/lib/engine/artifacts.ts have no production caller — delete them or give them one: stageFileRel, outlineRel, outlineCritiqueRel, humanRel, projectAgentRel, projectHumanRel, projectOutlineCritiqueRel, checkpointsDirAbs
    - test/engine-layout-single-reader.test.ts missing — the single-reader + zero-orphan invariant is not pinned in `npm test` (feature missing, T5.1)
  ```
- **RED verdict**: right-reason

### E-3: No consumer builds a stage-subject path from string parts (P0)

- **Artifact**: _devx/workstreams/docs-layout-resolution/evals/E-3_no-hand-joins.ts
- **Command**: `npx tsx docs-layout-resolution/evals/E-3_no-hand-joins.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
    - src/commands/outcome.ts:492 builds a stage-subject path from string parts: `${ws.workstreamRel}/RESULTS.md`
    - src/commands/todo.ts:86 builds a stage-subject path from string parts: join(ws.workstreamAbs, TODO_FILENAME)
    - src/lib/devx/mark-done.ts:525 builds a stage-subject path from string parts: join(opts.repoRoot, planHash.workstreamRel, TODO_FILENAME)
    - src/lib/engine/render.ts:119 builds a stage-subject path from string parts: `${ws}/${RED_REPORT_REL}`
    - src/lib/engine/render.ts:124 builds a stage-subject path from string parts: `${ws}/${DECISIONS_DIR_REL}/${report}`
    - src/lib/engine/todo-truth.ts:49 builds a stage-subject path from string parts: join(workstreamAbs, TODO_FILENAME)
    - src/lib/next/gather.ts:900 builds a stage-subject path from string parts: `${wsRel}/todo.md unreadable: ${errMessage(e)}`
    - src/lib/plan/validate-emit.ts:184 builds a stage-subject path from string parts: `${wsRoot}/${inputs.epicSlug}/${PLAN_REL}`
    - src/lib/plan/validate-emit.ts:306 builds a stage-subject path from string parts: `(?:^|[\\s('"\`])${escapeRe(wsDirMarker)}/${escapeRe(PLAN_REL)}(?:$|[\\s)'"\`,;])`
    - test/engine-layout-no-hand-joins.test.ts missing — the no-hand-joins invariant is not pinned in `npm test` (feature missing, T4.1)
  ```
- **RED verdict**: right-reason

### E-4: Workstream resolution reaches the repo root under project-level (P0)

- **Artifact**: _devx/workstreams/docs-layout-resolution/evals/E-4_resolve-workstream.ts
- **Command**: `npx tsx docs-layout-resolution/evals/E-4_resolve-workstream.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-4 RED — workstream resolution does not reach the repo root under project-level:
    - EngineConfig carries no layout — engineConfigFrom({engine:{docs_layout:"project-level"}}).docsLayout is undefined. Every resolver threads this object, so until T1.3 lands the layout is unreachable from resolveWorkstream (T1.3 → T3.2).
    - [workstream: absent] resolveWorkstream threw: workstream dir '_devx/workstreams/scene-engine' not found — run `devx workstream new scene-engine --hash b7e38f`
    - [workstream: stale folder path] resolveWorkstream threw: workstream dir '_devx/workstreams/scene-engine' not found — run `devx workstream new scene-engine --hash b7e38f`
    - test/engine-layout-resolve-workstream.test.ts missing — the 3-state resolution invariant is not pinned in `npm test` (feature missing, T3.1)
  ```
- **RED verdict**: right-reason

### E-5: Scaffolding produces the shape the layout names (P0)

- **Artifact**: _devx/workstreams/docs-layout-resolution/evals/E-5_scaffold.ts
- **Command**: `npx tsx docs-layout-resolution/evals/E-5_scaffold.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-5 RED — scaffolding does not produce the shape the layout names:
    - [project-level, no slug] exited 1 — UC-1's primary path is refused: error: missing required argument 'slug'
    - [workstream, no slug] the refusal does not name `engine.docs_layout: workstream` as the reason the slug is required — got: error: missing required argument 'slug'
    - [project-level, with slug] the doc set did not land at the repo root
    - [project-level, with slug] the slug created a directory — under this layout it names the plan spec only
    - test/engine-layout-scaffold.test.ts missing — the 4-combination scaffolding invariant is not pinned in `npm test` (feature missing, T4.2)
  ```
- **RED verdict**: right-reason

### E-6: A mid-flight migration preserves every gate verdict (P0)

- **Artifact**: _devx/workstreams/docs-layout-resolution/evals/E-6_migrate.ts
- **Command**: `npx tsx docs-layout-resolution/evals/E-6_migrate.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-6 RED — there is no migration that preserves gate verdicts:
    - `devx layout migrate --to project-level` exited 1 — the migration surface does not exist yet (T6.5): error: unknown command 'layout'
    - test/engine-layout-migrate.test.ts missing — the verdict-preservation invariant is not pinned in `npm test` (feature missing, T6.1)
  ```
- **RED verdict**: right-reason

### E-7: The migration refuses rather than half-moving (P0)

- **Artifact**: _devx/workstreams/docs-layout-resolution/evals/E-7_migrate-refusals.ts
- **Command**: `npx tsx docs-layout-resolution/evals/E-7_migrate-refusals.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-7 RED — there is no migration to refuse:
    - [two live workstreams] the refusal does not name what it found (expected to match /workstream/i) — got: error: unknown command 'layout'
    - [doc set already at the destination] the refusal does not name what it found (expected to match /prd\.md|doc set|already/i) — got: error: unknown command 'layout'
    - [dirty working tree] the refusal does not name what it found (expected to match /dirty|uncommitted|clean/i) — got: error: unknown command 'layout'
    - [--dry-run] exited 1 on a migratable repo — the plan must render without executing: error: unknown command 'layout'
    - [--dry-run] the rendered plan does not name the moves it would make
    - test/engine-layout-migrate-refusals.test.ts missing — the refusal invariant is not pinned in `npm test` (feature missing, T6.1)
  ```
- **RED verdict**: right-reason

### E-8: The shipped docs describe the implemented behavior (P1)

- **Artifact**: _devx/workstreams/docs-layout-resolution/evals/E-8_docs-truth.ts
- **Command**: `npx tsx docs-layout-resolution/evals/E-8_docs-truth.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-8 RED — the shipped docs do not describe the implemented behavior:
    - src/lib/engine/artifacts.ts exposes no enumeration of ArtifactKind (neither an `ARTIFACT_KINDS` runtime export nor an `ArtifactKind` type alias) — §15 cannot be set-compared against what the resolver actually handles (feature missing, T1.1)
    - §15's artifact table has no row for `checkpoints` — the resolver handles it and the table does not name it
    - §15's artifact table has no row for `RESULTS.md` — the resolver handles it and the table does not name it
    - false claim — §15 rule 5: a gate resolves its subject through the layout, but src/commands/gate.ts still resolves layout-blind (`…Abs(ws.workstreamAbs)`)
    - test/engine-layout-docs-truth.test.ts missing — the doc-truth invariant is not pinned in `npm test` (feature missing, T7.1)
  ```
- **RED verdict**: right-reason

## Deferred stubs

- none
