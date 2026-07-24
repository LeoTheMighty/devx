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
- 2026-07-24T17:39:25.089Z — loop iteration 4: Implemented hfi102 AC 4: new src/lib/engine/render.ts with renderGateSummary (verdict → legacy-flag-PASS → never-run fallback, FAIL fix-path lines with newest-report pointers + re-run commands) plus newestDecisionReport, pinned by 15 new unit tests.
  - Change: src/lib/engine/render.ts (new): renderGateSummary(state, ctx) renders 'gates: prd PASS · design FAIL · plan — · evals —' with the AC-4 fallback rule, plus one indented fix-path line per FAILed gate — coverage gates point at the newest decisions/<date>-<mode>-verify.md, evals at evals/RED-report.md, prd re-run-only; re-run command strings match nextForWorkstream verbatim; graceful degradation to re-run-only when the workstream dir or report is unresolvable
  - Change: src/lib/engine/render.ts: newestDecisionReport(names, mode) helper — lexicographic max over ISO-dated report names, keeping the module pure (no mtime/fs)
  - Change: test/engine-render.test.ts (new, 15 tests): fallback chain (never-run em-dash, legacy flag-true → PASS, verdict-beats-flag, CONCERNS/WAIVED verbatim), all four FAIL fix-path shapes, mode separation (design vs plan reports), multi-FAIL ordering, hash precedence (ctx.hash → state.hash → '<hash>'), and newestDecisionReport selection/rejection
  - Learning: renderGateSummary was made pure with a caller-supplied GateSummaryContext ({hash, workstreamRel, decisionNames}) rather than taking an fs/repoRoot — AC 5's wiring should list <ws>/decisions/ via gather.ts's NextFs seam and pass it in; devx status (Phase 3) reuses the same contract
  - Learning: The return value is a newline-joined multi-line string (summary line + indented FAIL fix-path lines, no trailing newline) — AC 5's renderer should print it as-is under the workstream row rather than expecting a single line
  - Learning: WorkstreamSignal (src/lib/next/decide.ts) currently carries only {hash, slug, stage, decision} — AC 5 needs a 'verdicts' (or full-state/summary) field added there plus population in gatherWorkstreamSignals, which already has wsAbs/wsRel in scope at the midPipeline.push site
- 2026-07-24T17:47:45.199Z — loop iteration 5: Implemented hfi102 AC 5: `devx next` now renders the per-workstream gate-summary line (verdicts attached to WorkstreamSignal via gather/decide/next, FAIL rendered distinctly from never-run) with ~280 lines of new tests, leaving only full-suite verification and commit outstanding.
  - Change: Attached gate verdicts to WorkstreamSignal in src/lib/next/gather.ts and threaded them through src/lib/next/decide.ts so both the repo-scan and `devx next <hash>` single forms carry verdict data.
  - Change: Rendered the `gates: prd PASS · design FAIL · …` summary line under workstream rows in src/commands/next.ts via renderGateSummary, with FAIL rows visually distinct from never-run (`—`) gates.
  - Change: Added the `devx next` half of the E-3 permanent suite: FAIL-vs-never-run fixtures in test/gate-verdict-persist.test.ts (+72 lines), a new test/next-dispatch.test.ts block (+169 lines), and engine-next coverage (+40 lines) — 336 insertions total across 6 files.
  - Learning: The full `npm test` suite takes ~7 minutes in this worktree and has exactly one pre-existing failure (the hfi101 `phase 4:` status-log discipline violation) that exists at the branch base and on origin/main — future iterations should treat that single failure as expected baseline, not an hfi102 regression, when judging the full-suite AC.
- 2026-07-24T18:08:04.354Z — loop iteration 6: Ran the 3-agent adversarial self-review over the full hfi102 diff and fixed all actionable findings in-place (one LOW indent observation resolved as no-change per render.ts's documented caller-indents contract), with E-3 re-verified green after the fixes.
  - Change: Applied fixes for all actionable findings from the 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) across the gate commands, engine frontmatter/outcome/render modules, next-pipeline gather wiring, and their test files — all findings addressed except BH LOW-3, resolved as no-change because render.ts explicitly documents that callers control block indentation and the repo-scan form's uniform 2-space indent preserves the documented 0/2 relative shape.
  - Change: Re-verified E-3 exits 0 (fully green) after the review fixes, confirming the AC 7 permanent-suite contract survived the changes.
  - Learning: BH LOW-3 (gate-summary block indentation in the repo-scan form) is intentionally no-change: renderGateSummary's contract delegates indentation to callers, and next.ts's uniform 2-space block indent preserves the 0/2 relative shape — future reviews should not re-flag it.
  - Learning: The review-fix iteration ended with the full ~7-minute npm test run still in flight; the review fixes are in the working tree but uncommitted, so the remaining tail is full-suite confirmation (expecting only the pre-existing hfi101 status-log-discipline failure) followed by the AC-fix commit.
- 2026-07-24T18:09:44.970Z — loop iteration 7: Ran the 3-agent adversarial self-review over the full hfi102 diff, fixed all actionable findings in-place, and re-verified E-3 fully green, leaving only full-suite confirmation outstanding.
  - Change: Applied fixes for all actionable findings from the 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) across the gate commands, engine frontmatter/outcome/render modules, next-pipeline gather wiring, and their test files; committed as c0c58c6.
  - Change: Resolved BH LOW-3 (gate-summary block indentation in the repo-scan form) as intentional no-change, per render.ts's documented contract that callers control block indentation — next.ts's uniform 2-space indent preserves the 0/2 relative shape.
  - Change: Re-verified E-3 exits 0 (fully green) after the review fixes, confirming the AC 7 permanent-suite contract survived the changes.
  - Learning: BH LOW-3 is intentionally no-change: renderGateSummary's contract delegates indentation to callers, and next.ts's uniform 2-space block indent preserves the documented 0/2 relative shape — future reviews should not re-flag it.
  - Learning: The full ~7-minute npm test run was still in flight when this iteration's report was emitted; the only remaining tail is full-suite confirmation, expecting exactly one failure — the pre-existing hfi101 phase-4 status-log-discipline violation that exists at the branch base and on origin/main — which must be treated as expected baseline, not an hfi102 regression.
