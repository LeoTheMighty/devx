# Design — Docs Layout Resolution

<!-- Stage: Design. Gate: `devx gate coverage a494be` (design mode — one
     tri-state row per G-/UC-/CAP-/FR- ID in prd/agent.md). Hard rule: don't plan
     here. No phases, no tasks — design is the approach, not the sequence. -->

## Overview

- **Objective**: make `engine.docs_layout` mean what `docs/CONFIG.md` §15
  already claims it means — every command that resolves an engine artifact
  resolves it through the layout, a mid-flight tree can move between the two
  shapes without losing gate state, and the two shipped documents that
  describe layout resolution stop describing a thing that does not exist.

- **Solution**: the layout becomes a *field on `EngineConfig`* and a *single
  artifact map* in `artifacts.ts`. Those two moves do almost all the work,
  because the seven `resolveWorkstream` call sites and the five
  `resolveSpecWorkstream` call sites already thread a whole `EngineConfig`
  object — the layout arrives at the resolver with zero signature churn at any
  consumer. What remains is: one function (`stageSubject()`) that owns every
  `(layout, base, kind) → path` decision; a layout branch in workstream
  resolution and scaffolding; a new human-invoked `devx layout migrate` built
  as a pure `MovePlan` that is either rendered or executed; and a discriminator
  on three flat-era guards that currently read a root `prd.md` as unambiguous
  evidence of an unmigrated repo. The bypass class (`FR-5`) is closed
  primarily by making a hand-joined path *unrepresentable* rather than by
  asking a test to notice one.

## Constraints

- **The layout is never a gate input.** `docs/CONFIG.md` §15 rule 5 is the
  contract: the same `devx gate prd` on the same content returns the same
  verdict under either shape. Layout selects *where the subject lives* and
  nothing else. This is why `docsLayoutFrom()` reads defensively and falls back
  to the shipped default rather than throwing — a malformed layout value must
  not brick a gate.
- **`WorkstreamRefusal` is caught by exactly one call site.** `outline.ts:358`
  is the only consumer that distinguishes it; every other site maps it through
  the generic `WorkstreamError` arm to exit 2. A new refusal added inside the
  resolver silently becomes exit 2 everywhere. New refusals must therefore live
  in their own command, not inside `resolveWorkstream`.
- **`engine.workstreams_root` is config, not a bank key**, and stays so
  (`docs/PERSONALIZATION.md` §2). The layout is the same class of value for the
  same reason: two contributors resolving it differently would split the
  artifact tree in half.
- **Outline files are human-only in both layouts.** `isProtectedOutlinePath()`
  (`src/lib/engine/outline.ts:126-159`) is a pure filename matcher with no
  config read, and stays one. It already protects both spellings
  unconditionally.
- **devx itself stays on `workstream`.** Nine live workstreams; it is the
  canonical folder-layout consumer and the regression surface for every change
  here.
- **Leaf-only config writes.** `setLeaf()` (`src/lib/config-io.ts:164-214`)
  refuses anything but a scalar leaf. `engine.docs_layout` is a scalar, so the
  migration's config write stays inside the existing restriction.

## Risks

- **A migration half-moves and leaves an unresolvable repo** → refusals are
  computed as a pure predicate over repo state *before* any `git mv` runs, and
  the clean-tree precondition makes the whole move set revertible with one
  `git checkout -- .` → proven by **E-7** (3 refusal conditions, 0 files moved,
  `git status` byte-identical) and **E-6** (8/8 files land at their §15
  counterparts).

- **The layout branch silently changes a verdict**, turning layout into a gate
  input and breaking §15 rule 5 → the gate's *subject resolution* is the only
  thing that branches; gate bodies receive an already-resolved path and cannot
  see the layout → proven by **E-1** (8 layout×gate combinations, 0 verdict
  differences for byte-identical content).

- **A new consumer hand-joins a path and re-opens the bypass class a year from
  now** → the primary defense is representational (resolver functions are the
  only exported way to reach an artifact path); the scan is the residue →
  proven by **E-3** (0 offending sites).

- **Two layout readers drift apart** — the exact bug this workstream exists to
  remove, currently live as `docsLayoutFrom()` vs `gather.ts:1160`'s
  `docsLayoutUnset()` → collapse to one reader, and delete the second rather
  than fixing it → proven by **E-2** (1 reader, 0 orphaned resolvers).

- **`project-level` scaffolding refuses its own primary use case.** Live today:
  `createWorkstream`'s no-hash adoption path throws when the workstream dir
  exists and no spec claims it (`workstream.ts:274-279`); under `project-level`
  that dir *is* the repo root, which always exists, so UC-1 throws on every
  invocation → the existence probe becomes a *doc-set* probe, not a *directory*
  probe → proven by **E-5** (6/6 root artifacts present, slug-required error
  under the other layout).

- **A partial migration leaves config and tree disagreeing** and the next
  command resolves against the wrong shape → the disagreement is made
  *detectable* rather than assumed away: config is written last, so an
  interrupted run leaves the config describing the pre-migration shape, and a
  `devx doctor` finding reports layout/tree mismatch → proven by **E-6** (the
  post-migration `devx gate coverage` runs to a verdict) and **E-7**.

- **Docs re-drift from the implementation** after this workstream closes →
  the doc claims become test-asserted rather than prose-reviewed → proven by
  **E-8** (0 false claims; 13/13 artifact-kind rows).

## Trade-offs

- **Chose one `stageSubject()` map over per-kind resolver pairs** (a
  `projectPrdAbs()` beside every `prdAbs()`). The pair-per-kind shape doubles
  the surface at every addition and puts the layout decision at the *call site*,
  which is precisely the defect being removed. Cost: one function with a
  `switch`, which is less discoverable by autocomplete than `prdAbs`.

- **Chose `workstream: .` over a null/absent sentinel** for the flat shape. The
  field is already a repo-relative path in every existing spec, never a bare
  slug, so `.` extends the existing type instead of overloading it — and
  `join(repoRoot, ".")` makes the existing directory-existence check pass with
  no special case. Cost: `.` is a slightly odd thing to read in frontmatter.

