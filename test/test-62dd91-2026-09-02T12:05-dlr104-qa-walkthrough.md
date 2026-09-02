---
hash: 62dd91
type: test
created: 2026-09-02T12:05:00-06:00
title: "QA walkthrough — consumer sweep and layout-aware scaffolding (dlr104)"
from: dev/dev-dlr104-2026-09-02T09:14-consumer-sweep-scaffolding.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `dlr104`

> Phase 4 of docs-layout-resolution: the ten `*Abs()` helpers become
> layout-aware, every remaining consumer moves onto the resolver, and
> `devx workstream new` learns an optional slug. The user-visible surfaces are
> the CLI outputs of `devx next` / `status` / `graph` / `outcome` /
> `workstream new`. This walkthrough does NOT cover `devx layout migrate`
> (dlr106) or the `*_REL` privatization (dlr105), both of which are still
> deliberately RED.

## Pre-flight

```bash
cd .worktrees/dev-dlr104
npm ci --silent          # or `npm install` if you already have node_modules
npx tsc --noEmit -p tsconfig.json
```

## Manual checks

### 1. Behavior under the shipped layout is byte-identical

- [x] `machine` — this repo runs `engine.docs_layout: workstream`, so every
  command must produce exactly what `main` produces.

```bash
TSX=$(node -e 'console.log(require("module").createRequire("/Users/leonidbelyi/personal/devx/x.js").resolve("tsx/cli"))')
MAIN=/Users/leonidbelyi/personal/devx; WT=$MAIN/.worktrees/dev-dlr104
for cmd in "next" "next a494be" "status" "graph --stdout --format json" \
           "graph backfill --dry-run" "todo sync a494be"; do
  a=$(cd "$MAIN" && node "$TSX" "$MAIN/src/cli.ts" $cmd 2>&1)
  b=$(cd "$MAIN" && node "$TSX" "$WT/src/cli.ts"   $cmd 2>&1)
  [ "$a" = "$b" ] && echo "IDENTICAL: devx $cmd" || echo "DIFF: devx $cmd"
done
```

Expected:

```
IDENTICAL: devx next
IDENTICAL: devx next a494be
IDENTICAL: devx status
IDENTICAL: devx graph --stdout --format json
IDENTICAL: devx graph backfill --dry-run
IDENTICAL: devx todo sync a494be
```

Invariant: AC 10. This phase is cut at the seam where nothing observable
changes for the shipped layout — the whole point of landing the sweep before
the privatization. Any `DIFF:` line is a regression, not a diff.

### 2. `devx workstream new` scaffolds the shape its layout names

- [x] `machine` — all four slug × layout combinations, plus the two refusals.

```bash
npx vitest run test/engine-layout-scaffold.test.ts
```

Expected:

```
 ✓ test/engine-layout-scaffold.test.ts (12 tests) 6541ms
   ✓ [project-level, no slug] writes the complete root doc set (UC-1)
   ✓ [workstream, no slug] refuses with exit 1, naming the layout
   ✓ [project-level, with slug] names the plan spec and no directory
   ✓ [workstream, with slug] still produces the folder-per-artifact tree
   ✓ [project-level] a second workstream is refused, not silently adopted
   ✓ [project-level] re-running is a no-op, not a refusal
   ✓ devx next selects a stage row and names the flat spellings
   ✓ devx next reports row 8 until plan.md exists, then row 9
   ✓ devx next advances to row 9 once plan.md is authored
   ✓ devx status renders the slug and resolves the doc set
   ✓ devx graph derives phase ordering from the root plan.md
   ✓ devx outcome resolves real paths rather than failing on a missing dir

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

Invariant: AC 5, AC 6, AC 9. The no-slug cases are only reachable because the
commander argument is `[slug]` — revert that to `<slug>` and commander rejects
the invocation before any devx code runs, so these pass vacuously.

### 3. No consumer builds a stage-subject path by hand

- [x] `machine` — E-3 scans every module outside the resolver and asserts zero
  GLOBALLY, with its negative control intact.

```bash
npx tsx _devx/workstreams/docs-layout-resolution/evals/E-3_no-hand-joins.ts
```

Expected:

```
E-3 GREEN — 0 hand-joined stage-subject paths outside the resolver; the negative control still discriminates.
```

Invariant: AC 1, AC 4. A GREEN that arrives because the scan was blunted is
the failure this eval exists to catch — the control asserts the five known
bypass expressions are gone from the CODE, not merely absent from the scan.

### 4. The phases this story does not own are still RED

- [x] `machine` — E-2 (dlr105), E-6/E-7 (dlr106), E-8 (dlr107) must NOT be
  green. A phase-4 change that turns them green has reached past its seam.

```bash
for f in _devx/workstreams/docs-layout-resolution/evals/E-*.ts; do
  printf "%-30s " "$(basename $f)"
  npx tsx "$f" >/dev/null 2>&1 && echo GREEN || echo RED
