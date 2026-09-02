---
hash: dlr101
type: dev
created: 2026-09-02T09:14:00-06:00
title: "The artifact map and the single layout reader"
status: in-progress
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
