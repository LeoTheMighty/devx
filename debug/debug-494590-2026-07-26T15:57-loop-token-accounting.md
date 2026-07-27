---
hash: "494590"
type: debug
created: 2026-07-26T15:57:00-06:00
title: Loop token accounting implausibly low — budget rails cannot trip
from: dev/dev-hfiret-2026-07-24T10:43-retro-harness-fold-in.md
status: done
owner: /devx-2026-07-26T2011-86138
branch: feat/debug-494590
---

## Goal

Loop morning reports (and the budget enforcement they feed) should reflect
actual token consumption. Today they under-count by orders of magnitude, so
the `2,000,000 tokens/item` and `10,000,000 total` budgets can never trip —
unattended safety rails that don't measure aren't rails.

## Acceptance criteria

- [x] Repro exists: a test (or captured run fixture) demonstrating the
      under-count — e.g. an iteration whose worker session consumed ≫ the
      recorded per-item figure.
- [x] Root cause documented with evidence in the status log (hypothesis:
      the accounting reads only the worker's final structured report /
      spawn-level summary, not the session's cumulative usage).
- [x] Fix: per-iteration token figures reflect the worker session's actual
      cumulative usage (whatever signal the `claude` CLI exposes — session
      JSON, stream summary, or logs), with a regression test.
- [x] Budget enforcement re-verified against the corrected figures (a run
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
- 2026-07-26 — claimed by /devx session; worktree .worktrees/debug-494590 on feat/debug-494590.
- 2026-07-26 — hypothesis: meter reads only the worker's final emission → check: `src/lib/loop/worker.ts` spawns `claude -p <prompt>` in plain-text mode (final response ONLY on stdout) and `estimateTokens` is chars/4 over prompt + that stdout → result: CONFIRMED — all intermediate agentic turns (tool calls, file reads, the bulk of real usage) are invisible to the meter; a hung session's ~32-token final emission is exactly the loop-2026-07-24T21-19 figure.
- 2026-07-26 — evidence (empirical probe, CLI 2.1.220): `claude -p "Reply with exactly the word: ok" --output-format stream-json --verbose` → result event usage = 10 in + 6,609 cache-create + 17,536 cache-read + 42 out (~24k real input tokens) vs chars/4 ≈ 9 in / 1 out — three orders of magnitude under. Also confirmed: assistant stream events repeat one call's usage across content-block events (same message id) — naive summing double-counts; the result event carries the authoritative cumulative usage. This is the O-6 "harness usage events" upgrade path.
- 2026-07-26 — repro/RED: 8 new tests in test/loop-worker.test.ts (`authoritative token accounting (debug-494590)`) failed against the old chars/4 seam, then went green with the fix (stream-json spawn + result-event usage + per-message-id kill-path floor + chars/4 last-resort fallback).
- 2026-07-26 — budget counter decision: tokensTotal = input + output + cacheCreation (new tokens processed); cache READS are accounted + rendered in the morning report but excluded from the budget counter — counting them (a trivial one-turn probe reads ~17k) would make the counter turn-count-dominated and trip the 2M/item default mid-first-iteration on every honest item. Filed INTERVIEW Q#12 for the budget-unit question (token- vs cost-based rails).
- 2026-07-26 — phase 2: spec ACs direct (v2 native); 4 ACs; workstream=none; red-artifacts=test/loop-worker.test.ts §authoritative token accounting (8 tests, watched RED then GREEN).
- 2026-07-26 — phase 3: fix implemented — worker.ts stream-json spawn + line parser (assistant text reconstruction, per-message-id usage dedupe, result-event authoritative usage, error-result text passthrough for permanent-error scan, grace-kill arms on result event); driver.ts extended TokenTotals + budget counter; report.ts cache breakdown rendering; AC-4 driver test (real-scale figures abandon at 2M/item); docs (CONFIG.md, v2/07 O-6 upgrade note).
- 2026-07-26 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor); 12 unique findings (3 MED, 9 LOW; 2 MED-class overlapped across agents); ALL fixed in-place — most load-bearing: stream mode disarms the trailing-report grace-kill predicate (an echoed schema-valid fixture mid-text + a ≥15s tool-only phase would have SIGKILLed an honest session AND fed the echoed report to the driver as real, incl. a fake acs_met=true); also usageFrom now rejects degenerate usage objects (empty/renamed keys would have become unflagged "authoritative zero", resurrecting the never-trips class), probe/grace race guard, id-less dedupe by value, utf8 stream decoding, stale ladder.ts EC-HIGH-1 comment rewritten, v2/04 §3/§5 doc sync, total-budget cacheCreation test added; 2 accepted-with-rationale (>8MB single-event usage loss = bounded-by-design, commented; no e2e kill-path-to-budget test = both seams pinned individually per auditor's own disposition); re-review clean (23/23 worker tests, typecheck green).
- 2026-07-26T20:11:57-06:00 — claimed by /devx in session /devx-2026-07-26T2011-86138
- 2026-07-26 — phase 5: local CI green — npm test (typecheck + 120 files / 2,329 tests, exit 0) after fixing one pre-existing load-flake forward (sleep-gap test ceiling 2s→5s, the documented MED-8 flake class).
- 2026-07-26 — phase 7: PR https://github.com/LeoTheMighty/devx/pull/88 (body via devx pr-body, no unresolved placeholders); tour built + published (7 stops, 5 decisions, trail A grep-verified) https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/494590/tour.html
- 2026-07-26 — phase 7: remote CI red on both runners — sleep-gap test observed sleepGapMs 0 (fast runners exited the child before the first 1250ms probe; my 2s→5s ceiling bump had made the test load-dependent both ways). Fixed forward 585c844: child write delay 3s > probeMs 2s structurally; deterministic now. CI re-running.
- 2026-07-26 — merged via PR #88 (squash → 6d1decc); worktree removed, branch deleted; spec done.
