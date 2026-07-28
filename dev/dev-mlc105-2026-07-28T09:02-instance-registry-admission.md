---
hash: mlc105
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Loop instance registry + capacity admission + aggregation"
status: in-progress
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: [mlc104]
branch: feat/dev-mlc105
owner: /devx-2026-07-28T1507-6737
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
- 2026-07-28T15:07:06-06:00 — claimed by /devx in session /devx-2026-07-28T1507-6737
- 2026-07-28T15:12 — phase 2: spec ACs direct (v2 native); 5 ACs;
  workstream=multi-loop-concurrency (plan phase 5); red-artifacts=E-5
  (2 clauses: no loops[] in devx next JSON, instances.ts missing) + E-1
  (instances clause + singleton-refusal clause). Both re-run NOW and
  confirmed RED for the STATED reason (feature absent, not harness
  breakage — E-5's runCli produced real CLI output and E-1's two loop
  processes really spawned).
- 2026-07-28T16:20 — phase 3: implemented T5.1–T5.4. New
  `src/lib/loop/instances.ts` (register/heartbeat/finalize/list/
  classify/admit + 24h stopped-instance and 7-day scratch reapers; JSON v1
  schema; liveness = fresh heartbeat AND live non-recycled PID, reusing the
  mgr106 classifier primitives rather than re-implementing them). Driver
  startup swaps `manager.lock` for admission + a per-run
  `locks/loop-<run-id>.lock`, with admit→register run as ONE critical
  section under `withBacklogLock` so two simultaneous startups cannot both
  observe N−1 and both admit. `capacity.max_concurrent` gains its first
  consumer (`maxConcurrentFrom`, loop/config.ts). Legacy `loop/state.json`
  writes retired (only `recoverStaleLoopState` still rewrites an EXISTING
  file, and never creates one). `gather.ts` reads `loop/instances/` first
  and falls back to the singleton only when the dir is absent; `LoopSignal`
  gains `loops[]`, `devx next` JSON gains a top-level `loops` field plus
  per-loop stderr lines on every row, `devx status` gains a live-loops
  section. Scratch namespaced to `.devx-cache/scratch/${DEVX_SESSION:-$$}/`
  in the byte-identical `skills/devx.md` + `.claude/commands/devx.md`
  mirror pair.
- 2026-07-28T16:25 — phase 4: single-pass adversarial self-review across 3
  explicit lenses (blind hunter / edge cases / AC audit) rather than the
  3-agent parallel shape — this session's harness forbids spawning
  subagents, so the parallel shape was unavailable; recorded as a
  deviation, not a skip. 4 findings, ALL fixed in-place: (HIGH) a dots-only
  session token ("..") sanitized to itself, so `reapScratch`'s recursive
  rmSync would have deleted the scratch root — or `.devx-cache` — instead
  of one session dir; (MED) `reapStoppedInstances` deleted a stale-heartbeat
  record without probing its PID, freeing a capacity slot out from under a
  starved-but-alive run still holding its per-run lock; (LOW) the heartbeat
  kept reporting the previous item between items, so a peer read a stale
  `current_item` for an item that was actually free; (LOW) a dead `lock`
  alias left behind by the manager-lock removal. Both HIGH/MED fixes landed
  with regression tests. Re-reviewed the changed hunks — clean.
- 2026-07-28T16:32 — phase 5 first-real-run, ON THIS REPO (AC 5). Five live
  instances registered into the LIVE `.devx-cache` through the same
  `registerInstance` the driver calls, then the real CLIs run against them:
  (a) `devx next --no-gh` fired row 1 with
  `"loops":[{run_id:"loop-smoke-mlc105-1",scope:"only:dev",…}, ×5]` in the
  JSON and five `live loop …` stderr lines — aggregation confirmed on the
  real repo, not a fixture; (b) `devx status` rendered `live loops: 5` with
  scope/idle/heartbeat-age per run above the workstream blocks;
  (c) `devx loop --max-items 1` was REFUSED with
  "capacity.max_concurrent is 5 and 5 loop runs are already live
  (loop-smoke-mlc105-5, …, loop-smoke-mlc105-1) — raise
  capacity.max_concurrent in devx.config.yaml or wait for one to finish",
  naming the knob, the count and every live run-id (AC 2, end-to-end).
- 2026-07-28T16:40 — INCIDENT during a repeat of (c): the smoke instances
  had already aged out, so the real `devx loop` was ADMITTED instead of
  refused and claimed the top ready DEBUG row (a7c3f9) before being killed
  at iteration 1. Operator error, not a code defect — the loop did exactly
  what it is designed to do on a repo with ready work. Fully reverted in
  89127b7 (DEBUG.md row, spec frontmatter + owner, worktree, branch, spec
  lock; no worker commits existed) and recorded in a7c3f9's own status log.
  One silver lining: the killed run left `status:"running"` under a dead
  pid, and the registry classified it dead — the crash-orphan path
  validated for free on the live repo.

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
