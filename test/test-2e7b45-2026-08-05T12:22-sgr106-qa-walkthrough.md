# QA walkthrough — Story `sgr106`

> Adds `devx graph backfill [--dry-run]`, which completes the board's durable
> edge set (writes each blocking edge to whichever of spec-frontmatter /
> backlog-row is missing it, derives ordering from durable state only, and
> reports what it cannot derive). User-visible surface is the CLI's stdout
> report plus the diff it produces. Does NOT cover the Mermaid render (that is
> sgr103's walkthrough) or `devx graph`'s other flags, which are untouched.

## Pre-flight

```bash
git checkout feat/dev-sgr106
npm ci
npm run build   # only needed for `devx` on PATH; the checks below use tsx
```

> Note on where checks 3–6 ran. `devx graph backfill` resolves the CANONICAL
> repo root, so from a worktree it targets the main checkout (check 8). The
> attended run recorded below was therefore driven through the library entry
> point against this branch's worktree, so its diff rides in this PR instead
> of landing on main uncommitted next to two live peer sessions. The commands
> given are the operator's real ones, run from the main checkout; re-running
> them there reproduces the same report except for the `DEV.md:<n>` line
> number, which depends on how many claims main has taken since.

## Manual checks

### 1. The RED artifact flips green for the stated reason

- [x] `machine` — E-6 asserts the whole contract end-to-end through the real
  CLI on a real git repo: canonical union written, ≥1 underivable reported,
  0 deletions, second run a 0-file no-op, `--dry-run` writes nothing.

```bash
npx tsx _devx/workstreams/story-graph/evals/E-6_backfill.ts
```

Expected:

```
E-6 GREEN — mechanical union written canonically, underivable reported, 0 deletions, second run a 0-file no-op.
```

Invariant: E-6 is the acceptance contract for FR-5. If it goes red, backfill
has stopped being adds-only, canonical, or idempotent — all three are
load-bearing, and the third is the review contract.

### 2. The unit suite pins each rule separately

- [x] `machine` — 36 cases across pass 1, derivation, suppression, pass 2,
  dry-run, idempotency, refusals, and the two writers in isolation.

```bash
npx vitest run test/graph-backfill.test.ts
```

Expected:

```
 ✓ test/graph-backfill.test.ts (36 tests)

 Test Files  1 passed (1)
      Tests  36 passed (36)
```

Invariant: a regression should name itself here rather than arrive as one
red eval. In particular `never infers ordering onto a settled spec` and
`suppresses a phase edge the row's Parallel-safe with refutes` are the two
rules that stop the tool from writing false dependencies.

### 3. `--dry-run` reports without writing

- [x] `machine` — on this repo, the dry run prints the full plan and leaves
  the working tree byte-identical.

```bash
git status --porcelain > /tmp/before.txt
devx graph backfill --dry-run
git status --porcelain > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo "TREE UNCHANGED"
```

Expected (report; the `diff` is silent and prints `TREE UNCHANGED`):

```
devx graph backfill — dry run (no files written)

Pass 1 — mechanical completion: 2 spec frontmatter, 1 backlog row(s)
  plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md — blocked_by += a01000
  dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md — blocked_by += dc7514
  DEV.md:150 (d40ret) — Blocked-by += d40007

Derived from durable state: 0 edge(s)

Suppressed inferences: 4
  hfi102 — settled (done) — phase ordering is not inferred onto shipped work
  hfi104 — settled (done) — phase ordering is not inferred onto shipped work
  rtl102 — settled (done) — phase ordering is not inferred onto shipped work
  rtl106 — settled (done) — phase ordering is not inferred onto shipped work

Pass 2 — underivable ordering: 1 spec(s) (reported, never guessed)
  b931a1  (workstream multi-loop-concurrency) — no `phase:` frontmatter, no plan.md/todo.md pointer, and no recorded edge in either direction

Would write 3 file(s). Re-run without --dry-run to apply.
```

Invariant: `--dry-run` is how an operator decides whether to run the real
thing. A dry run that writes anything — including GRAPH.md — makes the safe
mode unsafe.

### 4. The real run is idempotent (the review contract)

- [x] `machine` — the second consecutive run writes zero files and leaves the
  working tree exactly as the first left it.

```bash
devx graph backfill              # first run
git status --porcelain > /tmp/after-1.txt
devx graph backfill              # second run
git status --porcelain > /tmp/after-2.txt
diff /tmp/after-1.txt /tmp/after-2.txt && echo "SECOND RUN CHANGED NOTHING"
```

Expected (tail of the second run):

```
Pass 2 — underivable ordering: 1 spec(s) (reported, never guessed)
  b931a1  (workstream multi-loop-concurrency) — no `phase:` frontmatter, no plan.md/todo.md pointer, and no recorded edge in either direction

Wrote 0 file(s).
```

Invariant: "second run = 0 files" is what lets a reviewer trust the first
run's diff — it proves nothing else is pending and nothing oscillates.

### 5. The attended pass-1 diff is exactly three edges, each already stated elsewhere

- [x] `machine` — every written edge is a copy of something the operator had
  already written on the other side. No inference reaches the diff.

```bash
git diff -- DEV.md dev/dev-db36af-*.md plan/plan-b01000-*.md
```

Expected:

```
-...Blocked-by: d40001, d40002, d40003, d40004, d40005, d40006.
+...Blocked-by: d40001, d40002, d40003, d40004, d40005, d40006, d40007.

 status: ready
 branch: feat/dev-db36af
+blocked_by: [dc7514]

-blocked_by: []
+blocked_by: [a01000]
```

Invariant: pass 1 is mechanical. Any hash appearing here that is not already
present on the row or in the frontmatter of the SAME spec is a guess, and
guessing is the thing this tool is forbidden to do (D-9).

### 6. The board regenerates clean afterwards

- [x] `machine` — `devx graph --check` passes against the branch's GRAPH.md
  once the run (and the specs/backlog rows this story adds) have landed.

```bash
devx graph --check
```

Expected:

```
devx graph: GRAPH.md is up to date — 185 node(s), 386 edge(s), 22 group(s)
```

Invariant: backfill changes edges, so it must leave the committed board
consistent with disk. A drifted GRAPH.md here means CI's `--check` gate reds
on the next PR, for a reason nobody will connect to backfill.

### 7. The report reads as a decision, not a failure

- [ ] `human` — the "Suppressed inferences" and "Pass 2 — underivable" blocks
  should read as *this tool declining to guess*, not as errors the operator
  must fix · how to verify: run check 3's dry run and read the stdout top to
  bottom as if you had never seen this tool; the four `settled (done)` lines
  and the single `b931a1` line should each tell you what happened and why,
  without needing the source.

Invariant: pass 2 exists to hand a human a short, actionable remainder. If
the report reads as noise, operators will stop reading it and the remainder
silently stops getting resolved — which is the same outcome as guessing.

### 8. The worktree NOTE is understandable in situ

- [ ] `human` — running `devx graph backfill --dry-run` from inside
  `.worktrees/<x>/` prints a NOTE that it targets the main checkout · how to
  verify: `cd .worktrees/dev-sgr106 && npx tsx src/cli.ts graph backfill
  --dry-run 2>&1 | head -3`; the NOTE should make it obvious *before* you
  read the plan that the plan describes a different tree than the one you
  are standing in.

Invariant: `devx graph`'s canonical-root retargeting is deliberate and
load-bearing for GRAPH.md, but for a WRITE pass it is a genuine surprise.
The NOTE is the only thing standing between the operator and edits that
silently land outside their branch.

## Regressions to watch

- **`applyEnginePatch` formatting drift.** This story added
  `flowCollectionPadding: false` to the shared frontmatter serializer, so
  EVERY engine write (gate flags, stage bumps, outcome arming) now emits
  `[a, b]` instead of `[ a, b ]`. That is a fix — yaml's default was silently
  reformatting untouched `blocked_by:` lists on the way past — but it touches
  every patch path. Fastest proof: `npx vitest run test/engine-frontmatter*
  test/gate*` stays green.
- **Row splicing outside the parsed span.** `appendRowBlockers` writes into
  the exact span `BLOCKED_BY_TEXT_RE` reads. If that regex moves and the
  writer does not, backfill will append hashes the parser cannot see — an
  edge that exists in prose and nowhere else. The regex is now exported from
  `parse.ts` precisely so there is one copy; a re-inlined copy is the
  regression.
- **Deriving onto settled work.** The four suppressed inferences on this repo
  were all `done` specs, and three of them were ALSO refuted by an explicit
  `Parallel-safe with` row. If either guard is relaxed, backfill starts
  writing false dependencies into shipped history where nobody will ever
  correct them.

## Post-merge follow-ups

- `debug-9f24c7` — unparseable spec frontmatter reads as an empty block
  across the whole engine. Found by this story's attended run; the 5 data
  instances are fixed here, the class is not.
- `b931a1`'s ordering is the one remaining underivable remainder on this
  repo. Left unresolved deliberately: it needs a product call about where it
  sits relative to `ee7049` and `db36af`, which is exactly the kind of
  decision D-9 says the CLI must not make.
