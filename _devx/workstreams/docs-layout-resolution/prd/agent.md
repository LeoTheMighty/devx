# PRD — Docs Layout Resolution

<!-- Stage: PRD. Gate: `devx gate prd a494be`. Every concrete item gets a
     stable ID (G-/UC-/CAP-/FR-). IDs are never renumbered. Traceability is
     by ID, not by prose. -->

## Problem

`engine.docs_layout` is a two-valued config key that claims to choose the
shape of the artifact tree. In practice it chooses almost nothing. It has
exactly **one** production consumer — `devx outline init`, at
`src/commands/outline.ts:274` — which uses it to decide where an outline
scaffold lands. Every other surface that resolves an engine artifact ignores
it completely.

Concretely: `devx gate prd|coverage|evals`, `devx next`, `devx todo sync`,
`devx revise`, `devx outcome`, and `devx status` all call
`resolveWorkstream()` and then join a hardcoded workstream-shaped constant
(`PRD_REL = "prd/agent.md"`, `DESIGN_REL`, `PLAN_REL`) onto the resulting
directory. `resolveWorkstream()` itself cannot see the layout: `EngineConfig`
(`src/lib/engine/config.ts:11-19`) does not carry `docs_layout` as a field,
even though all five of its callers already pass an `EngineConfig`. The two
project-level resolvers that were written for exactly this purpose —
`projectAgentRel()` and `projectHumanRel()` (`artifacts.ts:104,108`) — have
**zero** callers anywhere in `src/` or `test/`.

So `project-level` today is not a layout. It is a protected filename set: the
outline guard recognizes `<stage>-outline.md` as human-only, `devx outline
init` will scaffold one, and nothing else in the system will ever read or
write a project-level artifact. A repo that sets
`engine.docs_layout: project-level` gets a config value that validates
against the schema, is honored by one command, and is silently ignored by the
four gates. There is no code path by which `devx gate prd` reaches a root
`prd.md`, because `devx gate` requires a hash and `resolveWorkstream` always
demands an existing `<workstreams_root>/<slug>/` directory.

Two shipped documents assert the opposite. `docs/CONFIG.md` §15 rule 5 says
"A gate resolves its subject through the layout, so the same `devx gate prd`
runs against `prd/agent.md` or `prd.md` and returns the same verdict for the
same content." `_devx/config-schema.json:939` restates it verbatim in the
`docs_layout` description. Both are false as implemented, and both are the
first thing a reader consults before choosing a layout.

Why now: ClassyLights is a real repo that wants the flat shape — one unit of
work (`scene-engine`, hash `b7e38f`), mid-flight at the plan gate with
`prd_validated` and `design_verified` both already PASSED. Its
`engine.docs_layout` is unset, so it resolves to the `workstream` default and
carries a full folder-per-artifact tree. It cannot switch, because switching
would strand two passed gates behind resolvers that only find the folder
shape, and because nothing exists to move the tree.

## Goals

<!-- Business/project goals are numeric + dated so /devx outcome can score
     them. Baselines are measured from the repo as of 2026-09-01. -->

- **G-1**: By **2026-09-30**, every command that resolves an engine artifact
  resolves it through `engine.docs_layout`. Baseline **1 of 8** surfaces
  (`outline init` only); target **8 of 8** — the four gates, `next`,
  `todo sync`, `revise`, `outcome`. Measured by a test that asserts each
  surface produces the correct subject path under both layout values.
- **G-2**: By **2026-09-30**, there is exactly **1** function in the codebase
  that reads `engine.docs_layout`, and **0** exported artifact resolvers with
  no callers. Baseline: 2 readers (`docsLayoutFrom()` plus the private
  `docsLayoutUnset()` copy at `src/lib/next/gather.ts:1160`) and 2 orphaned
  exports (`projectAgentRel`, `projectHumanRel`).
- **G-3**: By **2026-09-30**, ClassyLights (`b7e38f`, `scene-engine`)
  completes a layout migration with **0** lost gate verdicts, **0** hand-edits
  to any artifact or frontmatter, and **0** manual `git mv` invocations — and
  `devx gate coverage b7e38f` runs to a verdict afterward on the migrated
  tree.
- **G-4**: By **2026-09-30**, **0** shipped documents claim layout resolution
  that does not exist. Baseline **2** (`docs/CONFIG.md` §15 rule 5,
  `_devx/config-schema.json:939`).

## Non-goals

- **Enforcing `project-level`'s one-doc-set rule.** Already filed and scoped
  as `dev-lay101` (`devx workstream new` refusal + a `devx doctor` finding,
  one shared predicate). This workstream consumes that predicate if it lands
  first and does not duplicate it if it does not.
