<!-- refined: critique 2026-09-02 (lenses: pm, architect, dev, qa) -->

# Plan — Docs Layout Resolution

<!-- Stage: Plan. Gate: `devx gate coverage a494be` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. One phase ≙
     one dev spec ≙ one PR. Phase appetite: coarse (owner profile), with one
     documented departure — see "Phase checklist". -->

## Current state

`engine.docs_layout` is a config key that nothing meaningful reads. Two
documents claim it selects where every engine artifact lives; no code
implements that claim.

- **`src/lib/engine/artifacts.ts`** holds both halves of the map already —
  `stageFileRel`, `outlineRel`, `humanRel`, `outlineCritiqueRel` (workstream
  half) and `projectAgentRel`, `projectHumanRel`, `projectOutlineRel`,
  `projectOutlineCritiqueRel` (project-level half). Only `projectOutlineRel`
  has a production caller (`lib/engine/outline.ts:169`,
  `commands/outline.ts:243`). There is no `ArtifactKind` type binding them;
  the four basenames are loose string constants and
  `stageFileRel(stage, basename)` takes an untyped second parameter.
- **Two functions read the layout key**: `docsLayoutFrom()`
  (`artifacts.ts:168-174`) and the private `docsLayoutUnset()` in
  `src/lib/next/gather.ts`, which duplicates the same two-key read
  (`engine.docs_layout`, then the legacy `personalization["docs.layout"]`)
  by hand.
- **`EngineConfig`** (`src/lib/engine/config.ts:11-19`) has four required
  fields and no layout, so the seven `resolveWorkstream` and five
  `resolveSpecWorkstream` call sites thread a config object that cannot
  answer the question. `engineConfigFrom()` opens with **two** early-return
  guards (non-object `merged`, then non-object `merged.engine`).
- **A duplicate `DocsLayout` type** is hand-written at
  `src/lib/init-questions.ts:58` rather than derived from `DOCS_LAYOUTS`.
- **Every consumer resolves layout-blind.** Grounded counts as of
  2026-09-02, `src/` excluding `engine/artifacts.ts` itself:
  - **33 `*Abs()` call sites** — `expectationsAbs` 6 · `prdAbs` 5 ·
    `planAbs` 5 · `decisionsDirAbs` 5 · `redReportAbs` 4 · `designAbs` 3 ·
    `evalsDirAbs` 3 · `todoAbs` 1 · `resultsAbs` 1. There are **ten**
    exported `*Abs()` helpers, not nine: `checkpointsDirAbs`
    (`artifacts.ts:198`) has **zero** callers in `src/` or `test/` and is
    absent from the design's accounting.
  - **72 lines / 93 occurrences** of the seven stage-shaped `*_REL`
    constants (`PRD_REL` 32 · `EXPECTATIONS_REL` 23 · `PLAN_REL` 16 ·
    `DESIGN_REL` 11 · `TODO_REL` 4 · `RED_REPORT_REL` 4 ·
    `DECISIONS_DIR_REL` 3). The two figures differ because **10 lines are
    multi-symbol import statements**; the per-symbol column sums to 93.
    `EVALS_DIR_REL` (`gate-prd.ts:34,404`, `gate-evals.ts:41,321`) and
    `CHECKPOINTS_DIR_REL` are deliberately **excluded** — they are
    layout-identical and stay exported.
  - Spread across **17 modules**:
    `commands/{gate,next,outcome,plan-helper,status,workstream}.ts`,
    `lib/engine/{gate-coverage,gate-prd,next,outcome,render,revise,todo-truth,workstream}.ts`,
    `lib/graph/backfill.ts`, `lib/next/gather.ts`, `lib/plan/validate-emit.ts`
    — plus `lib/engine/gate-evals.ts` and `commands/revise.ts`, which
    consume the constants and `CascadeEntry.artifact` respectively.

  These replace the design's estimates (`~51` / `40+`). Same order of
  magnitude, different split. The design's qualitative claim — the blast
  radius is an order of magnitude past the PRD's "2 consumers" — holds.
- **Four test files import the `*_REL` constants by name** and break at
  compile time when they go private: `test/engine-artifacts.test.ts`,
  `test/workstream-migration-integrity.test.ts`, `test/next-todo-drift.test.ts`,
  `test/todo-sync.test.ts`.
- **`artifactAbs(wsAbs, rel)`** (`artifacts.ts:182`) is the generic joiner the
  ten helpers wrap. It is exported and takes an arbitrary rel, so privatizing
  the constants alone does **not** make a hand-joined path unrepresentable.
- **Five hand-joins bypass the resolver**, and they are not equally severe:
  - *Correctness-bearing*: `lib/plan/validate-emit.ts:184` and `:306` join
    `PLAN_REL`, whose spelling genuinely differs between layouts
    (`plan/agent.md` vs `plan.md`).
  - *Representational only*: `lib/engine/todo-truth.ts:49`,
    `commands/todo.ts:86` and `lib/devx/mark-done.ts:525` all join
    `TODO_FILENAME`, and `todo.md` is the **same basename in both layouts**
    over a base that already resolves to the repo root — so they produce the
    correct path today. `commands/outcome.ts:492`
    (`` `${ws.workstreamRel}/RESULTS.md` ``) renders `./RESULTS.md`, an
    existing path with a stray prefix.

    They are still closed, for the reason the design gives: the next audit
    should not have to re-derive which hand-joins are safe. But the design's
    claim that `mark-done.ts:525` "silently drops the file from the
    merge-cleanup commit" is **unreachable** and is corrected here.

  `todo-truth.ts:37` re-exports `TODO_FILENAME = TODO_REL`, consumed by
  `mark-done.ts:51` and `commands/todo.ts:34`.
- **`CASCADE_TABLE`** (`lib/engine/revise.ts:44-64`) is keyed on the `*_REL`
  path constants; `cascadeFor()` (`:98-102`) does string identity against
  them; `STAGE_SHORTHAND` (`:76-83`) maps flat-era names (`"prd.md"`) onto
  those same constants. Under `project-level` the shorthand resolves the
  right name to the wrong path, and the obvious fix breaks `cascadeFor()`
  outright. `commands/revise.ts:94-100,133` consumes `entry.artifact` for a
  membership check, a refusal message, and the JSON `touched:` output.
- **Two flat-era guards, not three** — the design's framing is corrected
  here:
  - `createWorkstream`'s refusal (`lib/engine/workstream.ts:323-331`) probes
    `join(wsAbs, "<stage>.md")`. Under `project-level` `wsAbs` **is** the
    repo root, so any repo carrying `prd.md` refuses. This one genuinely
    misfires and needs the layout discriminator. Its stage list is a bare
    inline `["prd","design","plan"]`.
  - `devx doctor`'s `flat-era-workstream` detector
    (`lib/doctor/detect.ts:374-388`) scans
    `_devx/workstreams/<slug>/<stage>.md` and **never reads a repo-root
    file**, so it cannot misfire under `project-level`. Its only real defect
    is the hardcoded `join(repoRoot, "_devx", "workstreams")`, which ignores
    `engine.workstreams_root`.
  - `revise.ts`'s `STAGE_SHORTHAND` is the third site the design counts, but
    it is not a *root-`prd.md`* guard — it is a key-identity problem, handled
    with the cascade re-key.
- **`createWorkstream`'s template source is workstream-shaped.**
  `workstream.ts:348-350` uses one rel for **both** destination
  (`artifactAbs(wsAbs, t.name)`) and shipped-template source
  (`join(repoRoot, TEMPLATES_DIR, ...t.name.split("/"))`). Templates are
  stored in workstream shape on disk (`_devx/templates/engine/prd/agent.md`;
  there is no `_devx/templates/engine/prd.md`).
- **`devx workstream new` hard-requires a slug at the commander layer** —
  `.argument("<slug>", …)` (`commands/workstream.ts:101`) and an
  `args.length !== 1` check at `:44-49`.
