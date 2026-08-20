---
hash: c94f14
type: debug
created: 2026-08-05T14:05:00-06:00
title: "await-remote-ci reads a CONFLICTING PR as `empty` — 50min of blind probes for a self-serviceable state"
from: dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md
status: done
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
- 2026-08-20T15:10:40.745Z — loop iteration 1: The remote-CI probe now distinguishes a conflicted PR from unexplained workflow silence, returning a new terminal `pr-conflicting` state that /devx Phase 7 routes to a self-service merge-and-re-probe instead of a 50-minute blind wait and INTERVIEW escalation.
  - Change: probeRemoteCi's empty path reads `gh pr view --json number,mergeable,mergeStateStatus` and returns `{state:"pr-conflicting", prNumber, mergeable, mergeStateStatus}` for CONFLICTING/DIRTY; UNKNOWN mergeability is re-polled a bounded 3x/2s, and every failure mode of the read degrades to the pre-existing `empty` so the check can only add diagnosis
  - Change: awaitRemoteCi returns pr-conflicting terminally from all three dispatch points (first probe, post-empty retry, mid-poll) and skips the 60s empty-retry, since waiting cannot build a merge ref that does not exist
  - Change: /devx Phase 7 step 4 gained a pr-conflicting bullet routing to the self-service fix (fetch+merge the derived integration branch, resolve, re-run Phase 5 gates, push, back to step 4) and explicitly not to INTERVIEW; the empty bullet's escalation is now scoped to unexplained silence; skills/devx.md mirror synced
  - Change: Test coverage: +22 lib tests including the PR #118 repro, +3 CLI passthrough tests pinning exit 0 with the payload (not exit 2), and a new test/devx-skill-phase7-conflicting.test.ts (8 tests) pinning the prose routing against drift
  - Change: Docs updated in lockstep: module header, state-transition diagram, probe jsdoc evaluation order, devx-helper.ts exit-code block and CLI --help state enumeration
  - Learning: test/await-remote-ci.test.ts's fakeExec throws on any unconfigured command signature, so adding a second gh call inside an existing code path would have broken ~10 pre-existing fixtures. Making the mergeability read degrade silently on an exec throw was required for compatibility and is independently the right failure posture — every old empty-state fixture now exercises the fallback.
  - Learning: src/lib/loop/tail.ts has the same blindness for the unattended path and does NOT inherit this fix: it consumes hasWorkflowFiles + parseGhRunList directly rather than probeRemoteCi, so a conflicted PR overnight still polls to the CI timeout and hands off with 'remote CI did not complete within Nmin'. Worth a follow-up debug spec.
  - Learning: Full `npm test` took ~23 min here (1382s in the blocking leg alone), longer than the ~17 min recorded in memory — budget a full iteration for it and pipe output to a file rather than through `tail`, which buffers everything until the pipeline exits and makes progress unobservable.
- 2026-08-20T15:13:29.596Z — phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103
- 2026-08-20T15:13:29.597Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/133
