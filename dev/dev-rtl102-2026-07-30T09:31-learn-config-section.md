---
hash: rtl102
type: dev
created: 2026-07-30T09:31:00-06:00
title: "`learn:` config section (idle window, retro timeout, home)"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 2
status: ready
blocked_by: []
branch: feat/dev-rtl102
---

## Goal

The knobs the watcher reads — `idle_minutes`, `retro_timeout_minutes`,
`home` — as a typed, clamped config section, so the watcher phases consume a
merged, tested reader. Plan phase 2 of workstream retro-listener; parallel-
safe with rtl101 (no shared files).

## Acceptance criteria

- [ ] AC 1: `src/lib/learn/config.ts` exports `LearnConfig`,
      `LEARN_DEFAULTS` (`idleMinutes: 15`, `retroTimeoutMinutes: 360`,
      `home: ~/.claude/devx`), and total `learnConfigFrom(merged)` with
      per-field clamp/fallback (non-positive/non-finite → default), pattern
      of `loopConfigFrom` (`src/lib/loop/config.ts`).
- [ ] AC 2: `_devx/config-schema.json` gains the `learn:` properties block
      (`additionalProperties: false`); `devx.config.yaml` gains a commented
      `learn:` section with defaults.
- [ ] AC 3: Precedence documented and tested where consumed:
      `DEVX_LEARN_HOME` env > config `home` > default. The listener path
      never loads config (G-3) — only the watcher and install step do.
- [ ] AC 4: `test/learn-config.test.ts` green (defaults, clamping, garbage
      fallback, precedence); `npm run test:config-validate` green with the
      new section present.

## Status log

- 2026-07-30T09:31 — emitted by /devx-plan RED stage (workstream 620c74).

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 2
- Design: `_devx/workstreams/retro-listener/design.md` §Interfaces
