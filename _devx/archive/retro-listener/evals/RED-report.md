---
gate: PASS
status_reason: 'Every runnable expectation observed RED for the right reason (9 run(s), 1 deferred).'
reviewer: 'devx gate evals'
updated: 2026-07-30
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/retro-listener — 2026-07-30

## Runs

### E-1: Nudge detection + durable enqueue (P0)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-1_listener-enqueue.ts
- **Command**: `npx tsx retro-listener/evals/E-1_listener-enqueue.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-1 FAIL (1):
    - src/lib/learn/listener.ts / queue.ts missing — feature not implemented (T1.2/T1.3)
  ```
- **RED verdict**: right-reason

### E-2: The listener is inert inside a retro (P0)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-2_retro-guard.ts
- **Command**: `npx tsx retro-listener/evals/E-2_retro-guard.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-2 FAIL (1):
    - src/lib/learn/listener.ts missing — feature not implemented (T1.3)
  ```
- **RED verdict**: right-reason

### E-3: Session-over readiness fails safe (P1)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-3_readiness-failsafe.ts
- **Command**: `npx tsx retro-listener/evals/E-3_readiness-failsafe.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-3 FAIL (1):
    - src/lib/learn/watch.ts missing — feature not implemented (T3.1)
  ```
- **RED verdict**: right-reason

### E-4: Serial watcher — singleton, outcomes, malformed entries (P0)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-4_watch-serial-outcomes.ts
- **Command**: `npx tsx retro-listener/evals/E-4_watch-serial-outcomes.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-4 FAIL (1):
    - src/lib/learn/watch.ts / queue.ts missing — feature not implemented (T3.x)
  ```
- **RED verdict**: right-reason

### E-5: `--dry-run` is non-destructive (P1)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-5_dry-run.ts
- **Command**: `npx tsx retro-listener/evals/E-5_dry-run.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-5 FAIL (1):
    - src/lib/learn/watch.ts / queue.ts missing — feature not implemented (T4.3)
  ```
- **RED verdict**: right-reason

### E-6: Wire-protocol pin — reword fails CI (P0)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-6_nudge-pin.ts
- **Command**: `npx tsx retro-listener/evals/E-6_nudge-pin.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-6 FAIL (1):
    - src/lib/learn/nudge.ts missing — feature not implemented (T1.1)
  ```
- **RED verdict**: right-reason

### E-8: Installation is idempotent and ownership-respecting (P1)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-8_hook-install.ts
- **Command**: `npx tsx retro-listener/evals/E-8_hook-install.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-8 FAIL (1):
    - src/lib/init-hooks.ts missing — feature not implemented (T5.1)
  ```
- **RED verdict**: right-reason

### E-9: The spawn wrapper exports the retro guard (P0)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-9_wrapper-guard.ts
- **Command**: `npx tsx retro-listener/evals/E-9_wrapper-guard.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-9 FAIL (1):
    - src/lib/learn/spawn.ts missing — feature not implemented (T4.1)
  ```
- **RED verdict**: right-reason

### E-10: SessionEnd denylist gates the fast path (P1)

- **Artifact**: _devx/workstreams/retro-listener/evals/E-10_sessionend-denylist.ts
- **Command**: `npx tsx retro-listener/evals/E-10_sessionend-denylist.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-10 FAIL (1):
    - src/lib/learn/listener.ts / queue.ts missing — feature not implemented (T1.3)
  ```
- **RED verdict**: right-reason

## Deferred stubs

- E-7: not-run (deferred: tests-after) (P1)
