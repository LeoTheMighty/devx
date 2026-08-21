---
hash: 2e1174
type: debug
created: 2026-08-21T16:05:00-06:00
title: "Tests in the ASYNC blocking pass sit within 15% of their 5s default cap and fail CI on load alone"
from: dev/dev-uwg102-2026-08-21T14:30-uwg102.md
status: ready
blocked_by: []
branch: feat/debug-2e1174
---

## Goal

Find every test in the blocking (async) vitest pass whose runtime is close
enough to its cap that a loaded CI runner fails it, and give each a measured
explicit cap — before it costs someone else a red PR they did not cause.

## Repro

`test/loop-driver.test.ts > runLoop review-fix scenarios > abandoned items
WITH committed progress don't trip the systemic 3-stop (MED-4)`:

- **4,373 ms** on a quiet local machine
- **5,519 ms** on macos-latest CI (PR #143)
- against vitest's **5,000 ms** default

It has now failed CI twice — PR #139 and PR #143 — on timing alone, with
neither diff touching `driver.ts`. PR #139's failure had a real cause
underneath (`collectFindings` defaulted to the real exec, so doctor's
worktree probe shelled out to git inside every driver fixture; fixed in
`2294172`), which masked the fact that this test was ALSO marginal on its
own. PR #143's diff adds a new library file and tests and touches no driver
code at all, so this time there is nothing else to blame.

Fixed for that one test in the uwg102 PR with a measured 30s cap and a
comment carrying the numbers. **The class is open**: nothing has swept the
rest of the blocking pass.

## Why this is NOT `debug-5e1a77`'s anti-pattern

`debug-5e1a77` established: *do not fix by raising caps — a cap that cannot
fire is not enforcement at any value.* That is about the SYNC-blocking
tests, where `realExec` is `spawnSync` and a blocked event loop means
`@vitest/runner`'s `setTimeout` never fires, so the cap is **absent** rather
than generous.

This is the opposite shape. `loop-driver.test.ts` is in the async pass; its
caps fire correctly, and this one fired. The cap is simply set below the
work the test genuinely does (three items through real git fixtures with
spawned workers). Raising it to a measured value IS enforcement — leaving it
is a test that reports "timeout" when it means "the runner was busy".

The distinction matters because applying 5e1a77's rule here would freeze a
known-marginal cap in place on the grounds of a lesson about a different
mechanism.

## Acceptance criteria

- [ ] AC 1: Run `scripts/timeout-headroom.mjs` (debug-5c8b21 AC 3) across
      the **blocking** pass with `DEVX_HEADROOM_OUT` set, and record every
      test whose runtime exceeds ~50% of its effective cap.
- [ ] AC 2: For each, give an explicit cap derived from a MEASURED runtime
      with headroom for a loaded runner, and a comment carrying the numbers
      — not a round number chosen for looking generous.
- [ ] AC 3: Do NOT touch the sync-blocking files' caps; those are
      `debug-5e1a77`'s territory and a cap there is not enforcement at any
      value. Say which files were excluded and why.
- [ ] AC 4: If the sweep finds a test whose runtime is dominated by real
      sleeps or real spawns that could be seamed instead, prefer the seam
      over the cap — a 30s cap on work that should have been 300ms is a cap
      hiding a design problem.
- [ ] AC 5: Full suite green; note the total blocking-pass wall-clock before
      and after, so a future reader can tell whether the sweep made the gate
      slower.

## Technical notes

- `scripts/timeout-headroom.mjs` needs `includeTaskLocation`, which
  `vitest.shared.ts` turns on only when `DEVX_HEADROOM_OUT` is set — a
  deliberate cost gate. Read the header there first.
- The two CI observations above are the only data points; a third from a
  different runner would strengthen the picture but is not worth blocking on.

## Status log

- 2026-08-21T16:05 — filed from uwg102's Phase 7 (CI red on a diff that
  touches no driver code). One instance fixed in that PR; the class left
  open here rather than swept blind.

## Links

- Sibling: `debug/debug-5e1a77-…` (sync-blocking caps that cannot fire —
  explicitly a DIFFERENT mechanism)
- Sibling: `debug/debug-5c8b21-…` (the headroom sweep this AC 1 runs)
- Observed: PR #139, PR #143
