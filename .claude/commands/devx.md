---
name: 'devx'
description: 'Autonomous devx dev loop. Picks the next ready item from DEV.md (or a specified hash/slug), creates a worktree on develop/<type>-<hash>, implements via BMAD dev-story, self-reviews, runs local CI per devx.config.yaml, opens a PR to develop, and waits for remote CI. Respects the project mode (YOLO/BETA/PROD/LOCKDOWN) and trust-gradient autonomy. Use when the user says "devx this" or "/devx <hash|slug|next>".'
---

# /devx — Autonomous devx Dev Loop

> **v0 — bootstrap version.** Forked from `/dev` with path + checkbox updates so the closed loop is usable today, before the rest of the devx stack ships. Refined in Phase 1 (`plan/plan-b01000-...-single-agent-loop.md`) per the full DESIGN.md contract. ManageAgent + parallelism arrive in Phases 2–3.
>
> **Until ManageAgent ships, /devx still runs the full loop end-to-end — claim → implement → self-review → local CI → PR → merge → cleanup.** Specifically: `/devx-manage` references in this file are about cross-item orchestration (parallelism, prioritization, soak windows). They are NOT a license to leave PRs open for human review. In YOLO single-branch this skill merges its own PR on every successful run. The only things that stop a YOLO merge are a failing local-CI gate, a non-empty workflow that returned non-success, or trust-gradient N not yet reached. "Prior PRs were merged by a human" is a bug log, not a precedent — do not infer policy from it.

You are an autonomous development agent executing the full BMAD lifecycle for a **single item from DEV.md**: claim it, implement, self-review, run local gates, push, open a PR (or push direct in single-branch YOLO), wait for remote CI iff one is configured, **merge the PR yourself**, and cleanup. You operate in a dedicated worktree on a dedicated branch, never sharing a working tree with any other agent.

## Branch model resolution

Read `devx.config.yaml → git.*` once at the top of the run:

- **`integration_branch`**: the branch agents target. If set (typically `develop`), feature branches off it, PRs into it. If `null`, agents target `default_branch` (`main`); the develop/main split is disabled.
- **`branch_prefix`**: prepended to `<type>-<hash>` for the feature branch name. Defaults: `develop/` when split is enabled, `feat/` when single-branch.
- **`pr_strategy`**: one of `pr-to-develop` (default with split), `pr-to-main` (single-branch with PR), `direct-to-main` (single-branch, no PR — only allowed under YOLO; warn if used).

Throughout this doc, "the integration branch" means whichever branch the resolved config says agents target. References to "PR to `develop`" should be read as "PR to the integration branch" — substitute `main` mentally if `integration_branch: null`.

## Arguments

Parse from the user's message after `/devx`:

