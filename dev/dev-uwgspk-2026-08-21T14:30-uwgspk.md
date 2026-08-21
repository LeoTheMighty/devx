---
hash: uwgspk
type: dev
created: 2026-08-21T14:30:00-06:00
title: "Spike — does a usage-probe API exist? (timeboxed, findings doc only)"
from: plan/plan-c8e2d4-2026-07-14T10:41-usage-window-governor.md
plan: plan/plan-c8e2d4-2026-07-14T10:41-usage-window-governor.md
status: ready
blocked_by: []
branch: feat/dev-uwgspk
---

## Goal

FR-8. Decide whether `probeUsage()` can ever be implemented, before anyone
plans the proactive 95% cap on the assumption that it can.

Parallel-safe with every other phase: it touches no production code.

## Acceptance criteria

- [ ] AC 1: Inspect the `claude -p --output-format json` result envelope for
      usage / limit / reset fields. Record what is actually there.
- [ ] AC 2: Investigate whether any `claude usage` CLI or OAuth endpoint
      exposes window % + reset time.
- [ ] AC 3: A findings doc under
      `_devx/workstreams/usage-window-governor/reference/` with a go/no-go
      on implementing `probeUsage()`.
- [ ] AC 4: No production code beyond — if the probe is trivially proven —
      an implementation behind the EXISTING inert seam. If it is not
      trivially proven, ship the doc and stop; that is the deliverable.
- [ ] AC 5: Timebox honoured: one story. If the answer is "unknown after a
      story's worth of looking", that IS the finding — record it and stop.

## Technical notes

- Only after this does "proactive 95% cap + triage headroom" become
  plannable at all. Until then `usage_cap_pct` stays documented-as-inert
  (uwg103 AC 5).

## Status log

- 2026-08-21T14:30 — emitted by /devx-plan (all four gates passed: prd PASS,
  design CONCERNS, plan CONCERNS, evals CONCERNS; both CONCERNS verdicts are
  the human-gated E-7 and the parked FR-8 spike, recorded honestly rather
  than waived).

## Links

- Workstream: `_devx/workstreams/usage-window-governor/`
- Design decision: `decisions/D-UW1-pre-ladder-interception.md`
- RED artifact: `test/loop-usage-window.test.ts`
