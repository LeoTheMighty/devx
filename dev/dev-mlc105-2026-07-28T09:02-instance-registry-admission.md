---
hash: mlc105
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Loop instance registry + capacity admission + aggregation"
status: ready
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: [mlc104]
branch: feat/dev-mlc105
owner: null
---
## Goal

Loops stop taking `manager.lock`; each run registers
`loop/instances/{run-id}.json` (heartbeats) + a fail-fast per-run lock;
admission honors `capacity.max_concurrent`; `devx next`/`devx status`
aggregate live instances; scratch files namespace per session (race
R6/R11 dead; goal G-2 machinery). Plan phase 5 of workstream
multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: `src/lib/loop/instances.ts` — register/heartbeat/finalize/
      listLiveInstances/admitLoop; JSON v1 instance schema; stopped files
      reaped after 24h at next run start; scratch reaped after 7 days.
- [ ] AC 2: driver startup swaps manager.lock → admission check + instance
      lock; refusal past `capacity.max_concurrent` exits != 0 naming the
      knob, the live count, and the live run-ids. `devx manage` keeps
      `manager.lock` (daemon-only).
- [ ] AC 3: new code stops writing `loop/state.json`; `gather.ts` reads
      `loop/instances/` first, legacy file as fallback; `devx next` row 1
      payload gains `loops: [{run_id, scope, current_item, iteration}]`;
      `devx status` renders the same section.
- [ ] AC 4: skill-body scratch paths move to `.devx-cache/scratch/{session}/`
      (`skills/devx.md` + `.claude/commands/devx.md`, byte-identical
      mirror pair).
- [ ] AC 5: eval E-5_instance-registry.ts flips GREEN (and E-1's
      instances clause); first-real-run: `devx next` observed listing a
      live instance during a real loop smoke, recorded in the status log;
      `npm test` green.

## Technical notes

Design §Architecture 5. Freshness reuses `isFresh` windows
(`gather.ts:752`); crash-orphan recovery mirrors `recoverStaleLoopState`
(`state.ts:140`).

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 5).

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
