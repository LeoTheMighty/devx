---
hash: ecdcda
type: debug
created: 2026-08-05T13:10:00-06:00
title: manage-spawn / manage-spawn-integration time out at a fixed 5s whenever the box is loaded
from: dev/dev-28b267-2026-08-05T11:25-learn-auto-allow.md
status: in-progress
owner: /devx-2026-08-12T1559-70162
blocked_by: []
branch: null
---

## Goal

`npm test` should be a gate a dev can trust on a working machine. Today,
whenever this repo runs more than about two agents at once, seven tests in
two files fail with a bare `Test timed out in 5000ms` — and they fail on a
**clean tree**, so every /devx run on a busy box has to spend 20–70 minutes
proving the red isn't its own.

Observed 2026-08-05 during 28b267's Phase 5, on a machine with four peer
worktrees active (`dev-sgr105`, `dev-sgr106`, `dev-sgr107`, `debug-c81f04`):

```
❯ test/manage-spawn.test.ts (27 tests | 4 failed) 20056ms
  × spawnWorker — child process integration > spawns the claude binary, … 5007ms
    → Test timed out in 5000ms.
  × … falls back to DEVX_CLAUDE_BIN env when claudeBin opt is not set 5004ms
  × … replaces a stale roster entry for the same spec_hash on re-spawn 5005ms
  × spawnWorker — using node:child_process spawn (sanity) > accepts an explicit spawnFn override 5004ms
❯ test/manage-spawn-integration.test.ts (6 tests | 3 failed) 46571ms
  × tick 1: spawns from a ready DEV.md spec; logs PID; summary 'spawned <hash>' 5009ms
  × tick 1 spawn → child exits → tick 2: roster cleared, summary 'no work' 5005ms
  × does not resurrect a dead PID into the roster when the child exits before tick-write 5003ms
  ✓ `devx manage --once` end-to-end with fixture DEV.md > tick 1 spawns a stub worker … 31546ms
```

That last line is the tell: a sibling test in the same file, doing the same
kind of work, took **31.5 seconds** and passed because it carries its own
generous timeout. The failing seven are pinned at vitest's 5s default while
they wait on real `spawn()`ed child processes.

**Confirmed pre-existing, not diff-induced.** The 28b267 worktree ran these
two files with its changes stashed (`git stash push -u` → run → `git stash
pop`): the clean tree failed **7**, the dirty tree failed **6**. 28b267
touches only `src/lib/learn/*`, which neither file imports.

## Acceptance criteria

- [ ] AC 1: Root-cause named with evidence — for each of the seven, say what
      it is actually waiting on (child `spawn` → `exit` round trip? the
      roster/state write that follows it? the log-file flush?) and why 5s is
      not enough under load. A wall-clock measurement of the awaited step on
      an idle vs. loaded box goes in the status log.
- [ ] AC 2: Fixed at the mechanism, not by blanket-widening the timeout.
      Prefer waiting on the actual signal (an `exit` event, a written marker,
      a polled predicate with its own bound) over a sleep-and-hope. Where a
      timeout genuinely is the right tool, it is set from the awaited work's
      measured cost and carries a comment saying so — the b7f2c1 rule ("do
      NOT 'fix' it by adding a retry or widening a timeout without naming the
      mechanism") applies here verbatim.
- [ ] AC 3: A regression check that the fix holds under contention — the two
      files pass with a CPU-pressure process running alongside, not merely on
      an idle machine.
- [ ] AC 4: Audit the sibling suites for the same shape. `loop-worker.test.ts`
      showed one failure in isolation (`does NOT grace-kill on invalid report
      text (waits for real exit)`, also a 5s timeout) and many more under the
      full-suite run — same class, likely same fix.

## Technical notes

- The stub-`claude` fixtures are shell/node scripts on PATH; process startup
  on a contended macOS box is the obvious suspect for the first few hundred
  ms, but 5s is a big budget to blow on `fork+exec` alone. Measure before
  assuming — the awaited step may be the state write, not the spawn.
- Related but distinct: `test/test-b7f2c1-2026-07-29T11:46-unidentified-suite-flake.md`.
  Its original flake (background `git gc --auto` writing into a directory
  under `rmSync`) was identified and fixed in PR #103; this is a different
  mechanism and gets its own spec rather than reopening that one.
- **b7f2c1 AC 3 is still open and this run is fresh evidence for it.** The
  first full gate here lost its own diagnosis: the capture retained a 30-line
  tail, so the summary (`4 failed | 130 passed`) survived and the failing test
  names did not — costing a full 29-minute re-run to recover what a
  persistent `--reporter=json --outputFile` under `.devx-cache/` would have
  written straight to disk. Second occurrence of that exact cost.
- Contention is the trigger, not the cause. The same seven pass on an idle
  machine, which is why CI has never seen them — and why a dev with four
  agents running is the only person who ever will.
- **Fourth instance of the timing-dependent-test class**, after `debug-c81f04`,
  `debug-74632d`, `debug-7c1e93`, and `debug-5c8b21`. Read `debug-5c8b21` first:
  its AC 3 is already "a suite-wide sweep for tests within 2x of their
  timeout," and these seven are the sharpest concrete instance of exactly that
  — they sit at roughly **1x** (a 5s cap on work that needs >5s under load),
  where 5c8b21's own case had ~1.3x headroom. If that sweep is done first this
  spec may collapse into it; filed separately because the file pair, the
  awaited signal (child-process exit vs. a concurrency harness), and the
  reproduction (consistent on a loaded box, not intermittent) all differ.

## Status log

- 2026-08-05T13:10 — filed from 28b267's Phase 5 (out-of-scope bug, not
  absorbed). Evidence: two full-suite runs (`4 failed | 130 passed` twice,
  24 and 29 minutes) plus an isolated 4-file run (6 failed / 61) plus the
  decisive clean-tree stash run (7 failed / 33). Every failure message is
  `Test timed out in 5000ms`; no assertion failures among them.