- **Chose a signature change on `planFilenameWorkstreamRel()`** (take the whole
  `EngineConfig`, not a bare `workstreamsRoot: string`) over gating its four
  call sites individually. A layout-blind helper that four sites must *remember*
  to guard is the same class of bug as the four hand-joins. Cost: four
  mechanical call-site edits.

- **Chose compiler enforcement over a scan.** The two apparent blockers to
  making the `*_REL` constants module-private both dissolved on inspection: the
  display sites (`gate.ts:492,508`) should be printing `subject.rel` anyway
  (keeping the constants for them means keeping them in order to print a path
  the repo does not contain), and `CASCADE_TABLE` re-keys on `ArtifactKind`.
  Cost: re-keying the cascade table is a wider edit than a shorthand swap, and
  it is the edit that keeps `devx revise` working under the flat layout. The
  scan survives only for literal basenames in template paths and message text,
  documented as accepted-fragile rather than pretended to be sound.

- **Chose to fix `detect.ts`'s hardcoded `_devx/workstreams`** while
  discriminating it on layout, rather than leaving a known root-ignoring bug in
  a function this workstream is already editing. Cost: slightly wider blast
  radius than FR-6 strictly names.

- **Chose to move outline files in the migration.** A migration that moved
  every artifact except the human's outlines would leave the tree broken in the
  one place the human cares most about. The PreToolUse guard denies *agent*
  writes; the CLI is not an agent, and `devx outline check` sees a rename, not
  new human content.

## Out of scope

- **Enforcing `project-level`'s one-doc-set rule.** Owned by `dev-lay101`,
  which defines the shared predicate over the 0/1/≥2 doc-set × layout matrix.
  This design *consumes* that predicate at two sites (scaffolding refusal,
  migration refusal) and does not define a second copy. If `lay101` has not
  landed, those two sites carry a local predicate with the same signature, to be
  deleted on adoption — never a second permanent definition.
- **Making the outline guard layout-aware.** It already protects both spellings
  unconditionally and must stay a pure filename matcher.
- **A third layout**, or a user-supplied path template.
- **Changing what any gate checks** — bodies, verdicts, thresholds, and the
  `gate_status` frontmatter contract are untouched.
- **Migrating devx itself.**
- **`devx init`'s layout question.** Already shipped; it writes the key this
  design finally makes meaningful.

## Assumptions

- **ClassyLights `b7e38f` is the only real migration subject**, and it has
  exactly one workstream. If a second appears before this ships, the ≥2-live
  refusal fires and the migration is a no-op — correct behavior, but it would
  mean G-3 needs a different subject.
- **`git mv` is available and the repo is a real git checkout.** The migration
  is the first code in the repo to shell out to `git mv`; a non-git directory
  is a refusal, not a fallback to `fs.rename`.
- **No repo in the wild carries `personalization["docs.layout"]` as its only
  layout answer.** The legacy read stays, but nothing new is built on it.
- **The `evals` stage keeps its directory shape under both layouts.**
  `projectAgentRel("evals")` returns the directory `evals`, not `evals.md`.
  This asymmetry is deliberate and load-bearing, not a bug to normalize.

## Discarded considerations

- **Making `docs_layout` a preference-bank key.** Rejected in the PRD and
  restated here because it is the first thing a reader proposes: it names a path
  the whole repo shares. Two engineers resolving it differently split the
  artifact tree.
- **A marker file (`.devx-layout`) to disambiguate flat-era from
  `project-level`.** Buys a narrow correctness hole — a repo that never finished
  the 2026-08 flat→folder migration and *then* sets `project-level` — at the
  price of a permanent new artifact in every repo. Owner decision 2026-09-01:
  take the discriminator, accept the hole, record it.
- **Writing `engine.docs_layout` before moving files**, so the config never
  describes a tree that does not exist. Rejected: the config edit itself dirties
  the working tree, which destroys the single-`git checkout` recovery that the
  clean-tree precondition buys. See "Migration plan" — the PRD's stated
  rationale for this ordering is corrected there.
- **Normalizing `evals` to `evals.md` under `project-level`** for a uniform
  map. Rejected: evals is a directory of runnable artifacts in both layouts;
  flattening it to a file would make the RED gate's subject a thing that cannot
  hold eval scripts.
- **A `devx layout migrate --force` to bypass refusals.** Every refusal here
  names a state where moving files loses information. A force flag converts a
  refusal into a data-loss path with a shrug.

## Wrap, don't duplicate

- **Reuses:**
  - `src/lib/engine/artifacts.ts` — `projectAgentRel`, `projectHumanRel`,
    `projectOutlineRel`, `projectOutlineCritiqueRel` (`:104-118`) are already
    correct and already the project-level half of the map; they lacked a caller,
    not a fix. `stageFileRel`, `outlineRel`, `humanRel`, `outlineCritiqueRel`
    (`:71-83`) are the workstream half, equally unwired.
  - `docsLayoutFrom()` (`artifacts.ts:168`) — stays the single reader; gains a
    caller rather than a rewrite.
  - `setLeaf()` (`src/lib/config-io.ts:164-214`) — comment-preserving YAML
    scalar mutation + `atomicWrite`. The migration's config step is a call, not
    a new writer.
  - The synchronous `Exec` seam (`src/lib/exec.ts:19-31`) injected via an `Io`
    struct, exactly as `devx outline commit` does its staged git writes
    (`src/commands/outline.ts:477-491`).
  - The porcelain-parsing dirty-tree check from `outline.ts:435-464`, including
    its two hard-won details: `-uall` (plain `--porcelain` collapses untracked
    dirs to `?? dir/`, hiding nested artifacts) and `core.quotePath=false` +
    `dequoteGitPath` for non-ASCII paths.
  - The live-workstream predicate `state.stage !== "done" && state.stage !==
    "retired"` over a `plan/` walk (`src/commands/status.ts:122`) — the plan
    spec's `stage:`, never the directory listing, is the source of truth for
    "live".
  - `dev-lay101`'s one-doc-set predicate, when it lands.
  - The `Finding` / `fixable: false` doctor contract
    (`src/lib/doctor/types.ts:30-97`).

- **Adds:**
  - `ArtifactKind` (the union that does not exist today) and `stageSubject()` —
    the one layout-aware resolver.
  - `EngineConfig.docsLayout`.
  - `devx layout migrate` — the first `git mv` in the repo, and the first
    command that mutates `devx.config.yaml` outside `devx config set` / init.
  - A `layout-tree-mismatch` doctor finding.