- **item**: one of:
  - a spec-file hash (`a3f2b9`),
  - a spec-file slug path (`dev/dev-a3f2b9-...md`),
  - the literal string `next` — picks the top `[ ]`/ready item from `DEV.md`,
  - if omitted, default to `next` (the no-args auto-pick from [DESIGN.md §`/devx` with no args = auto-pick](../../docs/DESIGN.md#devx-with-no-args--auto-pick)).
- **stop_after**: one of `this-item`, `n-items`, `until-blocked`, `all`. Default: `this-item`. When set to `n-items` or `all`, loop back and claim another ready item after each merge.
- **instructions**: extra instructions or constraints ("skip tests for now", "keep PR small", "use library X"). Logged into the spec file's status log.

## Core Principles

1. **Never duplicate business logic** — wrap existing endpoints, tools, and utilities.
2. **One commit per story / sub-task** — atomic, reviewable units.
3. **Fix forward** — if review finds issues, fix them in the same item; don't skip.
4. **Local CI must pass** before moving to the next item. Gates come from `devx.config.yaml`.
5. **Target the integration branch**. Every PR opens against `git.integration_branch` (typically `develop`); when `null`, against `default_branch` (`main`) with `pr-to-main` or `direct-to-main` per `git.pr_strategy`. Agents never push to a branch the user did not configure as a target. With the develop/main split enabled, promotion to `main` is `/devx-manage`'s responsibility, gated per [`MODES.md`](../../docs/MODES.md); with single-branch, the merge gate IS the promotion gate.
6. **Remote CI is ground truth IF configured.** When `.github/workflows/*.yml` exists and triggers on the feature branch, wait for GitHub Actions to complete and only proceed on success. When no workflow is configured (typical during early bootstrap), local CI from Phase 5 IS the gate — do NOT block waiting for phantom CI; do NOT defer to a human just because there's nothing on GitHub side to gate on.
7. **Respect the mode — and actually act on it. YOLO means YOLO: this skill merges its own PRs.**
   - `YOLO` — merge immediately on local-CI green (and on remote-CI green when CI is configured). No "leaving the PR for the user."
   - `BETA` — merge on CI green + no blocking reviewer comments.
   - `PROD` — merge on CI green + no blocking comments + coverage gate clear (focus-group pre-promotion is `/devx-manage`'s concern, not `/devx`'s).
   - `LOCKDOWN` — do not merge. Open PR, leave it awaiting user action, stop.
7. **Respect trust-gradient autonomy** — read `devx.config.yaml → promotion.autonomy.count`; the ladder's N is mode-derived. Until N reached, merge requires user approval (even if CI passes). After N, auto-merge per mode gate above. Note: this project starts at `initial_n: 0, count: 0` (full autonomy from commit 1) per its YOLO config — the trust gate does not apply here unless the user explicitly bumps it.
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
4. **Atomically claim** via `devx devx-helper claim <hash>` (dvx101). The helper drives the six-step claim — lock + DEV.md flip + spec frontmatter + status log + commit on the base branch + push to `origin/<base>` + worktree create — in fixed order with per-stage rollback. Stdout is JSON `{branch, lockPath, claimSha}`; exit codes encode the outcome:
   ```
   if ! CLAIM_JSON=$(devx devx-helper claim "$HASH"); then
     case $? in
       1) echo "lock held — another /devx is on this hash"; exit 1 ;;
       2) echo "rollback — see stderr"; exit 1 ;;
       *) echo "usage error"; exit 1 ;;
     esac
   fi
   ```
   On exit 0, parse `branch` + `lockPath` + `claimSha` from `$CLAIM_JSON` and proceed. On exit 2, the helper has already reverted the working tree (or, if the failure was post-push, surfaced the error and released the lock — operator manually retries `git worktree add` per the message).

   **Why the helper instead of inlining git commands?** The locked decision is "claim commit pushed to `origin/main` BEFORE any subsequent `gh pr create`" (closes `feedback_devx_push_claim_before_pr.md`). Inlining the order in the skill body has been the regression vector across all 25 Phase 0 stories; the CLI wrapper makes the order non-skippable. Same pattern as `devx merge-gate` (mrg102) and `devx plan-helper derive-branch` (pln101).

   Checkbox conventions per [DESIGN.md §Checkbox conventions](../../docs/DESIGN.md#checkbox-conventions): `[ ]` ready · `[/]` in-progress · `[-]` blocked · `[x]` done. Status field is the source of truth; the checkbox mirrors it.
5. **Enter the worktree**. The helper created `.worktrees/dev-<hash>` on the derived branch (`branch` field of the JSON result — same primitive as pln101's `deriveBranch`, single-branch projects produce `feat/dev-<hash>`). All subsequent edits happen there. Backlog-file updates still target the main worktree (use absolute paths).

   If `devx devx-helper claim` exited 2 with stage `worktree`, the claim itself succeeded (commit pushed; lock released) but worktree create failed — re-run `git worktree add .worktrees/dev-<hash> -b <branch> <base>` by hand, then resume from Phase 2.

### Phase 2: Create BMAD Story Context (if needed)

Phase 2 invokes `devx devx-helper should-create-story <hash>` (dvx102) to compute the conditional `bmad-create-story` decision. The helper reads `devx.config.yaml → project.shape` + `_internal.skip_create_story_canary` + spec AC count + story-file presence and emits a JSON decision:

```
{
  "hash": "<hash>",
  "canary": "off" | "active" | "default",
  "decision": { "invoke": boolean, "reason": "shape-not-empty-dream" | "story-file-exists" | "few-actionable-acs" | "project_shape=empty-dream + <N> ACs + no story file" },
  "effective": { "action": "invoke" | "skip" | "read-existing", "statusLog": "phase 2: canary=..., shouldCreateStory=... → bmad-create-story <SKIPPED|INVOKED> [...]" },
  "inputs": { "acCount": number, "hasStoryFile": boolean }
}
```

The canary states (`devx.config.yaml → _internal.skip_create_story_canary`):
- `"off"` (default after dvx102 ships) — helper decision is **logged but NOT honored**. v0 behavior preserved: read existing story if present, otherwise invoke `bmad-create-story`.
- `"active"` — helper decision **IS honored**. `effective.action == "skip"` short-circuits Phase 2 entirely (the spec ACs are the working artifact). `"invoke"` runs `bmad-create-story`. `"read-existing"` reads the existing story file.
- `"default"` — same as `"active"`; the flag is flag-deletable post-canary. /devx-learn (Phase 5+) flips `"active"`→`"default"` after one in-flight story green-runs the conditional path.

Steps:

1. Run `devx devx-helper should-create-story <hash>`. Parse JSON; capture `effective.action` and `effective.statusLog`.
   - On exit 2 (`{"error":"rollback","stage":...}`): the helper couldn't resolve the spec or load config — surface the stderr, mark spec `blocked`, and stop.
2. Append `effective.statusLog` to the spec file's status log (append-only, per CLAUDE.md "Working agreements"). The line shape is fixed by spec dvx102 AC #5: `phase 2: canary=<state>, shouldCreateStory=<reason> → bmad-create-story <SKIPPED|INVOKED> [(detail)]`.
3. Branch on `effective.action`:
   - `"skip"` — Skip the BMAD story entirely. Continue to Phase 3 with the spec ACs as the working artifact. (Reached only when `canary` is `"active"` or `"default"` AND the helper returned `invoke=false`.)
   - `"read-existing"` — Read `_bmad-output/implementation-artifacts/story-<hash>.md` (it exists). Continue to Phase 3.
   - `"invoke"` — Invoke the `bmad-create-story` skill. Pass:
     - the spec file contents,
     - the parent epic file (from `from:`),
     - the project's `CLAUDE.md`,
     - `devx.config.yaml → stack.layers` so the story respects declared layers.
     Use YOLO mode for BMAD — auto-select defaults at interactive halts. The spec file's acceptance criteria are the source of truth; the BMAD story is the working artifact.
4. Mark the item `ready-for-dev` in sprint-status.yaml.

> Why a CLI helper instead of inlining the decision in prose: the LEARN.md cross-epic pattern (`[high] [skill]` 25/25 silent skip across Phase 0) is structural — every Phase 0 spec had `bmad-create-story` skipped without an explicit recorded reason. Routing through `devx devx-helper should-create-story` makes the decision (and its inputs) recorded, testable, and canary-gated. Skill body never re-implements the rule.

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
   git push -u origin <branch-name>
   ```
   where `<branch-name>` is the worktree's branch (`<branch_prefix>dev-<hash>`).
2. **If `git.pr_strategy == direct-to-main`** (single-branch YOLO only): skip the PR; the push to a feature branch is followed by a fast-forward merge into `main` once Phase 8 gates clear. Otherwise:
   Phase 7 explicitly reads `.github/pull_request_template.md` (or falls back to the built-in canonical template baked into the CLI when the on-disk file is absent — older repos that predate prt101 or haven't run `/devx-init` upgrade since) by invoking the **`devx pr-body`** CLI (prt102). Never re-implement the substitution in the skill body — the CLI is the single source of truth. It substitutes the active mode + spec path + AC checklist (line-anchored to the canonical positions per locked decision #4 in `epic-pr-template.md` — placeholders inside code blocks must NOT substitute). Optional flags fill the free-text sections; omitted ones leave the placeholder visible AND emit `unresolved-placeholder: <name>` to stderr per locked decision #5.

   ```
   BODY=$(devx pr-body --spec dev/dev-<hash>-<ts>-<slug>.md \
     --summary "<1–3 bullets on what changed>" \
     --test-plan "<bulleted list of what local CI gates covered + any manual steps>" \
     --notes "<surprises, deviations, follow-ups>" \
     2> .devx-cache/pr-body.stderr)
   gh pr create --base $BASE --head <branch-name> --title "<commit subject>" --body "$BODY"
   ```

   - The first non-empty line of the rendered body is the `**Spec:**` line — load-bearing for the mobile companion app's PR card and for reviewers scanning github.com (epic-pr-template.md AC).
   - The `**Mode:**` line carries the active mode (`YOLO` / `BETA` / `PROD` / `LOCKDOWN`), uppercased — reviewers see at a glance which gate auto-merge is applying.
   - **Unresolved placeholders.** If `.devx-cache/pr-body.stderr` is non-empty after the CLI returns, append a status-log line per name to the spec file: `phase 7: pr body had unresolved placeholder <name>` (locked decision #5 — never silently render an empty section). The PR opens regardless; the audit trail is grep-able post-merge.
   - **Fallback.** When `.github/pull_request_template.md` is absent (older repo predating prt101 or `/devx-init` upgrade not yet run), the CLI falls back to the built-in canonical template — never blocks PR open on a missing file.
3. Append a status-log line with the PR URL.
4. **Remote CI: detect, then wait if it exists, otherwise proceed immediately.**

   First, probe whether a workflow has been wired up:
   ```
   gh run list --branch <branch-name> --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName
   ```

   - **No runs returned AND `.github/workflows/` is empty (or missing)** → there is no remote CI to wait for. Local CI from Phase 5 IS the gate. Append a status-log line `no remote CI workflow detected — local gates are authoritative` and proceed to Phase 8 immediately. Do NOT block on phantom CI; do NOT defer to a human.
   - **No runs returned but `.github/workflows/*.yml` exists** → CI was wired but didn't trigger (typical causes: workflow `on:` filters exclude this branch, or GitHub is slow to schedule). Wait up to 60s with one `ScheduleWakeup` retry; if still no run, file an `INTERVIEW.md` entry asking the user to confirm the workflow's `on:` filters cover `<branch-name>`, mark the PR `awaiting-approval`, and stop. Do NOT auto-merge in this state — silent CI is a config bug, not a green light.
   - **Runs returned** → verify `headSha == git rev-parse HEAD`. Poll until `status == "completed"` using `ScheduleWakeup` with 120s delays to stay cache-warm. Then evaluate `conclusion`.

5. If `conclusion == "success"` (or remote CI was absent per the bullet above): proceed to Phase 8.
6. If `conclusion != "success"`:
   - `gh run view <run-id> --log-failed`
   - Identify the failing check (lint? test? coverage? something local didn't catch?).
   - Fix the root cause in a new commit on the branch. Do NOT rewrite history.
   - Push the fix. Go back to step 4.
   - File a `debug/debug-*.md` spec + `DEBUG.md` entry describing the CI-only failure pattern (so `/devx-learn` can eventually add it to local gates).

### Phase 8: Auto-Merge (gate-driven) or Hand Off

**YOLO is fully autonomous — /devx merges its own PRs. Period.** No "leave it open for human review," no "prior PRs were merged manually so I'll follow that pattern." If the user wants to gate merges on human approval they bump out of YOLO. The only thing that stops a YOLO merge is the merge gate itself returning `merge:false`. Past PRs being merged by a human is irrelevant — that's an artifact of `/devx` not doing its job, not a project policy.

The mode/coverage/CI/review/trust-gradient logic that decides whether this PR is mergeable lives in **one place**: the `devx merge-gate` CLI, which wraps `mergeGateFor()` from mrg101. Skill body never re-implements mode logic. Run:

```
devx merge-gate <hash>
```

It emits a JSON decision to stdout and exits with one of three codes:

| Exit | Decision shape | What you do |
|---|---|---|
| `0` | `{"merge": true}` | Run the merge command below. |
| `1` | `{"merge": false, "reason": "...", "advice"?: [...]}` | Append `reason` to the spec status log; if `advice` includes `"file INTERVIEW for approval"`, write the INTERVIEW row and stop. Otherwise stop and let the underlying signal change (e.g., CI re-run, reviewer resolves comment, mode changes). |
| `2` | `{"merge": false, "reason": "no PR yet" | "gh signal collection failed"}` | Investigation: missing PR → re-check Phase 7 actually opened one; `gh` failure → check auth (`gh auth status`) and re-run. Never auto-merge on exit 2 — uncertainty defaults to safe. |

Pass `--coverage <pct>` (a value in `[0, 1]`) iff Phase 5's coverage runner produced one — under YOLO/BETA the gate ignores it; under PROD the gate uses it.

**Merge command (after `devx merge-gate <hash>` returned exit 0):**
```
gh pr merge <#> --squash --delete-branch
```
Then verify:
```
gh pr view <#> --json state,mergeCommit
```
Expect `state == "MERGED"` and a `mergeCommit.oid`. If not merged, surface the gh error verbatim and stop — do NOT silently leave the PR open.

> Implementation note: `--auto` alone requires "Allow auto-merge" in repo settings (not on for this repo); the direct `--squash --delete-branch` form is what works here.

After merge:
1. `git fetch origin --prune && git pull --ff-only` in the main worktree to bring the merge commit into local `main`.
2. Remove worktree: `git worktree remove .worktrees/dev-<hash>`.
3. Delete local branch: `git branch -D <branch-name>` (the `--delete-branch` flag on `gh pr merge` handles the remote).
4. Update the spec file: `status: done`, append status-log line `merged via PR #<n> (squash → <merge-sha-short>)`.
5. Update `DEV.md`: flip the checkbox `[/]` → `[x]`, append the PR URL inline in the format used by prior entries: `PR: https://github.com/.../pull/<n> (merged <merge-sha-short>)`. If the spec was abandoned/superseded, wrap the entry line in `~~…~~` instead.
6. Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: flip the matching `<hash>` story's `status:` from `ready-for-dev` to `done`.
7. Commit all of (4-6) on `main` with message `chore: mark <hash> done after PR #<n> merge` and push.
8. File gaps:
   - **Test gaps** observed during implementation → new `test/test-*.md` specs + `TEST.md` entries.
   - **Bugs discovered but out of scope** → new `debug/debug-*.md` specs + `DEBUG.md` entries.
9. If the item is part of an epic, check if the epic's other stories are all done; if so, log a promotion candidate in `PLAN.md`.

### Phase 9: Next Item or Finish

- If `stop_after == this-item`: proceed to Finalization.
- If `stop_after == n-items` with remaining count: go to Phase 1 with the next ready item. Decrement the counter.
- If `stop_after == until-blocked`: repeat until no ready items exist OR the next item is blocked OR capacity/usage is hit.
- If `stop_after == all`: repeat until no `ready` items remain in `DEV.md`.
- If you halt early for any reason (context budget, quality risk, blocker, usage pressure, mode change): emit the **Handoff Snippet** below and stop.

## Handoff Snippet (when stopping before the run completes)

Emit when stopping short — `stop_after` reached mid-loop, user asked to halt, or you decided to stop for context/quality reasons. Purpose: let the user `/clear` and re-invoke `/devx` in a fresh conversation without rediscovery.

Rules:
- Only emit when stopping early. Full-run completion (all targeted items merged, no pending work) skips the snippet.
- Unpushed commits are part of the handoff — the next agent pushes them as part of its flow.
- Be concrete. Every fact a fresh agent would grep for belongs here.

Format exactly like this (inside a fenced ```text``` block):

````text
/devx <hash|slug|next>

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

Do NOT promote `develop → main`. That's `/devx-manage`'s job, gated by the promotion rules in [`MODES.md`](../../docs/MODES.md).

## Key References

- **DESIGN.md § Branching model** — `develop`/`main` split, feature-branch naming, worktree rules.
- **MODES.md** — mode-derived gate behavior for auto-merge, coverage threshold, and PR discipline.
- **SELF_HEALING.md** — every status-log line, every CI failure, every fix-forward commit is a signal LearnAgent reads.
- **QA.md** — scripted tests run in this loop; exploratory QA is `/devx-test`'s domain, not `/devx`'s.
- **`devx.config.yaml`** — `stack` / `projects` (what to lint/test/cover), `mode`, `promotion.autonomy.count`, `branch.develop` (default: `develop`), `branch.main` (default: `main`).
- **BMAD skills** — `bmad-create-story`, `bmad-dev-story`, `bmad-code-review`.

## Pairs with

- **/devx-plan** — produces the artifacts this command consumes. Contract stability matters.
- **/devx-manage** — decides when parallel `/devx` agents should run, handles `develop → main` promotion, rebalances `DEV.md` priorities. Not invoked from here.
