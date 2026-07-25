---
hash: dc7514
type: debug
created: 2026-07-25T08:55:00-06:00
title: Loop counts infra hangs as item failures and abandons into wrong state — hung workers wrongly abandoned hfi103, wedging the backlog
status: done
branch: feat/debug-dc7514
---

## Goal

An overnight loop whose worker sessions hang (environment failure: sleep,
network, spawn hang) never burns a healthy item's failure budget, and an
abandonment that preserved zero real work never leaves the repo in a state
that needs human forensics. Three fixes in the same failure class:
iteration classification, abandon-path state hygiene, and a sleep-aware
iteration ceiling.

## Evidence (the 2026-07-24 incident)

Run `loop-2026-07-24T21-19-34-321-15697` (events.jsonl + report.md in
`.devx-cache/loop/`):

- 3 iterations on hfi103, each killed by `WorkerTimeoutError`
  (`worker.ts` ceiling), each producing ~32 output tokens — the worker
  sessions hung at startup and did nothing. Classed `hard-error` ×3 →
  `consecutiveFailures: 3` → `abandon-item`.
- Iteration wall-clocks: 2h23m, 2h01m, 5h27m against a 60-min ceiling
  (`DEFAULT_ITERATION_TIMEOUT_MS`). `caffeinate -i` (sleep-inhibit.ts) does
  not block lid-close sleep; Node timers stretch across sleep, so the kill
  fired hours late and each "iteration" mostly measured a sleeping machine.
- Abandon left: spec `status: blocked` (semantically wrong — `[-]` means
  waiting on INTERVIEW/MANUAL/dependency), dead loop session as `owner:`,
  DEV.md status text still `in-progress` (mirror drift vs the `[-]`
  checkbox), and a preserved worktree containing only 3
  `chore(loop): record iteration` bookkeeping commits.
- Downstream: hfi105 + hfiret are blocked-by hfi103, so the next run
  (`loop-2026-07-25T14-40-28-893-3043`) found "no eligible backlog items"
  and exited in 4ms. One hung item wedged the whole backlog until a human
  reconstructed the facts and reset state by hand (main commit `5f83f3e`).

## Acceptance criteria

- [x] Repro exists: driver-level test where a worker dies by
      `WorkerTimeoutError` with near-zero output tokens ×3 → current code
      abandons the item into `blocked` + preserved bookkeeping-only
      worktree (the incident shape), failing under the new contract.
- [x] Root cause documented in this spec's status log (hypothesis → check
      → result, per debug discipline).
- [x] New iteration class `infra-error`: report-less worker death
      (timeout kill or spawn failure) with output tokens below a floor
      (constant, ~1k) is not attributable to the item — it does NOT
      increment the item's `consecutiveFailures`. N consecutive
      infra-errors (constant, default 3) abort the RUN
      (`abortReason: environment failure`), leaving the item claimed-state
      rolled back to ready — abandon-the-run, not abandon-the-item.
- [x] Abandon hygiene (real item failures): if the preserved worktree
      holds no commits beyond loop bookkeeping
      (`chore(loop): record iteration`), the abandon path discards the
      worktree + branch and flips the spec back to `ready` (owner cleared,
      failure recorded in the status log) instead of `blocked`. When real
      work IS preserved, the existing `blocked` flip stands but the DEV.md
      entry's `Status:` prose is reconciled along with the checkbox (no
      more `[-]` + "Status: in-progress" drift).
- [x] Sleep-aware ceiling: iteration timing detects suspend gaps
      (monotonic-vs-wall drift via a heartbeat interval); slept time does
      not count against the 60-min ceiling, and a post-wake kill is
      classed `infra-error`, not `hard-error`. Events record the gap
      (`iteration:sleep-gap` or field on `iteration:end`).
- [x] Morning report's per-item lines distinguish `infra-error` from item
      failures ("environment failure — item not at fault, left ready").
- [x] Full suite green (`npm test`, typecheck included).

## Technical notes

- Touch points: `src/lib/loop/worker.ts` (WorkerTimeoutError, ceiling),
  `src/lib/loop/iteration.ts` (`classifyIteration`), `src/lib/loop/driver.ts`
  (~L1194 timeout handling, ~L987 `abandonItem`, ladder wiring),
  `src/lib/loop/ladder.ts`, `src/lib/loop/report.ts`.
- The systemic-abort ladder (3 consecutive abandoned items ⇒ stop loop,
  `config.ts`) is the run-level analogue — infra-error abort should reuse
  its shape, not duplicate it.
- Do NOT try to make `caffeinate` block lid-close sleep (`-s` is
  AC-power-only and user-hostile); detect-and-excuse is the right shape.
  A MANUAL.md note about keeping the lid open / power attached for
  overnight runs is fine as a complement.
