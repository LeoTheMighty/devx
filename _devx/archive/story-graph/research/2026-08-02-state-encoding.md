# Research — where dependency/ordering state lives in the devx repo (2026-08-02)

Explore-agent audit for the story-graph PRD. Headline: **the graph already
exists as durable, machine-parsed state** — the missing piece is a renderer
and the freshness loop, not a new encoding.

## Durable + parsed today

- **DEV.md/PLAN.md rows** — `Blocked-by: <hashes>.` (106 occurrences in
  DEV.md), parsed by `src/lib/backlog/parse.ts` `BLOCKED_BY_TEXT_RE` +
  `splitHashes()` into `DevRow.blocked_by[]`. Same row grammar across DEV,
  PLAN, TEST, DEBUG. Checkbox→status map; inline `Status:` wins; `~~struck~~`
  → deleted/superseded; `blankFencedLines()` prevents phantom rows.
- **Epic grouping** — `### Epic — <name> (plan: <hash>)` via
  `epicSectionFor()` / `parseEpicHeadings()` (includes empty epics);
  `epicSlugify()` gives stable ids.
- **Spec frontmatter** — `blocked_by: [..]` (array or bare string) via
  `src/lib/engine/frontmatter.ts:248`; also `plan:`, `phase:`, `from:`,
  `spawned:`.
- **Workstream todo.md** — `Phase <n>: <title> → <hash>` pointer lines,
  pinned by `DERIVED_LINE_RE` / `POINTER_RE` in `src/lib/engine/todo.ts` —
  cleanest workstream→phase→hash join.
- **INTERVIEW/MANUAL** — `parseInterviewMd`/`parseManualMd` give reverse
  `Blocks:` edges into spec hashes.
- **Retro fan-in** — `*ret` specs blocked by all epic stories = free epic
  completion node.

## Durable but UNPARSED (gaps)

- `Parallel-safe with X` (DEV.md) / `Parallel-with:` (PLAN.md) — no parser.
  Trivial symmetric regex + existing `splitHashes`.
- `Consumes:` / `Builds on:` / `Related:` — prose only.
- Inter-phase deps inside workstream plan.md phase bodies ("Depends on
  phase 1", "Dependency order: 1 → {2,3} → 4") — prose only; phase ordinal
  is the parsed signal.
- Cross-track ordering: `## Vision-gap tracks (plans: b3f7a1 → c8e2d4 → …)`
  headings; docs/ROADMAP.md critical path — prose only.

## Ephemeral only

- The `/devx-plan` Next-command block (pln106): printed to chat, never
  written to disk, and explicitly **lossy** (single deepest edge; one named
  peer). Byte format pinned by `test/plan-final-summary-format.test.ts`.

## Drift

- Frontmatter `blocked_by` vs DEV.md `Blocked-by:` are independently
  authored and diverge (e.g. dev-db36af has no frontmatter key but a DEV.md
  edge; rtl106 has `[]` at phase 6). Operative source for
  `devx next`/loop/reconcile is **DEV.md** (`gather.ts` blockersResolved).
  Reconciliation is `devx doctor`'s filed scope (dev-db36af, ready).

## Consumers today

- `src/lib/next/gather.ts:294-320` — blockersResolved over `statusByHash`;
  unknown blocker = unresolved. `decide.ts` collapses to one action + flat
  blocked list; nothing topo-sorts or models a graph.
- `src/lib/manage/reconcile.ts:456`, `src/lib/loop/scope.ts:222` — same
  shape.
- Writers: `src/lib/plan/emit-retro-story.ts` (row + frontmatter),
  `src/lib/devx/split.ts:388`.

## LEARN.md cross-epic patterns that bind

- **First real run against the live repo required** for any new
  gate/parser/primitive — founding exemplar is mgr103, this exact parser
  family (fenced example row parsed as real). Run the installed artifact,
  not the worktree build.
- **Pure-fn + CLI-passthrough + adversarial-testing trio** — canonical
  shape: `renderStoryGraph(model) → string` + thin `devx graph`.
- **Behavior-as-CLI-primitive consumed via skill passthrough** — no AI at
  render time; skill bodies just invoke and react to exit codes.
- **Atomic state writes via tmp+rename** — applies to writing GRAPH.md.

## Constraints / precedent

- `v2/07-decisions.md` O-1: Mermaid-in-tours is OPEN and negatively pinned
  by three tour tests (`trails[].mermaid` is a schema error). GRAPH.md must
  not route through the tour renderer.
- Committed-generated-artifact precedent: `npm run sync:skills -- --check`
  (scripts/sync-skills.mjs, pin101) — the `--check` drift-guard idiom.
- CLI registration: static array in `src/cli.ts` (27 modules); new
  `src/commands/graph.ts` + import + entry. `devx status` is the precedent
  for a read-only thin renderer; `devx next` prints JSON to stdout / human
  to stderr; `--epic`/`--workstream` scope vocabulary from `devx loop`.
