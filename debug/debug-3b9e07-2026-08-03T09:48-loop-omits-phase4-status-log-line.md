---
hash: 3b9e07
type: debug
created: 2026-08-03T09:48:00-06:00
title: "`devx loop` never emits the mandatory `phase 4:` status-log line — reddens main on the merge-tail commit"
from: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md
status: in-progress
owner: /devx-loop-2026-08-19T19-39-20-483-20983
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
- 2026-08-13T15:33:49-06:00 — claimed by /devx in session /devx-loop-2026-08-13T17-20-48-923-23705
- 2026-08-14T19:33:09.723Z — [FAIL] loop abandoned 3b9e07: 3 consecutive failures on this item; no real work was preserved — bookkeeping-only worktree discarded, item left ready
  - Learning: iteration 1 [ERROR]: worker report unparseable after retry (no JSON object found in the output); worker exited 1: …w implementing. Starting with the report contract: Now the validation, on its own error path: Now the prompt contract: API Error: Your computer went to sleep mid-response. The response above may be incomplete. API Error: Your computer went to sleep mid-response. The response above may be incomplete.
  - Learning: iteration 2 [FAIL]: No work was completed — the iteration was interrupted by a machine sleep before any investigation or edits landed.
  - Learning: iteration 3 [FAIL]: The previous iteration made no contribution — it errored out ('computer went to sleep mid-response') immediately after announcing it would read the spec, before any file was read or modified.
