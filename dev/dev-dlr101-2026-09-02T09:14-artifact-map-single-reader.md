---
hash: dlr101
type: dev
created: 2026-09-02T09:14:00-06:00
title: "The artifact map and the single layout reader"
status: done
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
plan: _devx/workstreams/docs-layout-resolution
phase: 1
blocked_by: []
branch: feat/dev-dlr101
owner: /devx-2026-09-02T0930-68861
---
## Goal

The foundation every other phase consumes: the `ArtifactKind` union,
`stageSubject(layout, base, kind)`, the reverse `pathToArtifactKind()` lookup,
the collapse to ONE layout reader, and `EngineConfig.docsLayout`. Additive in
production, NOT additive in the test suite. Plan phase 1 of workstream
docs-layout-resolution.

## Acceptance criteria

- [ ] AC 1: `src/lib/engine/artifacts.ts` exports `SubjectStage`,
      `ArtifactKind`, `StageSubject`, `stageSubject()` and
      `pathToArtifactKind()`. `stageSubject()` returns the docs/CONFIG.md §15
      path for all 13 artifact-kind rows under BOTH layouts, including the
      evals-stage outline row and `{ kind: "evals-dir" }` → `evals`. `evals`
      is absent from `SubjectStage`, so `{ kind: "agent", stage: "evals" }` is
      unrepresentable rather than branched around. Nothing in the repo
      exercises the evals row today, so the map must be tested AT `evals`
      specifically, not only at `prd`.
- [ ] AC 2: `stageSubject()` returns BOTH `rel` and `abs` — gate refusals print
      the relative form and reads use the absolute, and making callers derive
      one from the other is how two spellings drift.
- [ ] AC 3: `resolveDocsLayout(merged) -> { layout, source }` is added and
      `docsLayoutFrom()` becomes a thin wrapper that reads nothing itself.
      Exactly ONE function in `src/` reads `engine.docs_layout` or the legacy
      `personalization` layout key, asserted by a static scan. NO orphan
      assertion here — E-2's "0 orphaned exports" half is structurally
      unsatisfiable in an additive phase and belongs to phase 5 (R-9).
- [ ] AC 4: `EngineConfig` and `ENGINE_DEFAULTS` carry `docsLayout` +
      `layoutSource`, assigned in `engineConfigFrom()` ABOVE both early-return
      guards. A config blob with no `engine:` block but the legacy
      personalization key set to `project-level` yields
      `docsLayout: "project-level"`, `layoutSource: "legacy"`. A malformed
      value yields the shipped default and does not throw.
- [ ] AC 5: `docsLayoutUnset()` is deleted from `src/lib/next/gather.ts`; its
      caller (the unset-layout nag) becomes `engine.layoutSource ===
      "default"`. G-2 counts one FUNCTION — re-expressing the nag as a second
      exported predicate leaves the count at two.
- [ ] AC 6: `src/lib/init-questions.ts:58`'s duplicate `DocsLayout` type is
      replaced with an import from `artifacts.ts`.
- [ ] AC 7: The 8 hand-built `engine` literals are re-typed
      (`test/next-dispatch.test.ts:774,795,836,1882,1914`,
      `test/frontmatter-unreadable-reported.test.ts:34`,
      `test/spec-lock.test.ts:460`, `test/devx-split.test.ts:775`,
      `test/engine-prose-budget.test.ts:147`) and `layoutWarnings()`
      (`next-dispatch.test.ts:785-830`) varies `engine.layoutSource` instead
      of `merged`.
- [ ] AC 8: `npm run typecheck` and the full suite are green; devx's own runtime
      behavior is UNCHANGED — no production caller moved in this phase.

## Technical notes

Plan: `_devx/workstreams/docs-layout-resolution/plan/agent.md` section
"1. Phase". The pre-guard ordering is load-bearing and easy to get backwards —
`resolveDocsLayout()` is defensive on both reads, which is what makes it safe
above the guards. Production is not at risk either way (`context.ts:47`
derives `engine` from the same `merged`); the test helper is.

R-1 (accepted, not mitigated): this phase exports `stageSubject()` while the
layout-blind surface still stands, and the E-3 scan that forbids the old
spelling does not exist until phase 4. A consumer added in that window can
pick the wrong spelling and pass CI. The alternative is one unreviewable
phase.

## Status log

- 2026-09-02T09:14 — emitted by /devx-plan (RED gate PASS; workstream
  docs-layout-resolution, plan phase 1).
- 2026-09-02T09:30:38-06:00 — claimed by /devx in session /devx-2026-09-02T0930-68861
- 2026-09-02T09:36 — phase 2: spec ACs direct (v2 native); 8 ACs;
  workstream=docs-layout-resolution; red-artifacts=none assigned to phase 1
  (E-2 is verified in phase 5, E-4 in phase 3 — see the plan's Expectation
  coverage table). Phase 1 is tests-first, so the RED was authored here:
  `test/engine-layout-map.test.ts` ran 47 failed / 4 passed against the
  unimplemented map, failing for the stated reason (`resolveDocsLayout is not
  a function` — feature missing, not harness breakage).
