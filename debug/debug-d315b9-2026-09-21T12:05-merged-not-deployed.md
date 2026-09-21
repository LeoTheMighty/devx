---
hash: d315b9
type: debug
created: 2026-09-21T12:05:00-06:00
title: "The helper path skips three steps the /devx skill enforces — deploy, status-log discipline, Phase 4 review — and each skip is silent"
from: debug/debug-2e1174-2026-08-21T16:05-blocking-pass-timeout-headroom.md
status: ready
owner: null
branch: null
---

## Goal

When a fix is merged to `main`, the `devx` every session actually runs
should either carry that fix or refuse to pretend it does. Today it does
neither: it keeps running the old build and prints a one-line warning that
is routinely ignored — and, in at least one session, filtered out by
construction.

## What happened (2026-09-21, measured)

- `dist/cli.js` in the main checkout was built at **10:24** by a `finalize`
  of 828385.
- #167 (7d96be — claim resolves any spec type) and #168 (D-14) were then
  merged by the coordinator session via **`gh pr merge`**, which does not
  run `finalize`, and `finalize` is the only thing that rebuilds `dist/`.
- So #167 was **merged but not deployed**. Proven by behaviour, not by
  timestamps: `devx devx-helper claim 2e1174` with no `--type` failed
  exactly the pre-#167 way — `no spec file found at …/dev/dev-2e1174-*.md`,
  exit 2 — on a binary whose own source on `main` said it should succeed.
- After a manual `npm run build:swap` at 11:35:40, `devx devx-helper
  verify-claim 2e1174` with no `--type` resolved the debug spec, exit 0.
  That is the fix arriving an hour after its merge, because someone noticed.

## The signal existed and did not work

`src/cli.ts:179-195` (`isBuildStale` → `staleBuildWarning`) printed a
stale-build warning on **every** `devx` invocation for that whole hour. It
changed nothing, for two different reasons, and the second is the sharper:

1. **Habituation.** The coordinator session reports reading straight past
   it for hours. Same cost cc raised about `f83b04`'s dead-owner noise: a
   warning that fires on every call is read as decoration.
2. **Filtered by construction.** The session that found this (palateful-fb)
   piped nearly every `devx` call that day through `grep -v "^devx: "` to
   get clean JSON — which strips exactly this warning, because it shares the
   `devx: ` prefix with ordinary chatter. It saw the warning only on the one
   call where it used `cat` instead. **The warning was not ignored; it was
   never shown.** Any agent that post-processes CLI output will do the same,
   and agents are the primary users.

A signal that shares its channel and its prefix with noise will be filtered
with the noise. That is a design property, not an operator failing.

## Two more instances of the same defect (added 2026-09-21)

The rebuild gap is one of **three** steps the `/devx` skill performs that
the hand-run helper path (`claim` → edit → PR → `gh pr merge` → `mark-done`)
silently skips. All three were hit on the same day, by the same session and
the coordinator, on real merges.

### Instance 2 — `mark-done` can redden `main`, and the PR's CI cannot see it

`test/devx-status-log-discipline.test.ts` (dvx103) requires a `phase 4:`
line on every shipped dev spec. It decides "shipped" from `status: done` *or*
a `phase 5:`/`phase 7:` status-log line — and those phase lines are written
**by the skill, on the feature branch**, which is what lets the check fail a
skill-run PR before merge. A helper-run item writes no phase lines, so on its
PR branch it is not yet "shipped" and the check passes vacuously. It becomes
"shipped" only when `mark-done` flips `status: done` **on `main`** — at which
point `main` goes red.

