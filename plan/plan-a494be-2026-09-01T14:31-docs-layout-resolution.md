---
hash: a494be
type: plan
created: 2026-09-01T14:31:00-06:00
title: Docs Layout Resolution
status: in-progress
stage: red
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: true
  plan_verified: true
  evals_red: false
outcome:
  status: null
  measure_by: null
workstream: _devx/workstreams/docs-layout-resolution
gate_verdicts:
  prd: PASS
  design: PASS
  plan: PASS
---

## Goal

Workstream 'Docs Layout Resolution' — PRD stage next. Artifacts live in `_devx/workstreams/docs-layout-resolution/`.

## Status log

- 2026-09-01T14:31 — workstream scaffolded by `devx workstream new docs-layout-resolution`.
- 2026-09-01T14:52 — PRD stage. Research: 3 parallel Explore agents (resolver call-site inventory, workstream resolution + `workstream:` frontmatter, docs_layout surface + outline guard). Four owner decisions locked: `workstream: .` under project-level; layout is the discriminator for the flat-era guards; `devx workstream new` slug optional under project-level; `devx layout migrate --to <layout>` as the migration surface. Gate: `devx gate prd a494be` → **PASS** (prd_validated: true, stage: design). Artifacts: `_devx/workstreams/docs-layout-resolution/prd/agent.md`, `expectations.md` (8 E-blocks, 7×P0), `prd/human.md`. Outline scaffolded empty at `prd/outline.md`, awaiting the human.
- 2026-09-01T15:40 — Design stage. Research: 4 parallel Explore agents (artifacts.ts resolver surface + callers, workstream resolution + EngineConfig threading, bypass sites + flat-era guards, CLI/git/config-write patterns). Coverage judged 3 rounds (16 covered/7 partial → 19/4 → 23/0); each round fixed real design defects, notably: the `STAGE_SHORTHAND` target swap would have broken `cascadeFor()` under project-level, `devx next` row selection breaks entirely under project-level ("PRD not yet authored" forever), the `*_REL` privatization blast radius was understated ~10x (~15 modules/40+ sites incl. a compile-breaking re-export), and the `*Abs()` helpers are a second ~51-site radius. Reading Guide (§31) authored and verified clean via `checkReadingGuide()` (0 findings). Gate: `devx gate coverage a494be --table <judged>` → **PASS** (design_verified: true, stage: plan). Artifacts: `design/agent.md`, `design/human.md`, `decisions/2026-09-01-design-verify.md`. Owner decision: project-level puts evals/decisions/checkpoints/RESULTS.md at the repo root (§15 as written). Outline scaffolded empty at `design/`, awaiting the human. 4 PRD baseline corrections recorded in design/agent.md, NOT yet propagated (a `devx revise --touched prd` resets all four gate flags) — owner call pending.
- 2026-09-02T16:05 — Plan stage. Owner decisions: 6-phase layered shape; PRD corrections DEFERRED (no `devx revise`); `lay101` consumed as a local predicate deleted on adoption. Profile delta recorded (`docs.human_render: on-gate-pass`, `plan.wave_execution: default`, `plan.risks_depth: interrogated`). Blast radius re-grounded: 33 `*Abs()` sites + 72 lines/93 occurrences of 7 `*_REL` constants across 17 modules (design estimated ~51/40+). Interrogated Risks written (10 rows; riskiest phase named, R-5 recorded as NOT revert-safe). Critique: 4 parallel lenses (pm/architect/dev/qa) under the grounding rule — 26 findings applied, 1 declined; record in `decisions/2026-09-02-plan-critique.md`. Nine of those were structural, incl.: every eval artifact would have resolved to the `cli` runner and recorded the whole suite's exit code (moved to `evals/E-N_*.ts` under `npx tsx`); Phase 2 could not deliver E-1 without the 12 `commands/gate.ts` subject reads; the `ArtifactKind` template list would have broken template *source* lookup; and R-2's mitigation was self-falsifying (fixed structurally by moving scaffolding behind the sweep). **Departure from the owner's coarse 6-phase choice: 7 phases** — the sweep and the identity change split at the compile-break seam; stated in the plan and reversible in one edit. Design-stage corrections also deferred (2 flat-era guards not 3; ten `*Abs()` helpers not nine; `mark-done.ts:525`'s failure mode unreachable) — recorded in `decisions/2026-09-02-deferred-prd-corrections.md` so `devx outcome` has a non-plan source for G-2's corrected baseline. Coverage judged by subagent: first pass 7 covered / 1 partial (E-3's negative control was unexecutable — the scan was authored in Phase 5, after Phase 4 closed the sites it must flag); fixed by moving E-3 to Phase 4 as T4.1 ahead of T4.5, re-judged `covered`. Gate: `devx gate coverage a494be --table <judged>` → **PASS** (plan_verified: true, stage: red); 8/8 covered, P0 floor met, 4 extras flagged for approval. Artifacts: `plan/agent.md` (7 phases, 4 waves), `plan/human.md`, `decisions/2026-09-02-plan-verify.md`. Outline scaffolded empty at `plan/`, awaiting the human.
