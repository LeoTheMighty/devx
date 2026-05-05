---
hash: dvx101
type: dev
created: 2026-04-28T19:30:00-07:00
title: Atomic claim + push-before-PR + spec lock
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
owner: /devx-2026-05-05T1830
blocked_by: [mrg102, prt102]
branch: feat/dev-dvx101
---

## Goal

Ship `src/lib/devx/claim.ts → claimSpec(hash, opts)` as the atomic claim operation: lock + DEV.md flip + spec frontmatter + status log + commit on main + push + worktree create. Closes `feedback_devx_push_claim_before_pr.md` structurally.

## Acceptance criteria

- [ ] `src/lib/devx/claim.ts` exports `claimSpec(hash, opts: {sessionId}): Promise<{branch, lockPath, claimSha}>`.
- [ ] Operation order is fixed and atomic-or-roll-back:
  1. Acquire `.devx-cache/locks/spec-<hash>.lock` (O_EXCL).
  2. Flip DEV.md `[ ]`→`[/]`.
  3. Update spec frontmatter `status: in-progress`, `owner: /devx-<sessionId>`; append status-log line.
  4. Commit on `main` with message `chore: claim <hash> for /devx`.
  5. `git push origin main`.
  6. `git worktree add .worktrees/dev-<hash> -b <derived-branch> main`.
- [ ] Failure at any step rolls back prior steps + releases lock.
- [ ] `devx devx-helper claim <hash>` exposes the operation; prints JSON `{branch, lockPath, claimSha}` to stdout; exit 0 / 1 (lock held) / 2 (rollback).
- [ ] **Closes** `feedback_devx_push_claim_before_pr.md`: regression test asserts the claim commit is pushed to `origin/main` BEFORE any subsequent `gh pr create` call (test mocks gh + git; assert call order).
- [ ] `.claude/commands/devx.md` Phase 1 section explicitly invokes `devx devx-helper claim <hash>` as the first operation.
- [ ] `derived-branch` reuses `deriveBranch()` from pln101 (same primitive) — verified by integration test that single-branch config produces `feat/dev-<hash>`.

## Technical notes

- Lock format pinned for Phase 3's full lock-coordination epic.
- Same atomic-write primitive (`*.tmp` + `rename`) as supervisor-internal.ts (LEARN.md cross-epic).

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-05T18:30 — claimed by /devx in session /devx-2026-05-05T1830 (manual claim — this story IS claimSpec)
