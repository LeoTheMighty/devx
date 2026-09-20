---
hash: 4c827d
type: plan
created: 2026-09-20T10:11:00-06:00
title: Detector Discrimination
status: ready
stage: pre-prd
entered_at: null
gate_status:
  prd_validated: false
  design_verified: false
  plan_verified: false
  evals_red: false
outcome: null
from: null
spawned: []
owner: null
branch: null
---

## Goal

devx has no notion of **detector health**. Nothing anywhere asserts that
a check is still capable of reporting, and nothing notices a check whose
output has stopped carrying information. A day of cross-session triage
on 2026-09-20 surfaced six specimens across two repos, five of them in
devx itself — see §Evidence, and read the *units*, because one of them
is a single event wearing a count of ten.

**This plan item exists to get an owner decision on shape, not to
prescribe one.** The underlying fixes stay independent and are already
filed — this is about whether to add a systemic property on top, and
which one.

## The property, stated precisely

The naive framing is "a detector that reports nothing is
indistinguishable from a detector with nothing to report." That is only
half right, and the half it misses is the expensive half.

- `palateful`'s deploy-freshness check fired **50 scheduled runs between
  2026-08-01 and 2026-09-19 and all 50 failed** — blind for exactly the
  51 days prod was frozen. Silent. The naive framing catches this.
- devx's spec-lock classifier reports on **every** lock, and always says
  `dead` (`dev-f83b04`). Saturated, not silent. It runs constantly, so a
  liveness rule of the form *did this detector ever run* passes it while
  it carries precisely zero information.

The property that catches both is **discrimination**: has this detector
ever produced more than one distinct verdict over the population it
examines? A detector that always answers the same thing — whether that
answer is "nothing" or "everything" — is not a detector.

A third specimen appeared in the course of filing these, and it is
cheap and self-demonstrating: a cross-repo scan for bare `owner:` keys
(`grep -rl '^owner:$'`, correctly anchored) flagged `debug-828385` — the
story *about* bare `owner:` keys — because its body contains a fenced
repro block showing one. The scan was not scoped to the frontmatter
block, so it matched frontmatter-shaped prose. A detector that fires on
unscoped matches discriminates between nothing.

## Evidence (units matter more than counts)

Six specimens as of 2026-09-20, five of them in devx itself. **Read the
unit on each one** — a count of symptoms over-weights a bug that fired
once.

| Specimen | Measured | Unit |
|---|---|---|
| palateful deploy-freshness | 50 scheduled runs, 50 failures, 51 days, prod never once measured | per-run; genuinely 50 lapses |
| devx spec-lock classifier | every lock, always `dead` (`dev-f83b04`) | per-lock; saturated |
| devx `doctor` orphan-worktree | asserts uncommitted changes on 3 clean worktrees; conflates repo-level stashes with worktree-local state | per-worktree |
| devx `doctor` dead-owner | tells the reader to "inspect `.worktrees/`" for 10 claims that have no worktree | per-claim |
| devx `merge-gate` | `"no PR yet"` with the PR open and mergeable | per-query |
| devx backlog write-back | **one batch-merge event**, 10 rows, 51 days | **per-event — NOT ten lapses** |

