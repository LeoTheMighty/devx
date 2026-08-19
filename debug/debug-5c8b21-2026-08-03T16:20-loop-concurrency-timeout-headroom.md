---
hash: 5c8b21
type: debug
created: 2026-08-03T16:20:00-06:00
title: "loop-concurrency G-1 test sits ~1.3x under the 600s cap; parallel load reds it"
from: sgr104
status: done
owner: /devx-loop-2026-08-19T19-39-20-483-20983
---

## Goal

`test/loop-concurrency.test.ts`'s G-1 harness case should not be one slow
machine away from reddening the gate. Today it passes or fails on load, not on
correctness.

## Repro

Full suite, macOS, on a machine already warm from ~1h of sustained test runs:

```
❯ test/loop-concurrency.test.ts (6 tests | 1 failed) 761746ms
 FAIL  … > merged union == serial baseline, DEV.md byte-equal, 0 contention
       aborts — across ≥3 seeds
Error: Test timed out in 600000ms.
```

The same file, same commit, run alone on an idle machine:

```
✓ test/loop-concurrency.test.ts (6 tests) 151030ms
  ✓ … merged union == serial baseline … 122478ms
```

**122s alone vs >600s under parallel suite load — a ~5x amplification.**

## Root cause (evidence, not hypothesis)

Not a code regression. Measured across two full-suite runs on the same
machine, ~1h apart:

| file | gate #1 | gate #2 | ratio |
|---|---|---|---|
| `graph-regen` | 323s | 556s | 1.72x |
| `claim-contention` | 349s | 597s | 1.71x |
| `loop-concurrency` | 467s | 762s (timeout) | 1.63x |
| `loop-driver` | 1029s | 1759s | 1.71x |

`claim-contention` is the control — byte-identical code across both runs — and
it slowed by the same 1.71x as everything else. A uniform factor across
changed and unchanged files is machine load / thermal throttling, not a diff.

The real defect is **headroom**: at 467s under load against a 600s per-test
cap, the G-1 case had ~1.3x margin. Any slower run reds the gate. Same class
as `debug-c81f04` (backlog-mutate R3) and `debug-74632d` (loop-driver
teardown ENOTEMPTY) — concurrency tests whose pass/fail depends on timing.

## Acceptance criteria

- [ ] AC 1: the G-1 case no longer depends on machine speed for its verdict —
      either a per-test timeout sized to its measured worst case (with the
      measurement recorded), fewer seeds under a `CI`/`DEVX_SLOW` env knob, or
      the fixture's git work reduced.
- [ ] AC 2: whatever bound is chosen is justified in a comment with the
      isolated-vs-loaded numbers above, so the next person doesn't re-derive
      them.
- [ ] AC 3: a suite-wide sweep for other tests within 2x of their timeout —
      this is the third instance of the class, so the audit is the point, not
      just this one file.
- [ ] AC 4: no reduction in what G-1 actually asserts (merged union == serial
      baseline, DEV.md byte-equal, 0 contention aborts, ≥3 seeds).

## Technical notes

- sgr104 adds ~0.2s per claim (a full board render inside the backlog lock;
  measured at 0.26s for a 181-spec board including node startup). That is NOT
  the cause of the timeout, but it does consume headroom in a test that makes
  many claims — one more reason to fix the margin rather than track it.
- Do NOT "fix" this by raising the global `testTimeout`: that hides the same
  fragility everywhere else. The bound should be per-test and reasoned.

## Status log

- 2026-08-03T16:20 — filed from sgr104's Phase 5. Gate #2 red on this test by
  timeout; isolated re-run green at 122s (4.9x headroom), and a control file
  with unchanged code slowed by the same 1.71x, so the failure is
  environmental and the headroom is the real bug.
- 2026-08-19T15:30:31-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-19T22:11:27.731Z — loop iteration 1: Split the G-1 harness into a per-seed case under a measured 300s cap and built the suite-wide timeout-headroom sweep, which found 16 tests reporting false green while running past their own caps.
  - Change: test/loop-concurrency.test.ts: G-1 is now one `it` per seed plus a `beforeAll` baseline under a named G1_CASE_TIMEOUT_MS=300_000 — per-case cost dropped 10.4s to ~2.6s (115x headroom), with the cap both tightened from 600s and justified in-comment against the isolated/loaded/control-file measurements. Assertion set unchanged: 3 seeds, merged-union == baseline, DEV.md byte-equal, 0 contention aborts.
  - Change: runBaseline now owns its fixture lifecycle (try/finally rmSync, not track()), because the afterEach sweeper would delete a beforeAll-created fixture out from under the seed cases.
  - Change: scripts/timeout-headroom.mjs: new dual-mode vitest reporter + CLI analyzer that ranks every test by cap/duration, resolving source-declared caps (numeric, options-object, and named constants) via the TypeScript compiler API and joining on (file, line). Header records the full sweep results and the stale-join and hook-scope caveats.
  - Change: vitest.shared.ts: includeTaskLocation turned on only when DEVX_HEADROOM_OUT is set, since vitest has no CLI flag for it and it costs a stack capture per test.
  - Change: Filed debug-5e1a77 (spec + DEBUG.md row) for the 16 false-green tests the sweep uncovered, whose nominal owner debug-ecdcda closed on the symptom without building the async exec seam.
  - Learning: The spec's premise had already decayed: the G-1 case runs 10.4s isolated on this machine at this commit, not the 122s recorded 2026-08-03. debug-7c1e93's maxForks:2 partition plus driver changes removed most of the cost, so the headroom crisis was already largely mitigated before this spec was claimed — the remaining defect was structural packaging, not raw duration.
  - Learning: Vitest 2.x makes per-test timeouts invisible to reporters: @vitest/runner's `withTimeout` closes over the cap when wrapping the handler and never writes it to the task object. A reporter-only headroom tool silently reports the 5,000ms default for a test declared at 300,000ms — caps must be parsed from source and joined on task.location.
  - Learning: The suite's real timing defect is not thin margins but absent enforcement: 16 tests exceed their own cap and still report PASSED, one by 44x. Every one is in the sync-blocking set, and no test in the 2,540-test parallel pass is under 2x — so the audit's conclusion is that the partition fixed the async majority and the blocking set has no enforcement at all until the exec seam goes async.
  - Learning: The (file, line) join makes the sweep artifact tree-specific: editing a test file between collection and analysis shifts every test below the edit onto the wrong cap, and the failure is quiet — a 300,000ms case gets scored against the 5,000ms default and reads as a false 'thin headroom' hit. Hit this live and documented it.
- 2026-08-19T22:14:16.105Z — phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103
- 2026-08-19T22:14:16.105Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/130
