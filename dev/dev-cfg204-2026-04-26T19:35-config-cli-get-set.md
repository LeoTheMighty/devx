---
hash: cfg204
type: dev
created: 2026-04-26T19:35:00-07:00
title: `devx config <key>` get/set CLI
from: _bmad-output/planning-artifacts/epic-config-schema.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
blocked_by: [cfg202, cfg203, cli301]
branch: feat/dev-cfg204
owner: /devx
---

## Goal

Implement `src/commands/config.ts` registering the `devx config` command (and its `get`/`set` subcommands + shorthands) on the root commander instance. This is the only real-functional command in Phase 0.

## Acceptance criteria

- [x] `devx config get <key>` and `devx config <key>` print merged value to stdout (newline-terminated); exits 0
- [x] `devx config set <key> <value>` and `devx config <key> <value>` write to project file
- [x] `--user` flag writes to `~/.devx/config.yaml` instead
- [x] Dotted paths supported: `capacity.daily_spend_cap_usd`, `notifications.events.ci_failed`
- [x] Setting a value out-of-enum aborts before write with the error from cfg203
- [x] Setting a value at a non-leaf path aborts with the cfg202 error message
- [x] `devx config` (no args) prints usage to stderr; exits 0 (not 64 — Phase 0 stub policy applies even though config is real)
- [x] Vitest covers: hand-edited YAML round-trip, dotted-path get + set, --user flag, enum rejection, unknown-key write (still allowed — sets the value, logs warning)

## Technical notes

- Reuse `loadMerged()` for reads, `setLeaf()` for writes (cfg202).
- Type-coerce stringified inputs against the schema (e.g., `"50"` → `50` for an int field).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T21:00 — claimed by /devx; branch feat/dev-cfg204 off main (single-branch YOLO; spec frontmatter said develop/dev-cfg204 which is stale, corrected here).
- 2026-04-26T21:30 — implemented src/commands/config.ts + wired into src/cli.ts; 35-test vitest suite covering all ACs (round-trip, dotted-path get/set, --user flag, enum rejection, non-leaf rejection, unknown-key write+warning, type coercion). Local gates: typecheck clean, npm test 40/40 PASS (5 cli.test + 35 config-command.test), schema-smoke + cfg202/cfg203 tsx suites still green.
- 2026-04-26T21:30 — self-review (edge-case-hunter) found 12 findings; addressed the 5 actionable ones: (1) suppressed spurious "unknown key" warning when no schema file is on disk; (2) friendly error on corrupt schema JSON; (3) reject array-element writes (numeric segment into existing Seq) up front to avoid eemeli/yaml setIn silently writing a stringly-keyed phantom on a Seq; (4) widened number coercion regex to accept '.5' and '5.'; (5) `--user` on a get now warns that the flag is ignored on reads. Tests added for all five.
- 2026-04-26T21:30 — no remote CI workflow detected — local gates are authoritative; PR opened: https://github.com/LeoTheMighty/devx/pull/8.
- 2026-04-26T21:35 — merged via PR #8 (squash → 1ba275f).
