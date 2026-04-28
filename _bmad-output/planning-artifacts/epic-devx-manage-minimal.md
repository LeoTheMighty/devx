<!-- refined: party-mode 2026-04-28 (inline critique; thoroughness=balanced; lenses: PM/Dev/Architect/Infra/Murat — UX skipped) -->

# Epic — `/devx-manage` v0 (minimal scheduler + supervisor)

**Plan:** `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`
**Slug:** `epic-devx-manage-minimal`
**Order:** 5 of 5 (Phase 1 — Single-agent core loop) — depends on epic-devx-skill
**User sees:** "Once `/devx-init` runs, the OS-supervised `dev.devx.manager` unit (already installed in Phase 0) starts running for real. Every 60s it ticks: reads backlogs, picks one ready item from DEV.md, spawns one `claude /devx <hash>` subprocess (hard cap N=1), persists `.devx-cache/state/{schedule.json,manager.json,heartbeat.json}`, restarts the worker on plain crash. Without me invoking anything, the next ready DEV.md item gets claimed and merged. Phase 2's full control plane (rot detection, event streams, restart-from-status-log) builds on the same persistent state."

## Overview

Phase 0's `epic-os-supervisor-scaffold` installed launchd / systemd / Task-Scheduler units pointing at a placeholder script that prints "not yet wired." This epic replaces that placeholder with a real `/devx-manage` v0 that closes the loop: filesystem + subprocess + heartbeat, hard-capped at N=1 worker, restarts only on plain process crash (not yet on context rot — that's Phase 2's `epic-context-rot-detection`). The state-file shape (`schedule.json`, `manager.json`, `heartbeat.json`) is fixed at Phase 1 so Phase 2's rot detection adds fields without migrating; same atomic-write primitive (`*.tmp` + `rename`) used throughout. The OS supervisor unit (sup402/3/4) handles Manager itself: if Manager dies, the launchd/systemd unit restarts it; the next tick rediscovers state from disk + backlog files.

## Goal

Close the loop in single-agent form: with `/devx-init` having run and the OS supervisor units running, the user does NOT need to invoke `/devx` to ship a DEV.md item. The Manager picks it up, spawns `claude /devx <hash>`, and the existing /devx skill carries the work. Adds the persistent on-disk state that Phase 2 builds on. Hard cap N=1; parallelism is Phase 3's `epic-locks` + `epic-intents` + `epic-capacity-management`.

## End-user flow