## Design

### The artifact map

One union and one function replace every per-call-site path join. The union is
genuinely new: the agent confirmed there is no artifact-kind type in the
codebase today — the four basenames (`AGENT_BASENAME`, `HUMAN_BASENAME`,
`OUTLINE_BASENAME`, `OUTLINE_CRITIQUE_BASENAME`) are loose string constants with
nothing binding them, which is why `stageFileRel(stage, basename: string)` takes
an untyped second parameter.

```ts
/** The three stages whose subject is an authored document. `evals` is
 *  deliberately absent: its subject IS the evals directory, so
 *  `{ kind: "evals-dir" }` names it and `{ kind: "agent", stage: "evals" }`
 *  is made UNREPRESENTABLE rather than special-cased in a branch. */
export type SubjectStage = "prd" | "design" | "plan";

export type ArtifactKind =
  | { kind: "agent"; stage: SubjectStage }
  | { kind: "human" | "outline" | "outline-critique"; stage: StageDir }
  | { kind: "expectations" | "todo" | "results" }
  | { kind: "evals-dir" | "decisions-dir" | "checkpoints-dir" }
  | { kind: "red-report" };

export interface StageSubject {
  /** Repo-relative display form — what refusal messages print. */
  rel: string;
  /** Absolute path — what reads use. */
  abs: string;
}

export function stageSubject(
  layout: DocsLayout,
  base: { repoRoot: string; workstreamRel: string },
  kind: ArtifactKind,
): StageSubject;
```

Both forms are returned because both are needed at the same call sites today —
gate refusals print the relative form (`gate.ts:492,508`) while reads use the
absolute. Returning one and making callers derive the other is how the two
spellings drift.

**11 union variants render as the §15 table's 13 rows**, and the arithmetic is
worth stating because E-8's threshold counts rows, not variants: `agent`
expands to three rows (prd / design / plan), the three stage-parametrized
companions are one row each, and the seven singletons are one row each —
3 + 3 + 7 = 13. Two of those thirteen (`checkpoints/`, `RESULTS.md`) are the
rows §15 lacks today and FR-8 adds. Every row is spelled out:

| Kind | `workstream` | `project-level` |
|---|---|---|
| agent · prd | `<ws>/prd/agent.md` | `prd.md` |
| agent · design | `<ws>/design/agent.md` | `design.md` |
| agent · plan | `<ws>/plan/agent.md` | `plan.md` |
| human · `<stage>` | `<ws>/<stage>/human.md` | `<stage>-human.md` |
| outline · `<stage>` | `<ws>/<stage>/outline.md` | `<stage>-outline.md` |
| outline-critique · `<stage>` | `<ws>/<stage>/outline-critique.md` | `<stage>-outline-critique.md` |
| expectations | `<ws>/expectations.md` | `expectations.md` |
| todo | `<ws>/todo.md` | `todo.md` |
| results | `<ws>/RESULTS.md` | `RESULTS.md` |
| evals-dir | `<ws>/evals` | `evals` |
| decisions-dir | `<ws>/decisions` | `decisions` |
| checkpoints-dir | `<ws>/checkpoints` | `checkpoints` |
| red-report | `<ws>/evals/RED-report.md` | `evals/RED-report.md` |

The **`evals` asymmetry** is the sharp edge, and the union above disarms it by
construction rather than by a branch. `projectAgentRel("evals")` returns the
*directory* `evals` while `projectHumanRel("evals")` returns the *file*
`evals-human.md` — so the evals stage has a directory for its subject and
hyphen-prefixed root files for its companions. Narrowing `agent` to
`SubjectStage` makes "the evals stage's agent document" unrepresentable; the
directory is reached as `{ kind: "evals-dir" }`, which is what it actually is.
The stage-parametrized companions keep the full `StageDir`, so
`{ kind: "outline", stage: "evals" }` correctly yields `evals-outline.md`
(already an entry in `PROJECT_LEVEL_OUTLINE_BASENAMES`, derived from
`STAGE_DIRS` at `artifacts.ts:118-124` — existing behavior, not a new
obligation). Nothing exercises any of this today, so the map must be tested at
`evals` specifically, not just at `prd`.

Under `project-level`, `base.workstreamRel` is `"."` and every `rel` is a plain
root filename; `abs` is `join(repoRoot, rel)`.

**Closing the bypass class structurally.** `stageSubject()` becomes the only
*exported* way to obtain an artifact path, and the stage-shaped `*_REL`
constants that exist purely to be joined (`PRD_REL`, `DESIGN_REL`, `PLAN_REL`,
`EXPECTATIONS_REL`, `TODO_REL`, `RED_REPORT_REL`) become module-private.

**The blast radius is large and must be stated honestly**, because an earlier
draft of this design claimed two consumers blocked privatization and both
dissolved. That was wrong by roughly an order of magnitude. The real consumer
set is ~15 modules and 40+ sites:

| Consumer class | Sites | What it needs |
|---|---|---|
| Gate finding `location:` fields | `gate-prd.ts` (~10, e.g. `` `${PRD_REL}:${line}` ``) | layout threaded into functions that receive neither layout nor subject today |
| Refusal / subject strings | `gate-coverage.ts:104,112,350,351`; `gate.ts:206,207,323,360,492,508,548,624,647` | `subject.rel` |
| Row reasons | `engine/next.ts:115-155` (6) | `subject.rel` |
| Outcome messages | `engine/outcome.ts:310,317,323,331,431` | `subject.rel` |
| Misc | `plan-helper.ts:464`, `workstream.ts:99`, `render.ts:119,124` | `subject.rel` |
| **Re-export** | `todo-truth.ts:37` — `export const TODO_FILENAME = TODO_REL` | breaks `mark-done.ts:51` and `todo.ts:34` at **compile time** if `TODO_REL` goes private |
| `CASCADE_TABLE` keys | `revise.ts:37-64` + `cascadeFor()` `:92-104` | re-key on `ArtifactKind` |

Three consequences follow, and none of them is a reason to abandon the
direction:

