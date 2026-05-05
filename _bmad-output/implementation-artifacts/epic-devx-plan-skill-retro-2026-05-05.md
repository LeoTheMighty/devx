# Retro — `epic-devx-plan-skill` (Phase 1, plan-b01000)

**Date:** 2026-05-05
**Story:** `plnret` (`dev/dev-plnret-2026-04-28T19:30-retro-devx-plan-skill.md`)
**Epic:** `_bmad-output/planning-artifacts/epic-devx-plan-skill.md`
**Shipped stories:** pln101 (PR #38) → pln102 (PR #39) → pln103 (PR #40) → pln104 (PR #41) → pln105 (PR #42) → pln106 (PR #43). Six parent stories + this retro = 7/7. **Closes epic-devx-plan-skill.**
**Phase 1 progress after merge:** 3/5 epics shipped + retroed (mrg + prt + pln); 2 remaining (epic-devx-skill, epic-devx-manage-minimal).

---

## 1. Outcome

The bootstrap `/devx-plan` skill produced epics + dev specs that needed hand-fixes at every claim:

- `branch:` frontmatter hardcoded to `develop/dev-<hash>` while project is single-branch (the cross-epic regression class promoted from Phase 0 retros).
- Retro stories filed in DEV.md but missing from `sprint-status.yaml` (5/5 in Phase 0 + mrg + prt = 7/7 retros required hand-backfill).
- Party-mode locked decisions sometimes contradicted spec ACs without the spec being updated (cfg202, cli302).
- Phase 6.5 mode gate was prose, not predicate.
- Phase 8 final-summary "Next command" block was free-form.

After this epic ships, all five regression classes are closed *structurally*, not by prose discipline:

- `pln101` ships `deriveBranch()` (pure fn) + `devx plan-helper derive-branch` CLI; skill body invokes the CLI for every spec's `branch:` value.
- `pln102` ships `emitRetroStory()` + `writeRetroAtomically()` with fixed-order rename atomicity (locked decision #7); skill body co-emits all three artifacts (spec / DEV.md / sprint-status.yaml) per epic.
- `pln103` ships `devx plan-helper validate-emit` — six structural-error checks (orphan specs, DEV.md/sprint-status/retro trifecta cross-refs, deriveBranch parity, locked-decision unknown-hash) + one warn-severity heuristic (locked-decision identifier-token missing from spec ACs). Aborts the planning run on error.
- `pln104` documents the explicit four-step source-of-truth-precedence override flow in Phase 6 (lock → compare → update epic + status log → propagate to spec AC + spec status log) + a fixture proving validate-emit's check #6 catches the residual drift.
- `pln105` rewrites Phase 6.5 as an explicit binary predicate (`IF mode == "YOLO" THEN skip-with-one-line-summary ELSE run-focus-group-per-epic`), with documented branches for all four modes.
- `pln106` pins the Phase 8 `Next command(s)` block format to a 9-invariant snapshot; reference renderer in test validates inputs (hash shape, title rules) so silent malformed lines can't reach Concierge.

**Test count growth:** 560 baseline (post-prtret merge, pre-pln101) → 767 final (post-pln106 merge). **+207 net tests across 6 stories** — 2nd-largest growth of any epic to date (ini was +225 in Phase 0). Largest of any Phase 1 epic so far (mrg ~92, prt ~46, pln ~207).

**Wall-clock:** pln101 (2026-05-02) → pln106 (2026-05-05). ~3 calendar days, mostly across two `/devx` sessions: pln101+pln102 in one push on 2026-05-02/03, then pln103 on 2026-05-04, then pln104+pln105+pln106 in a single 2026-05-05 session.

**Self-review pattern:** 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) on 4/6 substantial-surface stories (pln102: 27 → HIGH/MED fixed; pln103: 27 → 11 substantive fixes; pln105: 16 → 14 fixed; pln106: 16 → 14 valid fixes). Single-pass review on the 2 below-threshold stories (pln101: 1 HIGH on 27-test, ~75-LoC surface; pln104: 3 MED on 40-line skill body + 250-line test). Total raw findings across the epic: **90+** — a meaningful fraction of which were load-bearing semantics issues (regex over-anchoring, hash substring collision, tmp-filename PID collision under future Phase 2 parallelism, CRLF normalization gaps, code-fence tracking in markdown parsers). pln104 is the **first story** to apply the prtret E3 cross-epic rule "single-pass when below the 500-line substantial-surface threshold" — confirms the heuristic.

---

## 2. What worked

### 2.1 The pure-fn + CLI-passthrough + adversarial-testing trio scales

`mergeGateFor()` (mrg101) + `renderPrBody()` (prt102) + `deriveBranch()` (pln101) + `emitRetroStory()` (pln102) + `validateEmit()` (pln103) all follow the same shape: pure function in `src/lib/<domain>/<thing>.ts`; CLI passthrough wrapper in `src/commands/<command>.ts`; layered tests (truth-table / golden-fixture for the pure fn + CLI integration tests for the wrapper). pln epic ships **three fresh instances** of the pattern — bumps cross-epic count from 2/3 (mrg + prt at prtret) to 3/3. **Promoted to Cross-epic patterns this PR.**

The pattern's *micro-variant* introduced in pln102: when the I/O is sufficiently tight to the pure logic, keep them in the same file but export the pure piece separately. `emit-retro-story.ts` exports `emitRetroStory()` (pure) and `writeRetroAtomically()` (impure I/O driver). vs mrg101/mrg102 which kept the pure fn and the CLI in separate files. Both work; the same-file shape is appropriate when the I/O is just the persistence layer for the pure output.

### 2.2 Externalize behavior-as-CLI-primitive consumed via passthrough

`mrg E4` (mrgret) said: any time a skill body says "behavior depends on mode," the mode logic should live in TS as a pure function and the skill should call a CLI passthrough. `prt E6` (prtret) generalized: any time a skill body says "behavior depends on something with edge cases," externalize. pln epic ships **three new applications**:

- `pln101`: `branch:` derivation → `devx plan-helper derive-branch`.
- `pln102`: retro-story emission (3-artifact atomicity) → `devx plan-helper emit-retro-story`.
- `pln103`: cross-reference validation → `devx plan-helper validate-emit`.

Cross-epic count now 3/3 (mrg + prt + pln). **Promoted to Cross-epic patterns this PR.** The skill body's role is reduced to "invoke the right CLI and react to its exit code" — the regression class "skill body says X, code says Y" is closed at planning surface.

### 2.3 3-agent parallel adversarial self-review on substantial-surface stories

prt E3 said: when the change has substantial surface area (>500 lines new code, multiple regex/substitution sites, integration with multi-marker on-disk state), parallel adversarial reviewers in different framings (Blind Hunter / Edge Case Hunter / Acceptance Auditor) catch more than single-pass. pln epic exercises this **4 times** within the epic: pln102, pln103, pln105, pln106 — each running 3-agent passes that surfaced 27 / 27 / 16 / 16 raw findings (86 total raw across the 4 substantial stories). Single-pass would have caught maybe 8-12 of those. Cross-epic count: prt + pln = 2 epics with rich coverage (4 internal observations in pln, 1 in prt). **Promoted to Cross-epic patterns this PR** per the iniret precedent for "promote at 2 epics with rich internal coverage."

The orthogonal framings cover different failure modes:

- **Blind Hunter** (no spec context): regex over-anchoring, missing CRLF handling, multi-marker `replaceAll` collision, `path.sep` Windows portability.
- **Edge Case Hunter**: BOM, headings-only AC, sliceAtMarker substring vs line-anchored, tmp filename PID+ms collision under Phase 2 parallelism, mkdir-in-try/catch ordering, hash-prefix substring collision in DEV.md row probing, sprint-status `- key:` over-anchoring at deeper indent.
- **Acceptance Auditor** (spec compliance): AC code-block test gaps, AC `includes()` fallback breaks line-anchoring discipline, AC wording precision, AC closure deferral on partial coverage.

### 2.4 pln104 confirmed the single-pass-below-500-LoC threshold

pln104's actual changeset: 40-line skill body edit in `.claude/commands/devx-plan.md` Phase 6 + 250-line `test/plan-precedence-enforcement.test.ts` fixture-and-doc-check file. Below the substantial-surface threshold from `prt E3`. Used single-pass review. Surfaced 3 MED findings, all fixed in-place. **First downstream application of the prtret cross-epic rule** — validates the heuristic. The threshold isn't arbitrary; below it, single-pass catches the relevant cases without the orthogonal-framing premium.

### 2.5 pln103's `validate-emit` was dogfooded mid-epic

PR #40 body: "ran `devx plan-helper validate-emit` against all 5 Phase 1 epics — exit 0 across the board; warnings surface real source-of-truth drift between locked decisions and specs, which is exactly what the heuristic is meant to flag." This is the **dogfood-mid-epic** pattern (sister to mrg E11 and prt E9). The CLI ran on the same epic file that authored its own existence — the **strongest** verification shape because the test surface IS the production input.

plnret itself flows through `devx pr-body` (Phase 7 — PR-body rendering) and `devx merge-gate plnret` (Phase 8 — merge gating) — the same shape every /devx run since prt102 merged uses, including each of pln101–pln106. `validate-emit` is a plan-time tool consumed by `/devx-plan` Phase 6, not by `/devx`; the next `/devx-plan` invocation that emits a retro story (consuming pln102's emit-retro-story helper) will be the first run to exercise validate-emit on freshly-emitted retro artifacts.

### 2.6 Atomic multi-artifact emission with fixed-order rename + WARN-not-rollback

pln102's `writeRetroAtomically()` implements locked decision #7 verbatim: write all three artifacts to `*.tmp` first; rename in fixed order (spec → DEV.md → sprint-status.yaml); on any rename failure, **prior renames stay committed** and partial state is logged WARN with the actual on-disk paths + leftover `.tmp` paths so the operator can recover or `git clean -f`. **Better partial than zero.** Test fixture covers each of the three rename failure points.

The pattern is generalizable for any multi-artifact emission downstream — Phase 2 ManageAgent state writes (`schedule.json` / `manager.json` / `heartbeat.json`), Phase 4 mobile-companion offline-queue snapshots, any future linter that emits to multiple files. Pending-concordance: 1 epic. Revisit when the next multi-artifact-emission story lands.

### 2.7 Source-of-truth-precedence enforced bidirectionally for the first time

pln102 hit a real conflict mid-implementation: spec AC #6 said "rollback the other two on any rename failure"; party-mode locked decision #7 said "fixed-order renames; partial state WARN'd, never rolled back." Author **followed the locked decision** (more recent, more thoughtful, considered the actual operational shape) AND **rewrote AC #6** in the same PR to match — per the "fix the loser" rule from cfg202. Compare with cli302 (no loser to fix) and cfg202 (fix the loser was skipped, caught at cfgret). pln102 is the **first instance** where the author applied the rule structurally in the same PR. Confirms the rule's mechanics are now load-bearing.

### 2.8 pln104 demonstrated valid scope shrinkage

pln104's spec said "Source-of-truth-precedence enforcement at planning time." The implementation surface: a 40-line skill body documentation rewrite + 250-line test fixture. Why so thin? Because pln103's `validate-emit` already shipped check #6 (locked-decision-token-missing-from-spec) — the structural enforcement was already in place. pln104's contribution was to **document the override flow** explicitly (so a future plan author or LearnAgent knows *what* validate-emit is enforcing) and to **prove the catch mechanism** with a before/after fixture. Pattern: when an epic's later story discovers its core mechanic already shipped in an earlier story, the right move is to thin the story to doc + closure + test, not expand it to net-new code.

### 2.9 The structural Phase 6.5 mode predicate (pln105)

Replacing prose-mode-gates with explicit binary predicates is downstream of `mrg E4` ("any time a skill body says 'behavior depends on mode,' externalize"). pln105 doesn't externalize to a CLI (the gate IS the skill body's branch decision — there's no shared logic with anything else), but it removes prose ambiguity. Skill bodies have a binary predicate written verbatim, with all four mode branches (YOLO / BETA / PROD / LOCKDOWN) documented. Test fixture exercises YOLO + BETA + PROD acknowledgment paths. LOCKDOWN's "mandatory unless `focus_group.binding: false` opt-out" is the one branch tested via doc-check rather than runtime fixture (no LOCKDOWN sessions to exercise; revisit when LOCKDOWN is first used).

### 2.10 Phase 8 `Next command(s)` block format pinned + reference renderer (pln106)

pln106 pins 9 format invariants (leader, depends-only, parallel-safe, both-form, empty-case, hash-shape, title-rules, indent, separator-spacing). The reference renderer in test validates inputs and short-circuits on any malformed line — silent malformed output can't reach Concierge. Empty-case literal aligns byte-identically with spec AC#3 (no leading indent + 2 spaces between `next` and `#`) — the load-bearing fix per source-of-truth precedence (spec ACs > skill defaults; first-pass impl used column-aligned 12-space form which the spec explicitly didn't sanction).

---

## 3. What didn't (and how we'll respond)

### 3.1 Status-log terseness pattern reaches cross-epic threshold

`ini E7` and earlier `sup E5` flagged: status logs sometimes omit per-story self-review finding counts. pln contributes the third-epic-of-confirmation:

- **Rich enumeration (per-phase + counts):** pln101, pln102 (very rich).
- **Minimal (3-4 lines, no per-phase or per-finding-count breakdown):** pln103, pln104, pln105, pln106.

So pln is **4/6 stories with terse logs** — matching ini's 4/8 mixed. Cross-epic count: sup (5/5 uniform omit) + ini (4/8 mixed) + pln (4/6 mixed) = **3 epics confirming the corrective-needs-promotion threshold**. mrg (0/3 omit) and prt (0/2 omit) are positive counterexamples that sharpen the case for the corrective: the variance is real, the cause is `/devx` run-style rather than story-shape (note pln103/105/106 had substantial implementation work that warranted rich logs but didn't get them).

