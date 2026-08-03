---
hash: 97f6d8
type: test
created: 2026-08-03T09:50:00-06:00
title: "QA walkthrough — devx graph renderer + CLI (sgr103)"
from: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `sgr103`

> Adds the `devx graph` CLI and the deterministic Mermaid renderer behind it,
> plus the first committed `GRAPH.md` at the repo root. User-visible surfaces:
> the new subcommand (its five flags, its three exit codes, its `--help` row)
> and the rendered `GRAPH.md` document itself. This walkthrough does NOT cover
> the regen hooks (sgr104/sgr105), `graph backfill` (sgr106), or downstream
> packaging (sgr107) — none of those exist yet.

## Pre-flight

```bash
git checkout feat/dev-sgr103
npm ci
npm run build          # E-1's live leg and every check below spawn dist/cli.js
```

## Manual checks

### 1. `--check` is a real drift gate across all three of its phases

- [x] `machine` — proves `--check` exits 0 on a fresh file, non-zero on drift
  while naming both `GRAPH.md` and the regen command, and 0 again after regen.

```bash
npx tsx _devx/workstreams/story-graph/evals/E-2_check-drift.ts
```

Expected:

```
E-2 GREEN — --check is 0 when fresh, non-zero naming GRAPH.md + regen command on drift, 0 after regen.
```

Invariant: a `--check` that cannot distinguish those three states is worse
than no gate — the regen hooks in sgr104/sgr105 report their misses through
this and nothing else.

### 2. The render is byte-stable over unchanged state

- [x] `machine` — two consecutive renders of the same board produce identical
  bytes. This is what makes `--check` and the per-claim regen hooks usable at
  all; a single unsorted collection turns every claim into a spurious diff.

```bash
node dist/cli.js graph --stdout 2>/dev/null > /tmp/r1.md
node dist/cli.js graph --stdout 2>/dev/null > /tmp/r2.md
cmp /tmp/r1.md /tmp/r2.md && echo "identical ($(wc -c < /tmp/r1.md) bytes)"
```

Expected:

```
identical (   19435 bytes)
```

Invariant: no clock, environment, or insertion-ordered collection may reach
the output. If this ever differs, find the unsorted iteration before
regenerating anything.

### 3. `--format json` emits the payload and nothing else on stdout

- [x] `machine` — the whole of stdout parses as one JSON document matching the
  pinned `GraphModel` shape; the five live warnings go to stderr only, so
  `devx graph --format json | jq` works.

```bash
node dist/cli.js graph --format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log("parsed OK — nodes",m.nodes.length,"edges",m.edges.length,"groups",m.groups.length,"warnings",m.warnings.length)})'
```

Expected:

```
parsed OK — nodes 175 edges 378 groups 22 warnings 5
```

Invariant: agents consume this contract. One stray log line on stdout breaks
every one of them at once, silently.

### 4. The committed `GRAPH.md` is structurally well-formed Mermaid

- [x] `machine` — exactly one fenced block, balanced subgraphs, no duplicate
  node ids, no label with unbalanced brackets, no edge endpoint that was never
  declared as a node, and a block comfortably under GitHub's size ceiling.

