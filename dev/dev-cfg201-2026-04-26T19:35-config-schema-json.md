---
hash: cfg201
type: dev
created: 2026-04-26T19:35:00-07:00
title: JSON schema for all 15 sections of devx.config.yaml
from: _bmad-output/planning-artifacts/epic-config-schema.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
branch: develop/dev-cfg201
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
