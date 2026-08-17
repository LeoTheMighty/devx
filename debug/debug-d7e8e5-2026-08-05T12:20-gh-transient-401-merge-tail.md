---
hash: d7e8e5
type: debug
created: 2026-08-05T12:20:00-06:00
title: "Merge-tail helpers treat transient gh GraphQL 401s as terminal — no retry"
from: dev/dev-sgr107-2026-08-02T13:57-downstream-portability.md
status: ready
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
