---
hash: sgr105
type: dev
created: 2026-08-02T13:57:00-06:00
title: "mark-done helper + Phase-8 rewrite (merge-cleanup mechanical host)"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 5
status: done
owner: /devx-2026-08-05T1356-3064
blocked_by: [sgr104]
branch: feat/dev-sgr105
---

## Goal

Merge-cleanup's first mechanical host (FR-4's third flow): `devx
devx-helper mark-done`, plus the Phase-8 skill-prose rewrite that invokes
it. E-5 goes green here. Closes the `git add -A` cleanup-commit class
structurally (the 2026-07-29 erratum `ba3c65b`). Plan phase 5 of
workstream story-graph — read
`_devx/workstreams/story-graph/plan.md` §Phase 5; the RED artifact
`evals/E-5_loop-freshness.ts` defines the three-flow contract and must
flip green.

## Acceptance criteria

- [ ] AC 1: `src/lib/devx/mark-done.ts` (new) — fat lib (thin-command/
      fat-lib pattern, mirroring claim): under `withBacklogLock`
      (mutate.ts:82), spec `status: done` flip + status-log append; DEV.md
      `[/]→[x]` flip + PR URL append (extend `flipDevMdRow` (claim.ts:354)
      or a sibling — today it only does `[ ]→[/]` and throws otherwise);
      in-process todo sync via `runTodoSync` (src/commands/todo.ts:55)
      when the item has a workstream; GRAPH.md regen via `regenerateGraph`
      (warn-and-continue) (T5.1).
- [ ] AC 2: `src/commands/devx-helper.ts` — `mark-done <hash> --pr <n>
      --merge-sha <sha>` (fifth subcommand; registration pattern at :645);
      stdout JSON `{hash, paths, todoSynced}`; exit 0 / 1 (state mismatch)
      / 2 (resolution) (T5.2).
- [ ] AC 3: `.claude/commands/devx.md` Phase 8 after-merge steps 4–7
      rewritten to invoke `mark-done` + commit its `paths` by explicit
      pathspec; `skills/devx.md` via `npm run sync:skills`;
      skill-discipline tests updated where the Phase-8 contract grew
      (T5.3).
- [ ] AC 4: E-5 re-run RED first, then green: claim, cleanup
      (`mark-done`), and emission each leave `devx graph --check` exiting
      0 with no manual regen between (T5.4).
- [ ] AC 5: `test/devx-helper-mark-done.test.ts` (new): happy path,
      state-mismatch exit 1, lock contention, workstream-less skip of todo
      sync, regen-failure warn-and-continue. `npm run sync:skills --
      --check` green; full suite + typecheck green.

## Technical notes

- Severability (recorded cut line): FR-4's minimum is regen having a
  mechanical host on the cleanup flow; the bookkeeping mechanization is
  justified by the `git add -A` incident class and is severable if this
  phase runs long.
