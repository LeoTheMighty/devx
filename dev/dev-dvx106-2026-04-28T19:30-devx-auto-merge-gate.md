---
hash: dvx106
type: dev
created: 2026-04-28T19:30:00-07:00
title: Phase 8 auto-merge wired through devx merge-gate
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [dvx101, mrg102]
branch: feat/dev-dvx106
---

## Goal

Wire `/devx` Phase 8 to invoke `devx merge-gate <hash>` (mrg102) instead of inlining mode logic. Removes the "Behavior by mode" table from the skill body — single source of truth in `merge-gate.ts`.

## Acceptance criteria

- [ ] `.claude/commands/devx.md` Phase 8 first action: `devx merge-gate <hash>`. Parses JSON output: `{merge, reason, advice?}`.
- [ ] On `merge:true`: executes `gh pr merge <#> --squash --delete-branch`; verifies via `gh pr view <#> --json state,mergeCommit` (handles `feedback_gh_pr_merge_in_worktree.md` worktree-exit-nonzero-but-merged case).
- [ ] On `merge:false`: parses `advice` array:
  - `"file INTERVIEW for approval"` → files INTERVIEW.md entry + leaves PR open + stops.
  - `"wait for CI"` → re-enters Phase 7 polling.
  - `"manual merge required"` → stops with status-log + MANUAL.md entry.
- [ ] After merge: bookkeeping commit on `main` (DEV.md `[/]`→`[x]`; spec status: done; sprint-status story → done; PR URL appended) is one commit pushed to `origin/main`.
- [ ] The "Behavior by mode" table is REMOVED from `.claude/commands/devx.md` — lives in `merge-gate.ts` only.
- [ ] Tests: each mode's gate decision flowing through to /devx's merge command (end-to-end with fixture spec + mocked gh).
- [ ] **Reaffirms** `feedback_yolo_auto_merge.md` and `feedback_gh_pr_merge_in_worktree.md` with testable assertions.

## Technical notes

- Trust-gradient is `0/0` for this project so the override never fires — but the test fixture exercises the override branch with a synthetic `{count:5, initialN:10}` config to verify INTERVIEW filing path works.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
