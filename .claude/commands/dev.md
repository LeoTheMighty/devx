---
name: 'dev'
description: 'Autonomous devx dev loop. Picks the next ready item from DEV.md (or a specified hash/slug), creates a worktree on develop/<type>-<hash>, implements via BMAD dev-story, self-reviews, runs local CI per devx.config.yaml, opens a PR to develop, and waits for remote CI. Respects the project mode (YOLO/BETA/PROD/LOCKDOWN) and trust-gradient autonomy. Use when the user says "dev this" or "/dev <hash|slug|next>".'
---

# /dev — Autonomous devx Dev Loop

You are an autonomous development agent executing the full BMAD lifecycle for a **single item from DEV.md**: claim it, implement, self-review, run local gates, push, open a PR to `develop`, and wait for remote CI. You operate in a dedicated worktree on a dedicated branch, never on `main`, never sharing a working tree with any other agent.

## Arguments

Parse from the user's message after `/dev`:

- **item**: one of:
  - a spec-file hash (`a3f2b9`),
  - a spec-file slug path (`dev/dev-a3f2b9-...md`),
  - the literal string `next` — picks the top `ready` item from `DEV.md`,
  - if omitted, default to `next`.
- **stop_after**: one of `this-item`, `n-items`, `until-blocked`, `all`. Default: `this-item`. When set to `n-items` or `all`, loop back and claim another ready item after each merge.
- **instructions**: extra instructions or constraints ("skip tests for now", "keep PR small", "use library X"). Logged into the spec file's status log.

## Core Principles

1. **Never duplicate business logic** — wrap existing endpoints, tools, and utilities.
2. **One commit per story / sub-task** — atomic, reviewable units.
3. **Fix forward** — if review finds issues, fix them in the same item; don't skip.
4. **Local CI must pass** before moving to the next item. Gates come from `devx.config.yaml`.
5. **Target `develop`**, never `main`. Every PR opens against `develop`. Promotion to `main` is `/dev-triage`'s responsibility, gated per [`MODES.md`](../../MODES.md).
6. **Remote CI is ground truth** — local passes are necessary but not sufficient. Wait for GitHub Actions after push.
7. **Respect the mode**:
   - `YOLO` — auto-merge to `develop` on CI green.
   - `BETA` — auto-merge on CI green + no blocking reviewer comments.
   - `PROD` — auto-merge on CI green + no blocking comments + coverage gate clear (focus-group pre-promotion is `/dev-triage`'s concern, not `/dev`'s).
   - `LOCKDOWN` — do not auto-merge. Open PR, leave it awaiting user action, stop.
7. **Respect trust-gradient autonomy** — read `devx.config.yaml → promotion.autonomy.count`; the ladder's N is mode-derived. Until N reached, merge requires user approval (even if CI passes). After N, auto-merge per mode gate above.
8. **Status log is append-only** — every phase transition appends a line to the spec file's status log. Never rewrite log lines.
9. **File out-of-scope work** — when implementing reveals test gaps, file `test/test-*.md` specs and append to `TEST.md`. When it reveals bugs, file `debug/debug-*.md` specs and append to `DEBUG.md`. Don't expand the current item's scope.

## Execution Loop

Repeat per item, respecting `stop_after`:

### Phase 1: Claim and Prepare

1. **Resolve the item**:
   - If `item` is a hash → look up the matching `dev/dev-<hash>-*.md` spec file.
   - If `item` is a path → read that spec file.
   - If `item` is `next` → pick the top entry in `DEV.md` whose status is `ready` and has no unresolved blockers (blockers listed under `blocked-by:` frontmatter).
   - If no runnable item exists → report and stop.
2. **Read the spec file** — frontmatter + goal + ACs + status log.
3. **Read cross-references** — `from:` (parent plan/epic), `blocked-by:`, `spawned:`.
4. **Mark the item `in-progress`** — append to DEV.md entry, update the spec file's frontmatter `status` and `owner`, append a status-log line:
   ```
   [YYYY-MM-DDTHH:MM] claimed by /dev in session <session-id>
   ```
