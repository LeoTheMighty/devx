# PRD — Retro Listener (auto-spawn `/devx-learn` from the friction nudge)

<!-- Stage: PRD. Gate: `devx gate prd 620c74`. Every concrete item gets a
     stable ID (G-/UC-/CAP-/FR-). IDs are never renumbered. Traceability is
     by ID, not by prose. -->

## Problem

The `/devx-learn` self-improvement loop has one unautomated hop left: a human
noticing the friction-observed nudge at session wrap-up and remembering to run
`/devx-learn` — at the exact moment they are context-switching away. The nudge
prints (its canonical sentence lives at the `nudge-canonical` marker in
`.claude/commands/devx-learn.md`, referenced by `/devx` and `/devx-plan`
wrap-ups), and then the signal dies at the terminal: running the retro inline
taxes an already-long context, deferring it means the nudge scrolls away.
Nudge frequency grows with harness usage, so the manual relay gets lossier
monotonically.

The upstream fix already exists and is field-hardened: mycase/8am-harness
PR #36 ("retro-listener", accepted design doc + five review rounds) makes the
nudge machine-detected and the hand-off automatic. A Stop hook greps the
just-finished turn for the canonical sentence and enqueues the session; a
serial watcher waits until the session is over, then spawns an interactive
fork of the original thread (`claude --resume` the session id with
`--fork-session "/devx-learn"`) in a new tmux/Terminal window. The retro arrives with the full
thread as native context; the human's role shrinks from "remember to run it"
to "prune and approve the mined table" — the part that must stay human anyway.
This workstream ports that design to devx natively: TypeScript CLI surfaces in
`@devx/cli` instead of Python scripts, vitest structural pins instead of a
standalone lint, and `devx.config.yaml` knobs instead of raw env vars.

## Goals

<!-- User goals in prose; business/project goals MUST be numeric + dated so
     /devx outcome can score them later. -->

- **G-1**: By 2026-09-30, ≥3 watcher-spawned `/devx-learn` retros have run to
  completion (done-log `completed` rows), and ≥1 of them produced a merged
  `fw/learn-*` PR or LEARN.md candidate line.
- **G-2**: By ship date, the nudge→queue wire protocol is structurally
  guaranteed: the hook's detection pattern is pinned against the
  `nudge-canonical` marker by a CI-gated test (0 possible silent-deafness
  reword regressions), and the self-trigger guard is mechanical (0 retro-of-
  retro loops possible by construction, verified by test).
- **G-3**: By ship date, the listener hook adds < 500ms p95 per Stop event on
  the reference machine (darwin, warm node), measured and recorded in the
  RED-report or a status-log line — the hook fires at every turn end in every
  hooked repo, so startup cost is a per-turn tax.

## Non-goals

- **Phase 2 (unattended headless retros → draft PR)** — explicitly deferred
  upstream and here; it moves `/devx-learn`'s approval boundary (a documented
  refusal condition) and needs its own proposal anchored on this phase's
  done-log dataset.
- **Changing `/devx-learn`'s approval boundary in any way** — the spawned
  retro is interactive; the human still prunes the evidence table before any
  write. What becomes automatic is *noticing*; *judging* stays manual.
- **Parallel retros / per-retro worktrees** — serial by design; concurrent
  retros collide in one checkout and race the learn-branch dedupe. Expected
  nudge volume does not justify parallelism.
- **Garbage collection of queue/done-log/markers** — upstream records this as
  a deliberate non-feature at realistic volumes; we inherit that call and the
  "the day `list` feels slow is the day it earns a `--prune`" trigger.
- **Windows support for the spawn arm** — tmux and macOS Terminal are the two
  spawn targets; anything else degrades to a printed command + `manual`
  outcome, same as upstream Linux-without-tmux.

## Users

- **Primary**: the devx dogfooding engineer (Leo) — runs long `/devx` /
  `/devx-plan` sessions in this repo and consumer repos, wants friction
  mined without remembering to do it.
- **Secondary**: future consumer-repo users who install devx via
  `/devx-init` and inherit the hook + watcher with zero per-repo setup.
- **Anti-persona**: CI / headless automation — the watcher spawns
  *interactive* sessions for a human; nothing here runs unattended to
  completion.

## Use cases

- **UC-1**: An engineer finishes a session whose wrap-up printed the nudge,
  closes the terminal, and walks away; later, the running watcher spawns a
  retro tab forked from that session; the engineer prunes the mined table and
  approves — no re-mining, no lost signal.
- **UC-2**: An engineer starts the watcher after a day of work with three
  sessions queued; retros arrive one at a time — ending one (any normal way:
  `/exit`, Ctrl-D, closing the tab) is what advances to the next.
- **UC-3**: An engineer closes a retro tab midway; the entry is recorded as
  interrupted, not lost; `devx learn-watch requeue <sid>` puts it back.
