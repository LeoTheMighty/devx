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
- 2026-07-30T18:36:19.517Z — loop iteration 1: Implemented src/lib/learn/spawn.ts (wrapper builder, session-id guard, arm selection, spawn seam) with 48 new test cases, flipping evals E-4 and E-9 green with the full suite at 2926 passing.
  - Change: AC 1 met: new src/lib/learn/spawn.ts — UUID-shaped session-id validation that refuses (not sanitizes) before any argv/command construction; buildWrapperCommand with tmp+rename marker write, `trap 'rc=$?; …' HUP INT TERM` reading $? with no EXIT trap, cd guard writing error-cd, and DEVX_RETRO=1 ahead of `claude --resume <sid> --fork-session "/devx-learn"`; selectSpawnArm ($TMUX → tmux, darwin → terminal, else manual); tmuxArgv/terminalArgv with the reference's backslash-then-quote AppleScript escaping; spawnRetro behind an injectable RunFn seam with print-only dry-run.
  - Change: Extended test/learn-watch.test.ts by 48 cases (76 → 124 in-file): validation matrix, trap-shape inventory, shell quoting, arm selection, AppleScript escape round-trip and unescaped-quote scan, and spawnRetro dry-run/manual/stale-marker/failure paths — plus a pair that actually executes the wrapper under `sh` with a stub `claude` on PATH and asserts the marker contents (3, 0, error-cd) and that no .tmp survives.
  - Change: Self-review fixes: per-arm stdio in the default run seam (osascript piped so its window-object echo can't interleave into the drain log; tmux inherits so its errors stay visible), a printed command on error-spawn so a failed spawn is recoverable, and re-anchoring the guard-ordering assertion on `claude --resume`.
  - Change: Evals E-4 (serial watcher contract) and E-9 (wrapper guard + trap shape) flipped RED → PASS; E-5 stays RED pending the drain loop.
  - Learning: spawn.ts's UUID-shaped guard is deliberately NARROWER than queue.ts's isSafeSessionId (which admits letters, `.` and `_` for filenames). So classifyEntry can return 'ok' for a hand-edited id like `abc_def` that spawnRetro then throws on — wedging the serial queue on the head entry across restarts. T4.3's drain MUST screen with isSpawnableSessionId too and file the difference as error-malformed; the obligation is written into spawnRetro's docstring.
  - Learning: E-9's `DEVX_RETRO=1` index-before-`claude` check only passes because the eval hardcodes a /tmp marker path — the real default learn home is `~/.claude/devx`, so the marker path contains the substring 'claude' before the guard on every real machine. Any assertion here must anchor on `claude --resume`, not on 'claude'.
  - Learning: The wrapper's marker write shells out to `mv`, so a test that replaces PATH with only a stub-bin directory produces no marker at all and reads exactly like a broken trap. Stub dirs must be prepended to PATH, not replace it.
  - Learning: AC 6 (human smoke: real tmux + Terminal spawn, recorded in the spec status log) is not reachable by this unattended loop — it needs a human at a terminal, and the loop orchestrator owns the status log. Later iterations should complete AC 1–5 + 7 and surface AC 6 as the human-owned remainder rather than burning budget on it.
  - Learning: A full `npm test` here is ~16 minutes wall-clock (135 files / 2926 tests, plus build + typecheck). Budget a whole iteration for it and poll the buffered output file rather than expecting streamed progress.
- 2026-07-30T18:47:33.746Z — loop iteration 2: Implemented the T4.3 drain loop in src/lib/learn/watch.ts (awaitMarker, drainPass, runWatch) with 36 new test cases, flipping eval E-5 green while E-3/E-4/E-9 stay green.
  - Change: AC 2 met: drain loop in watch.ts — drainPass serves the whole queue serially per pass (malformed screen → repo decision → spawn → marker → finish), runWatch claims the watcher singleton (skipped under --dry-run, released in finally) and carries per-run seen/noted sets across passes; awaitMarker is bounded by retro_timeout_minutes with an injectable 2s poll and a poll-count backstop so a non-advancing clock degrades to timeout instead of hanging. The manual arm retires immediately and never enters awaitMarker.
  - Change: AC 4 met at the library layer: --dry-run is non-destructive by construction — a single retire() write barrier is the only path to finish(), dry-run never calls recordRepoDecision, and it asks pickReady to treat unreviewed repos as servable so a first-run setup check doesn't report an empty queue.
  - Change: Closed iteration 1's wedge risk: the drain screens with isSpawnableSessionId in addition to classifyEntry, filing the difference (e.g. a hand-edited `abc_def`) as error-malformed instead of throwing on the head entry after every restart.
  - Change: Added `manual` to the Outcome union (FR-3 vocabulary; rtl103 had omitted it) and exported sleepSync from manage/lock.ts rather than duplicating the Atomics.wait incantation.
  - Change: Self-review fix: SIGINT arriving during a marker wait now leaves the entry pending with an explanatory log line, instead of writing a fabricated `timeout` row into the done log (the phase-2 evidence dataset).
  - Change: Extended test/learn-watch.test.ts by 36 cases (124 → 160): awaitMarker completion/bound/trim/interrupt/frozen-clock, dry-run byte-compare + under-held-lock + seen-set + unreviewed-repo visibility + recorded-deny, end-to-end serve with outcome mapping, serial ordering, manual/error-spawn no-await, malformed screens, skip-don't-starve, prompt-unanswerable downgrade, and runWatch singleton hold/release/refusal/dry-run-exempt/note-once/sleep-cadence.
  - Learning: E-5 calls drainPass twice with no shared seen-set and expects BOTH queued entries printed, and it never awaits the return value — so a 'pass' must be synchronous and must drain the entire queue (not one entry per scan). A per-entry pass would both fail E-5 and make a 4-deep backlog take 4 scan intervals.
  - Learning: In dry-run the pick must treat unreviewed repos as servable. pickReady(interactive:false) routes them to `unservable`, which under E-5's fresh tmpdir home (no repos.json) means nothing is ever picked and nothing printed — the setup check would show an empty queue exactly on the first run, when it is run.
  - Learning: test/learn-watch.test.ts contains a literal NUL byte in an rtl103 test string (line ~541, a marker-path escape case), so `file` reports it as `data` and plain grep silently finds nothing in it. Use `grep -a` on this file — a bare grep returning zero hits is a false negative, not evidence the symbol is absent.
  - Learning: spawnRetro's entry parameter had required session_id/cwd, which a QueueEntry (all-optional fields) can't satisfy; widening to optional was the right fix since both are `unknown` and asserted inside anyway — building a synthetic object in the drain would only have hidden the same two checks.

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 4
- Design: `_devx/workstreams/retro-listener/design.md` §Architecture (Spawn)