5. **Create the worktree + branch**:
   ```
   git worktree add .worktrees/dev-<hash> -b develop/dev-<hash> develop
   ```
   If a worktree already exists at that path (previous run), `cd` into it after verifying the branch head. Don't delete it.
6. **Enter the worktree**. All subsequent edits happen there. Backlog-file updates still target the main worktree (use absolute paths).

### Phase 2: Create BMAD Story Context (if needed)

1. Check if a BMAD story file already exists at `_bmad-output/implementation-artifacts/story-<hash>.md`. If yes, read it and skip to Phase 3.
2. Otherwise invoke the `bmad-create-story` skill. Pass:
   - the spec file contents,
   - the parent epic file (from `from:`),
   - the project's `CLAUDE.md`,
   - `devx.config.yaml → stack.layers` so the story respects declared layers.
3. Use YOLO mode for BMAD — auto-select defaults at interactive halts. The spec file's acceptance criteria are the source of truth; the BMAD story is the working artifact.
4. Mark the item `ready-for-dev` in sprint-status.yaml.

### Phase 3: Implement

1. Invoke the `bmad-dev-story` skill. Pass the BMAD story path, the spec file path, and `devx.config.yaml` context (so language/framework choices are consistent).
2. Execute ALL tasks and subtasks. Do NOT stop at milestones or session boundaries.
3. Follow red-green-refactor: write failing tests → implement → refactor.
4. Update the story file's File List with every file created/modified/deleted.
5. Mark the story `review` when all ACs are satisfied.
6. Append a status-log line to the spec file.

### Phase 4: Self-Review (Adversarial)

1. Invoke the `bmad-code-review` skill against the story's changes.
2. Review is **adversarial** — find 3–10 specific issues minimum. A review that finds zero issues is a failed review; re-run with stricter framing.
3. For ALL findings (HIGH, MEDIUM, LOW): **fix them automatically** — do NOT ask the user or create action items.
4. After fixing, re-run the review to verify fixes are clean.
5. Mark the story `done` in sprint-status.yaml.
6. Append a status-log line to the spec file.

### Phase 5: Local CI Validation

Gates come from `devx.config.yaml`. Two supported shapes:

**Single-project:**
```yaml
stack:
  layers: [frontend, backend]
  lint: <command>
  test: <command>
  coverage: <command that emits a coverage report>
  pre_push: <optional custom check>
```

**Monorepo:**
```yaml
projects:
  - name: api
    path: services/api
    lint: <command>
    test: <command>
    coverage: <command>
  - name: app
    path: apps/flutter
    lint: <command>
    test: <command>
```

Steps:

1. Compute the touched surface: `git diff --name-only develop..HEAD`.
2. Determine which projects/layers are affected — for monorepo configs, intersect touched paths with each project's `path`. Single-project configs always run everything.
3. For each affected project/layer, run in order:
   - `lint`
   - `test`
   - `coverage` (if defined)
   - `pre_push` (if defined)
4. **Coverage gate** (mode-derived):
   - YOLO — informational only; never blocks.
   - BETA — warn if touched-surface coverage < 80%.
   - PROD — block if touched-surface coverage < 100% (line-level diff of changed files against coverage report; `# devx:no-coverage <reason>` opts out a line).
   - LOCKDOWN — block if < 100% OR if a browser-QA pass hasn't run.
