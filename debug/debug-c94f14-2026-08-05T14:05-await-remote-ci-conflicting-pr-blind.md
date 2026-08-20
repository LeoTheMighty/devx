---
hash: c94f14
type: debug
created: 2026-08-05T14:05:00-06:00
title: "await-remote-ci reads a CONFLICTING PR as `empty` — 50min of blind probes for a self-serviceable state"
from: dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md
status: in-progress
owner: /devx-loop-2026-08-19T19-39-20-483-20983
---

## Goal

`devx devx-helper await-remote-ci` distinguishes "workflows configured but
no run exists because the PR is unmergeable" from "workflows configured but
GitHub silently didn't fire". Today both read as `{"state":"empty"}`.

## What happened (evidence)

PR #118 (`feat/dev-sgr105` → `main`) got **zero** workflow runs while the
probe returned `empty` on 41 consecutive probes over ~50 minutes; the
session escalated to INTERVIEW Q#16 per the Phase 7 workflow-no-run rule
and stopped. The actual cause was mechanical and checkable the whole time:
`gh pr view 118 --json mergeable,mergeStateStatus` returned
`CONFLICTING` / `DIRTY` — main had moved under the branch (#119, #120).
GitHub cannot build the merge ref for a conflicted PR, so
`pull_request`-triggered workflows never start. Merging `origin/main` into
the branch and pushing triggered CI immediately.

## Acceptance criteria

- [ ] AC 1: repro exists — a test fixture where the branch's PR is
      conflicted and `gh run list` is empty asserts the probe returns a
      distinct state (e.g. `{"state":"pr-conflicting"}`), not `empty`.
- [ ] AC 2: the probe (or its `empty` branch) checks PR mergeability via
      `gh pr view --json mergeable,mergeStateStatus` and surfaces
      `CONFLICTING` as its own state with the PR number in the payload.
- [ ] AC 3: `/devx` Phase 7 prose routes the new state to a self-service
      fix (merge the base branch into the feature branch, resolve, push,
      re-probe) instead of the INTERVIEW escalation reserved for genuinely
      unexplained silence.

## Technical notes

- Probe lives in the dvx105 `await-remote-ci` machinery under
  `src/` (see `devx devx-helper await-remote-ci`); the `empty` state is
  the retry-then-INTERVIEW branch in `.claude/commands/devx.md` Phase 7
  step 4.
- Mergeability is sometimes `UNKNOWN` right after push (GitHub computes it
  lazily) — the check needs a bounded re-poll before trusting `UNKNOWN`.

## Status log

- 2026-08-05T14:05 — filed from the sgr105 resume session (root cause of
  INTERVIEW Q#16; PR #118 unblocked by merging origin/main into the
  branch).
- 2026-08-20T08:37:53-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
