# Retro — `epic-devx-skill` (Phase 1, plan-b01000)

**Date:** 2026-05-07
**Story:** `dvxret` (`dev/dev-dvxret-2026-04-28T19:30-retro-devx-skill.md`)
**Epic:** `_bmad-output/planning-artifacts/epic-devx-skill.md`
**Shipped stories:** dvx101 (PR #45) → dvx102 (PR #46) → dvx103 (PR #47) → dvx104 (PR #48) → dvx105 (PR #49) → dvx106 (PR #50) → dvx107 (PR #51). Seven parent stories + this retro = 8/8. **Closes epic-devx-skill.**
**Phase 1 progress after merge:** 4/5 epics shipped + retroed (mrg + prt + pln + dvx); 1 remaining (epic-devx-manage-minimal — was blocked-by dvxret; now unblocked).

---

## 1. Outcome

The bootstrap `/devx` v0 skill body shipped 25/25 Phase 0 stories + 11 Phase 1 stories across mrg+prt+pln. Empirically it worked — but every shipped story still required cross-epic-pattern hand-fixes at claim time (push-claim-before-PR; develop-vs-feat branch derivation; mode-table prose drift between skill body and `mergeGateFor`). epic-devx-skill closes those regression classes **structurally**, not by prose discipline:

- `dvx101` ships `claimSpec()` (atomic 6-step claim with rollback) + `devx devx-helper claim` CLI; skill body Phase 1 invokes the CLI as the first operation. Closes `feedback_devx_push_claim_before_pr.md` structurally.
- `dvx102` ships `shouldCreateStory()` + `_internal.skip_create_story_canary` flag + `devx devx-helper should-create-story` CLI; canary ships **off** (v0 behavior preserved — helper decision logged but not honored). Closes the LEARN.md 36/36-silent-skip cross-epic row's *contract*; the empirical pattern continues until the canary flips.
- `dvx103` mandates the Phase 4 status-log line in canonical zero-issue and non-zero shapes + ships `test/devx-status-log-discipline.test.ts` with a frozen pre-discipline grandfather list.
- `dvx104` ships `coverageTouchedGate()` (mode dispatch) + `parseOptOutMarkers()` in `src/lib/devx/coverage-touched.ts`; skill body Phase 5 dispatches by mode verbatim.
- `dvx105` ships `probeRemoteCi()` + `awaitRemoteCi()` in `src/lib/devx/await-remote-ci.ts` + `devx devx-helper await-remote-ci` (with `--once` for cache-warm `ScheduleWakeup` polling); skill body Phase 7 routes the 5-state ProbeState to terminal actions.
- `dvx106` ships `deriveMergeAdvice()` extension to `merge-gate.ts` + the 3 canonical `advice` keywords (`"file INTERVIEW for approval"` / `"wait for CI"` / `"manual merge required"`); skill body Phase 8 removes the per-mode "Behavior by mode" table entirely and dispatches via exit code + advice.
- `dvx107` pins the `stop_after` argument schema + the Handoff Snippet template via `parseHandoffSnippet()` validator + `test/devx-handoff-snippet.test.ts` (test-only lock — no production consumer; validator asserts skill body prose shape doesn't drift).

**Test count growth:** 791 baseline (post-pln106 + interim merges, pre-dvx101) → 1046 final (post-dvx107 merge). **+255 net tests across 7 stories** — **largest growth of any Phase 1 epic to date** (mrg ~92, prt ~46, pln ~207). Within Phase 0+1 only ini's +225 was previously the high-water mark. Per-story deltas: dvx101 +14, dvx102 +53, dvx103 +3, dvx104 +54, dvx105 +68, dvx106 +42, dvx107 +21.

**Wall-clock:** dvx101 (2026-05-05T18:30) → dvx107 (2026-05-06T17:14). ~23 hours across two `/devx` push sessions: dvx101 standalone on 2026-05-05; dvx102+dvx103+dvx104+dvx105+dvx106+dvx107 on 2026-05-06. The fastest Phase 1 epic by calendar days (pln took 3, mrg took ~2.5h within one day, prt took ~5 days).

**Self-review pattern:** 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) on 3/7 substantial-surface stories (dvx101: 11 actionable across 3 reviewers — 3 HIGH / 5 MED / 3 LOW; dvx105: ~12 pass-1 + 6 pass-2 — pinned headSha + coerceGhRun strictness + maxPolls/pollMs production-safety guards; dvx106: ~40 raw across all severities — exit-2-emits-decision-without-advice + cancelled/action_required → MANUAL not WAIT + filter-fallthrough preserves explicit gate advice). 2-agent parallel review on 1/7 (dvx107: Acceptance Auditor + Blind Hunter; the bmad-edge-case-hunter agent type was unavailable in this environment — fell back gracefully, surfaced 1 MED + 1 LOW-cosmetic + 5 LOW-defensive). Single-pass review on 3/7 below-threshold stories (dvx102: claim-of-skip; dvx103: 2 findings — 1 HIGH + 1 MED on 290-LoC surface — verbatim AC1 phrasing + status-log section regex EOF bound; dvx104: 1 LOW finding on 211-LoC core — editorial "regression" → imperative contract phrasing). Total raw findings across the epic: **~80+**. The most load-bearing fixes were semantics issues, not lint: pinned headSha via `git rev-parse <branch>` not HEAD, exit-2-emits-decision-without-advice for transient gh outages, phase9Body extractor bound to `^(### |## )/m` not just `^### `.

---

## 2. What worked

### 2.1 Three different shapes of dogfood-mid-epic, all green

The pln retro flagged dogfood-mid-epic as a 3-epic candidate (mrg + prt + pln). dvx adds the **4th** epic with three distinct shapes simultaneously:

- **(a) consumer ships in epic + runs on next PR within epic.** dvx101's `claimSpec` was the first operation on every subsequent dvx story — dvx102 through dvx107 each opened with `devx devx-helper claim <hash>` returning `{branch, lockPath, claimSha}` JSON and rolling back atomically on any failure. Same shape as mrg E11 (mrg103 consumed mrg102's CLI).
- **(b) consumer ships in epic + runs on the SAME PR.** dvx105 PR #49: `await-remote-ci` gated its own PR's merge — `devx devx-helper await-remote-ci feat/dev-dvx105 --once` returned `{state:"completed",conclusion:"success"}` on first probe. dvx106 PR #50: `devx merge-gate dvx106` dispatched the very enrichment dvx106 ships (the `advice` array on `merge:false` decisions). Same shape as prt E9 (`devx pr-body` rendered prt102's own PR body).
- **(c) test-only lock with no production consumer.** dvx107 ships `parseHandoffSnippet()` — a validator that pins the skill body's Handoff Snippet template prose shape. No production code reads it; `test/devx-handoff-snippet.test.ts` asserts the template + the AC #4 suppression rule + every required heading + Phase 9 dispatch discipline. Sister to mrg103's `promoteIntegrationToDefault` (dead code locked by tests) but for prose-shape rather than code-shape.