- 2026-08-11T14:34:21-06:00 — claimed by /devx in session /devx-2026-08-11T1434-73239

- 2026-08-11 — investigation (no code change yet). Scoping the "async exec seam" fix found that its PREMISE IS WRONG, so it is recorded before any refactor is spent on it:
  - The blocking that matters is TEST-SIDE, not src-side. `test/helpers/loop-git-fixture.ts:18` builds every loop fixture with `execFileSync("git", ...)`, and `test/manage-spawn-integration.test.ts:316` uses `spawnSync(node, [CLI_DIST, "manage", "--once"])`. Converting `src/lib/exec.ts`'s `realExec` to async would not touch either, so it would NOT fix `loop-driver`'s 561s nor its unenforceable caps.
  - Corrected target for the mechanism fix: promisify the TEST fixtures' git helpers (`g()` and peers) and await them, so a fixture build yields the loop. Blast radius is test-only (no production risk) but wide — every fixture call site in the 26 blocking files becomes `await`.
  - The two residual failures from PR #124 are a DIFFERENT, smaller bug: `tick 1 spawn → child exits → tick 2` and `does not resurrect a dead PID` are ALREADY async (`await runManagerOnce`). They sit in pass 2 only because their file contains one unrelated `spawnSync` test at :316. The partition is per-FILE while blocking is per-TEST, so a mostly-async file is misclassified by a single sync test. Fix is either splitting that file (sync test → pass 2, async rest → pass 1) or a measured cap (debug-5c8b21), not the exec seam.
  - `realExec` is also duplicated: `src/lib/exec.ts:27`, `src/lib/devx/claim.ts:189`, `src/lib/devx/await-remote-ci.ts:178`, `src/commands/split.ts:87` each define their own. Any seam change has to reckon with four definitions, not one.
- 2026-08-12 — reconciliation audit: the 2026-08-11T14:34 claim's owner PID (73239) is dead and its worktree held no commits and no dirty files (the investigation above was committed straight to `main` as `d5336ff`). Claim released, worktree + `feat/debug-ecdcda` removed, `status` reset `in-progress` → `ready`. No work was discarded.
- 2026-08-12 — still reproduces at `d5336ff`: full `npm test` gave `Test Files 1 failed | 25 passed (26)`, `Tests 3 failed | 723 passed (726)`, all three the `Test timed out in 5000ms` shape in `manage-spawn-integration.test.ts`, alongside a sibling in the same file passing at 52,131ms. Confirms the per-FILE-vs-per-TEST misclassification reading above, not the exec seam.
- 2026-08-12 — absorbed `debug-620337` (loop-worker + manage-crash-restart-loop red from an agent worktree). Its worktree premise was refuted by 7c1e93's H1 (19.39s main vs 19.42s linked worktree, 55/55 green both) and both of its named files passed in the 2026-08-12 full run. Whatever residue it had is this item's test-side blocking plus `debug-5c8b21`'s measured caps.
- 2026-08-12T15:59:13-06:00 — claimed by /devx in session /devx-2026-08-12T1559-70162

## Links

- `test/manage-spawn.test.ts`, `test/manage-spawn-integration.test.ts`
- `test/loop-worker.test.ts` — AC 4's sibling audit
- `src/lib/manage/spawn.ts` — the code under test
- Sibling: `test/test-b7f2c1-2026-07-29T11:46-unidentified-suite-flake.md`
  (AC 3/AC 4 open: persistent failure-detail reporter)
- Same class, read first: `debug/debug-5c8b21-2026-08-03T16:20-loop-concurrency-timeout-headroom.md`
  (its AC 3 sweep would catch these seven),
  `debug/debug-7c1e93-2026-08-04T10:45-loop-concurrency-suite-load-timeout.md`,
  `debug/debug-74632d-2026-07-29T00:50-loop-driver-fixture-teardown-enotempty.md`
- Parent run: `dev/dev-28b267-2026-08-05T11:25-learn-auto-allow.md`
