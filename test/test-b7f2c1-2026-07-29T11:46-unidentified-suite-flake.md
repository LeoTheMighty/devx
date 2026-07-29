---
hash: b7f2c1
type: test
created: 2026-07-29T11:46:00-06:00
title: "Unidentified 1-in-2,665 suite flake under load + full-log capture for long gate runs"
from: dev/dev-mlcret-2026-07-28T09:04-retro-multi-loop-concurrency.md
status: ready
owner: null
branch: null
---
## Goal

On 2026-07-29 the mlcret session's post-merge gate on `feat/dev-mlcret`
reported **1 failed / 2664 passed (2665)**, `GATE2_EXIT=1`. An immediate
re-run of the same tree (`951b4f8`) was **131 files / 2,665 tests passed,
exit 0**. The failing test could not be identified, because the only
surviving record of the red run was its output file's 4-line tail:

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed | 130 passed (131)
      Tests  1 failed | 2664 passed (2665)
   Duration  3155.56s
```

Two separate problems, one spec, because the second is why the first is
unresolvable:

1. **A real flake exists somewhere in the suite** and is load-sensitive —
   the red run took 3,155s wall (5,466s test time) against 882s for the
   green run, i.e. a far more contended machine. Bisection cleared 19 of
   131 files (discipline/prose-budget 80 tests, concurrency class 129,
   the six merge-touched files 113) without reproducing it.
2. **A ~50-minute gate can lose its own failure evidence.** Vitest's
   default reporter prints failure detail *above* the summary; when the
   run is captured by something that retains a tail, the summary survives
   and the diagnosis does not. A gate you cannot diagnose costs a full
   re-run to disprove — 15–50 minutes each time.

## Acceptance criteria

- [ ] AC 1: Identify the flaky test. Run the suite under load (parallel
      CPU pressure, or `--no-file-parallelism` off with a stress process)
      enough times to reproduce a non-zero exit, with FULL output
      captured to a file. Name the test in this spec's status log even if
      the fix lands separately.
- [ ] AC 2: Fix the flake at its cause — a real timing assumption, a
      shared temp path, an unawaited handle, or a fixed timeout that is
      too tight under contention. Do NOT "fix" it by adding a retry or
      widening a timeout without naming the mechanism that made it fail.
- [ ] AC 3: Long gate runs preserve failure detail independent of how the
      caller captures stdout: configure a persistent reporter (e.g.
      vitest `--reporter=json --outputFile` or the junit reporter)
      alongside the human one, writing under `.devx-cache/` (gitignored),
      so the failing test name survives a truncated capture.
- [ ] AC 4: A regression check that AC 3 actually holds — assert the
      configured output file exists and names failures after a
      deliberately-failing run.

## Technical notes

- Suspect classes not yet cleared by bisection: anything spawning real
  processes or racing on wall-clock. `loop-worker`, `loop-iteration`,
  `loop-tail`, `loop-git-tx`, `loop-sleep-inhibit`, `manage-*`, and the
  `devx-claim` / `await-remote-ci` families are the natural first sweep.
- The concurrency class most people would suspect first (`loop-concurrency`,
  `claim-contention`, `spec-lock`, `backlog-mutate`, `loop-instances`,
  `manage-lock`×2, `loop-chaos`) was run in isolation and passed 129/129 —
  so prefer the process-spawning and timing families over those.
- Relevant memory: `feedback_never_kill_the_gate.md` (a killed gate can
  still report exit 0; read the "Test Files … passed" summary, never the
  exit code) and `feedback_agent_suite_parking.md`.

## Status log

- 2026-07-29T11:46 — created by /devx mlcret (Phase 8 gap filing). Filed
  rather than absorbed: the green re-run is evidence the tree is healthy,
  not evidence the flake does not exist.
- 2026-07-29T11:56 — **IDENTIFIED AND FIXED — by the very next CI run**
  (PR #103, run 30477239517), which reproduced the identical signature
  (`1 failed | 2664 passed (2665)`) and named it:

  ```
  FAIL test/loop-driver.test.ts > E-3: budget-rail split (mss103)
       > real progress at iteration-budget exhaustion → outcome split: …
  Error: ENOTEMPTY: directory not empty, rmdir
         '/var/…/devx-loop-driver-2nWSGn/origin.git'
   ❯ test/loop-driver.test.ts:46:16   ← the afterEach rmSync
  ```

  Not an assertion failure — a **teardown race**. Mechanism: `makeFixture`
  built the bare origin with `git init --bare` and never disabled auto-gc,
  so a push into it could fire `git gc --auto` on the receive side in the
  BACKGROUND; that keeps creating objects and lock files under
  `origin.git` after `git push` has already returned, and `afterEach`'s
  `rmSync` then walks a directory being written to. Only the push/split-
  bearing scenarios could trigger it, which is exactly why it presented as
  a rare load-sensitive flake rather than a consistent failure.

  Fix (AC 1 + AC 2, in PR #103): `test/helpers/loop-git-fixture.ts` sets
  `gc.auto=0`, `receive.autogc=false`, `maintenance.auto=false` on the
  bare origin and `gc.auto=0` + `maintenance.auto=false` on the clone —
  killing the mechanism rather than widening a timeout. The three fixture
  teardowns (`loop-driver`, `loop-iteration`, `loop-preflight`) also gained
  `maxRetries: 10, retryDelay: 50` as belt-and-braces for anything else
  that writes during teardown.

  **AC 3 + AC 4 remain open** — the diagnosis here cost a 52-minute
  re-run and was ultimately recovered from CI, not from the local capture.
  A persistent reporter is still worth having. Retitle on next touch:
  the flake is no longer unidentified.
- 2026-07-29T11:56 — note on confidence: a green run after this fix is
  CONSISTENT with the fix, not proof of it — the flake was rare by nature.
  The evidence that matters is the named mechanism (background auto-gc
  writing into a directory under `rmSync`), not the passing run.

## Links

- Parent: `dev/dev-mlcret-2026-07-28T09:04-retro-multi-loop-concurrency.md`
- Green re-run log (session scratch, ephemeral): `mlcret-full-gate.log`