Cross-epic count for the dogfood-mid-epic family: **4 epics (mrg + prt + pln + dvx)** with **rich shape variance**. **Promoted to Cross-epic patterns this PR** with the three-shape taxonomy explicit, so future epics know which shape applies.

### 2.2 Pure-fn + CLI-passthrough trio confirmed at 4 epics with 6 fresh instances

Already promoted to Cross-epic patterns at plnret (mrg + prt + pln = 3 epics). dvx adds **6 fresh instances** in one epic:

- `dvx101`: `claimSpec()` (pure-ish — has I/O for git+fs but the order-and-rollback logic is the deterministic core) + `devx devx-helper claim`.
- `dvx102`: `shouldCreateStory()` (pure decision over config + spec) + `devx devx-helper should-create-story`.
- `dvx104`: `coverageTouchedGate()` + `parseOptOutMarkers()` (pure mode dispatch + opt-out marker parser; mirrors `merge-gate.ts` no-I/O shape) — **library-only, no CLI passthrough yet**: the skill body's Phase 5 invokes the function via prose dispatch, since coverage shape varies enough by language runner that a CLI surface would require schema convergence first. Same lib+test split shape, just no CLI.
- `dvx105`: `probeRemoteCi()` + `awaitRemoteCi()` + `devx devx-helper await-remote-ci`.
- `dvx106`: `deriveMergeAdvice()` extension to `merge-gate.ts` (the existing CLI was already in place; dvx106 enriches its decision payload with the `advice` array). Variant: the pure-fn extension lives in the same `merge-gate.ts` file rather than a new module — appropriate when the new decision logic is a tighter extension of existing ground-truth, not a new domain.
- `dvx107`: `parseHandoffSnippet()` + `test/devx-handoff-snippet.test.ts` — **library-only, no CLI passthrough**: the validator is consumed by tests only, asserting the skill body's prose shape. Same split shape (pure validator + tests) without the CLI surface.

