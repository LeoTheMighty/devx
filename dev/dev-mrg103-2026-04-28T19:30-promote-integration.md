---
hash: mrg103
type: dev
created: 2026-04-28T19:30:00-07:00
title: Develop->main promotion code path (latent / dead-code-until-split-branch)
from: _bmad-output/planning-artifacts/epic-merge-gate-modes.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
owner: /devx-2026-04-28T23:00
blocked_by: [mrg101]
branch: feat/dev-mrg103
---

## Goal

Ship `src/lib/manage/promote.ts → promoteIntegrationToDefault(mode, signals)` as the dead-code-until-needed wrapper that future split-branch users get for free. Same gate primitive, different consumption site.

## Acceptance criteria

- [ ] `src/lib/manage/promote.ts` exports `promoteIntegrationToDefault(mode, signals): Promise<{promoted, reason}>`.
- [ ] Implementation: call `mergeGateFor(mode, signals)`; if `merge:true`, call `gh api repos/<owner>/<repo>/merges` (POST `{base:"main", head:"develop"}`); return `{promoted, reason}`.
- [ ] File header comment block declares: "DEAD CODE in self-host (single-branch). Exercised only when `git.integration_branch != null`."
- [ ] `test/promote-integration.test.ts` covers: gate-says-merge → API called; gate-says-no-merge → API not called; LOCKDOWN → not called; trust-gradient block → not called.
- [ ] Not registered as a CLI subcommand. Not called from `/devx-manage` v0. Importable for future use.

## Technical notes

- One file + one test file. Cost is small; value is zero-rework when split-branch users arrive.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-04-28T23:00 — claimed by /devx (session 2026-04-28T23:00); branch feat/dev-mrg103 off main