1. Leonid finishes `/devx-init` (Phase 0). The launchd unit `dev.devx.manager` is loaded and "running" — it points at `bin/devx manage` (a real command after this epic).
2. Manager wakes every 60s. Tick 1: reads `DEV.md`. Top `[ ]` ready item is `dev-c4f1a2-...-control-plane-spec.md` (whatever ships next; this Phase 1 plan's specs queue first). No worker running. Spawns `claude /devx c4f1a2` as a detached child. Persists `(pid, hash, started_at)` to `.devx-cache/state/manager.json`. Heartbeat written.
3. Tick 2 (60s later): reads manager.json; child still running; reads DEV.md; the spec is `[/]` in-progress (the child claimed it via dvx101); no spawn-2 action needed (hard cap). Heartbeat written.
4. Some ticks later: the spec is `[x]` done in DEV.md (the child merged it via dvx106). Manager detects child exited 0; releases slot in manager.json; logs "spec done; ready for next tick to spawn." Heartbeat written.
5. Next tick: top `[ ]` ready item is the next plan-spec or dev-spec. Spawn cycle repeats.
6. **Crash path.** Child crashes (exit code != 0 from `claude` itself, e.g., OOM). Manager's `child.on('exit')` handler fires; respawns against the same hash; increments `crash_count` in manager.json; sleeps the next backoff window (`worker_crash_backoff_s: [10, 30, 90, 300]`). After 5 consecutive crashes (`manager.max_restarts_per_spec`), Manager marks the spec `blocked` in DEV.md + appends INTERVIEW.md entry asking the user to investigate.
7. **Manager itself crashes.** launchd's KeepAlive bounces it (Phase 0 sup402 contract). New process discovers state from disk: reads `manager.json` for last roster + heartbeat freshness; reads DEV.md for current ready set; reconciles. Workers it spawned that are still alive remain alive; ones that exited during the crash window get respawned-or-marked-blocked per their crash count.
8. (Out of scope) Worker context-rot — Phase 2. Worker event-stream consumption — Phase 2. Concierge — Phase 2.

## Backend changes

A new TypeScript module under `src/lib/manage/` and a real implementation of the existing `src/commands/manage.ts` stub. The stub is replaced; help.ts updates the annotation.

- **New** `src/lib/manage/state.ts` — schemas + IO for `.devx-cache/state/`:
  - `schedule.json` — desired roster: `{generation, computed_at, slots: [{spec_hash, worker_class, priority, since}], hard_cap: 1}`. Atomically written.
  - `manager.json` — actual state: `{generation, started_at, model, ticks: [...recent], roster: [{pid, spec_hash, worker_class, started_at, crash_count, last_exit_code?}], lock: {pid, acquired_at}}`. Atomically written; bounded to ≤ 1 MB by trimming `ticks` log to last 100.
  - `heartbeat.json` — `{ts, pid, generation}`. Single-line replace, not append.
- **New** `src/lib/manage/reconcile.ts` — `function reconcile(state): {desiredSpawns, desiredKills, statusLogUpdates}`. Pure function; given current `state.json` + DEV.md + INTERVIEW.md + MANUAL.md, computes the diff. Hard-cap-1 enforced inside this function (cannot return more than one desired spawn).
- **New** `src/lib/manage/spawn.ts` — `function spawnWorker(specHash, model): Promise<{pid}>`. Wraps `child_process.spawn('claude', ['/devx', specHash], {detached: true, stdio: ['ignore', 'pipe', 'pipe']})`. Pipes stdout/stderr to `~/Library/Logs/devx/worker-<hash>.log` (or platform equivalent — reuse `logDir` from supervisor.ts). Registers `child.on('exit')` handler that updates `manager.json` atomically.
- **New** `src/lib/manage/lock.ts` — `function acquireManagerLock(): Promise<{release: () => void}>`. O_EXCL atomic create on `.devx-cache/locks/manager.lock`. Reuses the supervisor-internal.ts SHA-256-on-disk pattern from LEARN.md cross-epic. Auto-release on graceful exit; stale-PID detection on acquire (lock written by a non-running PID is forcibly cleared with a logged WARN).
- **New** `src/lib/manage/loop.ts` — `function runManagerLoop(opts: {tickIntervalS, signal: AbortSignal}): Promise<void>`. The driver: acquire lock → tick → sleep `manager.heartbeat_interval_s` → tick → ... → SIGTERM-clean exit. Each tick is 5 phases: read state → reconcile → execute spawns → execute kills → write state + heartbeat. Single-tick exposed as `runManagerOnce()` for testability.
- **Modified** `src/commands/manage.ts` — replace stub. CLI flags: `--once` (single tick + exit), default (run loop). Reads `manager.heartbeat_interval_s` from config. SIGTERM handler signals the loop's AbortController.
- **Modified** `src/lib/help.ts` — drop stub annotation for `manage`.
- **Modified** `_devx/templates/launchd.plist` (etc., for systemd + Task Scheduler) — `ExecStart` already points at `devx manage` per epic-os-supervisor-scaffold. No change needed; just verifying via integration test.

## Infrastructure changes

- Manager logs to `~/Library/Logs/devx/manager.log` (macOS) / `~/.local/state/devx/manager.log` (Linux) / `%APPDATA%\devx\Logs\manager.log` (Windows). Path resolution reuses `supervisor.ts → logDir()`.
- Worker logs at `<logDir>/worker-<hash>.log`. Rotated on size (1 MB) or at spec done (rename to `worker-<hash>-<merge-sha>.log`).
- The launchd plist / systemd service / Task Scheduler XML from sup402/3/4 already point at `devx manage`. No new install steps.

## Design principles (from research)

- **Thin loop, narrow tools.** Per DESIGN.md §"ManageAgent": "intentionally a *thin* loop — small prompt, narrow tool surface (filesystem + subprocess + heartbeat) — so its own context doesn't rot fast." For v0, the loop is ~150 lines of TS; exhaustively testable.
- **State on disk; PIDs on tape.** `manager.json` IS the state. If Manager dies and the launchd unit bounces it, the new process reads `manager.json`, reconciles against running PIDs, and continues. No in-memory state survives across crashes.
- **Atomic writes always.** Every `.devx-cache/state/*.json` write is `*.tmp` + `rename`. Partial writes are impossible; reads always see a valid file. Same primitive as supervisor-internal.ts (LEARN.md cross-epic).
- **Hard cap N=1, explicit.** A constant `HARD_CAP_PHASE_1 = 1` in `reconcile.ts` with a comment block: "Phase 1: hard cap. Phase 3 epic-capacity-management replaces this with `capacity.max_concurrent` from devx.config.yaml. Do not change this value or remove the test asserting spawn-2 rejection without bumping the phase reference."
- **Plain-crash restart, not rot.** v0 detects child exit code != 0 and respawns. Context rot (token usage, age, "stopping" lines) is Phase 2 — different signals, same restart mechanism.
- **Backoff schedule from config.** `worker_crash_backoff_s: [10, 30, 90, 300]` already in devx.config.yaml. Manager picks the next index per consecutive crash count; resets on a successful run.
- **Lock on disk, not in memory.** `manager.lock` enables Phase 3's mutual exclusion against parallel `/devx-manage` invocations (e.g., user runs `devx manage --once` while the launchd unit is running). v0 acquires + releases; Phase 3 builds the wait-or-fail logic.
- **Workers are subprocesses; orchestration is a tick.** The Manager process never `await`s a child. It checks state, dispatches, returns. Crash-recoverable.

## File structure

```
src/
├── lib/
│   └── manage/
│       ├── state.ts                        ← new: schemas + IO for schedule/manager/heartbeat
│       ├── reconcile.ts                    ← new: reconcile(state) → diff
│       ├── spawn.ts                        ← new: spawnWorker(hash, model)
│       ├── lock.ts                         ← new: acquireManagerLock()
│       ├── loop.ts                         ← new: runManagerLoop() + runManagerOnce()
│       └── promote.ts                      ← (already shipped via mrg103; not in this epic)
├── commands/
│   └── manage.ts                           ← modified: replace stub with real loop
└── lib/help.ts                             ← modified: drop manage stub annotation

test/
├── manage-state-roundtrip.test.ts          ← new: read/write/atomic-recovery for each state file
├── manage-reconcile-truth-table.test.ts    ← new: reconcile() outputs vs state fixtures
├── manage-spawn-and-restart.test.ts        ← new: spawn stub child; assert respawn on exit-42
├── manage-hard-cap.test.ts                 ← new: assert spawn-2 rejected with exact error
├── manage-lock.test.ts                     ← new: O_EXCL acquire; stale-PID clear
└── manage-loop-integration.test.ts         ← new: 3-tick loop with mocked state + child; SIGTERM clean

.devx-cache/state/                          ← runtime — created on first manager tick (gitignored)
~/Library/Logs/devx/                        ← runtime — manager + worker logs
```

## Story list with ACs

### mgr101 — Manager scaffold + `devx manage --once` single-tick CLI
- [ ] `src/lib/manage/loop.ts` exports `runManagerOnce()` and `runManagerLoop({tickIntervalS, signal})`.
- [ ] `src/commands/manage.ts` (replacing stub) registers `devx manage` with `--once` flag.
- [ ] `--once` mode: acquires lock, runs one tick, releases lock, exits 0. Single-tick exposed to test harness.
- [ ] Default (no flags): runs loop until SIGTERM; AbortSignal propagates the signal; pending tick drains; exits 0.
- [ ] `src/lib/help.ts` no longer annotates `manage` with `(coming in Phase 2 — epic-devx-manage-minimal)`.
- [ ] Smoke test: `devx manage --once` against an empty `.devx-cache/state/` produces `manager.json`, `heartbeat.json` (no spawn since DEV.md may be empty in fixture), exits 0.

### mgr102 — State persistence: schedule.json + manager.json + heartbeat.json with atomic writes
- [ ] `src/lib/manage/state.ts` exports `readState()`, `writeState(state)`, `writeHeartbeat()`. All writes atomic (`*.tmp` + `rename`).
- [ ] Schemas: `schedule.json` (desired roster), `manager.json` (actual state, ticks log trimmed to last 100), `heartbeat.json` (single line).
- [ ] Crash-mid-write recovery: a leftover `*.tmp` file is detected on read and either ignored (if `<state>.json` exists) or used (if `<state>.json` is absent — the rename half-completed before crash). Tests cover both.
- [ ] Reuse the supervisor-internal.ts SHA-256-on-disk idempotency pattern for lockfiles + state-file integrity (LEARN.md cross-epic).
- [ ] Tests cover: read-empty (no file → returns empty default state); read-leftover-tmp; write+read roundtrip; concurrent-write protection (atomic rename guarantees it).

### mgr103 — Reconcile loop: read backlogs + compute diff + detect unblocks
- [ ] `src/lib/manage/reconcile.ts` exports `reconcile(state, backlogSnapshot): {desiredSpawns, desiredKills, statusLogUpdates}`.
- [ ] Inputs: current `manager.json` state + parsed DEV.md (rows + statuses) + parsed INTERVIEW.md (answered Qs that unblock specs) + parsed MANUAL.md (checked items that unblock specs).
- [ ] Outputs:
  - `desiredSpawns`: at most one `(spec_hash, worker_class, model)` triple. Empty if hard cap is full or no ready specs.
  - `desiredKills`: PIDs whose target spec reached `done` / `blocked` / `deleted` / superseded.
  - `statusLogUpdates`: appended-line directives `(spec_hash, line)` for any state transitions Manager observed (e.g., "manager: detected MANUAL M1.2 checked → spec dev-a10004 unblocked").
- [ ] Pure function — no I/O. Tests cover ≥ 8 fixtures: empty backlog; one ready; one ready + worker running; INTERVIEW unblock; MANUAL unblock; superseded entry; blocked-by chain; cap full.
- [ ] **Hard cap = 1** as a constant in this file with the comment block from "Design principles."

### mgr104 — Spawn one worker (hard cap N=1) + `claude /devx <hash>` subprocess
- [ ] `src/lib/manage/spawn.ts` exports `spawnWorker(hash, model): Promise<{pid}>`. Implementation: `child_process.spawn('claude', ['/devx', hash], {detached: true, stdio: ['ignore', logFd, logFd]})`. Returns the child's PID.
- [ ] Stdout + stderr piped to `<logDir>/worker-<hash>.log` (rotated at 1 MB).
- [ ] PID + start time persisted to `manager.json` atomically before `spawnWorker` returns.
- [ ] Hard-cap test: a fixture state with one running worker + a `desiredSpawn` for a second hash produces a "Phase 1 hard cap: cannot spawn second worker (running: <hash1>)" error from `reconcile.ts`. Spawn never called.
- [ ] Integration test: `runManagerOnce()` against fixture DEV.md with one ready spec and a stub `claude` binary (a tiny shell script that sleeps 5s then exits 0); assert PID recorded, log file written, exit-0 detected on next tick → slot released.

### mgr105 — Plain-crash restart logic + max-restarts-per-spec gate
- [ ] `child.on('exit')` handler updates `manager.json` atomically: clears the roster slot; on `code !== 0`, increments `crash_count` and re-queues the spec for the next tick (does NOT spawn directly from the exit handler — the next tick handles the respawn after backoff).
- [ ] Backoff respected: `worker_crash_backoff_s: [10, 30, 90, 300]` — `crash_count == 1 → 10s; == 2 → 30s; ...; > 4 → 300s`. Reconcile compares wall-clock to `last_exit_at + backoff[crash_count]` before re-spawning.
- [ ] After `manager.max_restarts_per_spec` (default 5) consecutive crashes for the same spec: mark the spec `blocked` in DEV.md (`[/]`→`[-]`), set spec frontmatter `status: blocked`, append status-log line `manager: max restarts exceeded (5x exit-<lastCode>)`, append INTERVIEW.md entry asking the user to investigate.
- [ ] Integration test: stub `claude` binary that always exits 42; assert respawn cycle (crash 1 → wait 10s → respawn → crash 2 → wait 30s → ... → crash 5 → mark blocked + INTERVIEW).
- [ ] Test uses fake-timers / wall-clock mocks to avoid real backoff waits.

### mgr106 — Manager lock + heartbeat + SIGTERM-clean
- [ ] `src/lib/manage/lock.ts` exports `acquireManagerLock()`: O_EXCL create on `.devx-cache/locks/manager.lock` writing `{pid, acquired_at}`. Returns a `release()` function that deletes the file.
- [ ] Stale-PID detection: if the lock exists but its `pid` doesn't appear in `ps`, log a WARN, delete the file, retry acquire once. Bounded retry to prevent infinite loop.
- [ ] Heartbeat: `loop.ts` writes `heartbeat.json` (single-line replace) at the end of each tick. Format: `{ts: <iso>, pid, generation}`.
- [ ] SIGTERM handler in `manage.ts`: signals the loop's AbortController; loop drains current tick + releases lock + exits 0. Exits non-0 if SIGTERM during initialization (couldn't acquire lock yet).
- [ ] Test: spawn `devx manage` as a subprocess; verify `manager.lock` exists; SIGTERM; verify `manager.lock` removed; verify exit 0.
- [ ] Phase 2 (mutual-watchdog) will read heartbeat.json freshness; v0 just writes it correctly. Format pinned: `{ts, pid, generation}`.

