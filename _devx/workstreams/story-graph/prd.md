# PRD — Story Graph (auto-generated dependency DAG of the board)

<!-- Stage: PRD. Gate: `devx gate prd 62bcd1`. Every concrete item gets a
     stable ID (G-/UC-/CAP-/FR-). IDs are never renumbered. Traceability is
     by ID, not by prose. -->

## Problem

The board's dependency graph already exists as durable state — DEV.md/PLAN.md
rows carry machine-parsed `Blocked-by:` annotations, spec frontmatter carries
`blocked_by:`, epic headings carry grouping, workstream todo.md carries
phase→hash pointers — but **nothing renders it**. `devx next` collapses the
whole graph to a single next-action plus a flat blocked list; the only
human-visible picture of dependency order is the `/devx-plan` Next-command
block, which is printed to chat once, never written to disk, and explicitly
lossy (single deepest edge, one named peer). In practice the user keeps the
last `/devx-plan` output around and runs stories off that static snapshot,
which rots silently as stories merge, split, or get filed ad-hoc.

Secondary problem: parts of the graph are durable but *unparsed* — 
`Parallel-safe with` / `Parallel-with:` annotations, and the two copies of
the blocking edges (DEV.md rows vs spec frontmatter) drift with no warning.

This hurts now because devx is no longer single-repo: friend-finder-mesh and
palateful run the same system, multiplying the boards the user holds in their
head — and the audit (research/2026-08-02-external-repos-audit.md) shows the
two repos have **opposite** edge authorities: ffm's real edges survive only
in spec frontmatter (DEV.md rows lose `Blocked-by:` prose at merge), while
palateful's survive only in DEV.md prose (21/41 specs lack any frontmatter
key; 12 more use a `blocked-by:` hyphen key the canonical reader drops).
Worse, the current tokenizer manufactures phantom edges from English prose
(~30 fake hashes across 7 palateful rows). The parsers that produce a
node+edge+group model exist (`src/lib/backlog/parse.ts`); what's missing is
the renderer, edge-source unioning/validation, and the freshness loop.

## Goals

<!-- Business/project goals are numeric + dated so /devx outcome can score. -->

- **G-1**: `devx graph` regenerates GRAPH.md from repo state with **zero AI
  tokens** at render time, in **< 2s** on the devx repo's full board
  (~100+ specs), by 2026-08-16.
- **G-2**: All three repos (devx, friend-finder-mesh, palateful) have a
  committed, rendering GRAPH.md with complete blocking edges by 2026-08-23.
- **G-3**: Staleness is structurally impossible in the loop: every
  state-mutating `/devx` / `/devx-plan` flow (claim, spec emission,
  merge-cleanup) leaves GRAPH.md fresh — 0 merged PRs with stale GRAPH.md in
  the 4 weeks after ship (measured by re-running `devx graph --check` against
  the merge commits), by 2026-09-20.

## Non-goals

- **Interactive/web visualization** — GitHub-rendered Mermaid in a committed
  markdown file is the whole UI; no served dashboard (the TUI/web UI phases
  own that later).
- **Replacing `devx next`** — the graph is a map, not a dispatcher; routing
  decisions stay in `devx next`.
- **Editing the graph to edit state** — one-directional render. State lives
  in specs/backlogs; GRAPH.md is generated output, never hand-edited.
- **Cross-repo aggregation** — one GRAPH.md per repo; no merged multi-project
  view (revisit when the mobile companion wants one).
