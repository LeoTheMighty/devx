# Design — Multi-Loop Concurrency

<!-- Stage: Design. Gate: `devx gate coverage <hash>` (design mode — one
     tri-state row per G-/UC-/CAP-/FR- ID in prd.md). Hard rule: don't plan
     here. No phases, no tasks — design is the approach, not the sequence. -->

## Overview

- **Objective**: N `devx loop` processes (plus interactive `/devx` sessions
  and the `devx manage` daemon) safely share one repo's backlog, claim
  arbitration, and observability — with optional per-loop scope
  (epic/workstream/ticket-list/specialty) — such that overlap and absence
  of scope degrade to polite contention, never to corruption or spurious
  aborts (CAP-7).
- **Solution**: keep markdown+git as ground truth and O_EXCL lock files as
  the only primitive; add (1) a canonical repo root so every process lives
  in one state universe, (2) a single short-lived **backlog mutation lock**
  serializing every backlog/spec write and main-checkout git operation,
  (3) claim-contention semantics (rebase-retry, contended ≠ failed,
  lock-aware picking), (4) a liveness-classified spec-lock lifecycle
  reusing the mgr106 classifier, (5) a per-run **loop instance registry**
  replacing the singleton loop state, and (6) a scope model implemented on
  the existing mask-to-blocked mechanism. The system has exactly **one
  blocking lock** (backlog.lock); every other lock is fail-fast O_EXCL —
  deadlock is impossible by construction.

## Constraints

- Ejectability (D-2): all state stays as markdown + git + flat files under
  `.devx-cache/`; no daemon, no database, no queue server.
- Single machine, local filesystem: O_EXCL semantics assumed reliable; NFS
  and multi-host are out of scope (PRD anti-persona).
- The PR/CI/merge-gate flow is untouched (D-11); GitHub remains the
  serializer for code landing on main.
- N=1 back-compat (FR-7): a bare `devx loop` keeps today's observable
  behavior; existing tests survive with mechanical-only updates.
- Harness constraint: skill-body edits ship via normal PR files (packaged
  mirror `skills/` + `.claude/commands/` must stay in sync — pin101 drift
  guard).
- YOLO + send-it: prefer constants over new config knobs; the only new
  config surface is reading the already-declared `capacity.max_concurrent`.

## Risks

- Coarse backlog lock becomes a bottleneck or wedge → sections are
  milliseconds-to-seconds (file rewrite + pathspec commit); push-bearing
  claim section bounded by retry cap; 30s acquire timeout with a
  diagnostic naming the holder pid → proven by E-1, E-4.
- Deadlock between lock types → structurally excluded: backlog.lock is the
  only *blocking* acquire in the codebase; spec locks and instance locks
  are fail-fast O_EXCL (claim's reap+acquire runs inside the backlog
  critical section, so even reap races serialize) → proven by E-1.
- PID-recycling misclassification reaps a live claim → reuse the
  battle-tested mgr106 `classifyExistingLock` (dead-PID, start-time
  cross-check with 2s grace — the mgrret macOS `ps -o etime=` lesson),
  extracted rather than re-implemented → proven by E-3.
- Two loops mutually starve on the same top item (both mask it, both move
  on) → masking only applies to *live-held* locks; an unclaimed item is
  claimed by whoever wins O_EXCL, loser masks and advances → proven by
  E-1.
- `devx next`/`status` drift against the new state shape → LEARN
  first-real-run rule: run both against the live repo (with a live loop)
  before the registry PR merges → proven by E-5.
- Scope with empty intersection (all masked) → loop exits with the
  existing "no eligible backlog items" stop reason, echoing the active
  scope in the report → proven by E-6.
- Attended `/devx` sessions bypass new discipline → claim/release/backlog
  writes all live in the CLI primitives the skill already calls
  (`devx devx-helper claim`, merge tail); no new skill-side obligations →
  proven by E-1 (same code paths).

## Trade-offs

- **Runtime arbitration over enforced partitioning**: no ownership map, no
  reservation protocol — scope only *masks*; the spec lock is the sole
  authority on "who has this item." Simpler, and safety holds when humans
  mis-scope (CAP-7).
