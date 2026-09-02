---
hash: dlr105
type: dev
created: 2026-09-02T09:14:00-06:00
title: "Identity re-key and privatization"
status: in-progress
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
plan: _devx/workstreams/docs-layout-resolution
phase: 5
blocked_by: [dlr104]
branch: feat/dev-dlr105
owner: /devx-2026-09-02T1226-80105
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
- 2026-09-02T12:26:10-06:00 — claimed by /devx in session /devx-2026-09-02T1226-80105
- 2026-09-02T12:35 — phase 2: spec ACs direct (v2 native); 7 ACs;
  workstream=docs-layout-resolution; red-artifacts=evals/E-2_single-reader.ts
  (this phase's), evals/E-3_no-hand-joins.ts (must stay green). E-2 re-run and
  watched failing NOW for its stated reason — 2 layout-key readers
  (`artifacts.ts#resolveDocsLayout`, `init-write.ts#renderInitConfig`), 16
  orphaned exported resolvers, and the missing companion test. Real output,
  real line numbers: the feature is missing, not the harness (the mlc101
  check). E-3 confirmed GREEN at baseline so its verdict has a before.
- 2026-09-02T13:00 — phase 3: `CASCADE_TABLE` re-keyed on `ArtifactKind` with
  a `display` projection (`KNOWN_ARTIFACTS` renders paths, not `[object
  Object]`); `cascadeFor()` resolves through `pathToArtifactKind()`, takes NO
  layout parameter, and accepts both layouts' spellings; `STAGE_SHORTHAND`
  maps names onto identities (a Map, not an object literal — the key is raw
  user input). The six stage-shaped `*_REL` constants and `artifactAbs` are
  module-private; the six `*Abs` helpers that never acquired a caller are
  deleted. TWO departures from the plan's Files list, both forced: the reverse
  index (`buildArtifactKindIndex` + `REVERSE_MAP` + `pathToArtifactKind`)
  moved to a new `src/lib/engine/artifact-index.ts`, because E-2's
  zero-orphan floor cannot hold for an export whose only caller is a test and
  keeping it in place would have meant deleting the collision guard's negative
  control; and `init-write.ts#renderInitConfig` was routed through
  `resolveDocsLayout()`, which is what takes the reader count from 2 to 1 and
  empties the G-2 allowlist rather than maintaining it. `outcome.ts`,
  `commands/workstream.ts` and `commands/plan-helper.ts` prose sites moved too
  — the constants going private is a compile break, not a choice.
- 2026-09-02T13:10 — phase 4: sequential multi-lens review (Blind Hunter →
  Edge Case Hunter → Acceptance Auditor, one pass each, context reset between)
  on a 780/284-line, 16-file surface — above the substantial-surface
  threshold. The `review.above_threshold_shape: parallel` shape was
  UNAVAILABLE: this session's policy forbids spawning subagents, so the
  sanctioned compensation ran instead (CLAUDE.md § Self-review, /devx Phase 4
  step 2b). 7 findings, ALL fixed in-place. Most load-bearing: `--touched
  PLAN.md` — devx's own backlog — resolved to the plan artifact and would have
  cleared `plan_verified` + `evals_red`, because the reverse index lowercases
  its keys for this exact surface; `cascadeFor` now narrows the lookup back to
  an EXACT spelling, so every input `main` accepted resolves identically and
  the near-misses refuse. Also: genericizing `validate-emit`'s refusal broke
  the assertion at `test/plan-validate-emit.test.ts:818` (now rendered through
  the layout, which is also correct for a flat repo); the shorthand lookup
  reached `Object.prototype` on `--touched constructor`; `commands/revise.ts`
  kept its own copy of the shorthand names; two comments stated mechanisms
  that were not true; ACs 3 and 4 were pinned nowhere. Re-review clean.
- 2026-09-02T13:25 — phase 5: local gates green in the worktree —
  `npm test` REAL_EXIT=0 (typecheck + build + 138 parallel files / 3,293 tests
  + 36 blocking files / 838 tests). E-2 GREEN (1 reader, 0 orphans,
  companion test present); E-3 STAYS GREEN with its negative control still
  discriminating; E-1/E-4/E-5 re-run green. Coverage is `null` for this
  project and informational under YOLO. RED evals unmoved: no step body was
  edited — the eval was satisfied by the code, which is the whole point of the
  lock. QA walkthrough emitted at `test/test-ef5059-2026-09-02T13:16-dlr105-qa-walkthrough.md`
  (5 machine checks executed against the built CLI with real output; 2 human
  checks outstanding, both needing a `project-level` repo that does not exist
  yet). INHERITED RED fixed here, not caused here: `main` was already failing
  `test/devx-status-log-discipline.test.ts` because dlr104 shipped without its
  `phase 4:` line — reconstructed from PR #154's body, which records that
  review verbatim. The escape route that let it merge unnoticed is filed as
  `debug/debug-5284ae` + a DEBUG.md row.
