---
gate: FAIL
status_reason: 'First real gate prd run (v2e102 dogfood): seeded defect caught plus a genuine parser bug and a real coverage gap.'
reviewer: 'devx gate prd'
updated: 2026-07-05
waiver: { active: false, approver: null, reason: null }
---

# Decision — first `devx gate prd v2x101` run (v2e102 dogfood)

## Subject

Deliberate seeded defect (E-2 authored without a Threshold) to verify the
gate refuses correctly on its first real workstream, per the v2e102 AC.

## What the gate reported (verbatim gaps)

1. `expectation-threshold-missing` — **E-2 has no Threshold value** ← the
   seeded defect. Caught. ✅
2. `expectation-ears-shape` × 3 (E-1/E-2/E-3) — **false positives**: the
   parser read only the first physical line of each wrapped field, but house
   style wraps at ~78 chars. Real v2e101 bug, fixed forward in this PR
   (continuation-line folding in `parseExpectations`) with a regression
   test. LEARN candidate.
3. `expectation-verified-by-vague` (E-3) — mixed: wrap bug + genuinely
   sloppy authoring (parenthetical prose inside the target). Target cleaned
   to the bare path; validation type belongs in plan.md's coverage table.
4. `goal-uncovered` (G-3) — **real gap** the seed didn't intend: no
   expectation covered the zero-regression goal. E-4 added.

## Verdict detail

The refusal did its job — one seeded defect in, four distinct failure
classes surfaced, two of them real. Fixes applied; gate re-run follows.
