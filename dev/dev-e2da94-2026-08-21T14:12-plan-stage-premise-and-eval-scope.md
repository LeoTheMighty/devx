---
hash: e2da94
type: dev
created: 2026-08-21T14:12:00-06:00
title: "`/devx-plan` design+plan stage: verify corpus premises, and derive AC file lists from eval scope"
from: dev/dev-mssret-2026-07-28T13:45-retro-mid-story-split.md
status: ready
blocked_by: []
branch: feat/dev-e2da94
---

## Goal

Close two `/devx-plan` gaps that mid-story-split hit in the same epic, both
of which cost execute-time rework that the planning stage could have
prevented for free.

## Why

`epic-mid-story-split` F1 and F4:

1. **A design premise about the existing corpus went unchecked.** mss102's
   design said "specs without `branch:` (all existing specs) take the derive
   path". That is false — `validate-emit` requires every emitted spec to
   record its own derived branch — and implemented literally the attach arm
   would have fired on ordinary claims and silently adopted a leftover
   same-named branch where the claim previously failed loudly. Two of three
   reviewers caught it; the author had to narrow the arm and file INTERVIEW
   Q#14 mid-execute. The premise was checkable with one `grep` in seconds.
2. **An AC file list disagreed with its own eval's scan scope.** mss104's
   ACs named the files to sweep; E-2 greps five whole trees, and two stale
   comment tokens kept it RED while appearing in no AC. The execute-time
   choice was widen the sweep or narrow the eval — and narrowing a permanent
   invariant to match an incomplete AC list would have been the wrong trade.

## Acceptance criteria

- [ ] `/devx-plan` Design stage: for every claim the design makes about what
      EXISTING artifacts look like ("all current specs…", "no repo today…"),
      the design must name the command that verifies it, and the stage runs
      them. A claim with no verifying command is a gate warning.
- [ ] `/devx-plan` Plan stage: when a phase's verification is a mechanical
      eval, the phase's AC file list is DERIVED from the eval's scan scope —
      or the plan states explicitly that the eval is authoritative and the
      AC list illustrative.
- [ ] `devx plan-helper validate-emit` gains a check for both (warn
      severity, matching its existing heuristic tier).
- [ ] Discipline test pins both prose additions in `.claude/commands/devx-plan.md`
      and the mirror stays byte-identical.
- [ ] Full suite green.

## Technical notes

- `validate-emit`'s existing warn-severity heuristic
  (`[warn] [locked-decision-token-missing-from-spec]`) is the model for
  shape and severity.

## Status log

- 2026-08-21T14:12 — filed by mssret (retro findings F1 + F4). Both are
  skill-body + CLI changes, above what a retro PR should apply directly.

## Links

- Retro: `_devx/workstreams/mid-story-split/RETRO-2026-08-21.md`
- LEARN rows: `LEARN.md § epic-mid-story-split` F1, F4