- **RED evals in this repo are standalone `npx tsx` scripts under
  `_devx/workstreams/<slug>/evals/`**, never vitest files. `resolveRunner`
  (`gate-evals.ts:156-176`) picks the longest path prefix; `devx.config.yaml`
  offers `workstream-evals` (path `_devx/workstreams`, `npx tsx`) and `cli`
  (path `.`, `npm test --silent`). A `test/…` artifact therefore falls
  through to `cli`, and `npm test` is an `&&` chain whose file argument
  reaches only `test:blocking` — whose `include` is the hand-maintained
  `SYNC_BLOCKING_TESTS` in `vitest.shared.ts`. The recorded exit code would
  be the whole 17-minute suite's, not the artifact's.
- **There is no migration path.** Switching layouts on an existing repo is a
  manual file move with no tool, no refusal, and no guarantee gate state
  survives.
- **`dev-lay101`** (the shared one-doc-set predicate) is filed and `[ ]`
  ready; it has not landed.

## Desired state

- `stageSubject(layout, base, kind)` in `artifacts.ts` is the single
  `(layout, base, kind) → path` decision in the codebase, and — with
  `artifactAbs` private — the only exported way to obtain an engine artifact
  path.
- Exactly one function reads either layout key. `EngineConfig` carries
  `docsLayout` and its `source`, populated **before** `engineConfigFrom()`'s
  two guards so a repo whose only answer is the legacy
  `personalization["docs.layout"]` key does not silently flip to the default.
- Every gate, `devx next`, `devx status`, `devx outcome`, `devx revise`,
  `devx todo`, `devx graph` and `devx workstream new` resolves its subject
  through the layout, and returns the identical verdict for byte-identical
  content in either shape.
- `devx workstream new` scaffolds a complete root doc set under
  `project-level` with the slug optional, and refuses with a slug-required
  error naming `engine.docs_layout: workstream` under the other layout.
- `devx layout migrate --to <layout>` moves a mid-flight tree between shapes
  with `git mv`, rewriting only `workstream:` and leaving `stage:`,
  `gate_status:` and `gate_verdicts:` byte-identical — or refuses before
  moving anything.
- `docs/CONFIG.md` §15 and `_devx/config-schema.json` describe the behavior
  that exists, asserted by a test rather than by prose review.
- **devx itself is unchanged.** It stays on `workstream`; every phase is a
  runtime no-op for it.

## What we're NOT doing

- **Enforcing `project-level`'s one-doc-set rule.** Owned by `dev-lay101`.
  Phases 4 and 6 carry a *local* predicate with `lay101`'s signature, deleted
  on adoption — never a second permanent definition (owner decision,
  2026-09-01).
- **Making the outline guard layout-aware.** `isProtectedOutlinePath()` stays
  a pure filename matcher with no config read; it already protects both
  spellings unconditionally.
- **Making the artifact-*authoring* surfaces layout-aware.**
  `.claude/commands/devx-plan.md` hardcodes the folder shape at `:12`, `:113`,
  `:129`, `:135`, `:165`, `:223`; `.claude/commands/devx.md` at `:189`,
  `:203`, `:698`. Under `project-level` an agent following those skills writes
  into the folder shape while the CLI reads the flat one — the same
  reader/writer split this workstream exists to kill, one layer out. It is
  **out of scope here** because the S-1 prose budget (60KB, CI-gated) has
  single-digit bytes of headroom, so rewording nine skill-body references is
  its own sized piece of work. **Follow-up spec is filed as part of Phase 7**
  (T7.4) rather than left implicit. `RETRO-<date>.md` is likewise a real
  workstream artifact with no `ArtifactKind` and no §15 row; it is recorded as
  deliberately layout-independent, not omitted.
- **A third layout, or a user-supplied path template.**
- **Changing what any gate checks** — bodies, verdicts, thresholds and the
  `gate_status` frontmatter contract are untouched.
- **Migrating devx itself.**
- **`devx init`'s layout question** — already shipped.
- **Propagating the four PRD baseline corrections** recorded in
  `design/agent.md § PRD corrections routed through devx revise`. Owner
  decision 2026-09-01: deferred, because `CASCADE_TABLE`'s `PRD_REL` row
  (`revise.ts:44-48`) resets **all four** gate flags and re-earning Gates 1
  and 2 costs a full stage round-trip.

  Stating precisely what goes stale, because "only baseline counts" was too
  generous: **G-2's baseline** (2 → 15 orphaned exports) is a number inside a
  dated goal `devx outcome` will score; **FR-5's site list** enumerates
  `backfill.ts:350,363` as hand-joins they are not, and omits
  `todo-truth.ts:49`; **E-2's and E-3's thresholds** carry both errors. This
  plan carries the corrected numbers, and
  `decisions/2026-09-02-deferred-prd-corrections.md` records them so outcome
  scoring has a source that is not this file. See R-6 and R-9.

## Risks

<!-- Written from the Plan-stage interrogation (skill step 1b). Risks of the
     SEQUENCE, distinct from design/agent.md's risks of the APPROACH. -->

**Riskiest phase: Phase 5.** Not the largest — Phase 6 writes more genuinely
new code, Phase 4 touches more files — but the only phase that is
*compile-breaking by construction*: privatizing the `*_REL` constants and
`artifactAbs` breaks `todo-truth.ts:37`'s re-export (and through it
`mark-done.ts:51`, `commands/todo.ts:34`) plus four test files, and re-keying
`CASCADE_TABLE` changes the identity `devx revise` dispatches on. It is also
where R-1 and R-4 live.

The critique moved the behavior-preserving sweep out of it (into Phase 4)
precisely so this phase is small enough to review line by line.

| Risk | Phase | Blast radius | Rollback |
|---|---|---|---|
| **R-1** Both spellings reachable in the interim. Phase 1 exports `stageSubject()` while the layout-blind surface still stands; the E-3 scan that forbids the old one does not exist until Phase 4, and the constants stay reachable until Phase 5. A consumer added in that window can pick the wrong spelling and pass CI. | 1→5 | low | Phase 4's scan catches it at merge; Phase 5 makes it unwritable. Accepted rather than mitigated — the alternative is one unreviewable phase. |
| **R-2** A `project-level` repo could be *created* before the resolver is correct. Originally scoped as "unreachable because no repo is on `project-level`" — that was self-falsifying, since the scaffolder is the thing that makes it reachable. | 4 | med | **Restructured, not argued away**: layout-aware scaffolding (E-5) moved from Phase 3 into Phase 4, *after* the consumer sweep. A repo can only be scaffolded `project-level` once the resolvers behind `devx next` / gates / `todo` already resolve correctly. Phase 3 ships resolution only and creates no new reachable state. |
| **R-3** Phase 2 owns the 12 `commands/gate.ts` `*Abs()` sites so E-1 can pass; those 12 are therefore removed from Phase 4's sweep. If Phase 4 re-derives its list from a fresh grep instead of the plan, it will re-touch them. | 2, 4 | low | T4.3 names the exclusion explicitly. Harmless if it happens — the second edit is a no-op. |
| **R-4** `CASCADE_TABLE`'s re-key must keep `--touched design.md` resolving under **both** layouts — a legacy alias under `workstream`, the current spelling under `project-level`. The design asserts both resolve to the same `ArtifactKind`; whether that holds for every shorthand is an implementation finding, not a settled one. | 5 | med | An ambiguous shorthand refuses (returns `null`) rather than resolving wrongly — today's behavior for a bare `agent.md`. Refusing is recoverable; resolving to the wrong cascade silently leaves stale gate flags over a rewritten artifact. |
| **R-5** **Phase 6 is a one-way door for the repo that runs it.** `devx layout migrate` performs `git mv` plus a config write in a *user's* repo. Reverting the devx PR does not un-migrate ClassyLights. | 6 | high | Honestly: none, once the migration commit is pushed in the target repo. Recovery *during* the run is one `git checkout -- .`, bought by the clean-tree precondition and by writing config last; `--dry-run` is the real mitigation. Afterwards, rollback is a second migration in the opposite direction. Not revert-safe, and not to be described as such. |
| **R-6** E-3's threshold is wrong in **both** directions: it names `lib/graph/backfill.ts:350` (a workstream-*base* join feeding the resolver, not a bypass) and omits `lib/engine/todo-truth.ts:49` (a real one). Asserting "0 globally" fixes the false positive but not the false negative — an author tuning the scan's accepted-fragile allowlist against the stale list can allowlist the real site away and still report 0. | 4 | med | The scan is **negative-controlled**: T4.1's criterion is that it must be shown flagging all five real hand-joins *before* they are closed — which is why the scan is authored in Phase 4 as T4.1, ahead of T4.5's closures, rather than in Phase 5 after them. Residue of the deferred PRD correction. |
| **R-7** Phase 4's `createWorkstream` change alters what `devx workstream new` refuses. A workstream scaffolded before a hypothetical revert stays on disk; reverting the code does not un-scaffold it. | 4 | low | Artifacts are markdown and the scaffold is inert; delete the directory. |
| **R-8** `lay101` may land mid-workstream, at which point two definitions of the one-doc-set predicate exist. | 4, 6 | low | The local predicate carries `lay101`'s signature and is deleted on adoption. A *permanent* second definition is the failure; a temporary one is the plan. |
| **R-9** E-2's threshold ("0 orphaned exports, down from 2") names two resolvers when the real orphan set is larger — `stageFileRel`, `outlineRel`, `outlineCritiqueRel`, `humanRel`, `projectAgentRel`, `projectHumanRel`, `projectOutlineCritiqueRel`, `checkpointsDirAbs`. A RED author taking Phase 1 literally writes an assertion Phase 1 structurally cannot pass, because Phase 1 is additive and gives nothing a caller. | 1, 5 | med | E-2 is verified in **Phase 5**, not Phase 1 — that is where `stageSubject()` gains its production callers and the dead helpers can be deleted. Phase 1 carries the single-reader half as a plain unit assertion with no orphan claim. |
| **R-10** Phase 7 documents `devx layout migrate` in §15, and Phase 3's `layout-tree-mismatch` advice names it, before Phase 6 ships it. | 3, 6, 7 | low | Phase 7 is sequenced after Phase 6 in the wave graph. The doctor advice string is inert text; if Phase 6 slips, the advice names a command that does not exist yet — cosmetic, and caught by Phase 7's doc-truth test. |

