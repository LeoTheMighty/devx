# Design — Story Graph

<!-- Stage: Design. Gate: `devx gate coverage 62bcd1` (design mode — one
     tri-state row per G-/UC-/CAP-/FR- ID in prd.md). Hard rule: don't plan
     here. No phases, no tasks — design is the approach, not the sequence. -->

## Overview

- **Objective**: Render the dependency graph that already lives in repo
  state (backlog rows, spec frontmatter, workstream artifacts) as a
  committed, auto-fresh GRAPH.md per repo — replacing the lossy, rotting
  `/devx-plan` chat scrollback as the only picture of the board — and
  complete/harden the durable edge encoding so the render is truthful in
  all three repos (devx, friend-finder-mesh, palateful).
- **Solution**: One new read-model module (`buildGraphModel`) that wraps
  the existing parsers and unions the two edge sources; one pure renderer
  (`renderStoryGraph(model) → string`) emitting deterministic Mermaid; a
  thin `devx graph` CLI on top (write | `--stdout` | `--check` | `--format
  json` | `backfill`); regen calls added inside the three state-flipping
  CLI helpers so freshness is structural; a mechanical-first `backfill`
  subcommand that completes the durable edge set per repo. This is the
  established pure-fn + CLI-passthrough shape (LEARN.md cross-epic
  pattern); zero AI, zero network at render time.

## Constraints

- **Zero AI tokens, zero network at render time** (G-1); < 2s on the full
  devx board (~100+ specs). Everything is local file reads + pure functions.
- **GitHub-rendered Mermaid is the whole UI** (PRD non-goal): one fenced
  ```mermaid``` flowchart per GRAPH.md; must stay within GitHub's Mermaid
  support (flowchart subgraphs, classDef styling, solid/dashed/dotted
  links). No served dashboard, no images.
- **Wrap-don't-duplicate**: the model is assembled from
  `parseDevMd`/`parseEpicHeadings`/frontmatter reads; no second row
  grammar, no new dependency field (PRD non-goal).
- **O-1 stays pinned**: nothing routes through `devx tour`'s renderer or
  schema; three tour tests negatively pin `trails[].mermaid`
  (`test/tour-model.test.ts` + tour schema tests). GRAPH.md is its own
  surface.
- **Determinism**: unchanged state ⇒ byte-identical GRAPH.md (E-1). No
  timestamps in the body; sorted ordering everywhere.
- **Portability**: must run via the shipped package in repos with the
  audited drift (ffm, palateful) — missing fields degrade with warnings,
  never crash (E-4, E-7).
- **Single-writer discipline**: GRAPH.md is generated output; tmp+rename
  atomic write (mgr102 cross-epic pattern); never hand-edited.

## Risks

- **Phantom nodes/edges from prose tokenization** (the mgr103 class;
  palateful makes ~30 today) → validate every candidate edge against the
  known-hash set, drop + warn unknowns; strip markup before tokenizing →
  proven by E-3.
- **Per-repo edge-source blindness** (ffm: frontmatter-only on done rows;
  palateful: prose-only + hyphen key) → union both sources, deduped;
  hyphen-key normalization; drift warning where sources disagree → proven
  by E-4.
- **Staleness returns via untouched flows** (a status flip that skips
  regen) → regen lives inside the CLI helpers the flows already call, plus
  `--check` as a drift gate anyone can wire into CI → proven by E-2 + E-5.
- **Fixture-blindness: the live repo carries poison fixtures don't**
  (LEARN cross-epic; founding exemplar was this parser family) → E-1's
  threshold includes a first real run against the live devx repo via the
  installed CLI before merge → proven by E-1.
- **Mermaid scale/legibility on a 100+-node board** → done epics collapse
  to summary nodes (cuts most of the node count); per-workstream subgraphs
  keep clusters local; if a rendered file still exceeds GitHub's Mermaid
  limits, `--epic`/`--workstream` scoping exists from day one → proven by
  E-1 (live-repo run).
- **Backfill corrupting hand-authored state** → adds-only invariant (never
  deletes an edge), canonical-form writes, idempotency (second run = 0
  files), underivable specs reported not guessed → proven by E-6.

## Trade-offs

