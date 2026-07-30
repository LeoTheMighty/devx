---
hash: rtl106
type: dev
created: 2026-07-30T09:31:00-06:00
title: "`/devx-learn` outlet routing rework (ordered five-outlet first-match)"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 6
status: ready
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

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 6
- Upstream rationale: mycase/8am-harness PR #36 §"routing the learnings"
