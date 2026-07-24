---
hash: hfi102
type: dev
created: 2026-07-24T10:41:50-06:00
title: Gate-verdict persistence + revise clearing + gate summary
from: plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md
plan: _devx/workstreams/harness-fold-in
status: ready
blocked_by: []
branch: feat/dev-hfi102
---

## Goal

Persist honest gate history: the `gate_verdicts:` sibling frontmatter map,
written by all three gates on every evaluated run (including FAIL), cleared
by the revise cascade, and rendered as a per-gate summary line in
`devx next`. Phase 2 of workstream `harness-fold-in` (plan.md § Phase 2).
Parallel-safe with hfi101 — zero shared files.

## Acceptance criteria

- [ ] `src/lib/engine/frontmatter.ts`: `GATE_KEYS` (`prd/design/plan/evals`)
      / `GateKey` / `GateVerdicts` / `FLAG_TO_GATE_KEY`; `EngineState` +
      `EnginePatch` extended with `gateVerdicts` (parse defensive: value ∉
      VERDICTS → null; absent map ≡ all-null). All handling via the existing
      `parseDocument` round-trip — the v1 flat-scalar parsers never see the
      nested map; `gate_status` booleans unchanged in shape and semantics.
- [ ] `src/commands/gate.ts`: at the three `applyEnginePatch` sites (prd /
      coverage / evals) — pass/CONCERNS → one combined patch (flag + stage +
      verdict); FAIL → verdict-only patch (booleans and stage untouched).
      Refusals, `--dry-run`, and exit-2 error paths write nothing. Header
      comment's "frontmatter untouched on exit 1" contract updated.
- [ ] `src/lib/engine/revise.ts`: `ReviseComputation` gains
      `verdictsCleared: GateKey[]` derived from the cascade row's reset
      flags; `src/commands/revise.ts` includes `gateVerdicts:
      {<key>: null, …}` in the existing patch; replay-path output unchanged.
- [ ] `src/lib/engine/render.ts` (new): `renderGateSummary(state)` →
      `gates: prd PASS · design FAIL · plan — · evals —` with fallback rule
      (verdict ≠ null → verdict; else flag true → PASS; else `—`); FAIL rows
      append report pointer (coverage → newest
      `decisions/<date>-<mode>-verify.md`, evals → `evals/RED-report.md`,
      prd → re-run command only) + re-run command.
- [ ] `devx next` renders the gate-summary line under workstream rows (repo
      scan + `devx next <hash>` single form) — `verdicts` attached to
      `WorkstreamSignal` via `src/lib/next/gather.ts` / `decide.ts` /
      `src/commands/next.ts`; FAIL renders distinctly from never-run.
- [ ] `test/gate-verdict-persist.test.ts` (E-3 permanent suite): 100% of
      evaluated gate runs across all 3 commands write the verdict in
      fixtures, including FAIL runs; refusal/dry-run fixtures write nothing;
      post-revise, reset stages read verdict `null`; `devx next` FAIL vs
      never-run fixtures.
- [ ] Workstream eval E-3 flips GREEN:
      `npx tsx harness-fold-in/evals/E-3_gate-verdict-persist.ts`
      (cwd `_devx/workstreams`) exits 0.
- [ ] Full suite green (`npm test`, typecheck included).

## Technical notes

- D-9 vocabulary reused verbatim from `src/lib/engine/verdict.ts` VERDICTS;
  gate-name keys per the resolved design decision (2026-07-24).
- Risk mitigation (design §Risks): `applyEnginePatch` throws on
  missing/broken frontmatter → gate exits 2 writing nothing; booleans still
  only flip on pass.
- Gates are the only writers; `devx revise` is the only eraser.
- Migration: existing specs render legacy PASS via the flag-true fallback —
  no rewrite of shipped specs; `eac479` itself is the live example.
- RED evidence: `_devx/workstreams/harness-fold-in/evals/RED-report.md`
  (E-3 right-reason).

## Status log

- 2026-07-24 — emitted by /devx-plan RED stage (eac479, phase 2/5).