- **A new dependency frontmatter field** — `blocked_by`/`Blocked-by:` is the
  existing durable encoding; we render and complete it, we don't fork it
  (wrap-don't-duplicate).
- **Fixing blocked_by drift between DEV.md and frontmatter** — the graph
  *warns* on drift; reconciliation is `devx doctor`'s filed scope
  (dev-db36af). No second reconciler.
- **Routing Mermaid through `devx tour`** — decision O-1 (Mermaid in tours)
  is explicitly open and negatively pinned by three tour tests; GRAPH.md is
  its own surface.
- **General-purpose Mermaid theming/config surface** — one good default look;
  no per-project style knobs in v1.

## Users

- **Primary**: the solo devx user deciding "what do I run next / what's in
  flight" across three repos — replaces the kept-around `/devx-plan`
  scrollback.
- **Secondary**: agents (Concierge, ManageAgent, future mobile relay) that
  want a mechanical, parseable picture of the board without re-deriving it;
  reviewers reading a PR who want to see where a story sits in its epic.
- **Anti-persona**: teams wanting a Jira/Linear-style interactive board —
  devx is markdown + git ground truth by design (D-10: no external trackers).

## Use cases

- **UC-1**: The user opens GRAPH.md on GitHub (or locally) and sees, per
  workstream/epic, every story as a status-colored node with dependency
  arrows — and can pick the next runnable story without hunting for old
  `/devx-plan` output.
- **UC-2**: `/devx-plan` RED-stage emission (which already writes
  `Blocked-by:` rows + `blocked_by:` frontmatter) regenerates GRAPH.md, so
  the graph reflects a new epic the moment it's planned.
- **UC-3**: `/devx` execute flows (claim; merge-cleanup) regenerate GRAPH.md
  as part of their status flips, so a story turning in-progress/done shows up
  in the next commit without anyone thinking about it.
- **UC-4**: The user runs the one-time assisted backfill in
  friend-finder-mesh and palateful (and once in devx for pre-convention
  history): it derives missing `Blocked-by:` edges from mechanical state
  (workstream phase order, todo.md pointers, `from:` chains), reports the
  underivable remainder for an attended pass, and the result lands as a
  normal reviewable PR.
- **UC-5**: An agent (or CI) runs `devx graph --check` to verify GRAPH.md
  matches current state — a drift gate usable in any repo running devx.

## Capabilities

- **CAP-1**: Mechanical board reader — one graph model (nodes + edges +
  groups) assembled by *reusing* `parseDevMd` / `parseEpicHeadings` /
  `epicSlugify` / frontmatter reads (wrap-don't-duplicate); covers all spec
  types across DEV.md, PLAN.md, TEST.md, DEBUG.md; **unions** row-annotation
  and frontmatter edge sources (deduped) because the authoritative side
  differs per repo, and validates every edge against the known-hash set.
- **CAP-2**: Deterministic Mermaid renderer — pure function graph model →
  stable Mermaid flowchart text (subgraph per workstream/epic, status-styled
  nodes, done epics collapsed to summary nodes), byte-stable for unchanged
  state; thin CLI passthrough on top (the pure-fn + CLI-passthrough
  cross-epic pattern).
- **CAP-3**: Complete + harden the durable encoding — parse the
  today-unparsed `Parallel-safe with` / `Parallel-with:` annotations as an
  edge class; tolerate real-world drift (hyphenated `blocked-by:` key,
  markup-wrapped hashes, spec-path blockers, epic-heading variants like
  `### <slug> (workstream <hash>)`); suppress phantom edges by validating
  against known hashes; surface (warn, don't fix) DEV.md-vs-frontmatter
  drift.
- **CAP-4**: Loop integration — the state-flipping CLI helpers regenerate
  GRAPH.md atomically (tmp+rename); `--check` mode for drift detection,
  following the established `sync:skills -- --check` idiom.
- **CAP-5**: Portability + backfill — works against any repo following the
  devx layout via the shipped package; a one-time assisted migration derives
  missing `Blocked-by:` edges from mechanical state first, AI only for the
  irreducible remainder.

## Feature requirements

### FR-1: `devx graph` CLI

New top-level command (peer of `devx status`; same read-only/exit-0
conventions; `--epic`/`--workstream` scope flags per the `devx loop`
vocabulary). Reads repo state (dev/, plan/, test/, debug/ specs; the four
backlogs; `_devx/workstreams/*` todo.md pointers) and writes GRAPH.md at the
repo root via tmp+rename. Zero network, zero AI. `--check` exits non-zero iff
the committed GRAPH.md differs from freshly rendered output; `--stdout`
prints instead of writing; `--format mermaid|json` (json = the graph model,
for agents).

### FR-2: Graph content

GRAPH.md contains: a generated-file banner (do-not-hand-edit + regen
command), a legend, and one Mermaid flowchart where (a) each active
workstream/epic is a subgraph containing its story nodes, (b) nodes are
labeled `<hash> <short-title>` and styled by status (ready / in-progress /
blocked / done; struck rows excluded), (c) solid edges are the **union** of
row `Blocked-by:` annotations and frontmatter `blocked_by`/`blocked-by`,
deduped and validated against known hashes (unvalidated tokens dropped with
a warning — never rendered), (d) parallel-safe annotations render as a
distinct non-blocking hint (dashed link or shared-rank note), and lineage
(`from:`/`spawned:`/`superseded_by:`) as a dotted edge class, (e) fully done
workstreams/epics collapse to one summary node (`epic-x — n stories,
shipped` + the last merge date), (f) specs with no epic/workstream render in a standalone
group, (g) INTERVIEW/MANUAL blockers surface on the nodes they block,
(h) cross-type edges (e.g. a dev spec blocked by a debug spec) render across
group boundaries. Deterministic ordering throughout (sorted by hash within
groups) so unchanged state ⇒ byte-identical file. Fenced code blocks in
backlogs never become phantom nodes (reuse `blankFencedLines`).

### FR-3: Edge-source completion, hardening + drift surfacing

(a) A parser for `Parallel-safe with <hashes>` / `Parallel-with: <hashes>`
(symmetric with the existing `BLOCKED_BY_TEXT_RE` + `splitHashes`
normalization) lands in `src/lib/backlog/parse.ts` and is consumed by the
graph. (b) Blocker tokenization strips markup (`~~`, `**`, trailing
punctuation) before matching and accepts spec-path forms
(`debug/debug-<hash>-…md`); every candidate edge is validated against the
set of known spec hashes — unknown tokens are dropped with a warning naming
the source row (kills the phantom-node class from prose-heavy annotations).
(c) The frontmatter reader accepts the hyphenated `blocked-by:` key found
in 12 palateful specs (normalized to `blocked_by` semantics; warn).
(d) Epic-heading matching tolerates the audited variants: optional
`Epic — ` prefix, `##` or `###` depth, `(workstream <hash>)` as the linkage
form, prose suffixes. (e) When a spec's frontmatter and backlog-row edge
sets disagree, `devx graph` prints a warning naming the hash and both sets
(fix belongs to `devx doctor`, dev-db36af). (f) Cycles in the blocking edge
set are an error naming every hash in the cycle.

### FR-4: Loop regeneration hooks

The state-mutating flows regenerate GRAPH.md in the same commit as the state
flip: claim (checkbox `[ ]→[/]`), RED-stage spec emission
(`validate-emit`/emission path), merge-cleanup (`[/]→[x]`). Implemented in
the CLI helpers those flows already call, not as skill-prose instructions
(the behavior-as-CLI-primitive cross-epic pattern), so unattended loop runs
get it for free.

### FR-5: Assisted backfill migration

`devx graph backfill` (one-time, per repo): pass 1 mechanically completes
the durable edge set from existing state — unions row + frontmatter edges
and writes the missing side (canonical `blocked_by` underscore form;
normalizes hyphenated keys), derives further edges from `phase:` frontmatter
/ plan.md `(dev spec: <hash>)` pointers / todo.md `Phase <n> → <hash>`
pointers where they exist; pass 2 reports the specs it couldn't order
(e.g. palateful's rsh chain has prose-only edges — those that survive
hardened tokenization are kept; the rest are listed), as input for an
attended AI/human pass (the command stays mechanical — the AI part is a
session, not the CLI). Idempotent: re-running changes nothing once edges
exist; never deletes an existing edge, only adds. Workstream discovery must
not require PLAN.md rows or plan.md presence (palateful's two executing
workstreams have no PLAN.md row; ffm's orb-companion-app has no plan.md) —
the primary bridge is dev-spec `from:` → plan frontmatter `workstream:`.
Runs identically in devx, friend-finder-mesh, and palateful, tolerating
audited drift (missing fields ⇒ warn + degrade, never crash).

### FR-6: Ship in the package

`devx graph` + backfill ship in the npm package like every other primitive
(new `src/commands/graph.ts` registered in `src/cli.ts`); `/devx-init` (or
its update path) makes GRAPH.md regeneration available to downstream repos
without copying code.

## Evals seed

- Fresh render on a fixture repo: subgraph per active workstream, collapsed
  node per shipped epic, parallel-safe hint rendered, byte-identical second
  run → candidate threshold: G-1.
- **First real run against the live devx repo before merge** (LEARN
  cross-epic: fixtures never carry the repo's poison — founding exemplar was
  this very parser family, mgr103's fenced-row phantom) → < 2s, no phantom
  nodes from fenced examples.
- Phantom suppression on the audited palateful shapes: a fixture row with
  `Blocked-by: ~~rsh101~~ …, **now debug-rshred1**: …` prose yields exactly
  the real edges, zero phantom nodes, warnings for dropped tokens.
- Edge-source union: ffm-shaped fixture (frontmatter-only edges on done
  rows) + palateful-shaped fixture (prose-only edges, hyphen key) both
  produce the complete edge set.
- Heading tolerance: `### <slug> (workstream <hash>)` and
  `## Epic — <name> (active; …)` both group correctly.
- `--check` drift: flip a spec status without regen → non-zero; regen → 0.
- Cycle: two specs blocking each other → error naming both hashes; dangling
  blocker hash → warning, graph still renders.
- Drift surfacing: fixture where frontmatter says `[]` but the DEV.md row
  says `Blocked-by: x` → warning names the spec and both sets.
- Backfill on fixtures modeling both audited repos: unions + writes missing
  edges, reports the remainder, idempotent second run, adds-only.

## Open questions

- (resolved 2026-08-02, user) Publish surface: committed GRAPH.md at repo
  root, auto-regenerated by loop flows.
- (resolved 2026-08-02, user → superseded by research same day) Dependency
  encoding: user approved a new `depends_on:` frontmatter field on the
  (incorrect) premise that edges weren't durable. Research showed
  `Blocked-by:`/`blocked_by` already is the durable, machine-parsed encoding
  written at emission; per wrap-don't-duplicate the feature reuses and
  completes it instead of adding a third copy. Intent preserved (durable,
  mechanical, zero-AI edges); mechanism corrected.
- (resolved 2026-08-02, user) Node scope: full board, done epics collapsed.
- (resolved 2026-08-02, user) Backfill: assisted migrate command; mechanical
  first, AI-attended remainder.

## Reference links

- Spec: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
- Backlog parser (nodes/edges/groups today): src/lib/backlog/parse.ts
- Edge consumers: src/lib/next/gather.ts (blockersResolved),
  src/lib/manage/reconcile.ts, src/lib/loop/scope.ts
- Edge writers: src/lib/plan/emit-retro-story.ts, src/lib/devx/split.ts
- Next-command block contract (ephemeral, lossy): .claude/commands/devx-plan.md
- Committed-generated-artifact precedent: scripts/sync-skills.mjs
  (`sync:skills -- --check`)
- Drift reconciler (filed, not this workstream): dev/dev-db36af devx doctor
- Tour/Mermaid constraint: v2/07-decisions.md O-1
- Research: research/2026-08-02-state-encoding.md,
  research/2026-08-02-external-repos-audit.md
- External boards: ~/personal/friend-finder-mesh, ~/personal/palateful