- **The gate `location:` fields are part of the gate's output contract**, not
  decoration. Threading layout into those functions is the single largest
  mechanical cost in this workstream and should be sized as such at the Plan
  stage. It does not touch verdicts, so E-1 is unaffected.
- **`KNOWN_ARTIFACTS`** (`revise.ts:67`) is `CASCADE_TABLE.map(e => e.artifact)`,
  exported, and joined into user-facing text at `commands/revise.ts:85,153`.
  Re-keying the table on `ArtifactKind` renders it `[object Object]`. The table
  therefore keeps a `display` projection alongside its identity key, and
  `KNOWN_ARTIFACTS` is derived from that projection through `stageSubject()`.
- **`cascadeFor()` matches on more than the shorthand.** It also tests
  `e.artifact === last1 || e.artifact === last2` — raw path spellings from the
  `--touched` argument. After the re-key those comparisons need a
  path → `ArtifactKind` reverse lookup, which the map owns (it is the same
  table read backwards) and which must accept **both** layouts' spellings so a
  `--touched design.md` typed against a folder-layout repo still resolves.

The moves that are *not* negotiable are the display ones: a refusal that names
`<ws>/expectations.md` in a repo whose file is `expectations.md` is a message
that lies. Keeping the constants exported for those sites means keeping them in
order to go on lying.

**The nine `*Abs()` helpers are a second blast radius, and the honest number is
larger than the first.** `prdAbs(wsAbs)` and its eight siblings take a
workstream directory and join a constant — they are layout-blind by
construction, and `stageSubject()` cannot be fed by that signature. Counted:
`prdAbs` 10 · `planAbs` 8 · `todoAbs` 7 · `expectationsAbs` 6 ·
`decisionsDirAbs` 5 · `designAbs` 4 · `redReportAbs` 4 · `resultsAbs` 4 ·
`evalsDirAbs` 3 ≈ **51 call sites**.

Deleting them in favor of bare `stageSubject()` calls would be a worse API — the
ergonomic name is why they get used. So they **survive as layout-aware wrappers**
over the map, with one signature change: they take the resolved base
(`{ repoRoot, workstreamRel, layout }`, i.e. what `resolveWorkstream` already
returns plus the layout it now carries) instead of a bare `wsAbs`. Every call
site already has that object in hand, so the change is mechanical — but it is 51
sites, and Plan-stage sizing must carry it rather than discover it.

This also **dissolves an inconsistency** an earlier draft carried. It called
`backfill.ts:350,363`'s `planAbs`/`todoAbs` "correct" while calling
`next.ts:292-295`'s structurally identical `prdAbs(wsAbs)` probes "broken."
Under `project-level`, `planAbs(repoRoot)` is exactly as wrong as
`prdAbs(repoRoot)`. Neither is a bypass; both are correct calls into a
layout-blind helper, and both are fixed by the same signature change. What is
genuinely distinct about `backfill.ts` is only its *enumeration* — the readdir
that yields nothing when the workstreams root does not exist.

With the set moved, the exported surface is resolver functions plus the
`ArtifactKind` union, and a hand-joined stage-subject path stops being
expressible rather than being caught after the fact. The residual scan (E-3)
covers what remains — literal artifact basenames in shipped-template paths and
in message text that is genuinely layout-independent — following the house
precedent at `test/outline-isolation.test.ts`, which allowlists by regex. That
residue is enumerable and documented as accepted-fragile; the primary defense is
the compiler.

### Threading the layout through `EngineConfig`

`docs_layout` becomes a fifth field on `EngineConfig`
(`src/lib/engine/config.ts:11-19`), populated in `engineConfigFrom()` by
delegating to `docsLayoutFrom()` — not by a second inline read.

There is one ordering subtlety that will bite a naive implementation.
`engineConfigFrom()` opens with two early-return guards: a non-object `merged`,
then a non-object `merged.engine` — both `return out` with all defaults. But
`docsLayoutFrom()` reads *two* sections: `engine.docs_layout` **and** the legacy
`personalization["docs.layout"]`. A repo that answered only the legacy key has
no `engine:` block at all, so the second guard fires and the layout is lost.

The assignment therefore happens **before both guards**:

```ts
export function engineConfigFrom(merged: unknown): EngineConfig {
  const out: EngineConfig = { ...ENGINE_DEFAULTS };
  // Before the guards: the legacy bank spelling lives under
  // `personalization:`, so a repo with no `engine:` block at all can still
  // have answered the layout.
  out.docsLayout = docsLayoutFrom(merged);
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) return out;
  const engine = (merged as Record<string, unknown>).engine;
  if (!engine || typeof engine !== "object" || Array.isArray(engine)) return out;
  // … the existing per-knob `if` ladder, unchanged
}
```

`docsLayoutFrom()` is already defensive on both reads, so passing it a malformed
blob yields the default rather than throwing — which is what makes it safe above
the guards.

`gather.ts:1160`'s private `docsLayoutUnset()` is **deleted**, not fixed. It
exists to decide whether `devx next` nags about an unset layout, and it
duplicates the two-key read by hand.

Deleting it is not by itself enough to hit G-2's "exactly 1 function reads
`engine.docs_layout`". Re-expressing its one caller against a *second exported
predicate* beside `docsLayoutFrom()` would leave the count at two — a different
pair of functions performing the same two-key read, which is the same drift bug
wearing a new name. The metric is one **function**, not one **file**.

So the read is performed exactly once, and both questions are answered from its
single result:

```ts
export type LayoutSource = "engine" | "legacy" | "default";

/** The ONE function that reads either layout key. Returns what was found and
 *  where, so callers needing "is it unset?" ask about the source rather than
 *  re-reading the config. */
export function resolveDocsLayout(
  merged: unknown,
): { layout: DocsLayout; source: LayoutSource };

/** Thin wrapper, kept for its existing callers. Reads nothing itself. */
export const docsLayoutFrom = (merged: unknown): DocsLayout =>
  resolveDocsLayout(merged).layout;
```

`devx next`'s nag becomes `source === "default"`. `EngineConfig` carries both
the layout and its source, so nothing downstream needs the raw blob again.

