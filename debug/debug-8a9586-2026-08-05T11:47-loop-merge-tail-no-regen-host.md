---
hash: 8a9586
type: debug
created: 2026-08-05T11:47:00-06:00
title: "Loop merge tail leaves GRAPH.md stale — FR-4's third flow has no unattended host"
from: sgr105
status: ready
---

## Goal

`devx loop`'s merge tail closes items without regenerating `GRAPH.md`, so
every overnight-merged item leaves the board stale until the next attended
claim or emission happens to refresh it. FR-4 ("every state-flipping flow
keeps the board fresh") and G-3 are only satisfied on the attended path.

## Repro (expected, not yet run)

1. Run `devx loop --max-items 1` against a repo with a committed, fresh
   `GRAPH.md`.
2. Let it merge one item through its own tail.
3. `devx graph --check` — expect non-zero: the DEV.md row says `[x]`, the
   board still says `[/]`.

The interactive path is green here (sgr105's E-5 leg proves claim →
`mark-done` → emission all leave `--check` at 0); this is the same assertion
against `driver.ts`'s tail rather than the skill body.

## Root cause (identified, not fixed)

`src/lib/loop/driver.ts` (~:2900–2970) has its own merge-cleanup
implementation: `setSpecStatus(mainSpecPath, "done")`, `markBacklogRowDone`,
`appendMainEntry`, then `commitOnMain` + `pushMain`. It predates sgr105 and
never routed through `regenerateGraph` — sgr104 hooked the claim and the RED
emission, sgr105 hooked the interactive cleanup, and the loop's tail is the
one flow neither touched.

It is a genuinely separate implementation, not an oversight of reuse: the
loop tail branches on split-failure (`[-]` blocked instead of `[x]`), appends
the dvx103 `phase 4:` line workers may not write, and carries follow-up spec
paths into the commit. `markDone`'s single happy path does not cover those.

## Acceptance criteria

- [ ] AC 1: A test pins that a loop-merged item leaves `devx graph --check`
      at exit 0 — the loop-side analogue of E-5's `mark-done` leg.
- [ ] AC 2: The loop merge tail regenerates the board and includes it in the
      cleanup commit's pathspec, warn-and-continue on failure (same posture
      as claim/emission/mark-done — a bad render never undoes a merge that
      already landed on origin).
- [ ] AC 3: The split-failed branch is covered too — a `[-]` blocked flip is
      a state change and the board must reflect it.
- [ ] AC 4: Decide and record whether the loop tail should call `markDone`
      for the non-split-failed case rather than keeping a parallel
      implementation. Two implementations of the closing flip is the drift
      risk sgr105 spent its whole surface removing on the attended side.

## Technical notes

- Found during sgr105's Phase 4 self-review, filed rather than fixed:
  sgr105's plan phase names `.claude/commands/devx.md` + `skills/devx.md` as
  its prose surface, and the loop tail's differing semantics make it a
  design question (AC 4), not a mechanical extension.
- `devx graph --check` (E-2) is the gate that would have caught this in CI
  had anything run it after a loop night — worth considering as part of the
  loop's own morning report.

## Status log

- 2026-08-05T11:47 — filed from sgr105 Phase 4 self-review (out-of-scope gap).
