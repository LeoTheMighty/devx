---
hash: mss103
type: dev
created: 2026-07-28T13:43:00-06:00
title: "Loop split integration"
status: done
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
- 2026-07-28T14:20 — phase 2: spec ACs direct (v2 native); 7 ACs; workstream=mid-story-split; red-artifacts=evals/E-3_budget-rail-split.ts,evals/E-4_worker-requested-split.ts (both re-run RED, right-reason: named missing features T3.1-T3.8, no infra failure).
- 2026-07-28T15:20 — phase 3: implemented T3.1–T3.7. iteration.ts:
  `split_request` + `validateSplitRequest` on its own error path
  (`splitRequestErrors` on the ok-result; never fails the report) + explicit
  copy-through + OUTPUT_FIELD_LINES clean-seam line. report.ts: `split`
  outcome across label/counts/nextSteps/itemSection + `followUpSpecPath`.
  driver.ts: `splitItem` (push WIP → performSplit(branch-handoff) →
  worktree removed, branch KEPT → release → commitOnMain(extraPaths) →
  push), `budgetExhausted` on both rails, worker-requested merge-first path
  through the normal tail, `item:split` / `item:split-fallback` /
  `iteration:split-request-invalid`, and `split` joining
  `afterItemCompleted` (ladder.ts verify-only, unmodified). Seam extension:
  `PerformSplitOpts.branch` override — `claimSpec` never writes `branch:`
  frontmatter, so branch-handoff from the loop would otherwise always throw
  at compose.
- 2026-07-28T16:05 — phase 4: 3-agent parallel adversarial review (Blind
  Hunter + Edge Case Hunter + Acceptance Auditor); 20 unique findings
  (2 HIGH, 10 MED, 8 LOW); ALL fixed in-place. Most load-bearing: the budget
  rail routed a commit-failure-preserved DIRTY worktree into the split path,
  where `worktree remove --force` destroyed work `pushCurrentBranch` had not
  committed — found independently by two reviewers, and a strict work-loss
  regression vs today's abandon-preserve. Fixed by `hasCommittedProgress()`
  (goodWithFiles + no pendingRepair + clean tree + not bookkeeping-only),
  which now gates BOTH the budget rail and the worker-requested path — the
  latter closing a second hole where an exploratory iteration that changed
  nothing could open a status-log-only PR, auto-merge it under YOLO, and
  mark the parent done. Other HIGH: the Acceptance Auditor caught that my
  own `git add` failure guard was dead code (it dropped the unstageable
  extras into a local, then still spread `extraPaths` into the commit
  argv). Also fixed: a failed worker-requested split no longer marks the
  parent `[x]` done (leaves it `[-]` blocked with the unmet ACs in its
  status log, and the morning report says "merged at reduced scope" rather
  than claiming a clean merge); ownership-lost no longer swallows a pending
  split; `remainingAcsFromSpec` now treats `[/]` and `[-]` as unmet, not
  just `[ ]`; a falsy `split_request` reads as absent rather than
  malformed; the handed-off split bookkeeping holds the backlog lock once
  across splice→commit→push; `Continue <hash>:` title prefixes no longer
  compound on re-split. Deviation recorded per the auditor: the worker-path
  progress gate emits a FOURTH event name, `iteration:split-request-ignored`,
  beyond the three plan.md § phase-3 Context enumerates — deliberate, since
  folding it into `split-request-invalid` would misreport a well-formed
  request as malformed. Re-review clean. The one finding that is a product
  decision rather than a bug — split chains have no escalation cap, so a
  perpetually-splitting item never reaches a human — is filed as INTERVIEW
  Q#15 with a recommendation, not silently defaulted.
- 2026-07-28T17:05 — phase 5: `evals/E-3_budget-rail-split.ts` and
  `evals/E-4_worker-requested-split.ts` both flipped GREEN (RED→GREEN
  observed this session; RED re-run at 14:15 was right-reason). Local gate:
  `test/loop-driver.test.ts` 57 passed. NOTE for the tour/PR — the first
  full-suite run surfaced 4 failures in PRE-EXISTING loop-driver tests, all
  `expected 'split' to be 'abandoned'`: they encoded the pre-mss103 contract
  at exactly the seam AC 4 changes. Three (iteration budget, per-item token
  budget, debug-494590 cache-read accounting) were retargeted to the new
  terminal outcome with every accounting assertion left intact. The fourth
  (MED-4, "abandoned items WITH committed progress don't trip the systemic
  3-stop") pins a guarantee that is still live but no longer reachable via
  the budget rail, so it was retargeted to reach abandon-with-progress
  through the FAILURE LADDER (1 good committed iteration + 3 consecutive
  reported failures) and now also asserts no `item:split` event fired, so it
  cannot silently start passing through the split path later.
- 2026-07-28T23:45 — merged via PR #99 (squash → 962f9a1). Post-merge gate on the merge commit: 128 files / 2544 tests green; remote CI run 30408043404 success. Phase 7 note: the PR sat with ZERO CI runs for ~15min and three `empty` probes — cause was `mergeable: CONFLICTING` (mss102 + mlc104 + mlc105 landed mid-flight), NOT the workflow `on:` filters the /devx contract's empty-branch assumes. Merged origin/main in (cb4de51), resolved 2 test conflicts (both 'two sessions appended independent blocks'), and CI started immediately. Tour rebuilt post-merge: every cited driver.ts line had shifted ~120 lines, so all 23 anchors were recomputed by grep before republishing.

## Links

- Plan: `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md`
- Workstream: `_devx/workstreams/mid-story-split/` (prd/design/plan/evals)