The duplicate `export type DocsLayout = "workstream" | "project-level"` at
`src/lib/init-questions.ts:58` — hand-written, not derived from `DOCS_LAYOUTS` —
is replaced by an import. G-2 counts *function* readers; this is a parallel
*type* that can drift the same way and is cheap to remove while we are here.

### Layout-aware workstream resolution

`resolveWorkstream()` (`workstream.ts:440-497`) gains one branch. Under
`project-level` it returns `workstreamRel: "."` / `workstreamAbs: repoRoot`; the
existing `fs.exists(workstreamAbs)` check passes with no special case because
`join(repoRoot, ".")` is the repo root.

The filename-derived fallback is the part that must not run. Today, a spec with
no `workstream:` key falls through to
`planFilenameWorkstreamRel(basename(specAbs), engine.workstreamsRoot)`, which
turns `plan-b7e38f-…-scene-engine.md` into `_devx/workstreams/scene-engine` — a
folder path in a repo that has no folders. Rather than guarding the call at each
of its four sites (`workstream.ts:471`, `workstream.ts:678`, `status.ts:117`,
`gather.ts:858`), the helper's signature changes to take the whole
`EngineConfig` and returns `"."` under `project-level`. Every call site already
passes `engine.workstreamsRoot` from an `EngineConfig` in scope, so this is four
mechanical edits and the layout becomes impossible to forget.

`resolveSpecWorkstream()` gets the same treatment, with one honest consequence
worth recording: its membership regex is
`(?:^|/)<workstreamsRoot>/([a-z0-9-]+)(?:/|$)`, and under `project-level` no
path can ever match it. The `path-in-from-or-plan` arm is therefore **dead**
under the flat layout, and membership degrades to the `workstream-frontmatter`
and `plan-hash` arms. This is not a defect: under `project-level` there is
exactly one workstream, so any spec carrying an engine `stage:` belongs to it.
The arm is skipped, not repaired.

The seven `resolveWorkstream` call sites and five `resolveSpecWorkstream` call
sites need **no signature churn** — every one threads `ctx.engine` from
`loadEngineContext` as a whole object, so the layout arrives without a new
parameter anywhere. That is the property that makes this design cheap, and it is
the reason to prefer a config field over a threaded argument.

Stated precisely, because the loose version is misleading: *signatures* are
untouched, but two of the seven need **body** edits for reasons unrelated to the
resolver — `todo.ts:86` hand-joins `TODO_FILENAME` immediately after its
`resolveWorkstream` call, and `revise.ts` carries the shorthand map. Both are
covered under "Closing the remaining bypasses" and "Guard discrimination".

### Layout-aware scaffolding

`createWorkstream()` (`workstream.ts:216-376`) branches in three places.

**The refusal that blocks UC-1.** The no-hash adoption path currently throws
when the workstream directory exists and no plan spec claims it
(`workstream.ts:274-279`). Under `project-level` that directory is the repo
root, which always exists — so `devx workstream new` with no slug, the exact
UC-1 flow, throws on every invocation before writing anything. The fix is to
change *what is probed*: not "does the directory exist" but "is a doc set
already present at this base" — the `lay101` predicate. Under `workstream`
layout the two questions coincide and behavior is unchanged; under
`project-level` the probe correctly reports an empty repo root as available.

**The template list.** The inline three-entry array at `workstream.ts:343-347`
is replaced by an iteration over `ArtifactKind`s resolved through
`stageSubject()`. This also relieves the triple-coupling that makes
`createWorkstream` expensive to extend today: the `created` result shape
(`:154-161`), the template array, and the `noop` conjunction (`:367-373`) all
have to change together for any new scaffolded artifact.

**The slug.** `devx workstream new [slug]` — optional under `project-level`,
required under `workstream`, where its absence is an error naming
`engine.docs_layout: workstream` as the reason. A slug supplied under
`project-level` is used for the plan spec's filename and title and names no
directory.

`SCAFFOLD_SUBDIRS` (`decisions`, `checkpoints`, `evals`) land at the repo root
under `project-level`, per the owner decision of 2026-09-01 confirming the §15
table as written.

### `devx layout migrate`

Registered as a subcommand-bearing command following the `outline` /
`workstream` house pattern (`src/cli.ts:59-107` static array; `register()` runs
no logic; the `.action()` calls a `runX()` returning a number;
`attachPhase(sub, N)` last). Exit codes follow the house convention: `0`
success, `1` refusal, `2` context/config failure.

The command is structured so that `--dry-run` is **non-destructive by
construction, not by care** — the invariant `src/lib/learn/watch.ts:971`
already states for the repo. A pure planner produces a `MovePlan`; the command
then either renders it or executes it. There is no `if (!dryRun)` sprinkled
through the mover.

```ts
interface Move { from: string; to: string; }          // repo-relative
interface MovePlan {
  target: DocsLayout;
  moves: Move[];
  specEdits: Array<{ specRel: string; workstreamTo: string }>;
  configEdit: { key: string[]; value: DocsLayout };
  refusals: Refusal[];                                 // non-empty ⇒ exit 1
}
function planLayoutMigration(fs, repoRoot, engine, target): MovePlan;
```

**Refusals**, computed before any move, each naming what was found and the way
forward (matching `WorkstreamRefusal`'s message style at
`workstream.ts:249-252`):

- **≥2 live workstreams migrating to `project-level`** — "live" is
  `stage !== "done" && stage !== "retired"` over a `plan/` walk, never a
  directory listing. Consumes `lay101`'s predicate.
- **A doc set already present at the destination** — the same predicate.
- **A dirty working tree** — porcelain parse with `-uall` and
  `core.quotePath=false`, and both sides of a rename recorded.

Refusals live in this command, not in `resolveWorkstream`, precisely because
only one caller in the repo distinguishes `WorkstreamRefusal` from
`WorkstreamError`.

**Execution order** is moves → spec frontmatter → config, and the ordering
rationale in the PRD is backwards in a way worth correcting. The PRD says
writing config last means "an interrupted run leaves a repo whose config still
describes its tree." It does not: if the moves landed and the config write did
not, the config describes the *pre-migration* shape while the tree carries the
new one. Both orderings leave a mismatch on interruption; the question is which
mismatch is recoverable.

