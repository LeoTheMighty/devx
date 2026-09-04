# Expectations — Story Graph

<!-- Gate 1 input. Minimum 3 E-blocks (config: engine.expectations_min).
     Every business goal (G-) must be covered by at least one expectation;
     every Covers: ID must resolve in prd.md. EARS regex enforced by
     `devx gate prd`: "When .+, the system SHALL .+". A P0 with a vague
     Verified-by target fails the gate. -->

## E-1: Mechanical, deterministic render

- **Priority:** P0
- **Covers:** G-1, UC-1, CAP-1, CAP-2, FR-1, FR-2
- **Trigger:** `devx graph` run against a fixture repo containing: two
  active workstreams (specs in ready / in-progress / blocked / done states,
  blocking edges within and across workstreams, one parallel-safe pair,
  one lineage `spawned:` chain, one cross-type dev→debug edge), one
  fully-done workstream, ad-hoc specs with no workstream, and a fenced
  code-block example row in DEV.md; then a second run with no state change;
  then a run against the real devx repo via the installed CLI.
- **Expectation (EARS):** When `devx graph` runs, the system SHALL write
  GRAPH.md (tmp+rename) containing a generated-file banner, a legend, and
  one Mermaid flowchart with a subgraph per active workstream, status-styled
  nodes labeled `<hash> <short-title>`, solid blocking edges, a distinct
  parallel-safe hint, dotted lineage edges, a cross-group edge for the
  cross-type blocker, one collapsed summary node for the fully-done
  workstream, a standalone group for workstream-less specs, and no node for
  the fenced example row; and when run again with unchanged state the system
  SHALL produce a byte-identical file, using no network and no AI calls.
- **Threshold:** 100% of the enumerated structural assertions pass;
  second-run diff is 0 bytes; live-repo run completes < 2s wall clock with
  0 phantom nodes.
- **Verified by:** `_devx/workstreams/story-graph/evals/E-1_render-deterministic.ts`

## E-2: `--check` catches drift

- **Priority:** P0
- **Covers:** G-3, UC-5, CAP-4, FR-1
- **Trigger:** `devx graph --check` in a fixture repo where GRAPH.md is
  fresh; then after flipping one spec's `status:` (and its backlog
  checkbox) without regenerating; then after regenerating.
- **Expectation (EARS):** When GRAPH.md matches freshly-rendered state,
  the system SHALL exit 0; when any spec status, membership, or edge has
  changed since GRAPH.md was written, the system SHALL exit non-zero naming
  GRAPH.md and the regen command; and when the file is regenerated, the
  system SHALL exit 0 again.
- **Threshold:** 3/3 phases produce the specified exit codes; the drift
  message names GRAPH.md and the regen command.
- **Verified by:** `_devx/workstreams/story-graph/evals/E-2_check-drift.ts`

## E-3: Edge hardening — phantoms dropped, markup stripped, cycles fail

- **Priority:** P0
- **Covers:** CAP-3, FR-3
- **Trigger:** Fixture rows reproducing the audited palateful shapes: a
  `Blocked-by:` annotation with trailing prose (`ifh3, ifh4 (consumes their
  \`failed: true\` records)`), one with markup-wrapped hashes
  (`~~rsh101~~ …, **now debug-rshred1**: …`), one with a spec-path blocker
  (`debug/debug-<hash>-….md`); plus two specs blocking each other and a
  spec blocking itself.
- **Expectation (EARS):** When a `Blocked-by:` annotation contains tokens
  that are not known spec hashes, the system SHALL drop each unknown token
  with a warning naming the source row and SHALL render zero phantom nodes;
  when a real hash is wrapped in `~~`/`**` or trailing punctuation the
  system SHALL still recover the edge; when a blocker is written as a spec
  path the system SHALL resolve it to its hash including across types; and
  when the blocking edge set contains a cycle the system SHALL exit
  non-zero enumerating every hash in the cycle and SHALL NOT write
  GRAPH.md.
- **Threshold:** 0 phantom nodes across all fixture rows; 100% of the real
  edges recovered (including `rsh101` and `debug-rshred1` analogues); both
  cycle cases fail naming all participants.
- **Verified by:** `_devx/workstreams/story-graph/evals/E-3_edge-hardening.ts`

