---
hash: d315b9
type: debug
created: 2026-09-21T12:05:00-06:00
title: "The helper path skips steps the /devx skill enforces — deploy, status-log discipline, Phase 4 review, the finalize tail — and each skip is silent"
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

### Instance 2 — a story can merge without its `phase 4:` line and red `main` instead of its own PR

*Absorbed from `debug-5284ae` (filed 2026-09-02 from dlr105), which carried
the better analysis and is closed as superseded by this spec.*

`test/devx-status-log-discipline.test.ts` (dvx103) requires a `phase 4:`
line on every shipped dev spec. Its ship-stage predicate is `status: done` |
`merged via PR` | a `phase 5:`/`phase 7:` status-log line. **Timing bug in the
predicate, not a missing rule:** the first two are written by `finalize` /
`mark-done` *after* the merge, and the last two exist on the branch only if
the author wrote them — the very discipline the test enforces. So for a story
whose log has no branch-time marker, every ship-stage trigger is post-merge by
construction: the check passes on the feature branch and fires on `main`.

It has happened twice, 19 days apart, and the second time while the first
report sat unclaimed:

- **2026-09-02 — dlr104** (5284ae's case): log went `phase 2:` → `phase 3:`
  → merge; `main` went red when `status: done` landed, ~1h until dlr105
  inherited it.
- **2026-09-21 — dev-5c215e** (this filer's): PR #168 green; `mark-done`
  at `74d93cd` flipped `status: done` on `main`; red for three commits /
  ~45 min until `87040e9`. The closing session then pushed two more commits
  onto red `main` without checking. **The filer had been shown 5284ae as an
  unclaimed item several times that day and never opened it** — a known,
  well-analysed escape route walked a second time because it was never read.

**Where the fix belongs.** 5284ae proposed `devx merge-gate` as the natural
home ("the suite is the wrong instrument for a rule about what a branch may
merge"). Instances 1 and 5 of this same spec qualify that: hand-merges via
`gh pr merge` never run `merge-gate`, so a gate-only check is skipped by
exactly the path this spec is about. **PR CI runs whatever the merge path.**
So the primary fix is a branch-time trigger in the predicate itself (5284ae's
first candidate: any `phase <n>:` line with n ≥ 3), with `merge-gate` as a
second line, not the only one.

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
`e3f1c2`, `f4149e`, `wsmig1`.

**Re-measured after #172 merged (12e8e9e): still 7, but a different 7.**
`7d96be` dropped off (#172 gave it an honest retroactive line); `1dfbdd`
joined — it was closed via `mark-done` at `be5c782`, after instance 5 was
verified, and closed **without** a `phase 4:` line. Current list: `1dfbdd`,
`7c1e93`, `9f24c7`, `b365ac`, `e3f1c2`, `f4149e`, `wsmig1`. **Treat this count
as a moving target:** every debug spec closed through the helper path while
this spec is open can add to it, so AC 8 must re-measure at fix time. The other 22 already carry one, so the
convention is mostly followed by hand; extending the check turns 7 specs red,
not a large batch. Two of the 7 are this filer's (`f4149e`, `7d96be`); they
were deliberately **not** backfilled here, because grandfather-vs-retroactive
is the sequencing decision this AC exists to make, and `7d96be` is inside
palateful-2d's fix-forward from its retroactive review.

### Instance 5 — a hand-merge skips `finalize`'s tail, and the skip hides itself from its own detector

Found by devx-b6, measured by the coordinator, re-verified here
2026-09-21. `debug-1dfbdd` merged as PR #163 at 16:29Z via `gh pr merge`.
Because `finalize` never ran, its tail never ran either: the spec still reads
`status: in-progress`, its DEBUG.md row is still `[/]`, and
`.devx-cache/locks/spec-1dfbdd.lock` is still held (all as of the 2026-09-21 verification; `1dfbdd` was closed afterwards at `be5c782`, so this state is now the historical fixture, not current). `devx doctor --json`
reports **zero** `stale-lock` findings and never mentions `1dfbdd` — because
the status never flipped, the held lock looks like a live claim, which is
exactly what `stale-lock` is designed *not* to flag.

This instance adds a property the others lack: **the gap conceals itself.**
Instances 1–4 leave a detectable trace somewhere (a stale-build warning, a red
`main`, a missing line). Here the skipped step's absence is precisely the
state that tells the detector "nothing is wrong".

### Why these are one defect

Each is a step the skill enforces by *doing* it, so nothing ever had to
Instances 2 and 3 converge on one enforcement point, **and it must be
branch-time, not close-time**: a `phase 4:` requirement that bites on the
PR's own CI would have stopped dlr104 and 5c215e from merging without the
line, and — by forcing the question "did a review run?" before merge — would
have surfaced the missing reviews (instance 3). A close-time check in
`mark-done` (this spec's first proposal) would only have refused the
bookkeeping after the unreviewed code had already merged.

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

- [ ] AC 5 (instance 2, from 5284ae): a repro — a fixture spec whose
      status log carries a `phase 3:` line and no `phase 4:`/`phase 5:`/
      `phase 7:` line is NOT flagged by the current predicate, and IS
      flagged after the fix; dlr104's real (corrected) log is a regression
      fixture.
- [ ] AC 5b: the ship-stage predicate gains a branch-time trigger that does
      not depend on the author having written a later phase line (e.g. any
      `phase <n>:` with n ≥ 3), so the check fires on the PR's own CI —
      which runs regardless of merge path. `merge-gate` may also run it,
      but not instead.
- [ ] AC 5c (from 5284ae): a story that has legitimately not reached Phase
      4 (mid-implementation, `phase 2:` only) still passes — a check that
      fires on work in flight becomes noise the next author learns to
      ignore.
- [ ] AC 6 (instance 3): the check's failure message says what the line is for
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
- [ ] AC 9 (instance 5): a spec whose branch has a **merged** PR but whose
      status is not `done` (or whose lock is still held) is reported — by
      `devx doctor` or equivalent — as a merged-but-unclosed item, not
      treated as a live claim. `1dfbdd`'s state on 2026-09-21 is the
      fixture: doctor reported nothing for it.
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
- 2026-09-21T13:25 — absorbed `debug-5284ae` (same defect as instance 2,
  filed 19 days earlier with the sharper analysis; closed as superseded). The
  filer's close-time `mark-done` proposal is replaced by 5284ae's branch-time
  predicate fix, qualified: `merge-gate` alone is skipped by hand-merges, so
  the check must bite in PR CI. Added instance 5 (hand-merge skips
  `finalize`'s tail; `1dfbdd` merged-but-in-progress with its lock held, and
  `doctor` reports nothing — verified). Five instances.
- 2026-09-21T13:40 — AC 8 re-measured after #172: still 7, composition
  changed (`7d96be` off, `1dfbdd` on — closed without a `phase 4:` line
  shortly after being cited here as instance 5's specimen). Recorded as a
  moving target.
