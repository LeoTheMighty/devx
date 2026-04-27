---
hash: cfg204
type: dev
created: 2026-04-26T19:35:00-07:00
title: `devx config <key>` get/set CLI
from: _bmad-output/planning-artifacts/epic-config-schema.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: in-progress
blocked_by: [cfg202, cfg203, cli301]
branch: feat/dev-cfg204
owner: /devx
---

## Goal

Implement `src/commands/config.ts` registering the `devx config` command (and its `get`/`set` subcommands + shorthands) on the root commander instance. This is the only real-functional command in Phase 0.

## Acceptance criteria

- [ ] `devx config get <key>` and `devx config <key>` print merged value to stdout (newline-terminated); exits 0
- [ ] `devx config set <key> <value>` and `devx config <key> <value>` write to project file
- [ ] `--user` flag writes to `~/.devx/config.yaml` instead
- [ ] Dotted paths supported: `capacity.daily_spend_cap_usd`, `notifications.events.ci_failed`
- [ ] Setting a value out-of-enum aborts before write with the error from cfg203
- [ ] Setting a value at a non-leaf path aborts with the cfg202 error message
- [ ] `devx config` (no args) prints usage to stderr; exits 0 (not 64 — Phase 0 stub policy applies even though config is real)
- [ ] Vitest covers: hand-edited YAML round-trip, dotted-path get + set, --user flag, enum rejection, unknown-key write (still allowed — sets the value, logs warning)

## Technical notes

- Reuse `loadMerged()` for reads, `setLeaf()` for writes (cfg202).
- Type-coerce stringified inputs against the schema (e.g., `"50"` → `50` for an int field).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T21:00 — claimed by /devx; branch feat/dev-cfg204 off main (single-branch YOLO; spec frontmatter said develop/dev-cfg204 which is stale, corrected here).