The corrective is a `/devx` skill prompt-card line: "Status-log entries MUST enumerate per-phase milestones AND self-review finding counts (use explicit-zero like 'self-review found nothing actionable' per `LEARN.md § epic-merge-gate-modes` E7 when applicable; never omit)." This is `skill` blast-radius and remains user-review-required (`self_healing.user_review_required_for: [skills]`). **Promoted to Cross-epic patterns + filed as `MANUAL.md MP1.1` this PR.**

### 3.2 `bmad-create-story` skip cumulative count bumped to 36/36 across 8 epics

Phase 0 25/25 + mrg 3/3 + prt 2/2 + pln 6/6 = **36/36 parent stories across 8 shipped + retroed epics**. No `_bmad-output/implementation-artifacts/story-*.md` file has ever been produced for a parent story (the only files in that directory are the 7 retro `epic-*-retro-*.md` files + this one + sprint-status.yaml). Spec ACs continue to be the de-facto source of truth in YOLO + empty-dream. The skill change (enforce / make conditional / drop) is `skill` blast-radius and remains user-review-required. **CLAUDE.md "How /devx runs" Phase 2 inline note bumped to the 36/36 cumulative count this PR.**

### 3.3 Plnret itself needed manual sprint-status backfill — but this is the LAST one

plnret was emitted by `/devx-plan` on 2026-04-28 — **before** pln102's `emitRetroStory()` shipped. So plnret's sprint-status row was already in `sprint-status.yaml` (the planner did emit it manually-typed at the time), but with `status: backlog`. This PR flips it to `status: done` and marks `epic-devx-plan-skill` itself `status: done` — the standard retro-PR backfill.