Moves-last-config is right for a different reason: the clean-tree precondition
means every `git mv` is revertible with a single `git checkout -- .`, and
writing the config first would dirty the tree and destroy exactly that recovery.
So the ordering stands, the rationale changes, and the mismatch is made
**detectable** rather than assumed away — hence the new doctor finding below.

Moves run through `io.exec("git", ["mv", "--", from, to], { cwd: repoRoot })`,
checking `exitCode` per call. This is the first `git mv` in the repo; the
existing three occurrences are strings in advice text
(`doctor/detect.ts:395`, `workstream.ts:328`, `doctor/types.ts:50`). The `--`
separator and the argv-flag-smuggling posture of `git-tx.ts`'s `assertSafeRef`
are both adopted, since pathspecs here are built from disk state.

Only the plan spec's `workstream:` field is rewritten — `.` or
`<root>/<slug>`. `stage:`, `gate_status:` and `gate_verdicts:` live in the spec,
not the tree, so passed gates survive by construction rather than by careful
copying.

The config step is `setLeaf(["engine", "docs_layout"], target, "project",
{ projectPath })`.

### Guard discrimination

Three sites currently read a root `prd.md` / `design.md` / `plan.md` as
unambiguous evidence of an unmigrated flat-era repo. Under `project-level` those
same filenames at those same paths are the *current* layout, so each site takes
the layout as its discriminator: keep today's legacy meaning under `workstream`,
invert under `project-level`.

- **`createWorkstream`'s flat-era refusal** (`workstream.ts:318-332`). Its stage
  list is a bare inline `["prd", "design", "plan"]` derived from no constant; it
  becomes `STAGE_DIRS`-derived so a new stage cannot arrive unguarded.
- **`devx doctor`'s `flat-era-workstream` detector**
  (`src/lib/doctor/detect.ts:365-402`). Beyond the layout discriminator, its
  root is hardcoded `join(opts.repoRoot, "_devx", "workstreams")` — it ignores
  `engine.workstreams_root` entirely, by explicit docstring choice. Since this
  design is already editing the function, it takes the configured root.
