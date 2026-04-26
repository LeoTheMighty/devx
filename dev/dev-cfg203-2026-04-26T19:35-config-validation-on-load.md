---
hash: cfg203
type: dev
created: 2026-04-26T19:35:00-07:00
title: Config validation on load
from: _bmad-output/planning-artifacts/epic-config-schema.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
blocked_by: [cfg201, cfg202]
branch: develop/dev-cfg203
---

## Goal

Implement `src/lib/config-validate.ts` that validates a parsed config against `_devx/config-schema.json`. Unknown keys = warning (non-fatal); missing required keys (`mode`, `project.shape`) = fatal abort with pointer to `/devx-init`.

## Acceptance criteria

- [ ] Unknown keys → `console.warn` with key path + "unknown — your devx may be older than this config"
- [ ] Missing required key → throws `ConfigError` with message `devx.config.yaml missing required key: <key> — run /devx-init to repair`
- [ ] Out-of-enum value → throws `ConfigError` with allowed values listed
- [ ] No `devx.config.yaml` at all → throws `ConfigError` with message `no devx.config.yaml — run /devx-init`
- [ ] Validation result wrapped in a typed `Result<Config, ConfigError>` (or thrown as `ConfigError` — pick one pattern + document it)
- [ ] Vitest covers: happy path, unknown-key warning, missing-required, out-of-enum, no-file, corrupt-YAML
- [ ] Fixture `test/fixtures/corrupt-missing-mode.yaml` for the missing-required path

## Technical notes

- Use `ajv` for schema validation.
- Validation is called from every devx command's entry path; keep it cheap (parse once + cache per process).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
