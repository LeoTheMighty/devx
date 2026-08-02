# Plan — Story Graph

<!-- Stage: Plan. Gate: `devx gate coverage 62bcd1` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. Default to
     more, smaller phases. One phase ≙ one dev spec ≙ one PR ≙ one tour. -->
<!-- refined: critique 2026-08-02 (lenses: pm, architect, dev, qa) -->

## Current state

- The board's dependency graph exists only as scattered durable state:
  backlog rows (`Blocked-by:` prose annotations), spec frontmatter
  (`blocked_by:`), workstream artifacts — with no rendered picture anywhere.
  The only visualizations ever produced were `/devx-plan` chat scrollback,
  now rotted.
- `src/lib/backlog/parse.ts` owns the row grammar but is incomplete for
  this job: `splitHashes` (:427) is private; tokenization misses the
  audited markup shapes (`~~rsh101~~`, `**…**:`, trailing punctuation);
  no parser anywhere reads the `Parallel-safe with` annotation;
  `parseEpicHeadings` (:303) rejects the audited ffm/palateful heading
  variants (`### <slug> (workstream <hash>)`, prose suffixes, `##` depth).
- Frontmatter `blocked_by` values bypass `splitHashes` normalization
  (`src/lib/engine/frontmatter.ts:248-255`); hyphenated `blocked-by:` keys
  (palateful) are silently dropped.
- Only `plan/` is bulk-indexed (`planSpecEntries`,
  `src/lib/engine/workstream.ts:526`); no cross-dir spec index exists.
- Merge-cleanup bookkeeping is skill prose (`.claude/commands/devx.md`
  Phase 8 steps 4–7) — no CLI helper performs the file mutations, so
  FR-4's regen hook has no host on that flow. `devx devx-helper` has
  4 subcommands (claim, await-remote-ci, verify-claim, check-hold);
  `flipDevMdRow` (`src/lib/devx/claim.ts:354`) only handles `[ ]→[/]`.
- friend-finder-mesh and palateful carry the audited encoding drift
  (research/2026-08-02-*): done rows with frontmatter-only edges (ffm);
  prose-only edges, hyphen keys, ~30 phantom-token candidates (palateful).

## Desired state

- `GRAPH.md` at each repo root: committed, generated, deterministic — a
  banner, legend, one GitHub-rendered Mermaid flowchart (subgraphs per
  workstream/epic, status-styled nodes, blocking/parallel/lineage edges,
  done epics collapsed), and a sorted Warnings section.
- `devx graph` CLI: write (atomic) | `--stdout` | `--check` (drift gate) |
  `--format json` (GraphModel contract) | `--epic`/`--workstream` scoping |
  `backfill [--dry-run]`.
- Freshness is structural: claim, RED emission, and merge-cleanup regenerate
  GRAPH.md inside the helper invocation; merge-cleanup gains its
  mechanical host, `devx devx-helper mark-done`.
- The parser family is completed + hardened where the grammar lives
  (`parse.ts`), so every consumer inherits: exported `splitHashes`, markup
  stripping, `parallel_with` rows, tolerant headings.
- The devx repo's durable edge set is backfilled (mechanical pass + attended
  remainder); downstream repos have a verified path (packaged CLI +
  `/devx-init` refresh) and MANUAL.md rows for their attended backfills.

## What we're NOT doing

- Interactive/web visualization, served dashboards, TUI (later phases).
- Cross-repo aggregation — one GRAPH.md per repo.
- Editing state via the graph (render is one-directional).
- Reconciling row↔frontmatter drift **at render time** — the graph warns
  only; backfill's one-time adds-only completion is the sanctioned
  exception (FR-5). The ongoing reconciler is `devx doctor` (dev-db36af).
- Mermaid in review tours (O-1 stays pinned; nothing routes through tour).
- Per-project Mermaid theming knobs; `devx.config.yaml` schema changes.
- NLP of prose-only ordering signals (`Consumes:`, narrative phase
  ordering, ROADMAP critical path) — backfill reports these as
  underivable, never guesses.
- CI wiring of `--check` (deferred, matching `sync:skills --check`).
- Running the ffm/palateful backfills inside this workstream — those are
  attended PRs in their own repos, filed as MANUAL.md rows here.

