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

## The framing (it earned the top slot by changing the answer)

Every specimen below is the same inference: **something true of a proxy
was read as the fact itself.**

| Proxy measured | Read as |
|---|---|
| present in an open-PR listing | merged |
| a lock's PID is gone | the owner is gone |
| the file is saved in the worktree | the work is shared |
| `gh pr list --head X` returned `[]` | no PR exists |
| the sync check is green | the install matches |
| a worktree exists | it holds uncommitted work |

palateful-4f's phrasing: **the check and the claim are one step apart,
and nobody verifies the step.**

The reporting session set the right test for whether this belongs at the
top or in a closing line — *does it change which option you'd pick or
how you'd scope it?* It does, so it is here. Applied honestly, it breaks
the recommendation this item shipped with:

**A negative control (Option B) cannot catch a wrong proxy, because the
control is written by the same person holding the same proxy
assumption.** Take pin101's skills guard. Its negative control is "a
drifted mirror must fail, a clean mirror must pass" — both fixtures
built inside devx, both confirming that `skills/` matching
`.claude/commands/` is the thing worth checking. The control passes, the
detector is genuinely correct, and the gap (consumer installs) is
untouched. B tests the implementation against the proxy; it never tests
the proxy against the claim.

That demotes B from "recommended" to "necessary but blind in exactly the
direction these failures come from," and it is why **Option E** exists
below. It also explains the population case, which sat awkwardly outside
all three original groups: pin101's guard is a perfectly good proxy for
the wrong claim.

The framing's own weakness, stated so the item cannot hide behind it:
"verify your proxies" is close to unfalsifiable, and an item that opens
with an aphorism can smuggle a weak recommendation in behind a
strong-sounding frame. The options below are the part that has to do
work — judge them, not the sentence.

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

Seven specimens as of 2026-09-20, six of them in devx itself. **Read the
unit on each one** — a count of symptoms over-weights a bug that fired
once.

| Specimen | Measured | Unit |
|---|---|---|
| palateful deploy-freshness | 50 scheduled runs, 50 failures, 51 days, prod never once measured | per-run; genuinely 50 lapses |
| devx spec-lock classifier | every lock, always `dead` (`dev-f83b04`) | per-lock; saturated |
| devx `doctor` orphan-worktree | asserts uncommitted changes on 3 clean worktrees; conflates repo-level stashes with worktree-local state | per-worktree |
| devx `doctor` dead-owner | tells the reader to "inspect `.worktrees/`" for 10 claims that have no worktree | per-claim |
| devx `merge-gate` | `"no PR yet"` with the PR open and mergeable — **three states, one answer**: wrong branch, no PR, or a `branch:` sentinel the reader doesn't recognize | per-query |
| devx backlog write-back | **one batch-merge event**, 10 rows, 51 days | **per-event — NOT ten lapses** |
| devx packaged-skills guard | passes CI correctly while palateful runs skill bodies 146/161/184 lines behind HEAD, incl. 16 `tour` refs to a command retired 6 weeks ago | per-repo — **population stops one hop short** |

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

1. The merge-gate specimen is real but its cause was misreported
   **twice**, and the final answer is the most useful version. It is not
   a type gap (the gate is type-aware via `findSpecForHashAnyType`,
   `merge-gate.ts:334`), and it is not a branch mismatch either. The
   measured cause is `branch: unassigned` in the spec and a guard that
   accepts any non-null string as a branch name (`debug-1dfbdd`), so the
   gate queried `gh pr list --head unassigned`.
   This makes it the **sharpest specimen on the list**: `[]` is reported
   identically for three different states — the branch is wrong, no PR
   exists, or the `branch:` field holds a sentinel the reader has never
   heard of. The third is the actual one, and it is the one no amount of
   enumeration can catch: `unassigned` appears nowhere in devx's tree,
   so the reader is being asked to recognize a value it was never told
   about. A detector that answers from *is this null* when the question
   is *is this a branch that exists* will keep being confidently wrong,
   and this is the second sentinel to walk through it (`debug-7b3e2a`
   was the first, with `null`).
   It is also the cleanest evidence for **validate, don't enumerate** —
   the same trap `debug-828385` AC 7 identified independently on
   frontmatter keys, which is some evidence the trap is systemic rather
   than two coincidences.
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
| **Detector's population stops short of the failure** | packaged-skills drift guard (pin101) — green in devx, blind to consumer installs | Added 2026-09-20; see §"A fourth shape" — this one changes the options, not just the count |

The middle group motivates the systemic property. Group 1 is a set of
bugs. Group 3 is a backlog item. Do not let the plan absorb them. Group
4 arrived last and is the only one that constrains the *answer* rather
than supplying evidence for the question.

### A fourth shape the three groups do not describe