- 2026-08-19T13:39:20-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-19T20:14:29.845Z — loop iteration 1: Built and tested the pure layer for the loop's phase-4 audit contract: a validated review-evidence field in the worker report schema plus a composeLoopPhase4Line composer emitting the canonical non-zero, clean-review, and honest explicit-zero forms.
  - Change: IterationReport gained an optional `review` field (findings/fixed counts, optional shape/summary) validated on its own error path like split_request — malformed evidence is stripped and surfaced via a new `reviewErrors` result field, never failing the report; the iteration prompt contract now instructs workers to report review passes and never invent one.
  - Change: New pure composer `composeLoopPhase4Line` in spec-io.ts renders the merge tail's `phase 4:` status-log head in three honest forms (canonical non-zero with aggregated finding count + disposition + most load-bearing fix; clean-review zero form; explicit-zero form when no iteration reported a review), with worker-derived text sanitized against forged log lines.
  - Change: Added 12 tests across test/loop-iteration.test.ts and test/loop-spec-io.test.ts covering validation, stripping, prompt pins, aggregation, disposition wording, sanitization, and round-trip satisfaction of the dvx103 discipline regex; adjusted the retry-prompt size bound 6000→6500 (with rationale comment) since the shared schema block legitimately grew.
  - Learning: cf65aa (PR #82) already made finalizeMerged append a generic boilerplate phase-4 line, so AC 1's real gap is upgrading it to the canonical evidence-based form — and the rtl104/rtl106 incident went through a path finalizeMerged never covers: their owning loop DIED and a human merged interactively, so the next iteration should append the composed line branch-side (before the PR opens, alongside the last iteration commit) so handed-off and orphaned PRs carry it into PR CI, with the finalizeMerged append kept as fallback.
  - Learning: The driver accumulates per-item state (itemLearnings, changeSummaries) around line 1316 of driver.ts and consumes report fields in the cls==='success' branch (~line 2540) — that's where `report.review` accumulation slots in; the reviewErrors surface should get an event + WARN like iteration:split-request-invalid.
  - Learning: Running the five loop test files in one vitest invocation produced 13 timeout-shaped flaky failures from parallel-file contention (one driver test alone runs 101s); every file is green in isolation — verify loop-driver.test.ts in its own run.
  - Learning: buildReportRetryPrompt has a total-size pin (test/loop-iteration.test.ts 'bounds the carried output to a tail') that any growth of the shared OUTPUT_FIELD_LINES block trips — budget new schema field lines against it.
  - Learning: test/helpers/loop-git-fixture.ts provides makeFixture/scriptedWorker/mergedTail — scripted workers can return review-bearing reports directly, which is the natural harness for AC 3's end-to-end merge-tail test.
- 2026-08-19T20:27:58.543Z — loop iteration 2: Wired the phase-4 audit contract through the loop driver: review evidence accumulates across successful iterations, the composed canonical/explicit-zero line is committed branch-side before the PR opens (closing the orphaned-PR hole), and the merge-tail fallback plus two end-to-end tests pin the result against the dvx103 discipline check.
  - Change: Driver accumulates ReviewEvidence from successful iterations and surfaces malformed evidence via a new iteration:review-evidence-invalid event + WARN, mirroring the split-request posture (dropped evidence honestly degrades the line to explicit-zero rather than fabricating a review).
  - Change: completeItem appends the composeLoopPhase4Line result to the worktree spec and commits it (bookkeeping-prefixed) BEFORE pushing and opening the PR, so handed-off and orphaned PRs carry the audit line into PR CI — the exact rtl104/rtl106 path finalizeMerged never reaches; the finalizeMerged fallback remains, upgraded from the generic 'loop-shipped' boilerplate to the same composed line.
  - Change: Two new end-to-end driver tests: review-bearing iterations yield the canonical aggregated line on both the origin feature branch and the reconciled done spec, asserted with the discipline test's exact section-bounded regex (AC 3 cross-pin); malformed evidence on a handed-off tail yields the explicit-zero form branch-side with main untouched. Two existing driver tests updated from the retired boilerplate to the composed forms; fixture report shape gained a review field.
  - Change: Verified: typecheck + build clean, loop-driver.test.ts 64/64 in its own vitest run, loop-iteration + loop-spec-io + devx-status-log-discipline 84/84.
  - Learning: The branch-side phase-4 commit is safe from sweeping worker changes under a bookkeeping subject: the success branch's feat()/fix() commitAll always runs before completeItem, so the tree is clean there and the bookkeeping commit only ever carries the status-log append.
  - Learning: In the driver test fixture the scripted tail never really merges the branch into origin/main, so the reconciled main spec's phase-4 line comes from the finalizeMerged fallback while the origin feature branch proves the branch-side append — one merged-tail test therefore exercises BOTH emission paths and the no-duplicate guard at once.
  - Learning: AC 4 groundwork: PR #109 (rtl106) is a 193-line diff over .claude/commands/devx-learn.md, skills/devx-learn.md, and test/learn-skill-guards.test.ts — well under the 500-line substantial-surface threshold, so a genuine retrospective single-pass review replacing the backfilled line is the right shape, and its spec edit is authorized by AC 4's wording despite the general append-only rule.
  - Learning: The repo has no npm lint script; the local gate is npm test (schema + config + build + typecheck + both vitest configs), so per-iteration verification is typecheck + build + targeted vitest files, with the full ~17-minute suite reserved for the final iteration.
- 2026-08-19T20:55:36.060Z — loop iteration 3: Closed AC 4 with a genuine retrospective adversarial review of PR #109 that found and fixed a real self-contradiction in the /devx-learn routing prose, pinned it with a new guard test, replaced rtl106's gate-compliance backfill with the real review record, and verified the whole spec with a green full npm test gate.
  - Change: Fixed a MED contract conflict in the shipped /devx-learn Routing section: the intro's unconditional 'stop at the first match' contradicted checkability rule 3's tie-break ('a genuine tie is not a first match'), so a reader routing off the numbered walk never reached the exception and could ship a framework edit that was really one person's taste — the intro now names the tie exception and points at the coin-flip rule, with the skills/ mirror regenerated (sync:skills --check clean).
  - Change: Added a learn-skill-guards pin ('pins the tie exception inside the first-match framing') asserting the cross-reference against the Routing intro slice specifically, so the two paragraphs cannot silently drift apart again.
  - Change: Replaced rtl106's sgr103 gate-compliance backfill line with a genuine canonical-form phase-4 record (shape + rationale, 1 finding / 0 HIGH 1 MED 0 LOW, disposition, re-review clean) that also states what was checked and found sound, closing AC 4.
  - Change: Ran the full npm test gate to completion: exit 0 across schema smoke, config tests, build, typecheck, 113 parallel test files and 26 blocking test files — all four ACs now verified.
  - Learning: The rtl106 review's one real finding was in the prose contract, not the test code — the guard test faithfully pinned prose that contradicted itself, which is the failure mode structural pins cannot catch by construction: they assert phrases exist, never that two phrases agree. A cross-reference pin (assert paragraph A mentions rule B) is the cheap countermeasure.
  - Learning: The ROUTING slice's apparent fragility (indexOf returning -1 degrading the scope to a whole-body match) is not actually a live risk: a sibling test independently pins `^## Repo predicate$`, so the end anchor cannot vanish silently. Worth checking sibling assertions before reporting slice-anchor findings in this test file.
  - Learning: The full npm test gate takes ~25 minutes on this worktree, not the ~17 recorded in memory — test/loop-driver.test.ts alone runs 1,224s in the blocking config (one split-fallback case is 218s, one repair case 206s). Budget a single backgrounded run per iteration and poll; there is no room for a second full run.
  - Learning: Both vitest configs must be checked when confirming a green gate: `test:parallel` (113 files) and `test:blocking` (26 files) print separate 'Test Files' summaries, so tailing the log shows only the blocking total and understates coverage.
