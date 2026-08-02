---
hash: 62bcd1
type: plan
created: 2026-08-02T09:00:15-06:00
title: Story Graph
status: in-progress
stage: plan
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: true
  plan_verified: false
  evals_red: false
outcome:
  status: null
  measure_by: null
workstream: _devx/workstreams/story-graph
gate_verdicts:
  prd: PASS
  design: CONCERNS
---

## Goal

Workstream 'Story Graph' — PRD stage next. Artifacts live in `_devx/workstreams/story-graph/`.

## Status log

- 2026-08-02T09:00 — workstream scaffolded by `devx workstream new story-graph`.
- 2026-08-02T09:10 — PRD stage: user locked 4 decisions (GRAPH.md at root +
  loop auto-regen; durable edges; full board with done epics collapsed;
  assisted backfill). The user-approved `depends_on:` field was superseded
  same-day by research — `Blocked-by:`/`blocked_by` is already the durable
  machine-parsed encoding; PRD reuses + hardens it (wrap-don't-duplicate).
  Two Explore audits saved to research/ (state encoding; ffm + palateful
  drift). Ran `devx gate prd 62bcd1`: FAIL (template `<date>` furniture,
  E-2 EARS comma) → fixed → PASS; stage → design. Artifacts: prd.md,
  expectations.md (E-1..E-7), research/2026-08-02-*.md.
- 2026-08-02T~13:00 — Design stage: user had no open design questions;
  grounded via 2 Explore maps (parser surface; CLI/flow helpers). Key
  design decisions: graph = map not dispatcher (renders edge union +
  effectiveStatus, re-implements no resolver); worktree-safe root via
  `resolveRepoRoot()`; regen is warn-and-continue inside helpers; new
  `devx devx-helper mark-done` hosts merge-cleanup regen (no CLI helper
  existed — FR-4 had no host); parser hardening lands in
  `src/lib/backlog/parse.ts` so all consumers inherit it; O-1 verified
  non-binding (tour-scoped pins only). Ran `devx gate coverage 62bcd1`:
  CONCERNS (17 covered, 2 partial — FR-4 emission-commit pathspec, FR-6
  downstream skill distribution; 4 extras flagged for product approval);
  both partials fixed in design.md post-verdict; stage → plan. Artifact:
  design.md; decisions/2026-08-02-design-verify.md.
