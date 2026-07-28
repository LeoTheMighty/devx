---
gate: CONCERNS
status_reason: 'E-7 is ⚠️ partial (T6.4 authors the checklist and wires it into the morning-report Next-steps template; the live supervised night is post-ship, scored by the workstream outcome — partial by design (P2).)'
reviewer: 'devx gate coverage (plan mode)'
updated: 2026-07-28
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/multi-loop-concurrency — 2026-07-28

## Subject

`plan.md` reviewed against `design.md + expectations.md` (plan mode; workstream `20eb6f`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| E-1 | ✅ | Phase 4 | T4.3/T4.4 build the two-runLoop seeded harness (fixture builder, >=3 seeded interleavings + serial baseline) atop phases 1-3's real lock/claim code; verification criteria restate all three threshold clauses. |
| E-2 | ✅ | Phase 1 | resolveRepoRoot + loop AND manage entry refusal + claim-path assertion; verification runs the E-2 eval with both threshold halves named explicitly. |
| E-3 | ✅ | Phase 3 | Pick-time live-held masking moved into T3.3 so all four threshold clauses are in-phase and T3.4's eval-flips-green is coherent; the eval artifact enforces the full threshold. |
| E-4 | ✅ | Phase 4 | T4.1 rebase-retry (<=2) + ClaimContendedError, T4.2 contended-vs-failed driver split; verification restates both threshold clauses. |
| E-5 | ✅ | Phase 5 | Instances module + next/status aggregation; verification names all three threshold clauses; scope field exists in the instance schema ahead of phase 6's flags. |
| E-6 | ✅ | Phase 6 | All five flags + buildScopeMask on the existing mask-to-blocked mechanism, --items order override, out-of-scope-blocker reporting, --focus verbatim; verification restates all four threshold clauses. |
| E-7 | ⚠️ | Phase 6 (checklist only) | T6.4 authors the checklist and wires it into the morning-report Next-steps template; the live supervised night is post-ship, scored by the workstream outcome — partial by design (P2). |
| E-8 | ✅ | Phase 6 | Sweep criteria match the threshold verbatim incl. the PR-body clause; mechanical updates accrued in phases 2-5 verified at the final sweep, fitting E-8's tests-after type. |

## Extras requiring product approval

- Scratch namespacing to .devx-cache/scratch/{session}/ (skill-body mirror-pair edit, 7-day reap) — R11 design risk, traceable to no E-id — Phase 5 T5.4
- Live-PID >2h WARN row in devx next drift + run events (doctor/db36af handoff) — beyond E-3's threshold — Phase 3 T3.3
- Engine gate-patch write conversion (workstream.ts/gate.ts -> writeAtomic + lock) — serialization of non-backlog engine writes verified by no eval — Phase 2 T2.3
- finalizeMerged pull --ff-only fetch+retry — loosely traceable to E-1 only; no eval asserts it directly — Phase 4 T4.2

## Verdict detail

- E-7 is ⚠️ partial (T6.4 authors the checklist and wires it into the morning-report Next-steps template; the live supervised night is post-ship, scored by the workstream outcome — partial by design (P2).)
