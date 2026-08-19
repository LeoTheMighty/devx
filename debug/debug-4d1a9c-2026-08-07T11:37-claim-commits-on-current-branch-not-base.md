---
hash: 4d1a9c
type: debug
created: 2026-08-07T11:37:00-06:00
title: claim commits on whatever branch the main worktree has checked out, and reports exit 0 though origin never moved
from: null
spawned: []
status: done
owner: /devx-2026-08-07T1138-44048
branch: feat/debug-4d1a9c
---

## Goal

`devx devx-helper claim <hash>` must guarantee its invariant: the claim
commit reaches `origin/<default_branch>` before the helper returns success.
That ordering is the whole reason the helper exists — `.claude/commands/devx.md`
§ Phase 1, "claim commit pushed to `origin/main` BEFORE any subsequent
`gh pr create`", closing `memory/feedback_devx_push_claim_before_pr.md`.

Today the invariant silently does not hold whenever the main worktree is
checked out on any branch other than the push target. The claim commit lands
on that other branch, the push is a no-op, and the helper still exits 0 with a
`claimSha` set.

Reported downstream by the `friend-finder-mesh` project as
`debug/debug-3fa71c-2026-07-31T19:10-claim-commits-on-whatever-branch-the-main-worktree-is-on.md`,
where it cost a hand-repair mid-session during `ffm106`.

## Reproduction

Confirmed against `devx` @ `455f02c` (`0.1.0+455f02c`) on 2026-08-07 with a
throwaway fixture — not merely re-read from the downstream report:

```
git init -b main origin.git --bare
git init -b main proj && cd proj
git remote add origin ../origin.git
# minimal devx.config.yaml (git.default_branch: main, integration_branch: null),
# DEV.md with one `- [ ]` row for zz1234, dev/dev-zz1234-….md with status: ready
git add -A && git commit -m "init fixture" && git push origin main
git checkout -b chore/peer-session          # ← the only unusual step

devx devx-helper claim zz1234
```

Observed:

```
{"branch":"feat/dev-zz1234","attached":false,"lockPath":"…","claimSha":"8fcfbde…"}
EXIT=0

HEAD branch:  chore/peer-session
HEAD sha:     8fcfbde          ← the claim commit is here
local main:   d3b821b          ← unmoved
origin/main:  d3b821b          ← unmoved

git branch -vv
* chore/peer-session 8fcfbde chore: claim zz1234 for /devx
+ feat/dev-zz1234    d3b821b (…/.worktrees/dev-zz1234) init fixture
  main               d3b821b init fixture

# spec status inside the item's own worktree:
status: ready                  ← the claim is not in the branch that becomes the PR
```

The downstream `ffm106` incident is the same shape: a `chore/learn-…` branch
left checked out by a concurrent `/devx-learn` session.

## Root cause

Two steps in `src/lib/devx/claim.ts` combine:

- **Step 4** (`claim.ts:1071`) runs `git commit … -- <paths>` with
  `cwd: opts.repoRoot` and no assertion about which branch HEAD is on, so the
  claim commit is written to whatever is checked out.
- **Step 5** (`claim.ts:1097`) runs `git push origin <pushTarget>`. With a
  single refspec argument, git pushes the **local ref of that name** — local
  `main`, which the commit never touched. Git reports `Everything up-to-date`
  and exits 0, so `isRejectedPush` never fires, no rollback runs, and the
  helper returns `claimSha` for a commit that reached nothing.

The `worktree add … <worktreeBase>` in Step 6 then bases the item's branch on
the unmoved `main`, which is why the spec inside the new worktree still reads
`status: ready`.

Note the existing canonical-root assertion (`claim.ts:582`) already
establishes the precedent for a pre-transaction, nothing-mutated refusal; this
guard belongs beside it.

## Acceptance criteria

- [ ] `claim` refuses with a typed `ClaimError("validate", …)` — exit 2 —
      when the main worktree's HEAD is not on the resolved push target,
      naming both the current branch and the expected one.
- [ ] The refusal happens **before** any mutation: no lock file, no backlog
      flip, no spec rewrite, no commit, no worktree. The operator's checkout
      and any peer session's uncommitted work are untouched (the `ffm106`
      incident had a live `/devx-learn` peer writing in the same tree).
- [ ] Detached HEAD is refused by the same guard rather than falling through.
- [ ] A push that did not move `origin/<pushTarget>` is never reported as
      success — verify the pushed ref actually contains the claim commit, and
      roll back as a push failure if it does not.
- [ ] Regression tests cover: HEAD on a non-target branch, detached HEAD, and
      the happy path still passing on the target branch. Today's tests assume
      the common posture and so never exercised this.

## Technical notes

- Fix shape chosen by the user (2026-08-07): **refuse**, not "commit onto the
  base anyway". AC 5 of the downstream spec asks that the operator's checkout
  be left undisturbed; both a `checkout main`/restore dance and a
  `commit-tree`/`update-ref` plumbing path mutate or bypass a working tree a
  concurrent session may be mid-edit in. Refusing is the only option that
  cannot damage a peer.
- The guard must consult the **main worktree's** HEAD (`opts.repoRoot`), which
  is where the claim commits — not the caller's cwd.
- Related, already-documented sharp edge in the same area: `gh pr merge` from
  inside a worktree exits non-zero while the remote merge succeeds
  (`memory/feedback_gh_pr_merge_in_worktree.md`).

## Status log

