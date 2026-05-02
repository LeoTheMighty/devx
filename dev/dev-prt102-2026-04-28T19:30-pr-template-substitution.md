---
hash: prt102
type: dev
created: 2026-04-28T19:30:00-07:00
title: /devx Phase 7 reads template + substitutes mode + spec path
from: _bmad-output/planning-artifacts/epic-pr-template.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
blocked_by: [prt101]
branch: feat/dev-prt102
owner: /devx
---

## Goal

Wire `/devx` Phase 7 PR-open step to read the template (or built-in fallback) and substitute the mode + spec path + AC checklist before calling `gh pr create --body`.

## Acceptance criteria

- [ ] `.claude/commands/devx.md` Phase 7 explicitly reads `.github/pull_request_template.md` when present; uses hardcoded built-in default matching canonical template when absent.
- [ ] Substitutes `<!-- devx:auto:mode -->` with `devx.config.yaml → mode` (uppercase: YOLO/BETA/PROD/LOCKDOWN).
- [ ] Substitutes `<dev/dev-<hash>-<ts>-<slug>.md>` with the actual spec path.
- [ ] Substitutes `<checkbox list copied from spec>` with the AC list from spec frontmatter (each `- [ ]` line).
- [ ] First non-empty body line of the rendered output is the `**Spec:**` line — verified via integration test that opens a real PR via `gh` against fixture repo and reads back via `gh pr view`.
- [ ] Skill-body substitution unit test (`devx-pr-body-substitution.test.ts`): given fixture template + config + spec, asserts rendered output matches a golden file.

## Technical notes

- Substitution is plain `String.prototype.replaceAll` — no template-engine dependency.
- Falls back gracefully if `.github/pull_request_template.md` is absent (older repos before prt101 ran).

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-02T — claimed by /devx; status flipped to in-progress; pushing claim commit to origin/main before opening PR (per `feedback_devx_push_claim_before_pr.md`).