- Wrap-don't-duplicate: the "bookkeeping-only worktree" predicate belongs
  next to the code that writes those commits (git-tx.ts / driver), not
  re-derived by consumers; `devx doctor` (dev-db36af) reuses it for
  after-the-fact healing of states shipped before this fix.

## Status log

- 2026-07-25T08:55 — filed from the loop-2026-07-24 post-mortem (hfi103
  wrongful abandonment; state hand-reset in main commit 5f83f3e). Part of
  the skill/loop fixups track.
- 2026-07-25T09:02:37-06:00 — claimed by /devx in session /devx-2026-07-25T0902-6669
- 2026-07-25T09:10 — phase 2: spec ACs direct (v2 native); 7 ACs; workstream=none; red-artifacts=none (RED test authored fresh per debug discipline)
- 2026-07-25T09:15 — root cause 1/3: H: worker rejections have no infra distinction → C: ladder.ts classifyIteration (input.error branch) + driver.ts catch at the worker await — WorkerTimeoutError is folded into `error` like any throw → R: CONFIRMED — every report-less worker death classes `hard-error`; 3 of them hit consecutiveFailures ≥ 3 → abandon-item, charging the item for an environment failure.
- 2026-07-25T09:15 — root cause 2/3: H: the 60-min ceiling stretched across machine sleep → C: worker.ts uses a single setTimeout(iterationTimeoutMs); Node timers pause during suspend; run loop-2026-07-24T21-19 events show iteration wall-clocks 2h23m/2h01m/5h27m vs the 60-min DEFAULT_ITERATION_TIMEOUT_MS → R: CONFIRMED — the kill fired hours late post-wake and each "iteration" mostly measured a sleeping machine; no wall-vs-timer cross-check exists.
- 2026-07-25T09:15 — root cause 3/3: H: abandon path writes wrong/drifting state → C: driver.ts abandonItem flips spec `blocked` + preserves the worktree unconditionally; flipDevMdCheckbox (manage/loop.ts) flips only the checkbox, never the row's `Status:` prose; nothing clears `owner:` → R: CONFIRMED — produces `[-]` + "Status: in-progress" drift, dead-session owner, and a preserved worktree holding only `chore(loop): record iteration` bookkeeping commits (the exact 5f83f3e hand-reset shape).
- 2026-07-25T09:35 — phase 3: RED repro committed first (3 driver-level tests, all failing on the incident shapes), then the fix across 6 surfaces: ladder.ts (`infra-error` class + `consecutiveInfraErrors` + `abort-run-environment` decision; floors INFRA_OUTPUT_TOKEN_FLOOR=1000, MAX_CONSECUTIVE_INFRA_ERRORS=3), worker.ts (awake-time ceiling via heartbeat probe; WorkerTimeoutError + WorkerRunResult carry sleepGapMs), git-tx.ts (`isBookkeepingOnlyWorktree` predicate, exported for devx doctor/db36af reuse), spec-io.ts (`clearSpecOwner` + `setBacklogRowState` — checkbox + prose flip together), driver.ts (workerDied tracking → infra classify; abandon hygiene fork; `releaseItemToReady` on environment abort), report.ts (`released` outcome + infra iteration counts + next-steps routing). v2/04 §3–4 tables updated; MANUAL.md MV2.2 lid-open note filed.
- 2026-07-25T10:05 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor); 24 raw findings → 2 HIGH + 8 MED unique actionable, ALL fixed in-place — most load-bearing: (1) EC-HIGH-1 the token floor is blind in production (`claude -p` stdout is near-empty for ANY killed session) → infra now also requires a CLEAN tree (a dead worker that left file changes demonstrably ran → hard-error, charged); (2) EC-HIGH-2/3 release-to-ready with a surviving worktree/branch wedges the next claim → real-work releases now preserve the claim as in-progress-at-exit, and branch-delete failures WARN in the report. Also fixed: workerDied narrowed to the primary call (retry deaths + post-processing throws = hard-error), infra iterations exempted from per-item iteration/token budgets, failure learnings folded into the main-spec entry before discard, bookkeeping commit subject shared as one git-tx constant, backlog-row misses surfaced, ownership-lost release label honesty, probe re-kill guard, empty-subject commits count as real work. Accepted-with-rationale: sleep-gap→infra excuse (AC5 mandates it), per-item infra streak (mitigated by budget exemption), exitInProgress during infra backoff (designed stop-mid-item shape). Re-review of fixed hunks clean; suite re-run green (2287 tests).
- 2026-07-25T10:15 — phase 7: PR opened — https://github.com/LeoTheMighty/devx/pull/84 (body via devx pr-body, no unresolved placeholders)
- 2026-07-25T10:45 — phase 5/7/8: local gates green (npm test: 2287 tests incl. typecheck); remote devx-ci green (run 30164974405); tour published (devx-tours/tours/dc7514); merge-gate {"merge":true} → merged via PR #84 (squash → 9c671d8)
