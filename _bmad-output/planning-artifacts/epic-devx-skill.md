<!-- refined: party-mode 2026-04-28 (inline critique; thoroughness=balanced; lenses: PM/Dev/Architect/Infra/Murat — UX skipped) -->

# Epic — `/devx` skill (canonical DevAgent)

**Plan:** `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`
**Slug:** `epic-devx-skill`
**Order:** 4 of 5 (Phase 1 — Single-agent core loop) — depends on epic-merge-gate-modes + epic-pr-template
**User sees:** "When I run `/devx <hash>` (or `/devx next`), the nine-phase loop runs end-to-end: claim (with claim-commit pushed before PR open) → worktree → conditional bmad-create-story → bmad-dev-story → adversarial self-review → mode-gated local CI → commit → push + PR with template-rendered body → wait remote CI if configured → mode-gated auto-merge via the unified primitive → cleanup. Zero hand-fixes between claim and merge. Across the next dozen items I claim, the LEARN.md cross-epic regressions don't return."

## Overview

The current `.claude/commands/devx.md` is the v0 bootstrap that has shipped 25/25 Phase 0 stories. Empirically it works — but every single story required at least one cross-epic-pattern hand-fix. This epic refines `/devx` in place to enforce the LEARN.md `[high]` invariants structurally: claim-commit-push-before-PR (closes `feedback_devx_push_claim_before_pr.md`); conditional `bmad-create-story` with canary (closes the 25/25 silent-skip pattern); adversarial self-review structurally non-skippable (already prose-enforced; this epic adds a status-log assertion); mode-derived merge gate via the unified primitive from epic-merge-gate-modes (consumes mrg102's `devx merge-gate <hash>`); PR body templated via prt102 (consumes the substituted template). v0 keeps working through the refinement — every story is an additive PR.

## Goal

Make `/devx` the canonical DevAgent that the 5 LEARN.md `[high]` cross-epic patterns can't regress against. Every Phase 1 invariant is enforceable via either a status-log assertion, a unit test on a helper, or an integration test that runs `/devx` against a fixture spec.

## End-user flow

1. Leonid runs `/devx <hash>` (or `/devx next`). The skill:
2. **Phase 1 — Claim.** Resolves item; flips DEV.md `[ ]`→`[/]`; spec frontmatter `status: in-progress`; status log line; **commits the claim + pushes to remote integration branch BEFORE opening the PR** (eliminates main-divergence post-merge); creates worktree `.worktrees/dev-<hash>` on derived branch (`deriveBranch()` from pln101 — same primitive); enters worktree; acquires `.devx-cache/locks/spec-<hash>.lock` (O_EXCL atomic create) to prevent accidental double-claim by a parallel `/devx` invocation.
3. **Phase 2 — BMAD story (conditional).** Reads `devx.config.yaml → project.shape`; reads spec ACs. If `shape == 'empty-dream'` AND no story file exists AND spec ACs ≥ 3 actionable items → skip with status-log line `phase 2: skipped bmad-create-story (project_shape=empty-dream + N ACs)`. Otherwise invoke `bmad-create-story`. The conditional is canary-gated: until the canary clears (one in-flight story successfully runs the new conditional path), the default falls back to "always invoke" with the conditional path enabled only when `devx.config.yaml → _internal.skip_create_story_canary == "active"`.
4. **Phase 3 — Implement.** `bmad-dev-story`; red-green-refactor; all tasks/subtasks; story File List updated; status log line.
5. **Phase 4 — Self-review (adversarial, non-skippable).** `bmad-code-review`. Find 3–10 issues minimum (zero = failed; re-run stricter). Fix ALL HIGH/MED/LOW automatically. Re-review. **Status log line is appended whether or not issues were found** (the empty case writes "phase 4: clean review (0 issues; re-ran with stricter framing — confirmed clean)" — no status-log silence allowed).
6. **Phase 5 — Local CI** per `devx.config.yaml → projects:` for the touched surface. Mode-derived coverage gate: YOLO informational; BETA warn <80%; PROD block <100% line-of-touched-surface; LOCKDOWN block.
7. **Phase 6 — Commit.** One commit per story / sub-task; conventional-commit prefix; spec + story link in message. `git add <specific-files>`; never `git add -A`.
8. **Phase 7 — Push, PR, remote CI.** Push branch. Read `.github/pull_request_template.md` (or built-in fallback); substitute mode + spec path + AC checklist; emit body via `gh pr create --body`. Detect remote CI per `.github/workflows/` presence: no workflow → local gates authoritative; workflow + no run → INTERVIEW + stop; workflow + run → poll via `ScheduleWakeup` 120s.
9. **Phase 8 — Auto-merge.** Invokes `devx merge-gate <hash>` (from mrg102). On `merge: true` → `gh pr merge --squash --delete-branch`. On `merge: false` → reads `advice` and acts (file INTERVIEW for trust-gradient block; wait for CI; stop and leave PR open under LOCKDOWN). After merge: `git fetch --prune && git pull --ff-only` on main; remove worktree; release lock; delete local branch; bookkeeping commit on `main` with DEV.md `[/]`→`[x]`, sprint-status story → `done`, spec frontmatter `status: done`, PR URL appended; push.
10. **Phase 9 — Loop or finalize.** Honors `stop_after`; emits the Handoff Snippet on early stop with unpushed-commits + active-worktrees + gotchas captured.

## Backend changes

The skill body lives in `.claude/commands/devx.md` (load-bearing prompt). Most refinement is text edits to that file; the load-bearing logic that needs determinism is extracted into TypeScript helpers under `src/lib/devx/` so it's testable without an LLM run. The skill body invokes helpers via `devx devx-helper ...` CLI passthrough.

- **New** `src/lib/devx/claim.ts` — `function claimSpec(hash, opts: {sessionId}): Promise<{branch, lockPath, claimSha}>`. Atomic operation: flip DEV.md checkbox + frontmatter status + status-log line + commit on `main` + push to `origin/main` + acquire lock + return derived branch name. Rolls back all on any single failure.
- **New** `src/lib/devx/should-create-story.ts` — `function shouldCreateStory(config, spec): {invoke: boolean; reason: string}`. Pure function consumed by Phase 2.
- **New** `src/lib/devx/render-pr-body.ts` — `function renderPrBody(template, mode, specPath, spec): string`. Pure function; consumed by Phase 7.
- **New** `src/lib/devx/await-remote-ci.ts` — `function awaitRemoteCi(branch): Promise<{state: 'no-workflow' | 'workflow-no-run' | 'completed'; conclusion?: 'success' | 'failure' | ...}>`. Wraps the `gh run list` probe. Three-state probe matches the skill body's existing decision tree.
- **New** `src/commands/devx-helper.ts` — CLI passthrough for the above. Subcommands: `claim <hash>`, `should-create-story <hash>`, `render-pr-body <hash>`, `await-remote-ci <branch>`. Each prints JSON to stdout + exit-code-encoded result.
- **Modified** `.claude/commands/devx.md` — Phases 1, 2, 4, 7, 8 explicitly invoke the helpers above (or, where the LLM reasoning is required, the helpers' decisions feed into the skill-body's prose). Phase 4's status-log assertion is structurally explicit ("a status-log line MUST be appended whether or not issues were found"). Phase 8 invokes `devx merge-gate <hash>` (mrg102) instead of inlining mode logic — the "Behavior by mode" table moves to merge-gate.ts only.
- **Modified** `src/lib/help.ts` — annotate `devx-helper` as Phase 1 internal helper command.

## Infrastructure changes

- The canary path adds `_internal:` section to `_devx/config-schema.json` (epic-config-schema). New key: `_internal.skip_create_story_canary: "off" | "active" | "default"`. Default value `"off"` after dvx102 ships; flips to `"default"` after the canary story green-runs. (Schema additions follow the cfg201 idempotent-extension pattern.)

## Design principles (from research)

- **Helpers carry the logic; skill body carries the prose.** Same pattern as epic-devx-plan-skill: testable TS for the deterministic bits; LLM-readable prose for the orchestration.
- **Status log is the gate, not the comment block.** Phase 4's "fix all findings" rule is enforced via `validate-emit`-style status-log assertion: if a `/devx` run completes Phase 4 without a status-log entry, that's a violation. (Closes the LEARN.md `[high] [code]` self-review-skipped class structurally.)
- **Canary > flag-day flip.** The conditional `bmad-create-story` skip is too high-blast for a default flip without a known-good signal (LEARN.md tags it `[high] [skill]` with `self_healing.user_review_required_for: [skills]`). Ship the conditional path off-by-default; flip to default-on after one in-flight story green-runs the new path.
- **Claim-push-before-PR is the new floor.** Every Phase 0 story experienced the same "claim commit unpushed → main diverges → pull --ff-only fails post-merge" cycle. Closing it requires `git push origin main` BEFORE `gh pr create`. The `claim.ts` helper makes the order non-skippable.
- **Lock file under `.devx-cache/locks/spec-<hash>.lock`.** Phase 1 ships a minimal lock (O_EXCL create + auto-release on worker exit). Full lock-coordination is Phase 3, but the file format is fixed in Phase 1 so Phase 3 doesn't need a migration.
- **PR-body fallback is in the skill body, not the template.** If `.github/pull_request_template.md` is absent (a project that hasn't run `/devx-init` upgrade since prt101), the skill body has a hardcoded default matching the canonical template. Never block PR open on missing template.
- **Three-state remote-CI probe is explicit.** The decision tree (no workflow / workflow + no run / runs returned) is in `await-remote-ci.ts`, not relied on prose-only.

## File structure

```
src/
├── lib/
│   └── devx/
│       ├── claim.ts                        ← new: claimSpec(hash, opts)
│       ├── should-create-story.ts          ← new: shouldCreateStory(config, spec)
│       ├── render-pr-body.ts               ← new: renderPrBody(template, mode, ...)
│       └── await-remote-ci.ts              ← new: awaitRemoteCi(branch)
├── commands/
│   └── devx-helper.ts                      ← new: devx devx-helper {claim|should-create-story|render-pr-body|await-remote-ci}
└── lib/help.ts                             ← modified: register devx-helper

test/
├── devx-claim.test.ts                      ← new: atomic claim + push order + rollback
├── devx-should-create-story.test.ts        ← new: 6 fixtures (shape × spec-AC-count × story-file-exists)
├── devx-render-pr-body.test.ts             ← new: golden template + config + spec → expected body
├── devx-await-remote-ci.test.ts            ← new: 3 probe states with mocked gh
├── devx-status-log-discipline.test.ts      ← new: every emitted PR's spec status log has Phase 4 entry
├── devx-canary.test.ts                     ← new: canary flag transitions (off → active → default)
└── devx-handoff-snippet.test.ts            ← new: snippet captures unpushed commits + worktrees + gotchas

.claude/commands/
└── devx.md                                 ← modified: Phases 1/2/4/7/8 wire to helpers
```

## Story list with ACs

### dvx101 — Atomic claim + push-before-PR + spec lock
- [ ] `src/lib/devx/claim.ts` exports `claimSpec(hash, opts)` returning `{branch, lockPath, claimSha}`.
- [ ] Operation order is fixed and atomic-or-roll-back: (1) acquire `.devx-cache/locks/spec-<hash>.lock` (O_EXCL); (2) flip DEV.md `[ ]`→`[/]`; (3) update spec frontmatter `status: in-progress`, `owner: /devx-<sessionId>`, append status-log line; (4) commit on `main` with message `chore: claim <hash> for /devx`; (5) `git push origin main`; (6) `git worktree add .worktrees/dev-<hash> -b <derived-branch> main`. Failure at any step rolls back prior steps + releases lock.
- [ ] `devx devx-helper claim <hash>` CLI subcommand exposes the operation; prints JSON `{branch, lockPath, claimSha}` to stdout; exit 0 on success / exit 1 on lock-already-held / exit 2 on rollback.
- [ ] **Closes** `feedback_devx_push_claim_before_pr.md`: regression test asserts the claim commit is pushed to `origin/main` before any subsequent PR-creating gh call.
- [ ] **Closes** the silent-skip case for the spec lock by ensuring the lock is acquired before any state mutation.
- [ ] `.claude/commands/devx.md` Phase 1 section explicitly invokes `devx devx-helper claim <hash>` as the first operation.

### dvx102 — Conditional `bmad-create-story` with canary flag
- [ ] `src/lib/devx/should-create-story.ts` exports `shouldCreateStory(config, spec): {invoke, reason}`. Returns `{invoke: false, reason: "project_shape=empty-dream + N ACs + no story file"}` when shape is `empty-dream` AND spec ACs ≥ 3 actionable items AND no story file exists; otherwise `{invoke: true, reason: <one of: "shape-not-empty-dream" | "story-file-exists" | "few-actionable-acs">}`.
- [ ] Canary flag at `devx.config.yaml → _internal.skip_create_story_canary`. Defaults to `"off"` after this story ships (skill always invokes `bmad-create-story` regardless of `shouldCreateStory()` decision); the canary-active state (`"active"`) honors the helper's decision; the post-canary state (`"default"`) is set by the next /devx run that proves the conditional path green.
- [ ] `.claude/commands/devx.md` Phase 2 reads the canary flag + `shouldCreateStory()` decision; routes accordingly. Status-log line records both the canary state and the decision (`phase 2: canary=active, shouldCreateStory=skip(empty-dream+5acs) → bmad-create-story SKIPPED`).
- [ ] Tests cover all 3×6 combinations (canary state × shouldCreateStory inputs).
- [ ] `_devx/config-schema.json` extended with the `_internal` section (epic-config-schema's idempotent-extension contract).
- [ ] **Closes** the LEARN.md `[high] [skill]` 25/25-skipped pattern with a documented, tested, canary-gated path.

### dvx103 — Phase 4 self-review status-log assertion
- [ ] `.claude/commands/devx.md` Phase 4 explicitly mandates: "A status-log line MUST be appended after Phase 4 completes, regardless of issue count. Zero issues writes 'phase 4: clean review (0 issues; re-ran with stricter framing — confirmed clean)'."
- [ ] `test/devx-status-log-discipline.test.ts` asserts: for every shipped Phase 0 spec under `dev/`, a Phase 4 status-log line exists OR the spec is a retro story (`*ret`). Failures list specific spec paths.
- [ ] (Forward-looking) After dvx103 ships, every new `/devx` PR's spec must have a Phase 4 line OR the story is exempt (retro stories or pre-Phase-1 specs are exempt with documented exception).
- [ ] **Reaffirms** the LEARN.md `[high] [code]` self-review pattern with a testable assertion.

### dvx104 — Mode-derived coverage gate (Phase 5)
- [ ] `.claude/commands/devx.md` Phase 5 explicitly dispatches by mode: `YOLO → informational only; BETA → warn if touched-surface coverage < 80%; PROD → block if < 100%; LOCKDOWN → block if < 100% OR no browser-QA pass logged`.
- [ ] Touched-surface computed from `git diff --name-only <integration-branch>..HEAD`; coverage filtered to those files.
- [ ] `# devx:no-coverage <reason>` line-level opt-out parsed from source files; opted-out lines excluded from the denominator.
- [ ] Tests cover all 4 modes × covered/uncovered touched lines × opt-out marker.
- [ ] Coverage source: `coverage:` runner output per `devx.config.yaml → projects[*].coverage`. Schema unchanged; behavior wired.

### dvx105 — Three-state remote-CI probe
- [ ] `src/lib/devx/await-remote-ci.ts` exports `awaitRemoteCi(branch)` returning one of: `{state: 'no-workflow'}` (`.github/workflows/` missing or empty); `{state: 'workflow-no-run'}` (workflows present but `gh run list` returns nothing for the branch within 60s + one ScheduleWakeup retry); `{state: 'completed', conclusion: 'success' | 'failure' | 'cancelled' | ...}`.
- [ ] Polling implemented via `ScheduleWakeup` 120s delay (cache-warm window per the harness rules).
- [ ] `headSha` verified against `git rev-parse HEAD` — mismatch returns `{state: 'workflow-no-run'}` (a stale run on a prior commit isn't ground truth).
- [ ] `.claude/commands/devx.md` Phase 7 invokes the helper; on `'workflow-no-run'`, files INTERVIEW.md entry + marks PR `awaiting-approval` + stops (matches existing skill body behavior, but now structurally enforced).
- [ ] Tests cover all 3 states with mocked `gh run list` outputs.

### dvx106 — Phase 8 auto-merge wired through `devx merge-gate`
- [ ] `.claude/commands/devx.md` Phase 8 invokes `devx merge-gate <hash>` (from mrg102). The "Behavior by mode" table is REMOVED from the skill body — it now lives in `merge-gate.ts` only (single source of truth).
- [ ] On `merge: true`: executes `gh pr merge <#> --squash --delete-branch`; verifies via `gh pr view <#> --json state,mergeCommit`; on remote-merge-success-but-local-exit-nonzero (per `feedback_gh_pr_merge_in_worktree.md`), reads via gh and proceeds.
- [ ] On `merge: false`: parses `advice` array; matches `"file INTERVIEW for approval"` → files INTERVIEW.md entry; matches `"wait for CI"` → re-enters Phase 7 polling; matches `"manual merge required"` → stops with status-log + MANUAL.md entry.
- [ ] After merge: bookkeeping commit on `main` (DEV.md `[/]`→`[x]`; spec status: done; sprint-status story → done; PR URL appended) is one commit pushed to `origin/main`.
- [ ] Tests cover each mode's gate decision flowing through to `/devx`'s merge command.
- [ ] **Reaffirms** `feedback_yolo_auto_merge.md` and `feedback_gh_pr_merge_in_worktree.md` memos with a testable assertion.

### dvx107 — `stop_after` handling + Handoff Snippet on early stop
- [ ] `.claude/commands/devx.md` parses `stop_after: this-item | n-items | until-blocked | all` and loops back to Phase 1 for the next ready item under `n-items` / `all`.
- [ ] On early stop (context budget, quality risk, blocker, mode change, user halt), emits the **Handoff Snippet** in a fenced ```text``` block. Snippet content follows the format in the existing skill body.
- [ ] Snippet asserts: every unpushed commit captured under "State to trust"; every active worktree captured; every "Already done" item lists its merged-or-pending PR; "Gotchas" includes any concrete fact discovered this session.
- [ ] `test/devx-handoff-snippet.test.ts` asserts snippet shape against a fixture session.
- [ ] On full-run completion (all targeted items merged), the snippet is suppressed (skill explicit).

### dvxret — Retro: bmad-retrospective on epic-devx-skill
- [ ] Run `bmad-retrospective` against the 7 shipped stories (dvx101–dvx107); append findings to `LEARN.md § epic-devx-skill`.
- [ ] Each finding tagged `[confidence]` + `[blast-radius]`.
- [ ] Cross-epic patterns hitting ≥3 retros total promoted into `LEARN.md § Cross-epic patterns`.
- [ ] After 5 retros across Phase 0 epics + this one (Phase 1's first), revisit the LEARN.md cross-epic pattern about retros — has the new helper-emit machinery (pln102) eliminated the row-backfill manual work for Phase 1+? Capture the answer.
- [ ] Sprint-status row for `dvxret` present + `LEARN.md § epic-devx-skill` section exists.

## Dependencies

- **Blocked-by:** `epic-merge-gate-modes` (mrg102 ships the `devx merge-gate` CLI passthrough that dvx106 consumes); `epic-pr-template` (prt102 ships the template substitution behavior that dvx105 falls back to / consumes).
- **Blocks:** `epic-devx-manage-minimal` (mgr spawns `claude /devx <hash>` — the `/devx` skill needs to be Phase-1-stable before Manager spawns it for real).

## Open questions for the user

None. Q2 (canary path for bmad-create-story) is resolved — ships off-by-default + canary-gated. The skill-prompt edits to `.claude/commands/devx.md` ARE the user-review-required edits per `self_healing.user_review_required_for: [skills]`; they land via the user merging this epic's PRs.

## Layer-by-layer gap check

- **Backend:** All 7 stories. Helpers + skill body. ✓
- **Infrastructure:** None directly — but Phase 5 reads CI workflow presence, Phase 7 calls `gh`, Phase 8 invokes `gh pr merge`. All pre-existing `gh` calls; no new infra. ✓ explicit.
- **Frontend:** None — no UI. ✓

## Party-mode refined (2026-04-28, inline)

Lenses applied: PM, Dev (backend), Architect, Infra, Murat (QA). UX skipped.

### Findings + decisions

**PM (end-user value).** End-user value: "the 5 LEARN.md cross-epic patterns from Phase 0 don't regress." Concern: dvx103's status-log assertion catches *new* PRs but doesn't enforce the rule for partial Phase 1 PRs (some stories will land before dvx103 itself). **Locked decision:** dvx103 AC bumped — assertion runs in CI for forward-looking specs only; pre-dvx103 specs are enumerated as documented exceptions in a `dev/_phase1-exemptions.txt` file checked in alongside dvx103. Each exemption has a one-line reason; future Phase 1 specs cannot land without a Phase 4 status-log line.

**Dev (backend framing).** Two sharp questions:
- *dvx101's atomic claim with rollback — what if `git push` fails mid-rollback?* If rollback's revert-commit also fails to push, we have an inconsistent state (DEV.md flipped locally; nothing on remote). **Locked decision:** dvx101 AC bumped — rollback path: (a) reset local DEV.md to the pre-claim state via `git reset HEAD~1` if the claim commit hasn't been pushed; (b) if pushed but worktree create failed, leave the claim and surface the error with the lock released — user sees "claim succeeded but worktree create failed" and can manually retry the worktree step. Don't try to revert pushed commits silently.
- *dvx102's canary state machine — who flips `"active"` → `"default"`?* The current spec leaves it manual ("user or `/devx-learn` Phase 5+"). For Phase 1, this is fine; Phase 5 will automate. **Locked decision:** unchanged.

**Architect.** Concern: dvx105's three-state probe + dvx106's merge-gate consumption together create a "decisions made via CLI subcommand" pattern that's invasive but valuable. The pattern leaks into `/devx-manage` (Phase 2+) and Concierge (Phase 2). **Locked decision:** the pattern is now a recommended-not-required architectural principle for /devx-* skills; will be documented in `docs/DESIGN.md` § "Skill-helper pattern" as part of Phase 2's first epic. Out of scope for Phase 1; flagged in the dvxret retro for cross-epic promotion to LEARN.md.

**Infra.** Concern: dvx107's Handoff Snippet captures unpushed commits + active worktrees. If the Handoff happens during a `/devx` run that mid-Phase-7 had pushed a feature branch but failed to open the PR, the snippet must list the pushed branch (so the next agent doesn't re-push). **Locked decision:** dvx107 AC bumped — "Already done" section explicitly captures branches pushed-but-no-PR-yet, separately from "branches with PR opened."

**Murat (QA / Test architect).** Risks:
- *dvx104 mode-derived coverage gate is mostly skill-body precision.* Hard to unit-test without LLM in loop. **Locked decision:** dvx104 AC bumped — extract the touched-surface coverage computation into `src/lib/devx/coverage-touched.ts` (helper function — TS, no LLM). Skill body invokes via `devx devx-helper coverage-touched <branch>`. Mode dispatch remains in skill body but the deterministic computation is testable.
- *dvx106 trust-gradient test fixture is synthetic.* Real project has `count: 0, initialN: 0`. **Locked decision:** dvx106 AC already covers this with synthetic `{count: 5, initialN: 10}`. Reaffirmed.
- *dvx101 lock + claim atomicity test surface.* Multiple processes claiming the same hash simultaneously is hard to test deterministically. **Locked decision:** dvx101 AC bumped — concurrency test uses a synthetic race: two `claimSpec()` invocations against the same hash; assert exactly one returns success and the other returns "lock held"; both are clean (no DEV.md inconsistency). Uses a sleep-spinning fixture, not real parallelism.

### Cross-epic locked decisions added to global list
10. **Skill-helper pattern (skill body invokes `devx <skill>-helper <op>` for deterministic logic).** Recommended for /devx-*; documented in `docs/DESIGN.md` Phase 2.
11. **Status-log discipline assertions land with documented exemptions.** Forward-looking; pre-existing specs exempted via checked-in list.
12. **Push-no-PR branches are tracked separately in Handoff Snippet from PR-open branches.** Don't conflate.

### Story boundary changes
None. dvx101–dvx107 + dvxret unchanged in scope. Coverage-touched helper extraction is a within-story implementation detail, not a new story.