**However, this is the last retro that needs manual backfill.** Future `/devx-plan` runs that use `pln102`'s `writeRetroAtomically()` will co-emit the sprint-status row at planning time, with `status: backlog` set by the helper, and the retro PR will only need the `backlog → ready-for-dev → done` flips that the regular `/devx` Phase 8.6 cleanup is supposed to do.

The cross-epic-patterns row "Retro stories absent from sprint-status.yaml" is **structurally closed** by pln102 (helper exists; planner uses it). **MP0.2 is closed by pln102 — marked done in MANUAL.md this PR.**

### 3.4 `bmad-retrospective` is still not formally wired

Same gap as every prior retro: the formal `bmad-retrospective` skill from `_bmad/bmm/workflows/4-implementation/retrospective/` exists in the BMAD library but isn't invoked as a skill from `plnret` (or any prior `*ret`). The interim discipline (this LEARN.md + per-epic `*ret` story + this BMAD-shaped retro file) continues to substitute. Phase 5 `epic-retro-agent` will close this. Recorded only.

### 3.5 Helper signature drift vs spec ACs in pln102

`emitRetroStory()`'s actual signature returns `{specPath, specBody, devMdRow, sprintStatusRow}` and accepts opts that include `branch` and `now` — extra fields beyond AC #1's literal `{specPath, devMdRow, sprintStatusRow}`. Both extras are operationally load-bearing: `specBody` is consumed by the atomic-write driver; `branch` is composed by the CLI from `deriveBranch()` to keep `emitRetroStory` pure (no config import inside the helper); `now` is the test seam. pln102's status log notes the deviation under source-of-truth precedence ("AC #1 is the contract; the deviation is documented here for the next agent") — but the spec AC #1 itself wasn't rewritten. Compare with AC #6 which WAS rewritten in pln102 to match the locked decision.

