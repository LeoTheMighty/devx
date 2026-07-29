# Design — Retro Listener

<!-- Stage: Design. Gate: `devx gate coverage 620c74` (design mode — one
     tri-state row per G-/UC-/CAP-/FR- ID in prd.md). Hard rule: don't plan
     here. No phases, no tasks — design is the approach, not the sequence. -->

## Overview

- **Objective**: Close the last manual hop in the `/devx-learn` loop — a
  human noticing the friction nudge and remembering to run the retro — by
  porting the field-hardened 8am-harness retro listener (upstream sources
  mirrored in `reference/`) onto devx's native TypeScript stack, so a
  detected nudge becomes a queued session and a queued session becomes an
  interactive forked retro, with the human's role reduced to pruning and
  approving.
- **Solution**: Three components, all riding existing devx machinery. (1) A
  **listener**: `devx learn-helper listen`, invoked by Stop + SessionEnd
  hooks registered in `.claude/settings.json`, greps the payload's
  `last_assistant_message` for the canonical nudge and appends to a
  user-global queue JSONL. (2) A **watcher**: `devx learn-watch`, a
  long-running serial drainer (shape of `src/commands/loop.ts`) that waits
  for session-over, then spawns `claude --resume <session-id>
  --fork-session "/devx-learn"` in a new tmux/Terminal window and observes
  the outcome through trap-written exit-status markers. (3) A **pin**: a
  vitest structural test locking the detection pattern to the
  `nudge-canonical` marker so the wire protocol cannot silently drift.

## Constraints

- The hook fires at **every turn end in every hooked repo** — it must exit 0
  on every path (a hook that fails a turn is worse than a missed detection)
  and stay under the G-3 latency bound (< 500ms p95, E-7). No config load,
  no repo scan; stdin → substring check → (on hit only) one locked append.
- The spawned retro must inherit the original thread natively —
  `--resume --fork-session` from the session's original cwd is the only
  mechanism that satisfies `/devx-learn`'s "current session only" mining
  scope without a skill change (upstream comparison table,
  `reference/2026-07-28-retro-listener.md` §"Why resume-fork").
- Serial retros are an invariant, not a preference: concurrent retros
  collide in one checkout (`fw/learn-*` branch churn) and race the
  learn-branch dedupe (E-4 singleton).
- The transcript JSONL format is documented as internal/version-unstable —
  it is only ever `stat`ed for mtime, never parsed.
- The spawn arm targets tmux and macOS Terminal only; elsewhere it degrades
  to a printed command + `manual` outcome (PRD non-goal).

## Risks

- Nudge reworded in `.claude/commands/devx-learn.md` → listener silently
  deaf → mitigated by the single-source pattern constant + structural pin
  that fails CI in the same PR → proven by E-6.
- Retro quotes the nudge while mining it → infinite retro-of-retro chain
  (fresh session ids defeat dedupe) → mitigated by the mechanical
  `DEVX_RETRO=1` guard: the wrapper exports it, the listener returns before
  reading stdin when set → proven by E-2.
- Tab closed / `tmux kill-window` delivers SIGHUP before any trailing
  command runs → queue wedges forever → mitigated by the signal-trap
  wrapper (HUP INT TERM, no EXIT trap, `rc=$?` read not asserted) + bounded
  await with `timeout` outcome for the SIGKILL case → proven by E-4.
- Missing/absent `transcript_path` reads as "session over" → focus-stealing
  spawn mid-work → mitigated by aging the entry against its own queue `ts`
  (fail-safe readiness) → proven by E-3.
- Two watchers drain the same head entry → duplicate retro tabs + duplicate
  done-log rows → mitigated by the singleton path lock (`--dry-run` exempt)
  → proven by E-4, E-5.
- Malformed queue entry (no `session_id` / no `cwd`) crashes the watcher on
  the same head entry every restart, or poisons the allowlist via an empty
  repo key → mitigated by retiring as `error-malformed` before prompt/spawn
  → proven by E-4.
- Stale queue lock (crashed hook/watcher) blocks the listener at every turn
  end → mitigated by `acquirePathLockBlocking`'s dead-PID reap + a short
  hook-side timeout that gives up (exit 0, detection dropped) rather than
  delaying the turn → proven by E-1 (garbage/contention cases) and E-7.

## Trade-offs

