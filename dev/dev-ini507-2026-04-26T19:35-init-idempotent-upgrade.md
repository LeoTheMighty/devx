---
hash: ini507
type: dev
created: 2026-04-26T19:35:00-07:00
title: Idempotent upgrade-mode re-run
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
blocked_by: [ini502, ini503, ini504, ini505]
branch: feat/dev-ini507
owner: /devx
---

## Goal

Implement `src/lib/init-upgrade.ts` — detects `devx_version` in existing `devx.config.yaml`, computes delta against current package version, only prompts for delta keys, prints "kept N / added M / migrated K" summary at end.

## Acceptance criteria

- [ ] Detects `devx_version` field in existing `devx.config.yaml`; missing → corrupt path (halt + ask)
- [ ] Compares to current package version; computes delta (which sections / keys are new)
- [ ] Only prompts for delta keys; reuses existing values for unchanged keys
- [ ] Final summary: `kept N / added M / migrated K` (one line, terse, leonid voice)
- [ ] Detects + repairs missing surfaces:
  - missing CLAUDE.md devx-block markers → re-add
  - missing supervisor units → invoke `installSupervisor()`
  - missing CI workflow → re-write
  - missing PR template → re-write
  - missing personas → invoke `init-personas.ts` if dir empty
  - missing INTERVIEW seeding → invoke `init-interview.ts` if file empty
- [ ] Vitest covers: same-version (no-op) / version-bump-with-new-key (one prompt) / missing-supervisor (auto-repair) / missing-CI (auto-repair) / corrupt-config (halt)

## Technical notes

- Migrations are versioned: `_devx/migrations/<from-version>-<to-version>.ts` with a default `apply(config)` export.
- Skip migrations whose `from-version` < installed `devx_version`.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-27T claimed by /devx (ini507 — init-upgrade.ts implementation)
- 2026-04-27T merged via PR #28 (squash → 20b126d)
