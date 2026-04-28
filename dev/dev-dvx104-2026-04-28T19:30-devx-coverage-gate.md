---
hash: dvx104
type: dev
created: 2026-04-28T19:30:00-07:00
title: Mode-derived coverage gate (Phase 5)
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [dvx101]
branch: feat/dev-dvx104
---

## Goal

Make `/devx` Phase 5 coverage gate explicitly mode-derived: YOLO informational; BETA warn <80%; PROD block <100% touched-line; LOCKDOWN block.

## Acceptance criteria

- [ ] `.claude/commands/devx.md` Phase 5 explicitly dispatches by mode (verbatim):
  - YOLO → informational only; never blocks merge.
  - BETA → warn if touched-surface coverage < 80% (still merges).
  - PROD → block if touched-surface coverage < 100% (line-level diff of changed files against coverage report).
  - LOCKDOWN → block if < 100% OR if a browser-QA pass hasn't run.
- [ ] Touched-surface computed from `git diff --name-only <integration-branch>..HEAD` (where `integration-branch` is `git.integration_branch ?? git.default_branch`).
- [ ] `# devx:no-coverage <reason>` line-level opt-out parsed from source files; opted-out lines excluded from the denominator.
- [ ] Tests cover all 4 modes × covered/uncovered touched lines × opt-out marker.
- [ ] Coverage source: `coverage:` runner output per `devx.config.yaml → projects[*].coverage`. No schema change.

## Technical notes

- This is mostly skill-body precision + a touched-surface coverage computation helper. The helper can be a simple TS function in `src/lib/devx/coverage-touched.ts` or inline; story implementer's call.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
