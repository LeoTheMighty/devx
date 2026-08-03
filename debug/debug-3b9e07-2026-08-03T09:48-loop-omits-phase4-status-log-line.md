---
hash: 3b9e07
type: debug
created: 2026-08-03T09:48:00-06:00
title: "`devx loop` never emits the mandatory `phase 4:` status-log line — reddens main on the merge-tail commit"
from: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md
status: ready
owner: null
branch: null
---

## Goal

A story shipped by `devx loop` must satisfy the same audit contract an
attended story does: a `phase 4:` line in its status log proving adversarial
self-review ran. Today the loop writes `loop iteration N:` plus
`Change:`/`Learning:` bullets and never emits the mandated token, so every
loop-shipped story violates `test/devx-status-log-discipline.test.ts` the
moment its merge-tail commit sets `status: done`.

This is the cross-epic pattern **"attended-era contracts break on first
unattended contact"** (`LEARN.md § Cross-epic patterns`) recurring — this time
on the audit trail itself.

## Repro (observed, not hypothetical)

`main` was red for three consecutive runs on 2026-08-03:

```
30825188745  failure  chore: mark rtl106 done after PR #109 merge   14:57
30825325331  failure  feat: rtl104 — Watcher CLI …                  14:59
30825392845  failure  chore: mark rtl104 done after PR #107 merge   15:00
```

All three: `test/devx-status-log-discipline.test.ts` → "every shipped
non-retro non-grandfathered dev spec has a `phase 4:` status-log line".
Offenders were `rtl104` and `rtl106`, both shipped by `devx loop`.

Every open PR inherited the red, because PR CI runs on the merge commit.
sgr103 (PR #112) is how it was found.

## Root cause (evidence)

Two independent defects that compound:

1. **The loop's writer doesn't know the contract.** `devx loop` owns the
   status log (workers are forbidden from touching it by the iteration
   contract), and its vocabulary is `loop iteration N:` + `Change:`/
   `Learning:` bullets. `rtl104`'s log *does* record real review — "Cross-seam
   adversarial review of the full rtl104 diff fixed a skip-set aliasing bug
   that silently stranded malformed queue entries", plus several "Self-review
   fixes" — so for that spec the review happened and only the mandated token
   was missing. `rtl106`'s log records no review step at all, which is the
   worse half: the gate could not tell the two cases apart, because neither
   emitted the token.

2. **The assertion could only fire after the merge.** Its trigger was
   `status: done`, and that flip happens in the merge-tail commit /devx
   pushes DIRECTLY to main. So the PR was green, the merge succeeded, and
   main went red on the bookkeeping commit — the one place where nobody is
   watching and everybody is blocked.

Defect 2 is **fixed in sgr103 (PR #112)**: the trigger widened to
`status: done` OR `merged via PR` OR a `phase 5:`/`phase 7:` line, the latter
two landing on the feature branch so an attended story now fails its own PR.
Defect 1 is NOT fixed and is what this spec covers — a loop story writes
neither `phase 5:` nor `phase 7:`, so it remains uncatchable before merge.

## Acceptance criteria

- [ ] AC 1: The loop's merge tail emits a `phase 4:` status-log line for every
      item it ships, summarizing the review that ran in its iterations
      (finding count + disposition), in the canonical form
      `.claude/commands/devx.md` Phase 4 step 6 defines.
- [ ] AC 2: When no review ran in any iteration, the loop emits the
      explicit-zero form rather than omitting the line — the contract's whole
      point is that silence is indistinguishable from a skipped review.
- [ ] AC 3: A test drives a loop item end-to-end through the merge tail and
      asserts the resulting spec satisfies
      `test/devx-status-log-discipline.test.ts`, so the two contracts are
      pinned against each other rather than only against prose.
- [ ] AC 4: `rtl106` gets a real answer: either re-read PR #109's diff and
      replace its backfilled line with a genuine review record, or confirm the
      surface (skill prose + guard test) never needed one and say so.

## Technical notes

- Worked around in sgr103 (PR #112) by appending honest `phase 4:` lines to
  both specs — `rtl104`'s reformats the review evidence its own log already
  carries; `rtl106`'s states plainly that no review pass is recorded and
  asserts nothing about one having happened. Neither invents findings. That
  un-redded main; it did not fix the source.
- Do NOT "fix" a future occurrence by adding hashes to
  `PRE_DISCIPLINE_GRANDFATHER` — that list is frozen at the dvx103 baseline
  and the test says so.
- Worth a `LEARN.md` row at the next retro regardless of how AC 1 lands: this
  is the second time an attended-era contract has broken on unattended
  contact, and the first (PR #82's merge-tail `phase 4:` line) was in the
  same seam.

## Status log

- 2026-08-03T09:48 — filed from sgr103 (PR #112) after `main` sat red for
  three consecutive runs and blocked every open PR.