- 2026-09-02T09:40 — phase 3: implemented T1.1-T1.6. `ArtifactKind` /
  `SubjectStage` / `StageSubject` / `stageSubject()` / `pathToArtifactKind()`
  + `resolveDocsLayout()` in `src/lib/engine/artifacts.ts`; `docsLayout` +
  `layoutSource` on `EngineConfig`/`ENGINE_DEFAULTS`, assigned above BOTH
  early-return guards; `docsLayoutUnset()` deleted from `next/gather.ts` and
  its nag moved onto `engine.layoutSource === "default"`; the duplicate
  `DocsLayout` at `init-questions.ts:58` replaced by a re-export; a THIRD
  reader the plan did not name (`init-write.ts` `renderInitConfig`) closed by
  destructuring, which also removed a second hardcoded `"workstream"`.
  9 test literal sites re-typed onto `{ ...ENGINE_DEFAULTS }`.
  `npm run typecheck` clean.
- 2026-09-02T09:58 — phase 4: 3-agent parallel adversarial review (Blind
  Hunter + Edge Case Hunter + Acceptance Auditor), the sanctioned
  above-threshold shape (~660 added lines, map-bearing;
  `review.above_threshold_shape: parallel`). ~40 findings (2 HIGH, ~20 MED,
  rest LOW), ALL fixed in-place; 4 converged across 2+ reviewers.
  Most load-bearing fix: `artifactRel()` was re-spelling the project-level
  names instead of calling the four existing `project*Rel` helpers, which put
  a SECOND definition of the project-level outline basename in the tree —
  `PROJECT_LEVEL_OUTLINE_BASENAMES` derives from `projectOutlineRel`, so the
  human-only outline guard could have moved while `stageSubject` stayed put.
  Also fixed: collision guard compared only the discriminant (a `human·prd` /
  `human·design` clash would silently drop, not throw) + a seam so the throw
  is provable; `pathToArtifactKind` handed out the map's own objects
  (mutable, process-wide poisoning) — now frozen; path normalization unified
  across both directions (`./`, `//`, `..`, `\`, trailing slash, case);
  `sectionOf` accepted arrays while every other engine guard rejects them;
  `SUBJECT_STAGES` hand-restated rather than derived from `STAGE_DIRS`;
  `ENGINE_DEFAULTS` frozen (its array was aliased into every config).
  The G-2 scan itself had three holes, all closed: it deduped readers by
  function NAME (a second reader beside `resolveDocsLayout` collapsed into it
  — a false pass, demonstrated); it was blind to destructuring reads (the
  form my own first draft used to reach a count of 1 — reverted to `??` and
  the scan now catches bindings, with `renderInitConfig` allowlisted BY NAME
  as a write site rather than hidden by spelling); and its indexed-access
  branches were permanently dead because `codeOnly()` blanks string bodies,
  so the legacy `["docs.layout"]` spelling could never have matched — caught
  by a negative control I added on the reviewers' prompting.
  Re-review clean.
- 2026-09-02T09:58 — phase 4 DECLARED DEVIATION from AC 8's "runtime behavior
  UNCHANGED": the `devx next` unset-layout advisory is the one production
  caller that moved, and it is not behavior-preserving. The retired
  `docsLayoutUnset()` asked whether the key was PRESENT, so a typo
  (`docs_layout: workstrem`) counted as chosen and stayed SILENT while
  artifacts resolved through the default anyway; `layoutSource` asks whether a
  layout RESOLVED, so it now nags. Reachable — `loadMerged` runs no schema
  validation. Kept (it is the better signal) and the message reworded to
  "unset or not one of `workstream` / `project-level`", because the old text
  would have told a user their key is unset while it sat in their config.
  Verified against a real scratch repo, both cases; pinned end-to-end in
  `test/next-dispatch.test.ts`.
- 2026-09-02T10:05 — phase 5: local gate GREEN — full `npm test` on the
  touched `cli` project: 135 + 34 test files, **4,030 tests passed**, 6 todo,
  0 failed; `npm run typecheck` clean; REAL_EXIT=0. RED evals verified not
  moved (E-2/E-4 step bodies untouched; both still RED on the halves later
  phases own). QA walkthrough emitted at
  `test/test-3ca108-2026-09-02T09:57-dlr101-qa-walkthrough.md` (fresh hash,
  NOT the story's) — 4 machine checks executed inline with real output pasted,
  1 human check outstanding; TEST.md row added.
- 2026-09-02T10:06 — phase 6: committed f1dd64f (14 files, +1254/-102),
  including the as-built plan sync — `plan/agent.md`'s phase-1 row now records
  the unplanned `init-write.ts` third reader and the nag behaviour delta.
- 2026-09-02T10:07 — phase 7: pushed `feat/dev-dlr101`; PR
  https://github.com/LeoTheMighty/devx/pull/151 (body rendered by `devx
  pr-body`, no unresolved placeholders).
- 2026-09-02T10:11:33-06:00 — merged via PR #151 (squash → ef3e3f5)
