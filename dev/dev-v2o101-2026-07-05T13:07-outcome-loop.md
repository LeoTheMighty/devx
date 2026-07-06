---
hash: v2o101
type: dev
created: 2026-07-05T13:07:00-06:00
title: V2.6 — outcome loop + migration retro
from: v2/06-phases.md
plan: v2/
status: in-review
owner: /devx-2026-07-05T1628-89669
blocked_by: [v2l101]
branch: feat/dev-v2o101
---

## Goal

Close the loop past merge: outcome measurement + the v2 migration's own retro.
Per `v2/06-phases.md § V2.6` and `v2/02-engine.md` §4.10.

## Acceptance criteria

- [ ] `/devx outcome <hash>` + `devx outcome` CLI support: `measure_by`
      armed at workstream close; RESULTS.md scoring each numeric `G-` goal
      vs reality with verdict `keep|tune|restart|retire`; tune →
      cascade-reopen keyed to missed E-ids; restart → lineage fields
      (`learns_from`, `superseded_by`).
- [ ] `devx next` surfaces due outcomes (measure_by passed → row between
      #5 and #6).
- [ ] Migration retro: native `/devx retro` across V2.1–V2.5 workstreams;
      LEARN.md rows; ≥3-concordance promotions evaluated; v2/ docs updated
      where reality diverged from plan (append, don't rewrite).
- [ ] S-1 verification recorded: measured prose bytes for one full
      PRD→merge run under the new engine, vs the 60KB budget.
- [ ] Dead v1 prose removed from docs (DESIGN.md sections superseded by v2/
      get pointers, not deletions).
- [ ] Full suite green.

## Status log

- 2026-07-05T13:07 — created from v2/06-phases.md § V2.6.
- 2026-07-05T16:28:14-06:00 — claimed by /devx in session /devx-2026-07-05T1628-89669
- 2026-07-05T16:45 — phase 2: spec ACs direct (v2 native, no story file); 6 ACs; design source v2/02-engine.md §4.10 + §6, template _devx/templates/engine/results.md; reuse ledger — revise.ts (replayPath + min-stage rule), gate-prd.ts (extractDefinedIds), expectations.ts (parseExpectations), frontmatter.ts (applyEnginePatch, extended with lineage keys), verdict.ts (formatDate), workstream.ts (resolveWorkstream).
- 2026-07-05T17:00 — phase 3 (implement): `src/lib/engine/outcome.ts` (arm/score pure fns: resolveMeasureBy +Nw/absolute with injectable clock, parsePrdGoals with wrapped-line folding, computeGoalRows with bidirectional coverage + deterministic comparator inference, computeTune E-id-keyed reopen, renderResults template-driven with drift guard) + `src/commands/outcome.ts` (`devx outcome arm|score`, exit 0/1/2, restart lineage stamping both specs) registered in cli.ts; `devx next` due-awareness — v1 rows 2/3 gain a `today` param (pending-not-due → waiting, no command), repo table gains fractional row 5.5 outcome-due between 5 and 6 (decide.ts + gather.ts outcomeDue signal); S-4 matrix extended (isolation + strip-down + cartesian + 5 gatherer cases); S-1 full-run measurement + 2×-budget tripwire in engine-prose-budget.test.ts; test/engine-outcome.test.ts (41 tests incl. RESULTS.md golden vs the real template). Docs: migration retro `_devx/retros/v2-migration-2026-07-05.md` (9 PRs via gh + status logs; one-day wall-clock; S-1 = 24,426 B planning / 65,767 B total vs 60KB budget + ~550KB BMAD baseline), LEARN.md § v2-migration (10 rows E1–E10) + 1 promoted Cross-epic row (first-real-run, ≥3 concordance: mgr103 + v2e102 + v2d101 + v2t101), v2/06-phases.md § Outcome, v2/07-decisions.md O-1/O-3/O-4/O-6 evidence + D-2/D-4/D-5 exercised-in lines ([user] markers kept), v2/05-dispatcher.md row 5.5, docs/DESIGN.md 5 light-touch v2 pointers. Dogfood: `devx outcome arm v2x101 --measure-by 2026-08-02` then scored — **first real outcome verdict: keep, 3/3 goals hit** (G-1=0 via E-1 eval, G-2=1 via E-2 eval, G-3=1974 tests ≥1571 comparator-derived); RESULTS.md live at _devx/workstreams/execute-rehome-bmad-eject/.
- 2026-07-05T17:20 — phase 4: 3-agent parallel adversarial review (Blind Hunter 7 open findings — 3 MED / 4 LOW; Edge Case Hunter 12 — 2 HIGH / 4 MED / 6 LOW, 1 overlapping BH; Acceptance Auditor 5 + 3 NOTEs — 1 HIGH / 2 MED / 2 LOW; ~23 unique actionable, plus 3 own-pass pre-fixes the reviewers verified mid-window: `$&`-replacement expansion in renderResults, compute-then-write ordering, duplicate --reopen dedupe). ALL actionable fixed in place: row 5.5 gated on stage done — an un-scorable command can't livelock the dispatcher above rows 6–12 (BH#1/EC#4); multi-comparator + date-after-comparator goal text falls back to `recorded` — never scores against the wrong bound; the regex-lookahead-backtracking trap avoided by post-checking in code (BH#2/EC#5); crash-residue RESULTS.md (status unscored) is backed up to RESULTS.md.stale-<date> and overwritten instead of wedging every re-run (BH#3/EC#1 — header contract + tests updated); arm's patch/write wrapped in the exit-2 error mapping so scalar `outcome: pending` frontmatter no longer dies with a raw stack (EC#2); CRLF prd.md keeps goal text (EC#3); indented tables/numbered lists no longer fold into goal text (EC#6); multi-claimant, null-hash-claimant, and same-dir self-successor all refuse before stamping wrong lineage (BH#4/EC#7/EC#8); garbage outcome status ("keeep") stays actionable instead of misreading as scored (BH#5); tune-without---reopen is exit 2, symmetric with restart (EC#9); CRLF template normalized before the drift check (EC#11); duplicate E-blocks resolve first-wins matching parseExpectations (EC#12); successor-lineage write failure degrades to a JSON note instead of contradicting the recorded verdict; restart's scaffold-later note names BOTH lineage directions (AA#4); template comment + v2/02-engine.md §4.10 reconciled with tune's verification-scoped reopen (AA#2, append-only); S-1 budget decision filed as INTERVIEW.md Q#9 with options + recommendation (AA#3); v2x101 status log carries the dogfood trace (AA#5); retro/LEARN suite-timing wording made load-honest at 391–679s (AA#8). Documented-not-changed (accepted bounds, in module comments): sequential template substitution is injectable by operator-supplied placeholder literals (EC#10 — local CLI, damage visible in the artifact not silent state); European decimal commas, %-suffixed actuals, and bold cross-reference definition claims in comparator inference (BH#6/#7). +14 regression tests across the fixes; re-review clean.
- 2026-07-05T17:20 — DEVIATION (recorded per AA#1, no-silent-decisions): AC 1's `/devx outcome <hash>` SKILL half (a `Stage: Outcome` section in `.claude/commands/devx.md` prescribing arm-at-close + score-when-due) is deliberately NOT in this worker's diff — `.claude/` skill-body edits are user-foreground per the harness permission gate (v2/06-phases.md sequencing principle 4); the coordinating session owns that slice, exactly as v2t101/v2d101/v2l101 split their skill edits. The CLI half is complete and both next-tables route `/devx outcome <hash>` correctly; until the skill section lands, the dispatcher's routing line + the CLI's own usage output carry the flow.
- 2026-07-05T17:30 — phase 5: local CI green — npm test: 102 files, 2039 tests passing (baseline 1974 at claim; +65 net: 51 engine-outcome + 5 engine-next due-awareness incl. garbage-status + 8 next-dispatch row-5.5/gatherer + 2 prose-budget S-1 − 1 consolidated), typecheck green, E-1 + E-2 evals green (`npx tsx` both exit 0). Frontmatter flipped to in-review.
- 2026-07-05T17:30 — coordinator slice: Stage: Outcome skill section (arm/score delegation, verdict mechanics, sources-not-vibes, unattended→INTERVIEW rule) + 2 discipline pins; closes the recorded AA#1 deviation.
