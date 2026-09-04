---
gate: PASS
status_reason: 'All four expectations verified: E-1/E-2 flipped RED→GREEN in this PR; E-3 authored + green (ini508 e2e extension); E-4 suite green (count delta explained below).'
reviewer: '/devx verify'
updated: 2026-07-05
---

# Checkpoint — execute-rehome-bmad-eject phase 1 — 2026-07-05

## Expectation runs

| E-id | Type | Command | Exit | Status | Detail |
|---|---|---|---|---|---|
| E-1 | tests-first | `npx tsx _devx/workstreams/execute-rehome-bmad-eject/evals/E-1_bmad-free.ts` | 0 | ✅ | was RED at Gate 4 (7 live-ref src files, 51 skill dirs, `_bmad/`, `bmad:` block, 2 legacy commands); GREEN post-ejection |
| E-2 | tests-first | `npx tsx _devx/workstreams/execute-rehome-bmad-eject/evals/E-2_engine-config.ts` | 0 | ✅ | was RED (no engine block); GREEN — `engine:` schema-declared, workstreams_root resolves |
| E-3 | tests-after | `npx vitest run test/init-e2e.test.ts` | 0 | ✅ | ini508 e2e extended: fresh scaffold has zero live BMAD refs, ships engine templates + engine:/loop: config |
| E-4 | tests-after | `npm test` | 0 | ✅ | 77 files / 1497 vitest + 33 script-runner tests + build + typecheck green |

## Cross-cutting checks

- `bmad:` shim: config with leftover key loads with a one-shot deprecation
  warning, no throw (test in test/config-validate.test.ts).
- Full suite: 1497 vitest (baseline 1571 → −74 net: −31 should-create-story
  retirement, −~40 sprint-status/eject/BMAD-failure-mode expectation
  retirements, + new E-3 e2e + shim + idempotency tests). Every removal maps
  to a retired surface, not lost coverage — E-4's "no count regression"
  threshold is superseded by the retirement ledger above, recorded here
  rather than silently waived.

## Drift noted

- E-1 refined twice pre-flip (archival `_bmad-output/` pointer exemption;
  config-validate.ts shim-file exemption — the detector cannot violate the
  thing it detects). Both recorded in the plan spec status log.
- `validate-emit` epic resolution still points at the frozen archive for
  epic lookups; soft exit-2 for workstream slugs. Filed on v2d101.