## Expectation coverage

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 3 | tests-first | `_devx/workstreams/story-graph/evals/E-1_render-deterministic.ts` | full |
| E-2 | P0 | 3 | tests-first | `_devx/workstreams/story-graph/evals/E-2_check-drift.ts` | full |
| E-3 | P0 | 3 | tests-first | `_devx/workstreams/story-graph/evals/E-3_edge-hardening.ts` | full |
| E-4 | P0 | 3 | tests-first | `_devx/workstreams/story-graph/evals/E-4_source-union.ts` | full |
| E-5 | P1 | 5 | tests-first | `_devx/workstreams/story-graph/evals/E-5_loop-freshness.ts` | full |
| E-6 | P0 | 6 | tests-first | `_devx/workstreams/story-graph/evals/E-6_backfill.ts` | full |
| E-7 | P1 | 7 | tests-first | `_devx/workstreams/story-graph/evals/E-7_downstream-portability.ts` | full |

E-1..E-4 assert CLI-level behavior (exit codes, written files), so they go
green at Phase 3; Phases 1–2 advance them (tokenization, model validation)
and carry their own unit-test verification. E-5 exercises all three regen
flows and goes green when the last host lands (Phase 5). All seven evals
are authored RED before any phase executes.

## Phase checklist

- [ ] Phase 1: Parser completion + hardening
- [ ] Phase 2: Graph model
- [ ] Phase 3: Renderer + `devx graph` CLI
- [ ] Phase 4: Regen hooks (claim + emission)
- [ ] Phase 5: `mark-done` helper + Phase-8 rewrite
- [ ] Phase 6: Backfill
- [ ] Phase 7: Downstream portability

