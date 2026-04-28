---
hash: pln105
type: dev
created: 2026-04-28T19:30:00-07:00
title: Phase 6.5 mode gate is structurally explicit
from: _bmad-output/planning-artifacts/epic-devx-plan-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [pln103]
branch: feat/dev-pln105
---

## Goal

Make `/devx-plan` Phase 6.5 (focus-group) a structurally explicit predicate: `IF mode == YOLO THEN skip ELSE run`. No prose ambiguity; both branches exercised with fixture tests.

## Acceptance criteria

- [ ] `.claude/commands/devx-plan.md` Phase 6.5 opens with explicit predicate (verbatim): `IF mode == "YOLO" THEN skip-with-one-line-summary ELSE run-focus-group-per-epic`.
- [ ] YOLO branch: final summary contains `Phase 6.5 (Focus-group): skipped — mode is YOLO per devx.config.yaml.` No session files written.
- [ ] BETA branch: focus-group consulted per epic via `focus-group/prompts/new-feature-reaction.md`; sessions written to `focus-group/sessions/session-<date>-<epic-slug>-reaction.md`; cross-referenced from each epic file's "Focus-group reactions" section.
- [ ] PROD branch: BETA + binding-check. Critical shared concern across ≥2 personas requires user acknowledgment via INTERVIEW filing before Phase 7.
- [ ] LOCKDOWN: focus-group is mandatory for non-trivial-scope epics (mirrors LOCKDOWN's general "ask user about everything"). One-line override allowed via `devx.config.yaml → focus_group.binding: false` for emergencies.
- [ ] Tests: `plan-mode-gate.test.ts` exercises YOLO branch (no session file written) AND BETA branch (session file written). PROD acknowledgment branch covered with fixture INTERVIEW filing.

## Technical notes

- Mode-gate logic itself is in the skill body (LLM follows the predicate); helper exists only to verify the predicate's outputs match for fixtures.
- Skipped focus-group does NOT mean Phase 7 (readiness) is skipped.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