- **UC-4**: A spawned retro quotes the canonical nudge sentence while mining
  it; nothing re-queues — the loop cannot self-trigger.
- **UC-5**: A nudge fires in a repo the engineer doesn't want retros for; the
  watcher asks once per repo and remembers the deny.
- **UC-6**: An engineer sanity-checks their setup with `devx learn-watch
  --dry-run` while the real watcher is running; commands are printed, nothing
  is consumed or written.

## Capabilities

- **CAP-1**: Detect the canonical nudge in the just-finished turn at Stop,
  and enqueue the session durably (dedupe per session, atomic append,
  never blocks or fails the turn).
- **CAP-2**: Know when a session is actually over — SessionEnd fast-path
  marker (with a reason denylist) plus transcript-idle fallback that fails
  safe when there is nothing to stat.
- **CAP-3**: Spawn exactly one interactive forked retro at a time, in a new
  tmux window or macOS Terminal window, from the session's original cwd, and
  observe its outcome through every exit path a shell can see (exit-status
  completion markers via signal traps; bounded wait for the SIGKILL case).
- **CAP-4**: Operate the queue: list pending/processed, requeue a processed
  entry, dry-run without consuming, refuse a second concurrent drainer.
- **CAP-5**: Keep the wire protocol intact structurally: the hook pattern and
  the `nudge-canonical` marker are pinned to each other by a CI-gated test
  (wording equality — whitespace-collapsed substring), extending the two
  existing marker tests.
- **CAP-6**: Install itself: hook registration for this repo (checked-in
  `.claude/settings.json`) and for consumer repos via `/devx-init`
  (idempotent, ownership-respecting, same discipline as `installSkills`).

## Feature requirements

### FR-1: Listener hook command (`devx learn-helper listen`)

A CLI subcommand invoked by Claude Code Stop and SessionEnd hooks, reading
the hook JSON payload from stdin. On **Stop**: if `last_assistant_message`
contains the canonical nudge pattern (whitespace-collapsed matching, so
hard-wrapping cannot break it), append `{session_id, transcript_path, cwd,
ts}` to the user-global queue JSONL, skipping if that `session_id` is already
pending (append + dedupe check under the queue lock). On **SessionEnd**: if
the reason is not in the denylist (`clear`, `resume`,
`bypass_permissions_disabled`, `logout` — denylist, not allowlist, so an
upstream reason rename degrades to idle-fallback, not silence) and the
session is pending, drop a `<sid>.ended` marker. Guards: return before
reading stdin when `DEVX_RETRO=1` (the mechanical self-trigger bound); exit 0
on every path including garbage stdin — a hook that can fail a turn is worse
than a missed detection.

### FR-2: Hook registration + installation

Stop and SessionEnd hook registrations invoking FR-1: (a) checked into this
repo's `.claude/settings.json`; (b) shipped as an init template and written
idempotently into consumer repos by `/devx-init` (net-new install step
modeled on `installSkills` — ownership discipline, atomic write, never
clobber user-edited settings; merge into existing `settings.json` rather
than overwrite). Where the harness rides a plugin's `hooks/hooks.json`, devx
rides project settings — that is the porting delta this FR owns.

### FR-3: Serial watcher (`devx learn-watch`)

