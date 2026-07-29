# Plan — Retro Listener

<!-- refined: critique 2026-07-29 (lenses: pm, architect, dev, qa) -->
<!-- Stage: Plan. Gate: `devx gate coverage 620c74` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. Default to
     more, smaller phases. One phase ≙ one dev spec ≙ one PR ≙ one tour. -->

## Current state

- The nudge emit side exists and is pinned: canonical sentence at the
  `nudge-canonical` marker in `.claude/commands/devx-learn.md:95`,
  referenced by `/devx` + `/devx-plan` wrap-ups, single-sourcing enforced by
  `test/learn-skill-guards.test.ts` + `test/skill-todo-discipline.test.ts`.
- `/devx-learn` exists (`.claude/commands/devx-learn.md`) with a four-bucket
  routing table and repo predicate; `devx learn-helper` has one subcommand
  (`slug`).
- No hook detection, no queue, no watcher, no `.claude/settings.json` in
  this repo, no hook install step in `/devx-init`, no `learn:` config
  section. Reuse surfaces verified in design.md §"Wrap, don't duplicate".
- Upstream reference implementation (accepted + 5 review rounds) mirrored at
  `_devx/workstreams/retro-listener/reference/`.

## Desired state

- A session that prints the nudge is enqueued at Stop by `devx learn-helper
  listen` (hooks registered in `.claude/settings.json`), and a running
  `devx learn-watch` spawns an interactive `claude --resume <sid>
  --fork-session "/devx-learn"` in a new tmux/Terminal window once the
  session is over — serially, with outcomes recorded in a done log.
- The wire protocol is CI-pinned; the loop is mechanically self-trigger-proof
  (`DEVX_RETRO=1`); consumer repos inherit the hooks via `/devx-init`.
- `/devx-learn` routes findings through the ordered five-outlet first-match
  procedure.

## What we're NOT doing

- Phase 2 unattended headless retros; any approval-boundary change.
- Parallel retros / per-retro worktrees; queue/marker/done-log GC.
- Windows spawn arm; notify-then-confirm spawn UX (auto-spawn + allowlist).
- Surfacing pending-retro counts in `devx status` / `devx next` (deferred,
  design.md §"Unresolved design questions").
- Gate/verdict/dispatcher changes of any kind.

## Expectation coverage

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 1 | tests-first | `test/learn-listener.test.ts` | full |
| E-2 | P0 | 1 | tests-first | `test/learn-listener.test.ts` | full |
| E-3 | P1 | 3 | tests-first | `test/learn-watch.test.ts` | full |
| E-4 | P0 | 3 (outcome mapping, malformed, requeue) + 4 (singleton, drain) | tests-first | `test/learn-watch.test.ts` | full |
| E-5 | P1 | 4 | tests-first | `test/learn-watch.test.ts` | full |
| E-6 | P0 | 1 | tests-first | `test/learn-nudge-pin.test.ts` | full |
| E-7 | P1 | 1 (authored + measured post-build, in-phase) | eval script (tests-after) | `_devx/workstreams/retro-listener/evals/E-7_hook-latency.ts` | full |
| E-8 | P1 | 5 | tests-first | `test/learn-hook-install.test.ts` | full |
| E-9 | P0 | 4 | tests-first | `test/learn-watch.test.ts` | full |
| E-10 | P1 | 1 | tests-first | `test/learn-listener.test.ts` | full |

## Phase checklist

- [ ] Phase 1: Listener — nudge pattern, queue store, `learn-helper listen`, wire-protocol pin
- [ ] Phase 2: `learn:` config section
- [ ] Phase 3: Watcher core — readiness, allowlist, outcomes, queue ops
- [ ] Phase 4: Watcher CLI — spawn arms, drain loop, `devx learn-watch`
- [ ] Phase 5: Hook registration + `/devx-init` distribution
- [ ] Phase 6: `/devx-learn` outlet routing rework

## Phases

### 1. Phase: Listener — nudge pattern, queue store, `learn-helper listen`, wire-protocol pin

**Overview**: The detection half, end to end, plus the pin that makes the
wire protocol safe to build on. Ships first because everything downstream
(watcher, hooks, install) consumes the queue this phase defines, and the pin
must exist before any other PR could plausibly touch the marker.

**Files**:
- `src/lib/learn/nudge.ts` — `NUDGE_PATTERN` (single source, mid-sentence
  substring of the marker prose, commented back to
  `.claude/commands/devx-learn.md`), `collapseWhitespace`, `containsNudge`.