### mgrret — Retro: bmad-retrospective on epic-devx-manage-minimal
- [ ] Run `bmad-retrospective` against the 6 shipped stories (mgr101–mgr106); append findings to `LEARN.md § epic-devx-manage-minimal`.
- [ ] Each finding tagged `[confidence]` + `[blast-radius]`.
- [ ] Cross-epic patterns hitting ≥3 retros total promoted into `LEARN.md § Cross-epic patterns`. Specifically: re-evaluate "atomic state writes via tmp+rename" (sup × 4 internal observations + ini505 reuse + mgr102 = strong cross-epic concordance). Promote if confirmed.
- [ ] Sprint-status row for `mgrret` present + `LEARN.md § epic-devx-manage-minimal` section exists.

## Dependencies

- **Blocked-by:** `epic-devx-skill` (mgr104 spawns `claude /devx <hash>` — `/devx` must be Phase-1-stable so the spawned worker can run end-to-end without manual intervention).
- **Blocks:** Phase 2's `epic-events-stream` (extends manager.json/heartbeat.json with event-source fields) and `epic-context-rot-detection` (extends mgr105 with rot signals beyond exit-code-0).

## Open questions for the user

None. Q3 (hard cap) resolved. Atomic-write primitive borrowed from supervisor-internal.ts (LEARN.md cross-epic, already shipped). Lock format pinned for Phase 3 reuse.

