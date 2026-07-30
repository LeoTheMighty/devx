---
hash: rtl104
type: dev
created: 2026-07-30T09:31:00-06:00
title: "Watcher CLI — spawn arms, drain loop, `devx learn-watch`"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 4
status: in-progress
owner: /devx-loop-2026-07-30T16-02-29-879-60783
blocked_by: [rtl102, rtl103]
branch: feat/dev-rtl104
---

## Goal

The genuinely new mechanism — tmux/Terminal spawn with the trap wrapper —
plus the serial drain loop and the `devx learn-watch` CLI surface, composing
rtl103's pure core. Plan phase 4 of workstream retro-listener; RED artifacts
`evals/E-5`, `E-9`, and the phase-4 half of `E-4` define the contract and
must flip green.

## Acceptance criteria

- [ ] AC 1: `src/lib/learn/spawn.ts` exports session-id validation
      (UUID-shaped regex, rejects shell metacharacters BEFORE any
      argv/command construction — mgr104 discipline),
      `buildWrapperCommand(sid, cwd, markerPath)` (tmp+rename marker
      write; `trap 'rc=$?; …' HUP INT TERM` with NO EXIT trap and the trap
      READING `$?`; `cd` guard → `error-cd`; `DEVX_RETRO=1 claude --resume
      <sid> --fork-session "/devx-learn"`; trailing status write), and
      `selectSpawnArm` (`$TMUX` → tmux; darwin → Terminal.app via
      `osascript` with the reference's backslash+quote escaping; else
      `manual`) behind a `SpawnFn`-style seam.
- [ ] AC 2: Drain loop in `src/lib/learn/watch.ts` (`drainPass`/driver, not
      the command file — `runLoop`/`src/lib/loop/driver.ts` precedent):
      singleton claim (skipped under `--dry-run`; held → exit 1 naming the
      lock), per-run seen-set, once-per-session status notes, `awaitMarker`
      bounded by `retro_timeout_minutes`; poll intervals (5s scan, 2s
      marker) injectable. The `manual` arm prints the command and files
      `manual` immediately — `awaitMarker` is NEVER entered for it.
- [ ] AC 3: `src/commands/learn-watch.ts` thin wiring — flag parsing,
      `register(program)` + `attachPhase`, `list` (pending + readiness
      state, last processed + outcomes) and `requeue <sid>` subcommands,
      exit codes 0 SIGINT-clean / 1 lock-or-miss / 2 usage, line-buffered
      output; registered in `src/cli.ts`.
- [ ] AC 4: `--dry-run` changes nothing by construction: print-only spawn,
      seen-set instead of `finish`, no marker/done-log/queue writes, not
      refused by a held singleton lock.
- [ ] AC 5: `test/learn-watch.test.ts` extended green (singleton refusal,
      wrapper trap shape + guard export for all 3 arms, dry-run
      byte-compare + under-lock, `manual` immediate filing, osascript
      escaping, `list` output shape, drain sequencing via fake spawn seam);
      `test/help.test.ts` snapshot refreshed; evals `E-4`, `E-5`, `E-9`
      exit 0.
- [ ] AC 6: Human smoke recorded in this spec's status log: `--dry-run`
      prints the expected command for a fake queue entry; then one real
      spawn of a trivial session on this machine (tmux arm and Terminal
      arm).
- [ ] AC 7: `docs/SELF_HEALING.md` gains a short "retro listener" section:
      running the watcher, outcome vocabulary, requeue.

## Technical notes

- The spawned process is not our child — completion only via the marker;
  SIGKILL degrades to `timeout` + requeue hint. Trap semantics reviewed
  against `reference/harness-learn-watch` `wrapper_command`/`spawn`
  docstrings (SIGHUP wedge, EXIT-trap race, absorbed Ctrl-C).

## Status log

- 2026-07-30T09:31 — emitted by /devx-plan RED stage (workstream 620c74).
- 2026-07-30T12:12:57-06:00 — claimed by /devx in session /devx-loop-2026-07-30T16-02-29-879-60783

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 4
- Design: `_devx/workstreams/retro-listener/design.md` §Architecture (Spawn)
