---
gate: PASS
status_reason: 'Every runnable expectation observed RED for the right reason (2 run(s), 2 deferred).'
reviewer: 'devx gate evals'
updated: 2026-07-05
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/execute-rehome-bmad-eject — 2026-07-05

## Runs

### E-1: Execution surface is BMAD-free (P0)

- **Artifact**: _devx/workstreams/execute-rehome-bmad-eject/evals/E-1_bmad-free.ts
- **Command**: `npx tsx execute-rehome-bmad-eject/evals/E-1_bmad-free.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-1 RED — execution surface is not BMAD-free:
    - .claude/skills/ still has 51 bmad-* dirs (e.g. bmad-advanced-elicitation)
    - _bmad/ still exists
    - src has 33 file(s) referencing bmad: /Users/leonidbelyi/personal/devx/.worktrees/dev-v2e102/src/cli.ts, /Users/leonidbelyi/personal/devx/.worktrees/dev-v2e102/src/lib/init-questions.ts, /Users/leonidbelyi/personal/devx/.worktrees/dev-v2e102/src/lib/init-gh.ts
    - .claude/commands has 4 file(s) referencing bmad: /Users/leonidbelyi/personal/devx/.worktrees/dev-v2e102/.claude/commands/dev.md, /Users/leonidbelyi/personal/devx/.worktrees/dev-v2e102/.claude/commands/devx-interview.md, /Users/leonidbelyi/personal/devx/.worktrees/dev-v2e102/.claude/commands/devx.md
    - devx.config.yaml still has a top-level bmad: block
    - .claude/commands/dev.md still exists
    - .claude/commands/dev-plan.md still exists
  ```
- **RED verdict**: right-reason

### E-2: Engine config block is first-class (P0)

- **Artifact**: _devx/workstreams/execute-rehome-bmad-eject/evals/E-2_engine-config.ts
- **Command**: `npx tsx execute-rehome-bmad-eject/evals/E-2_engine-config.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-2 RED — engine config block is not first-class:
    - devx.config.yaml has no top-level engine: block
  ```
- **RED verdict**: right-reason

## Deferred stubs

- E-3: not-run (deferred: tests-after) (P1)
- E-4: not-run (deferred: tests-after) (P1)
