---
hash: ini508
type: dev
created: 2026-04-26T19:35:00-07:00
title: End-to-end integration test
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
blocked_by: [ini506, ini507]
branch: develop/dev-ini508
---

## Goal

End-to-end integration test of `/devx-init` against three fixture repos: `empty/`, `existing-no-ci/`, `partial-on-devx/`. Verifies all PRD addendum FR-A through FR-N criteria. Validates idempotent re-run.

## Acceptance criteria

- [ ] Three fixture repos under `test/fixtures/repos/`:
  - `empty/` — fresh, no commits, no remote
  - `existing-no-ci/` — repo with commits + tests, no `.github/`
  - `partial-on-devx/` — repo where init aborted mid-way (has partial `devx.config.yaml`, missing supervisor)
- [ ] For each fixture: run full `/devx-init` skill with scripted answers; assert all PRD FR-A through FR-N criteria met
- [ ] `empty` completes in < 30s wall-clock (excluding user-prompt simulation)
- [ ] Idempotent rerun against same fixture is a sub-second no-op (or "kept N / added 0 / migrated 0")
- [ ] OS-specific tests (supervisor verification) gated to host platform
- [ ] CI matrix runs cross-platform on macos-latest + ubuntu-latest
- [ ] Failure-mode tests run in addition: BMAD-fail / gh-not-auth / no-remote (mocked)
- [ ] All 5 epic milestones (M-A0.1 through M-A0.5) verified end-to-end

## Technical notes

- Use a scripted-answers harness that pipes responses into `/devx-init`'s stdin; mocks `gh` calls via a local `gh` shim.
- Phase 0 acceptance criteria from `plan-a01000.md`:
  - `/devx-init` on empty repo → all 8 backlog files, devx.config.yaml, .devx-cache/, .gitignore, CLAUDE.md seed
  - LaunchAgent / systemd unit installed + survives login
  - `devx config mode` reads + writes round-trip
  - `bmad-audit.md` committed at `_bmad-output/planning-artifacts/`
- All four are validated by this test.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
