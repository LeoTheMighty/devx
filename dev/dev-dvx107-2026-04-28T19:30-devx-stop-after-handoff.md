---
hash: dvx107
type: dev
created: 2026-04-28T19:30:00-07:00
title: stop_after handling + Handoff Snippet on early stop
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [dvx106]
branch: feat/dev-dvx107
---

## Goal

Implement `/devx`'s `stop_after` argument (`this-item | n-items | until-blocked | all`) and the Handoff Snippet emitted on early stop. Snippet shape pinned via fixture test.

## Acceptance criteria

- [ ] `.claude/commands/devx.md` parses `stop_after`. Default: `this-item`. Supports loop-back to Phase 1 for next ready item under `n-items` / `all`.
- [ ] On early stop (context budget, quality risk, blocker, mode change, user halt), emits the Handoff Snippet in a fenced ```text``` block.
- [ ] Snippet shape:
  - "Already done" — list of completed items with PR/merge state.
  - "Next up (in order)" — remaining queued hashes.
  - "State to trust" — current branch, active worktrees, in-progress DEV.md entries, mode, trust-gradient count.
  - "Gotchas from prior session" — concrete facts the next agent would waste context relearning.
  - "Do NOT" — list of don't-redo actions.
  - Final line: `Continue from <next hash or slug>.`
- [ ] On full-run completion (all targeted items merged, no pending work), the snippet is suppressed.
- [ ] `test/devx-handoff-snippet.test.ts` asserts snippet structure against a fixture session.

## Technical notes

- Handoff Snippet is the bridge to `/clear` + re-invoke pattern — critical for context-budget-driven early stops.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