5. If any gate fails:
   - Read the error output carefully.
   - Fix the root cause (don't paper over).
   - Re-run until green.
6. Do NOT proceed to commit until every required gate passes for the touched surface.

If the config is missing required gate commands, append an item to `INTERVIEW.md` asking the user to supply them, mark the spec `blocked`, and stop.

### Phase 6: Commit

1. Stage only files relevant to this item — use `git add <specific files>`, never `git add -A`.
2. Commit with message:
   ```
   <type>: <spec-hash> — <spec title>

   <1-2 sentence summary of what was built>

   Spec: dev/dev-<hash>-<ts>-<slug>.md
   Story: _bmad-output/implementation-artifacts/story-<hash>.md
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
   Where `<type>` is the conventional-commit prefix inferred from the spec (`feat`, `fix`, `refactor`, etc.); default `feat` if unclear.
3. **One commit per story / logical sub-task.** If the item was split into multiple logical commits, keep them atomic — don't bundle unrelated changes.
4. Do NOT push yet — continue to Phase 7.

### Phase 7: Push, PR, Remote CI

1. Push the branch:
   ```
   git push -u origin develop/dev-<hash>
   ```
2. Open a PR targeting `develop`:
   ```
   gh pr create --base develop --head develop/dev-<hash> --title "<commit subject>" --body "$(cat <<'EOF'
   ## Spec
   `dev/dev-<hash>-<ts>-<slug>.md`

   ## Summary
   <1-3 bullets on what changed>

   ## Acceptance criteria
   <checkbox list from the spec>

   ## Test plan
   <bulleted list of what the local CI gates covered>

   ## Mode
   <current mode from devx.config.yaml>
   EOF
   )"
   ```
3. Append a status-log line with the PR URL.
4. **Wait for remote CI.** Never declare the item done before CI turns green. Use `ScheduleWakeup` with 120s delays to stay cache-warm; run:
   ```
   gh run list --branch develop/dev-<hash> --limit 1 --json databaseId,status,conclusion,url,headSha
   ```
   Verify `headSha == git rev-parse HEAD`. Poll until `status == "completed"`.
5. If `conclusion == "success"`: proceed to Phase 8.
6. If `conclusion != "success"`:
   - `gh run view <run-id> --log-failed`
   - Identify the failing check (lint? test? coverage? something local didn't catch?).
   - Fix the root cause in a new commit on the branch. Do NOT rewrite history.
   - Push the fix. Go back to step 4.
   - File a `debug/debug-*.md` spec + `DEBUG.md` entry describing the CI-only failure pattern (so `/dev-learn` can eventually add it to local gates).

### Phase 8: Auto-Merge (mode-gated) or Hand Off

Behavior by mode:

| Mode | If CI green and trust-gradient N reached |
|---|---|
| YOLO | `gh pr merge --auto --squash` — don't wait if mergeable blocks remain; let `--auto` handle it. |
| BETA | Merge if no reviewer blocking comments; otherwise wait. |
| PROD | Merge if coverage gate clear; otherwise wait. |
| LOCKDOWN | Do NOT merge. Leave PR open. Append to `MANUAL.md`: "PR <#> awaiting lockdown-resume before merge." |

If trust-gradient N has NOT been reached (promotion count < threshold from `devx.config.yaml → promotion.autonomy.count`):
- Append to `INTERVIEW.md`: "Approve merge of PR <#>? (`y` / `n` / `hold`)".
- Leave PR open; do NOT merge.

After merge (or after punting to manual):
1. Remove worktree: `git worktree remove .worktrees/dev-<hash>`.
2. Delete local branch (remote will be deleted by `--delete-branch` flag on merge, or `gh api -X DELETE`).
3. Update the spec file: `status: done` (or `awaiting-approval`), append status-log line.
4. Update `DEV.md`: check the entry and note the PR URL.
5. File gaps:
   - **Test gaps** observed during implementation → new `test/test-*.md` specs + `TEST.md` entries.
   - **Bugs discovered but out of scope** → new `debug/debug-*.md` specs + `DEBUG.md` entries.
6. If the item is part of an epic, check if the epic's other stories are all done; if so, log a promotion candidate in `PLAN.md`.

### Phase 9: Next Item or Finish

- If `stop_after == this-item`: proceed to Finalization.
- If `stop_after == n-items` with remaining count: go to Phase 1 with the next ready item. Decrement the counter.
- If `stop_after == until-blocked`: repeat until no ready items exist OR the next item is blocked OR capacity/usage is hit.
- If `stop_after == all`: repeat until no `ready` items remain in `DEV.md`.
- If you halt early for any reason (context budget, quality risk, blocker, usage pressure, mode change): emit the **Handoff Snippet** below and stop.

## Handoff Snippet (when stopping before the run completes)

Emit when stopping short — `stop_after` reached mid-loop, user asked to halt, or you decided to stop for context/quality reasons. Purpose: let the user `/clear` and re-invoke `/dev` in a fresh conversation without rediscovery.

Rules:
- Only emit when stopping early. Full-run completion (all targeted items merged, no pending work) skips the snippet.
- Unpushed commits are part of the handoff — the next agent pushes them as part of its flow.
- Be concrete. Every fact a fresh agent would grep for belongs here.

Format exactly like this (inside a fenced ```text``` block):

````text
/dev <hash|slug|next>

RESUMING from prior session. Do not redo work below.

## Already done (do not rerun)
- <hash>: <one-line summary> — PR #<n>, merged
- <hash>: <one-line summary> — PR #<n>, awaiting CI

## Next up (in order)
- <hash>: <one-line from spec file title>
- <hash>: ...

## State to trust
- Current branch on main repo: <branch>
- Worktrees active: <list or "none">
- DEV.md entries `in-progress`: <list>
- Mode: <current mode>
- Trust-gradient count: <N>/<threshold>

## Gotchas from prior session (save time — don't rediscover)
- <concrete fact the next agent would waste context relearning>
- <parallel-agent / untracked-WIP collision note, if any>
- <framework/version quirk that bit us>
- <any API/endpoint decision that deviated from the spec and why>

## Do NOT
- Re-create spec files that already exist under `dev/`.
- Re-run migrations / re-stage commits already in `git log origin/develop..HEAD`.
- Touch files outside the current item's scope.

Continue from <next hash or slug>.
````

Fill every placeholder. Gotchas are the highest-value part — put anything that cost more than a minute to figure out.

After emitting the snippet, say one sentence summarizing why you stopped and stop. Do not keep working.

## Finalization (after stop_after satisfied)

1. **Verify no worktrees left hanging** — `git worktree list`; remove any owned by this run that aren't wanted.
2. **Summary** output:
   - Items completed (with commit SHAs, PR numbers, merge status).
   - Files changed (total count).
   - Local gate pass summary (lint / test / coverage per touched project).
   - Remote CI conclusion per PR.
   - Any `test/*` or `debug/*` specs filed during this run.
   - Any `INTERVIEW.md` entries still awaiting user input.
   - Current trust-gradient count and N threshold.

Do NOT promote `develop → main`. That's `/dev-triage`'s job, gated by the promotion rules in [`MODES.md`](../../MODES.md).

## Key References

- **DESIGN.md § Branching model** — `develop`/`main` split, feature-branch naming, worktree rules.
- **MODES.md** — mode-derived gate behavior for auto-merge, coverage threshold, and PR discipline.
- **SELF_HEALING.md** — every status-log line, every CI failure, every fix-forward commit is a signal LearnAgent reads.
- **QA.md** — scripted tests run in this loop; exploratory QA is `/dev-test`'s domain, not `/dev`'s.
- **`devx.config.yaml`** — `stack` / `projects` (what to lint/test/cover), `mode`, `promotion.autonomy.count`, `branch.develop` (default: `develop`), `branch.main` (default: `main`).
- **BMAD skills** — `bmad-create-story`, `bmad-dev-story`, `bmad-code-review`.

## Pairs with

- **/dev-plan** — produces the artifacts this command consumes. Contract stability matters.
- **/dev-triage** — decides when parallel `/dev` agents should run, handles `develop → main` promotion, rebalances `DEV.md` priorities. Not invoked from here.
