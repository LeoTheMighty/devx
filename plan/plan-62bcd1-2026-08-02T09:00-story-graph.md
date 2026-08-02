---
hash: 62bcd1
type: plan
created: 2026-08-02T09:00:15-06:00
title: Story Graph
status: in-progress
stage: design
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: false
  plan_verified: false
  evals_red: false
outcome:
  status: null
  measure_by: null
workstream: _devx/workstreams/story-graph
gate_verdicts:
  prd: PASS
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
