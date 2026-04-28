---
hash: mrg103
type: dev
created: 2026-04-28T19:30:00-07:00
title: Develop->main promotion code path (latent / dead-code-until-split-branch)
from: _bmad-output/planning-artifacts/epic-merge-gate-modes.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-04-28T23:00
blocked_by: [mrg101]
branch: feat/dev-mrg103
---

## Goal

Ship `src/lib/manage/promote.ts → promoteIntegrationToDefault(mode, signals)` as the dead-code-until-needed wrapper that future split-branch users get for free. Same gate primitive, different consumption site.

## Acceptance criteria

- [x] `src/lib/manage/promote.ts` exports `promoteIntegrationToDefault(mode, signals): Promise<{promoted, reason}>`.
- [x] Implementation: call `mergeGateFor(mode, signals)`; if `merge:true`, call `gh api repos/<owner>/<repo>/merges` (`-X POST -f base=main -f head=develop`); return `{promoted, reason}`.
- [x] File header comment block declares: "DEAD CODE in self-host (single-branch). Exercised only when `git.integration_branch != null`."
- [x] `test/promote-integration.test.ts` covers: gate-says-merge → API called; gate-says-no-merge → API not called; LOCKDOWN → not called; trust-gradient block → not called. (Plus the full 4×2×2 mode/CI/trust matrix per the party-mode locked decision: 16 cells.)
- [x] Not registered as a CLI subcommand. Not called from `/devx-manage` v0. Importable for future use.

## Technical notes

- One file + one test file. Cost is small; value is zero-rework when split-branch users arrive.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-04-28T23:00 — claimed by /devx (session 2026-04-28T23:00); branch feat/dev-mrg103 off main
- 2026-04-28T23:10 — implemented `src/lib/manage/promote.ts` (~150 lines) + `test/promote-integration.test.ts` (31 tests: 4 success, 8 block, 16 from 4×2×2 matrix, 3 gh-failure). Self-review found nothing actionable (gate-first ordering correct, trust-gradient advice surfaced, gh api stderr fallback correct, ENOENT defended). Local CI: 516/516 (485 prior + 31 new); typecheck clean. All 5 ACs satisfied; file header carries the dead-code-until-split-branch declaration verbatim per AC#3.
- 2026-04-28T23:20 — merged via PR #33 (squash → 937624e); remote CI green (run 25067505207). First /devx run that consumed the new `devx merge-gate <hash>` CLI for the auto-merge decision (mrg102's deliverable) — exit 0 + `{"merge":true}` then `gh pr merge 33 --squash --delete-branch`. Closes 3/4 of epic-merge-gate-modes; only mrgret remains.
