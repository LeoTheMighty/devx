---
hash: mlc104
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Claim contention + overlap harness"
status: done
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: [mlc103]
branch: feat/dev-mlc104
owner: /devx-2026-07-28T1322-68036
---
## Goal

Lost claim-push races rebase-retry then classify as contention (never
failure budget); finalize's ff-pull gets a retry; the E-1 overlap harness
proves overlap-safety end-to-end (races R2/R5 dead; goal G-1). Plan phase
4 of workstream multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: inside the locked claim section, a rejected push triggers
      `git pull --rebase` + re-push, <=2 retries; still-lost raises
      `ClaimContendedError` (new class, distinct from ClaimError).
- [ ] AC 2: the driver maps it to `item:claim-contended`: mask the hash,
      pick next, `consecutiveClaimFailures` unchanged (reserved for
      genuinely broken claims).
- [ ] AC 3: `finalizeMerged`'s `pull --ff-only` gets one fetch+retry under
      the backlog lock.
- [ ] AC 4: `test/loop-concurrency.test.ts` — two in-process `runLoop`
      calls via `RunLoopOpts` seams over one tmpdir fixture, >=3 seeded
      interleavings + serial baseline: merged union == baseline, final
      DEV.md byte-equal, 0 contention aborts.
- [ ] AC 5: evals E-1_overlap-harness.ts + E-4_claim-contention.ts flip
      GREEN (E-1's instance-registry clause lands at mlc105 — record the
      partial flip explicitly in the status log); `npm test` green.

## Technical notes

Design §Architecture 3 + §Test architecture. E-1's instances clause going
green requires mlc105; the harness and contention clauses go green here.

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 4).
- 2026-07-28T13:22:39-06:00 — claimed by /devx in session /devx-2026-07-28T1322-68036

- 2026-07-28 — phase 2: spec ACs direct (v2 native); 5 ACs;
  workstream=multi-loop-concurrency;
  red-artifacts=E-1_overlap-harness.ts,E-4_claim-contention.ts. RED
  re-confirmed honest: E-4 fails at claim stage 'git-push' with no retry
  (the missing feature); E-1 fails on clauses (a) singleton refusal +
  (b) no instances dir (both mlc105 territory) — clause (c)
  contention-not-systemic is this phase's target.

- 2026-07-28 — phase 3: implemented. claim.ts: isRejectedPush classifier +
  bounded rebase-retry (CLAIM_PUSH_MAX_RETRIES=2) inside the locked claim
  section + pull-aware rollback (restore from HEAD after a landed rebase,
  never the stale pre-peer capture) + ClaimContendedError (distinct class);
  devx-helper: claim-contended -> exit 1 JSON; driver: item:claim-contended
  event + outcome (isAttempted excludes it; consecutiveClaimFailures
  untouched) + finalizeMerged ff-pull fetch+retry; report: new outcome
  label/count. Tests: test/claim-contention.test.ts (7) +
  test/loop-concurrency.test.ts (6 — dual-runLoop harness, seeds 11/22/33 +
  serial baseline, byte-equal DEV.md, disjoint merge union).

- 2026-07-28 — phase 4: 3-agent parallel adversarial review (Blind Hunter +
  Edge Case Hunter + Acceptance Auditor); ~20 unique actionable findings
  (2 HIGH, 8 MED, rest LOW); ALL fixed in-place — most load-bearing:
  isRejectedPush over-matched git's generic "failed to push some refs"
  trailer (hook/policy refusals would have routed around the systemic
  failure budget and walked the whole backlog as fake contention; BH-1,
  caught independently by the pre-existing WIP-safety test) — narrowed to
  the race-only markers, dropped ambiguous "cannot lock ref"; also fixed:
  final-failure classification (sticky raceObserved laundered non-race
  terminal failures into contended; BH-2), honest retriesUsed count (BH-3),
  index-independent `checkout HEAD --` rollback restore + WARN (BH-4/EC-4),
  LC_ALL=C pinning on claim git calls (localized git broke race
  classification; EC-1), rebase-abort WARN (EC-6), morning-report
  contended count + next-steps rows (EC-9), skill-body exit-1 doc for the
  claim-contended JSON shape in both mirror copies (BH-7/EC-10), + 2 new
  regression tests (conflicted-rebase abort path EC-15; non-race re-push
  failure BH-2). Residuals filed/recorded: debug-a7c3f9 (backlog-lock
  timeout vs systemic budget, EC-8); E-1 clause (c) is vacuous at 2
  items/no-origin (AA-3) and E-4 under-pins the zero-counters bullet
  (AA-5) — both covered by the permanent vitest suite, eval strengthening
  deferred to mlc105 which reworks E-1 anyway; dirty-WIP checkouts make
  pull --rebase refuse so a race there degrades to contended-with-0-retries
  (WIP is sacrosanct, never autostash; BH-6/EC-2, documented in code).
  Re-review of all fixed hunks clean.
- 2026-07-28 — phase 4/AC 5: eval verdicts — E-4 GREEN (raced claim
  rebases, retries, lands at origin tip). E-1 PARTIAL by design: clause
  (c) contention-never-systemic no longer fails (mlc104's scope); clauses
  (a) singleton-refusal and (b) instances-dir remain RED — BOTH are
  mlc105's instance-registry feature (FR-5/T5.1/T5.2 per the eval's own
  clause labels), so the standalone eval still exits 1 until mlc105
  lands. The eval was NOT re-authored to pass (Phase 2 discipline); it
  stays the RED artifact for mlc105.

- 2026-07-28 — phase 5: local CI green — npm test (vitest + typecheck)
  2442/2442 passed in the worktree; lint is the cli301 stub; coverage not
  wired (YOLO informational). Harness trimmed 4->3 items + 600s ceiling
  after the 360s ceiling starved under full-suite worker contention.

- 2026-07-28 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/96
  (body via devx pr-body, no unresolved placeholders). Tour published:
  https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/mlc104/tour.html

- 2026-07-28 — merged via PR #96 (squash -> 3c9f2c0)

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
