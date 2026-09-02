---
hash: dlr102
type: dev
created: 2026-09-02T09:14:00-06:00
title: "Gate subject resolution"
status: in-progress
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
plan: _devx/workstreams/docs-layout-resolution
phase: 2
blocked_by: [dlr101]
branch: feat/dev-dlr102
owner: /devx-2026-09-02T1015-47853
---
## Goal

Makes docs/CONFIG.md section 15 rule 5 true: a gate resolves its subject
through the layout and returns the identical verdict for identical content in
either shape. Lands before the broad sweep because it is the contract the
whole workstream exists to honor. Plan phase 2 of workstream
docs-layout-resolution.

## Acceptance criteria

- [ ] AC 1: All four gates (`prd`, `coverage` in BOTH design and plan modes,
      `evals`) run against byte-identical subject content under both
      layouts — 8 layout x gate combinations — with 0 verdict differences.
- [ ] AC 2: Equality is NOT satisfiable by mutual failure. All 8 combinations
      are pinned to PASS on the passing fixture, and a deliberately-broken
      fixture per layout is pinned to FAIL. (An equality-only assertion goes
      green when a regression breaks both layouts identically.)
- [ ] AC 3: The 12 `*Abs()` subject reads in `src/commands/gate.ts`
      (`:203,204,278,279,314,315,361,363,489,496,550,552`) resolve through
      `stageSubject()`, and the two lying refusal strings are fixed.
- [ ] AC 4: `gate-prd.ts`'s 19 `location:` fields
      (`:209,218,227,238,259,265,273,282,296,321,329,343,353,361,371,379,387,397,405`)
      and 6 `message:` strings (`:208,217,226,237,281,295`) carry the resolved
      subject. `gate-coverage.ts`'s refusal and subject strings move onto
      `subject.rel`. Every `location:` and `message:` emitted under
      `project-level` names a path that EXISTS on disk.
- [ ] AC 5: The layout is never a gate INPUT — only subject resolution branches;
      gate bodies receive an already-resolved path and cannot see the layout.
      No verdict, threshold or `gate_status` field changes, and devx's own
      gates return output identical to `main`.
- [ ] AC 6: `evals/E-1_gate-subjects.ts` flips GREEN and
      `test/engine-layout-gate-subjects.test.ts` exists and passes;
      `npm test` green.

## Technical notes

Plan: `plan/agent.md` section "2. Phase". Gate `location:` fields are part
of the gate's OUTPUT contract, not decoration — a finding pointing at
`prd/agent.md:42` in a repo whose file is `prd.md` is a finding a human cannot
act on.

R-3: `commands/gate.ts` drops out of phase 4's sweep; its 12 sites are
resolved here. If phase 4 re-derives its list from a fresh grep instead of the
plan it will re-touch them — harmless, the second edit is a no-op.

Parallel-safe with phase 3 (disjoint file sets: 2 owns `gate*`, 3 owns
`workstream`/`doctor`).

## Status log

- 2026-09-02T09:14 — emitted by /devx-plan (RED gate PASS; workstream
  docs-layout-resolution, plan phase 2).
- 2026-09-02T10:15:01-06:00 — claimed by /devx in session /devx-2026-09-02T1015-47853
