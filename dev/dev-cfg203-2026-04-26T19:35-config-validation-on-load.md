---
hash: cfg203
type: dev
created: 2026-04-26T19:35:00-07:00
title: Config validation on load
from: _bmad-output/planning-artifacts/epic-config-schema.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
blocked_by: [cfg201, cfg202]
branch: feat/dev-cfg203
owner: /devx
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
- 2026-04-26T20:30 — claimed by /devx (single-branch YOLO; branch feat/dev-cfg203 off main)
- 2026-04-26T20:45 — implemented src/lib/config-validate.ts + test/config-validate.test.ts + corrupt-missing-mode fixture; npm test green (32 PASS); typecheck clean
- 2026-04-26T20:45 — self-review pass: tightened cache key to (projectPath, userPath); cleaned addFormats import; documented additionalProperties walk limitation
- 2026-04-26T20:45 — no remote CI workflow detected — local gates are authoritative
- 2026-04-26T20:51 — merged via PR #6 (squash → b00ef2e)
