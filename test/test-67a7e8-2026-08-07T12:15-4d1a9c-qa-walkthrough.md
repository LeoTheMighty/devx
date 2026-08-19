---
hash: 67a7e8
type: test
created: 2026-08-07T12:15:00-06:00
title: "QA walkthrough — claim branch-posture guard (4d1a9c)"
from: debug/debug-4d1a9c-2026-08-07T11:37-claim-commits-on-current-branch-not-base.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `4d1a9c`

> `devx devx-helper claim` now refuses, with a typed `validate` error and zero
> mutation, when the main worktree is not on the push target — closing the
> path where the claim commit landed on a stray branch and the push was a
> silent no-op. The user-visible surface is the CLI's stdout JSON, its stderr
> message, and its exit code. This walkthrough does NOT cover the loop
> driver's 3-strike reaction to the new refusal (asserted in
> `test/loop-driver*.test.ts`, not by hand) or the split-branch
> `integration_branch` posture (unit-tested only — this repo is single-branch).

## Pre-flight

```bash
cd /Users/leonidbelyi/personal/devx/.worktrees/debug-4d1a9c
npm run build          # the checks below invoke dist/cli.js

# Throwaway fixture: a devx project + a bare origin, on `main`, one ready item.
# Full script: scratchpad/fixture.sh (also inlined in the spec's Reproduction).
FIX=$(mktemp -d)/fx && bash "$SCRATCH/fixture.sh" "$FIX"
CLI=$PWD/dist/cli.js
```

## Manual checks

### 1. A claim from a peer's branch refuses and mutates nothing

- [x] `machine` — proves the original bug is closed AND that the refusal is
  inert: no lock, no backlog flip, no spec flip, no worktree, and a peer's
  uncommitted work still on disk.

```bash
cd "$FIX/proj"
git checkout -qb chore/peer-session
echo "peer WIP" > peer.txt              # a concurrent session's uncommitted work
node "$CLI" devx-helper claim zz1234; echo "EXIT=$?"
```

Expected:

```
{"error":"rollback","stage":"validate"}
devx devx-helper claim: claim failed at stage 'validate': the main worktree at
<FIX>/proj is on branch 'chore/peer-session', but the claim commit must land on
'main' and reach origin/main. Nothing was mutated — check out 'main'
(`git -C <FIX>/proj checkout main`) and re-run.
EXIT=2

lock=absent  row=- [ ]  spec=status: ready  branch=chore/peer-session
peerWIP=peer WIP  worktrees=1
```

Invariant: exit is **2** and every observable is pre-claim. If a lock file,
a `- [/]` row, or a `.worktrees/` entry appears here, the guard has moved
after the transaction starts and the refusal is no longer free.

### 2. A detached HEAD is refused by the same guard

- [x] `machine` — proves detached HEAD does not fall through the branch
  comparison (`posture.branch !== pushTarget` is false when there is no
  branch at all).

```bash
cd "$FIX/proj" && git checkout -q --detach main
node "$CLI" devx-helper claim zz1234; echo "EXIT=$?"
```

Expected:

```
{"error":"rollback","stage":"validate"}
devx devx-helper claim: claim failed at stage 'validate': the main worktree at
<FIX>/proj has a detached HEAD, but the claim commit must land on 'main' and
reach origin/main. Nothing was mutated — check out 'main' (…) and re-run.
EXIT=2

lock=absent  row=- [ ]
```

Invariant: the message says **detached HEAD**, not `is on branch ''`. An empty
branch name leaking into the message means `readHeadPosture` returned
`{kind:"branch", branch:""}` instead of probing `rev-parse --verify`.

### 3. The happy path still claims — and the worktree contains the claim

- [x] `machine` — the regression that matters most: the guard must not cost
  the ordinary claim anything, and AC 3 (the item's branch contains its own
  claim) must hold.

```bash
cd "$FIX/proj" && git checkout -q main
node "$CLI" devx-helper claim zz1234; echo "EXIT=$?"
git log --oneline -1 main
git ls-remote --heads ../origin.git
grep -m1 '^status:' .worktrees/dev-zz1234/dev/dev-zz1234-*.md
```

Expected:

```
{"branch":"feat/dev-zz1234","attached":false,"lockPath":"…","claimSha":"55e5566d2c472b650b1a6fc894df5868d190400e"}
EXIT=0

55e5566 chore: claim zz1234 for /devx        ← claim IS on main
55e5566d2c472b650b1a6fc894df5868d190400e	refs/heads/main   ← origin moved
status: in-progress                          ← the PR's branch carries the claim
```

Invariant: `origin/main` must equal the local `main` tip, and the spec **inside
the item's worktree** must read `in-progress`. Pre-fix this line read `ready` —
that mismatch is the whole bug, so it is the single most diagnostic assertion
here.

### 4. The refusal reads clearly to whoever hits it at 3am

- [ ] `human` — the message must be actionable without opening the source ·
  how to verify: run check 1 and read the stderr line — it should name the
  branch you are on, the branch you need, and give a copy-pasteable
  `git -C … checkout main`, with "Nothing was mutated" stated so the operator
  knows there is nothing to clean up before retrying.

Invariant: an operator who has never read `claim.ts` can recover in one step.
If the message ever stops naming both branches, the most common failure mode
(“which branch does it even want?”) comes back.

## Regressions to watch

- **The unattended loop.** A `devx loop` whose main checkout is parked on a
  stray branch now fails 3 claims and stops with "systemic claim problem"
  instead of producing broken claims all night. That is intended, but it is a
  behavior change: prove it by starting a loop from a non-`main` checkout and
  confirming it stops with the branch named in the stop reason.
- **Fail-open on indeterminate probes.** Every claim unit test injects a fake
  exec that returns exit 0 with empty stdout. If `readHeadPosture` ever treats
  that as a branch named `""`, every fake-exec claim test refuses and the
  suite goes red wholesale — the fast signal that the positive-evidence rule
  was broken.
- **Durable claims must never be unwound.** The AC-4 ancestry probe treats
  *only* `merge-base --is-ancestor` exit **1** as negative evidence. If exit
  128 (bad ref, no tracking ref configured) ever starts rolling back, a claim
  that really is on origin gets reset — strictly worse than not checking.

## Post-merge follow-ups

- `devx loop` preflight could check branch posture at second 0 rather than
  burning 3 claim attempts to discover it (lpf101 already probes main's remote
  CI there). Small, optional; deliberately out of scope for a debug fix.
- The downstream report `friend-finder-mesh` `debug-3fa71c` closes once this
  ships and the operator reinstalls (`npm run install:global`).
