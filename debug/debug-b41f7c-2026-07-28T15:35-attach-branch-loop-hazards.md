---
hash: b41f7c
type: debug
created: 2026-07-28T15:35:00-06:00
title: "Loop discardWorktree force-deletes an inherited (attach-mode) claim branch"
status: in-progress
from: dev/dev-mss102-2026-07-28T13:43-claim-branch-inheritance.md
blocked_by: [mss103]
branch: feat/debug-b41f7c
owner: /devx-loop-2026-08-04T19-52-58-179-34486
---

## Goal

After mss102, `claimSpec` can return an **inherited** branch — the parent's
WIP branch recorded in the follow-up spec's `branch:` frontmatter — instead
of a freshly derived one. Two places in `src/lib/loop/driver.ts` still
assume `claim.branch` is always freshly derived and disposable. Filed from
mss102's adversarial self-review (out of scope there: `driver.ts` is phase
3's file and was being edited concurrently by mss103).

Expected behavior: the loop must never force-delete a branch that carries
work it did not create, and its operator-facing warning must not promise a
failure mode that no longer occurs.

## Acceptance criteria

- [ ] AC 1: repro exists — a test driving `discardWorktree` with an
      attach-mode `ClaimSpecResult` (branch carrying commits below
      `baseSha`) proves the branch is force-deleted today.
- [ ] AC 2: `discardWorktree` (`src/lib/loop/driver.ts:1254`) does not
      `git branch -D` a branch the claim inherited rather than created.
      Needs a way to tell the two apart — e.g. `claimSpec` reporting
      whether it attached or derived, rather than the driver re-deriving
      and comparing (don't duplicate business logic).
- [ ] AC 3: the stale-branch warning (`driver.ts:1264`) no longer asserts
      "the next claim of `<hash>` will fail" — after mss102 the next claim
      *attaches* to that branch instead. Reword to name the real hazard
      (silently adopting debris).
- [ ] AC 4: regression test + `npm test` (typecheck included) green.

## Technical notes

Root cause narrative from the mss102 review:

1. **Destructive**: `discardWorktree`'s comment reads "the claim never
   pushed the feature branch; iteration commits are local" — true only on
   the derive path. In attach mode the branch predates the claim and holds
   the parent's handed-off work, which sits below `baseSha`
   (`driver.ts:869`) and is therefore invisible to
   `isBookkeepingOnlyWorktree`. If origin's copy was pruned or deleted in
   the meantime, `branch -D` destroys the only remaining copy
   (reflog-only recovery).
2. **Stale promise**: `driver.ts:1264` tells the operator that a
   surviving stale branch makes the next claim fail. Post-mss102 the next
   claim of that hash attaches to it — the opposite outcome, and the more
   dangerous one, since the resulting PR silently carries the dead run's
   commits.

Related but deliberately NOT in this spec: the general "plan-emitted specs
all record `branch:`, so leftover debris branches are adoptable" widening
is inherent to mss102 AC 2 and is mitigated there by an explicit WARN at
attach time. This spec covers only the loop's two wrong assumptions.

## Status log

- 2026-07-28T15:35 — filed by /devx during mss102 Phase 4 self-review
  (Blind Hunter findings #3 partial + #4). Blocked-by mss103 to avoid
  colliding with the in-flight loop-integration edits to the same file.
- 2026-08-04T14:19:59-06:00 — claimed by /devx in session /devx-loop-2026-08-04T19-52-58-179-34486
- 2026-08-04T21:16:32.342Z — loop iteration 1: Made the loop attach-mode aware: claimSpec now reports whether it attached or derived, and the abandon path rewinds an inherited branch to its handed-off tip instead of force-deleting it, with the stale-branch warning reworded to name silent adoption.
  - Change: ClaimSpecResult gained `attached: boolean` (true ⇒ mss102 attach mode), so consumers can tell an inherited branch from one the claim created without re-deriving the name; the devx-helper claim JSON contract and the /devx skill body (plus its skills/ mirror) document the new field.
  - Change: src/lib/loop/driver.ts discardWorktree no longer `git branch -D`s an inherited branch: attach mode routes to a new rewindInheritedBranch() that resets the branch to the claim's baseSha (dropping only this run's bookkeeping commits) and leaves it wholly untouched with an operator WARN whenever the rewind can't be proven safe (no baseSha, unreadable tip, tip not a descendant, branch -f failure).
  - Change: Reworded the stale-branch warning: instead of promising the next claim will fail, it names both real hazards — failing at `worktree add -b` or being silently adopted with this dead run's commits.
  - Change: Tests: 4 new loop-driver cases (inherited branch survives + rewound, derived branch still deleted, reworded WARN, rewind-failure fallback), `attached` assertions across the mss102 claim paths in devx-split/devx-claim, and a `branch:` frontmatter option in the shared loop git fixture.
  - Change: Re-synced skills/devx.md via `npm run sync:skills` to satisfy the pin101 mirror drift guard.
  - Learning: The pre-fix repro was verified by temporarily neutering the guard: the loop really did delete a handoff branch carrying a commit below baseSha, confirming isBookkeepingOnlyWorktree cannot see inherited work.
  - Learning: Editing .claude/commands/*.md requires `npm run sync:skills` or test/skills-sync.test.ts (pin101 drift guard) goes red — the mirror under skills/ must be byte-identical.
  - Learning: Attach mode only triggers when the spec's recorded `branch:` DIFFERS from the derived `<prefix><type>-<hash>` name, so any attach fixture needs a parent-shaped branch name, not the item's own.
  - Learning: Four child-process-spawn test files (loop-worker, manage-spawn, manage-crash-restart-loop, manage-spawn-integration) time out under machine load during a full `npm test` on this box but pass 61/61 in isolation in ~1s — treat their timeouts as environmental, and re-run them alone before believing a full-suite red.

## Links

- Parent: `dev/dev-mss102-2026-07-28T13:43-claim-branch-inheritance.md`
- Workstream: `_devx/workstreams/mid-story-split/`
