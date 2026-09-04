---
outcome: keep
status_reason: 'All three ejection goals hold 3 weeks early: 0 live BMAD refs, engine config first-class, suite grew 1571 → 1974 with zero regression.'
reviewer: '/devx outcome'
updated: 2026-07-05
reopened_expectations: []   # E-ids, when outcome = tune
successor: null             # workstream slug, when outcome = restart
---

# Results — execute-rehome-bmad-eject — 2026-07-05

<!-- Written by /devx outcome when measure_by comes due. Scores the PRD's
     numeric goals against reality. keep = mechanical; tune/restart/retire =
     recorded judgment. tune reopens via the revision cascade keyed to the
     missed expectations; restart links a v2 workstream with
     learns_from/superseded_by lineage.
     (tune's reopen is verification-scoped: evals_red clears and the stage
     rolls back to red so the missed expectations' RED artifacts re-run;
     revising the expectation/design/plan itself goes through devx revise.) -->

## Goal scores

| Goal | Target | Actual | Source | Verdict |
|---|---|---|---|---|
| G-1 | BMAD-free execution surface by V2.2 close — `src/`, `.claude/commands/`, and `.claude/skills/` contain 0 BMAD references or skill directories (measured by the E-1 eval script, exit 0). | 0 | E-1 eval (evals/E-1_bmad-free.ts) exit 0 — 0 live BMAD refs across src/ + .claude/, re-run 2026-07-05 | hit |
| G-2 | Engine configuration is first-class by V2.2 close — the `engine:` block exists in `devx.config.yaml`, schema-validated, with `workstreams_root` resolvable (E-2 eval exit 0). | 1 | E-2 eval (evals/E-2_engine-config.ts) exit 0 — engine: block schema-validates, workstreams_root resolves | hit |
| G-3 | Zero regression — the full test suite stays green (≥1571 tests) through the ejection PR. | 1974 | npm test 2026-07-05: 101 files / 1974 tests green (was 1571 at PRD authoring) | hit |

## Reading

Scored ahead of measure_by (2026-08-02) because all three goals were already measurable and the evals are deterministic. G-1/G-2 are the E-1/E-2 eval scripts re-run green on 2026-07-05; G-3 comfortably exceeds the ≥1571 floor at 1974 — the post-ejection phases (tour, dispatcher, loop, outcome) each ADDED tests on the BMAD-free surface, which is the strongest no-regression signal available. Nothing surprised us; the ejection held through five subsequent phases.

## Disposition

keep — the native engine is the execution surface; nothing reopens. This is the first real outcome verdict through the loop (v2o101 dogfood): armed at close, scored against the PRD's own G- goals, RESULTS.md rendered from the shipped template.