The packaged-skills specimen was offered as group 3 ("no detector
exists"). **It is not.** A detector exists, is CI-enforced, and is
passing correctly: `scripts/sync-skills.mjs --check` (pin101) compares
`.claude/commands/` against `skills/`, and `test/skills-sync.test.ts`
fails the build on divergence. Verified at HEAD — the mirror is clean,
all four bodies match (722/400/283/178 lines), zero `tour` references.

The guard's population is **devx's own tree**. It proves the npm tarball
matches devx's source. It says nothing about whether an *installed*
`.claude/commands/` in a consumer repo matches the tarball it came from
— and that is exactly where the failure is. palateful is running
`devx.md` 146 lines behind, `devx-plan.md` 161 behind, `devx-learn.md`
184 behind (nearly triple), and its installed `devx.md` carries 16
references to `tour`, including a whole `### Phase 7.5: Review Tour`
section invoking `devx tour gather` / `devx tour build`, for a command
retired at tur101 on 2026-08-04.

So the shape is: **a detector whose population stops one hop short of
where the failure occurs.** Not answering the wrong predicate (group 2),
not absent (group 3). It is green, and correct to be green, and useless
against the thing it appears to cover.

This is the one specimen that changes the options analysis rather than
adding to the pile. Options A and B both operate on devx's detectors
*within devx* — a discrimination ledger would record pin101's guard as
healthy, and a negative control would prove it can tell a drifted mirror
from a clean one, which it genuinely can. Neither catches a population
that ends at the repo boundary. **Any option chosen here needs an
explicit answer for "what is this detector's population, and is the
failure inside it?"** — which is a different question from "does this
detector discriminate," and cheaper to ask.

It also lands on open question 2 below with some force: devx's
detectors mostly stop at devx, and the repo that keeps paying is
palateful.

Caveat, in keeping with the rest of this section: this is one consumer
repo measured once. The drift numbers are concrete and currently live,
so it is not subject to the "we went looking" discount in the way the
count-based specimens are — but it is n=1 on installs.

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

### Option E — Proxy register

For each detector, declare three things in one place: the **proxy** it
measures, the **claim** it is read as, and the conditions under which
they diverge. A detector without a register entry fails review; an entry
whose divergence conditions are unaddressed is a finding.

- **Catches:** proxies that are **visibly narrower than their claim** —
  the population case, the sentinel case, the lock classifier, and the
  two human errors. That is the honest promise, and it is smaller than
  "catches wrong proxies": a genuinely subtle gap survives a register
  exactly as it survives everything else here.
- **Cost:** low and entirely authoring-time. No store, no runtime
  component, no tunable. A table and a review rule.
- **Why it is not just B:** B asks "does this detector work?" E asks
  "is this detector measuring the thing we're about to claim?" Every
  specimen here answers yes to the first and no to the second.

**The objection, and why E survives it.** A proxy register is itself a
proxy. It records that somebody once thought about divergence; nothing
verifies the entry stays true, and nothing catches an author who simply
could not imagine the divergence condition. pin101's author would never
have written "diverges when the consumer install drifts from the
tarball" — had they had that thought, they would have widened the check
instead. So E inherits B's imagination limit one level up, and it decays
silently the way documentation always does.

E survives because **enumerating divergences correctly is not where its
value is.** The value is that writing the proxy and the claim as **two
separate sentences** makes the gap legible to a later reader who was
never primed. pin101's entry would have read:

- *proxy:* devx's `skills/` matches `.claude/commands/`
- *claim:* installed skills match their source

Those are visibly not the same sentence, to anybody, without needing to
have anticipated the consumer-install case. E converts a failure of
**imagination** into a failure of **reading** — and reading is the thing
a second person can do that the author could not.

That is also what the binding AC has to be: **the claim must be stated
in terms of what a person actually cares about, never in terms of the
mechanism.** An entry reading "proxy: the sync check passes / claim:
skills are in sync" has recorded nothing — it is one sentence twice, and
it defeats the whole device. A register that permits mechanism-restated-
as-claim is worse than no register, because it looks like diligence.

(Objection and resolution both from the coordinator session; the
bounded promise above replaces this item's earlier overclaim that E
"catches wrong proxies".)

## Recommendation

**E first, then B, C if the scheduled surfaces grow, A only on
evidence.** E's promise is bounded — visibly narrower proxies, not
subtle ones — and its binding rule is the claim-not-in-mechanism-terms
AC above. Without that rule it is ceremony.

This is a change from the item's original recommendation of B-first,
and the reason is in §The framing: B cannot catch a wrong proxy because
the control inherits the proxy. E is the cheaper question *and* the one
that covers the specimen that broke the original ranking. B stays —
once the proxy is right, a negative control is what keeps the
implementation honest — but it is second, not first.

B is cheap, has no runtime surface, no store, and no self-application
paradox, and it converts the property into something authors feel at the
moment they write a detector — which is where two of the three specimens
were born. E is cheaper still and strictly upstream of it. C is worth pricing separately because the deploy-freshness
case is the one with a measured 51-day cost and B provably would not
have caught it. A is the only complete answer and also the only one that
can generate its own class of uninformative findings; it should wait
until B and C have produced evidence about how often production
degeneracy actually occurs.

### On the two human specimens

Two of the seven are humans making the same inference as the code (an
open-PR listing read as merged; a worktree save read as shared), and
both were caught the same way the code ones were — by checking the
underlying fact (`mergedAt` + ancestry; `git status`) rather than the
proxy.

Stated at the strength it deserves: this is **weak** evidence that the
failure is about the shape of the inference rather than about software.
n=2, both inside a session where everyone was already primed to hunt
proxy errors, and the base rate for "a person conflates a listing with a
fact" is unmeasured. It is not nothing, though, and it has one concrete
implication: if the error is cognitive rather than technical, a register
that forces someone to write the mapping down (E) is better targeted
than runtime instrumentation (A). That is a modest argument, and it is
offered as one.

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
