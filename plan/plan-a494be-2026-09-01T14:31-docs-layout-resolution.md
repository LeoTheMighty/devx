---
hash: a494be
type: plan
created: 2026-09-01T14:31:00-06:00
title: Docs Layout Resolution
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
workstream: _devx/workstreams/docs-layout-resolution
gate_verdicts:
  prd: PASS
  design: PASS
---

## Goal

Workstream 'Docs Layout Resolution' — PRD stage next. Artifacts live in `_devx/workstreams/docs-layout-resolution/`.

## Status log

- 2026-09-01T14:31 — workstream scaffolded by `devx workstream new docs-layout-resolution`.
- 2026-09-01T14:52 — PRD stage. Research: 3 parallel Explore agents (resolver call-site inventory, workstream resolution + `workstream:` frontmatter, docs_layout surface + outline guard). Four owner decisions locked: `workstream: .` under project-level; layout is the discriminator for the flat-era guards; `devx workstream new` slug optional under project-level; `devx layout migrate --to <layout>` as the migration surface. Gate: `devx gate prd a494be` → **PASS** (prd_validated: true, stage: design). Artifacts: `_devx/workstreams/docs-layout-resolution/prd/agent.md`, `expectations.md` (8 E-blocks, 7×P0), `prd/human.md`. Outline scaffolded empty at `prd/outline.md`, awaiting the human.
- 2026-09-01T15:40 — Design stage. Research: 4 parallel Explore agents (artifacts.ts resolver surface + callers, workstream resolution + EngineConfig threading, bypass sites + flat-era guards, CLI/git/config-write patterns). Coverage judged 3 rounds (16 covered/7 partial → 19/4 → 23/0); each round fixed real design defects, notably: the `STAGE_SHORTHAND` target swap would have broken `cascadeFor()` under project-level, `devx next` row selection breaks entirely under project-level ("PRD not yet authored" forever), the `*_REL` privatization blast radius was understated ~10x (~15 modules/40+ sites incl. a compile-breaking re-export), and the `*Abs()` helpers are a second ~51-site radius. Reading Guide (§31) authored and verified clean via `checkReadingGuide()` (0 findings). Gate: `devx gate coverage a494be --table <judged>` → **PASS** (design_verified: true, stage: plan). Artifacts: `design/agent.md`, `design/human.md`, `decisions/2026-09-01-design-verify.md`. Owner decision: project-level puts evals/decisions/checkpoints/RESULTS.md at the repo root (§15 as written). Outline scaffolded empty at `design/`, awaiting the human. 4 PRD baseline corrections recorded in design/agent.md, NOT yet propagated (a `devx revise --touched prd` resets all four gate flags) — owner call pending.
