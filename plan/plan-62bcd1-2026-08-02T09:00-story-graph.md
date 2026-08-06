---
hash: 62bcd1
type: plan
created: 2026-08-02T09:00:15-06:00
title: Story Graph
status: done
stage: done
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: true
  plan_verified: true
  evals_red: true
outcome:
  status: pending
  measure_by: 2026-09-20
workstream: _devx/workstreams/story-graph
gate_verdicts:
  prd: PASS
  design: CONCERNS
  plan: PASS
  evals: PASS
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
- 2026-08-02T~16:30 — Plan stage: user locked the 6-phase cut at interview
  (parser → model → CLI → hooks → backfill → portability). Critique ran
  (send-it but ≥2 surfaces; lenses pm/architect/dev/qa, all grounded):
  2 HIGH (nonexistent `devx next --format json` criterion; E-7's
  0-outside-reads had no mechanism) + ~12 MED + ~10 LOW, all applied —
  including splitting the oversized hooks phase per D-12, so the final
  plan is 7 phases (4 = claim+emission regen, 5 = mark-done + Phase-8
  rewrite). Coverage judge: 7/7 ✅, 10 extras flagged. Ran `devx gate
  coverage 62bcd1` (plan mode): PASS; plan_verified; stage → red.
  Artifacts: plan.md; decisions/2026-08-02-plan-critique.md;
  decisions/2026-08-02-plan-verify.md.
- 2026-08-02T14:05 — RED stage: 7 eval artifacts authored at the exact
  Verified-by paths (+ shared `evals/_fixture.ts`, mlc precedent); each run
  standalone first and confirmed failing for the stated missing-feature
  reason (`error: unknown command 'graph'` — never harness breakage).
  `devx gate evals 62bcd1` PASS — 7/7 right-reason RED, 0 deferred;
  evals_red flipped, stage → executing. Emitted sgr101–sgr107 (one per
  plan phase; sgr103 + sgr106 carry the attended-only `--exclude` note)
  + sgrret (emit-retro-story), DEV.md § Epic — story-graph in dependency
  order, todo.md Stage: Execute pointers, PLAN.md checkbox flipped;
  validate-emit story-graph ok.
- 2026-08-06T10:05 — workstream closed by sgrret: 7/7 phases merged (PRs
  #110/#111/#112/#114/#117/#118/#120, last merge 2026-08-05), E-1…E-7 all
  GREEN at their phase's merge; status/stage → done; outcome armed,
  measure-by 2026-09-20 (G-3's date; G-1 + G-2 score at the same sitting —
  G-2's attended legs are MANUAL.md MV-sgr107.1–.3). Retro:
  `_devx/workstreams/story-graph/RETRO-2026-08-06.md`; LEARN.md §
  epic-story-graph E1–E10 + 1 cross-epic promotion (honest-RED) + 3
  cross-epic row updates.
