# PRD — Multi-Loop Concurrency

<!-- Stage: PRD. Gate: `devx gate prd <hash>`. Every concrete item gets a
     stable ID (G-/UC-/CAP-/FR-). IDs are never renumbered. Traceability is
     by ID, not by prose. -->

## Problem

`devx loop` is serial by construction (one item in flight; the reconcile
roster is always empty) and singleton by lock (`manager.lock`), while the
backlog holds independent epics — mobile, portability, loop-hardening —
that could ship in parallel overnight. The owner wants to run several
loops at once, each with a specialty: one per epic, or one per explicit
ticket list, without them conflicting.

Worse, the current machinery is unsafe even against *accidental*
concurrency. A 2026-07-28 three-agent code audit (race inventory R1–R12,
recorded in `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`)
found: the manager lock is keyed to a cwd-resolved root, so a loop started
inside a worktree silently forks the entire state universe (R1); a lost
claim-push race burns the run's failure budget — three lost races abort a
healthy run (R2); backlog writes are unlocked read-modify-write, so
concurrent flips are silently lost (R3); `loop/state.json` is a single
slot two loops would ping-pong (R6); spec locks are never reaped — a stale
`spec-494590.lock` sits on disk today blocking its hash forever (R12).

This is the "attended-era contracts break on first unattended contact"
cross-epic pattern (`LEARN.md § Cross-epic patterns`) applied to
concurrency: the contracts were built and reviewed under a one-process
assumption. This workstream removes the assumption structurally.

## Goals

<!-- Business goals numeric + dated so /devx outcome can score them. -->

- **G-1**: By 2026-08-15, a CI-runnable concurrency harness drives two
  in-process loops over the same fake backlog with **overlapping** scopes
  and proves: zero lost backlog updates, zero corrupted files, zero
  contention-caused aborts, and merged-item union equal to a serial
  baseline run. (Overlap-safety is the load-bearing goal — safety must
  never depend on correct human partitioning.)
- **G-2**: By 2026-08-31, one real overnight session runs ≥2 concurrent
  `devx loop` processes with different scopes on this repo, each merging
  ≥1 PR, with `devx next`/`devx status` reporting every live instance and
  per-instance morning reports reconciling cleanly (no orphaned locks, no
  DEV.md drift needing manual repair).
- **G-3**: By 2026-08-15, zero known stale-state debris classes remain
  unreapable: a dead-owner spec lock is reclaimed automatically at claim
  time in ≤1 claim attempt (today: blocked forever).

## Non-goals

- **Cross-loop shared token budget** — per-process budgets stay; N loops
  spend N× the configured totals in v1 (INTERVIEW Q#13c; follow-up
  workstream).
- **File-overlap conflict gating** — two scoped loops may still collide on
  shared source files; that surfaces as a PR merge conflict, which the
  existing fix-forward flow already handles safely. A claim-time advisory
  from plan.md `**Files:**` bullets is a named follow-up, shipped only if
  real overnight runs show waste.
- **Multi-repo fleet** (`f1d6b2`) — orthogonal: fleet = many repos × one
  loop; this = one repo × many loops. Fleet composes on top unchanged.
- **Multi-machine / network-filesystem locking** — O_EXCL on one machine's
  filesystem remains the primitive.
- **Changes to the PR / CI / merge-gate flow** — GitHub already serializes
  the only path to main for code; it stays the outermost gate (D-11).

## Users

- **Primary**: Leo, starting 1–N scoped overnight loops on this repo (and
  any devx-initialized repo) and reviewing the morning after.
- **Secondary**: interactive `/devx` sessions and the `devx manage` daemon
  coexisting with live loops — they share the same claim arbitration and
  observability surfaces.
- **Anti-persona**: teams sharing one physical checkout across machines or
  network filesystems; anyone wanting loops to negotiate file-level code
  ownership (out of scope — worktrees + PRs own that).

## Use cases

- **UC-1**: Leo starts `devx loop --epic mobile-app` and
  `devx loop --epic loop-hardening` at bedtime; both run all night; in the
  morning `devx next` shows both runs' reports and every claim, merge, and
  checkbox flip landed exactly once.
- **UC-2**: Leo passes an explicit ordered ticket list —
  `devx loop --items a10001,a10002,a10003` — and the loop works exactly
  those hashes in order, honoring `Blocked-by:` edges, reporting (not
  silently skipping) any item whose blockers are outside the list.
- **UC-3**: Leo runs a specialty loop — `devx loop --only debug --focus
  "flaky-test hunting; do not touch mobile/"` — where the free-text
  specialty steers each iteration's prompt frame.
