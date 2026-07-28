# Expectations — Multi-Loop Concurrency

<!-- Gate 1 input. Minimum 3 E-blocks (config: engine.expectations_min).
     Every business goal (G-) must be covered by at least one expectation;
     every Covers: ID must resolve in prd.md. EARS regex enforced by
     `devx gate prd`: "When .+, the system SHALL .+". A P0 with a vague
     Verified-by target fails the gate. -->

## E-1: Overlapping two-loop harness — safety without partitioning

- **Priority:** P0
- **Covers:** G-1, UC-4, CAP-2, CAP-3, CAP-7, FR-2, FR-3
- **Trigger:** two in-process loop drivers (fake workers/tail, real claim +
  backlog + lock code) run concurrently over one fake backlog of ≥6 ready
  items with fully overlapping scope
- **Expectation (EARS):** When two loops run concurrently with overlapping
  scope over the same backlog, the system SHALL complete both runs with
  every item merged exactly once, every DEV.md flip and spec status line
  present, and zero runs aborted for contention.
- **Threshold:** merged-item union == serial baseline run's set; 0 lost
  backlog updates (post-run DEV.md equals expected fixture); 0
  `consecutiveClaimFailures`-triggered aborts across ≥3 seeded interleavings
- **Verified by:** `_devx/workstreams/multi-loop-concurrency/evals/E-1_overlap-harness.ts`

## E-2: Worktree launch refusal — one state universe per repo

- **Priority:** P0
- **Covers:** CAP-1, FR-1
- **Trigger:** `devx loop` (and `devx manage`) started with cwd inside a
  linked worktree (`.worktrees/<type>-<hash>/`)
- **Expectation (EARS):** When a loop or manager is started from inside a
  linked worktree, the system SHALL refuse to start with a non-zero exit
  and an error naming the main checkout path, and SHALL resolve repo root
  via git's common dir from any subdirectory of the main checkout.
- **Threshold:** exit code ≠ 0 from worktree cwd; error message contains
  the main checkout's absolute path; from a main-checkout subdirectory the
  resolved cacheDir equals `<mainRoot>/.devx-cache` in 100% of cases
- **Verified by:** `_devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts`

## E-3: Spec-lock lifecycle — dead owners reaped, live owners respected

- **Priority:** P0
- **Covers:** G-3, UC-5, CAP-4, FR-4, FR-8
- **Trigger:** a claim attempt against (a) a spec lock whose recorded PID
  is dead, (b) a legacy single-line lock body, (c) a lock held by a live
  peer process
- **Expectation (EARS):** When a claim encounters a spec lock whose owner
  is provably dead, the system SHALL reap the lock and complete the claim
  in that same attempt, while a lock with a live owner SHALL cause the
  item to be masked at pick time rather than claim-failed.
- **Threshold:** dead-owner reap+claim succeeds in ≤1 claim attempt;
  legacy-format bodies are never mis-reaped while their PID is live;
  live-owner items never reach `claimSpec` from `pickNextItem`; release
  after a peer re-claim never unlinks the peer's lock
- **Verified by:** `_devx/workstreams/multi-loop-concurrency/evals/E-3_spec-lock-lifecycle.ts`

## E-4: Claim contention is not failure

- **Priority:** P1
- **Covers:** CAP-3, FR-3, UC-4
- **Trigger:** claim push rejected because a concurrent process pushed to
  the default branch first (simulated non-fast-forward)
- **Expectation (EARS):** When a claim push is rejected non-fast-forward,
  the system SHALL fetch+rebase and retry within bounds, and on a still-
  lost race SHALL classify the outcome as claim-contended, move to the
  next eligible item, and leave `consecutiveClaimFailures` unchanged.
- **Threshold:** rebase-retry lands the claim in ≥1 seeded scenario; the
  still-lost path increments 0 failure counters and the run continues
- **Verified by:** `_devx/workstreams/multi-loop-concurrency/evals/E-4_claim-contention.ts`

## E-5: Instance registry, capacity admission, aggregated visibility

- **Priority:** P1
- **Covers:** G-2, UC-1, UC-5, UC-6, CAP-5, FR-5
- **Trigger:** N loop instances register; one is killed without cleanup;
  an N+1th instance starts past `capacity.max_concurrent`
- **Expectation (EARS):** When multiple loop instances are live, the
  system SHALL report each instance (id, scope, current item) in
  `devx next` and `devx status`, SHALL drop a killed instance from the
  aggregate after its freshness window, and SHALL refuse admission past
  `capacity.max_concurrent` with an actionable message.
- **Threshold:** aggregate view lists exactly the fresh instances in 100%
  of seeded cases; admission refusal exit ≠ 0 names the knob and the live
  count; a stale instance ages out within one freshness window
- **Verified by:** `_devx/workstreams/multi-loop-concurrency/evals/E-5_instance-registry.ts`

## E-6: Scope semantics — mask, never drop

- **Priority:** P1
- **Covers:** UC-1, UC-2, UC-3, CAP-6, FR-6
- **Trigger:** loops started with `--epic`, `--workstream`, `--items`,
  `--exclude`, `--focus` over a backlog with cross-scope `Blocked-by:`
  edges
- **Expectation (EARS):** When a scope filter is active, the system SHALL
  mask out-of-scope rows to blocked (preserving their dependency edges),
  SHALL work `--items` hashes in the given order, SHALL report rather than
  silently skip items whose blockers fall outside the scope, and SHALL
  record the scope in the instance file and morning report.
- **Threshold:** 0 out-of-scope claims across ≥5 seeded scope scenarios;
  100% of in-scope items blocked by out-of-scope unfinished work reported
  with the blocking hash named; `--items` execution order == argument
  order in 100% of runs; `--focus` text present verbatim in the iteration
  prompt frame
- **Verified by:** `_devx/workstreams/multi-loop-concurrency/evals/E-6_scope-semantics.ts`

## E-7: Real overnight — two scoped loops on the live repo

- **Priority:** P2
- **Covers:** G-2, UC-1, CAP-7
- **Trigger:** a real night: ≥2 concurrent `devx loop` processes with
  different scopes on this repo (supervised first run per the MV2.1
  precedent)
- **Expectation (EARS):** When two scoped loops run a real night, the
  system SHALL merge ≥1 PR per loop and reconcile to a clean morning
  state: no orphaned locks, no DEV.md drift requiring manual repair, and
  every instance's report accounting for its claims.
- **Threshold:** ≥1 merged PR per loop; `devx doctor`/drift checks report
  0 mechanical repairs needed the morning after
- **Verified by:** evals/E-7_live-overnight.md

## E-8: N=1 remains the degenerate case

- **Priority:** P1
- **Covers:** FR-7, CAP-7
- **Trigger:** a bare `devx loop` (no scope flags) on the existing test
  fixtures
- **Expectation (EARS):** When a single unscoped loop runs, the system
  SHALL preserve today's observable behavior, with the full existing test
  suite passing unchanged apart from mechanical lock-format/state-path
  updates.
- **Threshold:** `npm test` exits 0 with 0 failing tests; 0 existing
  loop/claim/manage/next tests deleted or semantically weakened
  (mechanical updates only, called out in the PR body)
- **Verified by:** evals/E-8_degenerate-case.md