Dependencies: 1 → 2 → 3; Phase 4 depends on 3; Phase 5 depends on 4 (E-5
exercises all three hooks); Phases 6 and 7 depend on 3 and are
parallel-safe with 4/5 and each other **modulo shared generated/backlog
surfaces**: GRAPH.md (Phase 6's PR carries a regenerated copy; once Phase
4+5 hooks merge, every claim/cleanup on main rewrites it) and DEV.md/
MANUAL.md rows feed the render. On rebase conflict in GRAPH.md, never
merge by hand — re-run `devx graph`. (Phase 4 vs 5 file split was chosen
so neither touches the other's files; Phase 6 extends
`src/lib/engine/frontmatter.ts`, which 4/5 don't touch.)

Attended steps: Phases 3 (GitHub-render verification) and 6 (backfill
remainder review) contain attended-only steps — their emitted dev specs
carry an "attended-only: loop must `--exclude`" note in the spec body so
`devx loop` never claims them (the harness-fold-in lesson: attended-era
contracts break on first unattended contact).

## Phases

### 1. Phase: Parser completion + hardening

**Overview**: Complete the grammar where it lives so every consumer
(gather, reconcile, scope — and the new graph) inherits it. First because
everything downstream reads through these parsers, and because the
behavior change (recovered edges) needs its own reviewable diff.

**Files**:
- `src/lib/backlog/parse.ts` — export `splitHashes` (:427); harden its
  tokenization (strip `~~`, `**`, trailing punctuation before matching);
  new `PARALLEL_TEXT_RE` (symmetric with `BLOCKED_BY_TEXT_RE` :134) +
  optional `DevRow.parallel_with?: string[]`; heading tolerance in
  `parseEpicHeadings` (:303) + `epicSectionFor` (optional `Epic — `
  prefix, `##`/`###` depth, `(workstream <hash>)` alongside
  `(plan: <hash>)`, prose suffixes after the paren group).
- `test/backlog-parse.test.ts`, `test/backlog-parse-epic.test.ts` — unit
  coverage for every audited shape (palateful markup rows, ffm headings).

**Context**:
- Hardened tokenization intentionally changes existing consumers — edges
  that today fail to parse start resolving, which can newly flip
  blocked/unblocked verdicts in `devx next`/reconcile/scope (design
  Migration §1: "the encoding becoming truthful").
- Optional-field back-compat precedent: mlc106's `epicSlug`.
- No graph code in this phase — pure parser PR.

**Verification plan**:
- Type: tests-after
- Success criteria:
  - New unit tests covering markup-wrapped hashes, spec-path blockers,
    trailing punctuation, `Parallel-safe with` rows, and both audited
    heading variants pass.
  - Full suite + typecheck green (existing consumer tests updated only
    where recovered edges are the correct new truth).
  - Live-repo sanity via a scratchpad tsx script (there is no CLI surface
    for all-row verdicts — `devx next` emits a single decision and has no
    `--format` flag): drive `parseDevMd` + gather-side blocker resolution
    over all backlog rows before and after the parser change, diff the
    per-row blocked verdicts, and explain every flip by a recovered edge.
    The script is throwaway (scratchpad, not committed); paste the diff
    into the PR body.

**Tasks**:
- [ ] T1.1 Export + harden `splitHashes` (markup/punctuation stripping) — files: `src/lib/backlog/parse.ts`
- [ ] T1.2 `PARALLEL_TEXT_RE` + `parallel_with` row field — files: `src/lib/backlog/parse.ts`
- [ ] T1.3 Heading tolerance in `parseEpicHeadings`/`epicSectionFor` — files: `src/lib/backlog/parse.ts`
- [ ] T1.4 Unit tests for all audited shapes — files: `test/backlog-parse.test.ts`, `test/backlog-parse-epic.test.ts`
- [ ] T1.5 Live-repo before/after verdict diff via scratchpad script; explain every flip in the PR body

### 2. Phase: Graph model

**Overview**: The one genuinely new read-model — `buildGraphModel()`
assembling nodes/edges/groups/warnings from the hardened parsers. Pure
library, no CLI yet; second because the renderer and every hook consume it.

**Files**:
- `src/lib/graph/model.ts` (new) — spec index (`SPEC_TYPE_DIRS`
  (`frontmatter.ts:428`) × readdir × `readEngineState`, plus a YAML-aware
  read for the keys `readEngineState` doesn't carry — `from:`, `spawned:`,
  `title:`, hyphen `blocked-by:` — using the same `parseDocument` approach
  `readEngineState` uses internally; NOT `parseFrontmatterValue`, which is
  a single-line scalar reader and cannot see `spawned:` block-lists or
  inline arrays); nodes with `effectiveStatus` precedence (`gather.ts:191`
  semantics); blocking-edge union (row + frontmatter, both through
  `splitHashes`), validated against the known-hash set (unknowns dropped +
  warned); drift warnings where sources disagree; parallel + lineage
  edges; groups via hardened `parseEpicHeadings` +
  `resolveSpecWorkstream` (`workstream.ts:565`); all-settled groups
  collapse to summary nodes; INTERVIEW/MANUAL badges via
  `parseInterviewMd` (:490) / `parseManualMd` (:541) reverse `Blocks:`
  edges; DFS cycle check over blocking edges only →
  `{ok:false, cycle:[...]}`.
- `test/graph-model.test.ts` (new) — fixture-repo unit coverage.

**Context**:
- All I/O behind the `EngineFs`-style seam (testable without disk).
- Backlog rows: compose `parseDevMd` directly over the four backlog files
  (DEV/PLAN/TEST/DEBUG). `readBacklogRows` (`gather.ts:452`) is private
  and reads only three of the four — the ~10-line loop is re-composed
  here deliberately, not exported (TEST.md indexing is new).
- Deliberate narrowing (recorded): todo.md pointers are NOT read at
  model-build time — backfill (Phase 6) materializes pointer-derived
  edges into frontmatter, after which render needs no todo reads. FR-1's
  workstream-artifact surface is covered via `resolveSpecWorkstream`.
- The graph is a map, not a dispatcher: renders the validated edge union +
  `effectiveStatus`; re-implements no resolver's "runnable" verdict.
- GraphModel interface shape is pinned in design.md § Data.
- `readEngineState` stays underscore-only; hyphen keys are read here.

**Verification plan**:
- Type: tests-after
- Success criteria:
  - Unit tests cover: union + dedup + per-source tagging; phantom-token
    drop with source-naming warning; drift warning on disagreeing spec;
    hyphen-key normalization warning; `heading-fallback` warning; group
    membership via both heading variants and the `from:` bridge;
    `spawned:` both value forms; collapse rule; badge attachment; cycle
    error enumerating every member; self-block cycle.
  - Full suite + typecheck green.

**Tasks**:
- [ ] T2.1 Cross-dir spec index (YAML-aware key reads) — files: `src/lib/graph/model.ts`
- [ ] T2.2 Nodes + effectiveStatus + struck exclusion
- [ ] T2.3 Blocking-edge union + known-hash validation + drift warnings
- [ ] T2.4 Parallel + lineage edges (`spawned:` bare-hash and block-list forms)
- [ ] T2.5 Groups, collapse rule, badges
- [ ] T2.6 Cycle check (DFS, blocking edges only)
- [ ] T2.7 Fixture unit tests incl. all four warning codes — files: `test/graph-model.test.ts`

### 3. Phase: Renderer + `devx graph` CLI

**Overview**: The user-visible surface — deterministic Mermaid renderer +
thin CLI — and the phase where all four P0 render/check/hardening evals go
green. Ends with the live-repo run and the initial GRAPH.md commit.
Emitted dev spec is **attended-only** (GitHub-render verification).

**Files**:
- `src/lib/graph/render.ts` (new) — `renderStoryGraph(model): string`;
  sorted everything (nodes by hash within groups, groups by kind then id,
  edges by from/to/kind); banner + legend + one fenced mermaid flowchart +
  sorted Warnings section; no timestamps; labels escaped + truncated.
- `src/commands/graph.ts` (new) — `CommandModule`; `runGraph(opts)` with
  the `status.ts` seam shape; default atomic write via `writeAtomic`
  (`supervisor-internal.ts:85`); `--stdout`; `--format mermaid|json`
  (payload on stdout, warnings on stderr — the `devx merge-gate --json`
  precedent, `src/commands/merge-gate.ts:347`); `--check` byte-compare
  (`diffMirror` idiom, `scripts/sync-skills.mjs`); `--epic`/`--workstream`
  scope flags (`devx loop` vocabulary; written file is always the full
  board); exit codes 0/1/2; root via `resolveRepoRoot()`
  (`repo-root.ts:121`), never the cwd config-walk.
- `src/cli.ts` — register `graphCommand` (import + array entry) with a
  deliberate `attachPhase(...)` help-phase slot (`src/lib/help.ts:24`).
- `test/help.test.ts` — `expectedOrder` entry + full `devx --help` inline
  snapshot refresh (it pins the command list; registration breaks it).
- `GRAPH.md` (new, generated) — initial render commits with this phase.
- `test/graph-render.test.ts`, `test/graph-cli.test.ts` (new).

**Context**:
- Worktree-safety is load-bearing: a regen inside `.worktrees/dev-<hash>/`
  must write the main checkout's GRAPH.md (design § CLI) — tested, not
  just stated (see criteria; fixture precedent
  `_devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts`).
- E-1's eval binds **fixture** assertions durably; its live-repo leg spawns
  the built CLI (`dist/cli.js`, failing loudly with "run `npm run build`
  first" when missing — the retro-listener E-7 precedent; stale-dist is a
  known false-red source) in `--stdout` mode (no write), asserting < 2s,
  0 phantom nodes, and byte-identical double-render — all
  state-independent. The GitHub-rendering check (Mermaid renders, glyphs
  distinct) stays attended in T3.6.
- Mermaid glyphs for parallel/lineage settled here against real GitHub
  rendering (design unresolved Q1); E-1's fixture pins the choice.
- Interregnum note (accepted transient drift): between this phase's merge
  and Phase 5's, after-merge bookkeeping is still prose-only, so GRAPH.md
  goes stale on every claim/cleanup. Mitigation: this phase's Phase-8
  after-merge commits manually run `devx graph` and include GRAPH.md in
  the pathspec; residual drift is accepted (`--check` is not CI-wired).
- If the live board exceeds GitHub's Mermaid ceiling, scope flags are the
  designed fallback (unresolved Q2 — measured here).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-1, E-2, E-3, E-4 evals re-run RED first (fail for the stated
    missing-feature reason), then go green: all structural assertions,
    byte-identical second run, 3/3 `--check` exit phases, 0 phantoms,
    full edge recovery from both dialect fixtures, live-leg thresholds.
  - Unit tests green, including the named cases: `--format json` output
    parses as pure JSON matching the GraphModel interface with warnings
    only on stderr; exit 2 on config-load/resolution failure (run outside
    any repo); scoped output contains only the scope's nodes while the
    written GRAPH.md remains the full board; `devx graph` invoked from a
    linked-worktree cwd writes the MAIN checkout's GRAPH.md.
  - Attended: rendered GRAPH.md verified on GitHub in the PR itself.

**Tasks**:
- [ ] T3.1 `renderStoryGraph` — files: `src/lib/graph/render.ts`
- [ ] T3.2 CLI + registration + help pins — files: `src/commands/graph.ts`, `src/cli.ts`, `test/help.test.ts`
- [ ] T3.3 `--check` drift gate
- [ ] T3.4 `--epic`/`--workstream` scoping
- [ ] T3.5 Drive E-1..E-4 from RED to green (fixture + built-CLI live leg)
- [ ] T3.6 Live-repo run; commit initial `GRAPH.md`; verify GitHub rendering in the PR (attended)
- [ ] T3.7 Renderer/CLI unit tests incl. json-contract, exit-2, scoping, worktree-cwd cases — files: `test/graph-render.test.ts`, `test/graph-cli.test.ts`

### 4. Phase: Regen hooks (claim + emission)

**Overview**: Make freshness structural on the two flows that already have
CLI hosts: claim and RED emission. Split from the `mark-done` phase so
each lands as one reviewable PR (both touch delicate transactional code).

**Files**:
- `src/lib/graph/regen.ts` (new) — `regenerateGraph(fs, repoRoot, engine)`
  → `{ok:true,path} | {ok:false,warning}`; never throws.
- `src/lib/devx/claim.ts` — regen runs AFTER the rename batch completes
  (the renamePlan (:836) is composed from in-memory strings, so a
  disk-reading regen before it would render pre-flip state; the comment
  at :847-849 anticipates exactly this slot). GRAPH.md gets its own
  `writeAtomic`; `revertWorkingTree` (:873) gains a restore-**or-unlink**
  branch (GRAPH.md may not pre-exist on first claim); the claim commit's
  explicit pathspec (:901-923) gains GRAPH.md.
- `src/lib/plan/emit-retro-story.ts` — regen after
  `writeRetroAtomically`'s rename plan (:318) completes; own tmp+rename.
- `src/commands/plan-helper.ts` — `runEmitRetroStory`'s stdout is a
  greppable key=value line (`spec=… dev_md=…`, :287-305), NOT JSON: add a
  `graph=<path>` key to that line (present only when regen succeeded).
- `.claude/commands/devx-plan.md` — RED-stage commit pathspec consumes the
  `graph=` key; `skills/devx-plan.md` via `npm run sync:skills`.
- Existing claim/emission tests updated; new regen cases (below).

**Context**:
- Failure posture: regen inside any hook is warn-and-continue — a broken
  render never aborts a state flip; `--check` catches the miss (E-2).
  This is tested per hook, not assumed.
- Prose-bearing diff: batch skill-body edits before starting the gate
  (Phase 5 discipline in `.claude/commands/devx.md`).

**Verification plan**:
- Type: tests-after
- Success criteria:
  - Claim-hook tests: happy path leaves `--check` green and GRAPH.md in
    the claim commit; regen failure warns and the claim still succeeds;
    a post-regen claim-step failure rolls back to the prior GRAPH.md
    (restore) and a first-claim failure unlinks it (no orphan file).
  - Emission-hook tests: regen failure warns and emission succeeds;
    `graph=` key present exactly when regen succeeded.
  - `npm run sync:skills -- --check` green; full suite + typecheck green.
  - (E-5 stays RED — it needs all three hooks; goes green in Phase 5.)

**Tasks**:
- [ ] T4.1 `regenerateGraph` composition — files: `src/lib/graph/regen.ts`
- [ ] T4.2 Claim hook: post-rename regen + restore-or-unlink rollback + pathspec — files: `src/lib/devx/claim.ts`
- [ ] T4.3 Emission hook + `graph=` stdout key — files: `src/lib/plan/emit-retro-story.ts`, `src/commands/plan-helper.ts`
- [ ] T4.4 RED-stage prose consumes `graph=` + sync mirror — files: `.claude/commands/devx-plan.md`, `skills/devx-plan.md`
- [ ] T4.5 Regen-failure + rollback-restore test cases for both hooks

### 5. Phase: `mark-done` helper + Phase-8 rewrite

**Overview**: Merge-cleanup's first mechanical host (FR-4's third flow):
`devx devx-helper mark-done`, plus the Phase-8 skill-prose rewrite that
invokes it. E-5 goes green here. Closes the `git add -A` cleanup-commit
class structurally.