## E-4: Edge-source union + heading tolerance across repo dialects

- **Priority:** P0
- **Covers:** G-2, CAP-1, CAP-3, FR-3
- **Trigger:** Two fixtures modeled on the audits: (ffm-shape) done rows
  whose `Blocked-by:` prose was replaced by PR narration but whose
  frontmatter carries `blocked_by:`, under a heading
  `### <slug> (workstream <hash>)`; (palateful-shape) rows with prose-only
  edges, specs with the hyphenated `blocked-by:` key, mixed `##`/`###`
  epic headings with prose suffixes, and one spec whose frontmatter and
  row edge sets disagree.
- **Expectation (EARS):** When the graph model is built, the system SHALL
  union row-annotation and frontmatter edges per spec (deduped), SHALL
  read the hyphenated `blocked-by:` key with a normalization warning,
  SHALL group rows under both audited heading variants with the workstream
  hash resolved, and SHALL emit a drift warning naming the hash and both
  edge sets where the two sources disagree.
- **Threshold:** complete expected edge set recovered from both fixtures
  (0 missing, 0 extra); 2/2 heading variants grouped with non-null
  workstream hash; drift warning fires on exactly the disagreeing spec.
- **Verified by:** `_devx/workstreams/story-graph/evals/E-4_source-union.ts`

## E-5: State-flipping flows leave GRAPH.md fresh

- **Priority:** P1
- **Covers:** G-3, UC-2, UC-3, CAP-4, FR-4
- **Trigger:** The claim helper, the merge-cleanup path, and the RED-stage
  emission path run in a fixture repo with a committed, fresh GRAPH.md.
- **Expectation (EARS):** When a claim flips a spec to in-progress, a
  cleanup flips it to done, or an emission adds new specs, the system SHALL
  regenerate GRAPH.md within the same helper invocation so that
  `devx graph --check` exits 0 immediately afterward.
- **Threshold:** `--check` exits 0 after 100% of the exercised flows
  (claim, cleanup, emission) with no manual regen step in between.
- **Verified by:** `_devx/workstreams/story-graph/evals/E-5_loop-freshness.ts`

## E-6: Backfill is mechanical-first, adds-only, idempotent

- **Priority:** P0
- **Covers:** G-2, UC-4, CAP-5, FR-5
- **Trigger:** `devx graph backfill` run twice against the ffm-shape and
  palateful-shape fixtures from E-4, including a workstream reachable only
  via dev-spec `from:` (no PLAN.md row), a workstream directory with no
  plan.md, a non-directory file inside the workstreams root, and one spec
  whose ordering is mechanically underivable.
- **Expectation (EARS):** When backfill runs, the system SHALL write the
  missing side of each unioned edge in canonical `blocked_by` underscore
  form, SHALL derive additional edges only from durable state (`phase:`
  frontmatter, `(dev spec: <hash>)` plan pointers, todo.md pointers),
  SHALL discover workstreams via the `from:` → `workstream:` bridge
  without requiring PLAN.md rows or plan.md files, SHALL list underivable
  specs in its report instead of guessing, SHALL never delete an existing
  edge, and when run a second time SHALL change 0 files.
- **Threshold:** written edges exactly match the fixtures' expected
  mechanical union; ≥1 underivable spec reported; 0 deletions; second run
  is a 0-file no-op; exit 0 on every drifted fixture.
- **Verified by:** `_devx/workstreams/story-graph/evals/E-6_backfill.ts`

## E-7: Ships in the package for downstream repos

- **Priority:** P1
- **Covers:** G-2, CAP-5, FR-6
- **Trigger:** The built package's CLI run in a downstream-shaped fixture
  directory outside the devx repo (laid out like friend-finder-mesh /
  palateful, including their audited drift).
- **Expectation (EARS):** When the packaged CLI runs `devx graph` in a
  downstream-shaped repo, the system SHALL resolve state relative to that
  repo's root and write its GRAPH.md there, with no dependency on
  devx-repo-only files.
- **Threshold:** GRAPH.md produced in the downstream fixture; 0 reads
  outside the fixture root (asserted via the resolved paths in the run
  report/verbose output).
- **Verified by:** `_devx/workstreams/story-graph/evals/E-7_downstream-portability.ts`