## Layer-by-layer gap check

- **Backend:** All 6 stories. State + reconcile + spawn + lock + loop. ✓
- **Infrastructure:** logDir conventions, launchd/systemd/Task-Scheduler integration (already pointed at `devx manage` from sup402/3/4 — verified by integration test). No new infra. ✓
- **Frontend:** None — no UI surface. (Phase 4 adds TUI/web/mobile feeds that read manager.json + heartbeat.json.) ✓

## Party-mode refined (2026-04-28, inline)

Lenses applied: PM, Dev (backend), Architect, Infra, Murat (QA). UX skipped.

### Findings + decisions

**PM (end-user value).** End-user value: "without me invoking anything, the next ready DEV.md item gets claimed and merged." Concern: Manager v0 has no visibility surface — Leonid won't know when it spawns. **Locked decision:** mgr101 AC bumped — `devx manage --once` prints a one-line summary to stdout: `tick <generation>: spawned <hash>` or `tick <generation>: no work` or `tick <generation>: maintained <hash> (pid <pid>)`. The launchd unit's stdout already feeds `~/Library/Logs/devx/manager.log`; this gives the user a grep-able trail.

**Dev (backend framing).** Two sharp questions:
- *mgr104's `child_process.spawn` with detached: true — what about stdio inheritance?* If the child inherits Manager's stdio, killing Manager kills child output. **Locked decision:** mgr104 AC reaffirmed — explicit `stdio: ["ignore", logFd, logFd]` redirects to log files; child is independent of Manager. Test fixture verifies: kill Manager mid-spawn; child continues to completion.
- *mgr105's `child.on("exit")` handler updates `manager.json` atomically — but if Manager crashes between exit-fired and json-written, the next Manager start sees a "running" PID for a dead process.* **Locked decision:** mgr105 AC bumped — on Manager start (mgr101 init), reconcile against running PIDs: every roster entry's PID is checked via `process.kill(pid, 0)` (signal 0 = check existence); dead PIDs trigger a synthetic exit event with code = "manager-restart-detected" and increment `crash_count` accordingly. Lost-exit events are recovered.

