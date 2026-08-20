---
hash: 5e1a77
type: debug
created: 2026-08-19T16:08:00-06:00
title: "16 tests run past their own timeout and still report PASSED — the cap never fires inside a sync-blocking file"
from: debug/debug-5c8b21-2026-08-03T16:20-loop-concurrency-timeout-headroom.md
plan: null
spawned: []
status: in-progress
owner: /devx-loop-2026-08-19T19-39-20-483-20983
branch: null
---

## Goal

A green test should mean the assertions passed within the bound the test
declares. Today, in the 26 files of `SYNC_BLOCKING_TESTS`, it does not: 16
tests exceed their own cap — one by a factor of 44 — and the suite reports
them PASSED.

## Repro (measured, not hypothesized)

Full two-pass `npm test`, 2026-08-19, 12-core macOS, all 139 files green
(2,540 parallel + 733 blocking). Collected with the
`debug-5c8b21` AC-3 sweep:

```
DEVX_HEADROOM_OUT=/tmp/headroom.ndjson npx vitest run \
  --config vitest.blocking.config.ts \
  --reporter=default --reporter=./scripts/timeout-headroom.mjs
node scripts/timeout-headroom.mjs /tmp/headroom.ndjson --min 1
```

Worst offenders — every one of them **passed**:

| test | ran | declared cap |
|---|---|---|
| `loop-driver.test.ts:1271` | 221,677ms | 5,000ms (default) |
| `loop-driver.test.ts:903` | 212,966ms | 5,000ms |
| `loop-driver.test.ts:1820` | 195,374ms | 5,000ms |
| `loop-driver.test.ts:861` | 182,478ms | 5,000ms |
| `learn-watch.test.ts:1269` | 139,550ms | 5,000ms |
| `loop-driver.test.ts:551` | 134,802ms | 5,000ms |
| `devx-claim.test.ts:754` | 114,868ms | 5,000ms |
| `stub.test.ts:148` | 108,492ms | 5,000ms |

16 tests under 1.0x; 21 under 2x. All 21 are in `SYNC_BLOCKING_TESTS`, across
15 files. Of the 65 tests under 5x, only 5 are in the async parallel pass
(`loop-worker.test.ts` ×4 at 3.0–4.9x against explicit 15s caps, and
`manage-spawn-integration.test.ts:124` at 4.0x) — and those caps DO fire.

## Root cause (already known, never closed)

`vitest.shared.ts` names this as fault (2) and predicted it exactly:
`realExec` (`src/lib/exec.ts`) is `spawnSync`, so a blocked event loop cannot
run its own `setTimeout` callback. `@vitest/runner`'s `withTimeout` wraps the
handler in a promise race — and the timer in that race never gets a tick while
the loop is blocked. The cap is not "generous", it is **absent**.

