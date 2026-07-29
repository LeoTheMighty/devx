---
hash: mss104
type: dev
created: 2026-07-28T13:43:00-06:00
title: "Handoff Snippet retirement sweep"
status: in-progress
from: plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md
plan: _devx/workstreams/mid-story-split
phase: 4
blocked_by: [mss102, mss103]
branch: feat/dev-mss104
owner: /devx-2026-07-29T0854-84555
---
## Goal

Only after both consumers exist does the snippet die: Phase 9 routes early
halts to `devx split`, the prose section + parser + test + fixture are
deleted, and E-2's grep-zero invariant holds permanently from this merge
on. Plan phase 4 of workstream mid-story-split.

## Acceptance criteria

- [ ] AC 1: `.claude/commands/devx.md` + `skills/devx.md` (byte-identical
      pair — `test/skills-sync.test.ts`) — Phase 9 bridge line rewritten
      to route early halts to `devx split <hash> --payload <file>
      --session-token <token>` (merge-first if coherent+green — land
      through Phases 5–8 first; branch-handoff otherwise — push WIP
      branch, split, release the spec lock); `## Handoff Snippet` section
      deleted; the devx.md:110 token-source clause drops "or a Handoff
      Snippet that carries it".
- [ ] AC 2: `src/lib/devx/handoff-snippet.ts`,
      `test/devx-handoff-snippet.test.ts`, and
      `test/fixtures/handoff-snippet-realistic.md` deleted; dangling
      reference in `test/devx-skill-phase1-resume.test.ts:22` fixed.
- [ ] AC 3: new `test/devx-skill-phase9-split.test.ts` — `phase9Body()`
      extractor moved verbatim (keep the load-bearing `^(### |## )`
      bound), pins the `devx split` invocation string verbatim (roc101
      pattern), pins the merge-first/branch-handoff routing sentences,
      asserts zero Handoff Snippet tokens in the skill body.
- [ ] AC 4: cross-ref sweep — `v2/03-review-tour.md:90` exemplar repointed
      at the new test; `v2/05-dispatcher.md` notes a follow-up is an
      ordinary ready row; `docs/HOW_TO_USE.md` loop prose gains the
      `split` outcome; CLAUDE.md dvx107 mention annotated "(retired by
      mid-story-split)"; LEARN.md E12 + shape-(c) rows amended
      append-only with the successor exemplar pointer.
- [ ] AC 5: eval
      `_devx/workstreams/mid-story-split/evals/E-2_snippet-grep-zero.ts`
      flips GREEN (re-run it RED first — it lists every live token site);
      `test/skills-sync.test.ts` green; full suite green after the three
      deletions; `npm test` (typecheck included) green.

## Technical notes

E-2's historical-archive allowlist: LEARN.md entries, shipped spec files,
`_bmad-output/` — the eval greps `.claude/commands/`, `src/`, `test/`,
`docs/`, `v2/` only, with `test/devx-skill-phase9-split.test.ts` exempted
(the detector cannot be a violation of the thing it detects).
`docs/ROADMAP.md:43`, `docs/DESIGN.md:324,918`, `README.md:38` become true
as written — cite, don't edit.

## Status log

- 2026-07-28T13:43 — emitted by /devx-plan (RED gate passed; workstream
  mid-story-split, plan phase 4).
- 2026-07-29T08:54:24-06:00 — claimed by /devx in session /devx-2026-07-29T0854-84555

## Links

- Plan: `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md`
- Workstream: `_devx/workstreams/mid-story-split/` (prd/design/plan/evals)
