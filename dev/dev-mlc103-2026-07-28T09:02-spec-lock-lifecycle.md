---
hash: mlc103
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Spec-lock lifecycle: classify, reap, guarded release"
status: ready
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: [mlc102]
branch: feat/dev-mlc103
owner: null
---
## Goal

Spec locks carry owner-liveness metadata (JSON v1), reuse the mgr106
classifier (extracted to a shared module), reap dead owners at claim time,
and release only under an ownership re-check; pick-time masking keeps
live-held items out of `claimSpec` (races R7/R8/R12 dead, goal G-3). Plan
phase 3 of workstream multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: `classifyExistingLock` extracted to `src/lib/locks/classify.ts`;
      manager lock re-imports it; its existing tests stay green (incl. the
      2s PID-recycling grace).
- [ ] AC 2: `src/lib/devx/spec-lock.ts` — JSON v1 body `{schema, pid,
      pid_started_at, session, claimed_at}`; acquire = O_EXCL, on EEXIST
      classify → dead/recycled ⇒ reap+retry once (under the backlog lock);
      legacy 3-line bodies classify via their `pid=` line.
- [ ] AC 3: release re-reads the body and unlinks only on session match,
      inside the backlog lock; `ownsClaim` call sites migrate.
- [ ] AC 4: `pickNextItem` masks rows whose spec lock classifies live-held;
      live-PID locks older than 2h raise a WARN (`devx next` drift + run
      event) — never auto-reaped. `classifySpecLock` exported for
      `devx doctor` (db36af).
- [ ] AC 5: eval `_devx/workstreams/multi-loop-concurrency/evals/E-3_spec-lock-lifecycle.ts`
      flips GREEN; `test/spec-lock.test.ts` added; `npm test` green.

## Technical notes

Design §Architecture 4 + Resolved design questions (TTL demoted to
WARN+doctor — do NOT auto-reap live PIDs).

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 3).

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
