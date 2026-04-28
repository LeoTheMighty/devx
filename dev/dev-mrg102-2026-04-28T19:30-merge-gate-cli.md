---
hash: mrg102
type: dev
created: 2026-04-28T19:30:00-07:00
title: devx merge-gate <hash> CLI passthrough + /devx Phase 8 integration
from: _bmad-output/planning-artifacts/epic-merge-gate-modes.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-04-28T22:30
blocked_by: [mrg101]
branch: feat/dev-mrg102
---

## Goal

Expose `mergeGateFor()` via `devx merge-gate <hash>` CLI; wire `/devx` Phase 8 to invoke it instead of inlining mode logic. Removes the "Behavior by mode" table from the skill body.

## Acceptance criteria

- [x] `src/commands/merge-gate.ts` registers `devx merge-gate <hash>`. Reads spec at `dev/dev-<hash>-*.md`; reads `devx.config.yaml`; collects live signals via `gh pr view <#>` + `gh pr list --head <branch>`; calls `mergeGateFor()`; prints JSON decision.
- [x] Exit 0 on `merge:true`; exit 1 on `merge:false`; exit 2 on `no PR yet` (frontmatter has no `pr:` AND `gh pr list` is empty) or `gh signal collection failed`.
- [x] Coverage signal sourced from `--coverage <pct>` (caller-injected) when `devx.config.yaml → coverage.enabled: true`; forced `null` otherwise. Touched-line wiring deferred to dvx104 per epic technical notes.
- [x] `.claude/commands/devx.md` Phase 8 invokes `devx merge-gate <hash>` as the first auto-merge step. The "Behavior by mode" table is REMOVED.
- [x] Test fixtures: golden spec + config + mocked `gh` outputs → expected JSON decision per mode (12 per-mode rows).
- [x] `src/lib/help.ts` (via attachPhase) shows `devx merge-gate` as Phase 1 real command (no stub annotation).

## Technical notes

- Skill body becomes thinner; logic lives in TS only.
- Same "skill calls helper via CLI passthrough" pattern as epic-devx-plan-skill (pln101).

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-04-28T22:30 — claimed by /devx (session 2026-04-28T22:30); branch feat/dev-mrg102 off main
- 2026-04-28T22:45 — implemented `src/commands/merge-gate.ts` (CLI passthrough), wired into `src/cli.ts`, rewrote Phase 8 of `.claude/commands/devx.md` to call `devx merge-gate <hash>` (table removed). Added `test/merge-gate-cli.test.ts` (30 tests across helpers + arg validation + spec/PR resolution + per-mode decisions). Updated `test/help.test.ts` snapshot for the new Phase-1 row. All 7 ACs green; npm test passes 485/485 (455 prior + 30 new). Self-review caught 1 dead helper (coopOverrideOK), 1 too-loose hash regex, 1 sloppy test name, and 1 prod-only ENOENT path that would have surfaced as misleading "no PR yet" — all fixed.
- 2026-04-28T22:55 — merged via PR #32 (squash → dc86eb7); remote CI green (run 25067162468). Dogfooded the new CLI against this very PR before merging — `devx merge-gate mrg102` returned `{"merge":true}` exit 0, then `gh pr merge 32 --squash --delete-branch` succeeded (the worktree-side branch-delete error is the documented `feedback_gh_pr_merge_in_worktree.md` pattern; remote merge confirmed via `gh pr view`).