```bash
node -e '
const b=require("fs").readFileSync("GRAPH.md","utf8").match(/```mermaid\n([\s\S]*?)```/g);
if(b.length!==1)throw new Error("expected exactly one mermaid block, got "+b.length);
const body=b[0].replace(/```mermaid\n/,"").replace(/```$/,"");
const lines=body.split("\n");
let depth=0,decl=new Map();
for(const l of lines){
  if(/^\s*subgraph /.test(l))depth++;
  else if(/^\s*end\s*$/.test(l))depth--;
  const m=/^\s{4}([A-Za-z0-9_]+)\[/.exec(l);
  if(m)decl.set(m[1],(decl.get(m[1])||0)+1);
}
const dup=[...decl].filter(([,n])=>n>1);
const unbal=lines.filter(l=>/^\s{4}\S+\[/.test(l)).filter(l=>(l.match(/\[/g)||[]).length!==1||(l.match(/\]/g)||[]).length!==1);
const known=new Set(decl.keys()),phantom=new Set();
for(const l of lines){const e=/^\s{2}(\S+) (?:-->|-\.->|--- \|par\|) (\S+)$/.exec(l);
  if(e){if(!known.has(e[1]))phantom.add(e[1]);if(!known.has(e[2]))phantom.add(e[2]);}}
console.log("mermaid blocks:            1");
console.log("subgraph balance:         ",depth,"(0 = balanced)");
console.log("declared nodes:           ",decl.size);
console.log("duplicate declarations:   ",dup.length);
console.log("unbalanced label brackets:",unbal.length);
console.log("undeclared edge endpoints:",phantom.size);
console.log("block size:               ",body.length,"chars (GitHub maxTextSize 50000)");
'
```

Expected:

```
mermaid blocks:            1
subgraph balance:          0 (0 = balanced)
declared nodes:            120
duplicate declarations:    0
unbalanced label brackets: 0
undeclared edge endpoints: 0
block size:                17219 chars (GitHub maxTextSize 50000)
```

Invariant: Mermaid fails the WHOLE block on one parse error, so any of these
going non-zero blanks the entire board rather than degrading one node. The
undeclared-endpoint count is the phantom class this workstream exists to kill
— Mermaid mints a bare node for any id it meets only in an edge.

### 5. All four P0 evals are green from the built CLI

- [x] `machine` — E-1 through E-4 cover deterministic render, drift, edge
  hardening (phantoms, markup, cycles) and the two-dialect source union.

```bash
for e in E-1_render-deterministic E-2_check-drift E-3_edge-hardening E-4_source-union; do
  npx tsx _devx/workstreams/story-graph/evals/$e.ts
done
```

Expected:

```
E-1 GREEN — GRAPH.md renders deterministically with the full structural contract; live repo < 2s, 0 phantoms.
E-2 GREEN — --check is 0 when fresh, non-zero naming GRAPH.md + regen command on drift, 0 after regen.
E-3 GREEN — phantoms dropped with named warnings, markup/path edges recovered, both cycle cases fail naming all participants.
E-4 GREEN — full edge union recovered from both dialects, both heading variants grouped, hyphen + drift warnings fire precisely.
```

Invariant: E-1's live leg spawns `dist/cli.js`. A stale `dist` is a known
false-red source here — `npm run build` before believing a red.

### 6. `GRAPH.md` renders as a diagram on GitHub, with the three edge classes visually distinct

- [ ] `human` — this is AC 7, and the reason the story is marked attended-only
  · how to verify: open the **Files changed** tab of this PR, click `GRAPH.md`,
  and switch to the rendered (non-source) view — you should see one flowchart
  with a labeled box per workstream, not a code block or a "unable to render"
  banner.

Invariant: GitHub is the only renderer that matters for this file; a diagram
that only works in a local previewer is a diagram nobody on this project sees.

### 7. Blocking, lineage, and parallel-safe links read as three different things

- [ ] `human` — the glyph choice was the plan's unresolved Q1, settled here
  · how to verify: in the rendered chart, find a solid arrow (blocking), a
  dotted arrow (lineage), and an arrowless link labeled `par` — confirm you can
  tell them apart at a glance without consulting the legend first, then check
  the legend agrees with what you saw.

Invariant: the classes carry the whole meaning of the picture. If two of them
look alike, the graph is decorative rather than informative, and E-1's fixture
assertion (which only checks they *differ mechanically*) will not catch it.

### 8. Node status colors are legible in both GitHub themes

- [ ] `human` — the palette is 3-digit hex, deliberately (a 6-digit color is
  itself hash-shaped and made E-1's phantom check fire on the palette)
  · how to verify: view the rendered chart in light mode, then flip your GitHub
  appearance to dark mode and reload — node text must stay readable against the
  fill in both.

Invariant: any palette fix must stay 3-digit hex; re-introducing `#ffffff`
re-introduces a phantom node in every hash-grep over this file.

## Regressions to watch

- **`devx --help` ordering.** `graph` was inserted into the phase-1 block and
  `test/help.test.ts` pins the full listing as an inline snapshot. If a later
  command lands without refreshing that snapshot, the failure looks like a
  wording bug rather than a registration bug — check `expectedOrder` first.
- **Worktree-local GRAPH.md.** Root resolution goes through
  `resolveRepoRoot()`, so a `devx graph` run inside `.worktrees/dev-<hash>/`
  writes the MAIN checkout's file. If a stray `GRAPH.md` ever appears inside a
  worktree, the config-walk has crept back in — `test/graph-cli.test.ts`
  "writes the MAIN checkout's GRAPH.md when run from a linked worktree" is the
  guard.
- **Parser hardening blast radius.** sgr101 made `splitHashes` recover
  markup-wrapped and spec-path edges, which every consumer inherits. An item
  that newly reads as blocked in `devx next` is the encoding becoming truthful,
  not a regression — verify against the spec's own `blocked_by` before
  "fixing" it.

## Post-merge follow-ups

- **GRAPH.md goes stale on the merge-tail commit.** Until sgr105 lands
  `devx devx-helper mark-done`, after-merge bookkeeping is skill prose, so the
  `[/]→[x]` flip drifts the board. Accepted interregnum drift (spec § Technical
  notes); this story's own merge-tail commit re-runs `devx graph` and includes
  `GRAPH.md` in the pathspec.
- **`--check` is not CI-wired.** Deliberate, matching `sync:skills --check`.
  Revisit once the regen hooks (sgr104/sgr105) make freshness structural.
- **Five live warnings are reported, not fixed.** One `edge-drift` on `d40ret`
  and four `heading-fallback`s on mobile-epic headings. Reconciling them is
  `devx doctor`'s job (dev-db36af) and sgr106's backfill, not this story's.
