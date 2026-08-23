---
hash: rtl104
type: dev
created: 2026-07-30T09:31:00-06:00
title: "Watcher CLI — spawn arms, drain loop, `devx learn-watch`"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
spawned: [9946f9]
plan: _devx/workstreams/retro-listener
phase: 4
status: done
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
- 2026-07-30T19:28:05.053Z — loop iteration 3: Implemented src/commands/learn-watch.ts (watch/list/requeue, exit-code table, allow prompt) wired into src/cli.ts, plus the SELF_HEALING.md retro-listener section, with 26 new tests and a refreshed help snapshot — full suite green at 2987 and all four evals passing.
  - Change: AC 3 met: new src/commands/learn-watch.ts — thin wiring for the drain (home/config resolution via DEVX_LEARN_HOME > learn.* > defaults, per-run seen/noted sets, singleton claim before any output, line-buffered status lines), the terminal allow prompt (byte-accumulating synchronous line reader, decoded once so non-ASCII repo paths survive), `list` (pending rows with a sessionOver-computed readiness column + last 5 processed with outcomes) and `requeue <sid>`; registered in src/cli.ts at phase 1.
  - Change: Exit-code table honored end to end and verified in real subprocesses: 0 clean/SIGINT, 1 held singleton (message names the lock) or requeue state-miss, 2 usage — commander's own usage failures remapped from its default 1 to 2 via exitOverride, and allowExcessArguments(false) so a typo'd subcommand can't silently start a real drain.
  - Change: Watch arm drives drainPass with an awaited inter-pass timer instead of the lib's synchronous runWatch, because a JS signal handler can never run while runWatch's sleepSync blocks the event loop; SIGINT/SIGTERM now flip a stop flag that is observed within one scan interval, the singleton is released in a finally, and the run exits 0 with the durable-queue farewell.
  - Change: AC 5 met: test/learn-watch.test.ts extended by 26 cases (160 → 186) covering config→drain wiring, lock refusal before any output, singleton hold/release-on-throw, dry-run byte-compare under a held lock, seen-set across passes, inter-pass wait cadence, interactivity downgrade, the ask seam, signal-handler install/removal and the stop path, list readiness/tail/`?`-column/read-only behavior, and every requeue exit code; test/help.test.ts snapshot refreshed for the new command.
  - Change: AC 7 met: docs/SELF_HEALING.md gained a 'Retro listener (devx learn-watch)' section — how to run the watcher, readiness and the ask-once allowlist, the full outcome vocabulary table, requeue recovery, and the learn: knobs.
  - Change: AC 6 (partial): --dry-run printed the expected wrapper command for a fake queue entry, and the tmux arm was smoked end-to-end inside a real tmux server with a stub `claude` — window opened, marker written, `completed` filed, queue emptied.
  - Learning: A JS SIGINT handler cannot fire while the main thread sits in Atomics.wait: runWatch's synchronous pass loop blocks the event loop for the whole run, so `process.on('SIGINT')` over it converts Ctrl-C from 'kills the watcher' into 'does nothing'. Measured with a standalone repro. Any future 'simplification' of the CLI back onto runWatch re-introduces a wedged terminal; the residual gap (a stop pressed during a marker wait is only seen when the marker lands) is inherent to drainPass being synchronous.
  - Learning: The AC-6 tmux arm IS reachable unattended: start a detached `tmux -L <socket> new-session -d` running the watcher with a stub `claude` prepended to PATH, and the whole spawn → marker → finish path runs for real. Only the Terminal.app arm needs a human, because it opens a GUI window on the user's desktop and would run the real `claude`.
  - Learning: This worktree has no installed node_modules — everything resolves up to /Users/leonidbelyi/personal/devx/node_modules, so `ls node_modules` looks empty and `npx`/`node -e` require absolute paths for package files.
  - Learning: zsh does not word-split unquoted parameters, so `node script.js $args` passes one argument; scratch CLI matrices need `${=args}` or an array or every case silently tests the same wrong thing.
  - Learning: Other Claude sessions run vitest concurrently on this machine (a palateful worktree was mid-suite here) — `ps | grep vitest` after a run is NOT evidence of your own strays; check the parent pid before killing anything.
