---
hash: mrg102
type: dev
created: 2026-04-28T19:30:00-07:00
title: devx merge-gate <hash> CLI passthrough + /devx Phase 8 integration
from: _bmad-output/planning-artifacts/epic-merge-gate-modes.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [mrg101]
branch: feat/dev-mrg102
---

## Goal

Expose `mergeGateFor()` via `devx merge-gate <hash>` CLI; wire `/devx` Phase 8 to invoke it instead of inlining mode logic. Removes the "Behavior by mode" table from the skill body.

## Acceptance criteria

- [ ] `src/commands/merge-gate.ts` registers `devx merge-gate <hash>`. Reads spec at `dev/dev-<hash>-*.md`; reads `devx.config.yaml`; collects live signals via `gh pr view <#>` + `gh pr checks <#>`; calls `mergeGateFor()`; prints JSON decision.
- [ ] Exit 0 on `merge:true`; exit 1 on `merge:false`; exit 2 on `no PR yet` (spec frontmatter has no PR link).
- [ ] Coverage signal sourced from `coverage` runner output if `devx.config.yaml → coverage.enabled` is true; else `null`.
- [ ] `.claude/commands/devx.md` Phase 8 invokes `devx merge-gate <hash>` as the first auto-merge step. The "Behavior by mode" table is REMOVED from the skill body.
- [ ] Test fixtures: golden spec + config + mocked `gh` outputs → expected JSON decision per mode.
- [ ] `src/lib/help.ts` shows `devx merge-gate` as Phase 1 real command (no stub annotation).

## Technical notes

- Skill body becomes thinner; logic lives in TS only.
- Same "skill calls helper via CLI passthrough" pattern as epic-devx-plan-skill (pln101).

## Status log

- 2026-04-28T19:30 — created by /devx-plan