- `src/lib/learn/queue.ts` — learn-home resolution (`DEVX_LEARN_HOME` env >
  default `~/.claude/devx`), queue/done-log/marker/repos paths,
  `readQueue`/`readDone` (tolerant JSONL readers per
  `readEvents`), `appendPending`, `appendDone`, `removeFromQueue`
  (`writeAtomic` rewrite), `withQueueLock` (wraps
  `acquirePathLockBlocking`, injectable timeout; on deadline it rethrows
  `PathLockHeldError` — the caught type for the listener's drop path),
  marker helpers. **Entry identity:** `readQueue` returns entries with
  their queue index (or raw line) attached and `removeFromQueue` accepts
  that identity, not a `session_id` — so Phase 3 can retire sid-less
  malformed entries without a store change. **`ts` contract:** written as
  `new Date().toISOString()`; `queuedAt` parses with a strict ISO-8601
  regex (not lenient `Date.parse`) so a hand-edited date-only string is
  *undatable* and serves immediately, preserving upstream semantics.
- `src/lib/learn/listener.ts` — `handleHookPayload(payload, env, deps)`:
  Stop arm (nudge check → locked dedupe+append; lock expiry → drop, exit
  0), SessionEnd arm (denylist `clear|resume|bypass_permissions_disabled|
  logout` → no marker; pending-only `.ended` touch), `DEVX_RETRO`
  short-circuit before stdin read.
- `src/commands/learn-helper.ts` — new `listen` subcommand: read stdin,
  try/catch everything, always exit 0.
- `test/learn-listener.test.ts` — E-1 + E-2 + E-10: verbatim/hard-wrapped/
  reworded detection, dedupe, garbage stdin, retro guard, denylist vs
  unknown/absent reason, lock-contention drop.
- `test/learn-nudge-pin.test.ts` — E-6: real `NUDGE_PATTERN` import vs
  marker prose (whitespace-collapsed substring) + ≥2 in-memory mutation
  negative cases.
- `.claude/settings.json` — this repo's Stop/SessionEnd registrations,
  committed here (moved up from the install phase): detection accrues from
  Phase 1 — the queue is durable, a watcher can drain it weeks later, and
  G-1's dated dataset starts collecting. Safe early: Stop-hook non-2 exit
  codes are non-blocking in Claude Code, and the listener exits 0 on every
  path; worst case before a rebuild is a one-line hook warning.

**Context**:
- Hook latency bound (G-3): no config load in the listener path — env +
  default home only (design.md §Constraints).
- Queue lock is shared with the watcher; listener passes a short timeout
  and drops the detection on expiry rather than delaying the turn.
- LEARN.md: pure-fn + CLI-passthrough trio — core in `src/lib/learn/`,
  thin command wiring.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx vitest run test/learn-listener.test.ts test/learn-nudge-pin.test.ts`
    green; all E-1/E-2/E-10/E-6 cases from expectations.md enumerated as
    test names.
  - Piping a real nudge-bearing Stop payload into `devx learn-helper listen`
    (built CLI) appends exactly one entry to a temp `DEVX_LEARN_HOME` queue.
  - `npx tsx _devx/workstreams/retro-listener/evals/E-7_hook-latency.ts`
    against the built CLI reports p95 < 500ms; the number is recorded in
    the dev spec's status log (G-3's measurement, owned here).

**Tasks**:
- [ ] T1.1 `nudge.ts` pattern + matcher — files: `src/lib/learn/nudge.ts`
- [ ] T1.2 queue store + lock + markers — files: `src/lib/learn/queue.ts`
- [ ] T1.3 listener core (Stop/SessionEnd/guard) — files: `src/lib/learn/listener.ts`
- [ ] T1.4 `listen` subcommand wiring — files: `src/commands/learn-helper.ts`
- [ ] T1.5 listener suite — files: `test/learn-listener.test.ts`
- [ ] T1.6 pin suite — files: `test/learn-nudge-pin.test.ts`
- [ ] T1.7 author E-7 eval script (runs post-build; RED stub until then) — files: `_devx/workstreams/retro-listener/evals/E-7_hook-latency.ts`
- [ ] T1.8 commit this repo's hook registrations (activation) — files: `.claude/settings.json`

### 2. Phase: `learn:` config section

**Overview**: The knobs the watcher reads — `idle_minutes`,
`retro_timeout_minutes`, `home` — as a typed, clamped config section.
Separate small PR so the watcher phases consume a merged, tested reader.

**Files**:
- `src/lib/learn/config.ts` — `LearnConfig`, `LEARN_DEFAULTS` (15 / 360 /
  `~/.claude/devx`), `learnConfigFrom(merged)` per `loopConfigFrom`.
- `_devx/config-schema.json` — `learn:` properties block,
  `additionalProperties: false`.
- `devx.config.yaml` — commented `learn:` section with defaults.
- `test/learn-config.test.ts` — defaults, clamping, fallback on garbage,
  precedence (env > config > default, resolved where consumed).

**Context**:
- The listener must NOT read this (latency); only the watcher and install
  step do. `DEVX_LEARN_HOME` env override continues to work everywhere.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx vitest run test/learn-config.test.ts` green;
    `npm run test:config-validate` (schema smoke) green with the new
    section present in `devx.config.yaml`.

**Tasks**:
- [ ] T2.1 reader + defaults — files: `src/lib/learn/config.ts`
- [ ] T2.2 schema + yaml section — files: `_devx/config-schema.json`, `devx.config.yaml`
- [ ] T2.3 config suite — files: `test/learn-config.test.ts`

### 3. Phase: Watcher core — readiness, allowlist, outcomes, queue ops

**Overview**: Every watcher decision as pure, injectable functions — no
process spawning, no terminal I/O beyond seams. This is where upstream's
five review rounds of semantics live, so it gets its own PR and review.

**Files**:
- `src/lib/learn/watch.ts` — `queuedAt` (original `ts`, requeue keeps
  instant readiness), `sessionOver` (marker ∨ mtime-idle ∨ age-out
  fail-safe; undatable hand-edit = fails the strict ISO regex → serves
  immediately, one test pinning a date-only string), `repoKey` (memoized
  `git rev-parse --show-toplevel` behind an injectable exec seam with a
  per-test memo reset, cwd fallback), `repoLookup`/
  `recordRepoDecision` (`repos.json`), `canPrompt` — **mechanism pinned
  here because Node has no `getpgrp`/`tcgetpgrp` binding**: stdin
  `isatty()` AND `ps -o stat= -p <pid>` reporting a trailing `+`
  (foreground) in STAT, behind an injectable seam; re-checked immediately
  before any prompt (a watcher `bg`'d after startup takes SIGTTIN, which
  stops rather than raises) — `pickReady(interactive,
  skip)` (+ unservable list), malformed-entry classification (no
  `session_id` / no `cwd` → `error-malformed` before prompt/spawn),
  `mapMarkerToOutcome` (`0`→`completed`, ≥128→`completed-interrupted`,
  `error-cd`, other→`error-fork:<status>`, absent→`timeout`), `finish`
  (done-log append + queue removal + marker cleanup), `requeueFromDone`
  (strip `processed_ts`/`outcome`, keep `ts`, add `requeued_ts`, refuse
  pending).
- `test/learn-watch.test.ts` — E-3 readiness matrix (fresh / idle /
  missing-transcript / undatable — the denylist half lives in the Phase 1
  listener suite), E-4 outcome mapping + malformed retirement +
  requeue-keeps-`ts`, allowlist keying (subdirectory → repo-root via the
  exec seam) and `{"": "allow"}` poisoning guard, skip-don't-starve (an
  unservable head entry doesn't block a later servable one; noted once),
  and canPrompt-flip (prompt-ability lost between scan and prompt →
  defer, don't prompt).

**Context**:
- Upstream trap inventory is the test checklist
  (`reference/2026-07-28-retro-listener.md` §"Failure modes"): fail-open
  readiness, cwd-less wedge, allowlist poisoning, requeue idle-window
  re-serve.
- All time via injected `now()`; all fs under a temp `DEVX_LEARN_HOME`.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx vitest run test/learn-watch.test.ts` green with the E-3/E-4 case
    names traceable to expectations.md thresholds (≥4 readiness cases
    incl. undatable — the 6 SessionEnd reason cases (E-10) live in the
    Phase 1 listener suite — all 5 marker mappings, both malformed shapes,
    requeue `ts`
    preserved, skip-don't-starve, canPrompt-flip deferral).

**Tasks**:
- [ ] T3.1 readiness + queuedAt — files: `src/lib/learn/watch.ts`
- [ ] T3.2 repo allowlist + canPrompt — files: `src/lib/learn/watch.ts`
- [ ] T3.3 pickReady + malformed classification — files: `src/lib/learn/watch.ts`
- [ ] T3.4 outcome mapping + finish + requeue — files: `src/lib/learn/watch.ts`
- [ ] T3.5 watcher-core suite — files: `test/learn-watch.test.ts`

### 4. Phase: Watcher CLI — spawn arms, drain loop, `devx learn-watch`

**Overview**: The genuinely new mechanism (tmux/Terminal spawn + trap
wrapper) plus the serial drain loop and CLI surface, composing Phase 3's
pure core. Last of the watcher PRs because it's the one that touches the
outside world.

**Files**:
- `src/lib/learn/spawn.ts` — session-id validation (UUID-shaped regex,
  pre-argv), `buildWrapperCommand(sid, cwd, markerPath)` (tmp+rename
  marker write; `trap 'rc=$?; …' HUP INT TERM`, no EXIT trap; `cd` guard →
  `error-cd`; `DEVX_RETRO=1 claude --resume <sid> --fork-session
  "/devx-learn"`; trailing status write), spawn arms (`$TMUX` →
  `tmux new-window`; darwin → `osascript` Terminal.app **with the
  reference's backslash+quote escaping ported** — the wrapper contains
  both `"` and `\`; else print + `manual`, never awaited) behind a
  `SpawnFn`-style seam.
- `src/lib/learn/watch.ts` (extend) — the drain loop lives in the lib,
  not the command (pure-fn + CLI-passthrough, per `runLoop` /
  `src/lib/loop/driver.ts` precedent): singleton claim via
  `acquirePathLock` (skipped under `--dry-run`; held → exit 1 naming the
  lock), drain iteration (per-run seen-set; once-per-session status
  notes), `awaitMarker` bounded by `retro_timeout_minutes` — poll
  intervals (5s scan, 2s marker) injectable so sequencing tests never
  sleep real wall-clock.
- `src/commands/learn-watch.ts` — thin wiring only: flag parsing,
  `register(program)`, `list` + `requeue <sid>` subcommands, exit-code
  table (0 SIGINT-clean / 1 lock or requeue-miss / 2 usage), line-buffered
  output; `src/cli.ts` registration + `attachPhase`.
- `test/help.test.ts` — refresh the top-level `--help` snapshot for the
  new `learn-watch` command (the inline snapshot pins the full listing).
- `test/learn-watch.test.ts` (extend) — E-4 singleton refusal + E-9 wrapper
  `DEVX_RETRO=1` export (all 3 arms) + wrapper trap shape (no EXIT trap;
  reads `$?`),
  E-5 dry-run byte-identical + not-refused-under-lock + seen-set
  single-print, drain-loop sequencing with a fake spawn seam, the
  `manual` arm (no tmux, not darwin → command printed, entry filed
  `manual` immediately, `awaitMarker` never entered — upstream's
  6h-per-entry queue-hold bug), osascript escaping (wrapper containing
  quotes/backslashes survives the AppleScript literal), and `list` output
  shape (pending + readiness state, last processed + outcomes).
- `docs/SELF_HEALING.md` — short "retro listener" section: how to run the
  watcher, outcome vocabulary, requeue.

**Context**:
- Trap semantics are load-bearing and reviewed against
  `reference/harness-learn-watch` `wrapper_command`/`spawn` docstrings
  (SIGHUP wedge, EXIT-trap race, absorbed Ctrl-C).
- Spawned process is not our child — completion only via marker; SIGKILL
  degrades to `timeout` + requeue hint.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx vitest run test/learn-watch.test.ts` green including the new E-4
    (singleton, `manual` arm), E-5 (dry-run byte-compare), wrapper-shape,
    escaping, and `list`-output cases; `test/help.test.ts` snapshot
    refreshed and green.
  - Human smoke (recorded in the dev spec status log): queue a fake entry,
    run `devx learn-watch --dry-run`, confirm the printed command; then a
    real spawn of a trivial session on this machine (tmux and Terminal
    arms).

**Tasks**:
- [ ] T4.1 wrapper builder + validation — files: `src/lib/learn/spawn.ts`
- [ ] T4.2 spawn arms behind seam — files: `src/lib/learn/spawn.ts`
- [ ] T4.3 drain loop + singleton + awaitMarker — files: `src/commands/learn-watch.ts`
- [ ] T4.4 `list`/`requeue`/`--dry-run` wiring + cli registration — files: `src/commands/learn-watch.ts`, `src/cli.ts`
- [ ] T4.5 CLI/drain suite extensions — files: `test/learn-watch.test.ts`
- [ ] T4.6 watcher docs — files: `docs/SELF_HEALING.md`

### 5. Phase: Hook registration + `/devx-init` distribution

**Overview**: Turn detection on — this repo's committed
`.claude/settings.json` and the idempotent consumer-repo install step.
After the CLI phases so the command the hooks invoke exists in a merged
release.

**Files**:
- `src/lib/init-hooks.ts` — `installHooks({repoRoot, settingsPath?,
  dryRun?})`: parse-or-create settings, deep-merge Stop/SessionEnd entries
  (identify devx-owned by command string `devx learn-helper listen`),
  preserve unknown keys + user entries byte-intact, `writeAtomic` output,
  `{action: created|merged|unchanged}` per file.
- `_devx/templates/init/claude-settings-hooks.json` — the fragment
  (shipped via existing `package.json → files` `_devx/templates` entry).
- `src/lib/init-orchestrator.ts` — wire the install step (user-foreground;
  settings-edit confirmation prompts are acceptable here).
- `test/learn-hook-install.test.ts` — E-8: run-twice 0-byte diff, user
  entries survive byte-intact AND in their original order (an explicit
  ordering assertion — 0 removed, 0 reordered, per the threshold),
  created-vs-merged-vs-unchanged actions, fragment/template agreement with
  this repo's committed `.claude/settings.json` (landed in Phase 1).

**Context**:
- `installSkills`/`decideSkillInstall` ownership discipline is the model;
  hooks are entries inside a shared file rather than whole files, hence
  merge-not-overwrite (design.md §Architecture "Install").
- Memory `project_skill_perms_block_subagents.md`: never install hooks
  from a subagent; init runs user-foreground.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx vitest run test/learn-hook-install.test.ts` green.
  - Human smoke: after merge, print any assistant turn containing the
    nudge sentence in a scratch session in this repo and confirm a queue
    entry appears (recorded in the dev spec status log).

**Tasks**:
- [ ] T5.1 merge-writer lib — files: `src/lib/init-hooks.ts`
- [ ] T5.2 template fragment — files: `_devx/templates/init/claude-settings-hooks.json`
- [ ] T5.3 orchestrator wiring — files: `src/lib/init-orchestrator.ts`
- [ ] T5.4 day-one ownership of the last hop — files: `MANUAL.md` (entry:
      start `devx learn-watch` in a spare terminal — the watcher is opt-in
      and the deferred pending-count surfacing in `devx status`/`devx next`
      has no owner yet; note the follow-up spec option there)
- [ ] T5.5 install suite — files: `test/learn-hook-install.test.ts`

### 6. Phase: `/devx-learn` outlet routing rework

**Overview**: The upstream routing improvement, ported: ordered first-match
over five outlets + three checkability rules. Last and severable — prose +
structural tests only; nothing mechanical depends on it.

**Files**:
- `.claude/commands/devx-learn.md` — replace the four-bucket table with the
  ordered procedure (framework fix · project preference · workstream lesson
  · personal `~/.claude/` snippet, presented never committed · dropped) +
  the three rules; repo predicate and `nudge-canonical` marker
  byte-preserved.
- `skills/devx-learn.md` — via `npm run sync:skills`.
- `test/learn-skill-guards.test.ts` — update/extend: routing section shape
  (five outlets present, ordered, first-match phrasing), marker + mirror
  assertions keep passing.

**Context**:
- The two existing marker tests and E-6's pin must stay green — the marker
  paragraph is untouchable; only the routing sections change.
- Upstream rationale: the four-bucket split asked the same judgment twice
  and had no outlet for one-person preferences (PR #36 §"routing the
  learnings").

**Verification plan**:
- Type: tests-after (prose change; structural tests updated in-PR)
- Success criteria:
  - `npx vitest run test/learn-skill-guards.test.ts
    test/skill-todo-discipline.test.ts test/learn-nudge-pin.test.ts` green;
    `npm run sync:skills -- --check` clean.

**Tasks**:
- [ ] T6.1 routing prose rework — files: `.claude/commands/devx-learn.md`
- [ ] T6.2 mirror sync — files: `skills/devx-learn.md`
- [ ] T6.3 guard-test updates — files: `test/learn-skill-guards.test.ts`
