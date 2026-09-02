---
hash: 7b39ad
type: test
created: 2026-09-02T10:55:00-06:00
title: "QA walkthrough — workstream resolution + the layout-tree-mismatch finding (dlr103)"
from: dev/dev-dlr103-2026-09-02T09:14-workstream-resolution-flat-guard.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `dlr103`

> Phase 3 makes a hash resolve to the repo root under `engine.docs_layout:
> project-level` and adds a `layout-tree-mismatch` doctor finding. The
> user-visible surfaces are `devx doctor` (one new report-only class), `devx
> status` (the slug it renders per workstream) and `devx todo sync` (the title
> it writes into a scaffolded `todo.md`). It does NOT cover `devx layout
> migrate` (phase 6, does not exist yet — the advice string names it
> deliberately, R-10) or layout-aware scaffolding (phase 4).

## Pre-flight

```bash
cd /Users/leonidbelyi/personal/devx
npm ci --silent      # only if node_modules is cold
```

## Manual checks

### 1. devx's own output is untouched — this repo is `workstream` layout

- [x] `machine` — every layout branch added here is dormant on a `workstream`
      repo, so devx's own `doctor` / `status` / `next` must be byte-identical
      to `main`.

```bash
cd /Users/leonidbelyi/personal/devx/.worktrees/dev-dlr103
# main's CODE against THIS repo's state, so only the code differs
mkdir -p .devx-cache/scratch/main-tree && git archive main | tar -x -C .devx-cache/scratch/main-tree
diff <(npx tsx .devx-cache/scratch/main-tree/src/cli.ts doctor --json) \
     <(npx tsx src/cli.ts doctor --json)
diff <(npx tsx .devx-cache/scratch/main-tree/src/cli.ts status) \
     <(npx tsx src/cli.ts status)
diff <(npx tsx .devx-cache/scratch/main-tree/src/cli.ts next --json) \
     <(npx tsx src/cli.ts next --json)
```

Expected:

```
(no output from any diff — all three byte-identical)
```

Invariant: this story ships resolution only. Any diff here means a layout
branch fired on the folder layout, which is a regression in the one repo that
matters most.

### 2. A `project-level` repo resolves its hash to the repo root

- [x] `machine` — all three `workstream:` frontmatter states (`.`, absent, a
      stale `<root>/<slug>`) resolve to the repo root; the folder layout is
      unchanged.

```bash
npx tsx _devx/workstreams/docs-layout-resolution/evals/E-4_resolve-workstream.ts
```

Expected:

```
E-4 GREEN — all 3 frontmatter states resolve to the repo root under project-level; the folder layout is unchanged.
```

Invariant: the absent-key case must never produce a `<root>/<slug>` string.
That is the filename-derived fallback running in a repo with no folders, and
every artifact read downstream then points at a directory that cannot exist.

### 3. An interrupted migration is reported, not silent

- [x] `machine` — a repo whose `engine.docs_layout` says `project-level` while
      a workstream doc set is still on disk gets exactly one
      `layout-tree-mismatch`, report-only.

```bash
cd /Users/leonidbelyi/personal/devx/.worktrees/dev-dlr103
# build a project-level fixture, then leave a folder-layout doc set behind
mkdir -p .devx-cache/scratch
cat > .devx-cache/scratch/mk.ts <<'EOF'
import { mkWorkstreamFixture } from "../../_devx/workstreams/docs-layout-resolution/evals/_fixture.js";
console.log(mkWorkstreamFixture({ prefix: "qa-dlr103", layout: "project-level", withPlan: true }).root);
EOF
R=$(npx tsx .devx-cache/scratch/mk.ts)
mkdir -p "$R/_devx/workstreams/scene-engine/prd" && cp "$R/prd.md" "$R/_devx/workstreams/scene-engine/prd/agent.md"
(cd "$R" && npx tsx /Users/leonidbelyi/personal/devx/.worktrees/dev-dlr103/src/cli.ts doctor)
```

Expected:

```
devx doctor: 1 finding(s) - none mechanically fixable
  [report]  layout-tree-mismatch: engine.docs_layout is 'project-level' (artifacts at the repo root) but _devx/workstreams/scene-engine/ still holds a workstream-layout doc set — every resolver now reads past it. Repair: `devx layout migrate --to project-level` (report-only here: the move touches authored work)
```

