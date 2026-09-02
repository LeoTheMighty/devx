---
hash: dlr106
type: dev
created: 2026-09-02T09:14:00-06:00
title: "devx layout migrate"
status: in-progress
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
plan: _devx/workstreams/docs-layout-resolution
phase: 6
blocked_by: [dlr105]
branch: feat/dev-dlr106
owner: /devx-2026-09-02T1351-62720
---
## Goal

The migration surface, and the only phase that writes to a user's repo. A
pure planner produces a `MovePlan` the command either renders (`--dry-run`) or
executes — so non-destructive dry-run is a property of the SHAPE, not of care.
Plan phase 6 of workstream docs-layout-resolution.

## Acceptance criteria

- [ ] AC 1: `planLayoutMigration(fs, repoRoot, engine, target) -> MovePlan` in
      `src/lib/layout/migrate.ts` is PURE, alongside the executor and the
      `Move` / `MovePlan` / `Refusal` types.
- [ ] AC 2: On a fixture reproducing ClassyLights `b7e38f` (`stage: plan`,
      `prd_validated: true`, `design_verified: true`,
      `gate_verdicts: {prd: PASS, design: PASS}`, 8 files on disk): 8 of 8
      land at their section-15-table counterparts with git rename detection
      intact; `gate_status` and `gate_verdicts` diff EMPTY; `devx gate
      coverage <hash>` subsequently runs to a verdict on the migrated tree.
- [ ] AC 3: ONLY the plan spec's `workstream:` field is rewritten. `stage:`,
      `gate_status:` and `gate_verdicts:` live in the spec, not the tree, so
      passed gates survive BY CONSTRUCTION rather than by careful copying.
- [ ] AC 4: Execution order is moves -> spec frontmatter -> config, and
      config-last is right because the clean-tree precondition makes every
      `git mv` revertible with one `git checkout -- .` — a config write first
      would dirty the tree and destroy exactly that recovery. (The PRD's
      stated rationale for config-last is backwards and is corrected here:
      BOTH orderings mismatch on interruption; the mismatch is made DETECTABLE
      by phase 3's `layout-tree-mismatch` finding.) The config step is
      `setLeaf(["engine","docs_layout"], target, "project", { projectPath })`,
      an existing comment-preserving scalar writer.
- [ ] AC 5: 3 of 3 refusal conditions — 2 or more live workstreams
      (`stage !== "done" && stage !== "retired"` over a `plan/` walk, the plan
      spec's `stage:`, never a directory listing); a doc set already at the
      destination (the local `lay101`-signature predicate); a dirty working
      tree (porcelain parse with `-uall` and `core.quotePath=false` +
      `dequoteGitPath`, both sides of a rename recorded) — are computed as a
      PURE predicate over repo state BEFORE any move, exit non-zero with 0
      files moved and `git status` byte-identical before and after. There is
      NO `--force`: every refusal names a state where moving loses
      information.
- [ ] AC 6: `--dry-run` moves 0 files in the SUCCESS case too and renders the
      moves it would make. Exit codes follow the house convention: 0 success,
      1 refusal, 2 context/config failure. A non-git directory is a refusal,
      not an `fs.rename` fallback.
- [ ] AC 7: Moves run through `io.exec("git", ["mv", "--", from, to],
      { cwd: repoRoot })` on the synchronous `Exec` seam, checking `exitCode`
      per call, adopting the `--` separator and `git-tx.ts`'s
      argv-flag-smuggling posture since pathspecs are built from disk state.
      This is the FIRST `git mv` in the repo — the three existing occurrences
      are strings in advice text.
- [ ] AC 8: Human-only outline files ARE moved. The PreToolUse guard denies AGENT
      writes; the CLI is not an agent, and `devx outline check` sees a rename,
      not new human content. A migration that moved everything except those
      would break the tree in the one place the human cares most about.
- [ ] AC 9: `devx layout migrate --to <layout> [--dry-run]` is registered in
      `src/cli.ts` on the `outline`/`workstream` house pattern (`register()`
      runs no logic, `.action()` calls a `runX()` returning a number,
      `attachPhase(sub, N)` last).
- [ ] AC 10: `evals/E-6_migrate.ts` and `evals/E-7_migrate-refusals.ts` flip
      GREEN; `test/engine-layout-migrate.test.ts` and
      `test/engine-layout-migrate-refusals.test.ts` exist, pass, and are
      registered in `SYNC_BLOCKING_TESTS`; `npm test` green.
- [ ] AC 11: `MANUAL.md` MV-a494be.1 is filed — the ClassyLights `b7e38f` run
      that is G-3's real evidence: commit or stash to clean the tree ->
      `devx layout migrate --to project-level --dry-run` and read the moves ->
      run it -> confirm `gate_status`/`gate_verdicts` diff empty ->
      `devx gate coverage b7e38f` runs to a verdict. It is cross-repo and
      irreversible (R-5), so it cannot land inside a devx PR. THE PHASE IS NOT
      DONE until the item is filed and the run's verdict is recorded in
      `decisions/`.

## Technical notes

Plan: `plan/agent.md` section "6. Phase".

**R-5 — THIS PHASE IS NOT REVERT-SAFE** for a repo that ran the migration.
`devx layout migrate` performs `git mv` plus a config write in a USER's repo;
reverting the devx PR does not un-migrate ClassyLights. Recovery DURING the
run is one `git checkout -- .`, bought by the clean-tree precondition and by
writing config last; afterwards, rollback is a second migration in the
opposite direction. `--dry-run` is the real mitigation. Do not describe this
phase as revert-safe.

Parallel-safe with phase 7 in file terms.

## Status log

- 2026-09-02T09:14 — emitted by /devx-plan (RED gate PASS; workstream
  docs-layout-resolution, plan phase 6).
- 2026-09-02T13:51:44-06:00 — claimed by /devx in session /devx-2026-09-02T1351-62720
