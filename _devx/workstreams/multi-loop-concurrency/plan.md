# Plan — Multi-Loop Concurrency

<!-- Stage: Plan. Gate: `devx gate coverage <hash>` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. Default to
     more, smaller phases. One phase ≙ one dev spec ≙ one PR ≙ one tour. -->

## Current state

- `devx loop` is singleton (shared `manager.lock`, `src/lib/loop/driver.ts:449`)
  and serial (`pickNextItem` → `reconcile` with an always-empty roster,
  `driver.ts:334-340`); the only scope filter is `--only dev|debug`
  (`src/commands/loop.ts:105-109`).
- Repo root resolves to the nearest `devx.config.yaml` above cwd
  (`src/lib/config-io.ts:43-52`) — a loop launched inside
  `.worktrees/…` forks the whole `.devx-cache` universe (R1).
- Backlog/spec writers are unlocked read-modify-write (`src/lib/devx/
  claim.ts:534-589`, `driver.ts:1032-1052,1792-1796`) with plain
  `writeFileSync` survivors in `src/lib/manage/loop.ts:536,598,644` and
  the gate patch path (`src/lib/engine/workstream.ts:61`).
- Claim push has no retry; three lost races abort a run
  (`claim.ts:693`, `driver.ts:523`). Spec locks have no liveness
  metadata and are never reaped (`claim.ts:515-517`); release is an
  unguarded unlink (`driver.ts:937-954`).
- Loop state is the single-slot `.devx-cache/loop/state.json`
  (`src/lib/loop/state.ts:48`), read by `devx next` row 1
  (`src/lib/next/gather.ts:771-807`).
- `DevRow` has no epic field; DEV.md `### Epic` headings are discarded
  (`src/lib/backlog/parse.ts:155-158`). `capacity.max_concurrent`
  (devx.config.yaml:24) is read by nothing.

## Desired state

- N loops + interactive `/devx` + `devx manage` coexist on one repo:
  canonical root everywhere, all backlog mutations and main-checkout git
  ops serialized under `locks/backlog.lock`, claim contention classified
  and retried (never failure-budgeted), spec locks liveness-classified
  and reaped when dead, per-run instance files with capacity admission
  aggregated by `devx next`/`devx status`, and `devx loop` scoped by
  `--epic` / `--workstream` / `--items` / `--exclude` / `--focus`.
- The overlap harness (E-1) runs under vitest in CI proving
  overlap-safety without partitioning.
- Design: `_devx/workstreams/multi-loop-concurrency/design.md` (6
  components, single-blocking-lock argument).

## What we're NOT doing

