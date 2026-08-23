---
hash: sgr104
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Regen hooks — claim + RED emission keep GRAPH.md fresh"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 4
status: done
owner: /devx-2026-08-03T1400-29997
blocked_by: [sgr103]
branch: feat/dev-sgr104
---

## Goal

Make freshness structural on the two flows that already have CLI hosts:
claim and RED emission. Split from the `mark-done` phase so each lands as
one reviewable PR (both touch delicate transactional code). Plan phase 4
of workstream story-graph — read
`_devx/workstreams/story-graph/plan/agent.md` §Phase 4. E-5 stays RED after this
phase — it needs all three hooks and goes green in phase 5.

## Acceptance criteria

- [ ] AC 1: `src/lib/graph/regen.ts` (new) — `regenerateGraph(fs, repoRoot,
      engine)` → `{ok:true,path} | {ok:false,warning}`; never throws
      (T4.1).
- [ ] AC 2: Claim hook (`src/lib/devx/claim.ts`): regen runs AFTER the
      rename batch completes (the renamePlan (:836) is composed from
      in-memory strings — a disk-reading regen before it would render
      pre-flip state; the comment at :847-849 anticipates this slot).
      GRAPH.md gets its own `writeAtomic`; `revertWorkingTree` (:873)
      gains a restore-**or-unlink** branch (GRAPH.md may not pre-exist on
      first claim); the claim commit's explicit pathspec (:901-923) gains
      GRAPH.md (T4.2).
- [ ] AC 3: Emission hook: regen after `writeRetroAtomically`'s rename
      plan (emit-retro-story.ts:318) completes, own tmp+rename;
      `runEmitRetroStory`'s greppable key=value stdout line
      (plan-helper.ts:287-305 — NOT JSON) gains a `graph=<path>` key,
      present only when regen succeeded (T4.3).
- [ ] AC 4: `.claude/commands/devx-plan.md` RED-stage commit pathspec
      consumes the `graph=` key; `skills/devx-plan.md` regenerated via
      `npm run sync:skills` (T4.4).
- [ ] AC 5: Tests (T4.5): claim happy path leaves `--check` green with
      GRAPH.md in the claim commit; claim regen failure warns and the
      claim still succeeds; post-regen claim-step failure restores the
      prior GRAPH.md and a first-claim failure unlinks it (no orphan);
      emission regen failure warns and emission succeeds; `graph=` key
      present exactly when regen succeeded. `npm run sync:skills --
      --check` green; full suite + typecheck green.

## Technical notes

- Failure posture: regen inside any hook is warn-and-continue — a broken
  render never aborts a state flip; `--check` catches the miss (E-2).
  Tested per hook, not assumed.