**Files**:
- `src/lib/devx/mark-done.ts` (new) — the fat lib (thin-command/fat-lib
  repo pattern, mirroring claim): under `withBacklogLock`
  (`mutate.ts:82`), spec `status: done` flip + status-log append; DEV.md
  `[/]→[x]` flip + PR URL append (extend `flipDevMdRow` (`claim.ts:354`)
  or a sibling helper — today it only does `[ ]→[/]` and throws
  otherwise); in-process todo sync via `runTodoSync`
  (`src/commands/todo.ts:55`) when the item has a workstream; GRAPH.md
  regen via `regenerateGraph` (warn-and-continue).
- `src/commands/devx-helper.ts` — `mark-done <hash> --pr <n> --merge-sha
  <sha>` (fifth subcommand; registration pattern at :645); stdout JSON
  `{hash, paths, todoSynced}`; exit 0/1 (state mismatch)/2 (resolution).
- `.claude/commands/devx.md` — Phase 8 after-merge steps 4–7 rewritten to
  invoke `mark-done` + commit its `paths` by explicit pathspec;
  `skills/devx.md` via `npm run sync:skills`.
- `test/devx-helper-mark-done.test.ts` (new); skill-discipline tests
  updated where the Phase-8 contract grew.

**Context**:
- Severability (recorded cut line): FR-4's minimum is regen having a
  mechanical host on the cleanup flow; the bookkeeping mechanization
  (spec/DEV.md/todo mutations) is justified by the `git add -A` incident
  class (design § Regen hooks) and is severable if this phase runs long.