- Cross-loop shared token budget (Q#13c follow-up).
- File-overlap conflict advisory or gate.
- Fleet layer / multi-repo / multi-machine anything.
- PR / CI / merge-gate flow changes.
- Lifting manage's `HARD_CAP_PHASE_1` worker cap.
- New config knobs beyond reading `capacity.max_concurrent` (timeouts,
  TTLs, retention are constants).

## Expectation coverage

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 4 | tests-first | _devx/workstreams/multi-loop-concurrency/evals/E-1_overlap-harness.ts | full |
| E-2 | P0 | 1 | tests-first | _devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts | full |
| E-3 | P0 | 3 | tests-first | _devx/workstreams/multi-loop-concurrency/evals/E-3_spec-lock-lifecycle.ts | full |
| E-4 | P1 | 4 | tests-first | _devx/workstreams/multi-loop-concurrency/evals/E-4_claim-contention.ts | full |
| E-5 | P1 | 5 | tests-first | _devx/workstreams/multi-loop-concurrency/evals/E-5_instance-registry.ts | full |
| E-6 | P1 | 6 | tests-first | _devx/workstreams/multi-loop-concurrency/evals/E-6_scope-semantics.ts | full |
| E-7 | P2 | 6 | human | _devx/workstreams/multi-loop-concurrency/evals/E-7_live-overnight.md | partial |
| E-8 | P1 | 6 | tests-after | _devx/workstreams/multi-loop-concurrency/evals/E-8_degenerate-case.md | full |

(E-7's runnable half is the checklist artifact; the live night itself is
post-ship, scored by the workstream outcome — hence `partial` by design.)

## Phase checklist

- [ ] Phase 1: Canonical repo root + worktree refusal
- [ ] Phase 2: Backlog mutation lock + atomic-writer conversion
- [ ] Phase 3: Spec-lock lifecycle (classify, reap, guarded release)
- [ ] Phase 4: Claim contention + lock-aware picking + overlap harness
- [ ] Phase 5: Instance registry + capacity admission + aggregation
- [ ] Phase 6: Scope model + flags + degenerate-case sweep

## Phases

### 1. Phase: Canonical repo root + worktree refusal

**Overview**: every entry point resolves one root/one `.devx-cache` via
git's common dir; loop/manage refuse linked-worktree starts. First
because every later phase assumes a single state universe (R1 is the
precondition for all other races being *fixable*).

**Files**:
- `src/lib/repo-root.ts` (new) — `resolveRepoRoot(cwd)` via `git
  rev-parse --git-common-dir --show-toplevel`; returns `{root, cacheDir,
  isLinkedWorktree}`.
- `src/commands/loop.ts` — canonical root + refusal (+
  `--allow-worktree-root` test override) replacing `findProjectConfig`
  dirname logic.
- `src/commands/manage.ts` — same refusal; pass explicit `cacheDir` into
  `acquireManagerLock` (kills the cwd-relative `".devx-cache"` default).
- `src/lib/devx/claim.ts` — assert the passed repoRoot is the canonical
  main root (defense in depth for CLI callers).
- `test/repo-root.test.ts` (new) — fixture repo + linked worktree.

**Context**: `findProjectConfig` (`config-io.ts:43`) stays for *finding*
config; the canonical root check wraps it. mgr106's lock classifier is
untouched here.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx tsx _devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts`
    passes: refusal (exit ≠ 0, names main root) from worktree cwd;
    canonical cacheDir from main-checkout subdirs.
  - `npm test` green.

**Tasks**:
- [ ] T1.1 `resolveRepoRoot` + unit tests — files: `src/lib/repo-root.ts`, `test/repo-root.test.ts`
- [ ] T1.2 loop/manage entry wiring + refusal + override flag — files: `src/commands/loop.ts`, `src/commands/manage.ts`
- [ ] T1.3 claim-path root assertion — files: `src/lib/devx/claim.ts`
- [ ] T1.4 E-2 eval flips green; full suite — files: `_devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts`

### 2. Phase: Backlog mutation lock + atomic-writer conversion

**Overview**: one blocking cross-process critical section for every
backlog/spec mutation and main-checkout git op; the two remaining plain
`writeFileSync` writer groups convert to `writeAtomic`.

**Files**:
- `src/lib/backlog/mutate.ts` (new) — `withBacklogLock(cacheDir, label,
  fn)` on `acquirePathLockBlocking` (`locks/backlog.lock`, 30s/20ms
  constants, holder-pid diagnostic on timeout).
- `src/lib/devx/claim.ts` — claim transaction (read → flip → commit →
  push → worktree add) wrapped.
- `src/lib/loop/driver.ts` — `setBacklogRow`, `markBacklogRowDone`,
  `commitOnMain`, `pushMain`, `finalizeMerged`'s mutation block,
  `releaseSpecLock` call sites wrapped.
- `src/lib/manage/loop.ts` — `applyBlocking` writers (`:536,598,644`) →
  `writeAtomic` + lock.
- `src/lib/engine/workstream.ts` / `src/commands/gate.ts` — engine patch
  write → `writeAtomic` + lock.
- `test/backlog-mutate.test.ts` (new) — concurrent writer loss test
  (two processes/tasks interleaving flips; zero lost updates).

**Context**: `acquirePathLockBlocking` (`src/lib/manage/lock.ts:211`)
already exists — wrap, don't duplicate. Worktree-cwd git-tx stays
lock-free (per-item isolation).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - Interleaved dual-writer test shows zero lost DEV.md updates (the R3
    reproduction fails before, passes after).
  - `npm test` green (existing writer call sites mechanically updated).

**Tasks**:
- [ ] T2.1 `withBacklogLock` + timeout diagnostics + tests — files: `src/lib/backlog/mutate.ts`, `test/backlog-mutate.test.ts`
- [ ] T2.2 claim + driver call sites — files: `src/lib/devx/claim.ts`, `src/lib/loop/driver.ts`
- [ ] T2.3 manage + gate writer conversion — files: `src/lib/manage/loop.ts`, `src/lib/engine/workstream.ts`, `src/commands/gate.ts`
- [ ] T2.4 R3 reproduction test red→green; full suite

### 3. Phase: Spec-lock lifecycle (classify, reap, guarded release)

**Overview**: spec locks gain liveness metadata and the mgr106 classifier
(extracted to a shared module); dead owners reaped at claim; release
verifies ownership under the backlog lock. Legacy bodies (incl. the live
stale `spec-494590.lock`) classify via their `pid=` line.

**Files**:
- `src/lib/locks/classify.ts` (new) — `classifyExistingLock` extracted
  from `src/lib/manage/lock.ts:259` (manager lock re-imports it).
- `src/lib/devx/spec-lock.ts` (new) — JSON v1 body `{schema, pid,
  pid_started_at, session, claimed_at}`; acquire (O_EXCL → classify →
  reap+retry under backlog lock); `classifySpecLock` (legacy-body
  support); guarded release.
- `src/lib/devx/claim.ts` — acquire path swaps to spec-lock module.
- `src/lib/loop/driver.ts` — `ownsClaim`/`releaseSpecLock` swap to
  guarded release; 2h live-PID WARN surfaced into run events; pick-time
  live-held masking in `pickNextItem` (consumes `classifySpecLock` —
  lands here so E-3 flips green whole in this phase).
- `src/lib/next/gather.ts` — lock drift rows read JSON + legacy bodies;
  live-PID >2h WARN row.
- `test/spec-lock.test.ts` (new).

**Context**: mgrret lesson — PID-recycling grace window (2s) is
load-bearing on macOS; keep the classifier's tests when extracting.
Coordinates with `dev-db36af` (doctor reaps offline; do not duplicate
its repair surface — expose `classifySpecLock` for it to consume).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx tsx …/evals/E-3_spec-lock-lifecycle.ts` passes: dead-owner
    reap ≤1 attempt; legacy live body never mis-reaped; guarded release
    never unlinks a peer's re-claim.
  - `npm test` green.

**Tasks**:
- [ ] T3.1 classifier extraction (manager lock re-imports; its tests stay green) — files: `src/lib/locks/classify.ts`, `src/lib/manage/lock.ts`
- [ ] T3.2 spec-lock module + JSON v1 + legacy parse — files: `src/lib/devx/spec-lock.ts`
- [ ] T3.3 claim/driver/gather integration + WARN row + pick-time live-held masking — files: `src/lib/devx/claim.ts`, `src/lib/loop/driver.ts`, `src/lib/next/gather.ts`
- [ ] T3.4 E-3 eval flips green; full suite

### 4. Phase: Claim contention + lock-aware picking + overlap harness

**Overview**: lost push races become bounded rebase-retries then
`claim-contended` (never failure budget); `pickNextItem` masks live-held
items; the E-1 overlap harness lands and proves overlap-safety
end-to-end. The workstream's load-bearing phase.

**Files**:
- `src/lib/devx/claim.ts` — rebase-retry (≤2) inside the locked claim
  section; `ClaimContendedError`.
- `src/lib/loop/driver.ts` — contended vs failed split at
  `:566-591`; finalize `pull --ff-only` fetch+retry (pick-time masking
  already landed in phase 3).
- `test/claim-contention.test.ts` (new), `test/loop-concurrency.test.ts`
  (new — the two-`runLoop` fixture harness via `RunLoopOpts` seams,
  ≥3 seeded interleavings + serial baseline).
- `_devx/workstreams/multi-loop-concurrency/evals/E-1_overlap-harness.ts`,
  `…/E-4_claim-contention.ts` flip green.

**Context**: design §Test architecture — in-process `runLoop` pairs,
fake worker/tail, real claim/lock/backlog code, tmpdir git fixture.
`consecutiveClaimFailures` stays reserved for genuinely broken claims.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-1: merged union == serial baseline; final DEV.md byte-equal to
    expected; 0 contention aborts across seeds.
  - E-4: rebase-retry lands a raced claim; still-lost path increments 0
    failure counters.
  - `npm test` green.

**Tasks**:
- [ ] T4.1 rebase-retry + `ClaimContendedError` — files: `src/lib/devx/claim.ts`
- [ ] T4.2 driver contended path + finalize retry — files: `src/lib/loop/driver.ts`
- [ ] T4.3 fixture builder + overlap harness (seeded) — files: `test/loop-concurrency.test.ts`
- [ ] T4.4 E-1 + E-4 evals flip green; full suite

### 5. Phase: Instance registry + capacity admission + aggregation

**Overview**: singleton loop state becomes per-run instance files with
heartbeats and fail-fast per-run locks; admission honors
`capacity.max_concurrent`; loops stop taking `manager.lock`;
`devx next`/`devx status` aggregate; scratch namespacing.

**Files**:
- `src/lib/loop/instances.ts` (new) — register/heartbeat/finalize/list/
  admit; JSON v1 instance schema; 24h stopped-file reap; 7-day scratch
  reap.
- `src/lib/loop/driver.ts` — startup swaps manager.lock → admission +
  instance lock; heartbeat retargets; finalizer marks stopped.
- `src/lib/loop/state.ts` — legacy `state.json` write path retired
  (read-fallback only).
- `src/lib/next/gather.ts` + `src/lib/next/decide.ts` — row 1 reads
  `loop/instances/` (fallback legacy), payload gains `loops[]`.
- `src/commands/status.ts` — live-loops section.
- `skills/devx.md` + `.claude/commands/devx.md` — scratch paths →
  `.devx-cache/scratch/{session}/` (mirror pair, byte-identical).
- `test/loop-instances.test.ts` (new).

**Context**: freshness reuses `isFresh` windows (`gather.ts:752`);
crash-orphan recovery mirrors `recoverStaleLoopState` (`state.ts:140`).
LEARN first-real-run rule: run `devx next` + `devx status` on the live
repo with a live loop before merge.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx tsx …/evals/E-5_instance-registry.ts` passes: aggregate lists
    exactly fresh instances; killed instance ages out in one window;
    admission refuses N+1 naming knob + count.
  - First-real-run: `devx next` shows a live instance during a real
    `devx loop --dry-run`-adjacent smoke (documented in status log).
  - `npm test` green.

**Tasks**:
- [ ] T5.1 instances module + admission — files: `src/lib/loop/instances.ts`
- [ ] T5.2 driver swap + legacy write retirement — files: `src/lib/loop/driver.ts`, `src/lib/loop/state.ts`
- [ ] T5.3 next/status aggregation — files: `src/lib/next/gather.ts`, `src/lib/next/decide.ts`, `src/commands/status.ts`
- [ ] T5.4 scratch namespacing mirror-pair edit — files: `skills/devx.md`, `.claude/commands/devx.md`
- [ ] T5.5 E-5 eval flips green; first-real-run; full suite

### 6. Phase: Scope model + flags + degenerate-case sweep

**Overview**: epic-aware rows, the five scope flags, scope surfacing in
instance/report/next, and the final N=1 degenerate-case sweep (E-8) +
E-7 checklist handoff.

**Files**:
- `src/lib/backlog/parse.ts` — `### Epic — {name} (plan: {hash})`
  heading tracking; `DevRow.epicSlug`/`epicPlanHash` (additive).
- `src/lib/loop/scope.ts` (new) — `buildScopeMask(rows, scope)`;
  workstream-membership via the extracted frontmatter walk.
- `src/lib/engine/workstream.ts` or `src/lib/next/gather.ts` —
  membership walk extraction (shared, not duplicated).
- `src/commands/loop.ts` — `--epic`/`--workstream`/`--items`/
  `--exclude`/`--focus` (+ fail-fast validation, exit 4).
- `src/lib/loop/driver.ts` — scope→mask plumb; `--items` order
  override; out-of-scope-blocker reporting event.
- `src/lib/loop/iteration.ts` — Specialty directive line.
- `src/lib/loop/report.ts` — scope header + blocked-by-out-of-scope
  lines.
- `test/loop-scope.test.ts`, `test/backlog-parse-epic.test.ts` (new).

**Context**: masking reuses the excluded-set mechanism
(`driver.ts:325-332`); blocker status lookup is already global
(`gather.ts:245-253`) so cross-scope edges hold for free.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx tsx …/evals/E-6_scope-semantics.ts` passes thresholds (0
    out-of-scope claims across ≥5 scenarios; order preserved; blocker
    named; focus verbatim).
  - E-8 checklist: `npm test` exits 0, no semantic test weakening
    (diff-reviewed), bare `devx loop --dry-run` output unchanged vs
    baseline capture, and every mechanical test update called out in the
    PR body.
  - E-7 checklist authored and referenced from the morning-report
    Next-steps template.

**Tasks**:
- [ ] T6.1 epic-aware parser (additive fields) — files: `src/lib/backlog/parse.ts`, `test/backlog-parse-epic.test.ts`
- [ ] T6.2 scope module + membership-walk extraction — files: `src/lib/loop/scope.ts`, `src/lib/next/gather.ts`
- [ ] T6.3 flags + driver plumb + report/instance surfacing — files: `src/commands/loop.ts`, `src/lib/loop/driver.ts`, `src/lib/loop/report.ts`, `src/lib/loop/iteration.ts`
- [ ] T6.4 E-6 eval flips green; E-8 sweep; E-7 checklist handoff
