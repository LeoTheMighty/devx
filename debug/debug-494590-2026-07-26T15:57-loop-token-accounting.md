---
hash: "494590"
type: debug
created: 2026-07-26T15:57:00-06:00
title: Loop token accounting implausibly low — budget rails cannot trip
from: dev/dev-hfiret-2026-07-24T10:43-retro-harness-fold-in.md
status: ready
owner: null
branch: feat/debug-494590
---

## Goal

Loop morning reports (and the budget enforcement they feed) should reflect
actual token consumption. Today they under-count by orders of magnitude, so
the `2,000,000 tokens/item` and `10,000,000 total` budgets can never trip —
unattended safety rails that don't measure aren't rails.

## Acceptance criteria

- [ ] Repro exists: a test (or captured run fixture) demonstrating the
      under-count — e.g. an iteration whose worker session consumed ≫ the
      recorded per-item figure.
- [ ] Root cause documented with evidence in the status log (hypothesis:
      the accounting reads only the worker's final structured report /
      spawn-level summary, not the session's cumulative usage).
- [ ] Fix: per-iteration token figures reflect the worker session's actual
      cumulative usage (whatever signal the `claude` CLI exposes — session
      JSON, stream summary, or logs), with a regression test.
- [ ] Budget enforcement re-verified against the corrected figures (a run
      that would exceed budget on real numbers actually stops).

## Technical notes

- Evidence (hfiret retro, `LEARN.md § epic-harness-fold-in` E9):
  `loop-2026-07-24T16-46` self-reported ~11,461 in / ~9,347 out across 13
  iterations producing +2,861 diff lines (PRs #80 +743, #81 +496, hfi102
  +1,622 loop-implemented); a single real worker iteration exceeds that alone.
  `loop-2026-07-24T21-19` reported 2,003 in / 32 out — the 32-out figure is
  consistent with hung sessions, suggesting the meter reads only some final
  emission, not cumulative usage.
- Home: `src/lib/loop/` (iteration record / report assembly).

## Status log

- 2026-07-26T15:57:00-06:00 — filed by hfiret retro (E9, med/code).
