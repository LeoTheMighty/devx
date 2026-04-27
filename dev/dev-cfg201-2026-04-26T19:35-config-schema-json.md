---
hash: cfg201
type: dev
created: 2026-04-26T19:35:00-07:00
title: JSON schema for all 15 sections of devx.config.yaml
from: _bmad-output/planning-artifacts/epic-config-schema.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx-2026-04-26-cfg201
branch: feat/dev-cfg201
---

## Goal

Author `_devx/config-schema.json` covering all 15 sections from `docs/CONFIG.md`. The schema ships embedded in the `@devx/cli` npm package (NOT under `_bmad/` per CONFIG.md's stale path). Validates required fields, enums, types, and value ranges.

## Acceptance criteria

- [ ] `_devx/config-schema.json` validates a complete sample `devx.config.yaml` that includes every section
- [ ] Required keys explicit: `mode`, `project.shape` are mandatory; everything else has defaults
- [ ] All enums correctly constrained: `mode`, `project.shape`, `thoroughness`, `promotion.gate`, `coverage.target`, `qa.layer_2_cadence`, `notifications.events.*` levels, `manager.os_supervisor`
- [ ] Numeric ranges enforced (e.g., `capacity.usage_cap_pct`: int 0-100; `manager.heartbeat_interval_s`: int ≥ 1)
- [ ] Schema rejects an invalid `mode` value with a useful error message via the validator
- [ ] Sample `devx.config.yaml` lives at `test/fixtures/sample-config-full.yaml` for round-trip + validation tests
- [ ] CONFIG.md path correction noted (covered in aud103 follow-up)

## Technical notes

- Use JSON Schema draft 2020-12.
- Pair with `ajv` (JavaScript validator) for runtime enforcement.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T23:50 — claimed by /devx in session devx-2026-04-26-cfg201; branch corrected to feat/dev-cfg201 (single-branch model per devx.config.yaml git.integration_branch=null).
- 2026-04-27T00:05 — `_devx/config-schema.json` (Draft 2020-12) authored covering all 15 sections: required `mode` + `project.shape` enums, all enum-constrained fields (mode, project.shape, thoroughness, promotion.gate, coverage.target, qa.layer_2_cadence, manager.os_supervisor, log_level, blast_radius_max, etc.), numeric ranges (usage_cap_pct 0-100, ports 1-65535, percentages 0-1), open-ended notification events with closed-enum levels, plus `stack`/`projects` mutex documented in description (cfg203 enforces). Sample fixture at `test/fixtures/sample-config-full.yaml` exercises every section. `test/schema-smoke.mjs` runs ajv-2020 against three cases: project root devx.config.yaml, full sample, invalid-mode rejection (asserts /mode enum error surfaces allowed values). Minimal repo-root `package.json` hosts ajv + ajv-formats + eemeli/yaml as devDependencies; `devx.config.yaml → projects[cli].test` rewired from echo placeholder to `npm test --silent`. Self-review fixed: dropped `not.required` mutex idiom (ajv-strict-incompatible), added project-config validation as third smoke check, simplified addFormats ESM-interop, symmetrized stack/projects mutex notes, dropped unused shebang.
- 2026-04-27T00:09 — PR #4 opened: https://github.com/LeoTheMighty/devx/pull/4 (target main, head feat/dev-cfg201, commit e0d7c4a). mergeStateStatus CLEAN; no required checks (CI workflow not yet wired by ini503). Squash-merged to main as cb73bc5. Worktree + remote/local branches removed. Status: done.
