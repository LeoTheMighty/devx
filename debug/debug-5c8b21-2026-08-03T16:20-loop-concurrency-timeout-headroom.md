---
hash: 5c8b21
type: debug
created: 2026-08-03T16:20:00-06:00
title: "loop-concurrency G-1 test sits ~1.3x under the 600s cap; parallel load reds it"
from: sgr104
status: ready
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
