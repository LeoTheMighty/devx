---
hash: sgr104
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Regen hooks — claim + RED emission keep GRAPH.md fresh"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 4
status: in-progress
owner: /devx-2026-08-03T1400-29997
blocked_by: [sgr103]
branch: feat/dev-sgr104
---

## Goal

Make freshness structural on the two flows that already have CLI hosts:
claim and RED emission. Split from the `mark-done` phase so each lands as
one reviewable PR (both touch delicate transactional code). Plan phase 4
of workstream story-graph — read
`_devx/workstreams/story-graph/plan.md` §Phase 4. E-5 stays RED after this
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