**What breaks if this lands in this order** — R-1 and R-3 are the two places
an earlier phase exposes something a later phase was meant to guard, and both
are bounded. R-2 *was* the third and was fixed structurally by moving
scaffolding behind the sweep rather than by writing a mitigation sentence.

**Rollback summary**: Phases 1, 2, 3, 5 and 7 are revert-safe (revert the PR).
Phase 4 is revert-safe for code, not for artifacts already scaffolded (R-7).
**Phase 6 is not revert-safe** for a repo that ran the migration (R-5).

## Expectation coverage

Eval artifacts are standalone `npx tsx` scripts under the workstream's
`evals/`, matching every prior workstream in this repo and the
`workstream-evals` runner in `devx.config.yaml`. A `test/…` path would resolve
to the `cli` runner and record the whole suite's exit code instead of the
artifact's. Each eval asserts its own invariant **and** that its companion
`test/engine-layout-*.test.ts` exists, so the invariant is also pinned in
`npm test` (the `E-2_gate-todo-isolation.ts` precedent).

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 2 | tests-first | `evals/E-1_gate-subjects.ts` | full |
| E-2 | P0 | 5 | tests-first | `evals/E-2_single-reader.ts` | full |
| E-3 | P0 | 4 | tests-first | `evals/E-3_no-hand-joins.ts` | full |
| E-4 | P0 | 3 | tests-first | `evals/E-4_resolve-workstream.ts` | full |
| E-5 | P0 | 4 | tests-first | `evals/E-5_scaffold.ts` | full |
| E-6 | P0 | 6 | tests-first | `evals/E-6_migrate.ts` | full |
| E-7 | P0 | 6 | tests-first | `evals/E-7_migrate-refusals.ts` | full |
| E-8 | P1 | 7 | tests-first | `evals/E-8_docs-truth.ts` | full |

## Phase checklist

- [x] Phase 1: The artifact map and the single layout reader
- [x] Phase 2: Gate subject resolution
- [x] Phase 3: Workstream resolution and the flat-era guard
- [ ] Phase 4: Consumer sweep and layout-aware scaffolding
- [ ] Phase 5: Identity re-key and privatization
- [ ] Phase 6: `devx layout migrate`
- [ ] Phase 7: Doc truth

**Departure from the coarse appetite, stated rather than slipped in.** The
owner chose a 6-phase shape. The critique's architect lens found the original
Phase 4 too large to review as one PR and named a natural seam — the compile
break — and the PM lens independently found that shipping the scaffolder in
Phase 3 made R-2 reachable. Both fixes point the same way, so the sweep and
the identity change are now separate phases (4 and 5), with scaffolding moved
into 4. Seven phases, not six. Collapsing 4 and 5 back into one is a
one-paragraph edit if the owner prefers the original shape.

**Execution waves** (`plan.wave_execution: default`):

```
        ┌─ Phase 2 ─┐                              ┌─ Phase 6 ─┐
Phase 1 ┤           ├─ Phase 4 ── Phase 5 ─────────┤           │
        └─ Phase 3 ─┘                              └─ Phase 7 ─┘
```

Phases 2 and 3 are parallel-safe (both depend only on Phase 1; disjoint file
sets — 2 owns `gate*`, 3 owns `workstream`/`doctor`; Phase 1 also edits
`gather.ts` but strictly precedes both). Phases 6 and 7 are parallel-safe
(both depend on Phase 5; 6 owns a new command plus `lib/layout/`, 7 owns
`docs/` plus the schema). Phases 4 and 5 are the join and run alone, in order.

## Phases

### 1. Phase: The artifact map and the single layout reader

**Overview**: The foundation. It ships the `ArtifactKind` union,
`stageSubject()`, the collapse to one layout reader, and
`EngineConfig.docsLayout`. It is first because every other phase consumes
`stageSubject()`. **It is additive in production and NOT additive in the test
suite** — adding required fields to `EngineConfig` re-types eight hand-built
literals, and moving the unset-layout nag onto `layoutSource` breaks a test
helper that varies `merged` while holding `engine` fixed.

**Files**:
- `src/lib/engine/artifacts.ts` — add `SubjectStage`, `ArtifactKind`,
  `StageSubject`, `stageSubject()`, and the reverse `pathToArtifactKind()`
  lookup Phase 5's `cascadeFor()` needs (the same table read backwards, so it
  belongs to the map that owns the table). Add
  `resolveDocsLayout(merged) → { layout, source }` as the one reader; demote
  `docsLayoutFrom()` to a thin wrapper over it that reads nothing itself.
- `src/lib/engine/config.ts` — add `docsLayout` and `layoutSource` to
  `EngineConfig` and `ENGINE_DEFAULTS`; assign both in `engineConfigFrom()`
  **above** the two early-return guards.
- `src/lib/next/gather.ts` — delete `docsLayoutUnset()`; its one caller (the
  unset-layout nag) becomes `engine.layoutSource === "default"`. **As-built:**
  this is NOT behaviour-preserving and the warning text changed with it. The
  retired predicate asked whether the key was PRESENT, so a typo'd value stayed
  silent; `layoutSource` asks whether a layout RESOLVED, so it now nags. Kept
  (better signal; `loadMerged` runs no schema validation, so a typo really does
  reach here) and the message reworded to "unset or not one of `workstream` /
  `project-level`" so it no longer calls a set key unset.
- `src/lib/init-questions.ts` — replace the duplicate `DocsLayout` type at
  `:58` with an import from `artifacts.ts`.