The last row is the one that changes conclusions. All ten palateful PRs
merged on 2026-07-31 inside a single 24-minute window (15:59:45Z #4 →
16:23:36Z #20). That is one write-back step failing once, not ten
independent drifts. A property that samples *rows* sees ten instances
and over-weights it; a property that samples *events* sees one. It also
sharpens what group 1 actually is: the loss is **atomic with the batch**
— a merge event has a write-back step nothing verifies completed — which
is a different detector shape from "notice that a row is old."

This cuts the same way as the caveat under Option D: six specimens in
one day looks striking, and part of that is unit inflation plus the fact
that we went looking. Weigh it accordingly.

**Two corrections to the raw tally, so the item does not inherit them:**

1. The merge-gate specimen is real but its *cause* was misreported.
   merge-gate is fully type-aware (`findSpecForHashAnyType`,
   `merge-gate.ts:334`); it has no `--type` flag because it does not need
   one. `"no PR yet"` is a branch-resolution mismatch — see
   `debug-7d96be`. It stays on this list for the right reason: `gh pr
   list --head X` returning `[]` is reported identically whether X is
   wrong or the PR does not exist, and the gate cannot tell you which.
2. A seventh candidate was dropped: `unknown command 'tour'` is a
   *current* build behaving correctly (tour retired at tur101), not a
   detector failure.

The sharper statement of the pattern, from the reporting session: it is
not that detectors go stale — it is that **detectors answer from the
wrong predicate and cannot tell you they did**. Every row above is a
confident wrong answer, not an error or a silence.

## The three groups (the four defects are not one cause)

Collapsing these into a single story would produce something that
describes a mood rather than a defect. They are:

| Group | Defects | Shape |
|---|---|---|
| **Write path corrupts or fails to update state** | duplicate `owner:` key on claim (`debug-828385`, confirmed in the wild on `imptb1`); backlog write-back missed after a batch merge (palateful, 1 event / 10 rows / 51 days) | Mechanical, independently fixable, no shared code. The write-back case is **event-atomic**, not gradual drift |
| **Detector exists but its output carries no information** | dead-PID lock classifier (`dev-f83b04`); palateful deploy-freshness (50/50); both `doctor` findings; `merge-gate`'s "no PR yet"; the unscoped key scan | The only group this plan item is about |
| **No detector exists at all** | finished work stranding in conflicted PRs (palateful `debug-prstrnd`) | A missing feature, not a broken one. Caught **in transition** 2026-09-20: PR #24 went CONFLICTING/DIRTY under observation when #25 and #1 landed beneath it — a live specimen, not a retrospective one |

Only the middle group motivates a systemic property. Group 1 is a set of
bugs. Group 3 is a backlog item. Do not let the plan absorb them.

## Options (for the owner decision)

### Option A — Discrimination ledger

Every detector records, per run, the distribution of verdicts it
produced. A detector whose distribution has been degenerate (one
distinct verdict) across N consecutive runs or over the whole population
raises a finding in `devx doctor`.

- **Catches:** all three specimens, by construction.
- **Cost:** every detector needs a reporting seam; a durable store
  (`.devx-cache/`) with its own staleness questions; N is a tunable that
  will be wrong at first.
- **Risk:** a detector that is *legitimately* degenerate (a repo where
  nothing is ever broken) raises a false finding — which is itself a
  detector that carries no information. The property has to be able to
  apply to itself without collapsing.

### Option B — Negative controls in the test suite

Each detector ships a fixture that it MUST flag and a fixture it MUST
NOT. A detector that cannot tell them apart fails CI.

- **Catches:** the lock classifier and the unscoped scan at authoring
  time. Would NOT have caught the deploy-freshness check, whose fixtures
  would have passed while the live check was blind for 51 days.
- **Cost:** low; it is a test convention, and `_devx/templates/` already
  has a place for it. No runtime machinery, no store.
- **Risk:** proves the detector *can* discriminate, never that it *is*
  discriminating in production. Strictly weaker, but strictly cheaper.

### Option C — Liveness assertion on scheduled checks only

Any check that runs on a schedule must report a heartbeat with its
verdict; a check whose last N verdicts are identical, or whose heartbeat
is stale, escalates.

- **Catches:** the deploy-freshness case squarely — the 51-day freeze is
  exactly this.
- **Cost:** moderate, and scoped to scheduled surfaces rather than every
  detector.
- **Risk:** misses everything not on a schedule, which is most of devx's
  detectors, including the lock classifier.

### Option D — Do nothing systemic; fix the four and add a LEARN entry

Treat the pattern as a review heuristic rather than machinery.

- **Catches:** nothing automatically, but costs nothing and carries no
  false-finding risk.
- **Honest case for it:** three specimens in one day is a striking
  cluster, but it is one day. The cluster may reflect that we went
  looking, not that the rate is high.

## Recommendation

**B now, C if the scheduled surfaces grow, A only on evidence.**

B is cheap, has no runtime surface, no store, and no self-application
paradox, and it converts the property into something authors feel at the
moment they write a detector — which is where two of the three specimens
were born. C is worth pricing separately because the deploy-freshness
case is the one with a measured 51-day cost and B provably would not
have caught it. A is the only complete answer and also the only one that
can generate its own class of uninformative findings; it should wait
until B and C have produced evidence about how often production
degeneracy actually occurs.

## Open questions for the owner

1. Is the 51-day freeze the motivating cost, or is the lock classifier?
   They point at different options (C vs B) and the answer sets the
   order.
2. Does this apply across repos, or to devx only? Two of the four
   defects are in `palateful`, which is where the expensive one lives.
   A devx-only property does not protect the repo that paid.
3. Group 3 (no detector exists) is not covered by any option here. Is
   "every state transition needs a detector" a separate plan item, or
   out of scope?

## Links

- `dev/dev-f83b04-2026-09-20T09:58-spec-lock-holder-liveness.md` —
  saturated-detector specimen.
- `debug/debug-828385-2026-09-20T10:06-claim-splices-duplicate-owner-key.md`
  — group 1; its AC 6 carries the unscoped-scan specimen.
- palateful: stale-row defect (palateful-0a), `debug-prstrnd` (stranded
  PRs), `imptb1` (in-the-wild duplicate `owner:` keys).
- Framing developed with the coordinator session `leonidbelyi-41`,
  2026-09-20; owner chose a PLAN.md item with options over an INTERVIEW
  question.
