---
hash: ini501
type: dev
created: 2026-04-26T19:35:00-07:00
title: 13-question flow + skip-table inference + state detection
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
blocked_by: [aud103, cli301]
branch: feat/dev-ini501
owner: /devx-2026-04-27
---

## Goal

Implement `src/lib/init-questions.ts` (13-question conversation in narrative order, skip-table inference) and `src/lib/init-state.ts` (repo state intake + halt-and-confirm prompts). No side-effects — output is the answers + the inferred config object.

## Acceptance criteria

- [ ] `init-questions.ts` implements N1–N13 in narrative order per PRD addendum FR-A
- [ ] Skip-table evaluator: for each question, check if a default can be inferred from repo state + user-config presence; skip if yes, ask if no
- [ ] `init-state.ts` detects:
  - empty repo (no commits)
  - existing repo (commits, no `devx.config.yaml`)
  - already-on-devx (has `devx_version: <semver>`)
  - corrupt-config (file exists, no version field)
  - uncommitted changes (`git status -s` non-empty)
  - non-default-branch HEAD
  - no remote
- [ ] Halt-and-confirm prompts:
  - uncommitted-changes → `[s]tash / [c]ommit-wip / [a]bort`
  - non-default-branch → `[y]switch / [n]proceed-from-here / [a]bort`
  - corrupt-config → halt with "halt — devx.config.yaml is corrupt; manual review required"
- [ ] Tested: best-case 3 questions, worst-case 13, mid-case 7 — all produce a complete config object
- [ ] No side-effects from this story — pure question/answer + inference

## Technical notes

- Conversation tone per persona-leonid voice. No marketing puffery.
- Echo-back: every freeform answer gets a one-line reflective echo. Mode/shape inferences confirmed before locking.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-27T00:00 — claimed by /devx in session devx-2026-04-27 (branch feat/dev-ini501; spec branch field bumped develop→feat per single-branch git config)
- 2026-04-27T00:30 — implementation pushed; PR #18 opened against main; 51 new tests, 250 total green locally
- 2026-04-27T00:40 — merged via PR #18 (squash → 3baf1a9); local + remote feat/dev-ini501 cleaned up
