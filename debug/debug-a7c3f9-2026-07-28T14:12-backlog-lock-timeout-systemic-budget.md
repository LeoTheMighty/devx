---
hash: a7c3f9
type: debug
created: 2026-07-28T14:12:00-06:00
title: "Backlog-lock timeouts count toward the systemic claim-failure budget"
status: in-progress
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

## Links

- Parent: `dev/dev-mlc104-2026-07-28T09:02-claim-contention-harness.md`
- Design: `_devx/workstreams/multi-loop-concurrency/design.md` §Architecture 2/3
