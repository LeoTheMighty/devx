---
review: <CLEAN | CONCERNS | BLOCKING>
status_reason: '<1–2 sentences>'
reviewer: '/devx-review'
updated: <YYYY-MM-DD>
scope: <the whole workstream | PR #n>
tally: { blocking: <n>, advisory: <n>, coverage_pct: <n> }
---

# Review — <workstream title> — <YYYY-MM-DD>

<!-- The doc set's review.md. Advisory, reconciled IN PLACE every run, never
     appended. It READS gate_status and reports what disagrees with it; only
     the gates write it. `review:` is not `gate:` — this must never parse as
     a verdict artifact. Contract: /devx-review. -->

## Position

<stage · each gate verdict-aware · the next command · blockers. Correct on
its own even when every lens comes back clean.>

## Findings

<severity then confidence. No receipt, no finding — narration is not
evidence. Empty table = nothing survived verification.>

| # | Lens | Sev | Conf | Location | Finding | Receipt | Fix |
|---|---|---|---|---|---|---|---|

## Coverage (RTM)

<one row per requirement id, both directions; then overall + P0 %>

| ID | Design ref | Phase | Eval | Status |
|---|---|---|---|---|

## Unmapped work

<what the plan, evals or diff do that no requirement asked for, or "none">

## Recommended queue entries

<one INTERVIEW.md question or MANUAL.md action per blocking gap — recommended
here, filed by their own skills>

## Next action

<the single most useful next step>
