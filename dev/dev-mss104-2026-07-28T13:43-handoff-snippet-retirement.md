---
hash: mss104
type: dev
created: 2026-07-28T13:43:00-06:00
title: "Handoff Snippet retirement sweep"
status: done
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
- phase 2: spec ACs direct (v2 native); 5 ACs; workstream=mid-story-split;
  red-artifacts=`_devx/workstreams/mid-story-split/evals/E-2_snippet-grep-zero.ts`
  (re-run RED first — enumerated 39 live token sites across
  `.claude/commands/`, `src/`, `test/`, `v2/` plus the missing Phase 9
  replacement prose; honest RED, not harness breakage).
- phase 3: T4.1–T4.5 complete. Phase 9 halt-early bullet now routes to
  `devx split <hash> --payload <file> --session-token <token>` with the
  payload shape + shape-selection rules inline; `## Handoff Snippet`
  section (48 lines) deleted; devx.md:110 token-source clause dropped the
  snippet half; mirror re-synced byte-identical. Deleted
  `src/lib/devx/handoff-snippet.ts`, `test/devx-handoff-snippet.test.ts`,
  `test/fixtures/handoff-snippet-realistic.md`; fixed the dangling
  reference in `test/devx-skill-phase1-resume.test.ts:22`. New
  `test/devx-skill-phase9-split.test.ts` (8 tests) carries `phase9Body()`
  forward verbatim with its load-bearing `^(### |## )` bound. Cross-ref
  sweep: `v2/03-review-tour.md`, `v2/05-dispatcher.md`,
  `docs/HOW_TO_USE.md`, `CLAUDE.md`, `LEARN.md` (E12 + shape-(c),
  append-only amendments). Also swept two `Handoff Snippet` comment
  tokens out of `src/lib/devx/split.ts` — in E-2's scanned set but not
  enumerated by any AC.
- phase 4: single-pass adversarial review (192 changed lines — below the
  500-line 3-agent threshold, but marker-bearing so reviewed at
  regex/instruction level); 3 findings (1 HIGH, 2 MED); ALL fixed
  in-place — most load-bearing: the branch-handoff instruction said
  "release the parent's spec lock yourself" with no mechanism and no CLI
  exists (`releaseSpecLockGuarded` is library-only), so an agent would
  either skip the release and leave a stale lock masking the spec from
  `devx next`, or guess; now names
  `rm .devx-cache/locks/spec-<hash>.lock`. Also fixed: `$SCRATCH`
  referenced at Phase 9 but only derived in Phase 7, which an early halt
  may never reach (now derived inline); merge-first ordering was
  ambiguous against `performSplit`'s ownership guard — split must land
  after the merge but BEFORE Phase 8's after-merge bookkeeping releases
  the lock, else exit 3. Re-review of the fixed hunks clean.
- phase 5: local CI green — `npm test` (schema smoke + config io/validate +
  build + typecheck + vitest) = 128 files / 2531 tests passed, exit 0.
  E-2 eval GREEN. Targeted re-run after the final review fix (phase9-split
  + phase1-resume + phase8-discipline + status-log-discipline +
  skills-sync) = 48 passed; `npm run typecheck` clean.
- phase 7: PR opened — https://github.com/LeoTheMighty/devx/pull/101
  (body rendered via `devx pr-body`; no unresolved placeholders).
- note: this spec's phase 2/3/4 status lines and the workstream todo.md
  edits were swept onto main by a concurrent session's `git add -A`
  (commit ac0ccf2; erratum recorded by that session in ba3c65b). Content
  landed intact — attribution only. Recorded here so the audit trail
  reads correctly from this spec alone.
- phase 7.5: review tour built + published —
  https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/mss104/tour.html
  (4 stops, 5 decisions, 2 trails — every trail edge grep-verified at the
  call site; one 🕳 gap flagged on the four cite-don't-edit prose lines
  that sit outside E-2's scanned set).
- phase 8: remote CI green (`devx-ci` run 30466026215, conclusion success);
  `check-hold` clean; `devx merge-gate mss104` → `{"merge":true}`;
  merged via PR #101 (squash → 5292b19).

## Links

- Plan: `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md`
- Workstream: `_devx/workstreams/mid-story-split/` (prd/design/plan/evals)