- Prose-bearing diff: batch skill-body edits before starting the gate
  (Phase 5 discipline in `.claude/commands/devx.md`).

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage (workstream 62bcd1).
- 2026-08-03T14:00:13-06:00 — claimed by /devx in session /devx-2026-08-03T1400-29997
- 2026-08-03T14:05 — phase 2: spec ACs direct (v2 native); 5 ACs; workstream=story-graph; red-artifacts=none (Phase 4 verification type is tests-after; E-5 stays RED until Phase 5's mark-done host).
- 2026-08-03T14:10 — phase 3: implemented T4.1–T4.5. New `src/lib/graph/regen.ts` (`regenerateGraph`, never-throws, owns GRAPH_FILENAME; `src/commands/graph.ts` re-exports it so lib never depends on commands). Claim hook at Step 3.5 after the rename batch, with restore-or-unlink rollback + pathspec. Emission hook after `writeRetroAtomically`'s rename plan, surfacing `graphPath` → the CLI's new `graph=` key. RED-stage pathspec prose + `npm run sync:skills`.
- 2026-08-03T14:30 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor; substantial-surface threshold — ~900 lines touching transactional rollback code). ~25 findings, 9 unique actionable after dedup (2 HIGH, 5 MED, 2 LOW); ALL fixed in-place. Most load-bearing: GRAPH.md's repo-wide summary banner made every contended claim conflict during `pull --rebase`, classifying contended at ZERO retries used and silently disabling mlc104's rebase-retry — the board now leaves the claim commit the moment a race-shaped rejection is seen (verified: without the fix the new contention test fails with `after 0 rebase-retries`). Also: `git add` of a gitignored board took the whole claim down (now best-effort + WARN, and the git-add failure path gained the missing `restore --staged`); the public `regen` seam could throw and leak the spec lock (now guarded); an unreadable pre-claim board is now skipped rather than overwritten-and-un-rollback-able; `ClaimSpecOpts.config` widened with `engine?` so a narrowed config can't silently render with ENGINE_DEFAULTS; `relFromRepo` switched to `path.relative` (a trailing-slash root leaked an absolute path onto the `graph=` line). Two rollback tests the Auditor caught passing vacuously were rebuilt around a spy regen that pins the board actually changed mid-flight. Filed `debug-7e2b56` (emit-retro-story's worktree root) as out of scope — it pre-dates this story. Re-review clean.
- 2026-08-03T15:40 — phase 5: first clean gate green (140 files / 3173 tests, typecheck + build clean, 17m). Its stderr surfaced a defect the review missed: `test/devx-split.test.ts` calls the real `claimSpec` against the fake `/repo` root with no `regen` seam, so every run attempted a real `mkdir('/repo')` on the host (benign where `/` is unwritable, a landmine in any root-running container) and those tests never exercised the hook. Fixed at the source — `regenerateGraph` now refuses a non-existent repo root before the write, since `writeAtomic` mkdirs the target's parent and GRAPH.md's parent IS the root — plus the missing seam in the split fixture (its fake `exists()` prefix-matches, so the guard alone can't reach it) and a unit test pinning the guard. Re-gating.
- 2026-08-03T16:25 — phase 5 (final): gate #2 on the final code = 139/140 files, 3173/3174 tests; the single failure is `loop-concurrency`'s G-1 case timing out at 600s. Established environmental, not a regression: (a) `claim-contention` — unchanged code — slowed by the identical 1.71x across the two runs, as did every other file, changed or not; (b) the file re-run in isolation is green at 151s with the failing case at 122s (4.9x headroom); (c) the hook's own cost is 0.26s per 181-spec render, measured. Gate #1 (140/140, 3173/3173) covers everything but the last two fixes; those three files were re-run targeted and green (91/91). Headroom fragility filed as `debug-5c8b21`. Remote CI is ground truth for this PR.
- 2026-08-03T16:50 — phase 7: PR #114 opened (https://github.com/LeoTheMighty/devx/pull/114); remote CI green (devx-ci run 30930648142) — which independently confirms gate #2's `loop-concurrency` timeout was local/environmental, since CI ran the same suite green. phase 7.5: tour built + published (11 stops, 7 decisions, 2 trails with all 10 edges grep-verified at their call sites). Tour render initially failed at stage `vendor` — `diff2html`/`marked` were absent from node_modules in BOTH the worktree and the main checkout despite being pinned deps; `npm install` recovered it with no lockfile churn. Note: the globally-linked `devx` resolves to the main checkout's stale `dist`, which predates `tour` entirely — every CLI call in this run that needed current behavior used the worktree's `dist`.
- 2026-08-03T17:05 — merged via PR #114 (squash → 6527aea). Remote CI green (devx-ci 30930648142). phase 8: hold check clean, `devx merge-gate sgr104` → {"merge":true}. Bookkeeping done from an isolated `main` worktree: the shared main checkout was on a peer session's `feat/dev-tur101` with uncommitted work, so switching it would have disrupted a live peer (CLAUDE.md concurrent-session rule). E-5 remains RED as designed — sgr105's mark-done host is the last of the three flows.