A long-running foreground CLI (shape: `devx loop`). Refuses to start if
another watcher holds the singleton lock (`acquirePathLock`-style fail-fast;
`--dry-run` exempt). Poll loop: pick the first ready entry it can serve —
ready = `.ended` marker exists, or transcript mtime idle beyond the window,
or (no transcript to stat) entry age beyond the window (fail-safe, never
instant-ready); servable = repo allow-decision known or promptable
(prompt-ability re-checked at prompt time; foreground-process-group test,
not just isatty). Malformed entries (no `session_id` or no `cwd`) are
retired as `error-malformed` before the prompt or spawn can see them. Spawn
the retro interactively in a new tmux window (inside tmux) or macOS Terminal
window, from the entry's cwd, wrapped so a completion marker carrying
`claude`'s exit status lands on every exit path (`trap 'rc=$?; …' HUP INT
TERM`, deliberately no EXIT trap; `DEVX_RETRO=1` exported; tmp+rename marker
write). Await the marker with a bounded timeout (default 360 min); translate
to outcomes: `completed`, `completed-interrupted` (status ≥ 128),
`error-cd`, `error-fork:<status>`, `timeout`, `manual` (no tmux, not
darwin — print the command, file immediately, never await), `error-spawn`,
`skipped-denied-repo`. Session IDs are validated before argv construction
(injection guard, per the mgr104 discipline).

### FR-4: Queue operations (`list`, `requeue`, `--dry-run`)

`devx learn-watch list`: pending entries with readiness state + last
processed entries with outcomes. `devx learn-watch requeue <sid>`: move the
most recent done-log entry for `<sid>` back onto the queue (keeping the
original `ts` so a requeued session is instantly ready), refusing if already
pending. `--dry-run`: print the spawn command for each ready entry and
change nothing — no marker, no done-log row, no queue rewrite; a per-run
seen-set prevents re-printing the head entry.

### FR-5: Wire-protocol pin (vitest, CI-gated)

A structural test asserting: the hook's detection pattern is a
whitespace-collapsed substring of the prose following the `nudge-canonical`
marker in `.claude/commands/devx-learn.md`; rewording the marker without
updating the pattern fails CI in the same PR. Extends (does not duplicate)
the two existing marker tests (`test/learn-skill-guards.test.ts`,
`test/skill-todo-discipline.test.ts`). The pattern lives in exactly one place
in the TS source, commented back to the marker.

### FR-6: Config (`learn:` section)

`devx.config.yaml` gains a `learn:` section + schema + typed reader
(`learnConfigFrom`, patterned on `loopConfigFrom`): `idle_minutes` (default
15), `retro_timeout_minutes` (default 360), `home` (queue/marker dir
override; default user-global so one watcher serves many repos). Env
overrides accepted where the watcher runs outside a repo checkout.

### FR-7: Outlet routing rework in `/devx-learn` (port of upstream's routing)

Replace the current four-bucket table in `.claude/commands/devx-learn.md`
with the upstream ordered **first-match** routing: framework fix (evidence
claim, not plausibility) · project preference (`devx.config.yaml` proposal) ·
product/workstream lesson (LEARN.md candidate) · **personal preference
(`~/.claude/` snippet — presented, never committed)** · dropped. Plus the
three checkability rules: name the question that decided the bucket;
promotion to framework fix requires evidence; a coin flip takes the narrower
outlet and records the ambiguity. Keep the existing repo predicate and the
`nudge-canonical` marker byte-intact (FR-5 and the existing tests depend on
it). Skill edits run `npm run sync:skills`.

## Evals seed

<!-- Raw material for expectations.md — behaviors worth pinning, thresholds
     worth measuring. Promoted into E-blocks before Gate 1. -->

- Stop payload with the canonical sentence → exactly one queue entry;
  duplicate session → still one; hard-wrapped sentence → still detected;
  reworded sentence → not detected.
- `DEVX_RETRO=1` → listener exits 0 without touching the queue.
- SessionEnd with denylisted reason → no marker; unknown reason → marker.
- Two watchers → second refuses; `--dry-run` under a held lock → allowed.
- Marker `0` → `completed`; `129` → `completed-interrupted`; missing after
  timeout → `timeout`; malformed entry → retired without prompt/spawn.
- `--dry-run` leaves queue + done-log byte-identical.
- Hook pattern ⊂ marker prose (whitespace-collapsed) — fails on reword.
- Hook wall-clock per Stop invocation on darwin < 500ms p95.

## Open questions

- None blocking Gate 1. Two decisions made here rather than deferred, per
  YOLO/send-it, recorded for the design stage: (a) hook implemented as a
  `devx` CLI subcommand (TS, vitest-testable, one stack) rather than a
  shipped Python script — trade-off is node startup per Stop event, bounded
  by G-3; (b) FR-7 (outlet routing) included as its own late phase — prose
  + tests only, severable if it drags.

## Reference links

- Spec: `plan/plan-620c74-2026-07-29T11:56-retro-listener.md`
- Upstream: mycase/8am-harness PR #36 (`fw/retro-listener`) — design doc
  `docs/updates/2026-07-28-retro-listener.md`; local copies of the accepted
  sources (design doc, `learn-listener.py`, `harness-learn-watch`,
  `lint_nudge.py`, `hooks.json`) mirrored under
  `_devx/workstreams/retro-listener/reference/`.
- The wire protocol's devx end: `.claude/commands/devx-learn.md`
  (`nudge-canonical` marker), pinned by `test/learn-skill-guards.test.ts` +
  `test/skill-todo-discipline.test.ts`.
- Reuse surfaces: `src/lib/manage/lock.ts` (`acquirePathLock*`),
  `src/lib/supervisor-internal.ts` (`writeAtomic`), `src/lib/loop/state.ts`
  (`appendEvent` JSONL precedent), `src/lib/manage/spawn.ts` (spawn seam +
  argv guard), `src/lib/init-skills.ts` (install discipline),
  `src/lib/loop/config.ts` (config-section pattern),
  `src/commands/loop.ts` (long-running command shape).
- LEARN.md budget: "attended-era contracts break on first unattended
  contact" (the watcher is semi-unattended — upstream's five review rounds
  are the trap inventory: SIGHUP wedge, dry-run drain, fail-open readiness,
  double-drainer, cwd-less entries); "atomic state writes via tmp+rename";
  "pure-fn + CLI-passthrough trio".
