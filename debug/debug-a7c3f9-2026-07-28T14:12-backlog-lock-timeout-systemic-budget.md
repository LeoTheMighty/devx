---
hash: a7c3f9
type: debug
created: 2026-07-28T14:12:00-06:00
title: "Backlog-lock timeouts count toward the systemic claim-failure budget"
status: done
from: dev/dev-mlc104-2026-07-28T09:02-claim-contention-harness.md
branch: null
owner: /devx-loop-2026-08-04T19-52-58-179-34486
---
## Goal

A `BacklogLockTimeoutError` during a loop's claim (a live peer held
`locks/backlog.lock` past the 30s deadline) is contention, not a broken
claim — but the driver's claim catch treats it as generic `claim-failed`
and counts it toward `MAX_CONSECUTIVE_CLAIM_FAILURES` (3). mlc104 widened
the claim's locked section from 1 push to up to 5 network ops (3 pushes +
2 rebase-pulls), so a slow remote plus N loops can now convert healthy
contention into a spurious "systemic claim problem" stop via the WAITING
peers (mlc104 review EC-8). Expected: a live-holder timeout routes like
`claim-contended` (mask + pick next, budget untouched) while a
wedged/dead-holder timeout still surfaces; decide against mlc102's
timeout semantics rather than patching blind.

## Acceptance criteria

- [ ] AC 1: repro exists — a driver-level test where a peer's long lock
      hold produces BacklogLockTimeoutError in claims and trips the
      3-strike stop under pure contention.
- [ ] AC 2: root cause documented with evidence (driver.ts claim catch
      vs mlc102's timeout classification intent).
- [ ] AC 3: fix + regression test — live-holder timeouts stop counting
      toward the systemic budget without masking genuinely wedged holders.

## Technical notes

Driver claim catch: `src/lib/loop/driver.ts` (claim-failed branch).
mlc102 chose exit-1 "held" semantics at the CLI (`devx-helper.ts`), so
the CLI already treats it as retryable; only the in-process driver path
disagrees. Coordinate with mlc105's instance registry (admission may
reduce peer pressure on the lock).

## Status log

- 2026-07-28T14:12 — filed by mlc104 Phase 4 review (EC-8); out of
  mlc104's scope (changes mlc102 timeout semantics).
- 2026-07-28T16:28:16-06:00 — claimed by /devx in session /devx-loop-2026-07-28T22-28-16-396-77092
- 2026-07-28T16:33 — RELEASED, not worked. The claim was collateral from an
  mlc105 first-real-run smoke: a real `devx loop --max-items 1` was launched
  against this repo expecting the capacity gate to refuse it, but the smoke's
  live instances had already aged out, so the loop was admitted and claimed
  the top ready DEBUG row. It was killed at iteration 1; no worker commits
  exist on feat/debug-a7c3f9. Row, frontmatter, worktree, branch and spec
  lock all reverted; the item is untouched and free to claim.
- 2026-08-04T13:52:58-06:00 — claimed by /devx in session /devx-loop-2026-08-04T19-52-58-179-34486
- 2026-08-04T20:17:41.309Z — loop iteration 1: Live-holder backlog-lock timeouts during a loop claim now route as contention on their own bounded rail instead of counting toward the systemic claim-failure budget, with wedged/unreadable holders still surfacing.
  - Change: driver.ts claim catch: BacklogLockTimeoutError against a provably-live holder routes like claim-contended (mask + pick next, consecutiveClaimFailures untouched) and emits item:claim-lock-timeout; 3 such timeouts with no successful claim in between stop the run on a separate rail whose stop reason names the holder pid and lock path. Not-provably-live holders (unreadable pid) still fall through to claim-failed + the systemic budget.
  - Change: report.ts: claim-contended label, next-steps advice and summary counter no longer assert 'a peer won the push race' as the only cause — the per-item Detail line distinguishes lock-hold from push-race.
  - Change: test/loop-concurrency.test.ts: three driver-level tests over the real lock machinery (peer lock file with a live pid + real withBacklogLock acquire inside the claim seam) pinning contention routing, the untouched item budget, and the unreadable-holder systemic path — plus the AC 2 root-cause writeup as the block header.
  - Learning: The repro cannot park the lock before runLoop: the driver's mlc105 admission section (`loop-admission`) takes the same backlog lock at startup, so a pre-parked hold refuses the run with exit 1 instead of reaching the claim. The hold has to be taken inside the claim seam.
  - Learning: A backlog-lock timeout with an unreadable holder pid is only reachable via an EMPTY lock body — dead-pid and unparseable bodies are reaped by acquirePathLock before any deadline, and empty bodies are the one shape classifyExistingLock conservatively calls 'held'. That makes the empty-body case the natural test fixture for 'not provably live'.
  - Learning: BacklogLockTimeoutError's message hardcodes BACKLOG_LOCK_TIMEOUT_MS (30000ms) even when the acquire ran with a shorter opts.timeoutMs, so test-seam timeouts render a misleading duration. Cosmetic and test-only today (production never overrides the constant), but it would misreport if the timeout ever becomes configurable.
  - Learning: The full suite is flaky under its own load on this box: running it while other work competes for CPU timed out 25 real-child-process tests in loop-worker/manage-spawn/manage-crash-restart-loop/manage-spawn-integration (loop-worker alone took 117s). All 61 pass isolated on an idle machine — check for this signature before treating a red suite as a regression.
- 2026-08-04T20:19:56.925Z — phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103
- 2026-08-04T20:19:56.926Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/115

## Links

- Parent: `dev/dev-mlc104-2026-07-28T09:02-claim-contention-harness.md`
- Design: `_devx/workstreams/multi-loop-concurrency/design/agent.md` §Architecture 2/3
