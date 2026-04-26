---
hash: f01000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Phase 5 — Test, debug, retro, learn"
status: deferred
from: docs/ROADMAP.md#phase-5--test-debug-retro-learn-week-56
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [backend]
blocked_by: [c4f1a2]
---

## Goal

The system writes its own tests, fixes its own bugs, and learns from both. RetroAgent + LearnAgent close the self-healing loop; canary runs gate prompt/skill edits.

## Scope

Seven epics from [`ROADMAP.md § Phase 5`](../docs/ROADMAP.md#phase-5--test-debug-retro-learn-week-56):

- `epic-devx-test-layer-1` — `/devx-test` with Playwright regression authoring + line-level coverage gate.
- `epic-devx-debug-skill` — `/devx-debug` log → repro → fix → regression test loop.
- `epic-flaky-detection` — green→red→green within 24h auto-files TEST.md entry.
- `epic-retro-agent` — RetroAgent runs at end of every `/devx` and `/devx-plan`.
- `epic-learn-agent` — ≥3 concordant retros → LESSONS.md proposal with mode-derived auto-apply ceiling.
- `epic-canary-prompt-changes` — 3-shadow-PR comparison before merging skill/prompt edits.
- `epic-over-tuning-detector` — user skill edits vs. lesson applications surface warning to MANUAL.md.

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed. Cross-references [`SELF_HEALING.md`](../docs/SELF_HEALING.md) for confidence/blast-radius gates.

## Acceptance criteria

- [ ] Touched-line coverage gate blocks merge on a real PR; `devx:no-coverage` opt-out works.
- [ ] DebugAgent reproduces a planted bug from logs alone, ships fix + regression test.
- [ ] LearnAgent emits a real LESSONS.md entry from 3 concordant retros on dogfood data.
- [ ] Canary run rejects a deliberately-worse skill edit before it reaches main.

## Status log

- 2026-04-26T19:30 — Phase 5 placeholder created
