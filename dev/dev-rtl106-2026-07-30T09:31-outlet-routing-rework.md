---
hash: rtl106
type: dev
created: 2026-07-30T09:31:00-06:00
title: "`/devx-learn` outlet routing rework (ordered five-outlet first-match)"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 6
status: done
owner: /devx-loop-2026-07-30T16-02-29-879-60783
blocked_by: []
branch: feat/dev-rtl106
---

## Goal

Port upstream's routing improvement: the four-bucket table asked the same
judgment twice and had no outlet for one-person preferences. Replace it with
an ordered first-match procedure over five outlets plus three checkability
rules. Prose + structural tests only; severable. Plan phase 6 of workstream
retro-listener.

## Acceptance criteria

- [ ] AC 1: `.claude/commands/devx-learn.md` replaces the four-bucket table
      with the ordered first-match procedure — framework fix · project
      preference (`devx.config.yaml` proposal) · product/workstream lesson
      (LEARN.md candidate) · personal preference (`~/.claude/` snippet,
      presented to the user and NEVER committed) · dropped — plus the three
      rules: name the question that decided the bucket; promotion to
      framework fix is an evidence claim (not plausibility); a coin flip
      takes the narrower outlet and records the ambiguity.
- [ ] AC 2: The existing repo predicate and the `nudge-canonical` marker
      paragraph are byte-preserved (the marker pins — including
      `test/learn-nudge-pin.test.ts` from rtl101 — must stay green
      untouched).
- [ ] AC 3: `skills/devx-learn.md` mirror updated via `npm run sync:skills`;
      `npm run sync:skills -- --check` clean.
- [ ] AC 4: `test/learn-skill-guards.test.ts` updated/extended: five
      outlets present and ordered, first-match phrasing asserted; the full
      structural trio (`learn-skill-guards`, `skill-todo-discipline`,
      `learn-nudge-pin`) green.

## Status log

- 2026-07-30T09:31 — emitted by /devx-plan RED stage (workstream 620c74).
- 2026-07-31T09:43:41-06:00 — claimed by /devx in session /devx-loop-2026-07-30T16-02-29-879-60783
- 2026-07-31T15:57:42.610Z — loop iteration 1: Replaced /devx-learn's four-bucket table with an ordered five-outlet first-match routing procedure plus three checkability rules, mirrored to skills/, and extended the structural guard test to pin outlet order and framing.
- 2026-08-03T10:12 — merged interactively after the owning loop died (PID 60783): ubuntu CI red was the pre-existing backlog-mutate R3 flake (identical failure on main); rerun green → squash-merged PR https://github.com/LeoTheMighty/devx/pull/109 (48ab09df). Stale spec lock reaped (dead PID), worktree removed.
  - Change: Rewrote the `## Buckets` table in `.claude/commands/devx-learn.md` as a `## Routing` section: five outlets walked in widest-blast-radius-first order (framework fix · project preference · product/workstream lesson · personal preference · dropped), stopping at first match so the same judgment is never asked twice, with the personal-preference outlet explicitly presented-not-committed (`~/.claude/` snippet, never touches the repo).
  - Change: Added the three checkability rules to the same section: name the question that decided the bucket; promotion to framework fix is an evidence claim, not a plausibility claim; a coin flip takes the narrower outlet and records the ambiguity.
  - Change: Regenerated the `skills/devx-learn.md` mirror via `npm run sync:skills` (byte-identical to the command file; `sync:skills -- --check` clean), leaving the repo predicate and the `nudge-canonical` marker paragraph byte-preserved.
  - Change: Extended `test/learn-skill-guards.test.ts`: replaced the four-bucket assertion with six tests over a sliced `ROUTING` region — Routing section present and Buckets gone, first-match/exactly-one/in-order framing, the five outlets asserted in positional order (not as an unordered set), each outlet's destination, the personal outlet's presented-and-NEVER-committed constraint, and the three rules.
  - Learning: Asserting the five outlets as a set would let any permutation pass while routing nothing deterministically — the order is the contract, so the test walks a cursor through positional indexes rather than matching five independent regexes.
  - Learning: Slicing the body between `## Routing` and `## Repo predicate` before asserting keeps the new pins from accidentally matching identical prose elsewhere in the skill body (e.g. `LEARN.md` and `devx.config.yaml` appear in several sections).
  - Learning: The skill body hard-wraps, so phrase-level pins spanning a line break need `\s*\n?\s*` between words — a plain literal regex silently fails on reflowed prose.
  - Learning: The full `npm test` gate (schema smoke → tsx config tests → build → typecheck → vitest) runs well past 10 minutes on this worktree; build and typecheck clear early, so the targeted trio plus `sync:skills --check` is the fast signal and the full suite is best left to remote CI.
- 2026-08-19T14:30 — phase 4: 1-agent single-pass retrospective adversarial review of PR #109's merged diff (193 lines over `.claude/commands/devx-learn.md`, the `skills/` mirror, and `test/learn-skill-guards.test.ts` — below the 500-line substantial-surface threshold, so single-pass is the sanctioned shape and the parallel one was not required); 1 finding (0 HIGH, 1 MED, 0 LOW); fixed in-place — the Routing intro asserted an unconditional "stop at the first match" while checkability rule 3 asserted the opposite for ties ("a genuine tie is not a first match"), and nothing in the intro forward-referenced the exception, so a reader routing straight off the numbered list stopped at the widest matching outlet and could ship a framework edit that was really one person's taste — the exact irreversible direction rule 3 exists to prevent; the intro now names the tie exception and points at the coin-flip rule, and a new `learn-skill-guards` pin ("pins the tie exception inside the first-match framing") asserts it against the intro slice so the two paragraphs cannot drift apart again; re-review clean. Also checked and found sound: the `ROUTING` slice's end anchor is independently pinned by the sibling `^## Repo predicate$` assertion (so the scoping the rework relied on cannot silently degrade to a whole-body match), the five-outlet positional cursor genuinely rejects permutations, AC 2's byte-preserved repo predicate and single `nudge-canonical` marker still hold, and no shipped surface retains a stale four-bucket reference (the remaining hits are frozen workstream artifacts describing the before-state). Supersedes the 2026-08-03T10:05 gate-compliance backfill appended by sgr103 (PR #112), which asserted nothing about review having happened and named this re-read as the honest follow-up; delivered as AC 4 of `debug/debug-3b9e07`.

## Links

- Plan: `_devx/workstreams/retro-listener/plan/agent.md` §Phase 6
- Upstream rationale: mycase/8am-harness PR #36 §"routing the learnings"