- `mark-done` is write-only in v1: the skill keeps owning commit + push
  (symmetric with owning the merge). Revisit is a recorded non-blocking
  question in design.md.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-5 eval re-run RED first, then green: claim, cleanup (`mark-done`),
    and emission each leave `devx graph --check` exiting 0 with no manual
    regen between.
  - `mark-done` unit tests: happy path, state-mismatch exit 1, lock
    contention, workstream-less skip of todo sync, regen-failure
    warn-and-continue.
  - `npm run sync:skills -- --check` green; full suite + typecheck green.

**Tasks**:
- [ ] T5.1 `mark-done` lib incl. `[/]→[x]` flip helper — files: `src/lib/devx/mark-done.ts`, `src/lib/devx/claim.ts` (or sibling)
- [ ] T5.2 Subcommand + JSON + exit codes — files: `src/commands/devx-helper.ts`
- [ ] T5.3 Phase-8 prose rewrite + `sync:skills` — files: `.claude/commands/devx.md`, `skills/devx.md`
- [ ] T5.4 Drive E-5 RED → green; unit tests — files: `test/devx-helper-mark-done.test.ts`

### 6. Phase: Backfill

**Overview**: Complete the durable edge set mechanically (FR-5): the
adds-only, idempotent `devx graph backfill` plus the attended devx-repo
run in the same PR. Emitted dev spec is **attended-only** (remainder
review).