- 2026-07-30T20:04:47.903Z — loop iteration 4: Cross-seam adversarial review of the full rtl104 diff fixed a skip-set aliasing bug that silently stranded malformed queue entries and a disproven Ctrl-C claim, and added a real-osascript-parser test for the Terminal arm — full suite green at 2991 with all four evals passing.
  - Change: Fixed skipKey (src/lib/learn/watch.ts) to key id-less entries by line content rather than line index: the run's skip-set outlives the queue rewrite finish performs, so the survivor of a retired malformed line inherited its key and was skipped for the life of the watcher. Confirmed RED-before-GREEN by reverting the fix.
  - Change: Corrected the SIGINT WHY comment in src/commands/learn-watch.ts after measuring the actual behavior — three SIGINTs to a process blocked in Atomics.wait never kill it — and added the user-facing consequence to docs/SELF_HEALING.md (Ctrl-C lands between retros, not during one; kill <pid> is the escape hatch).
  - Change: Added a darwin-gated test that round-trips the Terminal arm's escaped command through the real osascript parser byte-for-byte, covering the AC-6 escaping risk without opening a GUI window; the suite's other escape tests only check against a hand-written model of the parser.
  - Change: Added the drain-level regression test (two id-less lines must both retire in one pass) plus a skipKey stability test across removeFromQueue.
  - Change: Ran full verification: npm test green (135 files / 2991 tests, includes build + typecheck), evals E-3/E-4/E-5/E-9 all exit 0.
  - Learning: A JS SIGINT handler does not merely delay Ctrl-C while the loop is blocked — it removes node's default kill entirely. Measured: three SIGINTs to a process in Atomics.wait were all queued to the handler and delivered after the block; the process exited 0. Any 'a second Ctrl-C still kills it' reasoning in this codebase is false, and the only real escape from a marker wait is closing the retro's window or kill from another terminal.
  - Learning: Per-run in-memory keys and a file the run rewrites are a bug pattern, not just a wart: any set keyed on a line index survives the rewrite that invalidates it. The TaggedEntry.rawLine field already existed for exactly this reason (removeFromQueue cross-checks it), but skipKey used lineIndex — worth grepping for other index-keyed state in the learn/ modules.
  - Learning: The Terminal arm's AppleScript escaping IS verifiable unattended: bind the literal with `osascript -e 'set c to "<escaped>"' -e 'return c'` instead of running `do script`. Same parser, no window, no automation-permission prompt. Only the actual GUI spawn needs a human.
  - Learning: Per-story self-review does not cover cross-story seams. Both defects here live in code each earlier iteration reviewed and passed — one is a lib/CLI interaction, the other an rtl103 helper meeting rtl104's new caller. A whole-diff pass at the end of a multi-iteration spec is worth its iteration.
  - Learning: The full suite took ~25 minutes this run rather than the ~16 in the status log — another session's vitest was running concurrently on this machine. Budget the whole iteration for it and expect contention.
- 2026-07-30T14:07:29-06:00 — split (merge-first): emitted follow-up 9946f9 → `dev/dev-9946f9-2026-07-30T14:07-human-smoke-of-the-devx-learn-watch-terminal-app-s.md` via devx split

- 2026-08-03T10:35 — merged interactively after the owning loop died (PID 60783): union-merged main into the branch (status-log-only conflict), fresh CI green end-to-end → squash-merged PR https://github.com/LeoTheMighty/devx/pull/107 (56a00d87). Stale spec lock reaped, worktree removed. AC 6's Terminal.app half lives on as split follow-up 9946f9.
- 2026-08-03T10:05 — phase 4: adversarial review DID run — this line is a format backfill, not a new claim. Reconstructed from this spec's own status log, which records a cross-seam adversarial review of the full rtl104 diff (fixed a skip-set aliasing bug that silently stranded malformed queue entries) plus per-iteration self-review fixes (per-arm stdio so osascript's window-object echo can't interleave into the drain log; SIGINT during a marker wait leaves the entry pending instead of writing a fabricated `timeout` row). ALL findings were fixed in-place at the time. The line was missing because `devx loop` writes `loop iteration N:` + Change/Learning bullets and never emits the `phase 4:` token `test/devx-status-log-discipline.test.ts` mandates — appended by sgr103 (PR #112) to un-red `main`; root cause filed as `debug/debug-3b9e07`.

## Links

- Plan: `_devx/workstreams/retro-listener/plan/agent.md` §Phase 4
- Design: `_devx/workstreams/retro-listener/design/agent.md` §Architecture (Spawn)