done
```

Expected:

```
E-1_gate-subjects.ts           GREEN
E-2_single-reader.ts           RED
E-3_no-hand-joins.ts           GREEN
E-4_resolve-workstream.ts      GREEN
E-5_scaffold.ts                GREEN
E-6_migrate.ts                 RED
E-7_migrate-refusals.ts        RED
E-8_docs-truth.ts              RED
```

Invariant: the phase boundary. E-2 going green early would mean a constant was
privatized here (AC 10 forbids it); E-6/E-7 going green would mean the
migration surface landed in the wrong phase.

### 5. A flat repo is actually usable end to end

- [ ] `human` — scaffold a throwaway `project-level` repo and drive it through
  the PRD stage · how to verify: run the block below, then confirm `devx next`
  names root files (`prd.md`, not `prd/agent.md`) and that `devx status` shows
  the slug you typed rather than `.`.

```bash
R=$(mktemp -d) && cd "$R" && git init -q -b main
mkdir -p plan _devx/templates
cp -R /Users/leonidbelyi/personal/devx/_devx/templates/engine _devx/templates/
printf 'mode: YOLO\nengine:\n  workstreams_root: _devx/workstreams\n  docs_layout: project-level\n  expectations_min: 3\n' > devx.config.yaml
devx workstream new scene-engine && ls && devx status
```

Invariant: UC-1. The doc set lands at the repo root, `_devx/workstreams/` is
never created, and the plan spec's `workstream:` is `.`.

## Regressions to watch

- **`devx next` row selection.** The spec calls this the most user-visible
  breakage in the workstream: the probes called `prdAbs(wsAbs)` *correctly*
  into a layout-blind helper, so under `project-level` every stage probe
  missed and the dispatcher reported "PRD not yet authored" forever on a repo
  whose PRD sits at `prd.md`. Fastest proof it didn't return: check 2's
  `devx next selects a stage row` case.

- **The `plan.md` / `PLAN.md` case collision.** On macOS and Windows these are
  the same file, so a case-blind `fs.exists` reports the plan artifact authored
  on a repo that has only the backlog. Every artifact-existence probe now goes
  through `artifactExists()`, which confirms the name against a directory
  listing. Fastest proof: check 2's `reports row 8 until plan.md exists` case —
  it runs against a fixture that deliberately contains `PLAN.md`.

- **Template SOURCE lookup.** Templates are workstream-shaped on disk in BOTH
  layouts. Route a template source through `stageSubject()` and every
  flat-repo scaffold dies with `engine template missing`. Fastest proof:
  check 2's `[project-level, no slug]` case, which instantiates all three.

## Post-merge follow-ups

- `debug-135dc9` — the case collision is only half closed. Reads are correct
  now; **writes are not**: authoring `plan.md` in a repo with `PLAN.md`
  truncates the backlog in place (verified). Needs a refusal, not a probe.
- `dlr105` — `src/commands/revise.ts:96,100` still hand-joins
  `ws.workstreamAbs`/`ws.workstreamRel` with `entry.artifact`. E-3 cannot see
  it (the artifact is a variable, so no subject token appears in the node),
  and the fix is the `CASCADE_TABLE` re-key that dlr105 owns.
- `dlr105` — `SCAFFOLD_SUBDIRS` is now referenced only by
  `test/engine-artifacts.test.ts`; `SCAFFOLD_SUBDIR_KINDS` is the live list.
  The privatization pass should delete the right one of the two.
