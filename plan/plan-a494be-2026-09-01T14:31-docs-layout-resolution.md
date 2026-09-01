---
hash: a494be
type: plan
created: 2026-09-01T14:31:00-06:00
title: Docs Layout Resolution
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
workstream: _devx/workstreams/docs-layout-resolution
gate_verdicts:
  prd: PASS
---

## Goal

Workstream 'Docs Layout Resolution' — PRD stage next. Artifacts live in `_devx/workstreams/docs-layout-resolution/`.

## Status log

- 2026-09-01T14:31 — workstream scaffolded by `devx workstream new docs-layout-resolution`.
- 2026-09-01T14:52 — PRD stage. Research: 3 parallel Explore agents (resolver call-site inventory, workstream resolution + `workstream:` frontmatter, docs_layout surface + outline guard). Four owner decisions locked: `workstream: .` under project-level; layout is the discriminator for the flat-era guards; `devx workstream new` slug optional under project-level; `devx layout migrate --to <layout>` as the migration surface. Gate: `devx gate prd a494be` → **PASS** (prd_validated: true, stage: design). Artifacts: `_devx/workstreams/docs-layout-resolution/prd/agent.md`, `expectations.md` (8 E-blocks, 7×P0), `prd/human.md`. Outline scaffolded empty at `prd/outline.md`, awaiting the human.