- **Making the outline guard layout-aware.** `isProtectedOutlinePath()` is
  deliberately a filename matcher over `PROJECT_LEVEL_OUTLINE_BASENAMES`,
  with no config read at all (`src/lib/engine/outline.ts:107-119`). The
  human-only guarantee is layout-independent by design; a guard that had to
  load config could not stay pure, and would fail open on a malformed config.
  It stays exactly as it is.
- **A third layout.** Two shapes, both documented in the §15 table. Nothing
  here generalizes to N layouts or a user-supplied path template.
- **Changing what a gate checks.** Layout selects *where the subject lives*.
  Gate logic, verdicts, thresholds, and the `gate_status` frontmatter
  contract are untouched. A layout that changed a verdict would make layout a
  gate input, which rule 5 exists to forbid.
- **Migrating this repo (devx itself).** devx has nine live workstreams and
  is the canonical `workstream`-layout consumer. It stays on `workstream`.

## Users

- **Primary**: the solo owner running devx on a single-purpose repo
  (ClassyLights, rooted-light, oliveplay) where exactly one thing is ever
  being designed and a nine-deep `_devx/workstreams/<slug>/prd/agent.md` path
  is pure ceremony over `prd.md`.
- **Secondary**: the devx maintainer adding the next artifact kind or the
  next command that resolves one, who should get layout support by
  construction rather than by remembering to branch.
- **Anti-persona**: a team repo with several units of work in flight at once.
  `project-level` holds exactly one doc set; wanting a second is the signal to
  stay on `workstream`. This PRD makes the flat shape *work*; it never makes
  it the recommended default.

## Use cases

- **UC-1**: An owner sets `engine.docs_layout: project-level` on a fresh
  single-purpose repo, runs `devx workstream new` with no slug, and gets
  `prd.md` + `expectations.md` + `todo.md` at the repo root plus a plan spec
  whose `workstream:` field is `.`.
- **UC-2**: That owner runs `devx gate prd <hash>` and the gate resolves the
  root `prd.md` as its subject, returning the same verdict the same content
  would earn under `workstream` layout.
- **UC-3**: `devx next` routes that repo through its stage rows (author the
  PRD → run gate 1 → author the design → …) reading root artifacts, with the
  same row numbers and the same reasons as the folder shape.
- **UC-4**: The ClassyLights owner runs `devx layout migrate --to
  project-level --dry-run`, reads the exact file moves it proposes, then runs
  it for real; the tree flattens, the plan spec's `workstream:` becomes `.`,
  and both already-passed gate verdicts survive untouched.
- **UC-5**: A maintainer runs `devx todo sync`, `devx revise`, `devx outcome`
  and `devx status` against the migrated repo and every one resolves its
  artifact correctly, with no command hand-joining a path behind the
  resolver's back.
- **UC-6**: A reader consulting `docs/CONFIG.md` §15 or the config schema
  before choosing a layout gets a true description of what each shape does and
  which surfaces honor it.

## Capabilities

- **CAP-1**: One layout-aware resolver that maps `(layout, workstream dir |
  repo root, stage)` to the stage's subject path, for every artifact kind in
  the §15 table — replacing per-call-site path joining.
- **CAP-2**: Workstream resolution that honors the layout, so a hash resolves
  to the repo root under `project-level` and to `<root>/<slug>` under
  `workstream`, with the `workstream:` frontmatter field carrying `.` for the
  flat shape.
- **CAP-3**: Scaffolding that produces the shape the layout names, from a
  single entry point whose slug argument is required or optional according to
  the layout.
- **CAP-4**: A migration that moves an existing tree between layouts without
  losing gate state, and refuses rather than half-moving when the repo's state
  contradicts the target layout.
- **CAP-5**: Documentation and schema that describe the implemented behavior,
  in both of the two places that currently describe it wrongly.

## Feature requirements

### FR-1: A single stage-subject resolver

One function resolves an artifact path from the layout. It takes the layout,
a base (the workstream directory under `workstream`, the repo root under
`project-level`), and the artifact identity; it returns both the
repo-relative display form and the absolute path, because call sites need
both today (gate refusal messages print the relative form; reads use the
absolute).

It covers every row of the §15 table: the three stage subjects, their human
digests, their outline and outline-critique companions, `expectations.md`,
`todo.md`, `evals/`, `RED-report.md`, `decisions/`, `checkpoints/`, and
`RESULTS.md`. Adding an artifact kind means adding one row here, not
branching at each consumer.

The existing `projectAgentRel`/`projectHumanRel`/`projectOutlineRel`/
`projectOutlineCritiqueRel` helpers are the project-level half of this map
and are wrapped by it, not replaced — they are already correct and already
tested; what they lacked was a caller.

