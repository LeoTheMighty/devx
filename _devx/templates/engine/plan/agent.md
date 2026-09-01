# Plan — <workstream title>

<!-- Stage: Plan. Gate: `devx gate coverage <hash>` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. Default to
     more, smaller phases. One phase ≙ one dev spec ≙ one PR. -->

## Current state

<what exists today, with paths>

## Desired state

<what exists when this workstream closes>

## What we're NOT doing

<scope fence — anything here appearing in a diff is an "extra requiring
product approval">

## Risks

<!-- IMPLEMENTATION-level risks — distinct from design/agent.md's Risks,
     which are risks of the APPROACH. These are risks of the SEQUENCE: what
     this ordering exposes, what a phase cannot roll back, where an estimate
     is a guess. Written from the Plan-stage interrogation (skill step 1b),
     not invented afterwards.

     One row per risk. `Phase` names where it bites. `Rollback` is what you
     actually do when it does — "revert the PR" only counts when the phase
     really is revert-safe; say so plainly when it is not. Advisory at the
     gate: a plan with no Risks section is CONCERNS at most, never FAIL, and
     plans predating this section are grandfathered. -->

| Risk | Phase | Blast radius | Rollback |
|---|---|---|---|
| <what could go wrong, specifically> | <n> | <low/med/high> | <what you do about it> |

## Expectation coverage

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 2 | tests-first | <test path> | full |

## Phase checklist

- [ ] Phase 1: <name>
- [ ] Phase 2: <name>

## Phases

### 1. Phase: <name>

**Overview**: <what this phase lands and why it's first>

**Files**:
- `path/to/file.ext` — <what changes and why>

**Context**:
- <design decisions / codebase patterns relevant here>

**Verification plan**:
- Type: <tests-first | tests-after | human | none>
- Success criteria:
  - <specific, plain-language, runnable>

**Tasks**:
- [ ] T1.1 <task> — files: `<path>`
- [ ] T1.2 <task>

### 2. Phase: <name>

<same shape>
