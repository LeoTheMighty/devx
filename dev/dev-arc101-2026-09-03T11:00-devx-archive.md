---
hash: arc101
type: dev
created: 2026-09-03T11:00:00-06:00
title: "`devx archive` — retire a closed workstream out of the live list"
from: null
spawned: []
status: in-progress
owner: /devx-2026-09-03T1101-38694
branch: null
---

## Goal

`engine.archive_root` is written into every config `devx init` produces
(`init-write.ts:533`) and **read by nothing**. There is no `devx archive`. So a
closed workstream stays in `_devx/workstreams/` forever, and the live list is
whatever has ever been worked on rather than what is being worked on now.

This repo is the demonstration: 10 workstream directories, 6 live. The other
four (`execute-rehome-bmad-eject`, `harness-fold-in`,
`multi-loop-concurrency`, `story-graph`) are finished and indistinguishable at
a glance from the six that are not.

Same inert-key class as `docs.layout` before dlr101 and `stampEvalShas` in
`debug-75563d`: a documented knob that does nothing, which is worse than an
absent one because it reads as a working feature.

**Second, larger reason.** `project-level` holds exactly one in-flight doc set
(CONFIG.md §15 rule 4). Without archiving, a project-level repo can never
start a *second* unit of work — finishing the first one leaves its artifacts
occupying the root forever. Archiving is the missing lifecycle step that makes
that layout sustainable rather than one-shot. ClassyLights migrates to it this
week and hits this the moment `scene-engine` closes.

## Acceptance criteria

1. `devx archive <hash|slug> [--dry-run]` moves the workstream's doc set to
   `<engine.archive_root>/<slug>/` with `git mv`, then re-points the plan
   spec's `workstream:` field. `--dry-run` renders the moves and makes none.
2. `devx archive --restore <hash|slug>` is the inverse and round-trips
   losslessly, exactly as `layout migrate`'s two directions do.
3. **An archived workstream still resolves.** `devx status`, `devx next` and
   `devx outcome` find it by following the re-pointed `workstream:` field.
   This is why re-pointing is mandatory, not cosmetic: the filename fallback
   (`planFilenameWorkstreamRel`) derives `<workstreams_root>/<slug>` and would
   send resolution straight back to the path the archive just emptied.
4. Refusals, each computed before any move, each exiting 1 having moved 0
   files, and **no `--force`**:
   - `workstream-live` — the target's `stage` is neither `done` nor `retired`.
     Names the stage found. This is the whole safety property; everything else
     is a precondition.
   - `destination-occupied` — `<archive_root>/<slug>` already exists.
   - `no-workstream` — the hash resolves to no doc set.
   - plus the shared preconditions already implemented for `layout migrate`:
     `dirty-tree`, `untracked-sources`, `nested-repo-root`, `not-a-git-repo`.
5. **Under `project-level`, archiving moves the ROOT doc set** into
   `<archive_root>/<slug>/` (slug from the plan spec's filename, which is the
   only identity a flat repo's workstream has — `planFilenameSlug`), leaving
   the root free for the next unit of work. This is the AC that makes the flat
   layout sustainable; it is not an edge case bolted on.
6. **No second copy of the move machinery.** `Move`, `Refusal`, `MovePlan`,
   `readPlanSpecs`, `isLive`, `renderMovePlan`, `executeMigration`,
   `untrackedSourcesRefusal`, `nestedRepoRootRefusal`, `dirtyTreeRefusal` are
   already exported from `src/lib/layout/migrate.ts` and are generic over
   source/destination. Archive supplies a different PLANNER and reuses the
   executor. A test asserts the two commands share one executor rather than
   two that can drift (the `scanOutlineDiff` precedent from the outline work).
7. `devx doctor` gains no finding for un-archived closed workstreams. Clutter
   is not debris, and doctor's exit 3 is not the right instrument for taste
   (the `unset-docs-layout` reasoning, recorded in `next/gather.ts`).

## Technical notes

- Liveness is `isLive()` at `src/lib/layout/migrate.ts:310` — reuse it rather
  than re-deriving "done or retired" from `frontmatter.ts`'s stage list.
- `executeMigration` already does moves → spec frontmatter → config in that
  order. Archive needs the first two and **not** the third: `docs_layout` is
  unchanged by archiving. Check whether the config write is separable before
  assuming the executor drops in unchanged; if it is not, make it so rather
  than forking the function.
- `resolveWorkstream` (`workstream.ts:821`) joins the spec pointer against
  repoRoot and probes existence, so an archived path resolves with no change
  there — verify with a test rather than by reading.
- Empty-parent pruning after the move: `layout migrate` already prunes
  (`pruned:` in its JSON); the same behavior applies.

## Non-goals

- **Auto-archiving at workstream close.** Tempting, and probably right later,
  but it turns a `stage: done` write into a filesystem move — a side effect on
  a path that runs unattended in `devx loop`. File it as a follow-up once the
  manual verb has been used a few times.
- Any change to `devx outcome` scoring, or to what `GRAPH.md` renders.

## Status log

- 2026-09-03T11:00 — Filed after `devx layout migrate --to project-level`
  refused on this repo with `[two-live-workstreams]` (6 live, 10 doc sets).
  The owner's underlying complaint was clutter, not layout; archiving is the
  operation that was actually missing. `engine.archive_root` confirmed to have
  zero readers in `src/` outside `init-write.ts`'s writer.
- 2026-09-03T11:01:47-06:00 — claimed by /devx in session /devx-2026-09-03T1101-38694

## Links

- `src/lib/layout/migrate.ts` — the planner/executor/refusal machinery to reuse
- `docs/CONFIG.md` §15 — `docs_layout`, and rule 4 (one in-flight doc set)
- `dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md` — the precedent story
