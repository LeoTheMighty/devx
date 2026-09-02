---
hash: 7fd3a7
type: test
created: 2026-09-02T14:45:00-06:00
title: "QA walkthrough — devx layout migrate (dlr106)"
from: dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `dlr106`

> Adds `devx layout migrate --to <layout> [--dry-run]`, the only devx command
> that rewrites a user's artifact tree. Surfaces: the new CLI subcommand, its
> `--dry-run` render, its eleven refusal messages, and the `devx --help`
> listing. This walkthrough deliberately does NOT cover the ClassyLights run
> itself — that is cross-repo and irreversible (R-5) and belongs to
> `MANUAL.md` MV-a494be.1, which is where G-3's real evidence lives.

## Pre-flight

```bash
cd /Users/leonidbelyi/personal/devx        # or your devx checkout
npm ci                                     # if node_modules is cold
```

Every `machine` check below runs the CLI from source through `tsx`, so no
build step is required and none can assert against a stale `dist/`.

## Manual checks

### 1. The command is registered and discoverable

- [x] `machine` — `devx layout migrate` exists, is listed under `devx --help`,
  and its own help names the refusals rather than promising success.

```bash
npx tsx src/cli.ts --help | grep -A3 '^  layout'
```

Expected:

```
  layout                       Artifact-tree layout operations
                               (engine.docs_layout). `migrate --to <layout>`
                               moves the doc set between the workstream and
                               project-level shapes with `git mv`.
```

Invariant: a destructive command has to be findable before it is run. If this
line disappears, `attachPhase(sub, 1)` or the `src/cli.ts` registration was
dropped and `test/help.test.ts` should have caught it.

### 2. Both RED evals are GREEN

- [x] `machine` — E-6 (a mid-flight migration preserves every gate verdict) and
  E-7 (it refuses rather than half-moving) both pass.

```bash
npx tsx _devx/workstreams/docs-layout-resolution/evals/E-6_migrate.ts
npx tsx _devx/workstreams/docs-layout-resolution/evals/E-7_migrate-refusals.ts
```

Expected:

```
E-6 GREEN — 8 of 8 files migrated by git mv; gate_status and gate_verdicts byte-identical; the next gate runs.
E-7 GREEN — 3 of 3 refusal conditions exit 1 with 0 files moved; --dry-run moves nothing.
```

Invariant: these are the expectations the RED gate stamped. Their step bodies
are locked; if one of them has to change, that is `devx gate evals <hash>`,
not an edit.

### 3. The migration moves the doc set and preserves both gate verdicts

- [x] `machine` — the full suite for this story: 26 assertions across the two
  registered test files, including the byte-lossless round trip.

```bash
npx vitest run test/engine-layout-migrate.test.ts test/engine-layout-migrate-refusals.test.ts
```

Expected:

```
 Test Files  2 passed (2)
      Tests  26 passed (26)
```

Invariant: `gate_status` and `gate_verdicts` live in the plan SPEC, which does
not move — so they survive by construction. A test that starts asserting they
were "copied correctly" means the design changed underneath.

### 4. `--dry-run` is honest on a real repo

- [ ] `human` — on a repo you actually own, the rendered plan names every file
  it would move, and the repo is untouched afterwards. · how to verify: in a
  scratch clone of a devx repo run
  `devx layout migrate --to project-level --dry-run`, read the move list, then
  `git status` — it must be byte-identical to before, and no `prd.md` at the
  root.

Invariant: `--dry-run` is the mitigation R-5 leans on. It reaches the planner
and never the executor, so this is structural — but the refusal set is
evaluated identically for both, and a dry run that succeeds where the real run
refuses would be a dry run that lied.

### 5. A refusal reads like instructions, not like an error

- [ ] `human` — trigger one refusal and judge the message on whether you know
  what to do next without reading the source. · how to verify: in a scratch
  clone, edit any tracked file (do not commit) and run
  `devx layout migrate --to project-level`; you should get exit 1,
  `refused [dirty-tree]`, the count of dirty paths, and the sentence "Commit or
  stash first, then re-run."

Invariant: there is no `--force`. Every refusal names a state where moving
loses information, so the message IS the remedy — if it does not say what to
do, the refusal is incomplete.

### 6. The rollback works

- [ ] `human` — migrate forward, then back, and confirm the tree returns.
  · how to verify: in a scratch clone with one workstream:
  `devx layout migrate --to project-level` → `git add -A && git commit` →
  `devx layout migrate --to workstream` → `git diff HEAD~2 HEAD --stat` shows
  only `devx.config.yaml`.

Invariant: after the fact, a second migration in the opposite direction is the
ONLY recovery R-5 has. It works because the emptied source directories are
pruned — `docSetPresentAt` reads a workstream directory's mere existence as a
doc set, so any leftover shell makes this refuse forever.

## Regressions to watch

- **The `plan.md` / `PLAN.md` collision (debug-135dc9).** On macOS these are
  one file, so migrating a repo that has authored its plan refuses
  `[destination-clash]`. That is correct today. The pin is macOS-only: the
  clash predicate asks the filesystem rather than assuming a platform, so on
  Linux CI those names coexist, the refusal correctly does not fire, and the
  test skips. **A green Linux run is not evidence this pin holds** — read it on
  macOS.

- **Silent stranding.** The migration enumerates the DOC SET, not the artifact
  map. If someone re-derives the move list from `ALL_ARTIFACT_KINDS` alone,
  `RETRO-<date>.md` and `research/` go back to being left behind while the run
  reports success. The fastest proof: drop a `RETRO-2026-01-01.md` into a
  workstream directory and confirm you get `[unmapped-doc-set-files]`, not
  exit 0.

- **`devx --help` snapshot.** `test/help.test.ts` carries an inline snapshot of
  the whole listing. Any wording change to the `layout` description reds it;
  refresh with `npx vitest run test/help.test.ts -u`, do not hand-edit.

## Post-merge follow-ups

- `debug-00b4d3` — a migration commit is blocked by `devx outline check`,
  because the migration moves human-only outlines (AC 8) and the check
  classifies by name. Worked around in MV-a494be.1 until fixed.
- `debug-135dc9` — the general `plan.md`/`PLAN.md` case collision under
  `project-level`. This story treats it as a refusal input, which is the
  obligation that spec assigned it; the naming fix is still open.
- `MANUAL.md` MV-a494be.1 — the ClassyLights `b7e38f` run. G-3's real
  evidence, and the only thing that proves this on a repo devx does not own.
