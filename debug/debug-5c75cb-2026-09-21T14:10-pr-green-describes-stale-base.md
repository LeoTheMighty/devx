---
hash: 5c75cb
type: debug
created: 2026-09-21T14:10:00-06:00
title: "A PR's green CI describes the base it was cut from, and nothing re-runs it when main moves"
from: debug/debug-7d96be-2026-09-20T10:21-claim-type-resolution-inconsistent.md
spawned: []
status: ready
owner: null
branch: null
---

## Goal

Nothing merges to `main` on the strength of a CI result measured against a
base `main` has already moved past. Today a PR's green check is a statement
about the commit it was cut from; when another PR lands on the same files
first, that check silently stops describing what will actually merge, and
nothing re-runs it.

## Evidence — one instance, 2026-09-21

PR **#172** (7d96be review fix-forward) and PR **#171** (108c57, the #162
review fix-forward) were developed in parallel and touch **five files in
common**: `src/commands/devx-helper.ts`, `src/lib/devx/mark-done.ts`,
`src/lib/devx/split.ts`, `src/lib/devx/verify-claim.ts`,
`test/devx-verify-claim.test.ts`. The tightest seam is `verify-claim.ts`,
where #171 changed owner resolution to first-meaningful-value and #172 added
a claimability check a few lines away.

- #171 merged at 18:33Z as `1c69c450`.
- #172's green CI (run 35639477443, at `72e68af`) was measured on a base
  **without** #171: `git merge-base --is-ancestor 1c69c450 72e68af` → no.
- #172 merged at 18:40Z as `12e8e9e7`. GitHub reported `MERGEABLE` /
  `CLEAN`, which means *textually* clean — no conflict — not *tested*.
- The combination's first CI run of any kind was `main`'s own post-merge run.
- The live `devx` binary (`dist/`) was rebuilt from `12e8e9e7` immediately
  after, so every session was running the untested combination until that
  run finished.

**Outcome: no harm this time.** `main`'s CI on `12e8e9e7` passed (run
35639876247), and a local run of the six overlapping test files on
`12e8e9e7` passed 257/257. The combination happened to be fine. That is luck
about the code, not a property of the process: two PRs rewriting adjacent
lines of one function were merged with no evidence they worked together.

## Why it slipped — two checks, one proxy

The author verified CI on their own tip. The merging session verified CI
plus GitHub mergeability. Both describe the base the branch was cut from;
neither asked whether that base was still `main`. The author's warning to
hold the merge arrived after it landed. Neither check was wrong — both
answered exactly what they measure — which is why this belongs with the
"gate checked something adjacent to what we cared about" family rather than
with a skipped step.

## Relation to `debug-d315b9`

Close to, but not, d315b9's instance 2. There the check **cannot fire** on
the branch (its ship-stage trigger only exists after merge). Here the check
**fired correctly** on the branch, on a base that was no longer `main`.
Different mechanism, different fix. Filed separately after searching every
spec for coverage (the only hits were false positives on git's
"Everything up-to-date").

## Acceptance criteria

- [ ] A PR cannot merge unless its passing checks ran against a base that
      includes current `main` — or, at minimum, unless `main` has not changed
      any file the PR touches since those checks ran.
- [ ] The control holds for **hand-merges** (`gh pr merge`), not just for
      `devx merge-gate`. Both instances in the 2026-09-21 batch were
      hand-merged, and d315b9 instances 1 and 5 already establish that
      hand-merges skip `merge-gate` entirely — so a `merge-gate`-only check
      would be skipped by exactly the path that produced this.
- [ ] The chosen control is recorded with its cost (below), and the decision
      is Leo's — option 1 is a repo-admin setting, not something an agent
      changes.

## Options

1. **GitHub branch protection: "Require branches to be up to date before
   merging"** (strict status checks). Structural, and enforced server-side,
   so it catches hand-merges. **Cost:** every merge that `main` has moved
   past needs a rebase and a full CI re-run before it can land, which
   serializes merges. With 4–8 sessions merging concurrently (the
   2026-09-21 pattern), that is real friction and a real CI-minutes cost.
2. **A `devx merge-gate` check** that the PR's last green run is at a sha
   whose base includes current `origin/main`, or that no file the PR touches
   has changed on `main` since. Narrower — only forces a re-run on actual
   overlap — but **skipped by hand-merges**, so on its own it fails AC 2.
3. **GitHub merge queue.** Tests each PR against the queue's projected
   `main`, which is precisely the missing check, and batches to limit the
   serialization cost of option 1. Heavier to set up.

Option 2 is still worth having as a fast local signal alongside 1 or 3; it
is not sufficient alone.

## Technical notes

- **This is a silent-to-loud change.** Turning on option 1 or 3 blocks
  merges that go through today. Before enabling, check what is currently
  merging successfully *because* nothing re-checks the base — i.e. how many
  concurrent PRs usually overlap. If the answer is "most of them", option 1
  makes every session queue behind every other, and option 3 is the better
  fit.
- `mergeable: CLEAN` should never be read as "tested together". Worth a line
  in the `/devx` skill body's Phase 8 wherever it tells an agent to check
  mergeability.

## Status log

- 2026-09-21T14:10 — filed from the #172 merge. Coordinator flagged the gap
  and asked for it to be filed if `d315b9` did not cover it; it does not.
