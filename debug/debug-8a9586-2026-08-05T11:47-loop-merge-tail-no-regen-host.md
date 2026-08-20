---
hash: 8a9586
type: debug
created: 2026-08-05T11:47:00-06:00
title: "Loop merge tail leaves GRAPH.md stale — FR-4's third flow has no unattended host"
from: sgr105
status: in-progress
owner: /devx-loop-2026-08-19T19-39-20-483-20983
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
- 2026-08-15T13:42:10-06:00 — claimed by /devx in session /devx-loop-2026-08-13T17-20-48-923-23705
- 2026-08-17T04:21:25.635Z — [FAIL] loop abandoned 8a9586: 3 consecutive failures on this item; no real work was preserved — bookkeeping-only worktree discarded, item left ready
  - Learning: iteration 1 [FAIL]: The previous iteration produced no work — the session was interrupted by an API error immediately after starting, before the spec was read or any file was changed.
  - Learning: iteration 2 [FAIL]: No work was performed — the iteration failed before reading the spec due to an API interruption (machine sleep).
  - Learning: iteration 3 [ERROR]: worker report unparseable after retry (no JSON object found in the output); worker exited 1: …t me make the changes. First, export `isGitIgnored`: Now the driver imports and seam: Now the merge-tail regen itself: API Error: Your computer went to sleep mid-response. The response above may be incomplete. API Error: Your computer went to sleep mid-response. The response above may be incomplete.
- 2026-08-19T16:14:18-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-19T22:21:02.152Z — loop iteration 1: Hoisted the shared `isGitIgnored` helper into `src/lib/exec.ts` and threaded an injectable GRAPH.md regen seam into the loop driver, stopping short of the merge-tail regen call itself when the session was interrupted.
  - Change: Moved the `isGitIgnored` git check-ignore helper out of `src/lib/devx/mark-done.ts` into `src/lib/exec.ts` as an exported function, so the attended cleanup commit and the loop merge tail ask the same question about GRAPH.md through one implementation; `mark-done.ts` now imports it instead of carrying a private copy.
  - Change: Added a `regen?: RegenFn` injection point to `RunLoopOpts`, defaulted to `regenerateGraph` once per run in `runLoop`, and threaded it plus the resolved `EngineConfig` through to `runItem` via new required `engine`/`regen` fields on `RunItemArgs` — the seam tests will use to inject a failing or throwing renderer.
  - Learning: The loop driver resolves `engineConfigFrom(merged)` once per run but previously never passed it down to `runItem`; the merge tail needs it to render the board under the same knobs as the attended path, so the plumbing had to be widened before the regen call could be written.
  - Learning: This item has now been interrupted mid-implementation at the same point three separate times (per the Status log, always right at 'the merge-tail regen itself'), which suggests the regen call should be written as the very first edit of an iteration rather than after the refactor groundwork.
  - Learning: `tsc --noEmit` does not flag the currently-unused `GRAPH_FILENAME`, `RegenResult`, and `isGitIgnored` imports in `driver.ts`, and this repo has no `lint` npm script — so a half-written tail typechecks clean and will not be caught by the local gate. The imports are placeholders for the pending regen block.
- 2026-08-19T23:20:52.250Z — [FAIL] loop iteration 2: Iteration was cut short by machine sleep mid-response, leaving the merge-tail GRAPH.md regen work and its test file in an unverified, unreported state.
  - Learning: The iteration died to the known macOS-sleep failure mode (API Error: Your computer went to sleep mid-response) partway through writing the merge-tail regen test file; any partial edits from that run are unverified and should be re-derived rather than trusted.
  - Learning: Iteration 1's guidance to write the merge-tail regen call before the surrounding tests still holds — the typecheck passed on that edit before the session was interrupted.
- 2026-08-20T04:59:14.694Z — loop iteration 3: Wired the loop merge tail into GRAPH.md regeneration on both the done and split-failed branches, pinned it with a negative-controlled 6-case test file, and recorded the AC-4 decision to share the regen primitive rather than route through markDone.
  - Change: `src/lib/loop/driver.ts`: the merge tail now regenerates GRAPH.md after its state flips and carries it in the cleanup commit's pathspec — on the `[x]` done branch AND the split-failed `[-]` blocked branch. Warn-and-continue posture matching claim/emission/mark-done: a render failure events + item-warns, an injected throwing hook is contained rather than escaping the commit that closes the item, and a gitignored board is rendered but omitted from the pathspec so `git add` cannot refuse the whole list and cost the follow-up spec its commit.
  - Change: `test/loop-graph-freshness.test.ts` (new, 6 cases): the loop-side analogue of E-5's mark-done leg. Runs the real `runGraph({check:true})` after a real `runLoop` — merged item, split-FAILED blocked flip, split-SUCCESS (follow-up spec + board sharing one `git add`), failing regen, throwing regen, gitignored board. Verified as a real pin by negative control: stubbing the regen call out reds all 6, with the AC 1/AC 3 cases failing on `graph --check` exit 1 exactly as the spec's repro predicted.
  - Change: AC 4 decided and recorded in two durable places (`_devx/workstreams/story-graph/design.md` §5 as FR-4's fourth host, plus the driver JSDoc): the tail keeps its own flip sequencing and shares only the `regenerateGraph` primitive, because `markDone` has no blocked mode, no dvx103 `phase 4:` fallback line, and no follow-up-spec pathspec. The duplication sgr105 removed was regen logic, and that is what is now shared (one `regenerateGraph`, one `isGitIgnored`, one failure posture).
  - Change: Registered the new file in `vitest.shared.ts`'s `SYNC_BLOCKING_TESTS` (git-heavy pass-2 profile) with explicit 30s per-test caps measured against a 1.1–1.3s isolated runtime, rather than inheriting the 5s default these cases would flake against under pass 2's maxForks:2 contention.
  - Learning: The AC 1 assertion reds on `graph --check` exit 1 rather than on an unchanged board, because the sgr104 CLAIM hook already regenerates GRAPH.md mid-run. Without the tail fix the board is fresh-but-wrong (says `[/]` in-progress while DEV.md says `[x]`), which is a more subtle stale state than 'never regenerated' and is why `--check` — not a file-changed assertion — is the right pin.
  - Learning: The loop fixture (`test/helpers/loop-git-fixture.ts`) ships no devx.config.yaml, but `runGraph` exits 2 without one at the resolved root. Any future loop test that wants to run the graph CLI must copy the real repo's config in first, the way test/graph-cli.test.ts and the eval fixture already do; the loop driver itself never needs it because it takes `merged` directly.
  - Learning: The merge tail is FR-4's fourth host, but it is not the last unhooked state-flipping loop flow: `abandon-preserved`/`abandon-discarded` (`[-]`/`[ ]` flips), `release-to-ready`, `split-bookkeeping`, and `handed-off-split` all mutate DEV.md rows without regenerating the board. They are outside this spec's ACs, but a follow-up sweeping them would close FR-4 on the unattended path entirely.
  - Learning: `commitOnMain`'s `extraPaths` are `git add`ed as one list and ALL dropped if the add fails, so an ignored GRAPH.md would silently cost a split's follow-up spec its commit. The gitignore check is not cosmetic — it protects an unrelated artifact, which is why the split-SUCCESS case is pinned alongside the gitignore case.
  - Learning: The prose-budget gate (S-1) counts only `_devx/templates/engine/` plus `.claude/commands/devx-plan.md`; workstream design docs are outside it, so recording an architecture decision in `_devx/workstreams/<slug>/design.md` costs nothing against the 60KB budget that INTERVIEW Q#9 is already over.
