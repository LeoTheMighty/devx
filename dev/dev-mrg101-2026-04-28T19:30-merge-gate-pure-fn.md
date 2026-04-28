---
hash: mrg101
type: dev
created: 2026-04-28T19:30:00-07:00
title: mergeGateFor() pure function + truth-table tests
from: _bmad-output/planning-artifacts/epic-merge-gate-modes.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-04-28-mrg101
branch: feat/dev-mrg101
---

## Goal

Ship `src/lib/merge-gate.ts` with `mergeGateFor(mode, signals): GateDecision` as a pure function. Cover the 4-mode truth table + trust-gradient override + unsafe defaults via vitest tests.

## Acceptance criteria

- [x] `src/lib/merge-gate.ts` exports `Mode`, `GateSignals`, `GateDecision`, and `mergeGateFor(mode, signals)`.
- [x] YOLO: `merge=true` iff `ciConclusion ∈ {success, null}` AND `lockdownActive == false`.
- [x] BETA: YOLO conditions + `blockingReviewComments == 0`.
- [x] PROD: BETA conditions + `coveragePctTouched != null AND coveragePctTouched >= 1.0`.
- [x] LOCKDOWN: always `merge=false`, `reason: "lockdown active; manual merge required"`.
- [x] Trust-gradient override: `count < initialN` returns `{merge:false, advice:["file INTERVIEW for approval"]}` BEFORE mode logic.
- [x] Unknown / malformed mode → `{merge:false, reason:"unknown mode: <value>"}`.
- [x] Missing `coveragePctTouched` under PROD → `{merge:false, reason:"PROD: coverage data missing"}`.
- [x] No I/O inside the function — verified by test that imports the file with `fs` and `child_process` shadowed to throw on use.
- [x] Tests: `test/merge-gate-truth-table.test.ts` covers ≥ 16 distinct rows; `test/merge-gate-trust-gradient.test.ts` covers override-applies + overrides-mode-success cases.

## Technical notes

- Pure function — easy to unit-test, easy to reuse across `/devx` and (future) `/devx-manage` promotion.
- Trust-gradient is the highest-priority check — overrides mode, including LOCKDOWN's always-false (the override returns the trust-gradient reason instead of LOCKDOWN reason for clarity in the audit log).

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-04-28T20:05 — claimed by /devx in session /devx-2026-04-28-mrg101 (Phase 1 epic-1 starter; no blockers)
- 2026-04-28T20:48 — implemented `src/lib/merge-gate.ts` + 3 test files (truth-table 18 rows, trust-gradient 9 cases, no-io 2). All 10 ACs satisfied. Self-review found 1 MED (audit-log reason text for runtime lockdown was code-shaped) + 2 LOW (plural noun, project-context leak in test) — all fixed before commit per CLAUDE.md self-review-non-skippable. Local CI green: 455/455 tests pass (424 prior + 31 new).
- 2026-04-28T20:55 — merged via PR #31 (squash → 48cbd2f); remote CI green (run 25066083741).