- **UC-4**: Two loops are started with overlapping (or absent) scopes, by
  accident or on purpose: they interleave down the backlog via claim
  arbitration — the loser of any single item moves to the next one without
  burning failure budget, and no state is corrupted.
- **UC-5**: A loop dies hard (kill -9, machine sleep, crash) while holding
  claims: surviving loops are unaffected; the dead loop's spec locks are
  reaped automatically at the next claim attempt; `devx next` reports the
  survivors accurately.
- **UC-6**: Leo (or a manage-spawned worker) runs interactive `/devx` work
  while loops are live: the same spec-lock arbitration protects both
  sides; `devx next` row 1 lists every live loop instance with its scope.

## Capabilities

- **CAP-1**: Repo-global identity — Every devx process resolves the same
  repo root and the same `.devx-cache` regardless of cwd — including from
  inside linked worktrees, which loop/claim entry points refuse.
- **CAP-2**: Serialized backlog mutation — All cross-process
  read-modify-write of backlog files, spec frontmatter/status-logs, and
  the associated main-checkout git operations happen inside one short
  cross-process critical section.
- **CAP-3**: Contention-aware claiming — A lost claim race is classified as
  contention, not failure: retried or skipped past, never charged to
  failure budgets, and pickers avoid live-held items up front.
- **CAP-4**: Spec-lock lifecycle — Spec locks carry owner liveness
  metadata, are reaped when the owner is dead (mgr106 classifier
  semantics: dead PID, PID recycling, unparseable body), and are released
  only under a guard that re-verifies ownership.
- **CAP-5**: Multi-instance loop registry — N loops register per-run
  instances with heartbeats; admission is capacity-checked; `devx next` /
  `devx status` aggregate all live instances; per-session scratch files
  are namespaced.
- **CAP-6**: Scope model — A loop can be restricted by epic/workstream,
  explicit hash list, exclusions, and a free-text specialty; scope masks
  out-of-scope rows to `blocked` (preserving dependency edges) and is
  recorded in the instance registry and morning report.
- **CAP-7**: Overlap-safety by construction — Every capability above holds
  with zero scope flags and fully overlapping scopes; scoping is a
  contention optimization, never a safety precondition.

## Feature requirements

### FR-1: Root canonicalization + worktree refusal

`devx loop`, `devx manage`, and the claim path resolve the repo root via
git's common-dir (main worktree), not nearest-`devx.config.yaml`-above-cwd.
Started from inside a linked worktree, `devx loop` (and `devx manage`)
refuse with an actionable error naming the main checkout path; a
documented override exists for tests. `devx manage` passes an explicit
cacheDir to its lock (today's no-arg call resolves `".devx-cache"`
against bare cwd). Kills R1/R10-reachability.

### FR-2: Backlog mutation lock

One `withBacklogLock()` helper (built on the existing
`acquirePathLockBlocking`, lock file `locks/backlog.lock`) wraps every
DEV.md / DEBUG.md / PLAN.md / spec-file mutation and its paired
main-checkout git add/commit/push, across `claim.ts`, `loop/driver.ts`,
`manage/loop.ts`, and `commands/gate.ts`. The remaining plain
`writeFileSync` writers (`manage/loop.ts:536,598,644`, gate's workstream
writer) convert to `writeAtomic`. Acquire timeout sized for the
push-bearing claim section (~30s) with a clear diagnostic on timeout.
Kills R3/R4/R10.

### FR-3: Claim contention handling

Under the backlog lock, a rejected claim push triggers bounded
fetch+rebase retries; a lost race that still can't land is classified
`claim-contended`: the loop releases cleanly, picks the next eligible
item, and does **not** increment `consecutiveClaimFailures` (which stays
reserved for genuinely broken claims). `pickNextItem` masks rows whose
spec lock is held by a live owner, so contention is avoided before it
happens. Finalize's `pull --ff-only` gets one fetch+retry under the lock.
Kills R2/R5/R8.

### FR-4: Spec-lock lifecycle

