---
hash: dlr105
type: dev
created: 2026-09-02T09:14:00-06:00
title: "Identity re-key and privatization"
status: ready
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
plan: _devx/workstreams/docs-layout-resolution
phase: 5
blocked_by: [dlr104]
branch: feat/dev-dlr105
owner: null
---
## Goal

The riskiest phase, and deliberately the smallest surface that can carry the
risk: `CASCADE_TABLE` re-keyed on `ArtifactKind`, the `*_REL` constants and
`artifactAbs` made module-private, and E-2's orphan floor made satisfiable.
The only compile-breaking phase — which is exactly why it is cut from the
sweep. Plan phase 5 of workstream docs-layout-resolution.

## Acceptance criteria

- [ ] AC 1: `CASCADE_TABLE` is re-keyed on `ArtifactKind`; `cascadeFor()` compares
      identities via `pathToArtifactKind()` and gains NO layout parameter;
      `STAGE_SHORTHAND` maps names onto `ArtifactKind`s. A `display`
      projection is added, because `KNOWN_ARTIFACTS` is exported and joined
      into user-facing text — re-keying without it renders `[object
      Object]`.
- [ ] AC 2: `devx revise --touched prd`, `--touched prd.md`, `--touched
      design.md` and `--touched plan/agent.md` resolve to the same cascade
      rows they do on `main` under `workstream` layout, and to correct rows
      under `project-level`. The reverse lookup accepts BOTH layouts'
      spellings (R-4). An AMBIGUOUS shorthand returns `null` (refuses) rather
      than resolving wrongly — refusing is recoverable; resolving to the wrong
      cascade silently leaves stale gate flags over a rewritten artifact.
- [ ] AC 3: `commands/revise.ts:94-100,133`'s three `entry.artifact` consumers —
      the membership check, the refusal message and the JSON `touched:`
      output — carry readable paths, not `[object Object]`.
- [ ] AC 4: The six stage-shaped `*_REL` constants AND `artifactAbs` are not
      exported. Privatizing the constants alone is NOT enough:
      `artifactAbs(wsAbs, "prd/agent.md")` would stay expressible and a
      `join(...)`-shaped scan would not see it. `EVALS_DIR_REL` and
      `CHECKPOINTS_DIR_REL` STAY exported — they are layout-identical and
      `gate-evals.ts:41,321` depends on the former.
- [ ] AC 5: The `TODO_FILENAME` re-export chain (`todo-truth.ts:37` ->
      `mark-done.ts:51`, `commands/todo.ts:34`), the remaining `*_REL`
      references (`plan-helper.ts:61,464`, `commands/workstream.ts:19,99`) and
      the four test files that import the constants by name
      (`test/engine-artifacts.test.ts`,
      `test/workstream-migration-integrity.test.ts`,
      `test/next-todo-drift.test.ts`, `test/todo-sync.test.ts`) are all
      resolved. `npm run typecheck` passes — the compile-time proof.
- [ ] AC 6: `evals/E-2_single-reader.ts` flips GREEN — 1 layout-key reader and 0
      orphaned exported resolvers in `artifacts.ts` — and
      `test/engine-layout-single-reader.test.ts` exists and passes. The
      now-orphaned resolvers are deleted. NOTE the observed baseline is 3
      readers, not the 2 the PRD recorded: `init-write.ts:510`
      (`renderInitConfig`) is a third, found at RED. See
      `decisions/2026-09-02-deferred-prd-corrections.md`.
- [ ] AC 7: `evals/E-3_no-hand-joins.ts` STAYS green after privatization. The
      structural defense must not change the scan's verdict, only make a
      future violation harder to write. `npm test` green.

## Technical notes

Plan: `plan/agent.md` section "5. Phase".

`STAGE_SHORTHAND`'s obvious fix is WRONG, which is why the shorthand guard
lives here and not with the other flat-era guard. Swapping its target to
`projectAgentRel(stage)` under `project-level` breaks `devx revise` outright:
`cascadeFor()` matches `e.artifact === shorthand` against a `CASCADE_TABLE`
keyed on the `*_REL` constants, so after the swap nothing matches,
`cascadeFor()` returns `null`, and the command refuses on every invocation.
Today's byte-identity between `"prd.md"` and the flat spelling is
load-bearing. The fix is one level up — re-key on a layout-independent
identity — which is the same change that frees the constants to go private.
The two are one change viewed from opposite ends, which is why they are one
phase.

The residual scan follows the house precedent at
`test/outline-isolation.test.ts` (allowlist by regex). The residue — literal
basenames in shipped-template paths and genuinely layout-independent message
text — is documented as ACCEPTED-FRAGILE, not claimed sound.

Revert-safe (revert the PR).

## Status log

- 2026-09-02T09:14 — emitted by /devx-plan (RED gate PASS; workstream
  docs-layout-resolution, plan phase 5).