### FR-2: `EngineConfig` carries the layout

`docs_layout` becomes a field on `EngineConfig`, populated by
`engineConfigFrom()` with the same defensive per-key fallback every other
engine knob uses, including the legacy `personalization["docs.layout"]` read.
`docsLayoutFrom()` remains the single reader and is called from
`engineConfigFrom()`.

This is what makes FR-3 cheap: all five `resolveWorkstream` callers already
thread an `EngineConfig` through, so the layout arrives at the resolver with
no signature churn at any call site.

`src/lib/next/gather.ts:1160`'s private `docsLayoutUnset()` — a second copy of
the two-key read, used only to decide whether `devx next` nags — is deleted
and re-expressed against the shared reader. Two functions that must agree
about which config keys mean what is the drift bug this workstream exists to
remove, not one to leave behind.

### FR-3: `resolveWorkstream` honors the layout

Under `project-level`, a hash resolves to `workstreamRel: "."` /
`workstreamAbs: repoRoot`. The plan spec's `workstream:` frontmatter field
holds `.` — the field is already a repo-relative path in every existing spec
(`_devx/workstreams/scene-engine`), never a bare slug, so this extends the
existing type rather than overloading it, and `join(repoRoot, ".")` makes the
existing directory-existence check pass without a special case.

The filename-derived fallback (`planFilenameWorkstreamRel()`, which turns
`plan-b7e38f-…-scene-engine.md` into `<root>/scene-engine`) is gated on the
layout: it runs under `workstream` and yields `.` under `project-level`. A
missing `workstream:` key must not silently reconstruct a folder-shaped path
in a repo that has no folders.

`resolveSpecWorkstream()` — the from-content membership walk used by loop
scoping and the graph — gets the same treatment.

### FR-4: Scaffolding branches on the layout

`createWorkstream()` writes the shape the layout names: `prd/agent.md` +
`expectations.md` + `todo.md` + empty `decisions/`/`checkpoints/`/`evals/`
under `<root>/<slug>/` for `workstream`; the same set at the repo root for
`project-level`, using FR-1's resolver rather than the hardcoded template
list at `workstream.ts:343-364`.

`devx workstream new`'s slug argument becomes optional under `project-level`
and stays required under `workstream` (a missing slug there is an error that
names the layout as the reason). A slug supplied under `project-level` is
used for the plan spec's filename and title and names no directory.

### FR-5: Every bypass is rewired

Four call sites resolve artifact paths without the resolvers and would
survive FR-1 unfixed:

- `src/commands/todo.ts:86` — hand-joins `TODO_FILENAME` onto
  `ws.workstreamAbs` instead of calling `todoAbs()`.
- `src/lib/devx/mark-done.ts:525` — same hand-join, for the commit staging
  list.
- `src/lib/plan/validate-emit.ts:184,306` — string-concatenates
  `${wsRoot}/${slug}/${PLAN_REL}` to locate a workstream's plan, and anchors
  a regex on that spelling to match a dev spec's `from:`/`workstream:` claim.
  Under `project-level` both the path and the claim it validates change shape.
- `src/lib/graph/backfill.ts:350,363` — calls `planAbs`/`todoAbs` per slug
  while iterating the workstreams root. Under `project-level` there is no
  slug to iterate; the enumeration itself must resolve through the layout.

Each routes through FR-1's resolver. A test asserts no module outside
`artifacts.ts` constructs a stage-subject path from string parts.

### FR-6: The flat-era guards discriminate on layout

Legacy pre-migration artifacts and `project-level` artifacts are the same
filenames at the same paths. Three places currently read root
`prd.md`/`design.md`/`plan.md` as unambiguous evidence of an unmigrated
flat-era repo:

- `createWorkstream`'s refusal (`workstream.ts:318-330`), which would fire
  against `project-level`'s own current artifacts;
- `revise.ts:77-82`'s `STAGE_SHORTHAND`, which maps the literal `"prd.md"` to
  the workstream-shaped `PRD_REL`;
- the `devx doctor` flat-era migration finding.

The layout is the discriminator: under `workstream` these keep their current
legacy meaning; under `project-level` they mean the current layout and invert.
The accepted cost is recorded in `## Open questions` — a repo that never
completed the flat→folder migration and then sets `project-level` loses its
migration warning. That is a two-conditions-at-once case on a migration that
shipped at v2x101, and the alternative (a marker file, or a doctor finding for
the ambiguity) buys a narrow hole at the price of a permanent new artifact.

### FR-7: `devx layout migrate`

A dedicated, human-invoked command that moves an existing tree between
layouts:

