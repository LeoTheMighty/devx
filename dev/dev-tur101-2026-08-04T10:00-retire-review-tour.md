---
hash: tur101
type: dev
created: 2026-08-04T10:00:00-06:00
title: Retire the review tour — rip out `devx tour`, PR-body section, and Phase 7.5
from: null
spawned: []
status: in-progress
owner: null
branch: main
---

## Goal

Remove the static-HTML review tour from devx entirely. Owner call
(2026-08-04): the per-PR narration step in `/devx` Phase 7.5 costs more
time than the guided walkthrough returns on a solo pre-launch repo.

Scope is the full subsystem, not just the skill step — leaving a dead
`devx tour` CLI in the tree would be a maintenance tax on every future
refactor and would keep two runtime dependencies alive for nothing.

**What explicitly survives:** `/devx address <pr>` and the `devx: hold`
merge gate (D-5). Human review stays *possible*; it just stops being
narrated. The shared exec seam (`src/lib/tour/exec.ts`) is load-bearing
for `hold-check` / `next` / `loop` and is rehomed, not deleted.

## Acceptance criteria

### Code removal

- [x] `src/lib/tour/{gather,render,publish,schema}.ts` and
      `src/commands/tour.ts` deleted; `devx tour` unregistered from
      `src/cli.ts`.
- [x] `src/lib/tour/exec.ts` rehomed to `src/lib/exec.ts` with its header
      rewritten to describe the general seam; all four importers
      (`devx/hold-check.ts`, `next/gather.ts`, `loop/git-tx.ts`,
      `commands/next.ts`) plus the three test importers repointed.
- [x] `diff2html` and `marked` removed from `package.json` dependencies —
      the tour renderer was their only consumer.
- [x] `npx tsc --noEmit` clean.

### PR body

- [x] The `## 🗺 Review tour` section removed from
      `_devx/templates/pull_request_template.md` and from
      `BUILTIN_TEMPLATE` in `src/lib/pr-body.ts`.
- [x] `TOUR_PLACEHOLDER`, `TourSectionData`, `TourStopSummary`,
      `renderTourSection`, the `tour` render option and the
      `tourSectionSkipped` result field all deleted; `--tour-url` /
      `--tour-orientation` / `--tour-unavailable` removed from
      `devx pr-body`.
- [x] **Stale on-disk templates render clean**: a repo that ran
      `/devx-init` between v2t101 and tur101 still carries the section in
      `.github/pull_request_template.md`. `renderPrBody` strips the
      canonical heading+placeholder pair so no PR body ever shows a dead
      heading over a bare placeholder — and never reports it as an
      unresolved placeholder. Line-anchored: prose that merely *mentions*
      a review tour is left alone.

### Skills

- [x] `/devx` Phase 7.5 deleted outright; the `review` stage word dropped
      from the dispatch list (review-shaped input routes to Address); the
      Debug arm and Address stage no longer reference tours; frontmatter
      description updated.
- [x] `/devx-plan` D-12 line reads `one phase ≙ one dev spec ≙ one PR`.
- [x] `skills/` mirror re-synced byte-identical (`npm run sync:skills`).

### Tests

- [x] All six `test/tour-*.test.ts` files, `test/devx-skill-tour-discipline.test.ts`
      and `test/fixtures/tour-fixture.ts` deleted.
- [x] `test/spec-resolve-any-type.test.ts` keeps its merge-gate and
      `findSpecForHashAnyType` halves (the non-dev resolution contract
      debug-6a913f was filed for) and drops only the tour-gather half.
- [x] `help.test.ts`, `devx-pr-body-substitution.test.ts` and
      `loop-report.test.ts` assertions updated; loop report no longer
      emits a `Tour:` line.
- [x] New regression coverage for the stale-template strip.
- [x] Full `npm test` green.

### Docs

- [x] `v2/03-review-tour.md` deleted; `v2/README.md` index row marks it
      deleted and points at what survived.
- [x] `v2/07-decisions.md`: D-4 marked RETIRED, D-12 amended, O-1/O-2
      closed, D-5 annotated as surviving. Ledger entries are annotated,
      not erased — the record of what was decided and why stays readable.
- [x] `v2/00-vision.md`, `02-engine.md`, `04-overnight-loop.md`,
      `05-dispatcher.md`, `06-phases.md`, `docs/HOW_TO_USE.md`,
      `docs/ROADMAP.md`, `CLAUDE.md` updated. Historical records (S-2,
      the V2.3 phase section, the shipped-PR table) are annotated as
      shipped-then-retired rather than rewritten.
- [x] `MANUAL.md` row filed for the orphan `devx-tours` branch (deleting
      a remote branch is the user's call, not an agent's).

## Technical notes

- The `devx-tours` orphan branch holds every published tour. Deleting it
  is destructive and outward-facing, so this item leaves it alone and
  files a MANUAL row instead.
- `renderPrBody` gains a trailing-newline normalization: the legacy strip
  can leave the body ending in blank lines, and the CLI's stdout contract
  is one trailing newline.
- Ships on top of the in-flight Phase 5 QA-walkthrough changes (owner
  chose one PR over landing them separately) — those touch the same two
  skill files, so splitting would have meant a conflict-prone rebase.

## Status log

- 2026-08-04T10:00 — filed. Owner call: retire the tour, full rip-out.
  Scope confirmed as full subsystem removal (not skills-only) and
  single-PR-on-top-of-in-flight-work.
- 2026-08-04T10:05 — implementation: 64 files, +1,445/−4,847. `git mv` for
  the exec seam so the rename stays visible in history.
- 2026-08-04T10:40 — phase 5: full local suite surfaced 2 failures.
  (1) REAL REGRESSION — `test/devx-dispatcher-discipline.test.ts` pinned
  `review` in the stage-word list; the file contains no occurrence of
  "tour" so no grep found it. Fixed, and added a test pinning the word's
  ABSENCE so a stage word with no stage can't come back.
  (2) NOT MINE — `test/loop-concurrency.test.ts` G-1 harness timed out at
  600s; passes in 95s in isolation at the same commit; my only change to
  that file is an import-path rename. Filed as `debug/debug-7c1e93`
  rather than expanding scope. Targeted re-run of all 7 affected files
  green (99 tests).
- 2026-08-04T10:50 — self-review catch: I had written into debug-7c1e93
  that `npm test` exits 0 over a red summary. Verified before shipping —
  `npm run test:vitest -- <nonexistent>` exits 1, so npm propagates
  correctly and the exit-0 was the agent harness's background-task
  wrapper. Corrected the spec rather than filing a non-existent bug.
- 2026-08-04T11:00 — phase 7: PR #113 opened, body rendered by
  `devx pr-body` (zero unresolved placeholders, no tour section) — the
  command this PR modified rendering its own PR body.
- 2026-08-04T11:05 — phase 8: remote CI green on both runners
  (run 30930591409, macos + ubuntu, 133 files / 3,060 tests / 1 skipped
  in 27.87s). The CI numbers also narrowed debug-7c1e93: the same suite
  that costs 6,085s of test time locally costs 57s on a runner, so the
  contention-deadlock reading is unlikely and the spec was updated with
  that evidence.

## Links

- Retires: `dev/dev-v2t101-2026-07-05T13:04-review-tour.md`
- Decision record: `v2/07-decisions.md` D-4, D-5, D-12, O-1, O-2