- **`revise.ts`'s `STAGE_SHORTHAND`** (`src/lib/engine/revise.ts:76-83`) — the
  subtlest of the three, and the one where the obvious fix is wrong. The map
  takes flat-era *names* (`"prd.md"`) to workstream-shaped *paths* (`PRD_REL =
  "prd/agent.md"`). Those names are byte-identical to what
  `projectAgentRel("prd")` produces, so under `project-level` the map resolves
  the right name to the **wrong path**.

  The tempting fix — swap the shorthand's target to `projectAgentRel(stage)`
  under `project-level` — **breaks `devx revise` outright**. `cascadeFor()`
  (`revise.ts:92-104`) resolves a shorthand by matching
  `e.artifact === shorthand` against `CASCADE_TABLE`, which is keyed on the
  `*_REL` constants. Swap the target and nothing in the table matches,
  `cascadeFor()` returns `null`, and the command refuses on every invocation
  under the flat layout. Today's coincidence is load-bearing.

  The fix is therefore one level up: **`CASCADE_TABLE` is re-keyed on
  `ArtifactKind`**, a layout-independent identity, and both the shorthand map
  and the cascade lookup resolve to paths only at the edges through
  `stageSubject()`. `cascadeFor()` gains no layout parameter, because after the
  re-key it does not need one — it is comparing identities, not spellings. This
  is also what frees the `*_REL` constants to go module-private (see "The
  artifact map"); the two changes are the same change viewed from opposite
  ends.

A fourth site is added rather than discriminated: a **`layout-tree-mismatch`**
doctor finding, reporting a repo whose `engine.docs_layout` disagrees with the
shape on disk. It is `fixable: false` — the repair is `devx layout migrate`,
which touches real work — following the doctor fix boundary at
`doctor/types.ts:14-27`. This is what makes an interrupted migration a reported
state rather than a silent one.

### Closing the remaining bypasses

`stageSubject()` makes the bypass class unrepresentable going forward, but four
existing sites resolve artifact paths behind the resolver's back and each needs
its own answer. Three of them the PRD names; the fourth it misses, and it is the
highest-traffic of all.

- **`todo-truth.ts:49`** — `join(workstreamAbs, TODO_FILENAME)` inside
  `loadTodoDoc()`. Not in the PRD's list, and the most-travelled path in the set:
  both `gather.ts:898` (every `devx next`) and `todo.ts:91` call it. It sits one
  import away from `todoAbs()` and does not use it. Routes through
  `stageSubject(layout, base, { kind: "todo" })`.

- **`todo.ts:86` and `mark-done.ts:525`** — the same hand-join, both assigning
  to a local variable literally named `todoAbs`, which shadows the real
  resolver export of that name. A reader auditing for bypasses greps `todoAbs`
  and finds what looks like correct usage. Both route through the resolver and
  the shadowing locals are renamed, because the next audit should not have to
  re-learn this.

  `mark-done.ts:525` has a failure mode the others do not: its result feeds the
  `/devx` Phase 8 commit staging list. A wrong spelling there does not error —
  it silently drops the file from the merge-cleanup commit, leaving it
  uncommitted on `main` for the next session to trip over.

- **`validate-emit.ts:184` and `:306`** — the hardest of the four, and the one
  where the layout changes not just a path but the *shape of the claim being
  validated*. Line 184 builds `` `${wsRoot}/${epicSlug}/${PLAN_REL}` `` to
  locate a workstream's plan. Line 306 builds a boundary-anchored
  `new RegExp(...escapeRe(wsDirMarker)/escapeRe(PLAN_REL)...)` to test whether a
  dev spec's `from:` names that plan, with `workstream:` checked by exact
  equality against `wsDirMarker`.

  Under `project-level` all three inputs change: `wsDirMarker` is `.`,
  `PLAN_REL` is `plan.md`, and the `from:` claim a spec should carry is
  `plan.md`, not `_devx/workstreams/<slug>/plan/agent.md`. The path probe routes
  through `stageSubject()`; the claim matcher takes its marker and subject from
  the same resolver so the validator and the emitter cannot disagree about what
  a valid claim looks like. The regex keeps its boundary anchoring — the
  `backup_devx/...` suffix-collision case (EC#13) is layout-independent and must
  not regress.

- **`backfill.ts:312-318`** — the PRD files this under FR-5 as a hand-join,
  which it is not: it calls `planAbs`/`todoAbs` correctly. The real defect is the
  **enumeration**, one level up from the call. It does
  `readdir(join(repoRoot, engine.workstreamsRoot))` and iterates slugs, with an
  early return when that root does not exist. Under `project-level` the root
  does not exist, so the loop yields nothing and graph phase-ordering silently
  degrades to empty — no error, no warning, just a board missing its edges.

  Enumeration therefore resolves through the layout too: under `workstream` it
  keeps the readdir; under `project-level` it yields exactly one base, the repo
  root. This is the same shape as the live-workstream walk the migration uses,
  and the two share it.

Five further sites concatenate artifact spellings into **message text** only,
and they split into two severities worth keeping apart rather than lumping:

- **Genuinely wrong**: `gather.ts:900` (`` `${wsRel}/todo.md` ``) and
  `gate.ts:492,508` (`` `${ws.workstreamRel}/${EXPECTATIONS_REL}` ``) print
  workstream-shaped paths the repo does not contain under `project-level`. A
  diagnostic naming a nonexistent file is worse than no diagnostic.
- **Cosmetic only**: `render.ts:119` (`` `${ws}/${RED_REPORT_REL}` ``) and
  `:124` (`` `${ws}/${DECISIONS_DIR_REL}/${report}` ``). Because
  `RED_REPORT_REL` and `DECISIONS_DIR_REL` are layout-identical, these render as
  `./evals/RED-report.md` and `./decisions/<report>` — paths that *do* exist,
  carrying a stray `./` prefix. An earlier draft filed both at the higher
  severity; that was overclaimed.

All five move onto `subject.rel`, which is the reason `stageSubject()` returns
the relative form at all — but only the first group is a correctness fix.

**`devx next` and `devx outcome` are the two surfaces G-1 counts that the
bypass inventory above does not reach**, because their defect is not a hand-join
— they call the resolvers correctly, and the resolvers are layout-blind. Both
would be quietly broken under `project-level` by a change set that stopped at
the four hand-joins.

- **`devx next` row selection** — `gather.ts:972-975` and `next.ts:292-295`
  probe `prdAbs(wsAbs)` / `designAbs` / `planAbs` / `expectationsAbs` to decide
  which stage row to emit. Under `project-level` those resolve to
  `<repoRoot>/prd/agent.md`, which never exists, so **every stage probe fails
  and `devx next` reports "PRD not yet authored" forever** — on a repo whose PRD
  is sitting at `prd.md`. This is UC-3's actual failure mode and the most
  user-visible breakage in the workstream. The probes route through
  `stageSubject()`.
- **`devx next` row reasons** — `engine/next.ts:115-155` interpolates
  `PRD_REL` / `DESIGN_REL` / `PLAN_REL` into all six row `reason` strings. UC-3
  asks for "the same row numbers and the same reasons as the folder shape"; the
  numbers come free once selection is fixed, the reasons need `subject.rel`.
- **`devx outcome`** — `outcome.ts:314,332` resolve `prdAbs` / `expectationsAbs`
  against `workstreamAbs`, and `:492` hand-builds
  `` `${ws.workstreamRel}/RESULTS.md` `` rather than calling `resultsAbs()`.
  The first two route through `stageSubject()`; the third is a genuine
  hand-join and joins the list above. `RESULTS.md` is also one of the two
  artifact kinds §15 does not document today (FR-8), so this is the one file in
  the set with neither a resolver caller nor a doc row.

### Correcting the two false doc claims

Both surfaces that describe layout resolution describe it wrongly today, and a
reader consults them *before* choosing a layout — so this is not cleanup, it is
the difference between the feature being discoverable and being a trap.

- **`docs/CONFIG.md` §15 rule 5** currently asserts that "a gate resolves its
  subject through the layout, so the same `devx gate prd` runs against
  `prd/agent.md` or `prd.md` and returns the same verdict for the same
  content." After this workstream that sentence becomes true and stands as
  written. §15 also gains the `devx layout migrate` invocation as the answer to
  "what does switching cost" — a question §15 currently raises and leaves
  hanging.

  **The artifact table is restructured, not merely extended**, and the PRD
  understates this. FR-8 says §15 "gains its two missing rows"
  (`checkpoints/`, `RESULTS.md`), which would imply a 13-row result. The real
  table today has **12** rows in a different shape: design's outline and
  critique share one row, plan's share another, there are no `design-human` /
  `plan-human` rows, and `RED-report.md` has no row at all. So the target is one
  row per `ArtifactKind` — 13 rows in the map's own shape, of which the two FR-8
  names are genuinely new and several others are splits of existing rows. Saying
  "gains two rows" and then asserting a set-equality test over the table would
  have shipped a test that cannot pass.

- **`_devx/config-schema.json:939`** restates rule 5 verbatim in the
  `docs_layout` property description. It is the second of the exactly-two false
  claims G-4 counts, and it is the one a reader hits via editor autocomplete
  rather than by opening a doc. Its description is rewritten to match, and the
  enum stays `["workstream", "project-level"]` — no schema version bump, since
  the value space is unchanged.

**How prose becomes test-asserted** (E-8's mechanism, which is otherwise easy to
hand-wave): the test does not diff prose. It asserts three checkable properties.
First, that §15's artifact table has a row for every `ArtifactKind` the resolver
handles — the table is parsed, the union is enumerated, and the two sets must
match, so a future artifact kind cannot land undocumented. Second, that the
schema's `docs_layout` description and §15 rule 5 contain no claim about a
surface that resolves layout-blind — implemented as an allowlist of the
surfaces that *do* resolve through the layout, cross-checked against the
resolver's real callers. Third, that both documents' enum matches `DOCS_LAYOUTS`.
This is the same "structure, not wording" posture as the Reading Guide check:
mechanical where a machine can settle it, and silent about phrasing.

## Migration plan

**devx itself** stays on `workstream` and is the regression surface. Every
change above must be a no-op for it: the layout branch is never taken, the
resolver returns today's paths, and the seven `resolveWorkstream` call sites are
untouched. The `engineConfigFrom()` reordering and the
`planFilenameWorkstreamRel()` signature change are the two edits that touch the
`workstream` path at all, and both are behavior-preserving there.

**ClassyLights (`b7e38f`, `scene-engine`)** is the real subject and the G-3
measurement. Its state — `stage: plan`, `prd_validated: true`,
`design_verified: true`, `engine.docs_layout` unset — makes it the strongest
available test: two already-passed gates that must survive, and an unset layout
that currently resolves to the `workstream` default nobody chose. Sequence:
commit or stash to clean the tree → `devx layout migrate --to project-level
--dry-run` and read the moves → run it for real → confirm `gate_status` and
`gate_verdicts` diff empty → `devx gate coverage b7e38f` runs to a verdict on
the migrated tree.

**Repos with the legacy `personalization["docs.layout"]` key** are carried by
the `engineConfigFrom()` ordering fix described above: without it, a repo whose
only layout answer is the legacy key and which has no `engine:` block would
silently flip to the default on upgrade. That is a live regression the reordering
prevents, not a hypothetical.

**No data migration, no schema version bump.** The layout is a shape, not a
stored format; `gate_status` and `gate_verdicts` are untouched by every path
here.

## Resolved design questions

- **Where do `evals/`, `decisions/`, `checkpoints/` and `RESULTS.md` live under
  `project-level`?** → The repo root, as `docs/CONFIG.md` §15 already commits.
  Owner decision 2026-09-01 (Design stage), taking zero doc churn over a cleaner
  root; the §15 table gains its two missing rows (`checkpoints/`, `RESULTS.md`)
  rather than being rewritten.
- **Does `devx layout migrate` need to invent a config writer?** → No.
  `setLeaf()` (`config-io.ts:164-214`) already does comment-preserving scalar
  mutation via `yaml`'s `parseDocument` plus `atomicWrite`, with three existing
  callers. Grounded at Design.
- **Is E-3's "no hand-joined paths" assertion a scan or a type constraint?** →
  Primarily a type constraint (resolver functions become the only exported path
  source), with a scan over the enumerable residue that must stay exported for
  display and cascade-keying. Recorded as accepted-fragile for that residue
  rather than claimed sound.
- **Why does the config write come last?** → Not because it keeps config and
  tree agreeing on interruption (it does not — see Migration plan), but because
  the clean-tree precondition makes the moves revertible with one
  `git checkout -- .`, and a config edit first would dirty the tree and destroy
  that recovery.
- **Should `planFilenameWorkstreamRel()` be guarded at its call sites or change
  signature?** → Change signature to take `EngineConfig`. Four mechanical edits,
  and the layout stops being something four sites must remember.

- **How must E-2 be written so G-2's "exactly 1 function" is checkable?** → It
  counts **readers of the two config keys**, not functions in the call chain.
  `docsLayoutFrom()` survives as an exported wrapper that reads nothing itself,
  so an eval counting functions that *return a layout* would find two and fail a
  design that is correct. The RED artifact scans for reads of
  `engine.docs_layout` and `personalization["docs.layout"]` and asserts exactly
  one function performs either. Recorded here because it is the kind of detail
  that gets discovered at Gate 4 and then "fixed" by softening the eval.

## Unresolved design questions

- **Does `dev-lay101` land before this?** If it does, the two refusal sites
  consume its one-doc-set predicate. If it does not, they carry a local
  predicate with the same signature, deleted on adoption. Either order works;
  what must not happen is two permanent definitions. — owner: sequencing at the
  Plan stage. Does not block Gate 2: no P0 expectation depends on which order.

- **Does re-keying `CASCADE_TABLE` on `ArtifactKind` disturb `devx revise`'s
  flat-era shorthand acceptance?** The map deliberately accepts `--touched
  design.md` because every pre-migration decisions/ report and in-flight session
  says that (`revise.ts:70-75`). After the re-key those names must still resolve
  under `workstream` layout, where they are legacy aliases, *and* under
  `project-level`, where they are the current spelling — the same string
  arriving for two different reasons. The design's position is that both
  resolve to the same `ArtifactKind`, so the ambiguity never reaches a path.
  Whether that holds for every existing shorthand is an implementation finding.
  Does not block Gate 2: no P0 depends on shorthand acceptance, and E-1's
  verdict-equivalence claim is unaffected either way.

## PRD corrections routed through `devx revise`

Design-stage grounding contradicted four numbers in `prd/agent.md`. Per the
source-of-truth override flow, the losing artifact is updated rather than
silently diverged from:

- **FR-5 / E-3 baseline: 4 bypasses → at least 6.** The PRD misses
  `src/lib/engine/todo-truth.ts:49` (`loadTodoDoc`), which is the highest-traffic
  of all — both `gather.ts:898` (every `devx next`) and `todo.ts:91` call it —
  plus `src/lib/doctor/detect.ts:386` and `src/commands/outcome.ts:492`
  (`` `${ws.workstreamRel}/RESULTS.md` ``). Five message-only concatenations
  (`render.ts:119,124`, `gather.ts:900`, `gate.ts:492,508`) will *lie* under
  `project-level` without breaking.

  **Not** a bypass, recorded so it does not get "fixed": `src/commands/todo.ts:94`
  is `join(repoRoot, TEMPLATES_DIR, TODO_FILENAME)` — the shipped npm template
  path. It is layout-independent by construction and must **not** route through
  `stageSubject()`. An earlier draft of this design listed it as a bypass; it is
  a false positive and is excluded from the revision pushed to the PRD.
- **FR-5 miscategorizes `backfill.ts:350,363`** as a hand-join. It calls
  `planAbs`/`todoAbs` correctly; the real defect is the **enumeration** at
  `:312-318`, which readdirs the workstreams root and early-returns when that
  root is absent — so under `project-level` graph phase-ordering silently
  degrades to empty rather than resolving one base. Designed under "Closing the
  remaining bypasses".
- **G-2 baseline: 2 orphaned exports → 15.** The entire stage-parametrized half
  of `artifacts.ts` is unwired, not just the project-level pair.
- **FR-2: "all five of its callers" → seven.** Which strengthens the PRD's bet
  rather than weakening it.

A fifth item is an addition, not a correction: **UC-1 is blocked today** by
`createWorkstream`'s directory-existence refusal, which the PRD does not
mention.