- **Committed artifact over on-demand render**: chose a committed GRAPH.md
  (reviewable, diffable, visible on GitHub, zero-tooling consumption) over
  rendering on demand only — accepting the freshness burden, which FR-4
  moves into the helpers so no human carries it. Precedent:
  `skills/*.md` via `sync:skills -- --check` (pin101).
- **Union + warn over reconcile**: chose to union divergent edge sources
  and surface drift as warnings over fixing drift in place — one
  reconciler already has a filed home (`devx doctor`, dev-db36af); two
  writers racing on the same state is the bug class devx exists to avoid.
- **One flowchart over per-workstream files**: a single GRAPH.md with
  subgraphs keeps cross-workstream/cross-type edges renderable (FR-2h) and
  gives one place to look; accepted cost is a big file on big boards,
  mitigated by done-epic collapse.
- **Mechanical backfill + attended remainder over AI backfill**: pass 1 is
  a deterministic CLI (auditable, idempotent, safe to re-run); the
  irreducible remainder is a *report* consumed by an attended session —
  the CLI never guesses (D-9 spirit: verdicts from evidence, not vibes).
- **Warnings to stderr, model to stdout**: keeps `--format json` pipeable
  (the `devx next` convention: JSON on stdout, human noise on stderr).

## Out of scope

- Interactive/web visualization; served dashboards (TUI/web phases own it).
- Cross-repo aggregation (one GRAPH.md per repo).
- Editing state via the graph (one-directional render).
- Reconciling row↔frontmatter drift (warn only; `devx doctor` dev-db36af).
- Mermaid in review tours (O-1 stays open).
- Per-project Mermaid theming knobs.
- Parsing prose-only ordering signals (`Consumes:`, "Depends on phase 1"
  narrative, ROADMAP critical path) — backfill reports these as
  underivable; it does not NLP them.

## Assumptions

- The four backlogs + spec dirs + `_devx/workstreams/` remain the complete
  durable state surface (no external tracker arrives — D-10).
- GitHub's Mermaid rendering continues to support `flowchart` with
  subgraphs, classDefs, and the three link styles used here. (If a limit
  bites on board scale, scope flags are the fallback.)
- `blocked_by` underscore form is the canonical frontmatter key (hyphen is
  read-tolerated, written never).
- Downstream repos run the devx layout (backlogs at root, specs in typed
  dirs, `devx.config.yaml` present-or-defaulted) — same assumption every
  other `devx` command already makes.
- Loop workers never write GRAPH.md directly; only helpers do (keeps the
  iteration contract's "never commit" rule intact — regen rides existing
  helper commits).

## Discarded considerations

- **New `depends_on:` frontmatter field** — approved at PRD interview,
  superseded same day by research: `Blocked-by:`/`blocked_by` already IS
  the durable machine-parsed encoding; a third copy violates
  wrap-don't-duplicate and doubles the drift surface.
- **Rendering via `devx tour`** — O-1 is negatively pinned by three tour
  tests; tours are per-PR artifacts on an orphan branch, the graph is
  repo-root state; different lifecycles.
- **GRAPH.md as gitignored cache** — loses the GitHub-rendered UI (UC-1),
  the review diff, and the `--check` drift contract; committed-generated
  is the established idiom (`skills/` sync).
- **Graphviz/DOT or SVG output** — needs a toolchain or a build step;
  Mermaid renders natively on GitHub with zero dependencies.
- **A `devx graph watch` daemon** — freshness via hooks in the flows that
  mutate state is strictly simpler and matches the no-daemon posture of
  the CLI (the loop is the only long-running process).
- **Hooking regen via git pre-commit** — hooks don't ship with the repo
  reliably, don't run in worktrees consistently, and would fire on
  non-state commits; helper-internal regen is targeted and testable.

## Wrap, don't duplicate