Invariant: `[report]`, never `[fixable]`. The repair moves authored documents,
which is the far side of doctor's fix boundary (`doctor/types.ts` header).
`--fix` must never touch this class.

### 4. The macOS case trap — `PLAN.md` is not `plan.md`

- [x] `machine` — on a case-insensitive filesystem `existsSync("<root>/plan.md")`
      is TRUE for a repo carrying `PLAN.md`. The root probe must read a
      directory listing and compare exactly, or it fires on every devx repo.

```bash
npx vitest run test/engine-layout-resolve-workstream.test.ts \
  -t "does not mistake an uppercase backlog file" 2>&1 | tail -5
```

Expected:

```
 Test Files  1 passed (1)
      Tests  1 passed | 42 skipped (43)
   Start at  10:58:22
   Duration  365ms
```

Invariant: the test builds a REAL temp repo with a real `PLAN.md` and runs the
detector through `realDoctorFs`. A fake fs cannot prove this — its keys are
case-sensitive by construction, so it would pass either way.

### 5. The full local gate

- [x] `machine` — lint + typecheck + the whole suite, run in the worktree.

```bash
cd /Users/leonidbelyi/personal/devx/.worktrees/dev-dlr103 && npm test --silent
```

Expected:

```
RUN  v2.1.9 /Users/leonidbelyi/personal/devx/.worktrees/dev-dlr103   <- pass 1 root
 Test Files  136 passed (136)
      Tests  3248 passed | 6 todo (3254)

RUN  v2.1.9 /Users/leonidbelyi/personal/devx/.worktrees/dev-dlr103   <- pass 2 root
 Test Files  34 passed (34)
      Tests  825 passed (825)

REAL_EXIT=0
```

Invariant: read the "Test Files … passed" summary, not the exit code — a
killed run can still report 0 (`feedback_never_kill_the_gate`). And read the
`RUN v… <root>` line: `npm test` was run once from the MAIN worktree by
mistake during this story and reported green at 135 files / 3205 tests while
testing `main`, with this story's 43-test file absent. 136 files here, and
both roots naming `.worktrees/dev-dlr103`, is what makes the green mean
something.

### 6. The rendered doctor line reads well to a human

- [ ] `human` — the `layout-tree-mismatch` detail is one line an operator can
  act on without re-deriving anything · how to verify: run check 3 above and
  read the `[report]` line — it should name the configured layout, the
  offending path, the consequence ("every resolver now reads past it") and the
  repair command, in that order, with no jargon that only the diff explains.

Invariant: doctor is an advisory channel. A finding an operator cannot act on
from its own text is the noise that trains people to ignore the channel.

## Regressions to watch

- **`devx status` / `devx todo sync` identity under `project-level`.** Both
  derived a slug by taking the tail of the workstream dir; under this layout
  that dir is `.`, so `status` rendered `. (b7e38f)` and `todo sync` titled the
  scaffolded file "`.`". Both now route through `workstreamSlugFor()`. Fastest
  proof: `devx status` in a project-level fixture must print
  `scene-engine (b7e38f)`, and `head -1 todo.md` after a sync must read
  `Scene Engine working memory`.
- **A stale `workstream:` pointer bypassing the layout guard.** The `??`
  fallback used to be spelled at each call site, so a spec that HAS a pointer
  never reached the layout-aware helper — `devx status` on `main` reports "no
  active workstreams" for such a repo. Anything that reintroduces
  `state.workstream ?? planFilenameWorkstreamRel(…)` at a call site
  reintroduces the bug; use `planSpecWorkstreamRel()`.
- **False positives on foreign repos.** `prd.md` / `design.md` / `plan.md` are
  ordinary filenames. The root-level probe is gated on the repo carrying at
  least one engine-managed plan spec; dropping that gate makes `devx doctor`
  nag every repo that keeps a hand-written `plan.md`.

## Post-merge follow-ups

- `devx layout migrate` does not exist until **dlr106** (phase 6). Until then
  the finding's advice names a command the operator cannot run — inert text by
  design (plan R-10), and dlr107's doc-truth test is what catches it if phase 6
  slips.
- `createWorkstream` still resolves its base to `<workstreams_root>/<slug>`
  under every layout, so `devx workstream new --hash` on a `workstream: .`
  spec still refuses on the rebind guard. **dlr104** (phase 4) moves that base
  to the repo root, which dissolves the refusal structurally.