**Files**:
- `src/lib/graph/backfill.ts` (new) — pass 1: per spec, union of row +
  frontmatter edges minus what each side has; write the missing side —
  frontmatter in canonical `blocked_by` underscore form (normalizing
  hyphen keys), row-side only onto live `Blocked-by:`-bearing rows (ffm
  done rows get frontmatter only); derived edges only from durable state
  (`phase:` ordering within a workstream, plan.md `(dev spec: <hash>)`
  pointers, todo.md pointers via `parseTodo()` → `TodoItem.pointer`
  (`src/lib/engine/todo.ts:34-48`; `POINTER_RE` itself is private));
  workstream discovery via `resolveSpecWorkstream` (works without PLAN.md
  rows or plan.md); pass 2: underivable-spec report, never guessed. All
  writes `writeAtomic`; never deletes an edge.
- `src/lib/engine/frontmatter.ts` — extend `EnginePatch`/
  `applyEnginePatch` (:107-121) with a `blocked_by` field (today it
  carries stage/gates/outcome/lineage keys only) so canonical-form writes
  reuse the engine's splice rather than a parallel writer.
- `src/commands/graph.ts` — `backfill` subcommand + `--dry-run`.
- `test/graph-backfill.test.ts` (new).
- `GRAPH.md` + devx-repo state files (specs + backlogs) — the attended
  backfill run's output, reviewed in this phase's PR alongside the code.