- 2026-08-07T11:37 — filed from the downstream `friend-finder-mesh` report
  (`debug-3fa71c`); reproduced against `455f02c` with a throwaway fixture
  before filing, root-caused to `claim.ts:1071` + `claim.ts:1097`.
- 2026-08-07T11:38:44-06:00 — claimed by /devx in session /devx-2026-08-07T1138-44048
- 2026-08-07T11:40 — phase 2: spec ACs direct (v2 native); 5 ACs;
  workstream=none; red-artifacts=none (repro is the RED — a throwaway fixture
  reproducing the green-but-empty push against `455f02c`, re-run post-fix as
  the machine QA evidence).
- 2026-08-07T11:44 — phase 3: guard implemented. `readHeadPosture` (exported,
  positive-evidence-only) + a pre-transaction refusal in `claimSpec` placed
  before `resolveInheritedBranch` and before the backlog lock, so a refusal
  costs no fetch, no lock, no flip. AC 4 backstop: after a green push,
  `merge-base --is-ancestor HEAD refs/remotes/origin/<pushTarget>` exiting 1
  routes into the EXISTING push-failure rollback (condition widened rather
  than the delicate block duplicated) and throws `ClaimError("git-push")`.
- 2026-08-07T11:47 — phase 4: single-pass adversarial review (diff 411 lines,
  under the 3-agent threshold); 5 findings, ALL fixed in-place. Most
  load-bearing: the `readHeadPosture` repoRoot test asserted only
  `calls.length > 0` — trivially true, and it would have passed had the probe
  read `process.cwd()` instead of the main worktree, which is the exact way
  this guard could be silently defeated from inside an agent worktree; it now
  pins the captured `cwd`. Also: verified indeterminate readings fail OPEN
  (a can't-determine probe must not block legitimate claims), verified the
  ancestry probe treats only exit 1 as negative evidence (exit 128 must never
  unwind a commit that IS durable on origin), corrected the rollback WARN that
  said "push failed" on the exit-0 path, and confirmed the unverified-push
  throw precedes the contention predicates (which read empty stderr at exit 0
  and would have emitted "failed (exit 0)").
- 2026-08-07T11:52 — phase 5: local gates green (`npm test` — schema smoke,
  config-io, config-validate, build, typecheck, vitest). Honest-RED check:
  reverting only the src guard reds 13 of the 17 new assertions, and for the
  right reason (the claim SUCCEEDS where it must refuse), not harness
  breakage. End-to-end against real git on a throwaway fixture: peer-branch
  checkout → exit 2, nothing mutated, peer WIP intact; detached HEAD → exit 2;
  HEAD on main → claim lands on main, `origin/main` moves, and the item's
  worktree spec reads `in-progress` (AC 3).
- 2026-08-07T12:15 — phase 5 (cont): QA walkthrough emitted at
  `test/test-4d1a9c-qa-walkthrough.md` (3 machine checks executed inline with
  real pasted output; 1 human check outstanding — refusal-message
  actionability) + TEST.md row. Full-suite result recorded honestly: 3216
  passed, 24 failed in `loop-worker` + `manage-crash-restart-loop`. Bisected
  BOTH directions before accepting them as pre-existing — isolated, those two
  files pass 28/28 WITH this diff and 28/28 with it stashed, so the failures
  are the documented load-amplified timing class (debug-620337 /
  debug-5c8b21 / debug-ecdcda), not diff-induced. Note the earlier
  `npm test | tail` reported exit 0 because the pipeline returns tail's
  status — the failures were read out of the captured output, not inferred
  from the exit code.
- 2026-08-07T12:16 — phase 7: pushed `feat/debug-4d1a9c`; PR
  https://github.com/LeoTheMighty/devx/pull/123 (no unresolved placeholders).
- 2026-08-07T12:35 — phase 8: CI green (devx-ci run 31205463678). `check-hold`
  clean. `devx merge-gate 4d1a9c` first returned exit 2 twice, for two
  DIFFERENT reasons, both worth recording:
  (a) from the worktree — `spec resolution failed`: this story's own QA
  walkthrough `test/test-4d1a9c-qa-walkthrough.md` collides with its spec on
  the hash, which is exactly the open `debug-ea4f41`;
  (b) from the main worktree — `no PR yet`, despite
  `gh pr list --head feat/debug-4d1a9c` returning PR #123. Root cause:
  `readFrontmatter` (merge-gate.ts:111) stores YAML `branch: null` as the
  STRING `"null"`, and the branch fallback guard
  (`typeof fm.branch === "string" && fm.branch.length > 0`,
  merge-gate.ts:333) accepts it, so the gate queried
  `gh pr list --head null` → `[]` → "no PR yet". `deriveBranch` is never
  reached. Proven: `gh pr list --head null` returns `[]`, and setting the
  field flips the gate to `{"merge":true}`. Filed as its own debug spec; this
  spec now records its branch explicitly, which is the convention anyway.
- 2026-08-07T14:15:15-06:00 — merged via PR #123 (squash → 782f81e)
- 2026-08-13 — post-merge, by `debug-ea4f41`: this story's QA walkthrough was
  renamed out of the hash collision it created —
  `test/test-4d1a9c-qa-walkthrough.md` →
  `test/test-67a7e8-2026-08-07T12:15-4d1a9c-qa-walkthrough.md`, with canonical
  spec frontmatter and the `TEST.md` row repointed. The earlier log lines that
  name the old path are left as written (append-only); `4d1a9c` now resolves
  to this spec alone.
