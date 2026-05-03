---
hash: pln103
type: dev
created: 2026-04-28T19:30:00-07:00
title: devx plan-helper validate-emit cross-reference checker
from: _bmad-output/planning-artifacts/epic-devx-plan-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
blocked_by: [pln101, pln102]
branch: feat/dev-pln103
owner: /devx
---

## Goal

Ship `devx plan-helper validate-emit <epic-slug>` to check cross-references after Phase 5/6 emission. Aborts the planning run if invariants are violated; surfaces concrete file:line failures.

## Acceptance criteria

- [ ] `src/commands/plan-helper.ts` adds `validate-emit <epic-slug>` subcommand.
- [ ] Validations:
  - Every dev spec under `dev/dev-*` whose `from:` references the epic file exists on disk.
  - Every DEV.md row under the epic's section references an existing dev spec.
  - Every sprint-status story under the epic has a matching dev spec.
  - The retro story (`*ret`) has all three artifacts: dev spec, DEV.md row, sprint-status row.
  - Spec frontmatter `branch:` matches `deriveBranch()` output for current config.
  - Spec ACs do not contradict epic file's "Locked decisions" — flag conflicts with file paths + line numbers.
- [ ] Exit codes: 0 = clean; 1 = ≥1 failure (printed to stderr); 2 = epic file not found.
- [ ] `.claude/commands/devx-plan.md` Phase 6 (after party-mode rewrite) invokes `validate-emit <epic-slug>` for each epic; failures abort the planning run with stderr message preserved.

## Technical notes

- Validation is all filesystem reads + parsing — no `gh`, no LLM. Fast.
- `plan-validate-emit.test.ts` fixture: synthetic epic with intentionally-broken cross-references; assert each error is reported with the right file path.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-03T11:00 — claimed by /devx (epic-devx-plan-skill)
