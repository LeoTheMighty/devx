# Expectations — Docs Layout Resolution

<!-- Gate 1 input. Minimum 3 E-blocks (config: engine.expectations_min).
     Every business goal (G-) must be covered by at least one expectation;
     every Covers: ID must resolve in prd/agent.md. EARS regex enforced by
     `devx gate prd`: "When .+, the system SHALL .+". A P0 with a vague
     Verified-by target fails the gate. -->

## E-1: A gate resolves its subject through the layout

- **Priority:** P0
- **Covers:** `G-1, G-4, UC-2, CAP-1, FR-1`
- **Trigger:** `devx gate prd <hash>` on a repo whose `engine.docs_layout` is
  `project-level`, with the PRD at the repo root as `prd.md`.
- **Expectation (EARS):** When a gate command runs on a repo configured for
  `project-level`, the system SHALL resolve the gate's subject to the
  repo-root artifact rather than the folder-per-artifact path, and SHALL
  return the identical verdict that the identical content returns under
  `workstream` layout.
- **Threshold:** All four gates (`prd`, `coverage` in both design and plan
  modes, `evals`) pass this in both layouts — 8 layout×gate combinations, 0
  verdict differences for byte-identical subject content.
- **Verified by:** `test/engine-layout-gate-subjects.test.ts`

## E-2: Exactly one function reads the layout key

- **Priority:** P0
- **Covers:** `G-2, CAP-1, FR-2`
- **Trigger:** A static scan of `src/` for reads of `engine.docs_layout` and
  of the legacy `personalization["docs.layout"]` fallback key.
- **Expectation (EARS):** When the codebase is scanned for layout-key reads,
  the system SHALL contain exactly one function that reads either key, and
  SHALL contain no exported artifact resolver in `artifacts.ts` without a
  production caller.
- **Threshold:** 1 reader (down from 2 — `docsLayoutFrom()` plus
  `gather.ts:1160`'s `docsLayoutUnset()`); 0 orphaned exports (down from 2 —
  `projectAgentRel`, `projectHumanRel`).
- **Verified by:** `test/engine-layout-single-reader.test.ts`

## E-3: No consumer builds a stage-subject path from string parts

- **Priority:** P0
- **Covers:** `G-1, G-2, CAP-1, FR-1, FR-5`
- **Trigger:** A static scan of every module outside `src/lib/engine/artifacts.ts`
  for hand-constructed artifact paths — `join(...)`/template-literal
  concatenation producing `prd/agent.md`, `design/agent.md`, `plan/agent.md`,
  `todo.md`, `expectations.md`, `RED-report.md`, or their project-level
  spellings.
- **Expectation (EARS):** When a module outside the resolver constructs a
  stage-subject path from string parts, the system SHALL fail the test suite
  naming that file and line.
- **Threshold:** 0 offending sites, down from a baseline of 4 known bypasses
  (`commands/todo.ts:86`, `lib/devx/mark-done.ts:525`,
  `lib/plan/validate-emit.ts:184`, `lib/graph/backfill.ts:350`).
- **Verified by:** `test/engine-layout-no-hand-joins.test.ts`

## E-4: Workstream resolution reaches the repo root under project-level

- **Priority:** P0
- **Covers:** `G-1, UC-1, CAP-2, FR-3`
- **Trigger:** `resolveWorkstream(repoRoot, hash, engine)` under
  `project-level`, across three frontmatter states: `workstream: .`,
  `workstream:` absent, and a stale `workstream: _devx/workstreams/<slug>`
  left by a partial migration.
- **Expectation (EARS):** When a hash is resolved under `project-level`, the
  system SHALL return the repo root as the workstream directory, including
  when the `workstream:` key is absent — and SHALL NOT fall back to the
  filename-derived folder path that `planFilenameWorkstreamRel()` produces
  under `workstream` layout.
- **Threshold:** All 3 frontmatter states resolve to the repo root; the
  absent-key case produces `.` and never a `<root>/<slug>` string.
- **Verified by:** `test/engine-layout-resolve-workstream.test.ts`

## E-5: Scaffolding produces the shape the layout names

- **Priority:** P0
- **Covers:** `G-1, UC-1, CAP-3, FR-4`
- **Trigger:** `devx workstream new` invoked with and without a slug, under
  each of the two layouts.
- **Expectation (EARS):** When `devx workstream new` runs without a slug under
  `project-level`, the system SHALL create a complete doc set at the repo root
  and a plan spec whose `workstream:` field is `.`; and when it runs without a
  slug under `workstream`, the system SHALL exit non-zero with an error naming
  the layout as the reason the slug is required.
- **Threshold:** Root doc set is complete — `prd.md`, `expectations.md`,
  `todo.md`, and empty `decisions/`, `checkpoints/`, `evals/`: 6 of 6 present.
  The slug-required error exits 1 and its text contains
  `engine.docs_layout: workstream`.
- **Verified by:** `test/engine-layout-scaffold.test.ts`

## E-6: A mid-flight migration preserves every gate verdict

- **Priority:** P0
- **Covers:** `G-3, UC-4, CAP-4, FR-7`
- **Trigger:** `devx layout migrate --to project-level` on a fixture
  reproducing ClassyLights `b7e38f`: one workstream, `stage: plan`,
  `prd_validated: true`, `design_verified: true`, `gate_verdicts: {prd: PASS,
  design: PASS}`, with `prd/agent.md`, `prd/human.md`, `design/agent.md`,
  `design/human.md`, `expectations.md`, `todo.md` and two `decisions/` files
  on disk.
- **Expectation (EARS):** When a mid-flight workstream is migrated between
  layouts, the system SHALL move every artifact to its counterpart path with
  `git mv`, SHALL rewrite only the `workstream:` frontmatter field, and SHALL
  leave `stage:`, `gate_status:` and `gate_verdicts:` byte-identical.
- **Threshold:** 8 of 8 files land at their §15-table counterpart paths with
  git rename detection intact; `gate_status` and `gate_verdicts` diff empty;
  `devx gate coverage <hash>` subsequently runs to a verdict on the migrated
  tree.
- **Verified by:** `test/engine-layout-migrate.test.ts`

## E-7: The migration refuses rather than half-moving

- **Priority:** P0
- **Covers:** `G-3, CAP-4, FR-7`
- **Trigger:** `devx layout migrate --to project-level` under each refusal
  condition: ≥2 live workstreams; a doc set already present at the
  destination; a dirty working tree.
- **Expectation (EARS):** When the repo's state contradicts the target layout,
  the system SHALL refuse before moving any file, naming what it found and the
  way forward, and SHALL leave the working tree byte-identical.
- **Threshold:** 3 of 3 refusal conditions exit non-zero with 0 files moved
  (`git status` identical before and after); `--dry-run` moves 0 files in the
  success case too.
- **Verified by:** `test/engine-layout-migrate-refusals.test.ts`

## E-8: The shipped docs describe the implemented behavior

- **Priority:** P1
- **Covers:** `G-4, UC-6, CAP-5, FR-8`
- **Trigger:** A scan of `docs/CONFIG.md` §15 and the `docs_layout` entry in
  `_devx/config-schema.json` against the resolver's actual behavior.
- **Expectation (EARS):** When the layout documentation is scanned, the system
  SHALL find no claim of layout-aware resolution that no code implements, and
  SHALL find a §15 artifact table row for every artifact kind the resolver
  handles.
- **Threshold:** 0 false claims (down from 2); the §15 table covers 13 of 13
  artifact kinds, including the `checkpoints/` and `RESULTS.md` rows it lacks
  today.
- **Verified by:** `test/engine-layout-docs-truth.test.ts`