- **Reuses**:
  - `src/lib/backlog/parse.ts` — `parseDevMd` (rows: hash/status/
    blocked_by/struck), `parseEpicHeadings`, `epicSlugify`,
    `splitHashes`, `blankFencedLines` — the entire row/heading grammar.
  - `src/lib/engine/frontmatter.ts` — spec frontmatter reads
    (`blocked_by` at :248, `plan:`, `phase:`, `from:`, `spawned:`).
  - `src/lib/engine/todo.ts` — `POINTER_RE`/`DERIVED_LINE_RE` for the
    workstream phase→hash join.
  - `parseInterviewMd`/`parseManualMd` — reverse `Blocks:` edges for
    FR-2g badges.
  - `writeAtomic()` (`src/lib/supervisor-internal.ts:85`) — the mgr102
    tmp+rename pattern — for GRAPH.md.
  - `resolveRepoRoot()` (`src/lib/repo-root.ts:121`) — worktree-safe
    canonical root, same reason `devx loop`/claim use it.
  - `resolveSpecWorkstream()` (`src/lib/engine/workstream.ts:565`) — the
    `from:`/`plan:` → workstream bridge (three-arm chain), exactly what
    backfill discovery needs (works without PLAN.md rows or plan.md).
  - CLI registration pattern + `--epic`/`--workstream` scope vocabulary
    (`devx loop`), stdout/stderr split (`devx next`), `--check` idiom
    (`scripts/sync-skills.mjs`).
  - Existing flow helpers as regen hosts: `devx-helper claim`,
    the merge-cleanup path, `plan-helper` emission.
- **Adds** (genuinely new):
  - `src/lib/graph/model.ts` — `buildGraphModel()`: assemble + union +
    validate nodes/edges/groups (the one new read-model).
  - `src/lib/graph/render.ts` — `renderStoryGraph(model)`: pure
    deterministic Mermaid/markdown emitter.
  - `src/lib/graph/backfill.ts` — mechanical edge completion + report.
  - `src/commands/graph.ts` — thin CLI (graph | --check | --stdout |
    --format | backfill).
  - Parallel-safe annotation parser (new regex, symmetric with
    `BLOCKED_BY_TEXT_RE`) landing in `src/lib/backlog/parse.ts`, plus
    hardened blocker tokenization and heading tolerance in the same file.
  - A cross-dir spec index (`SPEC_TYPE_DIRS` × readdir ×
    `readEngineState`) — today only `plan/` is bulk-indexed
    (`planSpecEntries`, `src/lib/engine/workstream.ts:520`); the graph
    needs all typed dirs. Lives in `src/lib/graph/model.ts`.
  - `devx devx-helper mark-done <hash>` — a fifth devx-helper subcommand
    making merge-cleanup's file mutations mechanical (today they are skill
    prose only; see Architecture § Regen hooks). Hosts the cleanup-side
    GRAPH.md regen per FR-4.

## Design

### Architecture

Five components, composed as the established gather → pure-model → pure-render
pipeline (the `devx next` gather/decide split, `src/lib/next/gather.ts` +
`decide.ts`, is the in-repo precedent):

**1. Parser completion + hardening (extends `src/lib/backlog/parse.ts`).**
All grammar changes land where the grammar lives; every existing consumer
(gather, reconcile, scope) inherits them.

- Export the currently-private `splitHashes` (`parse.ts:427`) — it already
  normalizes spec-path forms (`dev/dev-mgr101-….md` → `mgr101`), backticks,
  and case; it is the only hash normalizer and the graph must not fork it.
- Harden `splitHashes` tokenization: strip `~~`, `**`, and trailing
  punctuation from candidate tokens before matching (the audited palateful
  shapes: `~~rsh101~~`, `debug-rshred1**:`). This intentionally changes
  existing consumers too — recovered real edges are a correctness fix, not
  a regression (noted in Migration plan).
- New `PARALLEL_TEXT_RE` matching `Parallel-safe with <hashes>` /
  `Parallel-with: <hashes>` (symmetric with `BLOCKED_BY_TEXT_RE`,
  `parse.ts:134`), populating a new optional `DevRow.parallel_with?:
  string[]` field (optional `?` for back-compat, the mlc106 `epicSlug`
  precedent). Today no parser for this exists anywhere in `src/` — the
  annotation lives only in skill-prompt prose and a test-local fixture.
- Heading tolerance in `parseEpicHeadings` (`parse.ts:303`) +
  `epicSectionFor`: optional `Epic — ` prefix, `##` or `###` depth,
  `(workstream <hash>)` linkage form alongside `(plan: <hash>)`, prose
  suffixes after the paren group (the audited ffm + palateful variants that
  today return `[]` / null hashes).

**2. Graph model (`src/lib/graph/model.ts`, new).** `buildGraphModel()` —
all I/O behind the `EngineFs`-style seam, returns `{model, warnings}` or a
cycle error.