`spec-{hash}.lock` becomes JSON `{pid, pid_started_at, session,
claimed_at}`; acquisition reuses the mgr106 `classifyExistingLock`
semantics (dead-PID reap, PID-recycling cross-check with grace window,
unparseable-body reap, conservative on empty). A TTL backstop (default 2h,
config knob — implementing the long-documented-never-built timeout)
covers live-PID-but-wedged owners, warn-then-reap. Release re-verifies
ownership inside the backlog lock before unlink (closing the
check-then-act gap and the delete-a-peer's-lock path). Format migration:
old single-line lock bodies are readable (treated as unparseable-but-
present → conservative until classified). Coordinates with `dev-db36af`
(`devx doctor` reaps the same debris offline). Kills R7/R12, delivers G-3.

### FR-5: Loop instance registry + capacity admission

Loops stop taking `manager.lock` (which stays for the manage daemon) and
instead take `locks/loop-{run-id}.lock` plus write
`loop/instances/{run-id}.json` heartbeats (atomic writes; same freshness
window the singleton file uses today). Admission counts fresh live
instances and refuses to start past `capacity.max_concurrent` (finally
honoring the declared knob; default 5 per INTERVIEW Q#13a) with an
actionable message. The legacy singleton `loop/state.json` is still
written by the *newest* writer for one release (back-compat for external
readers) but `devx next` row 1 and `devx status` switch to aggregating
instances: id, scope, current item, iteration, freshness. Per-session
scratch moves to `.devx-cache/scratch/{session}/` (skill-body mirror pair
updated). Kills R6/R11.

### FR-6: Scoping & specialties

`devx loop` gains `--epic` (value: epic slug or plan hash) (repeatable; DEV.md heading slug or
plan hash, normalized per INTERVIEW Q#13b), `--workstream` (value: workstream slug)
(repeatable), `--items` (comma-separated hash list) (explicit ordered list), `--exclude`
(value: hash or epic slug) (repeatable), and `--focus` (quoted free text) (appended to the
iteration prompt frame as a specialty directive). `parseDevMd` learns to
stamp rows with their `### Epic — {name} (plan: {hash})` section
(additive fields; DEV.md format unchanged). Scope filters use the
existing mask-to-blocked semantics so cross-scope `Blocked-by:` edges
keep holding; `--items` reports out-of-list blockers explicitly. Scope is
recorded in the instance file, the morning report header, and `devx
next`'s row-1 rendering. All flags compose with `--only`.

### FR-7: N=1 is the degenerate case, not a special case

A bare `devx loop` behaves exactly as today (minus the fixed races): all
existing loop/claim/manage/next tests pass unchanged or with
mechanical-only updates (lock-body format, state-file location), and no
new flag is required for single-loop operation.

### FR-8: Migration & self-healing of legacy state

First run with the new code tolerates pre-existing debris: legacy
single-line spec locks, the singleton `loop/state.json`, and orphaned
`.devx-cache` scratch files are read, classified, and reaped or migrated
without manual intervention (in coordination with `dev-db36af`'s doctor,
which remains the offline repair tool).

## Evals seed

- Two in-process loops, same fake backlog, overlapping scope → union of
  merged items == serial baseline; DEV.md byte-consistent with every flip
  applied; zero `claim-failed` aborts. (→ E-1, P0)
- `devx loop` started with cwd inside `.worktrees/x-abc123/` → refusal,
  exit ≠ 0, error names the main checkout. (→ E-2, P0)
- Claim against a spec lock whose `{pid}` is dead → reaped and claimed on
  first attempt; against a live peer's lock → masked at pick time. (→ E-3, P0)
- Simulated push rejection on claim → rebase-retry lands it;
  `consecutiveClaimFailures` unchanged. (→ E-4, P1)
- Two registered instances; kill one; aggregated next/status shows the
  survivor only (after freshness window); admission refuses instance
  N+1 past `capacity.max_concurrent`. (→ E-5, P1)
- `--epic`/`--items`/`--exclude` masking: out-of-scope rows blocked not
  dropped; `--items` order preserved; out-of-list blocker reported. (→ E-6, P1)
- Real overnight, ≥2 scoped loops, ≥1 merged PR each, clean morning
  reconcile. (→ E-7, P2, human)

## Open questions

- Q#13a admission-cap default; Q#13b `--epic` key form; Q#13c cross-loop
  token budget — owner: user, filed as `INTERVIEW.md` Q#13, non-blocking
  (recommendations applied as defaults: 5 / both-normalized / follow-up).

## Reference links

- Spec: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
  (full race inventory R1–R12 with code anchors + seeded two-layer design)
- Loop contract: `v2/04-overnight-loop.md`; dispatcher: `v2/05-dispatcher.md`
- Prior art: `src/lib/manage/lock.ts` (mgr106 classifier),
  `src/lib/devx/claim.ts` (dvx101 atomic claim),
  `src/lib/loop/driver.ts` (v2l101 + PR #82/#84 hardening)
- Related: `dev-db36af` (doctor), `dev-lpf101` (preflight),
  `plan-c8e2d4` (usage governor), `plan-f1d6b2` (fleet),
  `plan-d01000` (deferred Phase 3 — locks slice re-homed here)