The gap: AC #1 isn't a *conflict* with anything else (nothing else specifies the helper signature), so "fix the loser" doesn't have a loser. The right shape would have been to rewrite AC #1 in the same PR to match implementation under "source-of-truth precedence: implementation reality is the ground truth once shipped." Instead, pln102 noted the deviation in status log only.

Internal observation; not promoting. Pending-concordance + revisit at next helper-signature evolution.

---

## 4. Findings (tagged for `LEARN.md`)

Eleven findings appended to `LEARN.md § epic-devx-plan-skill`. Three promotions to `Cross-epic patterns`. One `MANUAL.md` row added.

---

## 5. Phase 1 progress + closure note

After this PR merges, Phase 1 has **3/5 epics shipped + retroed** (mrg + prt + pln). 2 remain: epic-devx-skill (now fully unblocked: mrg102 ✓ + prt102 ✓ + pln epic ✓; ready for Phase 1's 4th epic), epic-devx-manage-minimal (still blocked-by dvxret).

Phase 1's first 3 epics combined: **+345 net tests** (mrg ~92 + prt ~46 + pln ~207). epic-devx-skill (7 stories) and epic-devx-manage-minimal (7 stories) remain — Phase 1 will close at ~5 epics + ~28 parent stories.

CLAUDE.md "Status: Phase 1" block updated this PR to reflect 3/5 epics shipped.
