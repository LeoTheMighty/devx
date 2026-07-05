---
hash: v2o101
type: dev
created: 2026-07-05T13:07:00-06:00
title: V2.6 — outcome loop + migration retro
from: v2/06-phases.md
plan: v2/
status: ready
blocked_by: [v2l101]
branch: feat/dev-v2o101
---

## Goal

Close the loop past merge: outcome measurement + the v2 migration's own retro.
Per `v2/06-phases.md § V2.6` and `v2/02-engine.md` §4.10.

## Acceptance criteria

- [ ] `/devx outcome <hash>` + `devx outcome` CLI support: `measure_by`
      armed at workstream close; RESULTS.md scoring each numeric `G-` goal
      vs reality with verdict `keep|tune|restart|retire`; tune →
      cascade-reopen keyed to missed E-ids; restart → lineage fields
      (`learns_from`, `superseded_by`).
- [ ] `devx next` surfaces due outcomes (measure_by passed → row between
      #5 and #6).
- [ ] Migration retro: native `/devx retro` across V2.1–V2.5 workstreams;
      LEARN.md rows; ≥3-concordance promotions evaluated; v2/ docs updated
      where reality diverged from plan (append, don't rewrite).
- [ ] S-1 verification recorded: measured prose bytes for one full
      PRD→merge run under the new engine, vs the 60KB budget.
- [ ] Dead v1 prose removed from docs (DESIGN.md sections superseded by v2/
      get pointers, not deletions).
- [ ] Full suite green.

## Status log

- 2026-07-05T13:07 — created from v2/06-phases.md § V2.6.