- `src/lib/init-write.ts` — **as-built, not planned**: `renderInitConfig`
  was a THIRD site naming the key (`config.engine?.docs_layout`), which the
  Current state's "two functions read the layout key" missed. It is a WRITE
  site (it renders init's own interview answer into a new config), so it is
  not a resolver — but the G-2 scan counts textually, so it is allowlisted
  BY NAME in the phase-1 test rather than reshaped to hide from the regex.
- `test/next-dispatch.test.ts` — five `engine` literals (`:774,795,836,1882,1914`)
  **and** the `layoutWarnings(merged)` helper at `:785-830`, whose four
  assertions vary `merged` against a fixed `engine` literal and must now vary
  `engine.layoutSource` instead.
- `test/frontmatter-unreadable-reported.test.ts:34`, `test/spec-lock.test.ts:460`,
  `test/devx-split.test.ts:775`, `test/engine-prose-budget.test.ts:147` — the
  remaining hand-built `engine` literals.

**Context**:
- `evals` is deliberately absent from `SubjectStage`. Its subject IS the evals
  *directory*, so `{ kind: "evals-dir" }` names it and
  `{ kind: "agent", stage: "evals" }` is unrepresentable rather than branched
  around. The stage-parametrized companions keep the full `StageDir`, so
  `{ kind: "outline", stage: "evals" }` correctly yields `evals-outline.md`.
  **Nothing in the repo exercises the evals row today**, so the map must be
  tested at `evals` specifically, not only at `prd`.
- The pre-guard ordering is load-bearing and easy to get backwards.
  `docsLayoutFrom()` reads `engine.docs_layout` **and** the legacy
  `personalization["docs.layout"]`; a repo that answered only the legacy key
  has no `engine:` block, so the second guard fires and the layout is lost.
  `resolveDocsLayout()` is defensive on both reads, which is what makes it
  safe above the guards. Production is not at risk either way
  (`context.ts:47` derives `engine` from the same `merged`) — the test helper
  is.
- G-2 counts one **function**, not one **file**. Re-expressing the nag against
  a second exported predicate beside `docsLayoutFrom()` would leave the count
  at two — the same drift bug wearing a new name.
- `stageSubject()` returns both `rel` and `abs` because both are needed at the
  same call sites today — gate refusals print the relative form, reads use the
  absolute. Returning one and making callers derive the other is how two
  spellings drift.
- **This phase makes no orphan-count claim.** E-2's "0 orphaned exports" half
  is structurally unsatisfiable here (R-9) and is verified in Phase 5.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `stageSubject()` returns the §15 table's path for all 13 artifact-kind
    rows under both layouts, including `{ kind: "outline", stage: "evals" }`
    → `evals-outline.md` and `{ kind: "evals-dir" }` → `evals`.
  - **Exactly one function** in `src/` reads `engine.docs_layout` or
    `personalization["docs.layout"]` (a static scan). No orphan assertion.
  - A config blob with **no `engine:` block** but
    `personalization["docs.layout"]: project-level` yields
    `docsLayout: "project-level"`, `layoutSource: "legacy"`.
  - A malformed layout value yields the shipped default and does not throw.
  - `npm run typecheck` and the full suite are green, with the 9 test-file
    sites re-typed. **devx's runtime behavior is unchanged** — no production
    caller moved.

**Tasks**:
- [x] T1.1 Add `SubjectStage` / `ArtifactKind` / `StageSubject` / `stageSubject()` / `pathToArtifactKind()` — files: `src/lib/engine/artifacts.ts`
- [x] T1.2 Add `resolveDocsLayout()`; reduce `docsLayoutFrom()` to a wrapper — files: `src/lib/engine/artifacts.ts`
- [x] T1.3 Add `docsLayout` + `layoutSource` to `EngineConfig`/`ENGINE_DEFAULTS`, assigned above both guards — files: `src/lib/engine/config.ts`
- [x] T1.4 Delete `docsLayoutUnset()`; move its caller onto `layoutSource` — files: `src/lib/next/gather.ts`
- [x] T1.5 Replace the duplicate `DocsLayout` type with an import — files: `src/lib/init-questions.ts`
- [x] T1.6 Re-type the 8 hand-built `engine` literals and rewrite `layoutWarnings()` to vary `layoutSource` — files: `test/next-dispatch.test.ts`, `test/frontmatter-unreadable-reported.test.ts`, `test/spec-lock.test.ts`, `test/devx-split.test.ts`, `test/engine-prose-budget.test.ts`

### 2. Phase: Gate subject resolution

**Overview**: Makes `docs/CONFIG.md` §15 rule 5 true — a gate resolves its
subject through the layout and returns the identical verdict for identical
content in either shape. It lands before the broad sweep because it is the
contract the whole workstream exists to honor.

**Files**:
- `src/commands/gate.ts` — the **12 `*Abs()` subject reads** at
  `:203,204,278,279,314,315,361,363,489,496,550,552`. These are the reads that
  decide whether a gate can find its subject at all; without them E-1 cannot
  pass, because under `project-level` `devx gate prd` would refuse with
  "prd/agent.md does not exist" — itself a verdict difference. Also the
  refusal strings that print `` `${ws.workstreamRel}/${EXPECTATIONS_REL}` ``.
- `src/lib/engine/gate-prd.ts` — the **9 `PRD_REL`/`EXPECTATIONS_REL` usages**
  feeding **19 `location:` fields** (`:209,218,227,238,259,265,273,282,296,321,329,343,353,361,371,379,387,397,405`
  — 4 built from `PRD_REL`, 15 from the `loc` local defined once at `:248`)
  **and 6 `message:` strings** (`:208,217,226,237,281,295`), which print
  `prd/agent.md` under `project-level` exactly as the `location:` fields do.
- `src/lib/engine/gate-coverage.ts` — refusal and subject strings onto
  `subject.rel`.
- `evals/E-1_gate-subjects.ts`, `test/engine-layout-gate-subjects.test.ts` — new.

**Context**:
- **The layout is never a gate input.** Only *subject resolution* branches;
  gate bodies receive an already-resolved path and cannot see the layout.
  That is what E-1 asserts, and it is why this phase touches no verdict,
  threshold or `gate_status` field.
- Gate `location:` fields are part of the gate's **output contract**, not
  decoration. A finding pointing at `prd/agent.md:42` in a repo whose file is
  `prd.md` is a finding a human cannot act on.
- **`commands/gate.ts` drops out of Phase 4's sweep** — its 12 sites are
  resolved here (R-3).
- Parallel-safe with Phase 3.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - All four gates (`prd`, `coverage` in **both** design and plan modes,
    `evals`) run against byte-identical subject content under both layouts —
    8 layout×gate combinations — with **0 verdict differences**.
  - **Equality is not satisfiable by mutual failure**: all 8 combinations are
    pinned to `PASS` on the passing fixture, and a second deliberately-broken
    fixture per layout is pinned to `FAIL`. (An equality-only assertion goes
    green when a regression breaks both layouts identically.)
  - Every `location:` and `message:` string emitted under `project-level`
    names a path that exists on the fixture disk.
  - devx's own gates return output identical to `main`.
    **As-built — departed, deliberately.** Verdicts, exit codes, thresholds,
    `gate_status` flips and stage advances are byte-identical (diffed by
    running both builds over two identical scratch copies of this very
    workstream). The `location:`/`message:` strings and the verify report's
    Subject line are NOT: they moved from doc-set-relative to repo-relative.
    `main` was already internally inconsistent — `commands/gate.ts` printed
    repo-relative while `gate-prd.ts` printed doc-set-relative — so no option
    preserved both spellings, and this one satisfies the criterion directly
    above it. Scope is this phase's output strings only; nothing downstream
    re-reads them.

**Tasks**:
- [x] T2.1 Author `test/engine-layout-gate-subjects.test.ts` — files: `test/engine-layout-gate-subjects.test.ts`. **As-built:** `evals/E-1_gate-subjects.ts` and its fixtures were authored at the RED stage and are locked, so this task was the suite half only; E-1 was re-run first and confirmed RED for the stated reason.
- [x] T2.2 Resolve the 12 `commands/gate.ts` `*Abs()` subject reads through `stageSubject()`; fix the two lying refusal strings — files: `src/commands/gate.ts`. **As-built:** 5 refusal strings de-lied, not 2 — the same `${workstreamRel}/${REL}` shape also sat on `gate-input-missing` and the two report-path builders. `subjectsFor()` additionally exposes a normalized `docSetRel`/`docSetAbs`/`docSetLabel` (anchored on the expectations subject), because `runGateEvals` and `donePhasesFor` were still taking the RAW base — a verdict-affecting split once subjects normalize and that comparison does not.
- [x] T2.3 Thread the resolved subject into `gate-prd.ts`'s 19 `location:` fields and 6 `message:` strings — files: `src/lib/engine/gate-prd.ts`. **As-built:** counts confirmed exactly 19 + 6. `prdRel`/`expectationsRel` are REQUIRED inputs, not defaulted — a default would be the folder spelling, wrong under `project-level` and wrong silently.
- [x] T2.4 Move `gate-coverage.ts` refusal/subject strings onto `subject.rel` — files: `src/lib/engine/gate-coverage.ts`. **As-built:** also `src/lib/engine/gate-evals.ts` (unplanned, in-scope per "2 owns `gate*`") — `donePhasesFor` normalizes both sides of its shipped-phase comparison, and the two committed records take a display label so neither titles itself `# … — . —` under `project-level`.

### 3. Phase: Workstream resolution and the flat-era guard

**Overview**: Makes a hash resolve to the repo root under `project-level`, and
discriminates the one flat-era guard that genuinely misfires. Ships **no new
user-reachable state** — that is what keeps R-2 closed.

**Files**:
- `src/lib/engine/workstream.ts` — one branch in `resolveWorkstream()`
  (`workstreamRel: "."` / `workstreamAbs: repoRoot`); `resolveSpecWorkstream()`
  the same; `planFilenameWorkstreamRel()`'s signature changes to take the whole
  `EngineConfig` and return `"."` under `project-level`; the flat-era refusal
  at `:323-331` gains the layout discriminator **and** a `STAGE_DIRS`-derived
  stage list.
- `src/commands/status.ts`, `src/lib/next/gather.ts` — the remaining
  `planFilenameWorkstreamRel()` call sites (4 total across 3 files).
- `src/lib/doctor/detect.ts` — take `engine.workstreams_root` instead of the
  hardcoded `join(repoRoot, "_devx", "workstreams")`, plus an early return
  under `project-level`. **No layout discriminator on the scan itself**: it
  reads `_devx/workstreams/<slug>/<stage>.md` and never a repo-root file, so
  it cannot misfire.
- `src/lib/doctor/types.ts` — the `layout-tree-mismatch` finding,
  `fixable: false`.
- `evals/E-4_resolve-workstream.ts`, `test/engine-layout-resolve-workstream.test.ts` — new.

**Context**:
- The filename-derived fallback is the part that must not run:
  `planFilenameWorkstreamRel()` turns `plan-b7e38f-…-scene-engine.md` into
  `_devx/workstreams/scene-engine` — a folder path in a repo with no folders.
  Changing the signature beats guarding four call sites, which is the same
  class of bug as the hand-joins.
- **Honest consequence to record, not repair**: `resolveSpecWorkstream()`'s
  membership regex is `(?:^|/)<workstreamsRoot>/([a-z0-9-]+)(?:/|$)`, and
  under `project-level` no path can match it. The `path-in-from-or-plan` arm
  is **dead** under the flat layout and membership degrades to the
  `workstream-frontmatter` and `plan-hash` arms. That is correct: under
  `project-level` there is exactly one workstream.
- **No signature churn at the twelve resolver call sites** — every one threads
  `ctx.engine` as a whole object.
- New refusals live in their command, never inside `resolveWorkstream` —
  `WorkstreamRefusal` is distinguished by exactly one caller
  (`commands/outline.ts`), so a refusal added inside the resolver silently
  becomes exit 2 everywhere.
- Phase 3's `layout-tree-mismatch` advice string names `devx layout migrate`,
  which does not exist until Phase 6 (R-10). Inert text; caught by Phase 7.
- Parallel-safe with Phase 2.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - All **3** frontmatter states (`workstream: .`, absent, and a stale
    `workstream: _devx/workstreams/<slug>` from a partial migration) resolve
    to the repo root under `project-level`; the absent-key case produces `.`
    and never a `<root>/<slug>` string.
  - `createWorkstream` no longer refuses a `project-level` repo that carries a
    root `prd.md`, and still refuses a `workstream`-layout workstream carrying
    a flat-era `<stage>.md`.
  - `devx doctor` reports `layout-tree-mismatch` on a repo whose config and
    tree disagree, and does not offer to fix it.
  - `devx doctor` honors a non-default `engine.workstreams_root`.
  - devx's own `devx doctor` and `devx status` output are unchanged.

**Tasks**:
- [x] T3.1 Author `evals/E-4_resolve-workstream.ts` + companion test RED — files: `_devx/workstreams/docs-layout-resolution/evals/E-4_resolve-workstream.ts`, `test/engine-layout-resolve-workstream.test.ts`
- [x] T3.2 Branch `resolveWorkstream()` and `resolveSpecWorkstream()` on layout — files: `src/lib/engine/workstream.ts`
- [x] T3.3 Re-signature `planFilenameWorkstreamRel()`; update its 4 call sites — files: `src/lib/engine/workstream.ts`, `src/commands/status.ts`, `src/lib/next/gather.ts`
- [x] T3.4 Layout-discriminate the flat-era refusal; derive its stage list from `SUBJECT_STAGES` — files: `src/lib/engine/workstream.ts`
- [x] T3.5 Honor `engine.workstreams_root` in `detectFlatWorkstreams`; early-return under `project-level` — files: `src/lib/doctor/detect.ts`
- [x] T3.6 Add the `layout-tree-mismatch` finding (`fixable: false`) — files: `src/lib/doctor/detect.ts`, `src/lib/doctor/types.ts`

**As-built (dlr103).** Three departures, all narrow, none re-scoping another
phase or contradicting the design:

- T3.4's stage list derives from **`SUBJECT_STAGES`**, not `STAGE_DIRS` as
  written. `SUBJECT_STAGES` *is* `STAGE_DIRS` minus `evals`, so the
  "derived, not inline" property the task asks for holds — but `evals` was a
  DIRECTORY in the flat era too, so a literal `STAGE_DIRS` loop adds an
  `evals.md` probe that would refuse a file the engine has never read and
  print a `git mv evals.md evals/agent.md` recipe for a path that never
  existed. Same substitution in T3.5's scan, which carried the same inline
  triple; its slug iteration is also sorted and `isDirectory`-filtered now, so
  finding order is deterministic.
- T3.3 grew two more resolvers in `workstream.ts`: **`planSpecWorkstreamRel()`**
  and **`workstreamSlugFor()`**. Re-signaturing `planFilenameWorkstreamRel()`
  alone does not close the hole it was meant to close — two of its four call
  sites spell the fallback as `state.workstream ?? planFilenameWorkstreamRel(…)`,
  so a spec that HAS a pointer never reaches the layout-aware helper, and under
  `project-level` that pointer is exactly the stale `<root>/<slug>` a
  half-finished migration leaves behind (measured on a real fixture repo:
  `devx status` built from `main` reports "no active workstreams" for it). The
  `??` and the slug tail therefore moved into the resolvers with the guard.
  Consumers touched beyond the three planned files: `src/commands/todo.ts`
  (its slug titled a scaffolded `todo.md` "`.`"), `src/commands/status.ts:151`
  (rendered `. (<hash>)`), and `src/commands/outline.ts` (`--layout` overrode
  the artifact spelling but not the resolver, so an override ran one command
  under two layouts).
- `detect.ts`'s root-level mismatch probe is additionally gated on the repo
  carrying at least one engine-managed plan spec. `prd.md` / `design.md` /
  `plan.md` are ordinary filenames; without the gate the finding fires on any
  repo that keeps one and has never scaffolded a workstream.

### 4. Phase: Consumer sweep and layout-aware scaffolding

**Overview**: Every remaining consumer moves onto the resolver, and the ten
`*Abs()` helpers become layout-aware wrappers over the map. **Entirely
behavior-preserving under `workstream` layout, and there is no compile
break** — that is the seam this phase is cut on. It also carries **E-3**: the
hand-joins are closed here, so the scan that forbids them must be authored
here, RED against the five live sites, or its negative control has nothing to
control against. Scaffolding lands here
rather than in Phase 3 so that a `project-level` repo cannot be created until
the resolvers behind it are correct (R-2).

**Files**:
- `src/lib/engine/artifacts.ts` — the ten `*Abs()` helpers become layout-aware
  wrappers taking the resolved base (`{ repoRoot, workstreamRel, layout }` —
  what `resolveWorkstream` already returns) instead of a bare `wsAbs`.
- The **21 remaining `*Abs()` call sites** (33 minus the 12 Phase 2 owns) —
  mechanical; every site already has the resolved base in hand.
- `src/lib/engine/todo-truth.ts`, `src/commands/todo.ts`,
  `src/lib/devx/mark-done.ts`, `src/lib/plan/validate-emit.ts`,
  `src/commands/outcome.ts` — the five hand-joins; rename the two locals
  shadowing `todoAbs`.
- `src/lib/graph/backfill.ts` — the **enumeration** at `:312-318`, not the
  `planAbs`/`todoAbs` calls.
- `src/lib/next/gather.ts` (probes at `:927,947,966,972-975`),
  `src/commands/next.ts` (probes at `:282,292-295,305,347` — **7 of the 33
  sites**), `src/lib/engine/next.ts` (**reason strings only**; it has zero
  `*Abs()` calls).
- `src/lib/engine/outcome.ts`, `src/commands/status.ts` — probes.
- `src/lib/engine/render.ts` — the two cosmetic concatenations.
- `src/lib/engine/workstream.ts` — `createWorkstream()`'s three branches:
  doc-set probe, `ArtifactKind`-driven template **destination** list, optional
  slug.
- `src/commands/workstream.ts` — the commander argument becomes `[slug]` and
  the `args.length !== 1` check moves into `runWorkstreamNew` where the
  refusal can name `engine.docs_layout: workstream`. **Without this the E-5
  no-slug cases are unreachable** — commander rejects the invocation first.
- `vitest.shared.ts` — register the new blocking test file in
  `SYNC_BLOCKING_TESTS` (E-5 asserts an exit code from `devx workstream new`,
  which trips the `SYNC_EXEC_MARKER` that `test/vitest-split.test.ts`
  set-equality-checks).
- `evals/E-3_no-hand-joins.ts`, `test/engine-layout-no-hand-joins.test.ts` — new;
  authored as T4.1, ahead of T4.5's closures.
- `evals/E-5_scaffold.ts`, `test/engine-layout-scaffold.test.ts` — new.

**Context**:
- **`project-level` scaffolding refuses its own primary use case today.** The
  no-hash adoption path throws when the workstream directory exists and no
  plan spec claims it; under `project-level` that directory is the repo root,
  which always exists — so UC-1 throws on every invocation. The fix changes
  *what is probed*: not "does the directory exist" but "is a doc set already
  present at this base". Under `workstream` the two questions coincide.
- The one-doc-set predicate is `lay101`'s; a **local** predicate with its
  signature is deleted on adoption (R-8).
- **Only the template *destination* is layout-resolved.** `workstream.ts:350`
  derives the shipped-template source from the same rel
  (`join(repoRoot, TEMPLATES_DIR, ...t.name.split("/"))`), and templates live
  in workstream shape on disk — an `ArtifactKind`-driven rel of `prd.md`
  would look for `_devx/templates/engine/prd.md`, which does not exist, and
  throw `engine template missing`. Same rule the plan already states for
  `commands/todo.ts:94`: **destination resolves through `stageSubject()`,
  source never does.**
- `SCAFFOLD_SUBDIRS` (`decisions`, `checkpoints`, `evals`) land at the repo
  root under `project-level`, per the owner decision of 2026-09-01.
- **`devx next` row selection is the most user-visible breakage in the
  workstream** and is not a hand-join: the probes call `prdAbs(wsAbs)`
  correctly into a layout-blind helper, so under `project-level` every stage
  probe fails and `devx next` reports "PRD not yet authored" forever on a repo
  whose PRD sits at `prd.md`.
- Two message-site classes, kept apart: `gather.ts:900` prints a path that
  **does not exist** under `project-level` (correctness); `render.ts:119,124`
  render existing paths with a stray `./` prefix (cosmetic).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `devx workstream new` with **no slug** under `project-level` creates
    **6 of 6** root artifacts (`prd.md`, `expectations.md`, `todo.md`, and
    empty `decisions/`, `checkpoints/`, `evals/`) and a plan spec whose
    `workstream:` is `.`.
  - With **no slug** under `workstream` it exits **1** with text containing
    `engine.docs_layout: workstream`.
  - **With a slug supplied under `project-level`** (E-5's trigger names four
    combinations; the threshold only pinned two): the slug names the plan
    spec's filename and title, names no directory, and the doc set still
    lands at the root.
  - Under `project-level`: `devx next` selects the correct stage row; `devx
    graph` phase ordering is non-empty; `devx outcome` and `devx status`
    resolve real paths.
  - `evals/E-3_no-hand-joins.ts` scans every module outside `artifacts.ts`
    and finds **0 offending sites**, naming file and line on failure. It
    asserts zero **globally**, not against E-3's stale four-site list.
  - **The scan is negative-controlled, and the control is executable because
    T4.1 precedes T4.5**: it is demonstrated flagging all five real
    hand-joins (`todo-truth.ts:49`, `commands/todo.ts:86`,
    `mark-done.ts:525`, `validate-emit.ts:184`, `outcome.ts:492`) *before*
    they are closed, and demonstrated **not** flagging `backfill.ts:350` or
    the two template-source sites. Without the control an allowlist tuned
    against the stale list can hide a real bypass and still report 0 (R-6).
  - `npm run typecheck` passes with **no constant privatized** — this phase
    introduces no compile break.
  - devx's own `devx next` / `devx graph` / `devx todo sync` /
    `devx workstream new <slug>` output byte-identical to `main`.

**Tasks**:
- [ ] T4.1 Author `evals/E-3_no-hand-joins.ts` + `test/engine-layout-no-hand-joins.test.ts` RED **before any hand-join is closed**, and run the negative control against the five live sites — files: `_devx/workstreams/docs-layout-resolution/evals/E-3_no-hand-joins.ts`, `test/engine-layout-no-hand-joins.test.ts`
- [ ] T4.2 Author `evals/E-5_scaffold.ts` + companion test RED; register it in `SYNC_BLOCKING_TESTS` — files: `_devx/workstreams/docs-layout-resolution/evals/E-5_scaffold.ts`, `test/engine-layout-scaffold.test.ts`, `vitest.shared.ts`
- [ ] T4.3 Re-signature the ten `*Abs()` helpers over `stageSubject()` — files: `src/lib/engine/artifacts.ts`
- [ ] T4.4 Update the 21 remaining `*Abs()` call sites (`commands/gate.ts`'s 12 are Phase 2's) — files: the modules listed above
- [ ] T4.5 Close the five hand-joins; rename the shadowing `todoAbs` locals — files: `src/lib/engine/todo-truth.ts`, `src/commands/todo.ts`, `src/lib/devx/mark-done.ts`, `src/lib/plan/validate-emit.ts`, `src/commands/outcome.ts`
- [ ] T4.6 Layout-resolve `backfill.ts`'s enumeration — files: `src/lib/graph/backfill.ts`
- [ ] T4.7 Route `devx next` probes and reason strings — files: `src/lib/next/gather.ts`, `src/commands/next.ts`, `src/lib/engine/next.ts`
- [ ] T4.8 Move the message sites onto `subject.rel` — files: `src/lib/engine/render.ts`, `src/lib/next/gather.ts`
- [ ] T4.9 `createWorkstream`: doc-set probe, `ArtifactKind` destination list, optional slug — files: `src/lib/engine/workstream.ts`
- [ ] T4.10 Make the commander argument `[slug]`; move the refusal into `runWorkstreamNew` — files: `src/commands/workstream.ts`

### 5. Phase: Identity re-key and privatization

**Overview**: The riskiest phase, and deliberately the smallest surface that
can carry the risk. `CASCADE_TABLE` is re-keyed on `ArtifactKind`, the
`*_REL` constants and `artifactAbs` go module-private, and E-2's orphan floor
becomes satisfiable. This is the only compile-breaking phase, which is exactly
why it is cut from the sweep.

**Files**:
- `src/lib/engine/revise.ts` — re-key `CASCADE_TABLE` on `ArtifactKind`; add
  the `display` projection `KNOWN_ARTIFACTS` derives from; `cascadeFor()`
  compares identities via `pathToArtifactKind()` and gains **no** layout
  parameter; `STAGE_SHORTHAND` maps names onto `ArtifactKind`s.
- `src/commands/revise.ts:94-100,133` — `entry.artifact` feeds a membership
  check (`resolvePath(ws.workstreamAbs, entry.artifact)`), a refusal message,
  and the JSON `touched:` output. All three are layout-blind today.
- `src/lib/engine/todo-truth.ts` — resolve the `TODO_FILENAME` re-export at
  `:37`, which `mark-done.ts:51` and `commands/todo.ts:34` consume.
- `src/commands/plan-helper.ts:61,464`, `src/commands/workstream.ts:19,99` —
  remaining `*_REL` references not covered by any sweep task.
- `test/engine-artifacts.test.ts`, `test/workstream-migration-integrity.test.ts`,
  `test/next-todo-drift.test.ts`, `test/todo-sync.test.ts` — the four test
  files that import the constants (and `artifactAbs`) by name.
- `src/lib/engine/artifacts.ts` — privatize the six stage-shaped `*_REL`
  constants **and `artifactAbs`**; delete the resolvers that remain orphaned
  after Phase 4 gave the map its callers.
- `evals/E-2_single-reader.ts` + `test/engine-layout-single-reader.test.ts` —
  new. (E-3's scan was authored in Phase 4, ahead of the closures it
  controls; this phase only keeps it green.)

**Context**:
- **`STAGE_SHORTHAND`'s obvious fix is wrong**, which is why the shorthand
  guard lives here and not with the other flat-era guard. Swapping the
  shorthand's target to `projectAgentRel(stage)` under `project-level` breaks
  `devx revise` outright: `cascadeFor()` matches `e.artifact === shorthand`
  against a `CASCADE_TABLE` keyed on the `*_REL` constants, so after the swap
  nothing matches, `cascadeFor()` returns `null`, and the command refuses on
  every invocation. Today's byte-identity between `"prd.md"` and the flat
  spelling is load-bearing. The fix is one level up — re-key on a
  layout-independent identity — which is the same change that frees the
  constants to go private. **The two are one change viewed from opposite
  ends**, which is why they are one phase.
- `KNOWN_ARTIFACTS = CASCADE_TABLE.map(e => e.artifact)` is exported and
  joined into user-facing text at `commands/revise.ts`. Re-keying without a
  `display` projection renders it `[object Object]`.
- `cascadeFor()` also tests `e.artifact === last1 || e.artifact === last2` —
  raw path spellings from `--touched`. The reverse lookup must accept **both**
  layouts' spellings, so `--touched design.md` typed against a folder-layout
  repo still resolves (R-4).
- **Privatizing the constants alone is not enough.** `artifactAbs(wsAbs, rel)`
  takes an arbitrary rel and stays compilable otherwise, so
  `artifactAbs(wsAbs, "prd/agent.md")` would remain expressible and a
  `join(...)`-shaped scan would not see it. Its only production consumer is
  `workstream.ts:348`, which Phase 4 already rewrites.
- The residual scan follows the house precedent at
  `test/outline-isolation.test.ts` (allowlist by regex). The residue —
  literal basenames in shipped-template paths and genuinely layout-independent
  message text — is documented as **accepted-fragile**, not claimed sound.
  `commands/todo.ts:94`'s `join(repoRoot, TEMPLATES_DIR, TODO_FILENAME)` and
  `workstream.ts:350`'s template source are **not** bypasses and must not
  route through `stageSubject()`.
- `EVALS_DIR_REL` and `CHECKPOINTS_DIR_REL` stay exported — they are
  layout-identical, and `gate-evals.ts:41,321` depends on the former.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `evals/E-3_no-hand-joins.ts` (authored and turned green in Phase 4)
    **stays** green after privatization — the structural defense must not
    change the scan's verdict, only make a future violation harder to write.
  - `evals/E-2_single-reader.ts` finds **1** layout-key reader and **0**
    orphaned exported resolvers in `artifacts.ts` — satisfiable here, and
    only here, because Phase 4 gave the map its callers (R-9).
  - The six `*_REL` constants and `artifactAbs` are not exported;
    `npm run typecheck` passes — the compile-time proof the re-export chain
    and the four test files were resolved.
  - `devx revise --touched prd`, `--touched prd.md`, `--touched design.md`,
    `--touched plan/agent.md` resolve to the same cascade rows they do on
    `main` under `workstream` layout, and to correct rows under
    `project-level`.
  - `devx revise`'s JSON `touched:` output and refusal text carry readable
    paths, not `[object Object]`.

**Tasks**:
- [ ] T5.1 Author `evals/E-2_single-reader.ts` + companion test RED — files: `_devx/workstreams/docs-layout-resolution/evals/E-2_single-reader.ts`, `test/engine-layout-single-reader.test.ts`
- [ ] T5.2 Re-key `CASCADE_TABLE` on `ArtifactKind`; add `display`; move `cascadeFor()` and `STAGE_SHORTHAND` onto identities — files: `src/lib/engine/revise.ts`
- [ ] T5.3 Update `commands/revise.ts`'s three `entry.artifact` consumers — files: `src/commands/revise.ts`
- [ ] T5.4 Resolve the `TODO_FILENAME` re-export chain — files: `src/lib/engine/todo-truth.ts`, `src/lib/devx/mark-done.ts`, `src/commands/todo.ts`
- [ ] T5.5 Migrate the remaining `*_REL` references — files: `src/commands/plan-helper.ts`, `src/commands/workstream.ts`, `test/engine-artifacts.test.ts`, `test/workstream-migration-integrity.test.ts`, `test/next-todo-drift.test.ts`, `test/todo-sync.test.ts`
- [ ] T5.6 Privatize the six `*_REL` constants and `artifactAbs`; delete the now-orphaned resolvers — files: `src/lib/engine/artifacts.ts`

### 6. Phase: `devx layout migrate`

**Overview**: The migration surface, and the only phase that writes to a
user's repo. A pure planner produces a `MovePlan` the command either renders
(`--dry-run`) or executes — so non-destructive dry-run is a property of the
shape, not of care.

**Files**:
- `src/lib/layout/migrate.ts` — new. `planLayoutMigration(fs, repoRoot,
  engine, target) → MovePlan` (pure), plus the executor and the `Move` /
  `MovePlan` / `Refusal` types.
- `src/commands/layout.ts` — new. Subcommand-bearing command on the `outline`
  / `workstream` house pattern; `register()` runs no logic, `.action()` calls
  a `runX()` returning a number, `attachPhase(sub, N)` last.
- `src/cli.ts` — one entry in the static command array.
- `vitest.shared.ts` — register the new blocking test files (E-6/E-7 drive
  real `git mv` and `git status`, tripping `SYNC_EXEC_MARKER`).
- `MANUAL.md` — the ClassyLights migration item (see success criteria).
- `evals/E-6_migrate.ts`, `evals/E-7_migrate-refusals.ts` and companion tests — new.

**Context**:
- **Execution order is moves → spec frontmatter → config, and the PRD's stated
  rationale for it is backwards.** The PRD says config-last means an
  interrupted run leaves config describing its tree; it does not — it leaves
  config describing the *pre-migration* shape while the tree carries the new
  one. Both orderings mismatch on interruption. Config-last is right for a
  different reason: the clean-tree precondition makes every `git mv`
  revertible with one `git checkout -- .`, and a config write first would
  dirty the tree and destroy exactly that recovery. The mismatch is made
  **detectable** by Phase 3's `layout-tree-mismatch` finding rather than
  assumed away.
- Only the plan spec's `workstream:` field is rewritten. `stage:`,
  `gate_status:` and `gate_verdicts:` live in the spec, not the tree, so
  passed gates survive **by construction** rather than by careful copying.
- Three refusals, computed as a pure predicate over repo state *before* any
  move: ≥2 live workstreams (`stage !== "done" && stage !== "retired"` over a
  `plan/` walk — the plan spec's `stage:`, never a directory listing); a doc
  set already at the destination (the local `lay101`-signature predicate); a
  dirty working tree (porcelain parse with `-uall` and
  `core.quotePath=false` + `dequoteGitPath`, both sides of a rename recorded).
  **No `--force`**: every refusal names a state where moving loses
  information.
- This is the **first `git mv` in the repo**; the three existing occurrences
  are strings in advice text. Moves run through
  `io.exec("git", ["mv", "--", from, to], { cwd: repoRoot })` on the
  synchronous `Exec` seam, checking `exitCode` per call, adopting the `--`
  separator and `git-tx.ts`'s argv-flag-smuggling posture since pathspecs are
  built from disk state.
- Outline files **are** moved. The PreToolUse guard denies *agent* writes; the
  CLI is not an agent, and `devx outline check` sees a rename, not new human
  content. A migration that moved everything except the human's outlines
  would break the tree in the one place the human cares most about.
- The config step is `setLeaf(["engine","docs_layout"], target, "project",
  { projectPath })` — an existing comment-preserving scalar writer.
- Parallel-safe with Phase 7.
- **This phase is not revert-safe for a repo that ran it** (R-5).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - On a fixture reproducing ClassyLights `b7e38f` (`stage: plan`,
    `prd_validated: true`, `design_verified: true`,
    `gate_verdicts: {prd: PASS, design: PASS}`, 8 files on disk): **8 of 8**
    land at their §15-table counterparts with git rename detection intact;
    `gate_status` and `gate_verdicts` diff **empty**; `devx gate coverage
    <hash>` subsequently runs to a verdict on the migrated tree.
  - **3 of 3** refusal conditions exit non-zero with **0 files moved** and
    `git status` byte-identical before and after; `--dry-run` moves **0**
    files in the success case too.
  - Exit codes follow the house convention: 0 success, 1 refusal, 2
    context/config failure. A non-git directory is a refusal, not an
    `fs.rename` fallback.
  - **G-3's evidence is the real run, not the fixture.** A `MANUAL.md` item
    (MV-a494be.1) owns it: on ClassyLights `b7e38f`, commit or stash to clean
    the tree → `devx layout migrate --to project-level --dry-run` and read the
    moves → run it → confirm `gate_status`/`gate_verdicts` diff empty →
    `devx gate coverage b7e38f` runs to a verdict. It is cross-repo and
    irreversible (R-5), so it cannot land inside a devx PR; the phase is not
    done until the item is filed and the run's verdict recorded in
    `decisions/`.

**Tasks**:
- [ ] T6.1 Author `evals/E-6_migrate.ts` + `evals/E-7_migrate-refusals.ts` and companion tests RED; register them in `SYNC_BLOCKING_TESTS` — files: `_devx/workstreams/docs-layout-resolution/evals/`, `test/engine-layout-migrate.test.ts`, `test/engine-layout-migrate-refusals.test.ts`, `vitest.shared.ts`
- [ ] T6.2 `planLayoutMigration()` — pure `MovePlan` over the artifact map — files: `src/lib/layout/migrate.ts`
- [ ] T6.3 The three refusal predicates (local `lay101`-signature doc-set predicate) — files: `src/lib/layout/migrate.ts`
- [ ] T6.4 Executor: `git mv` → spec `workstream:` rewrite → `setLeaf()` config write — files: `src/lib/layout/migrate.ts`
- [ ] T6.5 `devx layout migrate --to <layout> [--dry-run]` + CLI registration — files: `src/commands/layout.ts`, `src/cli.ts`
- [ ] T6.6 File `MANUAL.md` MV-a494be.1 (the ClassyLights run, G-3's evidence) — files: `MANUAL.md`

### 7. Phase: Doc truth

**Overview**: Closes G-4. Both surfaces that describe layout resolution
describe it wrongly today, and a reader consults them *before* choosing a
layout — so this is not cleanup, it is the difference between the feature
being discoverable and being a trap. The claims become test-asserted rather
than prose-reviewed.

**Files**:
- `docs/CONFIG.md` — §15's artifact table restructured to one row per
  `ArtifactKind` (13 rows); §15 gains the `devx layout migrate` invocation as
  the answer to "what does switching cost", a question §15 currently raises
  and leaves hanging. Rule 5 stands as written, now true.
- `_devx/config-schema.json` — the `docs_layout` property description, which
  restates rule 5 verbatim and is the claim a reader hits via editor
  autocomplete. Enum stays `["workstream","project-level"]`; **no schema
  version bump**, the value space is unchanged.
- `dev/dev-<new-hash>-*.md` + `DEV.md` — the follow-up spec for the
  skill-body authoring surfaces (T7.4).
- `evals/E-8_docs-truth.ts`, `test/engine-layout-docs-truth.test.ts` — new.

**Context**:
- **The table is restructured, not merely extended, and the PRD understates
  this.** FR-8 says §15 "gains its two missing rows", implying a 13-row result
  from a 13-row table. The real table today has **12** rows in a different
  shape: design's outline and critique share one row, plan's share another,
  there are no `design-human` / `plan-human` rows, and `RED-report.md` has no
  row at all. The target is one row per `ArtifactKind` — 13 rows in the map's
  own shape, of which `checkpoints/` and `RESULTS.md` are genuinely new and
  several others are splits. Asserting set-equality while describing it as
  "gains two rows" would have shipped a test that cannot pass.
- **The test does not diff prose.** It asserts three checkable properties:
  §15's table has a row for every `ArtifactKind` the resolver handles (table
  parsed, union enumerated, sets must match — so a future artifact kind cannot
  land undocumented); the schema description and rule 5 contain no claim about
  a surface that resolves layout-blind (an allowlist of surfaces that *do*
  resolve through the layout, cross-checked against the resolver's real
  callers); and both documents' enum matches `DOCS_LAYOUTS`. Same "structure,
  not wording" posture as the Reading Guide check.
- **Which half carries the RED**: by the time this phase runs, Phases 2 and 4
  have implemented rule 5, so the *claim-check* assertion already passes. The
  **13-row set-equality is what fails RED**; the claim-check is a standing
  invariant, not a RED-bearing one. Saying so here keeps the RED report's
  recorded reason honest.
- Sequenced after Phase 6 so §15 documents a command that exists (R-10).
- Parallel-safe with Phase 6 in file terms; ordered after it in prose terms.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - The §15 table has a row for **13 of 13** artifact kinds; adding a variant
    to `ArtifactKind` without a §15 row fails the test. **This is the
    RED-bearing assertion.**
  - **0 false claims** — no statement in §15 rule 5 or the schema description
    about a surface that resolves layout-blind.
  - Both documents' layout enum matches `DOCS_LAYOUTS`.
  - `devx graph --check` is green. (The S-1 prose-budget canary measures
    `_devx/templates/engine/**` plus `.claude/commands/devx-plan.md` — neither
    of which this phase edits — so citing it here would be a criterion a
    broken phase satisfies trivially. It is checked in T7.4 instead, where the
    follow-up spec genuinely touches skill prose.)

**Tasks**:
- [ ] T7.1 Author `evals/E-8_docs-truth.ts` + companion test RED — files: `_devx/workstreams/docs-layout-resolution/evals/E-8_docs-truth.ts`, `test/engine-layout-docs-truth.test.ts`
- [ ] T7.2 Restructure §15's artifact table to 13 `ArtifactKind` rows; add the migrate invocation; record `RETRO-<date>.md` as deliberately layout-independent — files: `docs/CONFIG.md`
- [ ] T7.3 Rewrite the `docs_layout` property description — files: `_devx/config-schema.json`
- [ ] T7.4 File the follow-up spec for the nine skill-body path references (`.claude/commands/devx-plan.md`, `.claude/commands/devx.md`), sized against the S-1 prose budget — files: `dev/dev-<new-hash>-*.md`, `DEV.md`
