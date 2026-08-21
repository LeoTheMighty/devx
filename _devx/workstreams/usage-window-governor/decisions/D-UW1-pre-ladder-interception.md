# D-UW1 — The governor is a pre-ladder interception, not a ladder rung

**Status:** decided (design stage, 2026-08-21)
**Closes:** PRD § Open questions — "Exact classification seam (ladder rung vs
driver stop/wait check)"

## Decision

A usage-window hit is intercepted in the driver **before**
`classifyIteration` is called. `src/lib/loop/ladder.ts` is not modified.

## Why not a rung

The approved plan sketched a new rung `usage-window-exhausted` above
`permanent-error`. The 2026-07-15 code map already flagged the tension; the
design stage resolves it against the code.

`IterationClass` and `LadderDecision` are failure-shaped by construction.
`nextLadderState` (`ladder.ts:246`) bumps `consecutiveFailures` for every
class except `success`. A usage-window rung would need FOUR exemptions:

1. no `consecutiveFailures` movement,
2. no `consecutiveErrors` movement,
3. no `maxIterationsPerItem` charge (counted by the driver, not the ladder),
4. a decision kind (`pause`) the driver must special-case regardless.

The ladder's value is that it has no exemptions: every non-success moves the
state, and that invariant is what makes the backoff/abandon/abort thresholds
readable. A rung that moves nothing is not a rung — it is a bypass wearing a
rung's costume.

The failure mode is concrete, not aesthetic: a later edit that generalizes
`nextLadderState` over classes (a refactor, a new rung, a switch → map)
would silently start charging window hits as failures again. That is exactly
the defect this workstream exists to remove, re-introduced by a change whose
author had no reason to know about the exemption.

## Consequences

- `ladder.ts` stays untouched; its tests keep their current meaning.
- The kill switch (`resume_on_reset: false`) short-circuits before any
  governor code runs, so E-5's "byte-identical to today's behavior" is true
  by construction rather than by careful matching.
- The interception must be sited where the iteration result is available and
  ladder state has not yet advanced — one place, in `runItem`.
- FR-3's accounting semantics are unchanged from the PRD; only the seam
  moved.
