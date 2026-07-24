---
hash: hfi102
type: dev
created: 2026-07-24T10:41:50-06:00
title: Gate-verdict persistence + revise clearing + gate summary
from: plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md
plan: _devx/workstreams/harness-fold-in
status: in-progress
owner: /devx-loop-2026-07-24T16-46-18-001-62080
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
- 2026-07-24T11:15:28-06:00 — claimed by /devx in session /devx-loop-2026-07-24T16-46-18-001-62080
- 2026-07-24T17:26:27.686Z — loop iteration 1: Implemented hfi102 AC 1: the gate_verdicts frontmatter layer (GATE_KEYS/GateKey/GateVerdicts/FLAG_TO_GATE_KEY, EngineState+EnginePatch extension, defensive parse, null-clearing patches) with 8 new unit tests, flipping E-3's frontmatter probes green.
  - Change: src/lib/engine/frontmatter.ts: added GATE_KEYS/GateKey/GateVerdicts/FLAG_TO_GATE_KEY, extended EngineState with gateVerdicts (parse defensive: non-VERDICTS value → null, absent map ≡ all-null) and EnginePatch with gateVerdicts (null clears), wired through the existing parseDocument round-trip so gate_status booleans, unknown fields, comments, and body are untouched
  - Change: test/engine-frontmatter.test.ts: 8 new tests pinning defensive parse, FAIL-shaped verdict-only patches leaving flags/stage/body alone, null-clearing (revise shape), combined pass patches, legacy map creation, and idempotency; FULL_SPEC fixture now carries a gate_verdicts block
  - Change: test/engine-gate-coverage.test.ts + engine-next.test.ts + engine-revise.test.ts: EngineState literal helpers gained the required gateVerdicts field (typecheck ripple, no behavior change)
  - Learning: Full suite has one PRE-EXISTING failure at the branch base (commit 33009a6): devx-status-log-discipline.test.ts flags dev/dev-hfi101-2026-07-24T10:41-todo-core.md for a missing `phase 4:` status-log line — hfi101's loop merge shipped without it. Unrelated to hfi102; needs a one-line status-log append to the hfi101 spec by whoever owns status logs, or CI will be red for this branch too.
  - Learning: E-3 is now RED only on the two remaining right-reason probes: ReviseComputation.verdictsCleared (T2.3) and test/gate-verdict-persist.test.ts (T2.6) — gate.ts write sites (T2.2), revise clearing, render.ts, and devx next wiring are the remaining ACs.
  - Learning: The full npm test run takes ~7 minutes wall-clock; prefer targeted vitest runs mid-iteration and save the full suite for the final verification.
- 2026-07-24T17:32:13.726Z — loop iteration 2: Implemented hfi102 AC 2: all three gate commands now persist gate_verdicts on every evaluated run (combined patch on pass/CONCERNS, verdict-only on FAIL, nothing on refusal/dry-run/error), with the permanent suite's gate-command half (14 new tests) and 3 old-contract tests updated.
  - Change: src/commands/gate.ts: prd/coverage/evals write sites extended — pass/CONCERNS emits one combined patch (flag + stage + verdict via FLAG_TO_GATE_KEY), evaluated FAIL writes a verdict-only patch via a shared writeFailVerdict helper (exit 2 on write failure); refusals, --dry-run, and exit-2 paths write nothing; header exit-code contract comment updated per AC 2
  - Change: test/gate-verdict-persist.test.ts (new, 14 tests): the E-3 permanent suite's gate-command half — verdict persistence for all 3 commands incl. FAIL runs, CONCERNS recording, plan-vs-design key separation, and refusal/dry-run/exit-2 no-write fixtures; header documents the pending T2.3/T2.5 sections
  - Change: test/engine-gate-prd.test.ts + engine-gate-coverage.test.ts + engine-gate-evals.test.ts: the three tests pinning the old 'frontmatter untouched on FAIL' contract updated to assert verdict-only writes with booleans/stage untouched
  - Learning: E-3 probe (d) only checks that test/gate-verdict-persist.test.ts exists, so creating the file flipped it green; E-3 is now RED solely on ReviseComputation.verdictsCleared (T2.3) — the next iteration's unit is revise.ts + commands/revise.ts, then render.ts + devx next
  - Learning: Three pre-existing tests intentionally pinned the old no-write-on-FAIL contract and were updated in this iteration — future iterations should not read those diffs as regressions
  - Learning: The repo has no eslint config or lint script; the local gate is npm test = schema smoke + config tests + build + typecheck + vitest, so tsc + targeted vitest is the correct mid-iteration verification
- 2026-07-24T17:35:59.584Z — loop iteration 3: Implemented hfi102 AC 3 (revise verdict clearing): ReviseComputation.verdictsCleared + null-clearing gateVerdicts patch in devx revise, flipping E-3 fully GREEN (exit 0) with 9 new tests.
  - Change: src/lib/engine/revise.ts: ReviseComputation gains verdictsCleared: GateKey[] — the cascade row's FULL reset set mapped through FLAG_TO_GATE_KEY (not the flags-true delta, so a FAIL verdict on an already-false flag is still erased)
  - Change: src/commands/revise.ts: the existing applyEnginePatch call now includes gateVerdicts: {<key>: null, …}; replay-path stdout unchanged (key-shape pinned by test)
  - Change: test/engine-revise.test.ts: +6 tests — verdictsCleared pins on all three computeRevise shapes (incl. full-set-vs-delta semantics) and CLI tests for survivor verdicts, FAIL-on-false-flag erasure, and legacy specs without a gate_verdicts map
  - Change: test/gate-verdict-persist.test.ts: +3 tests — the T2.3 permanent-suite section using the real lifecycle (gate prd PASS → coverage design FAIL → revise reads null, earlier stages survive; prd.md revise erases all four; stdout shape unchanged); header updated to owe only T2.5
  - Learning: E-3 is now fully GREEN (exit 0) — AC 7 is met; remaining work is AC 4 (render.ts renderGateSummary), AC 5 (devx next wiring via gather.ts/decide.ts/next.ts), the T2.5 devx-next fixtures in gate-verdict-persist.test.ts, and the final full npm test run
  - Learning: verdictsCleared must map the full reset set, not filter by flags-true like flagsCleared does — a FAIL verdict coexists with a false flag, so delta-filtering would leave stale FAILs behind; this is pinned by a dedicated test
  - Learning: applyEnginePatch writing null verdicts into a legacy spec CREATES the gate_verdicts map with explicit nulls — revise on old specs is still idempotent (second run is a byte-identical re-write), and readEngineState reads it the same as an absent map
  - Learning: The E-3 probe calls computeRevise(state, entry) without the hash arg — replay strings would contain 'undefined' there, but the probe only checks the verdictsCleared key, so the 3-arg signature is safe to keep