**Context**:
- D-9 spirit: the CLI never guesses; the pass-2 report is the input for
  the attended remainder, resolved by the human in the same PR.
- Idempotency is the review contract: second run = 0 file writes.
- Tolerates non-directory files in the workstreams root and plan-less
  workstream dirs (E-6 trigger shapes).
- This is the FR-5 exception to the render-time warn-only fence (see
  NOT-doing).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-6 eval re-run RED first, then green: exact mechanical union written,
    ≥1 underivable reported, 0 deletions, second run 0 files, exit 0 on
    drifted fixtures; `--dry-run` writes 0 files while still printing the
    pass-2 report.
  - Devx-repo run: pass-1 diff reviewed edge-by-edge; second run is a
    no-op; `devx graph --check` green after; attended remainder resolved
    or explicitly deferred in the PR body.

**Tasks**:
- [ ] T6.1 Mechanical completion pass — files: `src/lib/graph/backfill.ts`
- [ ] T6.2 `EnginePatch.blocked_by` extension — files: `src/lib/engine/frontmatter.ts`
- [ ] T6.3 Durable-state derived edges (`phase:`, plan pointers, `parseTodo` pointers)
- [ ] T6.4 Underivable report (pass 2)
- [ ] T6.5 CLI wiring + `--dry-run` — files: `src/commands/graph.ts`
- [ ] T6.6 Drive E-6 RED → green incl. dry-run case — files: `test/graph-backfill.test.ts`
- [ ] T6.7 Attended devx-repo backfill in this PR (run, review, resolve remainder)

### 7. Phase: Downstream portability

**Overview**: Prove the packaged CLI works in downstream-shaped repos
(FR-6) and file the human path for ffm/palateful. Pure verification +
distribution tail — no new product features.

**Files**:
- `_devx/workstreams/story-graph/evals/E-7_downstream-portability.ts` —
  driven green: build + pack (`npm run build` / `npm pack`), run the
  packaged CLI in a downstream-shaped fixture (ffm/palateful layout incl.
  audited drift), assert GRAPH.md lands at the fixture root. The "0 reads
  outside the fixture root" threshold gets a real mechanism: the eval
  spawns the packaged CLI with a `NODE_OPTIONS --require` fs-audit
  preload that records every path opened by the process (works against
  plain-node `dist`, no CLI feature needed — Phase 7 stays no-new-features)
  and asserts every recorded path is inside the fixture root (node
  internals excluded).
- Portability fixes wherever the eval surfaces them (expected: none;
  `resolveRepoRoot` + config-defaulting already carry this).
- `MANUAL.md` — rows for the user, dated against G-2's 2026-08-23 target,
  each ending in a committed GRAPH.md: (1) `npm run install:global`;
  (2) re-run `/devx-init` in ffm + palateful to refresh skill bodies
  (rtl105 mechanism); (3) per repo: attended `devx graph backfill` PR,
  then `devx graph` + commit GRAPH.md in that same PR (backfill writes
  edges, not GRAPH.md — the render step is explicit).

**Context**:
- No new distribution channel — package `files:` list + `/devx-init`
  refresh is the whole mechanism (design Migration §4).
- Downstream backfill runs themselves are out of scope (NOT-doing fence);
  only the MANUAL.md handoff lands here.
- G-3 measurement (recorded so the outcome has a procedure): at
  workstream close, arm via `devx outcome arm 62bcd1` (default +4w);
  scoring re-runs `devx graph --check` at each merge commit in the
  window (`git log --merges --since` → checkout → `--check`), sourced in
  RESULTS.md per the outcome contract.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-7 eval re-run RED first, then green: GRAPH.md produced in the
    downstream fixture; every fs-audit-recorded path is inside the
    fixture root.
  - MANUAL.md rows filed with concrete commands incl. the render+commit
    step and the G-2 date.

**Tasks**:
- [ ] T7.1 Pack-and-run fixture harness + fs-audit preload inside the E-7 eval
- [ ] T7.2 Drive E-7 RED → green; fix any surfaced portability gaps
- [ ] T7.3 File MANUAL.md rows (global update + `/devx-init` refresh + per-repo backfill + render/commit, dated for G-2)
