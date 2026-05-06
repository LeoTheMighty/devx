---
hash: dvx104
type: dev
created: 2026-04-28T19:30:00-07:00
title: Mode-derived coverage gate (Phase 5)
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
owner: /devx-2026-05-06T1058-95926
blocked_by: [dvx101]
branch: feat/dev-dvx104
---

## Goal

Make `/devx` Phase 5 coverage gate explicitly mode-derived: YOLO informational; BETA warn <80%; PROD block <100% touched-line; LOCKDOWN block.

## Acceptance criteria

- [x] `.claude/commands/devx.md` Phase 5 explicitly dispatches by mode (verbatim):
  - YOLO → informational only; never blocks merge.
  - BETA → warn if touched-surface coverage < 80% (still merges).
  - PROD → block if touched-surface coverage < 100% (line-level diff of changed files against coverage report).
  - LOCKDOWN → block if < 100% OR if a browser-QA pass hasn't run.
- [x] Touched-surface computed from `git diff --name-only <integration-branch>..HEAD` (where `integration-branch` is `git.integration_branch ?? git.default_branch`).
- [x] `# devx:no-coverage <reason>` line-level opt-out parsed from source files; opted-out lines excluded from the denominator.
- [x] Tests cover all 4 modes × covered/uncovered touched lines × opt-out marker.
- [x] Coverage source: `coverage:` runner output per `devx.config.yaml → projects[*].coverage`. No schema change.

## Technical notes

- This is mostly skill-body precision + a touched-surface coverage computation helper. The helper can be a simple TS function in `src/lib/devx/coverage-touched.ts` or inline; story implementer's call.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-06T10:58:53-06:00 — claimed by /devx in session /devx-2026-05-06T1058-95926
- 2026-05-06 — phase 2: canary=off, shouldCreateStory=project_shape=empty-dream + 5 ACs + no story file → bmad-create-story INVOKED (canary=off; helper decision logged not honored)
- 2026-05-06 — phase 2: bmad-create-story SKIPPED in practice per CLAUDE.md "Working agreements" empirical pattern (spec ACs are the working artifact; cross-epic LEARN-tracked drift remains user-review-required for skills)
- 2026-05-06 — phase 3: implemented src/lib/devx/coverage-touched.ts (pure mode dispatch + opt-out marker parser; mirrors merge-gate.ts no-I/O shape) + test/coverage-touched.test.ts (54 tests covering 4 modes × covered/uncovered touched lines × opt-out marker per AC #4) + .claude/commands/devx.md Phase 5 step 1 (touched-surface integration-branch dynamic resolution per AC #2) + Phase 5 step 4 (verbatim mode dispatch per AC #1, opt-out semantics per AC #3, coverage source per AC #5). 54/54 green in isolation. AC1+AC2+AC3+AC4+AC5 satisfied.
- 2026-05-06 — phase 4: 1-agent single-pass adversarial review (per LEARN.md threshold heuristic — coverage-touched.ts core is 211 LoC; tests are mostly fixture builders + asserts; one critical regex (`parseOptOutMarkers` boundary) traced through every adversarial input case in the prose review); 1 finding (0 HIGH, 0 MED, 1 LOW); ALL fixed in-place — LOW: skill-body Phase 5 step 1 used the editorial word "regression" for the would-have-been-bug-on-first-ship of hardcoded `develop`; reworded to imperative "MUST resolve dynamically; a hardcoded `develop` produces an empty diff on every single-branch /devx run" so the prose reads as a contract not a self-narrated history note; re-review clean.
- 2026-05-06 — phase 5: local CI green — npm test → 915/915 passing in 23.4s (+54 net tests for dvx104: 4 modes × covered/uncovered × opt-out cartesian + parseOptOutMarkers edge cases + validation); npm run typecheck clean; package-lock.json `hasInstallScript: true` metadata flip from worktree `npm install` reverted (irrelevant to spec).