`debug-ecdcda` predicted this sweep would surface these at ~1x, and its own
row says "this may collapse into it". It closed (PR #125) having fixed the
`manage-spawn` symptom by partitioning; the mechanism it named — the async
exec seam — was never built, and `debug-620337` was folded into it rather than
into the mechanism. So this class has no open owner. That is what this spec
is for.

## Acceptance criteria

- [ ] AC 1: `src/lib/exec.ts` grows an async seam (or the blocking call sites
      move to one) such that a test in the blocking set can be interrupted by
      its own timeout. Prove it with a test that deliberately overruns a small
      cap and FAILS.
- [ ] AC 2: the 16 sub-1x tests either come in under a declared, enforceable
      cap or carry an explicit cap justified by measurement — no test left
      running 44x its bound.
- [ ] AC 3: re-run `scripts/timeout-headroom.mjs` and record the new
      distribution in its `LAST SWEEP` block; the blocking-pass numbers become
      meaningful for the first time.
- [ ] AC 4: no assertion is weakened to hit a cap — if a test genuinely needs
      200s of real git, it declares 200s+ and says why.

## Technical notes

- Do NOT "fix" this by raising the caps to match the observed durations. A cap
  that cannot fire is not enforcement at any value; raising it just makes the
  false green look intentional.
- `vitest.blocking.config.ts`'s `maxForks: 2` partition (debug-7c1e93) fixed
  the OTHER fault — cross-process starvation. It explicitly does not address
  this one, and says so.
- Sequencing: this is the mechanism fix that makes measured caps
  (`debug-5c8b21`) meaningful for the blocking set. The async majority already
  has real margin — nothing in the 2,540-test parallel pass is under 2x.

## Status log

- 2026-08-19T16:08 — filed from debug-5c8b21's AC-3 suite-wide sweep, which
  is what turned "some tests are close to their cap" into "16 tests are past
  it and green anyway". Fifth instance of the timing-dependent-test class
  (after c81f04, 74632d, 5c8b21, ecdcda) and the first one where the failure
  mode is a false PASS rather than a red build.
- 2026-08-20T10:00:54-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-20T16:08:37.876Z — loop iteration 1: Added the async exec seam (realExecAsync) to src/lib/exec.ts with an in-suite, negative-control-verified proof that a test's declared timeout now actually fires — closing AC 1.
  - Change: src/lib/exec.ts grew realExecAsync + the ExecAsync type: spawn-based, behaviourally identical to realExec (env merged over process.env, spawn failures and signal kills resolve as exitCode 127 rather than rejecting, 64MB output ceiling enforced by hand with kill-and-127 instead of silent truncation), with stdin set to `ignore` for hang-immunity on the overnight-loop paths
  - Change: test/exec-async-seam.test.ts (11 tests, 2.3s) proves AC 1: an it.fails test that overruns a 200ms cap through the async seam stays green only when the cap fires, paired with an ordinary test asserting the body was abandoned mid-flight rather than merely throwing; the sync counterpart running 10x past the same cap and reporting PASSED is pinned in the same file as the live fault
  - Change: Six parity tests plus a maxBuffer-overflow test cover the seam's contract against realExec's observable behaviour
  - Change: vitest.shared.ts registers the new file in SYNC_BLOCKING_TESTS and its fault-(2) note now states that the seam exists but ADOPTION has not happened — the listed files still call realExec and their caps are still unenforceable
  - Learning: vitest 2.1's `it.fails` DOES convert a timeout into a pass, which makes an overrunning test expressible inside the green suite — no nested vitest child run is needed for AC 1's proof. Verified with a negative control: swapping realExecAsync for realExec turns the file red (2 failures), so the proof is not vacuous.
  - Learning: The abandoned child of a timed-out async exec does not extend the file's wall-clock — it runs in the background overlapping the remaining tests. A 3s sleep abandoned at 200ms cost the file nothing, so margin on the 'was it the cap or the child finishing?' assertion is free.
  - Learning: The maxBuffer overflow branch is cheap to test for real: `yes | head -c 70000000` trips the 64MB ceiling in 63ms, so that kill path is covered rather than left to production.
  - Learning: The parallel pass has grown since the spec's sweep — 117 files / 2631 tests (25s) vs the recorded 113 / 2540. AC 3's re-sweep numbers will not be line-comparable to the LAST SWEEP block without noting that.
  - Learning: The repo has no linter; the local gate is `tsc --noEmit` + build + the two vitest passes.
  - Learning: AC 2's real choke point is git-tx's single `git()` helper — making it async is contagious through driver.ts, preflight.ts, report.ts and tail.ts, and that ripple (not exec.ts) is where the remaining iteration budget will go.

## Links

- Parent: `debug/debug-5c8b21-2026-08-03T16:20-loop-concurrency-timeout-headroom.md`
- Sweep tool + recorded results: `scripts/timeout-headroom.mjs`
- Fault (2) statement: `vitest.shared.ts`
- Prior instances: `debug-c81f04`, `debug-74632d`, `debug-ecdcda`, `debug-620337`
