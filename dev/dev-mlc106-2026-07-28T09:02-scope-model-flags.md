---
hash: mlc106
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Scope model: epic-aware rows + loop scope flags"
status: ready
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: [mlc105]
branch: feat/dev-mlc106
owner: null
---
## Goal

`devx loop` gains `--epic` / `--workstream` / `--items` / `--exclude` /
`--focus`; DEV.md epic headings become machine-readable row fields; scope
masks (never drops) out-of-scope rows and is surfaced in instance file,
report, and `devx next`; the N=1 degenerate-case sweep closes the
workstream (goals UC-1/2/3, E-8). Plan phase 6 of workstream
multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: `parseDevMd` stamps rows with `{epicSlug, epicPlanHash}` from
      `### Epic — {name} (plan: {hash})` headings (additive fields; rows
      above any heading get nulls); `test/backlog-parse-epic.test.ts`.
- [ ] AC 2: `src/lib/loop/scope.ts` — `buildScopeMask(rows, scope)`;
      `--epic` matches slug or plan hash (normalized); `--workstream`
      resolves membership via the extracted frontmatter walk (shared with
      gather, not duplicated); masking uses the existing excluded-set
      mask-to-blocked mechanism so cross-scope Blocked-by edges hold.
- [ ] AC 3: `--items` restricts to the listed hashes AND overrides pick
      order to list order; an in-scope item blocked by an out-of-scope
      unfinished item is reported (event + morning-report line naming the
      blocking hash), never silently skipped.
- [ ] AC 4: `--focus` text lands verbatim in the iteration prompt frame as
      a Specialty directive; scope recorded in the instance file, report
      header, and `devx next` row-1 rendering; malformed scope flags fail
      fast (exit 4) against the parsed backlog.
- [ ] AC 5: eval E-6_scope-semantics.ts flips GREEN; `test/loop-scope.test.ts`
      added; E-8 degenerate-case sweep checklist
      (evals/E-8_degenerate-case.md) fully checked incl. PR-body
      mechanical-update callouts; E-7 live-overnight checklist wired into
      the morning-report Next-steps template; `npm test` green.

## Technical notes

Design §Architecture 6. Blocker status lookup is already global
(`gather.ts:245-253`) — cross-scope edges hold for free.

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 6).

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