**Architect.** Concern: mgr103's reconcile is the load-bearing logic but its inputs (DEV.md + INTERVIEW.md + MANUAL.md parsing) overlap with /devx's claim path. Both parse the same files. **Locked decision:** mgr103 + dvx101 share parsing helpers via a new `src/lib/backlog/parse.ts` (created by mgr103 since it lands first by dependency). Pure parser, returns structured rows. Phase 2's `epic-events-stream` extends this with event emission; Phase 1 ships parsing only.

**Infra.** Concern: mgr106's stale-PID detection uses `process.kill(pid, 0)` — what if a different process inherited the PID (PID-recycling)? **Locked decision:** mgr106 AC bumped — lock file content includes `acquired_at` timestamp; stale-PID detection cross-checks: if PID exists but `process.uptime` of that PID started after `acquired_at`, treat as recycled (not the original Manager) → log WARN, delete lock, retry. Cross-platform: macOS uses `ps -o etime= -p <pid>`; Linux uses `/proc/<pid>/stat`; Windows-WSL uses `ps -o lstart -p <pid>`. Reuse `supervisor.ts → platformDetect()` to dispatch. Phase 0 LEARN.md cross-epic "per-platform deviation with explicit rationale + dedicated test" applies.

**Murat (QA / Test architect).** Risks:
- *mgr105 backoff testing with fake-timers.* Vitest's `vi.useFakeTimers()` covers `setTimeout`/`Date.now()`; but `child.on("exit")` is event-driven. **Locked decision:** mgr105 AC bumped — backoff respect is unit-tested via `reconcile.ts`'s pure decision: given `{last_exit_at, crash_count}` and `now`, returns "spawn" or "wait". The integration test (with stub child) verifies backoff is ENFORCED in `loop.ts` but doesn't measure timing precision (real clock with shortened `tickIntervalS`).
- *mgr106 SIGTERM-clean drain.* If a tick is mid-spawn when SIGTERM fires, draining means: the spawn completes (don't kill the half-spawned child); state is written; lock is released; exit. **Locked decision:** mgr106 AC bumped — drain semantics: SIGTERM sets the AbortController; the current tick's promise chain runs to completion (spawn or no-spawn); no new tick starts; lock released; exit 0. Test uses a fake "slow tick" (mocked spawn that takes 500ms) and asserts SIGTERM mid-tick still produces clean shutdown.

### Cross-epic locked decisions added to global list
13. **Manager-restart PID-recovery on init.** Reconcile against running PIDs; lost-exit events recovered as synthetic events.
14. **Backlog parsing in `src/lib/backlog/parse.ts` is the shared primitive.** mgr103 + dvx101 + future Concierge consume it.
15. **Lock files include `acquired_at` timestamp + uptime cross-check for PID-recycling robustness.** Per-platform via supervisor.ts dispatch.
16. **Visible per-tick stdout from `devx manage --once`.** Grep-able trail in launchd log.

### Story boundary changes
None. mgr101–mgr106 + mgrret unchanged in scope. Backlog parsing helper extraction is a within-mgr103 implementation detail.
