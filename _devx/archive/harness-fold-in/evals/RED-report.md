---
gate: PASS
status_reason: 'Every runnable expectation observed RED for the right reason (7 run(s), 0 deferred).'
reviewer: 'devx gate evals'
updated: 2026-07-24
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/harness-fold-in — 2026-07-24

## Runs

### E-1: todo.md scaffold honors the parse contract (P0)

- **Artifact**: _devx/workstreams/harness-fold-in/evals/E-1_todo-scaffold.ts
- **Command**: `npx tsx harness-fold-in/evals/E-1_todo-scaffold.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-1 RED — todo.md scaffold does not honor the parse contract yet:
    - _devx/templates/engine/todo.md missing — feature not implemented (T1.1)
    - fresh `createWorkstream` scaffold did not write todo.md — feature not implemented (T1.2)
  ```
- **RED verdict**: right-reason

### E-2: Gates never read todo.md (P0)

- **Artifact**: _devx/workstreams/harness-fold-in/evals/E-2_gate-todo-isolation.ts
- **Command**: `npx tsx harness-fold-in/evals/E-2_gate-todo-isolation.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-2 RED — gate↔todo firewall is not pinned yet:
    - test/gate-todo-isolation.test.ts missing — the 4-fixture byte-identity + static-scan invariant is not pinned in the default suite (feature missing, T1.7)
  ```
- **RED verdict**: right-reason

### E-3: Gate verdicts persist, including FAIL (P0)

- **Artifact**: _devx/workstreams/harness-fold-in/evals/E-3_gate-verdict-persist.ts
- **Command**: `npx tsx harness-fold-in/evals/E-3_gate-verdict-persist.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-3 RED — gate-verdict persistence not implemented yet:
    - frontmatter.ts exports no GATE_KEYS — gate_verdicts plumbing missing (T2.1)
    - frontmatter.ts exports no FLAG_TO_GATE_KEY — flag→gate-key map missing (T2.1)
    - EngineState carries no gateVerdicts — readEngineState not extended (T2.1)
    - ReviseComputation carries no verdictsCleared — revise cascade does not clear verdicts (T2.3)
    - test/gate-verdict-persist.test.ts missing — 3-command fixtures (incl. FAIL runs + devx next FAIL-vs-never-run rendering) not pinned (feature missing, T2.6)
  ```
- **RED verdict**: right-reason

### E-4: Drift detection is mechanical and advisory (P1)

- **Artifact**: _devx/workstreams/harness-fold-in/evals/E-4_next-todo-drift.ts
- **Command**: `npx tsx harness-fold-in/evals/E-4_next-todo-drift.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-4 RED — todo drift detection not implemented yet:
    - src/lib/engine/todo.ts missing — computeTodoDrift not implemented (feature missing, T1.5)
    - test/next-todo-drift.test.ts missing — advisory contract (exit code unchanged, 0 file writes) not pinned (feature missing, T3.6)
  ```
- **RED verdict**: right-reason

### E-5: Current focus derives from ground truth (P1)

- **Artifact**: _devx/workstreams/harness-fold-in/evals/E-5_next-current-focus.ts
- **Command**: `npx tsx harness-fold-in/evals/E-5_next-current-focus.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-5 RED — frontmatter-rooted focus walk not implemented yet:
    - src/lib/engine/todo.ts missing — currentFocus not implemented (feature missing, T1.4)
    - test/next-current-focus.test.ts missing — absent-file exit-0/no-line contract + renderer wiring not pinned (feature missing, T3.6)
  ```
- **RED verdict**: right-reason

### E-6: /devx-learn guard rails hold (P1)

- **Artifact**: _devx/workstreams/harness-fold-in/evals/E-6_learn-skill-guards.ts
- **Command**: `npx tsx harness-fold-in/evals/E-6_learn-skill-guards.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-6 RED — /devx-learn guard rails not in place yet:
    - src/lib/learn/slug.ts missing — sanitizeLearnSlug not implemented (feature missing, T4.1)
    - .claude/commands/devx-learn.md missing — skill body not authored (feature missing, T4.3)
    - test/learn-skill-guards.test.ts missing — fuzz set + static guard assertions not pinned (feature missing, T4.5)
  ```
- **RED verdict**: right-reason

### E-7: Lifecycle skill bodies carry the todo write steps (P2)

- **Artifact**: _devx/workstreams/harness-fold-in/evals/E-7_skill-todo-discipline.ts
- **Command**: `npx tsx harness-fold-in/evals/E-7_skill-todo-discipline.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
    - devx-plan.md '## Stage: PRD' carries no todo step (devx todo sync) — feature missing (T5.1)
    - devx-plan.md '## Stage: Design' carries no todo step (devx todo sync) — feature missing (T5.1)
    - devx-plan.md '## Stage: Plan' carries no todo step (devx todo sync) — feature missing (T5.1)
    - devx-plan.md '## Stage: RED' carries no todo step (devx todo sync) — feature missing (T5.1)
    - devx.md execute arm carries no todo step (devx todo sync) — feature missing (T5.2)
    - devx-learn.md must define the nudge canonical exactly once (found 0) — feature missing (T4.3/T5.3)
    - nudge canonical marker appears 0 time(s) across skill bodies, wanted exactly 1
    - devx-plan.md carries no friction-observed nudge reference (T5.3)
    - devx.md carries no friction-observed nudge reference (T5.3)
    - test/skill-todo-discipline.test.ts missing — 5/5 + nudge single-source + canary not pinned (feature missing, T5.5)
  ```
- **RED verdict**: right-reason

## Deferred stubs

- none