- **One coarse backlog lock over per-file locks**: contention is trivial
  at N≤5 and sections are short; per-file locking would reintroduce
  ordering/deadlock questions for zero measured benefit.
- **Loops drop `manager.lock`** (it stays manage-daemon-only): the old
  loop⇄manage mutual exclusion becomes arbitration through the same spec
  locks + backlog lock every other actor uses. More concurrency, one rule.
- **Flags over config for scope**: scope is a property of an invocation,
  not of the repo; config stays untouched.
- **PID-liveness auto-reap; TTL demoted to WARN + doctor**: a live-PID
  lock is never auto-reaped (a legit item can run for hours across
  iterations); wedged-but-alive owners are a WARN in `devx next` drift +
  a `devx doctor --fix` action (db36af), not an automatic kill.
- **Stop writing legacy `loop/state.json` rather than dual-write**: the
  reader (`gather.ts`) falls back to the legacy file only when no
  instances dir exists (old binary's run); dual-writing a "newest wins"
  singleton under N loops is exactly the R6 garbage we're removing.
  (Refines FR-5's "written for one release" sketch — recorded under
  Resolved design questions.)

## Out of scope

- Cross-loop shared token budget (Q#13c: follow-up workstream).
- File-overlap conflict advisory/gate (PRD non-goal; follow-up on
  evidence).
- Fleet layer, multi-machine locking, PR/merge-flow changes (PRD
  non-goals).
- Lifting `HARD_CAP_PHASE_1` for manage-spawned workers (manage's
  reconcile keeps its cap; this workstream only stops conflating "a
  manager exists" with "one unit of work in flight" for loops).

## Assumptions

- `git rev-parse --git-common-dir` reliably identifies the main worktree
  for both the main checkout and linked worktrees (git ≥2.5; the repo
  already depends on `git worktree`).
- O_EXCL open is atomic on APFS/ext4 (same assumption mgr106 already
  makes).
- DEV.md `### Epic — <name> (plan: <hash>)` headings are the stable epic
  grouping convention (they are hand-authored today; parser treats a row
  before any heading as epic-less).
- The claim commit → push-to-main flow stays (memory rule: push claim
  before PR); contention handling wraps it rather than replacing it.
- `capacity.max_concurrent` (devx.config.yaml:24, currently unread) is
  the intended admission knob (INTERVIEW Q#13a, default 5).

## Discarded considerations

- **Central dispatcher daemon / work-queue server** assigning items to
  loops — violates D-2 (state leaves markdown+git), adds a daemon to
  babysit; arbitration needs no coordinator.
- **Git-native claiming only** (claim commit push as the sole lock, no
  local lock files) — every claim pays a network round trip; rollback
  races on push failure are exactly R2; local O_EXCL is cheaper and
  already exists.
- **flock()/fcntl advisory locks** — different failure semantics per
  platform, invisible on disk, inconsistent with the existing
  lock-file-with-classifier pattern the repo has hardened twice.
- **Per-loop DEV.md shards** (split backlog per partition) — breaks the
  single-backlog human contract and every existing parser/consumer.
- **File-ownership manifests as a claim gate** — the only sources
  (`Parallel-safe with…` prose, plan.md `**Files:**` bullets) are
  unparsed prose with no freshness guarantee; gating on them would
  manufacture false confidence (kept as a possible *advisory*, and only
  as a follow-up).
- **Blocking-wait spec locks** (queue on a held item instead of skipping)
  — head-of-line blocking across loops; skipping to the next ready item
  is strictly better for throughput and is deadlock-free.

## Wrap, don't duplicate

- Reuses: `acquirePathLockBlocking` (`src/lib/manage/lock.ts:211`) as the
  backlog lock engine; `classifyExistingLock` (`src/lib/manage/lock.ts:259`)
  extracted to a shared module and consumed by manager, spec, and
  instance locks; `writeAtomic` (`src/lib/supervisor-internal.ts:85`) for
  every state write; `claimSpec`'s 6-step transaction (`src/lib/devx/
  claim.ts`) — wrapped, not rewritten; the excluded-set mask-to-blocked
  mechanism (`src/lib/loop/driver.ts:325-332`) generalized for scope;
  `reconcile` (`src/lib/manage/reconcile.ts`) unchanged as the picker
  core; `parseDevMd` (`src/lib/backlog/parse.ts`) extended, not forked;
  the workstream-membership walk (`src/lib/next/gather.ts:477-563`)
  extracted for scope resolution; `isFresh` heartbeat windows
  (`src/lib/next/gather.ts:752-768`) for instance freshness; the morning
  report renderer (`src/lib/loop/report.ts`) gains a scope header line
  only.
- Adds: `src/lib/repo-root.ts` (canonical root resolver + worktree
  refusal); `src/lib/locks/classify.ts` (the extraction target);
  `src/lib/backlog/mutate.ts` (`withBacklogLock`); `src/lib/devx/
  spec-lock.ts` (JSON lock body + lifecycle); `src/lib/loop/instances.ts`
  (registry + admission); scope model in `src/lib/loop/scope.ts`;
  epic-stamping fields on `DevRow`.

## Design

### Architecture

Six components, composing outside-in:

1. **Canonical root** (`src/lib/repo-root.ts`). `resolveRepoRoot(cwd)`
   runs `git rev-parse --git-common-dir --show-toplevel`, derives the
   main-worktree root, and reports `{root, cacheDir, isLinkedWorktree}`.
   `devx loop` and `devx manage` entry points (`src/commands/loop.ts:57`,
   `src/commands/manage.ts:100,126`) refuse `isLinkedWorktree` with an
   error naming `root` (override: `--allow-worktree-root`, test-only);
   both pass the canonical `cacheDir` down explicitly — killing R1's
   forked-universe class and manage's cwd-relative `".devx-cache"`
   default. `findProjectConfig` keeps finding `devx.config.yaml`, but the
   config must resolve at the canonical root.

2. **Backlog mutation lock** (`src/lib/backlog/mutate.ts`).
   `withBacklogLock(cacheDir, label, fn)` = `acquirePathLockBlocking` on
   `locks/backlog.lock` (timeout 30s, poll 20ms — constants, not knobs)
   around `fn`. Every mutator of DEV.md/DEBUG.md/PLAN.md/spec files and
   every git operation on the main checkout moves inside it: the claim
   transaction (`claim.ts:534-737` + worktree add `:772`), the driver's
   `setBacklogRow`/`markBacklogRowDone`/`commitOnMain`/`pushMain`/
   `finalizeMerged`/`releaseSpecLock` blocks (`driver.ts:1032-1052,
   908-973, 1736-1804, 937-954`), manage's `applyBlocking` writers
   (`manage/loop.ts:536,598,644` — converted to `writeAtomic` in the same
   change), and gate's engine-frontmatter patch (`commands/gate.ts` via
   `engine/workstream.ts:61`, likewise converted). Worker-side worktree
   git-tx (`git-tx.ts`, cwd=worktree) stays lock-free — worktrees are
   per-item by construction.

3. **Claim contention** (`src/lib/devx/claim.ts` + `driver.ts`). Inside
   the locked claim section, a rejected push (`claim.ts:693`) triggers
   `git pull --rebase origin <default_branch>` + re-push, ≤2 retries;
   still-lost ⇒ new `ClaimContendedError`. The driver maps it to a
   `item:claim-contended` event: mask the hash for this pass, pick next,
   `consecutiveClaimFailures` untouched (`driver.ts:566-591` split into
   contended vs failed). `finalizeMerged`'s `pull --ff-only`
   (`driver.ts:1758`) gets one fetch+retry under the lock. `pickNextItem`
   (`driver.ts:298`) masks rows whose spec lock classifies as
   *live-held* (component 4), so contention is mostly avoided pre-claim
   (R8).

4. **Spec-lock lifecycle** (`src/lib/devx/spec-lock.ts` + extraction
   `src/lib/locks/classify.ts`). Lock body becomes JSON
   `{schema: 1, pid, pid_started_at, session, claimed_at}`. Acquisition:
   O_EXCL; on EEXIST, classify the holder — dead PID / recycled PID
   (start-time vs claimed_at with the 2s grace) ⇒ reap + retry once;
   live ⇒ held. Legacy bodies (`<token>\npid=<n>\nclaimed_at=<ts>`) are
   parsed for their `pid=` line and classified identically — today's
   stale `spec-494590.lock` is reaped on first contact (G-3). The
   reap+acquire pair and every release run inside `withBacklogLock`;
   release re-reads the body and unlinks only on session match (closes
   R7's TOCTOU and the delete-a-peer's-lock path). Live-PID locks older
   than a 2h constant raise a WARN in `devx next` drift and a
   `devx doctor` finding — never auto-reaped.

5. **Instance registry** (`src/lib/loop/instances.ts`). Per run:
   fail-fast `locks/loop-<run-id>.lock` + atomic
   `loop/instances/<run-id>.json`
   `{schema: 1, run_id, pid, pid_started_at, started_at, scope, status,
   current_item, iteration, ts}`; the driver's existing heartbeat interval
   (`driver.ts:505-509`) rewrites it. Admission at startup: count
   instances that are fresh (`isFresh` window) AND live-PID; ≥
   `capacity.max_concurrent` ⇒ refuse (exit 1, message naming the knob,
   the count, and the live run-ids). Exit/finalize marks
   `status: stopped` and removes the instance lock; crash-orphaned
   instances age out via freshness + PID classify, reaped by the next
   loop start (mirroring `recoverStaleLoopState`, `state.ts:140`). New
   code stops writing `loop/state.json`; `gather.ts:771-807` reads
   `loop/instances/` first and falls back to the legacy file only when
   the dir is absent. `devx next` row 1 payload becomes
   `loops: [{run_id, scope, current_item, iteration}]`; `devx status`
   gains the same section. Scratch namespacing: skill bodies write
   `.devx-cache/scratch/${SESSION}/…` (mirror pair edited together;
   R11).

6. **Scope model** (`src/lib/loop/scope.ts` + `parse.ts` + `worker
   prompt`). `parseDevMd` tracks `### Epic — <name> (plan: <hash>)`
   headings and stamps rows with `{epicSlug, epicPlanHash}` (additive;
   rows above any heading get nulls). `buildScopeMask(rows, scope)`
   returns the mask set fed to the existing exclusion mechanism:
   `--epic` matches epicSlug or epicPlanHash (Q#13b: both, normalized);
   `--workstream` resolves membership via the extracted
   frontmatter walk; `--items` restricts to the listed hashes AND
   overrides pick order to list order; `--exclude` masks by hash or epic;
   out-of-scope rows are masked to `blocked` so cross-scope `Blocked-by:`
   edges keep holding (the audit's key finding: blocker status lookup is
   already global). An in-scope item blocked by an out-of-scope
   unfinished item is reported (event + morning report line) with the
   blocking hash named. `--focus` text is appended verbatim to
   `buildIterationPrompt`'s frame (`iteration.ts:327-358`) as a
   "Specialty directive" line. Scope is embedded in the instance file,
   the report header, and echoed by the admission/startup log.

### Test architecture (the G-1 harness)

The overlap harness (E-1) is an in-process integration test, not a
subprocess orchestration: `runLoop` already exposes programmatic seams for
everything nondeterministic (`RunLoopOpts` — `exec`, `worker`, `tail`,
`claim`, `now`, `sleep`, `pidAlive`, `acquireLock`, `cacheDir`;
`driver.ts:154-183`). The harness starts two concurrent `runLoop` calls
against one tmpdir git fixture (real claim/spec-lock/backlog/instance
code, fake workers that "implement" items instantly, fake tail that
"merges" by flipping the fixture), with deterministic interleavings driven
through seeded fake `sleep`/`now` schedules (≥3 seeds per E-1's
threshold). The serial baseline is the same fixture run through one loop;
assertions compare merged-item sets, final DEV.md bytes, and event
streams. E-2/E-3/E-4/E-5/E-6 reuse the same fixture builder at smaller
scope. This runs under the existing vitest suite (it is fast — no real
claude, no real gh), keeping G-1's "CI-runnable" clause literal.

### Interfaces

- CLI: `devx loop [--epic S]… [--workstream S]… [--items h1,h2,…]
  [--exclude S]… [--focus TEXT] [--allow-worktree-root]` (all compose
  with the existing flags; repeatable flags accumulate). Exit codes
  unchanged: 1 now also covers admission-refused and worktree-refused
  (distinct messages); 4 covers malformed scope flags (unknown epic slug,
  bad hash shape — fail-fast validation against the parsed backlog).
- Library (new/changed): `resolveRepoRoot(cwd)`;
  `withBacklogLock(cacheDir, label, fn)`; `acquireSpecLock(cacheDir,
  hash, meta)` / `releaseSpecLock(cacheDir, hash, session)` /
  `classifySpecLock(body)`; `registerInstance` / `heartbeatInstance` /
  `finalizeInstance` / `listLiveInstances` / `admitLoop(cacheDir, cap)`;
  `buildScopeMask(rows, scope)`; `DevRow` + `{epicSlug?, epicPlanHash?}`;
  `pickNextItem` + `{scope}`; `ClaimContendedError`.
- `devx next` JSON row 1: `detail` unchanged in shape, gains
  `loops: [{run_id, scope, current_item, iteration}]`; absence of the
  field = old binary (consumers tolerate).

### Data

- `locks/backlog.lock` — transient O_EXCL file via
  `acquirePathLockBlocking`; body `{pid, acquired_at}` (existing shape).
- `locks/spec-<hash>.lock` — JSON v1 as above; legacy 3-line format
  read-supported until doctor reports none remain (no proactive rewrite —
  locks are short-lived by nature once reaping exists).
- `locks/loop-<run-id>.lock` — O_EXCL, `{pid, acquired_at}`.
- `loop/instances/<run-id>.json` — JSON v1 as above, `writeAtomic`,
  heartbeat-refreshed; deleted by clean exit's finalizer? No — kept with
  `status: stopped` for the morning-report window (matches today's
  state.json semantics), reaped by the next run start after 24h.
- `loop/state.json` — legacy read-only fallback; never written by new
  code.
- `.devx-cache/scratch/<session>/` — session-keyed scratch; contents are
  disposable, reaped opportunistically at loop start after 7 days.
- No devx.config.yaml schema changes; `capacity.max_concurrent` gains its
  first consumer.

## Migration plan

- First new-binary run on a repo with old debris: legacy spec-lock bodies
  classify via their `pid=` line (dead → reaped at next claim of that
  hash; `devx doctor` (db36af) reaps offline); a leftover
  `loop/state.json` stays readable until the first new-format run creates
  `loop/instances/`; fixed-name scratch files are ignored and removed by
  the 7-day reap.
- Old binary racing new binary is NOT supported (same-machine self-race
  during upgrade): documented, not defended — the admission/lock files
  the old binary doesn't know about make it equivalent to today's
  unprotected state, no worse.
- Existing tests: lock-body fixtures update to JSON v1 (mechanical);
  `loop/state.json` assertions retarget to `loop/instances/`; everything
  else per FR-7/E-8.

## Resolved design questions

- Legacy `loop/state.json` dual-write (FR-5 sketched "one release") →
  **dropped in favor of read-fallback**: dual-writing a singleton under N
  writers reproduces R6; the only consumer (`gather.ts`) is in-package
  and updates in the same PR. Decided here; FR-5's intent (no external
  reader breaks) is preserved.
- Spec-lock TTL auto-reap (FR-4 sketched "warn-then-reap") → **WARN +
  doctor only for live-PID owners**; auto-reap stays PID-liveness-based.
  A live item legitimately runs for hours (8 iterations × 60min awake
  ceiling); killing live claims on a timer reintroduces the
  resume-collision class roc101 closed. Decided here, consistent with
  mgr106's conservative posture.
- Lock ordering / deadlock → single blocking lock (backlog.lock); all
  other locks fail-fast; reap+acquire serialized under backlog.lock. No
  ordering discipline needed beyond "spec-lock waits never block."
- Does manage still exclude loops? → No; `manager.lock` becomes
  manage-daemon-only (two manage daemons still excluded). Loops and
  manage arbitrate through spec locks + backlog lock like every other
  actor.

## Unresolved design questions

- Q#13a/13b/13c (INTERVIEW) — non-blocking; defaults applied (cap 5;
  `--epic` accepts slug or hash; shared token budget deferred). None
  gates a P0.
- Whether `--workstream` should also accept a plan hash (symmetry with
  `--epic`) — resolve at plan stage when the flag parser is specced;
  zero-cost either way.
