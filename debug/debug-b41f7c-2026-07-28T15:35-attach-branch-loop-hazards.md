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

## Links

- Parent: `dev/dev-mss102-2026-07-28T13:43-claim-branch-inheritance.md`
- Workstream: `_devx/workstreams/mid-story-split/`
