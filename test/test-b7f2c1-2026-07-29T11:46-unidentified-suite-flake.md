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

## Links

- Parent: `dev/dev-mlcret-2026-07-28T09:04-retro-multi-loop-concurrency.md`
- Green re-run log (session scratch, ephemeral): `mlcret-full-gate.log`
