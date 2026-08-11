---
hash: 7c1e93
type: debug
created: 2026-08-04T10:45:00-06:00
title: loop-concurrency G-1 harness times out under full-suite parallel load
from: tur101
spawned: []
status: done
owner: /devx-2026-08-11T1348-23414
branch: null
---

## Goal

`test/loop-concurrency.test.ts`'s G-1 harness ("merged union == serial
baseline, DEV.md byte-equal, 0 contention aborts — across ≥3 seeds")
should pass in the full `npm test` run, not just in isolation.

## Repro

Observed 2026-08-04 during tur101's local gate:

```
FAIL test/loop-concurrency.test.ts > two overlapping in-process loops over one
     fixture (G-1 harness) > merged union == serial baseline, DEV.md
     byte-equal, 0 contention aborts — across ≥3 seeds
Error: Test timed out in 600000ms.

Test Files  2 failed | 131 passed (133)
   Duration  1779.04s
```

Same commit, same file, run alone:

```
$ npx vitest run test/loop-concurrency.test.ts
 ✓ test/loop-concurrency.test.ts (6 tests) 147427ms
   ✓ ... G-1 harness ... 95582ms
 Test Files  1 passed (1)
```

**95s alone vs. >600s under load** — a ~6.3× slowdown, so the harness is
starved rather than deadlocked. The full suite spends 6,085s of test time
in 1,779s of wall clock (~3.4 workers saturated); this test spawns real
overlapping in-process loops driving real `git` subprocesses, so it is the
most CPU-contended file in the suite and the first to blow a timeout.

## Evidence added at PR-open (narrows this considerably)

Remote CI ran the **same commit, same `npm test`, same 133 files / 3,060
tests** on ubuntu-latest and macos-latest:

```
Test Files  133 passed (133)
     Tests  3060 passed | 1 skipped (3061)
  Duration  27.87s (tests 56.81s)
```

57s of test time in CI vs. **6,085s locally** — ~100×. Nothing relevant is
skipped (the single skip is the Windows-only postinstall block). The G-1
harness therefore completes comfortably on a Linux runner.

This makes the deadlock reading unlikely and points at local process-spawn
cost: the harness's runtime is dominated by real `git` subprocesses, which
are far more expensive on macOS than on Linux. The isolated local run took
147s for this one file — more than CI needed for the entire suite.

## Root cause (hypothesis, narrowed by the CI evidence above)

The 600s timeout was sized against an unloaded machine. The harness's cost
is dominated by real `git` process spawns inside two concurrent loops; when
vitest's other workers saturate the box, each spawn queues behind them.
Nothing in the harness is order- or state-dependent — it passed 3/3 seeds
in isolation.

Not-the-cause, ruled out: `tur101` repointed this file's import from
`../src/lib/tour/exec.js` to `../src/lib/exec.js`. That is a pure path
rename of an unchanged module (`git mv` + import fix, no body edit), and
the file passes in isolation at the same commit.

## Acceptance criteria

