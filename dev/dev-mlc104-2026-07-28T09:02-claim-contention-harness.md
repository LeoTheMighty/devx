---
hash: mlc104
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Claim contention + overlap harness"
status: in-progress
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

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
