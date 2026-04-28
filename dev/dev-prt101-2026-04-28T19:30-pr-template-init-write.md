---
hash: prt101
type: dev
created: 2026-04-28T19:30:00-07:00
title: Template ships + /devx-init writes it idempotently
from: _bmad-output/planning-artifacts/epic-pr-template.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
branch: feat/dev-prt101
---

## Goal

Add canonical `pull_request_template.md` text under `_devx/templates/`; extend `/devx-init`'s init-write step to write it to `.github/pull_request_template.md` idempotently (skip-with-marker / append-without-marker / write-fresh).

## Acceptance criteria

- [ ] `_devx/templates/pull_request_template.md` exists with the canonical content from `epic-pr-template.md` § "Infrastructure changes". Verified via snapshot test.
- [ ] `package.json → files` includes `_devx/templates` (already does — verify, no change needed).
- [ ] `src/lib/init-write.ts` exports `writePrTemplate(repoRoot, opts?: {dryRun?})`. Three branches:
  - File absent → write canonical → `{action:"wrote"}`.
  - File present + contains `<!-- devx:mode -->` → skip → `{action:"skipped"}`.
  - File present + no marker → append `## devx` section under marker → `{action:"appended"}`.
- [ ] `init-orchestrator.ts` calls `writePrTemplate()` after the existing CLAUDE.md write step.
- [ ] Tests: `init-pr-template-fresh.test.ts`, `init-pr-template-with-marker.test.ts`, `init-pr-template-without-marker.test.ts`.
- [ ] Idempotence test: run `writePrTemplate()` twice; second call returns `{action:"skipped"}` and produces no diff.

## Technical notes

- Reuse the LEARN.md cross-epic "idempotency state file pattern" mental model (no SHA-256 needed here; marker-based detection is sufficient).
- Existing user content is sacrosanct (LEARN.md cross-epic "MANUAL.md as designed signal" — same principle: never overwrite hand-edited).

## Status log

- 2026-04-28T19:30 — created by /devx-plan
