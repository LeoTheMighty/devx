---
hash: dlr104
type: dev
created: 2026-09-02T09:14:00-06:00
title: "Consumer sweep and layout-aware scaffolding"
status: done
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
plan: _devx/workstreams/docs-layout-resolution
phase: 4
blocked_by: [dlr102, dlr103]
branch: feat/dev-dlr104
owner: /devx-2026-09-02T1118-43725
---
## Goal

Every remaining consumer moves onto the resolver and the ten `*Abs()`
helpers become layout-aware wrappers over the map. Entirely
behavior-preserving under `workstream` layout, with NO compile break — that is
the seam this phase is cut on. Plan phase 4 of workstream
docs-layout-resolution.

## Acceptance criteria

- [ ] AC 1 (ORDERING, load-bearing): `evals/E-3_no-hand-joins.ts` +
      `test/engine-layout-no-hand-joins.test.ts` are authored FIRST, RED
      against the live sites, and the negative control is demonstrated BEFORE
      any hand-join is closed: the scan flags every real bypass
      (`todo-truth.ts:49`, `commands/todo.ts:86`, `mark-done.ts:525`,
      `validate-emit.ts:184` and `:306`, `outcome.ts:492`, `gather.ts:900`,
      `render.ts:119,124`, plus the `gate.ts`/`outcome.ts` message sites) and
      does NOT flag `backfill.ts:350` or the two template-SOURCE sites.
      Without the control, an allowlist tuned against a stale list can hide a
      real bypass and still report 0 (R-6).
- [ ] AC 2: The ten `*Abs()` helpers take the resolved base
      (`{ repoRoot, workstreamRel, layout }` — what `resolveWorkstream`
      already returns) instead of a bare `wsAbs`, and the 21 remaining call
      sites are updated (33 minus the 12 phase 2 owns).
- [ ] AC 3: All hand-joins are closed and the two locals shadowing `todoAbs` are
      renamed; `backfill.ts:312-318`'s ENUMERATION is layout-resolved (not its
      `planAbs`/`todoAbs` calls, which are correct). `devx next` probes
      (`gather.ts:927,947,966,972-975`; `commands/next.ts:282,292-295,305,347`)
      and `engine/next.ts`'s reason strings, plus the `outcome`/`status`
      probes, route through the resolver.
- [ ] AC 4: `evals/E-3_no-hand-joins.ts` reports 0 offending sites GLOBALLY —
      not against a known list — naming file and line on failure.
- [ ] AC 5: `devx workstream new` with NO slug under `project-level` creates 6 of
      6 root artifacts (`prd.md`, `expectations.md`, `todo.md`, and empty
      `decisions/`, `checkpoints/`, `evals/`) and a plan spec whose
      `workstream:` is `.`. With no slug under `workstream` it exits 1 with
      text containing `engine.docs_layout: workstream`. WITH a slug under
      `project-level` the slug names the plan spec's filename and title, names
      no directory, and the doc set still lands at the root.
- [ ] AC 6: `commands/workstream.ts`'s commander argument becomes `[slug]` and
      the `args.length !== 1` check moves into `runWorkstreamNew` where the
      refusal can name the layout. Without this the E-5 no-slug cases are
      UNREACHABLE — commander rejects the invocation first.
- [ ] AC 7: Only the template DESTINATION is layout-resolved. `workstream.ts:350`
      and `commands/todo.ts:94` derive the shipped-template SOURCE from
      workstream-shaped paths and must NOT route through `stageSubject()` — an
      `ArtifactKind`-driven rel of `prd.md` looks for
      `_devx/templates/engine/prd.md`, which does not exist, and throws
      `engine template missing`.
- [ ] AC 8: `createWorkstream`'s doc-set probe asks "is a doc set already present
      at this base", not "does the directory exist" — under `project-level`
      the directory IS the repo root, which always exists, so the old probe
      throws on every invocation and UC-1 is refused. The one-doc-set
      predicate is LOCAL, carries `lay101`'s signature, and is deleted on
      adoption (R-8). `SCAFFOLD_SUBDIRS` land at the repo root under
      `project-level` (owner decision, 2026-09-01).