- `--to <workstream|project-level>`; `--dry-run` prints the exact moves and
  changes nothing.
- Moves files with `git mv` so history follows, per the §15 table.
- Rewrites the plan spec's `workstream:` field to match the target shape
  (`.` or `<root>/<slug>`) and touches no other frontmatter — `stage:`,
  `gate_status:` and `gate_verdicts:` live in the spec, not the tree, so
  passed gates survive by construction.
- Refuses, before moving anything, when the repo's state contradicts the
  target: ≥2 live workstreams migrating to `project-level`; a doc set already
  present at the destination; a dirty working tree.
- Updates `engine.docs_layout` in `devx.config.yaml` as the final step, so an
  interrupted run leaves a repo whose config still describes its tree.

It can move `outline.md` files. The PreToolUse guard denies *agent* writes to
outline paths; the CLI is not an agent, and a migration that moved every
artifact except the human's outlines would leave the tree broken in the one
place the human cares most about. `devx outline check` and the merge gate see
a rename, not new human content.

### FR-8: The two false claims are corrected

`docs/CONFIG.md` §15 rule 5 and `_devx/config-schema.json:939` are rewritten
to describe what ships. The §15 artifact table gains its two missing rows —
`checkpoints/` and `RESULTS.md`, which the table is silent on today — landing
at the repo root under `project-level`, consistent with `decisions/` and
`evals/` which it already places there. §15 gains the `devx layout migrate`
invocation as the answer to "what does switching cost", which the section
currently raises and does not answer.

## Evals seed

- A gate resolves the correct subject under each layout, and returns the
  identical verdict for identical content across the two — the direct test of
  rule 5, which is currently a false claim.
- Exactly one function in the codebase reads `engine.docs_layout`; no other
  module reconstructs the two-key read.
- No module outside `artifacts.ts` builds a stage-subject path from string
  parts (catches the FR-5 class structurally rather than site by site).
- `resolveWorkstream` returns the repo root under `project-level`, including
  when `workstream:` is absent and the filename fallback would otherwise
  produce a folder path.
- `devx workstream new` with no slug produces a complete root doc set under
  `project-level` and a slug-required error under `workstream`.
- A real migration of a mid-flight workstream preserves every gate verdict and
  leaves a repo whose next gate command runs to a verdict.
- `devx layout migrate` refuses, without moving a file, on each of its three
  refusal conditions.
- Both previously-false doc surfaces describe the implemented behavior.

## Open questions

- **Accepted, not open — recorded so it is not rediscovered as a bug.** Under
  FR-6, a repo that never completed the flat→folder migration and then sets
  `engine.docs_layout: project-level` loses its flat-era migration warning:
  its unmigrated artifacts become indistinguishable from a legitimate
  project-level doc set. Owner decision 2026-09-01, taking the discriminator
  without the extra doctor finding. Revisit only if such a repo appears.
- **Does `dev-lay101` land first?** If it does, FR-4's refusal consumes its
  shared one-doc-set predicate rather than defining a second. If it does not,
  FR-4 ships without a one-doc-set check and `lay101` adds it. Either order
  works; the two must not both define the predicate. — owner: sequencing at
  the Plan stage.
- **Does `project-level` want `evals/` and `decisions/` at the root, or under
  a single `_devx/` directory?** The §15 table already commits to the repo
  root and this PRD follows it. It is worth one look at a real migrated
  ClassyLights before the Design stage closes, since it adds four root
  entries on top of the eight backlog files. — owner: user, at Design.

## Reference links

- Spec: `plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md`
- `docs/CONFIG.md` §15 — the two shapes, the artifact table, the five rules
- `_devx/config-schema.json:939` — the `docs_layout` schema entry
- `docs/PERSONALIZATION.md` §3, §4.1 — why the layout is config, not a
  preference bank key
- `src/lib/engine/artifacts.ts` — `docsLayoutFrom()`, the `*_REL` constants,
  the orphaned `project*Rel` helpers
- `src/lib/engine/workstream.ts:446` — `resolveWorkstream()`; `:221` —
  `createWorkstream()`; `:106` — `planFilenameWorkstreamRel()`
- `src/lib/engine/config.ts:11` — `EngineConfig`, which does not carry the
  layout today
- `src/commands/outline.ts:274` — the only production call site of
  `docsLayoutFrom()`
- `dev/dev-lay101-2026-09-01T12:40-project-level-single-docset-guard.md` —
  the adjacent one-doc-set enforcement, explicitly out of scope here
- ClassyLights `b7e38f` / `scene-engine` — the migration case: `stage: plan`,
  `prd_validated: true`, `design_verified: true`, `engine.docs_layout` unset
