---
gate: <PASS | CONCERNS | FAIL>
status_reason: '<1–2 sentences>'
reviewer: '/devx verify'
updated: <YYYY-MM-DD>
---

# Checkpoint — <workstream> phase <N> — <YYYY-MM-DD>

<!-- Lives in _devx/workstreams/<slug>/checkpoints/phase-<N>.md. The phase's
     verification plan run as the pass/fail of record. Five-step gate
     function: identify command → run fresh → read full output + exit code →
     verify → only then claim. "Should pass" is a banned phrase.
     done ≠ verified; the workstream can't close until every phase is
     verified. -->

## Expectation runs

| E-id | Type | Command | Exit | Status | Detail |
|---|---|---|---|---|---|
| E-1 | tests-first | `<cmd>` | 0 | ✅ | <was RED at Gate 4; now green> |

## Cross-cutting checks

- Lint (touched surfaces): <result>
- Types: <result>
- Full suite: <result + count>

## Drift noted

<anything the implementation revealed that future phases in plan.md must
absorb — the plan was updated in the same commit, or a revision was filed>