The cross-epic row at plnret captured the canonical (library + CLI + tests) shape; dvx exercises **two healthy variants**: (a) library + tests, no CLI yet (dvx104, dvx107 — appropriate when the consumer is the skill body's prose dispatch or test-only lock) and (b) extension to existing CLI (dvx106 — appropriate when the new logic is an enrichment of an existing decision surface). Pattern holds; variants noted under "When to skip the CLI surface" guidance below.

### 2.3 Externalize behavior-as-CLI-primitive — 4 epics confirmed

Already promoted at plnret (mrg + prt + pln). dvx adds **4 fresh externalizations**:

- `dvx101` claim → `devx devx-helper claim` (replaces inlined git+fs sequence in skill body).
- `dvx102` should-create-story → `devx devx-helper should-create-story` (replaces inlined inference in skill body Phase 2).
- `dvx105` await-remote-ci → `devx devx-helper await-remote-ci` (replaces inlined `gh run list` polling state machine in skill body Phase 7).
- `dvx106` advice routing — REMOVES the per-mode "Behavior by mode" table from skill body Phase 8 entirely. The pure decision lives in `mergeGateFor()`; the CLI emits the decision; the skill body dispatches on `advice` keywords (exact-string match).

The skill body's Phase 1, 2, 5, 7, and 8 sections are now CLI-driven prose: "invoke the right CLI, parse JSON, react to the exit code + payload." Eliminates the regression class "skill body says X, code says Y" at every phase except Phase 3 (implementation, which is necessarily LLM-driven) and Phase 6 (commit, which is git-prose). The structural elimination is the pln103 `validate-emit` pattern applied to the dev surface.

### 2.4 3-agent parallel adversarial review caught load-bearing semantics on every substantial-surface story

Already promoted at plnret (prt + pln = 2 epics, 5 internal observations). dvx adds **3 fresh confirmations** + **2 single-pass below-threshold confirmations** + **1 environmental-fallback (2-agent) story**:

- **3-agent (substantial surface):** dvx101 (11 actionable: HIGH-fixes incl. push-target/worktree-base split for split-branch + rename-rollback generalized to N artifacts + openExclusive partial-write unlinks before rethrow + Status:ready lookahead replaces `\b`); dvx105 (~18 across 2 passes: pinned headSha at `awaitRemoteCi` start via `git rev-parse <branch>` not HEAD — fix-forward pushes during polling don't silently mis-classify the run as workflow-no-run; coerceGhRun strictness; maxPolls/pollMs/emptyRetryMs production-safety guards); dvx106 (~40 raw: exit-2-emits-decision-without-advice — transient gh outages don't trigger premature MANUAL.md row; cancelled/action_required → MANUAL not WAIT; filter-fallthrough preserves explicit gate advice).
- **Single-pass (below 290-LoC threshold):** dvx103 (2 findings — HIGH: AC1 verbatim phrasing wasn't preserved; MED: status-log section regex bounded incorrectly); dvx104 (1 LOW — editorial-vs-imperative phrasing for the dynamic integration-branch resolution bullet).
- **2-agent fallback:** dvx107 (Acceptance Auditor + Blind Hunter; bmad-edge-case-hunter agent unavailable in environment — degraded gracefully, surfaced 1 MED + 6 LOW; the MED was load-bearing — phase9Body extractor bounded only on `^### `, would have let the regex slice spill into Handoff Snippet / Finalization / Key References / Pairs. Bound to `^(### |## )/m` instead. Recorded under "What didn't" §3.2 as an environmental observation worth tracking.).

The orthogonal framings continue to catch what single-pass would miss; the threshold heuristic from prt E3 / pln E5 holds on dvx103 + dvx104 (single-pass found everything load-bearing on those surfaces). Cross-epic count: **3 epics with rich coverage (prt + pln + dvx)** — matches the section's nominal ≥3-epic threshold and confirms the "promote at 2 epics with rich internal coverage" precedent from iniret. Already promoted at plnret; **reinforced with 3rd-epic confirmation this PR.**

### 2.5 `feedback_gh_pr_merge_in_worktree.md` empirically confirmed twice in dvx

The auto-memory note has been load-bearing since cli301; dvx confirms it twice with explicit verbatim text:

- **dvx106 PR #50:** "Merge command exited non-zero from worktree (`fatal: 'main' is already used by worktree`) — exactly the regression class `feedback_gh_pr_merge_in_worktree.md` tracks; verify via `gh pr view 50 --json state,mergeCommit` returned `{"state":"MERGED","mergeCommit":{"oid":"838240980fe9ccdf2ea1247a133df818ead621af"}}` — authoritative per dvx106 contract."
- **dvx107 PR #51:** "Merge command exited non-zero from worktree (`fatal: 'main' is already used by worktree`) — same regression class `feedback_gh_pr_merge_in_worktree.md` tracks; verify via `gh pr view 51 --json state,mergeCommit` returned `{"state":"MERGED","mergeCommit":{"oid":"c1d1699b3c97b09b74bd7416559222b43b956f73"}}`"

dvx106 specifically pins this in skill body Phase 8: "**`gh pr merge` invoked from inside a worktree commonly exits non-zero while the remote merge actually succeeds** — never trust the gh exit code alone. The verify is authoritative." The structural pin is tested via `test/devx-skill-phase8-discipline.test.ts`. The auto-memory note now has skill-body + test backing — it can't regress silently.

### 2.6 Status-log discipline: dvx is a clean 7/7 positive counterexample

plnret promoted "Status-log terseness pattern" to Cross-epic patterns at 3/3 confirming epics (sup + ini + pln) with mrg (0/3 omit) + prt (0/2 omit) as positive counterexamples. dvx is **0/7 omit** — every story enumerates per-phase milestones, self-review finding counts, dogfood references, fix-forward outcomes, and merge SHAs. dvx101's status log specifically calls out "3 HIGH, 5 MED, 3 LOW; ALL fixed in-place" with the most load-bearing fixes named — exactly the shape MP1.1 is asking for from `/devx` going forward.

The variance across epics now reads as **run-style polarized**: mrg + prt + dvx (0% omit) vs sup + ini + pln (mixed). MP1.1 (the skill prompt-card edit requiring per-phase + finding-count enumeration) remains the corrective; dvx's 7/7 confirms the rich shape is achievable in practice without the prompt-card change — but the prompt-card change is what prevents future regression. **MP1.1 stays open, reaffirmed at dvxret.**

### 2.7 v0 → v1 skill body refinement: every additive PR, no breaking change to v0 contract

epic-devx-skill explicitly stated "v0 keeps working through the refinement — every story is an additive PR." Confirmed: dvx101–dvx107 all merged additively. The skill body went from 12-step inlined-prose v0 → CLI-driven 9-phase v1 in 7 PRs without ever leaving the user with a half-broken `/devx`. Each PR exercised the new primitive on the very next claim (or itself, in dvx105/dvx106's same-PR-dogfood case). No forced cutover; no big-bang refactor.

The pattern is **CLAUDE.md "Working agreements"-grade** for any future skill-body refinement epic: ship the helper first, dogfood it on the next PR (or same PR), refine the prose to invoke it, never break v0 in the same PR that introduces the v1 primitive.

### 2.8 Test-only-lock pattern (dvx107) for skill-body prose

dvx107's `parseHandoffSnippet()` + `test/devx-handoff-snippet.test.ts` pin the skill body's Handoff Snippet template **without any production consumer**. The validator only runs from tests, asserting the canonical template shape (5 required sections + final continue line + AC #4 suppression rule + Phase 9 dispatch discipline) cannot drift silently in `.claude/commands/devx.md`. Same conceptual shape as mrg103's dead-code-with-tests (`promoteIntegrationToDefault`) — but for prose rather than code.

When this is the right shape: the artifact under review is prose in a load-bearing prompt file; the consumer is the LLM running the skill, not a TypeScript caller; structural verification is needed because prose drift is silent and high-blast. The test-fixture cost (~150 LoC validator + 18 tests) is justified when the prose is consumed by every `/devx` run that stops early.

Single-epic at promotion (1 internal observation in dvx); pending-concordance. Revisit when a second skill-body prose section needs equivalent locking — likely candidates: skill body's Phase 1 claim-line shape; skill body's Phase 8 advice routing dispatch table; skill body's Phase 7 PR body fallback template.

### 2.9 The canary-gated skill change pattern (dvx102) shipped working

dvx102's `_internal.skip_create_story_canary` ships **off** by default (per epic-devx-skill plan: "ships off-by-default; flips to default-on after one in-flight story green-runs the new path"). The canary state is honored by the skill body's Phase 2 dispatch but defaults to "v0 behavior preserved" — `bmad-create-story` is invoked when no story file present, regardless of the helper's decision. Empirically, every dvx story (and this retro) records the helper's decision in the status log per dvx102 AC #5, but the skill author's judgement matches the empirical "skip" pattern from prior 36/36 stories.

Why this matters: dvx102 closes the LEARN.md cross-epic row's *contract* (the helper exists; the canary path is testable and documented) without forcing a behavior change on the in-flight backlog. The behavior change is gated on `/devx-learn` Phase 5+ flipping the canary to "active" after one green-run. This is the **canary-vs-flag-day** pattern from epic-devx-skill design principles, applied verbatim — and it works. The skill change blast-radius is bounded; the ground-truth structurally exists; the policy-level flip remains user-review-required per `self_healing.user_review_required_for: [skills]`.

### 2.10 dvx107's `stop_after` schema + Handoff Snippet pin

The handoff contract — what to emit when stopping early — has been informal across every prior `/devx` run. dvx107 codifies it: 4-value enum for `stop_after`, the Handoff Snippet template literal, and the AC #4 suppression rule (no snippet on full-run completion). The validator is test-only because the consumer is a future agent reading the snippet from chat history, not a TypeScript caller — but the test asserts every section the next agent would grep for exists.

This is the first formalization of `/devx`'s **session-boundary contract**. It pairs with dvx105's three-state remote-CI probe (which provides a structural "we genuinely don't have CI to wait for" terminal) to make `/devx` runs cleanly resumable across `/clear` boundaries.

---

## 3. What didn't (and how we'll respond)

### 3.1 Plnret's MP0.1 (stale `sprint-status.yaml` rows) is still open

aud101 + aud102 + aud103 + sup405 still carry `status: backlog` in `_bmad-output/implementation-artifacts/sprint-status.yaml` despite their PRs (PR #1, #2, #3, #17) having merged in Phase 0. cfgret filed this as MP0.1; cliret + supret + iniret applied in-scope same-epic flips for their own retro PRs but didn't backfill the cross-epic stragglers.

The dvxret retro PR cannot fix MP0.1 either — these are cross-epic chores, not in-scope for epic-devx-skill. Would be **silent scope expansion** to do so. The corrective remains: file a `chore:` debug spec or wait for Phase 2 ManageAgent's reconciler to flip them on first tick. No action this PR.

### 3.2 dvx107 ran with degraded reviewer pool (Edge Case Hunter unavailable)

dvx107's status log: "the bmad edge-case-hunter agent type was unavailable in this environment". The pass fell back to 2-agent (Acceptance Auditor + Blind Hunter) and surfaced 1 MED + 1 LOW-cosmetic + 5 LOW-defensive — including the load-bearing phase9Body extractor bound. Fewer reviewers, but the load-bearing case was caught.

Risk: future stories may hit the same environmental limit silently and not call it out. The corrective is twofold: (a) skill body Phase 4 should record reviewer-pool composition explicitly (which agents ran, which didn't, why) — currently the status-log discipline (MP1.1) covers finding counts but not reviewer identity; (b) `bmad-code-review` skill itself should surface a structured "reviewers attempted vs reviewers run" report so the call-site can record it.

Single-epic observation; not promoting yet. **Pending-concordance: 1 epic; revisit when a 2nd story hits the same environmental degradation.** If it recurs, file as a `MANUAL.md` row asking for a skill-prompt-card line in `/devx` Phase 4.

### 3.3 `bmad-create-story` skip cumulative count bumped to 43/43 across 9 epics

Phase 0 25/25 + mrg 3/3 + prt 2/2 + pln 6/6 + dvx 7/7 = **43/43 parent stories across 9 shipped + retroed epics**. dvx102 STRUCTURALLY closed the LEARN.md cross-epic row's contract by shipping the helper + canary flag, but the canary ships off (v0 behavior preserved) — so the empirical pattern continues. Verified at retro start: only the 8 retro `epic-*-retro-*.md` files + this one + sprint-status.yaml exist in `_bmad-output/implementation-artifacts/`; no parent-story `story-<hash>.md` file has ever been produced.

The next behavior shift requires either (a) the user manually flipping `_internal.skip_create_story_canary` to `"active"` on one in-flight story to validate the conditional path, or (b) `/devx-learn` Phase 5+ proposing the flip via a memory entry the user reviews. Both paths remain user-review-required per `self_healing.user_review_required_for: [skills]`. **CLAUDE.md "How /devx runs" Phase 2 inline note bumped to 43/43 cumulative count this PR.**

### 3.4 dvxret itself needed manual sprint-status backfill (legacy-emitted retro)

dvxret was emitted by `/devx-plan` on 2026-04-28 — **before** pln102's `emitRetroStory()` shipped (merged 2026-05-03). So dvxret's sprint-status row was already in `sprint-status.yaml` with `status: backlog`. This PR flips it to `status: done` and marks `epic-devx-skill` itself `status: done` — the standard retro-PR mechanical backfill.

**AC #7 — re-evaluate the retro-row-backfill pattern post-pln102.** Verdict: **pln102's `emitRetroStory()` machinery DOES eliminate manual backfill** for retros emitted by `/devx-plan` after pln102 merged. dvxret + mgrret were both pre-emitted (2026-04-28), so they require standard mechanical backfill. dvxret is the **second-to-last** retro requiring manual backfill (mgrret will be the last unless the planner re-emits it post-merge). Future retro stories planned via `/devx-plan` after pln102 have the row co-emitted automatically. **The structural fix is in place; the legacy-emitted backlog still needs the manual backfill (one more retro to go).** No new MANUAL.md row required; the corrective shipped at pln102.

### 3.5 dvx101 status log records "claim sha pushed to origin/main" but the claim went through manually

dvx101 IS `claimSpec` — the very helper it ships. The story's status log notes "manual claim — this story IS claimSpec" because the helper didn't yet exist when dvx101 was claimed. From dvx102 onward, every `/devx` claim went through `devx devx-helper claim <hash>` and recorded the JSON output in the status log.

Sister observation to mrg E3 (consumer ships in epic + runs on next PR — strongest mid-epic dogfood). dvx101's bootstrap exception is structurally identical: the very PR that ships the consumer can't *itself* use the consumer (chicken-and-egg). Recorded; same pattern will recur in any "ship the helper" epic going forward (`epic-devx-manage-minimal` will have it for the manager scaffold).

### 3.6 Claim helper's "phase 2" status-log line precedes the actual Phase 2 work

dvx101's claim helper appends a status-log line with ISO timestamp. dvx102's `should-create-story` helper also appends one. The two lines are written by **separate CLIs at separate moments** — there's no atomic coupling between "claim succeeded" and "Phase 2 began." If a `/devx` run claims a hash but crashes before invoking `should-create-story`, the spec carries the claim line but no Phase 2 line.

Currently harmless because crash-recovery is Phase 2+ ManageAgent territory; the lock file (`.devx-cache/locks/spec-<hash>.lock`) is the actual reentrancy guard, and the Phase 2 status line is incidental to the lock. But when ManageAgent ships, "claimed but Phase 2 never started" needs to be a recoverable state. Recorded; revisit at mgrret.

### 3.7 `bmad-retrospective` is still not formally wired (every retro carries the same gap)

Same gap as every prior retro: the formal `bmad-retrospective` skill from `_bmad/bmm/workflows/4-implementation/retrospective/` exists in the BMAD library but isn't invoked as a skill from `dvxret` (or any prior `*ret`). The interim discipline (this LEARN.md + per-epic `*ret` story + this BMAD-shaped retro file) continues to substitute. Phase 5 `epic-retro-agent` will close this. Recorded only.

---

## 4. Findings (tagged for `LEARN.md`)

Twelve findings appended to `LEARN.md § epic-devx-skill`. Reinforcement of three already-promoted Cross-epic patterns (pure-fn+CLI trio at 4 epics; externalize-as-CLI-primitive at 4 epics; 3-agent parallel review at 3 epics with rich coverage). One new Cross-epic-patterns row promoted: **Dogfood-mid-epic with three-shape taxonomy** (consumer-ships-runs-on-next-PR-in-epic + consumer-ships-runs-on-SAME-PR + test-only-lock-no-consumer). One reinforcement of `feedback_gh_pr_merge_in_worktree.md` (now structurally pinned by skill body + tests). Zero new MANUAL.md rows.

---

## 5. Phase 1 progress + closure note

After this PR merges, Phase 1 has **4/5 epics shipped + retroed** (mrg + prt + pln + dvx). 1 remaining: epic-devx-manage-minimal (was blocked-by dvxret; now unblocked — mgr101 onward becomes claimable).

Phase 1's first 4 epics combined: **+600 net tests** (mrg ~92 + prt ~46 + pln ~207 + dvx ~255). epic-devx-manage-minimal (7 stories) remains — Phase 1 will close at 5 epics + ~28 parent stories + ~5 retros.

CLAUDE.md "Status: Phase 1" block updated this PR to reflect 4/5 epics shipped.
