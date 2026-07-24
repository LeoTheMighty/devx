---
hash: cf65aa
type: debug
created: 2026-07-24T13:22:00-06:00
title: loop merge tail never emits the dvx103 phase-4 line; iterations can end with verification outstanding
from: dev/dev-hfi104-2026-07-24T10:41-devx-learn-skill.md
status: done
owner: interactive-session-2026-07-24
branch: feat/debug-cf65aa
---

## Goal

Two loop-orchestrator gaps surfaced by the 2026-07-24 overnight run
(`loop-2026-07-24T16-46-18-001-62080`), both structural:

1. **Merge tail omits the `phase 4:` status-log line.** Workers are forbidden
   from editing the Status log (the orchestrator owns it), and
   `finalizeMerged` writes only `merged via devx loop — PR <url>` — so EVERY
   loop-shipped dev spec flips to `status: done` without the dvx103-mandated
   `phase 4:` line and trips `test/devx-status-log-discipline.test.ts` on the
   next branch cut from main. Happened twice in one run: hfi101 (fixed
   retroactively by hfi104's worker) and hfi104 itself (fixed retroactively
   in 5d254f7). hfi104's iteration-1 learning predicted the recurrence
   exactly.

2. **Iterations can end with verification outstanding.** The §2.2 prompt
   frame never tells the worker that final verification IS a valid iteration
   slice. hfi102 burned iterations 6–8 (its last three) re-running
   self-review and ending each turn with "only full-suite confirmation
   outstanding" — never running the suite, never setting `acs_met` — and was
   abandoned with all 5 ACs actually implemented (suite later verified
   2213/2214, sole failure the pre-existing main red from gap 1).

## Repro (confirmed 2026-07-24)

- Gap 1: `npx vitest run test/devx-status-log-discipline.test.ts` on main at
  f5c4d5f → FAIL, offender `dev/dev-hfi104-...` (loop-shipped, no `phase 4:`
  line). Same failure class inside `.worktrees/dev-hfi102` for hfi101.
- Gap 2: `.devx-cache/loop/loop-2026-07-24T16-46-18-001-62080/events.jsonl` —
  hfi102 iterations 6/7/8 all `class: success, decision: continue`, commits
  c0c58c6/e604e29/263731f each ending "leaving only full-suite confirmation
  outstanding"; `item:abandon` reason `iteration budget exhausted (8
  iterations without acs_met)`.

## Acceptance criteria

- [ ] `src/lib/loop/spec-io.ts`: pure `hasPhase4StatusLine(content)` helper
      mirroring the dvx103 test's detection (Status-log-bounded
      `/^- .*\bphase 4:/m`), unit-tested in `test/loop-spec-io.test.ts`.
- [ ] `src/lib/loop/driver.ts` `finalizeMerged`: when the spec's Status log
      lacks a `phase 4:` line, append a truthful loop-shape line (per-iteration
      verification stood in for the interactive pass; appended by the merge
      tail per dvx103) BEFORE the `merged via devx loop` line; no duplicate
      when a line already exists; append failure is a logged event, not a
      crash (best-effort like the rest of finalize).
- [ ] `src/lib/loop/iteration.ts` prompt frame: new instruction — when the
      only remaining work is final verification, that verification IS the
      iteration's unit of work; run it to completion and set `acs_met` from
      the result; never end an iteration with verification outstanding.
      Pinned in `test/loop-iteration.test.ts` (same-PR pin rule).
- [ ] `test/loop-driver.test.ts` happy path asserts the merged spec carries a
      `phase 4:` status-log line and passes the dvx103 detection regex.
- [ ] Full suite green (`npm test`, typecheck included).

## Status log

- 2026-07-24T13:22 — filed from the loop-2026-07-24 post-run review: main red
  reproduced (hfi104 offender), hfi102 abandonment root-caused to
  verification-parking; both gaps confirmed structural, not worker error.
- 2026-07-24T14:10-06:00 — phase 4: single-pass adversarial self-review (121-line surface, under the 3-agent threshold): audited numbered-instruction references, prompt-pin same-PR rule, commitOnMain pathspec coverage, handed-off path scoping; one finding (v2/04 prompt-frame doc drift) fixed in the same commit. All 3 touched test files 97/97; full suite green after clean rebuild (stale-dist false positive diagnosed, see PR notes).
- 2026-07-24T14:10-06:00 — merged via PR https://github.com/LeoTheMighty/devx/pull/82 (squash 8c3d095; CI green, merge-gate merge:true). Tour: https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/cf65aa/tour.html