- **TS CLI subcommand over a shipped Python script** (upstream's choice) —
  one stack, vitest-testable, reuses the lock/atomic/spawn seams; costs node
  startup per Stop event, bounded and measured by E-7. The pure-fn +
  CLI-passthrough shape is the 4-epic LEARN.md pattern.
- **O_EXCL path locks over upstream's `flock`** — flock auto-releases on
  process death; devx's `src/lib/manage/lock.ts` compensates with dead-PID +
  PID-recycling reaping (mgr106), which this design inherits rather than
  adding a second lock primitive.
- **`.claude/settings.json` hooks over a plugin's `hooks/hooks.json`** —
  devx is an npm CLI, not a Claude Code plugin; project settings are the
  supported non-plugin hook channel. Costs an installation step per repo
  (FR-2) where the plugin got it free on install.
- **Denylist over allowlist for SessionEnd reasons** — an upstream reason
  rename degrades to the idle-window fallback, not to silence.
- **User-global queue home over per-repo `.devx-cache/`** — one watcher
  serves many repos; sessions are per-project but the drain loop is
  per-human.

## Out of scope

- Phase 2 unattended headless retros (PRD non-goal; approval-boundary move).
- Parallel retros / per-retro worktrees; queue/marker GC; Windows spawn arm.
- Any change to `/devx-learn`'s plan-first approval contract or to gate /
  verdict / dispatcher logic.

## Assumptions

- Claude Code ≥ 2.1.220 provides `last_assistant_message` (un-truncated) in
  the Stop payload and `reason` in SessionEnd, and supports `--resume
  --fork-session` — verified upstream against the installed CLI and hooks
  reference (`reference/2026-07-28-retro-listener.md` §"Verification of the
  underlying mechanics"). Revision trigger: any of these fields renamed.
- `devx` resolves on PATH in hooked repos (true here; consumer repos get it
  via the npm install `/devx-init` already requires). Revision trigger: a
  consumer install mode without a global binary.
- Sessions are stored per project directory and `--resume` must run from the
  original cwd — hence the queue records `cwd` and validates it.
- Project-settings hook edits may prompt the user for confirmation
  (harness-gate memory `project_skill_perms_block_subagents.md`): the FR-2
  install step runs user-foreground inside `/devx-init`, where a prompt is
  acceptable; nothing installs hooks from a subagent.

## Discarded considerations

- **Adding a queue-write step to the skill wrap-up prose** — turns a
  no-write nudge into a model-executed side effect; hooks fire
  deterministically, prose doesn't (upstream §"Emit — no changes").
- **A Claude-session watcher (`/loop`-style)** — burns tokens polling a
  file; deterministic plumbing belongs in a script/CLI.
- **Fresh session + "read this transcript"** instead of resume-fork — loses
  fidelity (internal format), doubles token cost, and needs a SKILL.md
  variant input mode.
- **Sleep inhibition for the watcher** (`startSleepInhibit`,
  `src/lib/loop/sleep-inhibit.ts`) — the watcher is a convenience, not a
  committed run; keeping a laptop awake for it inverts the priority. The
  queue is durable across sleeps by construction.
- **A new flock-based lock primitive** to mirror upstream exactly — two lock
  disciplines in one codebase for no behavioral gain.

## Wrap, don't duplicate

- Reuses: `acquirePathLock` / `acquirePathLockBlocking` +
  `PathLockHeldError` (`src/lib/manage/lock.ts`) for the watcher singleton
  and queue critical sections; `writeAtomic`
  (`src/lib/supervisor-internal.ts`) for queue rewrites, marker writes, and
  settings writes; the `appendFileSync` JSONL append + tolerant reader
  precedent (`appendEvent` / `readEvents`, `src/lib/loop/state.ts`); the
  `SpawnFn` test seam + pre-argv identifier validation discipline
  (`src/lib/manage/spawn.ts`); install ownership discipline
  (`installSkills` / `decideSkillInstall`, `src/lib/init-skills.ts`) for the
  hook-install step; the config-section pattern (`LOOP_DEFAULTS` +
  `loopConfigFrom`, `src/lib/loop/config.ts`); the long-running command
  shape + exit-code table (`src/commands/loop.ts`); CLI registration via
  `register(program)` + `attachPhase` (`src/cli.ts`, `src/lib/help.ts`);
  structural-test slicing pattern (`test/learn-skill-guards.test.ts`,
  `test/devx-skill-phase9-split.test.ts`); skill-mirror sync
  (`scripts/sync-skills.mjs`).
- Adds: `src/lib/learn/nudge.ts` (the single-source pattern constant +
  whitespace-collapse matcher), `src/lib/learn/queue.ts` (queue/done-log/
  marker store), `src/lib/learn/listener.ts` (Stop/SessionEnd core),
  `src/lib/learn/watch.ts` (readiness, allowlist, outcomes, drain loop),
  `src/lib/learn/spawn.ts` (wrapper builder + tmux/osascript arms — the one
  genuinely new spawn mechanism in the repo), `src/lib/learn/config.ts`,
  `src/lib/init-hooks.ts` (settings merge-writer), `src/commands/learn-watch.ts`,
  a `listen` subcommand in `src/commands/learn-helper.ts`, the settings
  template under `_devx/templates/init/`, and the structural pin test.

## Design

### Architecture

Emit → detect → queue → spawn, with judgment nowhere and every step
mechanical:

- **Emit (exists, untouched):** `/devx` and `/devx-plan` wrap-ups apply the
  nudge whose canonical sentence lives at the `nudge-canonical` marker in
  `.claude/commands/devx-learn.md` — already single-sourced and pinned by
  `test/learn-skill-guards.test.ts` and `test/skill-todo-discipline.test.ts`.
- **Detect (`src/lib/learn/listener.ts`):** pure core
  `handleHookPayload(payload, env, store)` invoked by `devx learn-helper
  listen` reading stdin. Stop: whitespace-collapsed substring check of
  `NUDGE_PATTERN` (`src/lib/learn/nudge.ts` — one constant, commented back
  to the marker; a mid-sentence substring so markdown bold/em-dash styling
  can't break the match) against `last_assistant_message`; on hit, dedupe +
  append under the queue lock. SessionEnd: reason-denylist check, then
  `.ended` marker touch only for pending sessions. `DEVX_RETRO` short-
  circuits before stdin. Top-level try/catch → exit 0 always.
- **Queue (`src/lib/learn/queue.ts`):** the store shared by listener and
  watcher — `readQueue`, `appendPending`, `removeFromQueue` (whole-file
  rewrite via `writeAtomic`), `appendDone`, `readDone`, marker paths.
  All mutations run inside `withQueueLock` (wraps
  `acquirePathLockBlocking(home/locks/learn-queue.lock)`); the listener
  passes a short timeout and treats `BacklogLockTimeoutError`-style
  expiry as "drop the detection, exit 0".
- **Watch (`src/lib/learn/watch.ts` + `src/commands/learn-watch.ts`):**
  `claimSingleton` via `acquirePathLock(home/locks/learn-watch.lock)`
  (fail-fast, dead-PID reap inherited; skipped under `--dry-run`); poll
  loop `pickReady` → readiness (`sessionOver`: marker ∨ transcript-mtime
  idle ∨ (no transcript) entry-age; undatable hand-edited entry serves
  rather than wedges) → malformed retire → allowlist decision
  (`repos.json` keyed by `git rev-parse --show-toplevel`, memoized;
  prompt-ability = foreground-process-group test re-checked at prompt
  time) → `spawnRetro` → `awaitMarker` (2s poll, bounded by
  `retro_timeout_minutes`) → outcome mapping → `finish` (done-log append,
  queue removal, marker cleanup). Outcome vocabulary is FR-3's, verbatim
  from upstream. **`--dry-run` changes nothing by construction:** the
  singleton claim is skipped (a held lock must not refuse a read-only
  setup check), `spawnRetro` only prints the wrapper command, and the
  retire step records the session id in a per-run in-memory seen-set
  instead of calling `finish` — no marker, no done-log row, no queue
  rewrite; `pickReady` skips seen ids so the loop doesn't re-print the
  same head entry every pass (upstream round-4 finding: the first version
  faked a completion marker and silently drained the real queue).
- **Spawn (`src/lib/learn/spawn.ts`):** `buildWrapperCommand(sid, cwd,
  markerPath)` returns the sh command string — tmp+rename marker write
  helper, `trap 'rc=$?; …' HUP INT TERM` (no EXIT trap: bash defers traps
  until the foreground command returns, so both would fire in signal
  cases and the recorded outcome would depend on ordering; and the trap
  *reads* `$?` because a single Ctrl-C is absorbed by claude and exits 0),
  `cd` guard writing `error-cd`, `DEVX_RETRO=1 claude --resume <sid>
  --fork-session "/devx-learn"`, trailing status write. Session id
  validated against a UUID-shaped regex and cwd shell-quoted before any
  argv/command construction (mgr104 discipline). Arms: `tmux new-window`
  when `$TMUX` is set; `osascript` Terminal.app on darwin; otherwise print
  + `manual` (never awaited — the marker could only come from the human).
  Injected `SpawnFn`-style seam so tests never open real windows.
- **Pin (`test/learn-nudge-pin.test.ts`):** reads the marker prose from
  `.claude/commands/devx-learn.md`, asserts
  `collapse(prose).includes(collapse(NUDGE_PATTERN))` (importing the real
  constant), plus in-memory mutation negative cases. Replaces upstream's
  standalone `lint_nudge.py` + workflow with a suite already CI-gated.
- **Routing rework (FR-7, prose + tests):** in
  `.claude/commands/devx-learn.md`, the four-bucket table becomes an
  **ordered first-match procedure** over five outlets — framework fix ·
  project preference (`devx.config.yaml` proposal) · product/workstream
  lesson (LEARN.md candidate) · personal preference (a `~/.claude/`
  snippet, presented to the user and never committed) · dropped — plus the
  three checkability rules from upstream: name the question that decided
  the bucket; promotion to framework fix is an evidence claim, not a
  plausibility one; on a coin flip take the narrower outlet and record the
  ambiguity. The existing repo predicate and the `nudge-canonical` marker
  are byte-preserved (the marker pins and E-6 depend on the marker;
  `test/learn-skill-guards.test.ts` asserts the routing section's shape
  gets updated in the same change). Edits go through
  `npm run sync:skills`; severable from the listener/watcher work.
- **Install (`src/lib/init-hooks.ts`):** `installHooks(opts)` merges the
  Stop/SessionEnd registrations into `.claude/settings.json` — parse (or
  create), deep-merge preserving unknown keys and existing hook entries,
  identify devx-owned entries by their command string
  (`devx learn-helper listen`), idempotent by construction, `writeAtomic`
  output. Template fragment under `_devx/templates/init/` (already in
  `package.json → files`); wired into `src/lib/init-orchestrator.ts`. This
  repo's own `.claude/settings.json` is committed directly.

### Interfaces

- `devx learn-helper listen` — stdin: Claude Code hook JSON (Stop or
  SessionEnd, discriminated by `hook_event_name`); stdout: none; exit: 0
  always. Env: `DEVX_RETRO` (guard), `DEVX_LEARN_HOME` (home override for
  tests/hooks running outside a repo).
- `devx learn-watch` — foreground drain loop. Exit 0 on SIGINT ("queue is
  durable; restart anytime"), 1 when the singleton is held (message names
  the lock path), 2 on usage error. Flags: `--dry-run`. Subcommands:
  `list` (pending + readiness state, last 5 processed + outcomes),
  `requeue <sid>` (restore from done log keeping original `ts`; refuse if
  pending; exit 1 when not found).
- `learnConfigFrom(merged)` (`src/lib/learn/config.ts`) → `{ idleMinutes:
  15, retroTimeoutMinutes: 360, home: "~/.claude/devx" }` with per-field
  clamp/fallback; schema addition in `_devx/config-schema.json` under
  `learn:` (`additionalProperties: false`); precedence: env override
  (`DEVX_LEARN_HOME`) > config > default.
- Hook registration (settings fragment): `{"hooks": {"Stop": [{"hooks":
  [{"type": "command", "command": "devx learn-helper listen"}]}],
  "SessionEnd": [/* same */]}}`.
- `installHooks({repoRoot, settingsPath?, dryRun?})` →
  per-file `{action: "created" | "merged" | "unchanged", path}`.

### Data

All under the learn home (default `~/.claude/devx/`, overridable):

- `learn-queue.jsonl` — pending entries `{session_id, transcript_path,
  cwd, ts}` (+ `requeued_ts` after a requeue); append-only between locked
  whole-file rewrites; tolerant reader skips torn lines.
- `learn-queue.done.jsonl` — processed entries + `{processed_ts, outcome}`;
  append-only; the phase-2 evidence dataset (outcome fidelity matters —
  E-4's mapping exists for this log's sake).
- `markers/<sid>.ended` (SessionEnd fast path) and `markers/<sid>.done`
  (wrapper-written, contains the exit status; tmp+rename so never read
  torn) — deleted by `finish`.
- `repos.json` — `{"<repo-root>": "allow" | "deny"}`.
- `locks/learn-queue.lock`, `locks/learn-watch.lock` — O_EXCL JSON-body
  path locks (pid + acquired_at), reaped on dead PID.

No retention/GC by design (PRD non-goal); no migrations (all files are
net-new).

## Migration plan

Purely additive — no existing state changes shape. Order of adoption in
this repo: CLI + tests merge first (inert without registration); the
committed `.claude/settings.json` activates detection; the watcher is
opt-in per run. Rollback = remove the settings entries; the queue home is
inert data. Consumer repos adopt via the `/devx-init` install step on
their next init run. FR-7 (outlet routing) is a severable prose+tests
change gated by the existing marker pins.

## Resolved design questions

- Hook stack: TS CLI subcommand, not Python — decided in PRD Open
  questions, bounded by G-3/E-7.
- Queue home: user-global `~/.claude/devx/` (one watcher, many repos),
  config- and env-overridable — mirrors upstream's resolution of its open
  question 2.
- Lock discipline: existing O_EXCL path locks with stale reaping; no flock
  port.
- Watcher spawn UX: auto-spawn (upstream open question 1's "matches the
  proposal's intent" arm) — the allowlist's ask-once-per-repo is the
  conservative valve.
- Surface for the watcher: top-level `devx learn-watch` (long-running,
  `loop` precedent) with the hook as a `learn-helper` subcommand (short-
  lived helper precedent).

## Unresolved design questions

- Should `devx status` / `devx next` surface pending retro count ("1
  session awaiting retro")? Cheap, fits the gate-summary pattern, no P0
  depends on it — deferred to a follow-up spec if wanted after first use.
