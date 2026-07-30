---
hash: rtl102
type: dev
created: 2026-07-30T09:31:00-06:00
title: "`learn:` config section (idle window, retro timeout, home)"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 2
status: in-progress
owner: /devx-loop-2026-07-30T16-02-29-879-60783
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
- 2026-07-30T10:58:48-06:00 — claimed by /devx in session /devx-loop-2026-07-30T16-02-29-879-60783
- 2026-07-30T17:14:29.094Z — loop iteration 1: Implemented the `learn:` config section for the retro watcher — `src/lib/learn/config.ts` (typed defaults, total per-key fallback reader, `DEVX_LEARN_HOME` > config > default home resolution), plus schema, yaml, fixture, docs, and a 186-line test file — with the full `npm test` verification run still unlanded.
  - Change: Added `src/lib/learn/config.ts`: `LearnConfig` type, `LEARN_DEFAULTS` (idleMinutes 15, retroTimeoutMinutes 360, home `~/.claude/devx`), total `learnConfigFrom(merged)` that degrades per-key to defaults on any garbage input shape (missing block, array, scalar, non-finite or non-positive numbers, blank strings), following the `loopConfigFrom` pattern (AC 1).
  - Change: Added `resolveLearnHome(merged, env)` implementing the documented precedence `DEVX_LEARN_HOME` > config `learn.home` > `~/.claude/devx`, delegating the env arm verbatim to `learnHome` from `src/lib/learn/queue.ts` so the watcher and the config-free listener resolve to the same directory; `~`/`~/` expansion handled on the config and default arms only, `~user` left untouched (AC 3).
  - Change: Extended `_devx/config-schema.json` with an `additionalProperties: false` `learn:` properties block, added a commented `learn:` section with defaults to `devx.config.yaml`, and mirrored the section into `test/fixtures/sample-config-full.yaml` (AC 2).
  - Change: Documented the `learn:` knobs and the home-resolution precedence in `docs/CONFIG.md`, including the G-3 constraint that the listener path never loads config (AC 3).
  - Change: Added `test/learn-config.test.ts` (186 lines) covering defaults, per-key clamping, garbage-input fallback, and env/config/default precedence (AC 4, run not yet confirmed end-to-end).
  - Learning: The listener and the watcher need two different home resolvers by design (G-3: the listener runs at every turn end under a <500ms p95 budget and must not load config), and the only safe way to keep them pointing at the same queue directory is to have the watcher's resolver delegate its env arm verbatim to the listener's `learnHome` rather than re-implement the same precedence.
  - Learning: A raw `~` inside `DEVX_LEARN_HOME` must deliberately NOT be tilde-expanded — a shell expands it before the process sees it, so any surviving literal `~` is an explicit operator choice, and rewriting it would silently diverge from the listener's behavior.
  - Learning: Zero is not a benign value for either minutes knob: `idle_minutes: 0` makes every session read as 'always idle' and `retro_timeout_minutes: 0` retires every retro instantly, so the clamp rejects non-positive as well as non-finite; fractional minutes are kept legal because sub-minute windows are genuinely useful in tests.
  - Learning: The full `npm test` chain here (schema smoke → config-io → config-validate → build → typecheck → vitest) runs well past 10 minutes in this worktree, so the verification tail needs its own iteration budget rather than being tacked onto the end of an implementation pass.

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 2
- Design: `_devx/workstreams/retro-listener/design.md` §Interfaces
