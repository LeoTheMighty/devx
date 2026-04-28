# Retrospective — epic-merge-gate-modes

**Epic:** `_bmad-output/planning-artifacts/epic-merge-gate-modes.md`
**Plan:** `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`
**Stories:** mrg101 (`mergeGateFor()` pure function + truth-table tests) · mrg102 (`devx merge-gate <hash>` CLI passthrough + `/devx` Phase 8 integration) · mrg103 (`promoteIntegrationToDefault` wrapper — latent / dead-code-until-split-branch)
**Run by:** /devx mrgret (interim retro discipline — `LEARN.md § epic-merge-gate-modes` is the source of truth for action items; this file is a BMAD-shaped sibling for traceability)
**Run date:** 2026-04-28
**Mode at execution:** YOLO · empty-dream · send-it (single-branch on `main`)

---

## 1. Epic summary

| Metric | Value |
|---|---|
| Stories planned | 3 (+ this retro) |
| Stories shipped | 3 (mrg101, mrg102, mrg103) |
| Completion % | 100% |
| PRs | #31 (mrg101 → 48cbd2f), #32 (mrg102 → dc86eb7), #33 (mrg103 → 937624e) |
| Production incidents | 0 |
| Rollbacks | 0 |
| Self-review findings (auto-fixed) | mrg101 (1 MED + 2 LOW = 3); mrg102 (2 MED + 1 LOW + 1 prod-only ENOENT path = 4); mrg103 (0 actionable — explicitly stated in status log). |
| Tests at end of epic | ini epic close 424 → mrg101 455 (+31) → mrg102 485 (+30) → mrg103 516 (+31). **+92 net tests across the 3-story epic**, all of which exercise the pure gate logic + the CLI passthrough + the dead-code split-branch path. |
| Acceptance criteria met | All mrg101 AC1–10, mrg102 AC1–7, mrg103 AC1–5. |
| Final artifacts | `src/lib/merge-gate.ts` (`mergeGateFor()` pure function), `src/commands/merge-gate.ts` (`devx merge-gate <hash>` CLI passthrough), `src/lib/manage/promote.ts` (`promoteIntegrationToDefault` latent split-branch wrapper), `test/merge-gate-truth-table.test.ts` (20 rows), `test/merge-gate-trust-gradient.test.ts` (9 rows), `test/merge-gate-no-io.test.ts` (2 rows), `test/merge-gate-cli.test.ts` (30 rows), `test/promote-integration.test.ts` (31 rows including the 4×2×2 mode/CI/trust matrix). `.claude/commands/devx.md` Phase 8 rewritten to consume the CLI; the "Behavior by mode" table is removed from the skill body. |

Status check at retro time: epic ships every promised deliverable. The party-mode-locked decisions in `epic-merge-gate-modes.md` (non-success CI conclusions other than `cancelled` → failure; gh signal-collection failure → safe-default `{merge:false, reason:"gh signal collection failed"}`; mrg103 covers the full 4×2×2 gate-decision matrix) are all implemented and exercised in tests.

This is the project's **first Phase 1 epic to ship + retro.** It also marks the **first /devx run that consumed its own deliverable mid-epic** (mrg103's auto-merge was decided by `devx merge-gate mrg103` — the CLI shipped in mrg102, one PR earlier). Phase 1 has 4 more epics in flight (epic-pr-template, epic-devx-plan-skill, epic-devx-skill, epic-devx-manage-minimal) — mrg102 specifically unblocks dvx101 and dvx106 in epic-devx-skill, so this epic is on the critical path.

---

## 2. What worked

