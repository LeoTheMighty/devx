---
hash: 75563d
type: debug
created: 2026-09-02T09:20:00-06:00
title: "RED eval sha lock is unwired — Gate 4 never calls stampEvalShas()"
status: ready
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
blocked_by: []
branch: null
owner: null
---
## Goal

`gate_status.red_eval_shas` is written on every Gate 4 PASS, so
`verifyStepBodies()` has something to verify and `/devx` Phase 5's hard stop
can actually fire.

Today it never is. `stampEvalShas()` (`src/lib/engine/evals-lock.ts:85`) has
**zero callers in `src/`** — the library shipped, the call site did not. Every
workstream that passes Gate 4 comes out unstamped, which the lock's own
grandfathering rule reads as "predates the stamp": unstamped evals report,
never block. So the lock is silently inert for every workstream in the repo,
including new ones.

## Acceptance criteria

- [ ] AC 1: Repro exists — a test that runs `devx gate evals <hash>` to PASS
      on a fixture and asserts `gate_status.red_eval_shas` is written with one
      entry per run eval. It must FAIL against `main` today.
- [ ] AC 2: Root cause documented with evidence in the status log
      (`grep -rn "stampEvalShas" src/` returns only the definition).
- [ ] AC 3: Gate 4 stamps on PASS, and `verifyStepBodies()` reports `moved` /
      `missing` against a stamped workstream. `/devx` Phase 5's hard stop
      fires on a `moved` body.
- [ ] AC 4: Decide and record what `stepBody()` means for a `.ts` eval.
      `stepBody()` is written for step-bearing markdown — it strips
      "result of record" LINES (`Status:`, `Last run:`, `| … |` rows). Applied
      to a `.ts` script the whole file is step body, which is probably right
      but is currently unstated; a `.ts` eval that prints a markdown table
      row would have that line silently stripped from its own hash.
- [ ] AC 5: Existing unstamped workstreams stay grandfathered — this must not
      retroactively block a workstream whose Gate 4 predates the fix.
- [ ] AC 6: The two shipped skill bodies that describe the lock as ACTIVE
      (`.claude/commands/devx.md` "Fix the code, not the eval";
      `.claude/commands/devx-plan.md` RED stage step 2b) either become true or
      are corrected. Both currently assert behavior no code implements.

## Technical notes

Found during `/devx red a494be` (2026-09-02): Gate 4 returned PASS with all 8
evals recorded `right-reason`, and the plan spec's frontmatter carried no
`red_eval_shas` key at all.

This is the same defect class as the workstream that found it —
`docs-layout-resolution` exists because `engine.docs_layout` is documented as
load-bearing and read by nothing. Worth noting at that workstream's retro:
"a shipped library with no call site" and "a documented key with no reader"
are the same failure wearing different clothes, and neither has a mechanical
guard today.

CLAUDE.md § "Fix the code, not the eval" also states the lock as fact.

## Status log

- 2026-09-02T09:20 — filed during `/devx red a494be`. Evidence:
  `grep -rn "stampEvalShas" src/` → definition only
  (`src/lib/engine/evals-lock.ts:85`), no caller. Gate 4 PASS on `a494be`
  wrote `gate_verdicts.evals: PASS` and `evals_red: true` but no
  `red_eval_shas`. Out of scope for the RED stage that found it.
