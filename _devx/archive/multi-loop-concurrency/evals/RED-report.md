---
gate: PASS
status_reason: 'Every runnable expectation observed RED for the right reason (6 run(s), 2 deferred).'
reviewer: 'devx gate evals'
updated: 2026-07-28
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/multi-loop-concurrency — 2026-07-28

## Runs

### E-1: Overlapping two-loop harness — safety without partitioning (P0)

- **Artifact**: _devx/workstreams/multi-loop-concurrency/evals/E-1_overlap-harness.ts
- **Command**: `npx tsx multi-loop-concurrency/evals/E-1_overlap-harness.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-1 RED — overlapping loops are not safe/coexistent yet:
    - second concurrent loop was refused by the singleton manager lock ('already running') — multi-instance loops not implemented (FR-5/T5.2)
    - .devx-cache/loop/instances/ was never created — instance registry not implemented (FR-5/T5.1)
  ```
- **RED verdict**: right-reason

### E-2: Worktree launch refusal — one state universe per repo (P0)

- **Artifact**: _devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts
- **Command**: `npx tsx multi-loop-concurrency/evals/E-2_root-canonicalization.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  Preparing worktree (new branch 'feat/dev-wt0001')
  E-2 RED — repo root is not canonical yet:
    - devx loop --dry-run ran from inside .worktrees/dev-wt0001 without refusing (exit 0) — worktree-launch refusal not implemented (T1.2)
    - src/lib/repo-root.ts missing — canonical root resolver not implemented (T1.1)
  ```
- **RED verdict**: right-reason

### E-3: Spec-lock lifecycle — dead owners reaped, live owners respected (P0)

- **Artifact**: _devx/workstreams/multi-loop-concurrency/evals/E-3_spec-lock-lifecycle.ts
- **Command**: `npx tsx multi-loop-concurrency/evals/E-3_spec-lock-lifecycle.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  To /var/folders/y_/sc23spkj46318zzjqj4fw0gc0000gn/T/e3-dead-origin-0cBIyA
   * [new branch]      main -> main
  To /var/folders/y_/sc23spkj46318zzjqj4fw0gc0000gn/T/e3-live-origin-iNZoYX
   * [new branch]      main -> main
  E-3 RED — spec-lock lifecycle not implemented yet:
    - claim against a dead-owner spec lock failed (exit 1) instead of reaping it in the same attempt — lock lifecycle not implemented (T3.2/T3.3): devx devx-helper claim: spec lock already held: /private/var/folders/y_/sc23spkj46318zzjqj4fw0gc0000gn/T/e3-dead-lUr11n/.devx-cache/locks/spec-ab12cd.lock
    - src/lib/devx/spec-lock.ts missing — spec-lock lifecycle module not implemented (T3.2)
  ```
- **RED verdict**: right-reason

### E-4: Claim contention is not failure (P1)

- **Artifact**: _devx/workstreams/multi-loop-concurrency/evals/E-4_claim-contention.ts
- **Command**: `npx tsx multi-loop-concurrency/evals/E-4_claim-contention.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  To /var/folders/y_/sc23spkj46318zzjqj4fw0gc0000gn/T/e4-contend-origin-nIGXXg
   * [new branch]      main -> main
  Cloning into 'checkout'...
  done.
  To /var/folders/y_/sc23spkj46318zzjqj4fw0gc0000gn/T/e4-contend-origin-nIGXXg
     9fb2822..3a2c914  main -> main
  E-4 RED — lost claim races are still hard failures:
    - claim under a lost push race exited 2 instead of rebase-retrying to success — contention retry not implemented (T4.1): devx devx-helper claim: claim failed at stage 'git-push': git push origin main failed (exit 1): To /var/folders/y_/sc23spkj46318zzjqj4fw0gc0000gn/T/e4-contend-origin-nIGXXg
   ! [rejected]        main -> main (fetch first)
  error: failed to push some re
  ```
- **RED verdict**: right-reason

### E-5: Instance registry, capacity admission, aggregated visibility (P1)

- **Artifact**: _devx/workstreams/multi-loop-concurrency/evals/E-5_instance-registry.ts
- **Command**: `npx tsx multi-loop-concurrency/evals/E-5_instance-registry.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-5 RED — loop instances are not registered/aggregated yet:
    - devx next JSON carries no loops[] field for live instances — instance aggregation not implemented (T5.3)
    - src/lib/loop/instances.ts missing — instance registry module not implemented (T5.1)
  ```
- **RED verdict**: right-reason

### E-6: Scope semantics — mask, never drop (P1)

- **Artifact**: _devx/workstreams/multi-loop-concurrency/evals/E-6_scope-semantics.ts
- **Command**: `npx tsx multi-loop-concurrency/evals/E-6_scope-semantics.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-6 RED — scope model not implemented yet:
    - DevRow carries no epicSlug for a row under '### Epic — Alpha Wave (plan: ab12cd)' — epic-aware parsing not implemented (T6.1)
    - src/lib/loop/scope.ts missing — scope module not implemented (T6.2)
    - devx loop rejects --epic as an unknown option — scope flag not implemented (T6.3)
    - devx loop rejects --workstream as an unknown option — scope flag not implemented (T6.3)
    - devx loop rejects --items as an unknown option — scope flag not implemented (T6.3)
    - devx loop rejects --exclude as an unknown option — scope flag not implemented (T6.3)
    - devx loop rejects --focus as an unknown option — scope flag not implemented (T6.3)
  ```
- **RED verdict**: right-reason

## Deferred stubs

- E-7: not-run (deferred: human) (P2)
- E-8: not-run (deferred: tests-after) (P1)
