---
hash: 1c2679
type: debug
created: 2026-09-25T10:15:00-06:00
title: "A throw in the loop's summary construction skips finalizeInstance, leaving a 'running' record and a held lock"
from: plan/plan-47b842-2026-09-25T09:37-loop-and-mobile-scope-review.md
status: ready
owner: null
branch: null
---

## Goal

`devx loop` always marks its instance record stopped and drops its per-run
lock, on every exit path.

Today one narrow path skips both. `finalizeInstance`
(`src/lib/loop/driver.ts:1342`) is straight-line after the item loop, not in
a `finally`. Its own comment says why the call matters: it marks the record
stopped/aborted AND drops the lock in one call, "so the two can never
diverge (a released lock with a still-'running' record would keep eating a
capacity slot for a whole freshness window)". A throw that reaches it skips
both halves, and recovery depends on the next loop start reaping the stale
instance.

**The exposure is narrow, and stating it precisely matters** — an earlier
report described the whole cleanup path as unprotected, which is not the
case:

- the item loop is wrapped in `try/catch` (`:1024`–`:1279`) that converts
  *any* throw into `abortReason`, with `finally { clearInterval(hbInterval) }`;
- `writeMorningReport` has its own `try`/`catch` (`:1326`).

So only the ~60 lines between them — `const endedAt = now()` and the
`RunSummary` construction, including `crossScopeBlocks`'s filter over
`crossScopeByHash` — can throw past `finalizeInstance`.

Filed rather than fixed during the loop-freeze decision (`plan-47b842`,
D-15): frozen means the code stays correct, and a defect measured during the
review should not rot inside its prose.

## Acceptance criteria

- [ ] AC 1: A repro — an injected throw in summary construction leaves the
      instance record `running` and the per-run lock held, before the fix.
- [ ] AC 2: `finalizeInstance` runs on every exit path, including that throw.
      A `finally` is the obvious shape; any shape that keeps the record and
      the lock in lockstep qualifies.
- [ ] AC 3: The morning report still writes whenever it can — the existing
      "report ALWAYS" intent at `:1285` is not weakened by the fix. If both
      the report and finalize must run, order them so a report failure cannot
      skip finalize.
- [ ] AC 4: `abortReason` still reflects the original error, not a
      cleanup-time one; a throw during cleanup must not mask why the run
      ended.
- [ ] AC 5: Next-start reaping still works and is still tested — the fix
      reduces reliance on it, it does not replace it.

## Technical notes

- Loop-frozen (D-15) means bug fixes are in scope and features are not. This
  is a bug fix.
- Do not widen this into a rewrite of the finalize block. The whole change is
  where the call sits relative to a `try`.

## Status log

- 2026-09-25T10:15-06:00 — filed from `plan-47b842`'s measurement pass.
  Verified by reading `driver.ts` at `a794c62`, including the enclosing
  `try/catch` that bounds the exposure — the narrowing is measured, not
  assumed.