1. **Pure function + thin wiring + adversarial truth-table is a tight trio.** mrg101 ships `mergeGateFor()` as a pure function — no I/O, verified via a test that mocks `fs` and `child_process` to throw on access. mrg102 wraps it in a CLI passthrough that collects signals (`gh pr list/view`, config) and feeds the function. The 20-row truth-table test plus the 9-row trust-gradient test plus the 30-row CLI-integration test give layered coverage: pure-function correctness, CLI-integration correctness, and signal-collection correctness, each tested independently. Pattern: when the decision logic is grid-shaped, separate the decision (pure function, matrix tests) from the data collection (impure wrapper, integration tests). Worth memorializing for any future "rule engine" surface (gate logic, mode-derived behavior, autonomy ladders).
2. **Dogfood mid-epic, not at retro time.** mrg103 is the first PR ever merged via `devx merge-gate <hash>` — and the merge happened inside the same epic that produced the CLI. mrg102 itself was also dogfooded (the PR-32 status log records `devx merge-gate mrg102` returning `{"merge":true}` against the live PR before the squash-merge). This is the strongest possible signal that the epic's deliverable works, and it's stronger than a retro-time integration test because the consumer ran in production-shape on a real PR. Pattern: ship the consumer mid-epic, exercise it on the next PR in the same epic. Single-epic concordance; pending promotion until a second epic confirms.
3. **Self-review continued to find real bugs at every story that enumerated.** mrg101 (1 MED on the audit-log reason text + 2 LOW on plural noun + project-context leak in test), mrg102 (4 findings: 2 MED — dead `coopOverrideOK` helper + too-loose hash regex; 1 LOW — sloppy test name; 1 prod-only ENOENT path that would have masked "gh missing" as "no PR yet"). mrg103 status log explicitly says "self-review found nothing actionable" — that's enumeration, not omission (different from the §3.5 terseness pattern). **Self-review pattern now reaffirmed across Phase 0 + Phase 1's first epic** (5 Phase 0 + 1 Phase 1 epic = 6 epics). Already cross-epic-promoted; bumping the wording from "5 shipped Phase 0 epics" to "6 shipped epics (Phase 0 + first Phase 1)."
4. **Dead-code-with-tests as a contract-locking primitive (mrg103).** mrg103 ships a function with no production call site — `promoteIntegrationToDefault` is invoked nowhere in self-host because the project is single-branch. But it's compiled, type-checked, and exhaustively unit-tested (31 tests, including a 4×2×2 mode/CI/trust matrix per the party-mode locked decision). The cost is one file + one test file (~480 lines total). The value is: when a non-self-host devx user opts into `git.integration_branch != null`, `/devx-manage` can call this function instead of re-implementing the gate at a second site. Pattern: when a contract has a known-future consumer but no current consumer, ship the contract + tests now and document the dead-code declaration in the file header. Pending-concordance: 1 epic. Revisit when a second deferred-consumer surface appears (the `epic-modes-and-gates` Phase 9 candidate is the natural next case per epic body).
5. **Externalize mode logic as a CLI primitive consumed via passthrough.** mrg102's whole point is removing the "Behavior by mode" table from `.claude/commands/devx.md` Phase 8 and replacing it with a `devx merge-gate <hash>` invocation. This eliminates a class of regression — "skill body says X, code says Y" — that was named explicitly in `LEARN.md § Cross-epic patterns` (the source-of-truth precedence row) and that the audret/cfgret/cliret retros all called out as the highest-leverage cross-epic risk. Pattern: any time a skill body says "behavior depends on mode," the mode logic should live in TS as a pure function and the skill should call a CLI passthrough that wraps it. Pending-concordance: 1 epic. The Phase 1 `epic-devx-plan-skill` will produce a second instance (`devx plan-helper derive-branch`, `devx plan-helper validate-emit`); promote when that lands.
6. **Three stories shipped in one /devx session continuously (~2 hours).** mrg101 merged at T20:55 (PR #31), mrg102 at T22:55 (PR #32), mrg103 at T23:20 (PR #33). All three under YOLO single-branch full autonomy. First Phase 1 epic ships in <3 hours from claim-to-close. The cadence is faster than any Phase 0 epic — even sup (5 stories) took longer because of cross-platform implementation work. Mostly because mrg is purely TS / no platform deviation; partly because `/devx`'s own loop has matured across 33 PRs and the per-story overhead is lower. Record-only; not a finding to act on.
7. **YOLO single-branch auto-merge held across 3 PRs (#31, #32, #33).** No human merge intervention. Trust-gradient `count: 0 / initialN: 0` keeps the ladder open. Same as every Phase 0 epic. Cross-epic-promoted at cli; record-only here.
8. **`bmad-create-story` skip pattern continues — 3/3 mrg stories.** Same cumulative drift as every Phase 0 epic. Bumps the cumulative count from 25/25 across 5 Phase 0 epics → **28/28 across 6 epics** (Phase 0 + Phase 1 first epic). The CLAUDE.md inline note + the Cross-epic-patterns row both need the count bump. Skill-level corrective remains user-review-required (`self_healing.user_review_required_for: [skills]`).

---

## 3. What didn't

1. **Planner emitted `branch: feat/dev-<hash>` correctly for all 3 mrg stories.** This is actually a *positive* signal — the cross-epic fix from audret PR #19 has held across 4 epics now (cfg, cli, sup, ini, mrg). For the first Phase 1 epic, the planner-skill correction is no longer blamable. No new action; record only.
2. **`bmad-create-story` step skipped on every mrg story (3/3).** Same drift as Phase 0. Cumulative count bumps to 28/28 across 6 epics. Already CLAUDE.md-acknowledged (cfgret + cliret + supret + iniret); mrgret bumps the count + adds Phase 1 to the wording. No new corrective action — the actual skill change remains user-review-required.
3. **Retro stories (`*ret`) still absent from `sprint-status.yaml` — 6th confirmation.** audret + cfgret + cliret + supret + iniret + mrgret = 6/6 retros to date. Already cross-epic-promoted in cliret PR; the planner-skill fix to make `/devx-plan` and `/dev-plan` auto-emit retro rows lives in MANUAL.md MP0.2 (user-review-required, `skill` blast-radius). Until that ships, every retro PR has to add its own row by hand. **Apply in this PR**: backfill the mrgret row under `epic-merge-gate-modes`, ordered after mrg103 (parent-stories-then-retro convention picked by cliret PR §3.5).
4. **`/devx` Phase 8 inline note about `bmad-create-story` skip wording is stale to mrg's reality.** The current CLAUDE.md text says "Empirically across all 5 shipped Phase 0 epics (25/25 stories) this step has been skipped...reaffirmed in every retro to date (audret + cfgret + cliret + supret + iniret)." After mrgret merges, the cumulative count is 28/28 stories across 5 Phase 0 + 1 Phase 1 epic, and the reaffirmation list grows. **Apply in this PR**: update the Phase 2 inline note in CLAUDE.md.
5. **CLAUDE.md "Status: Phase 0 — Foundation (closed 2026-04-27)" section doesn't acknowledge Phase 1 starting.** epic-merge-gate-modes is the first Phase 1 epic to ship + retro, but CLAUDE.md still reads as if Phase 0 is the latest closed milestone. **Apply in this PR**: bump the Status section to acknowledge Phase 1 progress (epic-merge-gate-modes shipped; 4 epics remaining: epic-pr-template, epic-devx-plan-skill, epic-devx-skill, epic-devx-manage-minimal). Don't claim Phase 1 closed.
6. **Dist on main was stale during the mrg102 → mrg103 transition.** When mrg103 ran `node dist/cli.js merge-gate mrg103` from the main worktree, it errored with "unknown command 'merge-gate'" because `dist/` wasn't rebuilt after mrg102's source merged. The mrg103 status log notes the workaround (used `node .worktrees/dev-mrg103/dist/cli.js`). For self-host this is harmless because /devx Phase 5 builds inside the worktree, but it's a reminder that **the main-worktree dist isn't kept in sync** unless someone explicitly rebuilds. Pattern is small; record-only here. Could file as a `MANUAL.md` row to add a `npm run build` to a post-merge hook on main, but in YOLO send-it the marginal benefit doesn't justify the new piece of automation. Pending-concordance: 1 epic.
7. **Status-log terseness regression — same trajectory.** mrg101 enumerates self-review findings ("1 MED + 2 LOW — all fixed"), mrg102 enumerates ("2 MED + 1 LOW + 1 prod-only ENOENT — all fixed"), mrg103 says "self-review found nothing actionable" (which IS enumeration — explicit zero count, not omission). So mrg is **0/3 omissions**, distinct from sup 5/5 and ini 4/8. **Cross-epic count for the omission pattern stays at 2 epics (sup + ini); mrg actively bucks the trend.** Record this as a positive signal in `LEARN.md § epic-merge-gate-modes` E~ — the explicit-zero discipline ("found nothing actionable") is the right shape and worth memorializing. The `/devx` skill prompt-card line ("status log MUST enumerate self-review finding counts — including zero") would land cleanly with this third-epic data point. Pending-concordance for the SKILL change still 2/3 omission epics (sup + ini); mrg adds one more confirmation that the corrective shape is right but doesn't add to the omission count.
8. **Dist drift between main + worktrees.** Mentioned in §3.6 — collapsing here.

---

## 4. Cross-references with the existing hand-extracted entries in LEARN.md

`LEARN.md § epic-merge-gate-modes` is **empty as of retro start** — the section is a placeholder (not even the "*(empty — `mrgret` runs once mrg101–103 ship.)*" annotation that ini had, just an empty subsection at line 119). Like iniret, this pass adds entries E1–E~10 with no hand-extracted entries to reconcile against; every finding below is formal-pass.

This pass adds the following NEW findings:

- **E1** (high, docs+config) — Retro stories absent from `sprint-status.yaml` is now the **6th confirmation** (audret + cfgret + cliret + supret + iniret + mrgret = 6/6 retros). Already cross-epic-promoted in cliret PR. Skill-prompt change for auto-emission remains user-review-required (MANUAL.md MP0.2, unchanged). Cross-epic-patterns row count bumped from 5/5 → 6/6 retros. (§3.3)
- **E2** (high, docs) — Pure-function + CLI-passthrough + adversarial truth-table testing is a tight trio (mrg101 + mrg102). Pattern: separate decision logic from signal collection; matrix-test the decision; integration-test the wrapper. Worth memorializing for future "rule engine" surfaces (gate logic, autonomy ladders, mode-derived behavior). Pending-concordance: 1 epic. The Phase 1 epic-devx-plan-skill will produce a second instance via `devx plan-helper derive-branch` / `validate-emit`. (§2.1, §2.5)
- **E3** (high, docs) — Dogfood mid-epic, not at retro time (mrg103 was the first PR merged via `devx merge-gate <hash>` — the CLI shipped in mrg102, one PR earlier; mrg102 itself dogfooded `devx merge-gate mrg102` against the live PR before the squash-merge). Strongest signal that the epic's deliverable works in production shape. Pattern: ship the consumer mid-epic, exercise on the next PR. Pending-concordance: 1 epic. (§2.2)
- **E4** (high, docs) — Externalize mode logic as a CLI primitive consumed via passthrough. mrg102 explicitly removes the "Behavior by mode" table from `.claude/commands/devx.md` Phase 8 and replaces it with `devx merge-gate <hash>`. Eliminates the class of regression "skill body says X, code says Y" — the highest-leverage cross-epic risk per source-of-truth-precedence retros. Pending-concordance: 1 epic. Promote when epic-devx-plan-skill ships (`devx plan-helper` is the second instance). (§2.5)
- **E5** (med, docs) — Dead-code-with-tests as a contract-locking primitive (mrg103). Ship the function + tests when the consumer is known-future but not current; document the dead-code declaration in the file header. Cost: ~480 lines for `promoteIntegrationToDefault` + matrix test. Value: zero-rework when split-branch users arrive + drift-detection if `mergeGateFor` shifts. Pending-concordance: 1 epic. Revisit when a second deferred-consumer surface ships. (§2.4)
- **E6** (med, docs) — `bmad-create-story` skip cumulative count bumps from 25/25 across 5 Phase 0 epics → **28/28 across 6 epics** (Phase 0 + Phase 1 first epic). CLAUDE.md "How /devx runs" Phase 2 inline note + the Cross-epic-patterns row both need the count bump. Skill-level corrective remains user-review-required. (§3.2)
- **E7** (med, docs) — Status-log terseness pattern: mrg actively bucks the trend (0/3 omissions vs sup 5/5 + ini 4/8). mrg103 explicitly says "self-review found nothing actionable" — enumeration with zero count, which is the correct shape. The SKILL prompt-card change (when it lands) should require explicit-zero, not just any-enumeration. Cross-epic count for the omission pattern stays at 2/3 (mrg adds a positive third-epic confirmation but doesn't tip the omission threshold). Revisit at next retro. (§3.7)
- **E8** (med, docs) — Self-review-non-skippable now reaffirmed across Phase 0 + Phase 1 first epic. mrg101 (3 findings), mrg102 (4 findings), mrg103 (explicit zero). 6 epics total now. The Cross-epic-patterns row's "spans all 5 shipped Phase 0 epics" wording bumps to "spans all 5 shipped Phase 0 epics + the first Phase 1 epic (mrg)." (§2.3)
- **E9** (low, docs) — Three stories shipped in one /devx session continuously (mrg101 T20:55 → mrg102 T22:55 → mrg103 T23:20 = ~2.5 hours claim-to-close). First Phase 1 epic ships faster than any Phase 0 epic. Mostly because mrg is purely TS / no platform deviation; partly because /devx itself has matured across 33 PRs. Record-only; useful baseline for Phase 1 cadence comparisons. (§2.6)
- **E10** (low, docs) — Dist on main was stale during mrg102 → mrg103 transition. When mrg103 ran `node dist/cli.js merge-gate mrg103` from the main worktree, it errored with "unknown command 'merge-gate'" because `dist/` wasn't rebuilt after mrg102's source merged. Workaround: `node .worktrees/dev-mrg103/dist/cli.js`. Marginal-benefit corrective (post-merge build hook on main) doesn't justify the new automation in YOLO send-it. Pending-concordance: 1 epic; revisit if it bites a second time. (§3.6)
- **E11** (low, docs) — First /devx run that consumed its own epic's deliverable mid-epic (mrg103's auto-merge decided by mrg102's CLI). Useful audit precedent for any future epic where the consumer of a new primitive ships within the same epic boundary. (§2.2)
- **E12** (low, docs) — First Phase 1 epic to ship + retro. After this PR merges, Phase 1 has 1/5 epics shipped (epic-merge-gate-modes done; epic-pr-template, epic-devx-plan-skill, epic-devx-skill, epic-devx-manage-minimal remaining). The Cross-epic-patterns section now spans Phase 0 + Phase 1; the wording in CLAUDE.md "Status" section bumps from "Phase 0 — Foundation (closed 2026-04-27)" to add a Phase 1 progress block. (§3.5)

---

## 5. Items applied in this PR (low blast radius)

1. **Backfill the `mrgret` row in `sprint-status.yaml`** under `epic-merge-gate-modes`, ordered after mrg103 (parent-stories-then-retro convention picked by cliret PR §3.5). Status: `in-progress` while this PR is in flight; flipped to `done` by the `chore: mark mrgret done after PR #N merge` commit (per /devx Phase 8.6). Resolves E1.
2. **Append `LEARN.md § epic-merge-gate-modes`** with formal-pass entries E1–E12 alongside a short prelude noting that no hand-extracted entries exist for this section (placeholder-empty at retro start).
3. **Bump the Cross-epic-patterns row "Retro stories (`*ret`) absent from `sprint-status.yaml`" from "5/5 retros" to "6/6 retros"** to reflect mrgret's confirmation. Mechanical wording bump; the skill-prompt edit remains user-review-required (MP0.2 unchanged).
4. **Bump the Cross-epic-patterns row "`bmad-create-story` step in `/devx` Phase 2 silently skipped" from "25/25 across 5 shipped Phase 0 epics" to "28/28 across 6 epics (Phase 0 + Phase 1 first epic)"** to reflect mrg × 3 confirmations. Mechanical wording bump; skill-level corrective remains user-review-required. Resolves E6.
5. **Bump the Cross-epic-patterns row "Self-review is non-skippable" stories-spanning count** from "spans all 5 shipped Phase 0 epics" → "spans all 5 shipped Phase 0 epics + the first Phase 1 epic (mrg)". Resolves E8.
6. **Update CLAUDE.md "How /devx runs" Phase 2 inline note** —
   - `5 shipped Phase 0 epics (25/25 stories)` → `6 shipped epics (Phase 0 + first Phase 1; 28/28 stories)`,
   - `audret + cfgret + cliret + supret + iniret` → `audret + cfgret + cliret + supret + iniret + mrgret`,
   - reaffirmation count `every retro to date` (already correct) is unchanged but the parenthetical list grows.
7. **Bump CLAUDE.md "Self-review is non-skippable" working agreement** to span Phase 0 + Phase 1's first epic.
8. **Update CLAUDE.md "Status" section** to add a Phase 1 progress block: "Phase 1 — Single-agent core loop (in flight): epic-merge-gate-modes shipped (PRs #31/#32/#33 + this retro PR); 4 epics remaining (epic-pr-template, epic-devx-plan-skill, epic-devx-skill, epic-devx-manage-minimal). epic-merge-gate-modes unblocks dvx101 + dvx106 in epic-devx-skill." Don't claim Phase 1 closed.

---

## 6. Items NOT applied (filed instead)

| Finding | Why not applied here | Filed as |
|---|---|---|
| Skill-prompt change to `/devx-plan` + `/dev-plan` so retro rows auto-emit into `sprint-status.yaml` | Already filed by cliret PR. mrgret reaffirms (6/6 retros) but adds no new MANUAL row. | `MANUAL.md MP0.2` (carried forward; user-review-required). |
| `bmad-create-story` skip enforcement decision | Already cross-epic-promoted; `skill` blast-radius (`self_healing.user_review_required_for: [skills]`). mrgret bumps the count from 25/25 → 28/28 but adds no new MANUAL row. | `LEARN.md § Cross-epic patterns` row "bmad-create-story step in /devx Phase 2 silently skipped" — mrgret reaffirms by adding 3/3 mrg confirmations. |
| aud101–103 stale sprint-status flips | Cross-epic; out of scope for mrgret. | `MANUAL.md MP0.1` (carried forward). |
| Pure-function + CLI-passthrough + truth-table promotion (E2) | 1-epic concordance only. Promotion candidate when epic-devx-plan-skill ships (`devx plan-helper derive-branch` / `validate-emit` is the natural cross-epic confirmation). | `LEARN.md § epic-merge-gate-modes` row (E2) `pending-concordance`. |
| Dogfood-mid-epic (E3) | 1-epic concordance only. Revisit when a second epic ships its consumer mid-epic. | `LEARN.md § epic-merge-gate-modes` row (E3) `pending-concordance`. |
| Externalize-mode-logic-as-CLI-primitive (E4) | 1-epic concordance only. Promotion candidate when epic-devx-plan-skill ships. | `LEARN.md § epic-merge-gate-modes` row (E4) `pending-concordance`. |
| Dead-code-with-tests primitive (E5) | 1-epic concordance only. Revisit when a second deferred-consumer surface ships. | `LEARN.md § epic-merge-gate-modes` row (E5) `pending-concordance`. |
| Status-log terseness (E7) — explicit-zero discipline | mrg's 0/3 omissions adds a positive signal but doesn't tip the omission threshold (still 2/3 epics: sup + ini). The corrective is a `/devx` skill prompt-card line — `skill` blast-radius, user-review-required. | `LEARN.md § epic-merge-gate-modes` row (E7) `pending-concordance`. |
| Dist-on-main staleness (E10) | 1-epic single observation. Marginal-benefit corrective (post-merge build hook); doesn't justify new automation in YOLO send-it. | `LEARN.md § epic-merge-gate-modes` row (E10) `pending-concordance`. |

---

## 7. Readiness check for next epic in dependency order

epic-merge-gate-modes is closed. After mrgret merges, the **first Phase 1 epic closes**. Phase 1 has 4 epics remaining:

- **epic-pr-template** (independent) — prt101 (template + /devx-init writes idempotently) + prt102 (/devx Phase 7 substitution). prt101 has no dependencies; ready now.
- **epic-devx-plan-skill** (independent) — pln101 → pln102 → pln103 → {pln104, pln105, pln106}. pln101 has no dependencies; ready now.
- **epic-devx-skill** — dvx101 (atomic claim + push-before-PR) is blocked-by mrg102 + prt102. mrg102 is now done; dvx101 still needs prt102. dvx106 (Phase 8 auto-merge wired through devx merge-gate) is unblocked by mrg102 alone but blocked-by dvx101.
- **epic-devx-manage-minimal** — mgr101 is blocked-by dvxret. Far downstream.

Critical-path summary: mrg102 unblocks dvx106 (and partially dvx101). prt102 is the second blocker for dvx101. The natural next /devx pick is either prt101 or pln101 (both independent of any Phase 1 work). pln101 is probably higher-leverage because it lands the helper that the next epic (pln) depends on internally.

There are no surprise dependencies surfacing at retro time. The Phase 5 LearnAgent + RetroAgent that supersede this interim retro discipline remain on the ROADMAP for Phase 5; until then the per-epic `*ret` story convention continues.

---

## 8. Closure

mrgret is the **first Phase 1 application** of the interim retro discipline. After this PR merges, Phase 1's first epic is closed end-to-end. The deliverable is:

- this BMAD-shaped retro file (sibling to LEARN.md for traceability),
- `LEARN.md § epic-merge-gate-modes` populated with E1–E12 (no hand-extracted entries to reconcile — section was placeholder-empty at retro start),
- **zero** new Cross-epic-patterns rows promoted from pending-concordance to confirmed (every E2–E5 finding is single-epic; promotion candidates listed for next-retro consideration),
- two cross-epic-patterns row count bumps: `*ret`-rows-absent (5/5 → 6/6 retros), `bmad-create-story`-skipped (25/25 → 28/28 stories across 5 → 6 epics),
- one Cross-epic-patterns wording bump for self-review-non-skippable (Phase 0 → Phase 0 + Phase 1 first epic),
- two CLAUDE.md edits applied (Phase 2 inline note bump + Working-agreements self-review bump + Status section Phase 1 progress block),
- one mechanical config edit (mrgret row added to `sprint-status.yaml`),
- zero new MANUAL.md rows (MP0.1 + MP0.2 carry forward; mrgret reaffirms the latter for the 6th time but adds no new user-actionable surface).

Concordance threshold for cross-epic promotion (≥3 epics) was not met by any new mrg-specific finding — Phase 1 is too young for that. The next pending-concordance candidates that will tip after the second Phase 1 retro are:

- Pure-function + CLI-passthrough + truth-table testing (1 epic — mrg; Phase 1's epic-devx-plan-skill `devx plan-helper` is the natural 2nd-epic candidate),
- Externalize mode logic as CLI primitive (1 epic — mrg; same natural candidate as above; E2 + E4 will likely promote together),
- Dogfood-mid-epic (1 epic — mrg; revisit when a second epic ships its consumer mid-epic),
- Dead-code-with-tests primitive (1 epic — mrg; revisit when a second deferred-consumer surface ships),
- Status-log terseness explicit-zero discipline (3 epics observed — sup omits 5/5, ini omits 4/8, mrg explicit-zero 0/3; the SKILL change should require explicit-zero specifically, not just any enumeration),
- Dist-on-main staleness (1 epic — mrg; revisit if a second occurrence shows).

Source of truth for action items going forward: `LEARN.md`. This file is a parallel artifact for downstream BMAD-shaped consumers (RetroAgent + LearnAgent in Phase 5) to ingest when those land. Phase 1 — Single-agent core loop is **1/5 epics complete**.