- [ ] AC 9: `evals/E-5_scaffold.ts` flips GREEN,
      `test/engine-layout-scaffold.test.ts` exists and is registered in
      `SYNC_BLOCKING_TESTS` (`vitest.shared.ts`); under `project-level`
      `devx next` selects the correct stage row, `devx graph` phase ordering
      is non-empty, and `devx outcome`/`devx status` resolve real paths.
- [ ] AC 10: `npm run typecheck` passes with NO constant privatized — this phase
      introduces no compile break. devx's own `devx next` / `devx graph` /
      `devx todo sync` / `devx workstream new <slug>` output is byte-identical
      to `main`; `npm test` green.

## Technical notes

Plan: `plan/agent.md` section "4. Phase".

`devx next` row selection is the most user-visible breakage in the workstream
and is NOT a hand-join: the probes call `prdAbs(wsAbs)` correctly into a
layout-blind helper, so under `project-level` every stage probe fails and
`devx next` reports "PRD not yet authored" forever on a repo whose PRD sits at
`prd.md`.

Two message-site classes, kept apart: `gather.ts:900` prints a path that does
NOT exist under `project-level` (correctness); `render.ts:119,124` render
existing paths with a stray `./` prefix (cosmetic).

R-2 is closed structurally, not argued away: scaffolding lands HERE, after the
sweep, so a `project-level` repo cannot be created until the resolvers behind
`devx next` / gates / `todo` already resolve correctly.

R-7: reverting this phase's code does not un-scaffold a workstream already
created. Artifacts are markdown and the scaffold is inert; delete the
directory.

## Status log

- 2026-09-02T09:14 — emitted by /devx-plan (RED gate PASS; workstream
  docs-layout-resolution, plan phase 4).
- 2026-09-02T11:18:53-06:00 — claimed by /devx in session /devx-2026-09-02T1118-43725
- 2026-09-02T11:22 — phase 2: spec ACs direct (v2 native); 10 ACs;
  workstream=docs-layout-resolution; red-artifacts=evals/E-3_no-hand-joins.ts,
  evals/E-5_scaffold.ts. Both re-run and watched failing NOW, for their stated
  reasons: E-3 named 11 live bypass sites plus the missing companion test; E-5
  named all four slug×layout combinations plus its missing companion test.
  Neither failure was harness breakage — both scans spawned and produced real
  output (the mlc101 check).
- 2026-09-02T11:50 — phase 3: ten `*Abs()` helpers re-signatured over
  `stageSubject()` on a resolved base (`ResolvedBase = {repoRoot,
  workstreamRel, layout}`); `resolveWorkstream` now returns one, so `ws`
  passes straight through at all 21 call sites. Five hand-joins closed, two
  shadowing `todoAbs` locals renamed to `todoPath`, `backfill`'s ENUMERATION
  (not its calls) moved to a new `enumerateDocSets()`, `devx next` reason
  strings and gate-summary pointers made layout-aware, and `devx workstream
  new`'s slug made optional behind a refusal that names
  `engine.docs_layout: workstream`.
- 2026-09-02T12:10:05-06:00 — merged via PR #154 (squash → 366a8f1)
- 2026-09-02T13:12 — phase 4: 3-agent parallel adversarial review (Blind
  Hunter + Edge Case Hunter + Acceptance Auditor) per
  `review.above_threshold_shape: parallel`; 710 changed lines over 16 files,
  above the substantial-surface threshold; 26 findings, ALL fixed in-place —
  the Acceptance Auditor's catch that AC 9's consumer half was pinned nowhere
  led to six new tests, and writing them exposed a missed probe in
  `commands/next.ts`; re-review clean. RECONSTRUCTED at dlr105 from PR #154's
  body, which records this review verbatim: the review ran, only this line
  was omitted, and `test/devx-status-log-discipline.test.ts` failed on `main`
  from the merge until now. The escape route that let it merge unnoticed is
  filed as `debug/debug-5284ae`.
