---
hash: 343b43
type: dev
created: 2026-08-21T14:10:00-06:00
title: "`devx learnings <workstream>` — harvest the loop's per-iteration `- Learning:` lines"
from: dev/dev-rtlret-2026-07-30T09:33-retro-retro-listener.md
status: ready
blocked_by: []
branch: feat/dev-343b43
---

## Goal

Make the overnight loop's per-iteration `- Learning:` lines readable as a
set, at retro time, without a human grepping six spec files by hand.

## Why

`epic-retro-listener` F1: sixteen loop iterations across six phases produced
roughly seventy `- Learning:` lines, and until the 2026-08-21 retro the only
consumer was a human happening to read a spec. They are not progress notes —
they are findings written at the moment of discovery by the agent that hit
them, and the four promoted into `LEARN.md § epic-retro-listener` include a
whole class of false-green test (`expect()` inside a callback the command's
own catch swallows), a cross-module invariant mismatch that wedges the serial
queue across restarts, and an eval that passed for the wrong reason.

The density is the argument: a loop-shipped epic writes more usable findings
into its status logs than its PR bodies, its diff and its tests combined, and
the retro stage currently points at the PR bodies (see rtlret F5, already
fixed in the skill body).

## Acceptance criteria

- [ ] `devx learnings <plan-hash|slug>` collects every `- Learning:` line
      from the status logs of the dev specs belonging to that workstream,
      grouped by spec and iteration, in merge order.
- [ ] Reuses `resolveSpecWorkstream` + the backlog parser — no second notion
      of workstream membership.
- [ ] `--since <iso>` and `--all` (every workstream) for the cross-epic
      sweep a `/devx-learn` run wants.
- [ ] `--json` emits `{workstream, specs: [{hash, iteration, learnings:[]}]}`
      for the retro stage to consume.
- [ ] Tolerant parse: a spec with no status log, no iterations, or a
      hand-edited log must not throw — advisory surface, same posture as
      `devx doctor`.
- [ ] `/devx` Stage: Retro step 1 invokes it (the prose there already tells
      the reader the lines exist; this makes reading them one command).
- [ ] Full suite green.

## Technical notes

- The lines are written by `src/lib/loop/driver.ts`'s iteration record; the
  shape is `  - Learning: <text>` nested under a
  `- <ts> — loop iteration N: <summary>` entry.
- Do NOT re-implement status-log parsing: `src/lib/devx/status-log.ts` owns
  the splice; add a reader beside it.

## Status log

- 2026-08-21T14:10 — filed by rtlret (retro finding F1). Higher-blast than a
  retro PR should apply: it is a new CLI surface, not a doc edit.

## Links

- Retro: `_devx/workstreams/retro-listener/RETRO-2026-08-21.md`
- LEARN rows: `LEARN.md § epic-retro-listener` F1
