---
hash: 2e1174
type: debug
created: 2026-08-21T16:05:00-06:00
title: "Tests in the ASYNC blocking pass sit within 15% of their 5s default cap and fail CI on load alone"
from: dev/dev-uwg102-2026-08-21T14:30-uwg102.md
status: in-progress
owner: /devx-2026-09-21T1134-29407
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

- [x] AC 1: Run `scripts/timeout-headroom.mjs` (debug-5c8b21 AC 3) across
      the **blocking** pass with `DEVX_HEADROOM_OUT` set, and record every
      test whose runtime exceeds ~50% of its effective cap.
- [x] AC 2: For each, give an explicit cap derived from a MEASURED runtime
      with headroom for a loaded runner, and a comment carrying the numbers
      — not a round number chosen for looking generous.
- [x] AC 3: Do NOT touch the sync-blocking files' caps; those are
      `debug-5e1a77`'s territory and a cap there is not enforcement at any
      value. Say which files were excluded and why.
- [x] AC 4: If the sweep finds a test whose runtime is dominated by real
      sleeps or real spawns that could be seamed instead, prefer the seam
      over the cap — a 30s cap on work that should have been 300ms is a cap
      hiding a design problem.
- [~] AC 5: Full suite green; note the total blocking-pass wall-clock before
      and after, so a future reader can tell whether the sweep made the gate
      slower.

## Technical notes

- `scripts/timeout-headroom.mjs` needs `includeTaskLocation`, which
  `vitest.shared.ts` turns on only when `DEVX_HEADROOM_OUT` is set — a
  deliberate cost gate. Read the header there first.
- The two CI observations above are the only data points; a third from a
  different runner would strengthen the picture but is not worth blocking on.

## Resolution (2026-09-21)

### What the sweep found — and it was not mainly headroom

4,286 tests across both passes, on a quiet machine. Eight under 2×:

| row | measured / cap | verdict |
|---|---|---|
| `exec-async-seam:136`, `:114`, `loop-driver-timeout-enforcement:102` | — | deliberate specimens; unchanged |
| **`engine-layout-scaffold:326`** | **23,613 / 5,000 — PASSED** | **false green** |
| **`engine-layout-scaffold:400`** | **21,454 / 5,000 — PASSED** | **false green** |
| **`engine-layout-scaffold:366`** | **12,042 / 5,000 — PASSED** | **false green** |
| `loop-driver:1828` | 3,365 / 5,000 (1.5×) | real thin headroom → capped |
| `engine-layout-migrate:403` | 2,587 / 5,000 (1.9×) | latent false green → recorded |

The headline is the three false greens. The 2026-08-20 sweep recorded
**zero** accidental over-cap tests; dlr104 reintroduced three a month
later. That is `debug-5e1a77`'s fault back in the tree — which this spec's
AC 3 correctly says a cap cannot fix.

### A precision on the spec's terms

The spec says `loop-driver.test.ts` is in "the async pass" and tells AC 3
to leave "the sync-blocking files" alone. Both are in `SYNC_BLOCKING_TESTS`
— pass 2 *is* the sync-blocking set — so read literally, AC 1 and AC 3 name
the same 39 files. The intended split is **per test, not per file**: a test
whose body runs on the async seam has a cap that fires (loop-driver's
driver defaults to `realExecAsync`), while a test blocked in a sync call
does not, even inside the same file. This resolution classifies each flagged
row that way, and the signature is visible in the sweep data itself: **a
test that passes with a duration over its own cap cannot have a live cap.**

### Fixes

- **The three false greens — seam, not cap (AC 4).**
  `engine-layout-scaffold.test.ts`'s `runCli` spawned the CLI through tsx
  with `spawnSync`. It is now an awaited `spawn`, capturing both streams as
  before and keeping the 120s child kill. The file then has no sync call
  site, so `test/vitest-split.test.ts`'s partition pin **required** moving
  it to the parallel pass (it failed until the list was updated) — async
  spawners are the victims of the starvation, not its cause.
  *Negative control:* with a 50ms cap on `:326`, the old `spawnSync`
  version **passed** and the async version failed with "Test timed out in
  50ms".
  *Effect:* in the parallel pass, **under ~9× oversubscription** (load
  average 105, 28 vitest processes from concurrent sessions), the three ran
  **1.1s / 1.2s / 2.2s**; file max 2.2s against the 5s default — 2.3×
  headroom, cap enforceable, no explicit cap needed. In isolation they are
  0.6–0.9s. The 12–24s was blocking-pass amplification of a victim, not
  intrinsic cost.
- **`loop-driver:1828` — measured cap (AC 2).** 3,168 / 3,208 / 3,385ms
  isolated vs 3,365ms in-pass: intrinsic (four items through real git), not
  load. MED-4's measured macOS-CI slowdown (1.26×) puts it near 4.3s on CI —
  the margin MED-4 failed on twice. Explicit 30s cap (MED-4's family value,
  ~7× the CI estimate), derivation in place. It is the same row the
  2026-08-20 sweep listed at `:1812`, unaddressed since. Not seamed: the
  real git round-trip is what it exercises.
- **`engine-layout-migrate:403` — recorded, not converted (AC 3).** Same
  tsx `spawnSync` runCli plus a `spawnSync` git helper, so its cap cannot
  fire; but it is still *under* its cap. The line drawn: a live false green
  gets fixed, a latent one gets recorded with its fix named. Converting it
  touches every `git()` call in that file — a candidate follow-up.

`scripts/timeout-headroom.mjs` carries this sweep as its new LAST SWEEP
record, with every number above.

### AC 5 — wall-clock, honestly

- **Before** (quiet machine): parallel 26s, blocking 180s.
- **After:** no clean measurement was possible — the re-sweep ran at load
  average 105 with three other sessions' review suites contending, and the
  blocking pass took 391s for reasons unrelated to this change. Those
  numbers are not evidence either way.
- **Structural effect**, which does not depend on load: 12 tests and
  **64.5s of summed test time** moved out of the `maxForks: 2` blocking
  pass; in the parallel pass the same file sums to ~8s. The blocking pass
  should get shorter, not longer. Worth a clean re-measure when the machine
  is quiet; left as `[~]` until then rather than claimed.
- That contended run did produce one failure, in a file this change does not
  touch: `loop-driver-timeout-enforcement` "the event loop gets ticks while
  runLoop drives real git" timed out at 5s — its cap fired, which is the
  enforcement working. It passed on the quiet-machine sweep. Remote CI is
  the arbiter for it.

## Status log

- 2026-08-21T16:05 — filed from uwg102's Phase 7 (CI red on a diff that
  touches no driver code). One instance fixed in that PR; the class left
  open here rather than swept blind.
- 2026-09-21T11:34:41-06:00 — claimed by /devx in session /devx-2026-09-21T1134-29407

## Links

- Sibling: `debug/debug-5e1a77-…` (sync-blocking caps that cannot fire —
  explicitly a DIFFERENT mechanism)
- Sibling: `debug/debug-5c8b21-…` (the headroom sweep this AC 1 runs)
- Observed: PR #139, PR #143
- 2026-09-21T12:20 — fixed on `feat/debug-2e1174`. The sweep's headline was
  three live false greens (dlr104), fixed with the async seam and a
  partition move, negative-controlled; one thin-headroom row capped; one
  latent false green recorded. AC 5's after-number deferred — the machine
  was 9× oversubscribed.
