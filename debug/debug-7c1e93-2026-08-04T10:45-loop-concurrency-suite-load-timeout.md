---
hash: 7c1e93
type: debug
created: 2026-08-04T10:45:00-06:00
title: loop-concurrency G-1 harness times out under full-suite parallel load
from: tur101
spawned: []
status: ready
owner: null
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

## Links

- Found during: `dev/dev-tur101-2026-08-04T10:00-retire-review-tour.md`