Measured: dev-5c215e (PR #168, CI green) was closed with `mark-done` at
`74d93cd`; `main`'s CI went red at that commit and stayed red for three
commits / ~45 minutes until `87040e9` added the line. The closing session
then pushed two more commits onto red `main` without checking — the same
"signal existed, nothing made you look" as instance 1.

### Instance 3 — helper-run items skip Phase 4 review entirely

`/devx` Phase 4 is a parallel adversarial self-review; the `phase 4:` line
is its audit trail. The helpers do not run it and do not require it. On
2026-09-21 the coordinator checked all eight PRs it merged that day: **none**
had a parallel adversarial review. Leo chose retroactive cross-reviews of the
three highest-blast-radius (#167 by palateful-2d, #164 by palateful-cc, #162
by devx-b6). It surfaced only because the filer, asked to add the missing
line for instance 2, wrote one saying what did *not* run instead of one
implying a review.

### Instance 4 — the check that would catch instance 3 cannot see where it happened

Reported by palateful-2d; verified and measured here. dvx103's check reads
only `dev/` (`DEV_DIR`, `test/devx-status-log-discipline.test.ts:58`,
`:135`), and its assertion names "dev spec". Most of the eight PRs merged on
2026-09-21 were **`debug/`** specs (828385, wsmig1, 7d96be, …). So when Phase 4
was skipped across all eight, CI **structurally could not** have flagged it:
the guard never looks where the omission was. It is the only mechanism
behind CLAUDE.md's "Phase 4 is non-skippable", and it is scoped so that
it cannot enforce that for debug items. Same shape as 108c57's AC 15: a
rule that does not reach the files it was written for.

Instances 1–3 are the helper path *skipping* a step; instance 4 is the
*check* for that skip being unable to see it.

**Measured population, 2026-09-21:** 41 `debug/` specs, 29 `status: done`,
**7 done with no `phase 4:` line** — `7c1e93`, `7d96be`, `9f24c7`, `b365ac`,
`e3f1c2`, `f4149e`, `wsmig1`. The other 22 already carry one, so the
convention is mostly followed by hand; extending the check turns 7 specs red,
not a large batch. Two of the 7 are this filer's (`f4149e`, `7d96be`); they
were deliberately **not** backfilled here, because grandfather-vs-retroactive
is the sequencing decision this AC exists to make, and `7d96be` is inside
palateful-2d's fix-forward from its retroactive review.

### Why these are one defect

Each is a step the skill enforces by *doing* it, so nothing ever had to
*check* for it — and the helper path, which does not do it, inherits no
check. Instances 2 and 3 converge on one enforcement point: **close time.**
A `mark-done` that refused to close a dev spec with no `phase 4:` line would
have caught both — the red `main` (instance 2) and, by forcing the question
"did a review run?", the missing reviews (instance 3).

One limit, stated so the fix is not oversold: a close-time check can require
the line to **exist** and to **say what ran**; it cannot verify that a review
happened. The line is a claim, and its honesty is the writer's. That is
`plan-4c827d`'s proxy-vs-claim distinction, and no check here closes it.

## Acceptance criteria

- [ ] AC 1: A merge to `main` of a change under `src/` results in a rebuilt
      `dist/` without anyone remembering to run `finalize` — e.g. the merge
      path rebuilds, or `devx` rebuilds (or swaps) on first invocation after
      detecting staleness. Pick one; say why.
- [ ] AC 2: If a stale build is ever *run* (the rebuild failed, or was
      skipped), it is **not** a line of stderr sharing the `devx: ` prefix.
      Either the command refuses for mutating subcommands (claim, mark-done,
      finalize, split), or staleness is carried **in the structured
      output** — a field in the JSON every caller already parses — so a
      pipeline that keeps the JSON keeps the signal.
- [ ] AC 3: Regression test: a build older than HEAD running a mutating
      subcommand either refuses or reports staleness in the JSON payload;
      and `grep -v "^devx: "` applied to its output does NOT remove the
      signal.
- [ ] AC 4: Read-only subcommands keep working on a stale build — refusing
      `verify-claim` or `next` would turn a deploy lag into an outage.

- [ ] AC 5 (instance 2): `mark-done` on a dev spec with no `phase 4:`
      status-log line refuses before writing anything, naming the missing
      line — so a close can no longer turn `main` red for a check the PR
      could not run. Same rule as dvx103, applied at the moment it would
      otherwise first bite.
- [ ] AC 6 (instance 3): the refusal message says what the line is for
      (the Phase 4 review audit trail) and that it must state what review
      actually ran — including "none" — rather than a template to paste.
      A refusal that is satisfied by pasting boilerplate reproduces
      instance 3.
- [ ] AC 8 (instance 4): dvx103's check covers `debug/` specs as well as
      `dev/`. The 7 currently-done debug specs without a `phase 4:` line are
      resolved **in the same change** — each either gets a retroactive line
      that says honestly what review ran (including "none"), or a grandfather
      entry with a reason — so extending the check does not turn `main` red
      (instance 2's failure, reproduced by the fix for it). Prefer honest
      retroactive lines; a grandfather entry is a permanent exemption.
- [ ] AC 7: the skill body's hand-run guidance (or `mark-done --help`)
      names all three steps the helper path does not perform — rebuild,
      status-log discipline, Phase 4 — so an operator choosing the helpers
      chooses them knowingly.

## Technical notes

- `build:swap` is the atomic rebuild `finalize` already uses; the
  coordinator ran it by hand, after first confirming no peer was mid-work in
  the main checkout. Any automatic version of AC 1 has to preserve that
  property — swapping `dist/` under a session holding uncommitted work is
  the hazard 4f's untracked-spec lesson recorded.
- Relationship to `plan-4c827d` / `inert1`: this is a detector that *fires
  correctly* and still informs no one, because of where its output lands.
  Same family as AC 5 of `inert1` ("output lands somewhere consumed").

## Status log

- 2026-09-21T12:05 — filed at the coordinator's request, from 2e1174's
  claim. Found because a claim that #167 should have made succeed failed
  the old way; confirmed by behaviour before and after a manual swap.
  Includes the filer's own contribution to the miss (the `grep -v` filter).
- 2026-09-21T12:45 — broadened, at the coordinator's request, from one
  instance to three: `gh pr merge` skipping the rebuild (original),
  `mark-done` reddening `main` on a dvx103 check the PR could not see, and
  helper-run items skipping Phase 4. Retitled to the shared defect. Instance 2
  is the filer's own (5c215e, `74d93cd`).
- 2026-09-21T13:05 — added instance 4 (reported by palateful-2d): dvx103
  reads only `dev/`, so it could not flag the Phase 4 skips on the debug-type
  PRs that made up most of the day's merges. Measured: 7 of 29 done debug
  specs lack the line. AC 8 requires resolving those 7 in the same change.
