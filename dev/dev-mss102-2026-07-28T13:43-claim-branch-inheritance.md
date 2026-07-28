---
hash: mss102
type: dev
created: 2026-07-28T13:43:00-06:00
title: "Claim branch inheritance"
status: ready
from: plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md
plan: _devx/workstreams/mid-story-split
phase: 2
blocked_by: [mss101]
branch: feat/dev-mss102
owner: null
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

## Links

- Plan: `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md`
- Workstream: `_devx/workstreams/mid-story-split/` (prd/design/plan/evals)
