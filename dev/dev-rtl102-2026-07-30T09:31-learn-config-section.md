---
hash: rtl102
type: dev
created: 2026-07-30T09:31:00-06:00
title: "`learn:` config section (idle window, retro timeout, home)"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 2
status: done
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
- 2026-07-30T17:32:10.568Z — loop iteration 2: Ran the full npm test chain to completion (exit 0, 134 files / 2801 tests) verifying all four rtl102 ACs, and hardened the G-3 config-free-listener guard whose ban pattern missed the YAML loader and could pass vacuously.
  - Change: Verified the complete `npm test` chain end-to-end at exit 0 — schema-smoke and config-validate confirm the new `learn:` block validates in both devx.config.yaml and sample-config-full.yaml (AC 2), and test/learn-config.test.ts passes inside the full vitest run (AC 1, 3, 4).
  - Change: Hardened the G-3 structural guard in test/learn-config.test.ts: added `config-io` to the banned-import alternation (the YAML loader itself, and the likeliest accidental import on the listener path) and extended the pattern to cover dynamic `import("…")` alongside static `from "…"`.
  - Change: Added a positive-control test for that guard, pinning five import forms it must catch and two it must let by, so the 'must not match' assertions can no longer pass vacuously if the pattern is ever broken.
  - Learning: The full chain takes 936s (~15.6 min) in this worktree, and nearly all of it is one slow tail: the git-fixture suites (claim-contention, loop review-fix) run sequential clone/push/rebase fixtures with single tests taking 9–18s. The log goes quiet except for `warning: You appear to have cloned an empty repository.` for minutes at a stretch — that quiet is normal progress, not a hang; confirm liveness with a growing line count rather than a changing tail.
  - Learning: A `expect(src).not.toMatch(banned)` structural guard has an invisible failure mode: if the regex stops matching anything, every assertion still passes and the suite stays green while the guard protects nothing. Any not-toMatch guard needs a positive control asserting the pattern still catches known-bad input.
  - Learning: The original ban pattern anchored each alternative directly against `\.js"`, which silently excluded `../config-io.js` — the `./config` alternative only matches when `config` is immediately followed by `.js`, so any hyphenated sibling module slips through. Worth checking whenever a path-suffix regex is used as a guard.
- 2026-07-30T17:34:26.506Z — phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103
- 2026-07-30T17:34:26.506Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/105

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 2
- Design: `_devx/workstreams/retro-listener/design.md` §Interfaces
