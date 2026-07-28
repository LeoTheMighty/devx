---
hash: mss103
type: dev
created: 2026-07-28T13:43:00-06:00
title: "Loop split integration"
status: in-progress
from: plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md
plan: _devx/workstreams/mid-story-split
phase: 3
blocked_by: [mss101]
branch: feat/dev-mss103
owner: /devx-2026-07-28T1453-1873
---
## Goal

The loop's two split paths — worker-requested merge-first at a clean seam,
budget-rail branch-handoff on real progress — plus `split` as a
first-class outcome. Any thrown split error falls back to today's
`abandonItem` verbatim (status-quo floor). Plan phase 3 of workstream
mid-story-split. Parallel-safe with mss102.

## Acceptance criteria

- [ ] AC 1: `src/lib/loop/iteration.ts` — `IterationReport.split_request?`
      validated on its own error path (never fails the whole report;
      malformed → `iteration:split-request-invalid` event + WARN, request
      ignored, loop continues), explicitly copied through in
      `validateIterationReport` (:92 returns a fresh trimmed object —
      silent-drop hazard); `OUTPUT_FIELD_LINES` (:314) + prompt clean-seam
      instruction (request a split only when committed, coherent, green on
      the done portion).
- [ ] AC 2: `src/lib/loop/report.ts` — `ItemOutcome` gains `"split"`
      (:27-34) across `OUTCOME_LABEL` (:133), `counts` (:237),
      `nextSteps` ("split → follow-up ready: `/devx <hash>`"), and
      `itemSection` (renders follow-up path); `ItemResult.followUpSpecPath?`.
- [ ] AC 3: `src/lib/loop/driver.ts` — `splitItem(reason, payload)` beside
      `abandonItem` (:1252): ownership guard → `pushCurrentBranch` →
      `performSplit(shape: "branch-handoff")` → `releaseSpecLock` closure
      → `commitOnMain` with new `extraPaths` param → `pushMain`; events
      `item:split` / `item:split-fallback`; `outcome === "split"` joins
      `afterItemCompleted` (:715) — abandonment streak untouched
      (`ladder.ts:307` verify-only).
- [ ] AC 4: budget-rail predicate at exhaustion (:1469): `good >= 1 &&
      !isBookkeepingOnlyWorktree` → `splitItem`, else `abandonItem`
      verbatim; worker-request path in the `completeItem` tail (:1817):
      valid `split_request` + `acs_met: false` → normal merge tail then
      `performSplit(shape: "merge-first")` before `finalizeMerged`
      bookkeeping (handed-off tail: follow-up still filed, outcome stays
      `handed-off`); budget rail always splits branch-handoff, never
      merge-first.
- [ ] AC 5: `test/loop-driver.test.ts` E-3 case group (describe-title
      marker `"E-3:"`) green: real progress → outcome `split` (follow-up
      spec + DEV.md row committed on main, morning report names the
      follow-up path), bookkeeping-only worktree → abandon path
      byte-identical to today, abandonment streak remains 0 after a split;
      plus dedicated fallback test (`performSplit` throws → item lands
      exactly where `abandonItem` puts it today).
- [ ] AC 6: `test/loop-iteration.test.ts` E-4 case group (describe-title
      marker `"E-4:"`) green: well-formed request → exactly 1 driver-side
      split; malformed → 1 validation error + 0 spec/backlog writes;
      iteration counter advances and item not terminated.
- [ ] AC 7: evals
      `_devx/workstreams/mid-story-split/evals/E-3_budget-rail-split.ts` +
      `E-4_worker-requested-split.ts` flip GREEN (re-run them RED first,
      per their failure lists); `npm test` (typecheck included) green.

## Technical notes

Design: `_devx/workstreams/mid-story-split/design.md` §Architecture 3-4.
Workers never write specs/backlogs — the driver performs every split.
Progress oracles reused, none added: `iterationsGood` counters,
`isBookkeepingOnlyWorktree` (`git-tx.ts:288`), `diffStat` (`git-tx.ts:317`).
`commitOnMain` pathspec is limited to exactly two files (`driver.ts:973`)
— extend via the `extraPaths` param, don't widen the literal. New event
names are string literals at call sites, per convention.

## Status log

- 2026-07-28T13:43 — emitted by /devx-plan (RED gate passed; workstream
  mid-story-split, plan phase 3).
- 2026-07-28T14:53:21-06:00 — claimed by /devx in session /devx-2026-07-28T1453-1873

## Links

- Plan: `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md`
- Workstream: `_devx/workstreams/mid-story-split/` (prd/design/plan/evals)