- `mark-done` is write-only in v1: the skill keeps owning commit + push
  (symmetric with owning the merge). Revisit is a recorded non-blocking
  question in design.md.

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage (workstream 62bcd1).
- 2026-08-05T11:13:48-06:00 — claimed by /devx in session /devx-2026-08-05T1113-94741
- 2026-08-05T11:20 — phase 2: spec ACs direct (v2 native); 5 ACs; workstream=story-graph; red-artifacts=E-5_loop-freshness.ts (tests-first). First E-5 run REDded with `devx graph` exit -1 and empty stdout/stderr — an infra failure, not the feature (the graph CLI shipped at sgr103), so per the Phase 2 honest-RED rule it was re-run rather than coded against; the second run gave the real RED, `unknown command 'mark-done'`. No eval-infra fix was needed — the first run was a transient under concurrent `npm run build`.
- 2026-08-05T11:40 — phase 3: implemented T5.1–T5.4. New `src/lib/devx/mark-done.ts` (fat lib: `flipBacklogRowDone` + `updateSpecForDone` + `markDone` driver, all under `withBacklogLock` with claim.ts's tmp+rename batch and restore-on-failure). New `src/lib/devx/status-log.ts` — the append-only splice extracted from `updateSpecForClaim` so claim and mark-done share one implementation. `devx devx-helper mark-done <hash> --pr <n> --merge-sha <sha> [--type]` in `src/commands/devx-helper.ts`. Phase 8 after-merge rewritten from four hand-edits (steps 4–7) to one call returning the pathspecs to stage, list renumbered 1–7; `npm run sync:skills`. Exported `escapeRegex`/`relativeFromRepo`/`formatIsoLocal`/`BACKLOG_BY_TYPE`/`realExec` from claim.ts and `PROJECT_FILENAME` from config-io.ts rather than re-deriving any of them.
- 2026-08-05T12:00 — phase 4: single-session 3-lens adversarial review (Blind Hunter + Edge Case + Acceptance Auditor applied sequentially rather than as parallel subagents — this session was directed not to spawn agents; substantial surface, ~800 lines). 7 findings, ALL fixed in-place, plus 1 test-harness defect the fixes exposed. Most load-bearing: commander's `.requiredOption` enforces itself and exits **1** BEFORE the action runs, and exit 1 is this subcommand's "state mismatch" signal — a forgotten `--pr` would have read to the skill body as a claimed-item mismatch; switched to hand-parsed required flags → 64. Second: `mark-done` run from inside a worktree would flip that worktree's DEV.md/spec on a branch Phase 8 then deletes (silent no-op) — added a guard, and re-review caught that my first version hand-rolled the `git-dir != common-dir` compare when `claimSpec` already uses mlc101's `interpretRevParse`; swapped to the shared primitive (the hand-rolled one also missed the submodule/separate-git-dir case that module documents as an adversarial-review HIGH). Also: a gitignored GRAPH.md returned in `paths` would break the caller's whole `git add` (now probed via `check-ignore`, warn-and-continue); the PR-suffix idempotence guard matched the bare string `PR: `, so a row titled "Fix PR: body rendering" silently lost its merge link (now anchored on the suffix shape); `--merge-sha` typos exited 2 instead of 64; `defaultTodoSync` rebuilt the config path from a literal (now `PROJECT_FILENAME`). Harness defect: the test exec stub returned exit 0 for every git command, which the new ignore-probe correctly read as "board is gitignored" — stub now dispatches per command. Re-review clean. Filed `debug-8a9586` (loop merge tail has no regen host — FR-4 satisfied only on the attended path; out of scope, and its differing semantics make it a design question).
- 2026-08-05T12:57 — phase 5: full gate = 24 failed / 3119 passed (135 files, 1772s). `npm test` exited **0** despite the red — the summary line, not the exit code, is what caught it (`feedback_never_kill_the_gate.md`). Failures are all in `loop-worker` + `manage-crash-restart-loop` and are NOT this story: bisected to a detached worktree at `70151a7` (the branch point, no `mark-done.ts` present) where the same two files fail 16/28 vs this branch's 18/28 — same signatures, with and without the code. Two false leads corrected on the way: "load flake" (18 of 24 reproduce with the files run alone) and "missing node_modules" (both files spawn `process.execPath` with inline `-e` scripts, no resolution involved) — though the first baseline attempt did die that way, because a worktree under `/tmp` has no `node_modules` in any parent while one under the repo resolves via the main checkout. Filed `debug-620337` with the bisect table. Touched surface re-verified green: 12 files / 239 tests, including `devx-claim.test.ts` (43) which is what proves the status-log extraction behaviour-preserving. E-5 driven RED → **GREEN**; `npm run sync:skills -- --check` green; typecheck + build clean. QA walkthrough `test/test-8b9165-…` emitted with all 4 machine checks executed inline, 2 human checks outstanding.
- 2026-08-05T13:50 — phase 7: PR #118 opened (https://github.com/LeoTheMighty/devx/pull/118). `devx devx-helper await-remote-ci feat/dev-sgr105 --once` returned `{"state":"empty"}` on 41 consecutive probes over ~50min; `gh pr checks 118` reports no checks and `gh run list --branch feat/dev-sgr105` is empty. The workflow's `on: pull_request: branches:[main]` matches this PR, and peers `feat/dev-sgr106` + `feat/dev-28b267` got runs within minutes across the same window — so Actions works and the filter looks right; cause unproven. Per Phase 7's workflow-no-run rule: INTERVIEW Q#16 filed, PR left open, NOT merged. `devx merge-gate sgr105` does return `{"merge":true}`, but the gate cannot tell "CI green" from "CI never ran" — which is precisely why Phase 7 gates entry to Phase 8. With the local full gate also red for pre-existing reasons (`debug-620337`), there is no green signal from either side; only the targeted 12-file/239-test surface subset, E-5 green, typecheck, build and `sync:skills --check`. phase 7: workflow-no-run after retry — INTERVIEW filed.
- 2026-08-05T13:49-06:00 — orphaned claim released (owner session's pid 94741 dead; stale lock removed with user authorization); flipped back to ready for re-claim
- 2026-08-05T13:56:09-06:00 — claimed by /devx in session /devx-2026-08-05T1356-3064
- 2026-08-05T14:07 — phase 7 (resume): silent-CI root cause proven — PR #118 was `CONFLICTING` (`mergeStateStatus: DIRTY`); GitHub builds no merge ref for a conflicted PR so `pull_request` workflows never fire. Main moved under the branch when #119 + #120 merged. Merged `origin/main` into `feat/dev-sgr105`; resolved 3 append-append conflicts (DEBUG.md, TEST.md, this status log) as chronological unions. Q#16 resolved in-branch; `debug-c94f14` filed (probe should surface `pr-conflicting` as a distinct state). Pushing to trigger the real CI run.
- 2026-08-05T14:05:13-06:00 — merged via PR #118 (squash → 4928dd9)