- [ ] Repro captured as a runnable command (e.g. run the full suite with
      the same worker count on an otherwise-idle machine and confirm
      the G-1 test's wall-clock).
- [ ] Root cause documented with evidence — macOS spawn cost + worker
      starvation (the leading hypothesis, supported by the CI numbers)
      vs. an actual contention deadlock. The deadlock reading is now
      unlikely but not formally excluded; if it were true it would be a
      real `devx loop` bug outranking this file's timeout.
- [ ] Fix + regression: either isolate the harness (`test.concurrent`
      exclusion / its own vitest project / `poolOptions` pinning) or
      raise its timeout with a comment justifying the number. Do NOT
      simply bump the timeout without first ruling out the deadlock.

## Technical notes

- Prior art: `mlcret` (PR #103) fixed a `loop-driver` ENOTEMPTY teardown
  flake (`test-b7f2c1`) in the same neighborhood — this family of tests
  has a history of load sensitivity.
- The run that surfaced this was reported as "exit code 0" by the agent
  harness's background-task wrapper even though the vitest summary said
  `2 failed`. **That is a wrapper artifact, not a devx bug** — checked
  directly: `npm run test:vitest -- <nonexistent>` exits 1, so npm does
  propagate vitest's status through the `&&` chain. Recorded here only so
  the next reader doesn't re-investigate it. The standing rule holds:
  trust the `Test Files … passed/failed` summary, never the exit code.

## Status log

- 2026-08-04T10:45 — filed from tur101's local gate. Reproduced the
  pass-in-isolation / fail-under-load split at the same commit; ruled out
  tur101's import-path rename as the cause.
- 2026-08-04T11:0x — CI on PR #113 ran the identical suite green in 27.87s
  wall / 56.81s test time on both ubuntu and macos runners (vs. 1,779s /
  6,085s locally). Deadlock hypothesis substantially weakened; reframed as
  local spawn-cost starvation. Worth noting separately: the local `npm
  test` gate costs ~30 min on this machine for work CI does in ~30s, which
  is a developer-experience problem in its own right.
- 2026-08-11T13:48:33-06:00 — claimed by /devx in session /devx-2026-08-11T1348-23414

- 2026-08-11 — phase 3 (root cause, with evidence). Hypothesis → check → result, one line each:
  - H1 "reproduces from an agent worktree at baseline" (debug-620337's premise) → ran the 3 named files from the main checkout vs a linked worktree at the same commit → REFUTED: 19.39s vs 19.42s, 55/55 green in both. Worktrees are irrelevant.
  - H2 "worker oversubscription (11 local workers vs CI's 3-4)" → full suite at `--minWorkers=1 --maxWorkers=4` → REFUTED: still red (12 tests), 936s vs 947s. With every worker blocking, 4 saturate as well as 11.
  - H3 "the real `claude` CLI is on local PATH and absent in CI, so tests spawn it for real" → read the stubs → REFUTED: `loop-worker` passes `claudeBin: process.execPath`; `loop-driver` injects a `WorkerRunFn` outright.
  - H4 "host is slow (spawn / git / fs / gpg signing)" → measured → REFUTED: node spawn 36ms, 20 fixture git commits 0.81s, no `commit.gpgsign`, no hooksPath.
  - H5 "CI is green because it skips these tests" → `gh run view --log` + grep for CI guards → REFUTED: CI runs all 136 files (32.0s ubuntu / 98.5s macOS wall; 69s / 158s cumulative test time). No guard in any suspect file.
  - H6 "the driver's real backoff sleeps dominate" → read the fixture → REFUTED: `MERGED.loop.backoff_ms = [1, 2, 3]` and an `instantSleep` helper exists.
  - ROOT CAUSE (confirmed): `realExec` (`src/lib/exec.ts:28`) is `spawnSync`. Every real-git call blocks its test process's event loop for the call's full duration. Vitest runs one process per file (`pool: 'forks'`), which splits this into two distinct faults: (1) CROSS-PROCESS CPU STARVATION — ~11 concurrent blocking processes saturate 12 cores, so genuinely-async tests elsewhere miss their deadlines and fail exactly on their cap (5.0s/15.0s/30.0s); (2) UNENFORCEABLE TIMEOUTS INSIDE A BLOCKING FILE — a blocked loop cannot run its own timeout callback, so `loop-driver`'s slowest test ran 233.8s under the 5,000ms default and REPORTED PASSED (12.5s even in isolation). The AC's deadlock reading is EXCLUDED: no test hangs, every file passes alone, and the failures are timeout-shaped rather than never-returning.
  - Fault (2) is a FALSE-GREEN class, worse than the red: at least ten of the slowest tests currently have caps that cannot fire. It is out of scope here (the exec seam is debug-ecdcda/debug-620337; measured caps are debug-5c8b21) and is recorded so the next spec inherits it, not lost.
- 2026-08-11 — phase 3 (fix). Fault (1) fixed by partitioning the suite, not by widening any timeout: `npm test` now runs `test:parallel` (110 async-sensitive files, full parallelism) then `test:blocking` (26 sync-blocking files, `maxForks: 2`). Membership is mechanical — a file belongs to pass 2 iff it calls a synchronous child-process API or imports a `test/helpers/` fixture that does — and `test/vitest-split.test.ts` pins the list against the tree so a new blocker cannot silently rejoin pass 1. Selector precision mattered: matching bare identifiers picked up prose mentions, and following local imports transitively selected 86 of ~110 files (importing a module is not executing its sync branch), so the marker is anchored on call-site punctuation and resolution is one hop through `test/helpers/` only.

- 2026-08-11 — merged via PR #124 (squash → 10a0105). CI green both runners. Partial by design: fault (1) fixed (10 of 12 failures); fault (2) — unenforceable caps inside blocking files, incl. the 2 residual manage-spawn-integration failures and the +10% wall-clock — carried to debug-ecdcda/debug-620337 (exec seam) and debug-5c8b21 (measured caps).

## Links

- Found during: `dev/dev-tur101-2026-08-04T10:00-retire-review-tour.md`
- 2026-08-05T11:47 — sgr107 Phase 5 corroboration: full `npm test` red 4 files / 20 tests (loop-worker, manage-spawn, manage-spawn-integration, manage-crash-restart-loop — all real-child-process spawners) under parallel suite load; same 4 files 61/61 green re-run in isolation at the same commit. Diff under test (standalone eval + MANUAL.md prose) imports none of them. Same macOS spawn-cost-under-load signature.
