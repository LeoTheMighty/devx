---
hash: d7e8e5
type: debug
created: 2026-08-05T12:20:00-06:00
title: "Merge-tail helpers treat transient gh GraphQL 401s as terminal — no retry"
from: dev/dev-sgr107-2026-08-02T13:57-downstream-portability.md
status: in-progress
owner: /devx-loop-2026-08-19T19-39-20-483-20983
---

## Goal

A transient GitHub API failure (401/5xx on one call) should not abort the
merge tail. check-hold / merge-gate (and any helper doing a single gh
call) retry with backoff before reporting exit 2, or the callers are told
to — one flaky call must not strand a green PR unmerged overnight.

## Acceptance criteria

- [ ] AC 1: Repro exists — a mocked Exec returning 401 once then success
      shows check-hold/merge-gate exit 2 on the first call today.
- [ ] AC 2: Root cause documented: no retry layer in the gh Exec path
      (src/lib/exec.ts realExec is single-shot; hold-check.ts and
      merge-gate signal collection surface the first failure).
- [ ] AC 3: Fix + regression test — bounded retry (e.g. 3 attempts,
      exponential backoff, retry only on transient classes: 401 from
      graphql, 5xx, network timeouts) in one shared place, not per-caller.

## Technical notes

Observed 2026-08-05 ~12:00 during sgr107's Phase 8 (attended): GitHub
GraphQL intermittently returned "HTTP 401: Requires authentication"
(~half of calls over ~15 min) while REST calls succeeded and auth was
valid (direct `gh api graphql` + `gh pr view 117` worked seconds
later). `devx devx-helper check-hold 117` exited 2 three times in a row;
`devx merge-gate sgr107` exited 2 once; both succeeded on manual retry
with no state change. Attended cost: a human retry loop. Unattended cost
(devx loop merge tail): a green item stranded as an open PR — the exact
"attended-era contract breaks on first unattended contact" class
(LEARN.md § Cross-epic patterns).

## Status log

- 2026-08-05T12:20 — filed by /devx sgr107 Phase 8 (out-of-scope observation; fix-forward not applicable — helper code untouched by sgr107).
- 2026-08-16T22:21:28-06:00 — claimed by /devx in session /devx-loop-2026-08-13T17-20-48-923-23705
- 2026-08-17T15:51:13.305Z — [FAIL] loop abandoned d7e8e5: 3 consecutive failures on this item; no real work was preserved — bookkeeping-only worktree discarded, item left ready
  - Learning: iteration 1 [FAIL]: No work was performed — the iteration died on an API error immediately after starting, before the spec was read or any file was touched.
  - Learning: iteration 2 [FAIL]: No work was performed — the iteration aborted on an API error (computer slept mid-response) before reading the spec, leaving the worktree clean.
  - Learning: learning: The iteration terminated on 'Your computer went to sleep mid-response' before any tool call ran; a sleep event during a loop iteration can consume an entire iteration budget slot with zero progress and no partial state to recover.
  - Learning: iteration 3 [ERROR]: worker report unparseable after retry (no JSON object found in the output); worker exited 1: …29,"heartbeat":true,"session_id":"10334099-a570-4033-a422-4a5eb9c15228","uuid":"8edeb6d9-5179-4bc9-82a4-11e27e940222"} API Error: Your computer went to sleep mid-response. The response above may be incomplete. API Error: Your computer went to sleep mid-response. The response above may be incomplete.
- 2026-08-19T23:02:07-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-20T05:37:00.209Z — loop iteration 1: Shipped a shared bounded-retry layer for transient gh failures (GraphQL 401 / 5xx / network) wired into check-hold, merge-gate, the CI probe and the unattended loop tail, with 31 regression tests and the full suite green.
  - Change: New src/lib/gh-retry.ts: withGhRetry() decorator gated by two independent predicates — a read-only gh subcommand allowlist (mutations and non-gh commands never retry) and a transient-failure classifier (GraphQL 401, HTTP 5xx/429, network/DNS/TLS, GitHub's 'something went wrong' GraphQL error); 3 attempts, 1s→3s backoff, injectable sleep and onRetry seams
  - Change: Wired the layer into all four merge-tail gh seams: checkHold, runMergeGate's signal collection, await-remote-ci's probe exec, and defaultTail (one wrap covering pr list/view, run list and the checkHold seam); tail passes retry:false into checkHold so the two wraps don't compound to 9 attempts
  - Change: 31 new tests — test/gh-retry.test.ts (25: classifier, idempotence guard, wrapper semantics, and end-to-end checkHold/merge-gate flake recovery) and 6 in test/loop-tail.test.ts (CI-probe and hold-check flake recovery, single-wrap call-count pin, merge-never-retried, bounded give-up)
  - Change: AC-1 repro pinned as executable tests rather than prose: a retry:false opt-out on each consumer reproduces the pre-fix terminal exit 2 / HoldCheckError from a single 401
  - Change: Documented the root cause in the gh-retry.ts module header and updated /devx Phase 8 guidance (plus the skills/devx.md packaged mirror) so exit 2 now reads as a sustained outage rather than a flake to hand-retry
  - Learning: The retry needs an idempotence guard, not just a failure classifier: the loop tail's single exec seam carries gh pr create and gh pr merge alongside the reads, so wrapping the seam without an allowlist would have made a flaky 401 able to double-open or double-merge a PR.
  - Learning: Retry wrappers compose silently — the tail hands checkHold an already-wrapped exec, so an always-wrap default nests 3x3 attempts (~16s of backoff) on a sustained outage. Fixed by making the wrap opt-out-able and asserting the call count (3, not 9) in a test.
  - Learning: 'First bare word after the flags' is the wrong way to find a gh subcommand: a global flag's value is itself a bare word, so `gh --repo o/r pr view` parsed as group 'o/r'. Scanning for the first token that names a known command group is what actually works.
  - Learning: Editing .claude/commands/*.md requires `npm run sync:skills` — the skills/ mirror drift check is a separate script (scripts/sync-skills.mjs --check) and does NOT fail test/skills-packaging.test.ts, so the drift is easy to miss locally and would surface in CI.
