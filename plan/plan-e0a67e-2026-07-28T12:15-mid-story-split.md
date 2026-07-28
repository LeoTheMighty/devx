---
hash: e0a67e
type: plan
created: 2026-07-28T12:15:51-06:00
title: Mid Story Split
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
workstream: _devx/workstreams/mid-story-split
gate_verdicts:
  prd: PASS
  design: PASS
---

## Goal

Workstream 'Mid Story Split' — PRD stage next. Artifacts live in `_devx/workstreams/mid-story-split/`.

## Status log

- 2026-07-28T12:15 — workstream scaffolded by `devx workstream new mid-story-split`.
- 2026-07-28 — PRD stage: research fan-out (2 Explore agents: handoff-snippet surface inventory + loop/dep-tree/state mechanics), user interviewed on 3 scope decisions (both surfaces; merge-first preferred + branch-handoff fallback; worker-requested + budget rail), prd.md (G-1..G-3, UC-1..UC-4, CAP-1..CAP-5, FR-1..FR-8) + expectations.md (E-1..E-5, 3×P0) written; `devx gate prd e0a67e` FAIL (3 non-numeric thresholds) → fixed → PASS; stage → design. Critique step skipped per send-it thoroughness. Artifacts: _devx/workstreams/mid-story-split/{prd.md,expectations.md}.
- 2026-07-28 — Design stage: research fan-out (3 Explore agents: reuse kernel, loop terminal paths, snippet surface inventory), all cited symbols grep-verified, user settled 3 parked decisions (`devx split <hash>` top-level; reuse `superseded` for branch-handoff parent; no split on exitInProgress) + LEARN exemplar resolved (replacement test/devx-skill-phase9-split.test.ts); design.md written (two shapes: merge-first / branch-handoff; claim-posture atomic write; split_request + budget rail; FR-7 sweep plan); coverage judge found 1 gap (UC-3 merge-if-green at rail) + 1 redundant flag → fixed → re-judged 20✅/0⚠️/0❌; `devx gate coverage e0a67e` PASS (design mode); stage → plan. Artifacts: _devx/workstreams/mid-story-split/design.md, decisions/2026-07-28-design-verify.md.
