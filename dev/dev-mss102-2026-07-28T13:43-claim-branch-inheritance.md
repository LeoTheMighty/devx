---
hash: mss102
type: dev
created: 2026-07-28T13:43:00-06:00
title: "Claim branch inheritance"
status: done
from: plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md
plan: _devx/workstreams/mid-story-split
phase: 2
blocked_by: [mss101]
branch: feat/dev-mss102
owner: /devx-2026-07-28T1453-1244
---
## Goal

`claimSpec` honors a `branch:` frontmatter field naming an existing branch
— the worktree attaches without `-b` and base resolves to that branch, so
branch-handoff follow-ups are claimable cold by any session. The only
general claim-path change in the workstream; isolated in its own PR so its
blast radius (every future claim) gets its own tour. Specs without
`branch:` (all existing specs) take the derive path unchanged. Plan phase
2 of workstream mid-story-split. Parallel-safe with mss103.

## Acceptance criteria

- [ ] AC 1: `parseSpecClaimFields` (`src/lib/devx/verify-claim.ts:158`)
      surfaces the `branch:` frontmatter field — same parse extended, no
      second frontmatter parser.
- [ ] AC 2: `claimSpec` branch-inheritance arm around the
      derive/worktree-add sequence (`src/lib/devx/claim.ts` ~:907): when
      `branch:` names an existing branch, worktree attaches to it (no
      `-b`) and base resolves to it; the derive path is byte-identical for
      specs without `branch:` — existing claim tests untouched and green.
- [ ] AC 3: `test/devx-split.test.ts` E-5 case group (describe-title
      marker `"E-5:"`) green: `devx next` surfaces the follow-up as the
      ready pick (row 8) once blockers resolve with zero `gather.ts`
      edits, claim succeeds with recorded branch inheritance honored on
      both merge-first and branch-handoff fixtures built by phase 1's
      `performSplit`, and split-attributable drift entries = 0.
- [ ] AC 4: eval
      `_devx/workstreams/mid-story-split/evals/E-5_fresh-claim-viability.ts`
      flips GREEN (re-run it RED first, per its failure list); `npm test`
      (typecheck included) green.

## Technical notes

Design: `_devx/workstreams/mid-story-split/design.md` §Interfaces
(claimSpec extension). The dispatcher needs no change: follow-up rows are
ordinary `[ ]` + `Status: ready` + `Blocked-by:` rows; `blockersResolved`
(`src/lib/next/gather.ts:254`) already gates claimability — E-5 asserts
this with zero gather edits.

## Status log

- 2026-07-28T13:43 — emitted by /devx-plan (RED gate passed; workstream
  mid-story-split, plan phase 2).
- 2026-07-28T14:20 — phase 2: spec ACs direct (v2 native); 4 ACs;
  workstream=mid-story-split;
  red-artifacts=evals/E-5_fresh-claim-viability.ts (re-run RED observed,
  right-reason: T2.1 parse missing + E-5 case group missing).
- 2026-07-28T15:05 — phase 3: implemented. parseSpecClaimFields surfaces
  branch: (T2.1); claimSpec attach arm — show-ref probe (heads +
  remotes/origin, stdout-shape-validated) → worktree add without -b when
  the recorded branch exists (T2.2); E-5 case group authored: dispatch
  row 8 on both shapes' fixtures via real gather+decide, claim
  inheritance attach/derive/no-probe, drift = 0 (T2.3). E-5 eval GREEN.
  Files: src/lib/devx/claim.ts, src/lib/devx/verify-claim.ts,
  test/devx-split.test.ts, test/devx-verify-claim.test.ts.
- 2026-07-28T15:30 — phase 4: 3-agent parallel adversarial review (Blind
  Hunter + Edge Case Hunter + Acceptance Auditor); 15 findings (2 HIGH, 4
  MED, 9 LOW/INFO); ALL fixed in-place — most load-bearing: the probe
  consulted only the local ref store and never fetched, so the flagship
  cold-session claim of a branch-handoff follow-up silently derived from
  main and stranded the parent's pushed WIP (BH-1); now a targeted
  `+refs/heads/<b>:refs/remotes/origin/<b>` fetch gates attach, which also
  stops a stale tracking ref for an upstream-deleted branch from
  qualifying. Also: attach now refuses (pre-transaction, with the
  `git worktree remove` the operator needs) when the branch is checked out
  elsewhere — the parent's own worktree in the handoff shape, previously a
  post-push wedge whose rerun hint could never succeed (EC-1); refuses the
  default/integration branch (BH-2); inheritance keyed on recorded !=
  derived so leftover same-named debris still fails loudly instead of
  being silently adopted (BH-3/EC-2 — narrows AC 2, filed INTERVIEW Q#14);
  transient spec-read failure now fails the claim instead of silently
  deriving (EC-3); `branch:` scalar normalized for quotes/comments/
  refs-heads prefix (EC-5); local branch created explicitly from the
  fetched ref so `worktree add` never needs single-remote DWIM (BH-8);
  stale `ClaimSpecResult.branch` doc corrected (BH-7); misleading no-op
  test helper now asserts it changed something (EC-7). Acceptance Auditor
  returned 4/4 ACs MET, scope clean. E-5 group grown 5 → 12 cases.
  Filed out-of-scope: `debug/debug-b41f7c-…-attach-branch-loop-hazards.md`
  (loop `discardWorktree` force-deletes an inherited branch; driver.ts is
  phase 3's file, concurrently claimed by mss103). Re-review of the fix
  hunks found one residual — the cold-session fetch + branch create are
  pre-transaction mutations outside claim rollback — judged inert and
  idempotent, documented at the call site rather than restructured.
- 2026-07-28T15:53 — phase 5: local CI green — `npm test` (typecheck
  included) 125 files / 2454 tests passed, 0 failures; E-5 eval exits 0.
  Coverage informational under YOLO.
- 2026-07-28T16:02 — phase 7: rebased onto origin/main (main advanced 3
  commits mid-run; mlc104 landed ~168 lines in claim.ts's push-retry step —
  disjoint from this change's regions, rebase clean). PR #97
  https://github.com/LeoTheMighty/devx/pull/97; CI success — devx-ci
  (run 30402604380). Tour published:
  https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/mss102/tour.html
- 2026-07-28T16:05 — merged via PR #97 (squash → 46fb9e4). check-hold
  clean; merge-gate {"merge":true}. `gh pr merge` exited non-zero from the
  worktree (known artifact) — verified MERGED via `gh pr view`.
- 2026-07-28T14:53:06-06:00 — claimed by /devx in session /devx-2026-07-28T1453-1244

## Links

- Plan: `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md`
- Workstream: `_devx/workstreams/mid-story-split/` (prd/design/plan/evals)