- *Spec index*: enumerate `SPEC_TYPE_DIRS` (`src/lib/engine/
  frontmatter.ts:428`) × readdir × `readEngineState` (+
  `parseFrontmatterValue` from `src/lib/plan/validate-emit.ts:747` for the
  keys `readEngineState` doesn't carry: `from:`, `spawned:`, `title:`).
  This cross-dir index does not exist today; it is the one genuinely new
  read-model. Hyphenated `blocked-by:` keys are read here via
  `parseFrontmatterValue(body, "blocked-by")` and normalized (warn) —
  `readEngineState` stays underscore-only.
- *Nodes*: union of backlog rows (`parseDevMd` over DEV.md, PLAN.md,
  TEST.md, DEBUG.md — the `readBacklogRows` pattern, `gather.ts:452`) and
  the spec index. Node status uses the `effectiveStatus` precedence
  exactly as `gather.ts:191`: spec frontmatter status wins, row checkbox
  is fallback; struck rows excluded as nodes.
- *Blocking edges*: union of row `blocked_by` and frontmatter
  `blocked_by`/`blocked-by` (both run through `splitHashes` — fixing the
  known divergence where frontmatter values bypass normalization,
  `frontmatter.ts:248-255`), deduped, each edge tagged with its source(s).
  Every candidate token is validated against the known-hash set; unknown
  tokens are dropped with a warning naming the source row — never
  rendered (kills the phantom class; palateful makes ~30 today).
- *Drift warnings*: where a spec's row edge set ≠ frontmatter edge set,
  warn naming the hash and both sets (fix is `devx doctor`'s, dev-db36af).
- *Parallel edges*: from the new `parallel_with` row field.
- *Lineage edges*: `from:` / `spawned:` / `superseded_by:` read via the
  spec index (`readEngineState` reads none of these; `spawned:` handles
  both value forms — bare hashes and path block-lists, the palateful
  audit).
- *Groups*: `parseEpicHeadings` (hardened) for backlog epics +
  `resolveSpecWorkstream` (`workstream.ts:565`) as the membership bridge
  — its three-arm chain (`workstream:` frontmatter → path in
  `from:`/`plan:` → plan-hash) is exactly the discovery that works
  without PLAN.md rows or plan.md files. Specs with no group render in a
  standalone group. A group whose members are all settled collapses to a
  summary node (count + last merge date derived from the members' latest
  `merged via PR` status-log line; omitted when absent).
- *Badges*: `parseInterviewMd`/`parseManualMd` reverse `Blocks:` edges
  annotate the blocked nodes (FR-2g).
- *Cycle check*: DFS over blocking edges only; a cycle is a hard error
  enumerating every member hash — the CLI exits non-zero and does not
  write GRAPH.md (E-3). Parallel/lineage edges are exempt (lineage is
  legitimately bidirectional-looking across `from:`/`spawned:` pairs).

**3. Renderer (`src/lib/graph/render.ts`, new).**
`renderStoryGraph(model): string` — pure, deterministic: nodes sorted by
hash within groups, groups sorted by kind then id, edges sorted by
(from, to, kind); no timestamps in the body. Emits the full GRAPH.md
document: banner (do-not-hand-edit + regen command), legend, one
` ```mermaid ` flowchart (subgraph per group, `classDef` per status,
solid `-->` blocking edges, visually-distinct link classes for
parallel-safe and lineage, cross-group edges plain), and a deterministic
sorted Warnings section (state-derived, so byte-stability holds).
Node ids are the spec hashes (already Mermaid-safe: `[a-z0-9]{3,12}`);
labels are `<hash> <short-title>` with titles escaped + truncated.
The O-1 tour pins do not apply: all three tests constrain the tour HTML
template/schema only (`test/tour-drift-pin.test.ts:83`,
`test/tour-render.test.ts:150`, `test/tour-schema.test.ts:179`); a fenced
mermaid block in a root markdown file trips none of them — GRAPH.md still
routes nothing through the tour renderer.

**4. CLI (`src/commands/graph.ts`, new).** Standard `CommandModule`
registration (static array in `src/cli.ts:59-87`, one import + one entry;
name collision checked: none). `runGraph(opts): number` with the
`status.ts` seam shape (`out`, `err`, `projectPath`, `fs`) — read-only
conventions except the GRAPH.md write, which goes through `writeAtomic`.
**Root resolution is worktree-safe by design**: `resolveRepoRoot()`
(`src/lib/repo-root.ts:121`), not the cwd config-walk — a `devx graph`
run (or a claim-triggered regen) inside `.worktrees/dev-<hash>/` must
write the main checkout's GRAPH.md, never fork a worktree-local copy
(same rationale as loop/claim; `findProjectConfig` would find the
worktree's config copy). Config then loads from the resolved root.

**5. Regen hooks (FR-4) + backfill.**

- *Claim*: inside `claimSpec` at the Step-3 boundary
  (`src/lib/devx/claim.ts:783-905`) — GRAPH.md is re-rendered from the
  post-flip state, joins the tmp+rename plan and the
  `revertWorkingTree` rollback closure, and is added to the claim
  commit's explicit pathspec (which becomes DEV.md + spec + GRAPH.md).
  This is the only slot that keeps the claim commit self-consistent.
- *RED emission*: in `writeRetroAtomically`
  (`src/lib/plan/emit-retro-story.ts:318`) after its rename plan
  completes — the retro co-emission is the last write of the emission
  flow, so the regen sees the full new epic (specs + DEV.md rows already
  on disk). GRAPH.md gets its own tmp+rename; it does not join the
  spec/DEV.md rename batch. To keep the "same commit as the state flip"
  guarantee, `runEmitRetroStory`'s stdout JSON gains a `graphPath` field
  and the `/devx-plan` RED-stage commit pathspec includes GRAPH.md
  (canonical prose edit in `.claude/commands/devx-plan.md` + skill
  mirror, same rule as the Phase-8 rewrite).
- *Merge-cleanup*: **no CLI helper exists today** — the after-merge
  bookkeeping (spec `status: done`, DEV.md `[/]→[x]` + PR URL) is skill
  prose (`skills/devx.md` Phase 8 steps 4–7); `devx todo sync` is the
  only CLI call in the sequence, and workstream-less items skip even
  that. FR-4's "helpers the flows already call" therefore has no host on
  this flow: the design adds **`devx devx-helper mark-done <hash> --pr
  <n> --merge-sha <sha>`** (fifth subcommand; today there are exactly
  four) which performs the file mutations mechanically — spec status
  flip + status-log append, DEV.md flip + PR URL, todo sync when the
  item has a workstream, GRAPH.md regen — and emits JSON `{paths:
  [...]}` for the skill's explicit-pathspec commit. Write-only in v1
  (the skill keeps owning commit + push, symmetric with how it owns the
  merge itself). This also structurally closes the `git add -A`
  cleanup-commit incident class (2026-07-29 erratum).
- *Loop merge tail* — **fourth host, added 2026-08-19 (debug-8a9586)**.
  `devx loop`'s own merge tail (`src/lib/loop/driver.ts`,
  `finalize-merged`) is a state-flipping flow this section originally
  missed: it predates sgr105 and closes items unattended, so every
  overnight-merged item left the board stale until the next attended
  claim happened to refresh it. FR-4 and G-3 were only satisfied on the
  attended path. The tail now calls `regenerateGraph` after its flips
  and adds GRAPH.md to the cleanup commit's pathspec, on BOTH branches —
  the `[x]` done flip and the split-failure `[-]` blocked flip.
  **Decided (spec AC 4): the tail keeps its own flip sequencing and
  shares the regen PRIMITIVE, rather than routing through `markDone`.**
  `markDone`'s single happy path cannot express three things the tail
  needs — the split-failure branch flips `[-]` blocked (`markDone` has no
  blocked mode at all — it flips to done or throws on the state
  mismatch), the dvx103 `phase 4:`
  fallback line the orchestrator writes because workers may not touch the
  Status log, and the follow-up spec path carried into the same commit's
  pathspec. Forcing them in would widen a helper whose whole value is one
  narrow contract. What sgr105 removed was duplicated *regen* logic, and
  that is exactly what is shared here: one `regenerateGraph`, one
  `isGitIgnored` (hoisted to `src/lib/exec.ts` so both hosts ask git the
  same question), one warn-and-continue posture. Pinned by
  `test/loop-graph-freshness.test.ts`, the permanent-suite analogue of
  E-5's `mark-done` leg.
- *Failure posture*: regen failures inside claim/emission/mark-done/the
  loop tail are
  **warn-and-continue** — a broken graph render must never abort a state
  flip; the miss surfaces via `--check` (E-2) instead. (E-5's threshold
  binds the success path, not the failure path.)
- *Backfill* (`src/lib/graph/backfill.ts` + `devx graph backfill`):
  pass 1 computes the mechanical completion — per spec, the union of row
  + frontmatter edges minus what each side already has — and writes the
  missing side: frontmatter via `applyEnginePatch`/key-splice in
  canonical `blocked_by` underscore form (normalizing hyphen keys),
  row-side only onto live `Blocked-by:`-bearing rows (done rows whose
  prose was replaced by PR narration get frontmatter only — the ffm
  shape). Additional edges derive only from durable state: `phase:`
  frontmatter ordering within a workstream, plan.md `(dev spec: <hash>)`
  pointers, todo.md `POINTER_RE` pointers (`src/lib/engine/todo.ts:115`).
  Pass 2 reports underivable specs (listed, never guessed) as the input
  for an attended session. Adds-only (never deletes an edge), idempotent
  (second run = 0 file writes), all writes via `writeAtomic`.

### Interfaces

```
devx graph [--stdout] [--check] [--format mermaid|json]
           [--epic <slug|hash>]... [--workstream <slug>]...
devx graph backfill [--dry-run]
```

- Default: render + atomic-write `<root>/GRAPH.md`; print a one-line
  summary + warnings to stderr. Exit 0.
- `--stdout`: print the rendered document instead of writing.
- `--format json`: emit the GraphModel JSON to stdout (stdout carries
  only the payload; warnings stay on stderr — the `devx next`
  convention).
- `--check`: render fresh, byte-compare against the committed GRAPH.md
  (the `scripts/sync-skills.mjs:35` `diffMirror` idiom — first in-CLI
  `--check`). Exit 0 in-sync; exit 1 drift, naming GRAPH.md and the
  regen command (E-2); writes nothing.
- `--epic`/`--workstream`: scope the rendered board (the `devx loop`
  scope vocabulary); scoped output is for `--stdout`/`--check` reading —
  the written GRAPH.md is always the full board.
- Exit codes (engine convention): 0 success · 1 check-drift, cycle
  error, or backfill validation failure · 2 config-load / resolution
  failure.
- `backfill`: applies pass 1, prints the pass-2 report (human to stdout;
  `--dry-run` computes + reports without writing). Idempotent.

Library surface (consumed by the hooks):

```ts
// src/lib/graph/model.ts
buildGraphModel(fs, repoRoot, engine): 
  { ok: true; model: GraphModel; warnings: GraphWarning[] }
  | { ok: false; cycle: string[] }        // every hash in the cycle
// src/lib/graph/render.ts
renderStoryGraph(model: GraphModel): string   // pure, deterministic
// src/lib/graph/regen.ts (thin composition used by claim/emit/mark-done)
regenerateGraph(fs, repoRoot, engine):
  { ok: true; path: string } | { ok: false; warning: string }  // never throws
```

`devx devx-helper mark-done <hash> --pr <n> --merge-sha <sha>`: stdout
JSON `{ hash, paths: string[], todoSynced: boolean }`; exit 0 success ·
1 state mismatch (spec not in-progress / row not `[/]`) · 2 resolution
failure. Runs under `withBacklogLock` like claim.

### Data

- **GRAPH.md** (committed, generated): banner comment naming the regen
  command → legend → one fenced `mermaid` flowchart → sorted Warnings
  section. No timestamps, no version strings in the body (byte-stability
  across runs of the same state).
- **GraphModel** (the `--format json` contract, consumed by agents):

  ```ts
  interface GraphModel {
    nodes: { hash; type: SpecType; title; status: SpecStatus;
             group: string | null; badges: string[] }[];
    edges: { from; to; kind: "blocks" | "parallel" | "lineage";
             sources: ("row" | "frontmatter" | "derived")[] }[];
    groups: { id; kind: "workstream" | "epic" | "standalone";
              title; collapsed: boolean;
              stats: { done: number; total: number;
                       lastMerged: string | null } }[];
    warnings: { code: "unknown-blocker" | "edge-drift" | "hyphen-key"
                    | "heading-fallback"; hash?: string;
                source?: string; message: string }[];
  }
  ```

- No new persistent stores, no `devx.config.yaml` schema change in v1
  (no theming knobs — PRD non-goal). No caches: a full cold build is
  readdir + parse over ~200 files, comfortably inside the 2s budget.

## Migration plan

1. **Parser hardening ships first** (exports + tokenization +
   parallel-safe + heading tolerance in `parse.ts`). Note: hardened
   tokenization changes existing consumers — edges that today fail to
   parse (markup-wrapped, spec-path forms in frontmatter) start
   resolving, which can newly mark an item blocked/unblocked in
   `devx next`/reconcile/scope. That is the encoding becoming truthful;
   the live-repo run (E-1) happens before merge to catch surprises.
2. **`devx graph` + model + renderer** land; first real run against the
   live devx repo via the installed CLI (LEARN cross-epic; this parser
   family's founding exemplar) before merge; the initial GRAPH.md commits
   with the feature.
3. **Hooks**: claim-slot regen, emission regen, `mark-done` helper; the
   canonical skill prose (`.claude/commands/devx.md` Phase 8 after-merge
   steps 4–7) is rewritten to invoke `mark-done` + commit its `paths`,
   then `npm run sync:skills` regenerates the mirror (editing
   `skills/devx.md` directly is the wrong side).
4. **Downstream distribution (FR-6)**: the `mark-done` helper and `devx
   graph` arrive with the global CLI update (`npm run install:global`;
   both repos consume the global copy per the audit); the rewritten
   Phase-8 / RED-stage skill bodies reach downstream repos via the
   existing `/devx-init` update path (skills ship in the package
   `files:` list; re-running `/devx-init` refreshes the command bodies —
   the rtl105 distribution mechanism). No new distribution channel.
5. **Backfill runs per repo as attended PRs**: devx first (pre-convention
   history), then friend-finder-mesh and palateful via the updated global
   CLI; each run's pass-2 report drives the attended remainder in the
   same PR.
6. GRAPH.md is additive everywhere — no existing file changes shape; a
   repo that never runs `devx graph` is unaffected. CI wiring of
   `--check` is deliberately deferred (matches `sync:skills --check`,
   which is also not CI-wired today).

## Resolved design questions

- Publish surface, edge encoding, node scope, backfill shape → resolved at
  PRD stage (prd.md § Open questions), all four locked with the user
  2026-08-02.
- Where does regen live? → Inside the CLI helpers the flows already call
  (FR-4; behavior-as-CLI-primitive pattern), not skill prose. For
  merge-cleanup no helper exists, so the design adds `devx devx-helper
  mark-done` as the host rather than putting a `devx graph` call in skill
  prose (decided here; see Architecture § Regen hooks).
- Single file or per-workstream files? → Single GRAPH.md (see Trade-offs).
- Which edge/status semantics does the graph render, given three divergent
  `blockersResolved` implementations (`gather.ts:307` frontmatter-status ×
  3 backlogs; `reconcile.ts:452` row-only DEV.md-only; `scope.ts:207`
  row-only all-rows)? → The graph is a *map, not a dispatcher*: it renders
  the full validated edge union and `effectiveStatus` (gather's
  precedence) node states, and does not re-implement any resolver's
  "runnable" verdict. The divergence itself is exactly the drift class the
  warnings surface.
- Repo root in worktrees? → `resolveRepoRoot()` canonical root, so regen
  from inside a claim worktree writes the main checkout's GRAPH.md
  (decided here; the config-walk would silently fork a worktree copy).
- Does a regen failure abort a state flip? → Never; warn-and-continue,
  `--check` catches the miss (decided here).
- Does O-1 (no Mermaid in tours) constrain GRAPH.md? → No — all three
  pinning tests constrain the tour HTML template/schema only; verified
  against the tests themselves (see Architecture § Renderer).

## Unresolved design questions

- Exact Mermaid link glyphs for the parallel-safe and lineage classes
  within GitHub's supported set — settled at implementation against real
  GitHub rendering; E-1's fixture pins whichever is chosen. Non-blocking
  (no P0 depends on the glyph choice, only on the classes being visually
  distinct).
- GitHub's Mermaid size ceiling (maxTextSize/node count) on very large
  boards — measured empirically at E-1's live-repo run; `--epic`/
  `--workstream` scoping is the designed fallback. Non-blocking.
- Should `mark-done` eventually own the cleanup commit itself
  (claim-helper symmetry)? v1 is write-only + JSON pathspec; revisit if
  the write-then-skill-commits seam proves race-prone in loop runs.
  Non-blocking.
