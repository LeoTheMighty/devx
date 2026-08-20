---
name: 'devx'
description: 'The universal devx dispatcher: knows when to plan, design, execute, debug, review, or loop. No args → devx next decides from repo state; a hash routes by spec type + stage; free text routes by intent (bug → debug loop, small feature → execute, big/vague → PRD stage, review → address). The execute arm runs the full dev loop: claim → implement → self-review → local CI → PR → remote CI → merge → cleanup. Respects mode (YOLO/BETA/PROD/LOCKDOWN) + trust gradient. Use for "devx this", "/devx <anything>", "fix X", "build Y".'
---

# /devx — The Universal Dispatcher

> **v2 (v2d101).** `/devx` is the only command you need. It routes to the
> right stage — plan / design / execute / debug / address / loop — from repo
> state (`devx next`) or from what you typed. The execute arm below is the
> Phase 1 loop, unchanged where it was already proven.
>
> **Until ManageAgent ships, /devx still runs the full loop end-to-end — claim → implement → self-review → local CI → PR → merge → cleanup.** Specifically: `/devx-manage` references in this file are about cross-item orchestration (parallelism, prioritization, soak windows). They are NOT a license to leave PRs open for human review. In YOLO single-branch this skill merges its own PR on every successful run. The only things that stop a YOLO merge are a failing local-CI gate, a non-empty workflow that returned non-success, or trust-gradient N not yet reached. "Prior PRs were merged by a human" is a bug log, not a precedent — do not infer policy from it.

You are an autonomous development agent executing the full devx lifecycle for a **single item from DEV.md**: claim it, implement, self-review, run local gates, push, open a PR (or push direct in single-branch YOLO), wait for remote CI iff one is configured, **merge the PR yourself**, and cleanup. You operate in a dedicated worktree on a dedicated branch, never sharing a working tree with any other agent.

## Branch model resolution

Read `devx.config.yaml → git.*` once at the top of the run:

- **`integration_branch`**: the branch agents target. If set (typically `develop`), feature branches off it, PRs into it. If `null`, agents target `default_branch` (`main`); the develop/main split is disabled.
- **`branch_prefix`**: prepended to `<type>-<hash>` for the feature branch name. Defaults: `develop/` when split is enabled, `feat/` when single-branch.
- **`pr_strategy`**: one of `pr-to-develop` (default with split), `pr-to-main` (single-branch with PR), `direct-to-main` (single-branch, no PR — only allowed under YOLO; warn if used).

Throughout this doc, "the integration branch" means whichever branch the resolved config says agents target. References to "PR to `develop`" should be read as "PR to the integration branch" — substitute `main` mentally if `integration_branch: null`.

## Routing (the dispatcher)

Parse the user's message after `/devx`:

1. **No args** → run `devx next` (the 12-row state-driven decision table —
   CLI is the single source of truth; render its `command` + `detail`, then
   do it). If a morning report exists at `.devx-cache/loop/*/report.md`
   newer than your session start, run the **morning review first**:
   reconstruct from disk — `git status`, `git log --oneline -20`, open PRs,
   the report — never summarize an overnight run from memory; treat the
   night's claims as claims.
2. **Hash or spec path** → route by the spec's type + stage: dev spec →
   Execute arm (Phase 1 below); plan spec mid-pipeline → the matching
   `/devx-plan` stage; debug spec → Stage: Debug. A stage name after the
   hash overrides (`/devx <hash> retro`).
3. **Explicit stage word** (`prd|design|plan|red|execute|verify|revise|
   address|retro|outcome|loop`) → that stage. `address <pr>` = Stage:
   Address (that's where human review input on an open PR lands).
4. **Free text** → intent classification (say your routing call out loud;
   `INTERVIEW.md` when genuinely ambiguous — no silent product decisions):
   - **Bug-shaped** ("broken", "500s", stack trace, "why does…") → file
     `debug/debug-<hash>` spec + DEBUG.md row → Stage: Debug.
   - **Feature, small & unambiguous** (single surface, clear AC, ~one
     phase) → file `dev/dev-<hash>` spec directly with
     `entered_at: execute` recorded (D-8) → Execute arm.
   - **Feature, large or vague** → `devx workstream new <slug>` → hand off
     to `/devx-plan` PRD stage with the text as seed.
   - **Question-shaped** → answer with file:line evidence; file nothing
     unless asked.
5. **stop_after**: `this-item` (default) | `n-items` | `until-blocked` |
   `all` — the execute arm loops back through `devx next` after each merge.
6. **instructions**: extra constraints, logged to the spec status log.

Drift reported by `devx next` (backlog↔frontmatter mismatch) is surfaced to
the user as a defect, never silently fixed.

## Stage: Debug (repro-first)

1. Intake: symptom → `debug/debug-<hash>-<ts>-<slug>.md` (Goal = expected
   behavior; ACs = "repro exists", "root cause documented with evidence",
   "fix + regression test") + DEBUG.md row.
2. **Reproduce before touching code**: a failing test or runnable repro
   script, committed — the RED gate for bugs. No repro → no fix; if
   irreproducible, document the attempt and file for observability instead.
3. Root-cause with evidence in the status log (hypothesis → check →
   result, one line each).
4. Fix via the Execute arm (worktree → PR → merge); the PR body's Notes
   section carries the root-cause narrative.
5. Learnings → LEARN.md candidates at the next retro.

## Core Principles

1. **Never duplicate business logic** — wrap existing endpoints, tools, and utilities.
2. **One commit per story / sub-task** — atomic, reviewable units.
3. **Fix forward** — if review finds issues, fix them in the same item; don't skip.
4. **Local CI must pass** before moving to the next item. Gates come from `devx.config.yaml`.
5. **Target the integration branch**. Every PR opens against `git.integration_branch` (typically `develop`); when `null`, against `default_branch` (`main`) with `pr-to-main` or `direct-to-main` per `git.pr_strategy`. Agents never push to a branch the user did not configure as a target. With the develop/main split enabled, promotion to `main` is `/devx-manage`'s responsibility, gated per [`MODES.md`](../../docs/MODES.md); with single-branch, the merge gate IS the promotion gate.
6. **Remote CI is ground truth IF configured.** When `.github/workflows/*.yml` exists and triggers on the feature branch, wait for GitHub Actions to complete and only proceed on success. When no workflow is configured (typical during early bootstrap), local CI from Phase 5 IS the gate — do NOT block waiting for phantom CI; do NOT defer to a human just because there's nothing on GitHub side to gate on.
7. **Respect the mode — and actually act on it. YOLO means YOLO: this skill merges its own PRs.** The mode-derived merge eligibility (which mode merges with green CI, which mode requires no blocking comments, which mode requires coverage, which mode never auto-merges) is **not enumerated here**. Single source of truth: `mergeGateFor()` in `src/lib/merge-gate.ts`, consumed at Phase 8 via `devx merge-gate <hash>`. Re-stating the table in the skill body has been the regression vector — agents read the prose, infer "leave the PR for the user," and skip the merge step. dvx106 removes the enumeration; the gate's JSON output is what Phase 8 dispatches on.
8. **Respect trust-gradient autonomy** — read `devx.config.yaml → promotion.autonomy.count`; the ladder's N is mode-derived. Until N reached, merge requires user approval (even if CI passes). After N, auto-merge per the gate's decision. Note: this project starts at `initial_n: 0, count: 0` (full autonomy from commit 1) per its YOLO config — the trust gate does not apply here unless the user explicitly bumps it.
9. **Status log is append-only** — every phase transition appends a line to the spec file's status log. Never rewrite log lines.
10. **File out-of-scope work** — when implementing reveals test gaps, file `test/test-*.md` specs and append to `TEST.md`. When it reveals bugs, file `debug/debug-*.md` specs and append to `DEBUG.md`. Don't expand the current item's scope.

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

   **Resume-detection branch (roc101).** When the resolved spec already has `status: in-progress` in its frontmatter AND a `.worktrees/dev-<hash>/` directory exists, this is a potential resume — the claim may belong to another live session, and a fresh post-`/clear` invocation is NOT entitled to it (LEARN.md § epic-devx-skill E13: the 2026-05-07 resume-collision incident). BEFORE any worktree edit — and INSTEAD of the fresh claim in step 4 — verify ownership:

   ```
   devx devx-helper verify-claim <hash> --session-token "$SESSION_TOKEN"
   ```

   (`--session-token` takes the token this session claimed with — the raw sessionId or the `/devx-<sessionId>` shape — but ONLY from this conversation's own memory: the claim performed earlier in this same session. **Never copy the token out of the spec's `owner:` frontmatter or the lock file** — that trivially always matches and defeats the check entirely (the exact E13 incident shape). A fresh post-`/clear` session that doesn't know its token OMITS the flag; the helper auto-derives a new token via the same primitive `claim` uses, which correctly mismatches a live peer's lock.)

   Branch on the exit code:
   - **0** — `{"hash":"...","owned":true,"sessionToken":"..."}`: this session owns the claim. Resume: skip step 4 (the claim commit + lock + worktree already exist), enter the existing worktree at step 5, and continue from the last status-log line in the spec.
   - **3** — `{"error":"owned-by-other-session","hash":"...","lockOwner":"...","currentSession":"..."}`: another live session holds the lock. **HALT without touching the worktree** — no worktree edit, no spec edit, no DEV.md edit. Surface the owner mismatch (`lockOwner` vs `currentSession`) to the user and stop.
   - **4** — `{"error":"in-progress-without-lock","hash":"..."}`: drift — the spec says in-progress but no lock file exists (orphaned claim, e.g. a crashed session whose lock was cleaned). File an INTERVIEW.md row asking the user to either resume the orphaned spec manually or release it (flip back to `ready`), then halt.
   - **2** — `{"error":"<stage>","hash":"..."}`: helper failure (resolve / read / parse — see stage). Surface stderr and stop.

   When the spec is NOT in-progress (fresh claim) or no worktree exists, fall through to step 4 as usual.

4. **Atomically claim** via `devx devx-helper claim <hash>` (dvx101). The helper drives the six-step claim — lock + DEV.md flip + spec frontmatter + status log + commit on the base branch + push to `origin/<base>` + worktree create — in fixed order with per-stage rollback. Stdout is JSON `{branch, attached, lockPath, claimSha}` (`attached: true` ⇒ mss102 attach mode — `branch` pre-existed and was inherited from the spec's `branch:` frontmatter, so it may carry a parent run's handed-off commits and must never be force-deleted while unmerged); exit codes encode the outcome:
   ```
   if ! CLAIM_JSON=$(devx devx-helper claim "$HASH"); then
     case $? in
       1) echo "retryable contention — see the JSON 'error' field"; exit 1 ;;
       2) echo "rollback — see stderr"; exit 1 ;;
       *) echo "usage error"; exit 1 ;;
     esac
   fi
   ```
   On exit 0, parse `branch` + `lockPath` + `claimSha` from `$CLAIM_JSON` and proceed. Exit 1 is retryable contention, nothing mutated — the JSON's `error` field says which kind: `"lock held"` (another /devx is on this hash — pick a different item), `"backlog lock held"` (a peer is mid-mutation — retry shortly), or `"claim-contended"` (mlc104: a peer won the claim-push race and the bounded rebase-retries still lost; the rollback already ran — re-run `devx next` and pick again). On exit 2, the helper has already reverted the working tree (or, if the failure was post-push, surfaced the error and released the lock — operator manually retries `git worktree add` per the message).

   **Why the helper instead of inlining git commands?** The locked decision is "claim commit pushed to `origin/main` BEFORE any subsequent `gh pr create`" (closes `feedback_devx_push_claim_before_pr.md`). Inlining the order in the skill body has been the regression vector across all 25 Phase 0 stories; the CLI wrapper makes the order non-skippable. Same pattern as `devx merge-gate` (mrg102) and `devx plan-helper derive-branch` (pln101).

   Checkbox conventions per [DESIGN.md §Checkbox conventions](../../docs/DESIGN.md#checkbox-conventions): `[ ]` ready · `[/]` in-progress · `[-]` blocked · `[x]` done. Status field is the source of truth; the checkbox mirrors it.
5. **Enter the worktree**. The helper created `.worktrees/dev-<hash>` on the derived branch (`branch` field of the JSON result — same primitive as pln101's `deriveBranch`, single-branch projects produce `feat/dev-<hash>`). All subsequent edits happen there. Backlog-file updates still target the main worktree (use absolute paths).

   If `devx devx-helper claim` exited 2 with stage `worktree`, the claim itself succeeded (commit pushed; lock released) but worktree create failed — re-run `git worktree add .worktrees/dev-<hash> -b <branch> <base>` by hand, then resume from Phase 2.

### Phase 2: Working Artifacts (v2 — spec ACs direct)

The spec file's acceptance criteria ARE the working artifact. There is no
intermediate story file (v2x101 retired the story path + canary after the
LEARN.md 49/49-skip pattern held through every shipped epic).

Steps:

1. Re-read the spec: Goal, ACs, Technical notes, Status log (what prior
   sessions tried), and the parent (`from:`) epic/plan for locked decisions.
2. If the spec belongs to a workstream (plan spec has `gate_status:`), read
   `_devx/workstreams/<slug>/plan.md` for this phase's Verification plan +
   Context, and locate the RED artifacts named in the Expectation-coverage
   table. `tests-first` phases MUST re-run their already-RED artifact and
   watch it fail NOW, before writing code — never re-author it to pass.
   **Confirm it fails for the STATED reason**: read the failure output and
   check it names the missing feature, not harness breakage — a spawn
   error, empty output, or missing dependency is an infra failure, not a
   valid RED (the assertion it claims to make never ran). Fix the eval
   infra first, then re-confirm the honest RED. (mlc101: E-2's refusal
   assertion "failed" with empty output because the fixture's tsx path
   didn't exist in linked worktrees — the CLI under test never spawned.)
3. Workstream todo (working memory; skip when workstream=none): run
   `devx todo sync <plan-hash>` from the MAIN worktree, then expand this
   session's sub-items as free-nested lines under the current phase pointer
   in `_devx/workstreams/<slug>/todo.md` and check them as work lands —
   always via absolute paths into the main worktree (workstream artifacts
   live on `main`; never edit the worktree's copy). Derived `Stage:` /
   `Gate:` / `Phase <n>:` lines belong to sync — never hand-check them.
4. Append the status-log line: `phase 2: spec ACs direct (v2 native); <N>
   ACs; workstream=<slug|none>; red-artifacts=<list|none>`.

### Phase 3: Implement (native discipline)

1. Work directly from the spec ACs + workstream context. Honor
   `devx.config.yaml` stack/layer choices.
2. Execute ALL ACs and tasks. Do NOT stop at milestones or session
   boundaries.
3. Red-green-refactor: failing test → implement → refactor. For tests-first
   phases the RED artifact from Phase 2 is the failing test.
4. Maintain a File List (every file created/modified/deleted) in the
   session; it feeds the PR body and the review.
5. Append a status-log line to the spec file.

### Phase 4: Self-Review (Adversarial, native)

1. Review your own diff adversarially — you are hunting semantics bugs, not
   lint. Re-read every hunk asking "what input breaks this?" and audit the
   diff against every spec AC.
2. **Threshold rule** (LEARN.md cross-epic pattern): for substantial
   surfaces (>500 changed lines / multi-regex / marker-bearing), run the
   3-agent parallel shape — Blind Hunter (fresh eyes, semantics bugs),
   Edge Case Hunter (boundaries + branches), Acceptance Auditor (diff vs
   ACs) — as parallel subagents. Below the threshold, a rigorous single
   pass is correct and sufficient.
2b. **When the parallel shape is unavailable** — a harness with no subagent
   fan-out, an agent type that won't spawn, a session policy that forbids
   it — an above-threshold surface does NOT collapse to a plain single
   pass. That substitution is measured, not theorized: mlc105 single-passed
   a +1,513/13-file surface and returned **4** findings against a 3-agent
   peer median of **16** on comparable diffs. Use one of the two sanctioned
   compensations instead (LEARN.md § Cross-epic patterns, environmental-
   fallback sub-pattern; validated at sgrret across 5 stories):
   - **Sequential multi-lens** — run the same three lenses one at a time,
     each as its own pass with a context reset between them, so the second
     lens is not anchored by the first. sgr105: 7 findings on ~800 lines.
   - **Empirical real-repo leg** — pair a single pass with running the
     change against real data (a live repo, an attended dry run) and diff
     the before/after. sgr106: 14 findings, and the dry run caught the two
     most serious.
   Record which shape you used and why in the Phase 4 status-log line —
   the deviation is stated, never silent.
3. Review is **adversarial** — find 3–10 specific issues minimum on
   substantial surfaces. A zero-finding review of a big diff is a failed
   review; re-run with stricter framing.
4. For ALL findings (HIGH, MEDIUM, LOW): **fix them automatically** — do
   NOT ask the user or create action items. Fix forward, in this item.
5. After fixing, re-review the changed hunks to verify fixes are clean.
6. **A status-log line MUST be appended after Phase 4 completes, regardless of issue count.** Omission is a regression: the line is the audit trail that proves adversarial self-review actually ran. Zero issues writes `phase 4: clean review (0 issues; re-ran with stricter framing — confirmed clean)`. Non-zero findings record the count and disposition: `phase 4: <N>-agent <single-pass|sequential multi-lens|single-pass + real-repo leg|parallel adversarial> review; <X> findings (<H> HIGH, <M> MED, <L> LOW); ALL fixed in-place — <one-line summary of the most load-bearing fix>; re-review clean`. When an above-threshold surface used anything other than the parallel shape, the line MUST also say why the parallel shape was unavailable (per step 2b) — an unexplained single-pass on a big diff reads as a skipped compensation.

   The explicit-zero form (per CLAUDE.md "Self-review is non-skippable" + LEARN.md § epic-merge-gate-modes E7) is required because the failure mode dvx103 forecloses is silent omission — dvx102's status log is the motivating example (phase-2 + phase-7 lines were written but the phase-4 line was left implicit, losing the audit). `test/devx-status-log-discipline.test.ts` asserts every shipped non-retro non-grandfathered dev spec has a `phase 4:` line in its status log; new specs that ship without one will fail the assertion.

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

1. Compute the touched surface: `git diff --name-only <integration-branch>..HEAD`, where `<integration-branch>` is `git.integration_branch ?? git.default_branch` (typically `develop` on split-branch projects, `main` on single-branch — for this repo, `main`). The branch name MUST resolve dynamically; a hardcoded `develop` produces an empty diff on every single-branch /devx run.
2. Determine which projects/layers are affected — for monorepo configs, intersect touched paths with each project's `path`. Single-project configs always run everything.
3. For each affected project/layer, run in order:
   - `lint`
   - `test`
   - `coverage` (if defined)
   - `pre_push` (if defined)
4. **Coverage gate** (mode-derived — verbatim per dvx104 AC #1; the dispatch lives in `coverageTouchedGate()` from `src/lib/devx/coverage-touched.ts`):
   - YOLO → informational only; never blocks merge.
   - BETA → warn if touched-surface coverage < 80% (still merges).
   - PROD → block if touched-surface coverage < 100% (line-level diff of changed files against coverage report).
   - LOCKDOWN → block if < 100% OR if a browser-QA pass hasn't run.

   `# devx:no-coverage <reason>` (or the project-canonical marker from `devx.config.yaml → coverage.opt_out_marker`) on a touched line excludes it from the denominator — parsed by `parseOptOutMarkers()` in the same module. Opt-out wins over covered (a line that's both covered AND opted out is excluded from numerator and denominator), so an operator can't accidentally inflate the percentage by tagging a line that turned out to be covered anyway.

   Coverage source: the `coverage:` runner output declared in `devx.config.yaml → projects[*].coverage` (or `stack.coverage` for single-project shape). No schema change in dvx104 — the runner is whatever the project already wired (vitest, flutter test --coverage, bun test --coverage, …).
5. If any gate fails:
   - Read the error output carefully.
   - Fix the root cause (don't paper over).
   - Re-run until green.
6. Do NOT proceed to commit until every required gate passes for the touched surface.
7. **Emit the QA walkthrough** (stories with a user-visible surface only — a screen, a route, a CLI output, an email, anything a person perceives; pure-internal refactors skip this step and say so in the status log):
   - **Mint a FRESH hash for the walkthrough — never reuse the story's.** A bare hash resolves across every dir in `SPEC_TYPE_DIRS`, and the resolver fails closed on a duplicate, so a `test/test-<story-hash>-…` file makes the STORY unresolvable: `devx merge-gate <hash>` — Phase 8's own gate — returns `{"merge":false,"reason":"spec resolution failed"}`, and it surfaces only after the work is pushed (debug-ea4f41, hit live on sgr103/PR #112 and again on 4d1a9c/PR #123). Mint and collision-check in one line, from the repo root:
     ```bash
     while h=$(openssl rand -hex 3); ls */*-"$h"-*.md >/dev/null 2>&1; do :; done; echo "$h"
     ```
   - Author `test/test-<new-hash>-<ts>-<slug>.md` from `_devx/templates/engine/qa-walkthrough.md` — canonical spec form, identical to every other `TEST.md` row. `<ts>` is ISO-8601 local time to the minute; `<slug>` is `<story-hash>-qa-walkthrough`, which keeps the `test/*-qa-walkthrough.md` glob that `/devx-test` and the consumer evals read. One file per story.
   - Fill the template's frontmatter so it indexes like a spec rather than as a bare markdown file: `hash:` the fresh hash · `type: test` · `created:` · `title:` · `from:` the story's spec path · `status: ready` · `owner: null` · `branch: null`.
   - Every check is a checkbox line tagged `machine` or `human`.
   - **Execute every `machine` item inline, right here.** The gates just ran, the services are up, and the evidence is freshest at Phase 5 — that is why emission lives here and not at commit time. Run the command, paste the real output into its fenced evidence block, and check the box `[x]`. An unchecked machine item means the walkthrough is unfinished, not that the check is optional.
   - Leave every `human` item unchecked, and give each one an inline `how to verify:` hint — where to look and what you should see, in one line, so the reviewer never has to re-read the diff.
   - If a machine item fails, that's a Phase 5 gate failure: fix the root cause and re-run (step 5), don't downgrade the item to `human`.
   - Append a row to `TEST.md`: `` - [ ] `test/test-<new-hash>-<ts>-<slug>.md` — QA walkthrough for <spec title>; <n> human check(s) outstanding. Status: ready. From: <story-hash>. ``
   - The walkthrough file commits **with the story** in Phase 6 — it is part of the item's diff, not a follow-up.

**Run the gate in the worktree, and prove it ran there.** A `/devx` run
straddles two working trees on purpose — code lives in
`.worktrees/<type>-<hash>/`, backlog and spec edits target the main
checkout — so the shell's cwd moves between them all run. A gate command
that lands in the wrong tree tests `main`, not your branch, and reports a
green that means nothing. Before recording ANY gate result, check the
runner's own echo of its root (vitest prints `RUN vX.Y.Z <root>`; `npm
test` inherits cwd) and confirm it is the worktree path. A test count that
shifts between two "identical" runs is the same symptom. Cheapest habit:
`cd <worktree-abs-path> && <gate command>` as one command every time,
rather than relying on cwd persisting from an earlier call.

**Prose-bearing diffs: finish editing before you start the gate.** The skill-body discipline tests (`devx-skill-phase*.test.ts`, `skills-sync.test.ts`, `devx-status-log-discipline.test.ts`) read their subject files from disk at test time, so editing `.claude/commands/*.md`, `skills/*.md`, or a spec while the suite is running produces a red that reflects a torn read, not a real failure — and on a long suite that red costs a full re-run to disprove. Batch every prose fix first, run the targeted discipline files (sub-second), and only then start the full gate. If a prose fix becomes necessary after the gate is underway, let the run finish, apply it, and re-run the affected files rather than racing it.

If the config is missing required gate commands, append an item to `INTERVIEW.md` asking the user to supply them, mark the spec `blocked`, and stop.

### Phase 6: Commit

1. Stage only files relevant to this item — use `git add <specific files>`, never `git add -A`. The Phase 5 walkthrough (`test/test-<new-hash>-<ts>-<slug>.md`) and its `TEST.md` row are part of this item; stage them with it.
2. Commit with message:
   ```
   <type>: <spec-hash> — <spec title>

   <1-2 sentence summary of what was built>

   Spec: dev/dev-<hash>-<ts>-<slug>.md
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
   # Scratch is SESSION-NAMESPACED (mlc105, race R11): with N loops plus
   # interactive sessions sharing one repo, a fixed `.devx-cache/pr-body.stderr`
   # is a file two runs write and read at the same time. The key must be STABLE
   # across shell invocations (a later step re-derives it to read the file back),
   # so it is DEVX_SESSION when the harness exports it, else the branch name —
   # one branch is one item is one worker. Gitignored; reaped after 7 days by the
   # next `devx loop` start.
   SCRATCH=".devx-cache/scratch/${DEVX_SESSION:-$(git branch --show-current)}"
   mkdir -p "$SCRATCH"   # fresh worktrees have no .devx-cache (gitignored; claim doesn't create it) — the stderr redirect below fails the whole command without it
   BODY=$(devx pr-body --spec dev/dev-<hash>-<ts>-<slug>.md \
     --summary "<1–3 bullets on what changed>" \
     --test-plan "<bulleted list of what local CI gates covered + any manual steps>" \
     --notes "<surprises, deviations, follow-ups>" \
     2> "$SCRATCH/pr-body.stderr")
   gh pr create --base $BASE --head <branch-name> --title "<commit subject>" --body "$BODY"
   ```

   - The first non-empty line of the rendered body is the `**Spec:**` line — load-bearing for the mobile companion app's PR card and for reviewers scanning github.com (epic-pr-template.md AC).
   - The `**Mode:**` line carries the active mode (`YOLO` / `BETA` / `PROD` / `LOCKDOWN`), uppercased — reviewers see at a glance which gate auto-merge is applying.
   - **Unresolved placeholders.** If `$SCRATCH/pr-body.stderr` is non-empty after the CLI returns, append a status-log line per name to the spec file: `phase 7: pr body had unresolved placeholder <name>` (locked decision #5 — never silently render an empty section). The PR opens regardless; the audit trail is grep-able post-merge.
   - **Fallback.** When `.github/pull_request_template.md` is absent (older repo predating prt101 or `/devx-init` upgrade not yet run), the CLI falls back to the built-in canonical template — never blocks PR open on a missing file.
3. Append a status-log line with the PR URL.
4. **Remote CI: detect, then wait if it exists, otherwise proceed immediately.** The full state machine — workflow detect, `gh run list` probe, headSha verification, in-progress polling — lives in the **`devx devx-helper await-remote-ci`** CLI (dvx105). Skill body never re-implements the dispatch.

   The skill body uses `--once` and drives the polling itself via `ScheduleWakeup` 120s delays — this keeps the prompt cache warm (Anthropic cache TTL = 5min; 120s × 2 ≤ 5min). Internal-sleep mode (no `--once`) blocks the agent for the full poll duration; only use it from non-harness consumers.

   ```
   devx devx-helper await-remote-ci <branch-name> --once
   ```

   Stdout is a single JSON ProbeState. **The probe aggregates every workflow run at the branch tip's commit** (arci1) — a repo that runs two workflows on one PR gets one verdict folded from both, not the newest run's verdict. Branch on `state`:

   - **`{"state":"no-workflow"}`** → there is no remote CI to wait for. Local CI from Phase 5 IS the gate. Append `phase 7: no remote CI workflow detected — local gates are authoritative` to the spec status log and proceed to Phase 8 immediately. Do NOT block on phantom CI; do NOT defer to a human.
   - **`{"state":"empty"}`** (workflows present, `gh run list` returned nothing, AND the PR is not conflicted — the probe already checked) → wait one `ScheduleWakeup` 120s retry (call this CLI again on wake-up); if the second probe is still `empty`, file an `INTERVIEW.md` entry asking the user to confirm the workflow's `on:` filters cover `<branch-name>`, mark the PR `awaiting-approval`, append `phase 7: workflow-no-run after retry — INTERVIEW filed` to the spec status log, and stop. Do NOT auto-merge — silent CI is a config bug, not a green light. This escalation is reserved for genuinely unexplained silence; the conflicted-PR case below is mechanical and never reaches it.
   - **`{"state":"pr-conflicting","prNumber":...,"mergeable":"CONFLICTING","mergeStateStatus":"DIRTY"}`** (c94f14) → **no run exists because GitHub cannot build the PR's merge ref.** This is self-serviceable — do NOT file INTERVIEW, do NOT wait, do NOT re-probe on a wake-up hoping it clears. Fix it in-branch, right now:

     ```
     git fetch origin <integration-branch>
     git merge origin/<integration-branch>      # resolve conflicts in the worktree
     git push
     ```

     `<integration-branch>` is `git.integration_branch ?? git.default_branch` (this repo: `main`). Resolve every conflict with the same care as Phase 4 — a merge-resolution mistake is a semantics bug that CI may not catch — then re-run Phase 5's local gates on the merged tree, push, and go back to step 4 (the push triggers CI immediately once the merge ref is buildable). Append `phase 7: pr-conflicting (PR #<prNumber>, <mergeStateStatus>) — merged <integration-branch>, re-probing` to the spec status log. Escalate to INTERVIEW only if the conflict is genuinely undecidable (two intentional, incompatible changes to the same lines) — mark the PR `awaiting-approval` and cite the conflicting paths.
   - **`{"state":"sha-mismatch","runHeadSha":...,"headSha":...}`** → *no* run at the branch tip's commit (rare; usually means an unpushed local change shifted HEAD after PR-open). `runHeadSha` is the newest run's commit. File an `INTERVIEW.md` entry citing both shas, mark the PR `awaiting-approval`, append `phase 7: sha-mismatch (run=<runHeadSha> vs HEAD=<headSha>) — INTERVIEW filed` to the spec status log, and stop.
   - **`{"state":"in-progress",...,"runs":[...]}`** → at least one workflow at the commit is still running. This wins over any already-terminal sibling — including a red one — so the state never resolves off a partial view. Schedule a `ScheduleWakeup` 120s, then re-invoke this CLI on wake-up. Loop until terminal.
   - **`{"state":"completed","conclusion":...,"runId":...,"workflowName":...,"runs":[...]}`** → every workflow at the commit is terminal. `conclusion` is `"success"` only if **all** of them concluded `success`; otherwise it is the first non-success conclusion and `runId`/`workflowName` identify *that* workflow. Evaluate `conclusion` per step 5.

   `runs` (present on `in-progress` and `completed`) lists every run at the commit as `{runId, workflowName, status, conclusion, url}`. Write the Phase 7 status-log line from it — `phase 7: CI <conclusion> — <workflowName> (run <runId>)` — so a red sibling is named without a second `gh` call.

   Exit code 2 with `{"error":"probe-failed","stage":...}` → operator-actionable failure. Stage is one of `"gh-run-list"` (gh exited non-zero — auth / network / rate limit), `"gh-parse"` (malformed gh JSON or run with invalid fields — databaseId, conclusion, headSha), `"git-rev-parse"` (the local branch ref couldn't resolve to a 40-char hex sha), or `"unknown"` (catch-all for argument validation / unhandled internal failures). Append `phase 7: probe-failed (<stage>)` to the spec status log, surface the stderr, run `gh auth status` if stage is `gh-run-list`, and stop. Never auto-merge on exit 2 — uncertainty defaults to safe.

5. If `conclusion == "success"` (or `state == "no-workflow"` per the bullet above): proceed to Phase 8.
6. If `conclusion != "success"`:
   - `gh run view <runId> --log-failed`
   - Identify the failing check (lint? test? coverage? something local didn't catch?).
   - Fix the root cause in a new commit on the branch. Do NOT rewrite history.
   - Push the fix. Go back to step 4.
   - File a `debug/debug-*.md` spec + `DEBUG.md` entry describing the CI-only failure pattern (so `/devx-learn` can eventually add it to local gates).

   > Implementation note: `devx devx-helper await-remote-ci <branch>` (without `--once`) wraps the full state machine and blocks via real `setTimeout` until terminal. Useful from non-harness consumers (e.g. CI runners that aren't an LLM) and as the canonical reference impl. The `/devx` skill body always uses `--once` because the agent's cache stays warm only when the harness drives the wait via `ScheduleWakeup`, not when the CLI internally sleeps for 120s.

### Phase 8: Auto-Merge (gate-driven) or Hand Off


**Hold check (D-5) — run BEFORE merging, after CI green**: `devx devx-helper
check-hold <pr-number>`. Exit 3 (`devx: hold` comment or an unresolved
requested-changes review) → do NOT merge; surface the hold reason, address
it via `/devx address <pr>`, and only merge after the hold is lifted
(comment resolved / re-review). Exit 0 → silence merges, as YOLO always has.
Exit 2 is a gh failure — note that `check-hold`, `merge-gate` and the
remote-CI probe now retry transient GitHub errors internally (GraphQL 401,
5xx/429, network — 3 attempts, exponential backoff; debug-d7e8e5), so an
exit 2 means a *sustained* outage or a real auth problem, not the one-off
flake it used to mean. Don't hand-retry the command in a loop: check
`gh auth status` and stop.

**YOLO is fully autonomous — /devx merges its own PRs. Period.** No "leave it open for human review," no "prior PRs were merged manually so I'll follow that pattern." If the user wants to gate merges on human approval they bump out of YOLO. The only thing that stops a YOLO merge is the merge gate itself returning `merge:false`. Past PRs being merged by a human is irrelevant — that's an artifact of `/devx` not doing its job, not a project policy.

The mode/coverage/CI/review/trust-gradient logic that decides whether this PR is mergeable lives in **one place**: the `devx merge-gate` CLI, which wraps `mergeGateFor()` from mrg101. Skill body never re-implements mode logic. Run:

```
devx merge-gate <hash>
```

It emits a JSON decision to stdout and exits with one of three codes:

| Exit | Decision shape | What you do |
|---|---|---|
| `0` | `{"merge": true}` | Run the merge command below. |
| `1` | `{"merge": false, "reason": "...", "advice": [...]}` | Dispatch on `advice` array — see "Advice routing" below. Always append the gate's `reason` to the spec status log first. |
| `2` | `{"merge": false, "reason": "no PR yet" \| "no spec file …" \| "gh signal collection failed"}` (no `advice` field — exit 2 is investigation, not a routing decision) | Investigation: missing PR → re-check Phase 7 actually opened one; missing/ambiguous spec → check the hash against the backlog (typo, or a duplicated hash across type dirs); `gh` failure → check auth (`gh auth status`) and re-run, but note the CLI already retried transient errors 3× with backoff (debug-d7e8e5), so a bare re-run is unlikely to help. Do NOT write a MANUAL.md row for exit 2 — these are transient. Never auto-merge on exit 2 — uncertainty defaults to safe. |

Pass `--coverage <pct>` (a value in `[0, 1]`) iff Phase 5's coverage runner produced one — under YOLO/BETA the gate ignores it; under PROD the gate uses it.

**Advice routing (exit 1).** The CLI emits exactly one of three keywords in the `advice` array — exact-string match, no prefix tolerance:

- **`"file INTERVIEW for approval"`** — trust-gradient block (count < initialN). Append a row to `INTERVIEW.md` citing the PR + the spec hash; leave the PR open; stop. The user resolves the INTERVIEW (bumps `count` or approves directly) and re-invokes /devx.
- **`"wait for CI"`** — CI is non-success or pending. Phase 7's polling should have caught this; if Phase 8 sees it, re-enter Phase 7 polling (call `devx devx-helper await-remote-ci <branch> --once` again, schedule the next ScheduleWakeup, loop). On terminal success, re-invoke `devx merge-gate <hash>`.
- **`"manual merge required"`** — block needs human action that /devx can't take (lockdown active, blocking reviewer comments, coverage gap, unknown mode). Append a row to `MANUAL.md` describing what needs to happen + the PR URL; leave the PR open; stop.

**Merge command (after `devx merge-gate <hash>` returned exit 0):**
```
gh pr merge <#> --squash --delete-branch
```
Then verify — even if the merge command above returned non-zero:
```
gh pr view <#> --json state,mergeCommit
```
Expect `state == "MERGED"` and a `mergeCommit.oid`. **`gh pr merge` invoked from inside a worktree commonly exits non-zero while the remote merge actually succeeds** (reaffirms `feedback_gh_pr_merge_in_worktree.md`) — never trust the gh exit code alone. The verify is authoritative: if `state == "MERGED"`, proceed with after-merge bookkeeping below regardless of what `gh pr merge` returned. If `state != "MERGED"`, surface the gh stderr verbatim and stop — do NOT silently leave the PR open.

> Implementation note: `--auto` alone requires "Allow auto-merge" in repo settings (not on for this repo); the direct `--squash --delete-branch` form is what works here.

After merge:
1. `git fetch origin --prune && git pull --ff-only` in the main worktree to bring the merge commit into local `main`.
2. Remove worktree: `git worktree remove .worktrees/dev-<hash>`.
3. Delete local branch: `git branch -D <branch-name>` (the `--delete-branch` flag on `gh pr merge` handles the remote).
4. Run the bookkeeping writes as ONE mechanical call, from the **main worktree** (sgr105). It flips the spec to `status: done` + appends the `merged via PR #<n> (squash → <sha>)` status-log line, flips the backlog row `[/]` → `[x]` + appends `PR: https://github.com/.../pull/<n> (merged <sha7>)`, trues the workstream `todo.md`, and regenerates `GRAPH.md` — all under the backlog lock, so a concurrent session can't interleave with it:
   ```
   devx devx-helper mark-done <hash> --pr <n> --merge-sha <merge-sha> [--type debug]
   ```
   Do NOT hand-edit the spec, the backlog row, or `todo.md` — the helper is the single source of truth for the closing flip exactly as `devx devx-helper claim` is for the opening one, and hand-editing is what produced the `git add -A` incident class this closes.

   Branch on the exit code:
   - **0** — `{"hash":"…","paths":[…],"todoSynced":true|false}`. `paths` are the repo-relative pathspecs it wrote (backlog, spec, and — when present — `todo.md` and `GRAPH.md`). Carry them to step 5 verbatim. A `todoSynced: false` on a workstream item means the sync failed (stderr says why); the flips still landed, so continue and re-run `devx todo sync <plan-hash>` after.
   - **1** — state mismatch (`{"error":"mark-done-failed","stage":"state"}`) or retryable contention (`{"error":"backlog lock held",…}`). Nothing was written. A state mismatch means the backlog row isn't `[/]` or the spec isn't `status: in-progress` — the item you just merged is not the item you're closing. Stop and reconcile; do not hand-flip it. Lock contention is a peer mid-mutation: retry shortly.
   - **2** — resolution/write failure (`stage ∈ validate|resolve|read|compose|write-tmp|rename|config-load`). Surface stderr and stop.

   If the spec was abandoned/superseded rather than merged, mark-done does not apply — wrap the backlog entry line in `~~…~~` by hand instead.
5. Commit the pathspecs mark-done returned, on `main`, with message `chore: mark <hash> done after PR #<n> merge`, and push. **Stage by explicit pathspec — `git add -- <paths from step 4>`, never `git add -A`.** This is the same rule as Phase 6, and it matters more here: `main` is the one tree every concurrent session shares, so a blanket stage silently commits peers' in-flight spec and todo edits under your authorship. That has happened twice (2026-07-29 erratum `ba3c65b`); the content survives but the audit trail lies about who wrote it. Staging exactly `paths` is what makes that structural rather than a thing to remember — it is the whole reason the helper returns them.
6. File gaps:
   - **Test gaps** observed during implementation → new `test/test-*.md` specs + `TEST.md` entries.
   - **Bugs discovered but out of scope** → new `debug/debug-*.md` specs + `DEBUG.md` entries.
7. If the item is part of an epic, check if the epic's other stories are all done; if so, log a promotion candidate in `PLAN.md`.

### Phase 9: Next Item or Finish

- If `stop_after == this-item`: proceed to Finalization.
- If `stop_after == n-items` with remaining count: go to Phase 1 with the next ready item. Decrement the counter.
- If `stop_after == until-blocked`: repeat until no ready items exist OR the next item is blocked OR capacity/usage is hit.
- If `stop_after == all`: repeat until no `ready` items remain in `DEV.md`.
- If you halt early for any reason (context budget, quality risk, blocker, usage pressure, mode change): run `devx split <hash> --payload <file> --session-token <token>` (merge-first if your work is coherent+green — land it through Phases 5–8 first; branch-handoff otherwise — push the WIP branch, split, then release the spec lock), say one sentence on why you stopped, and stop.

The remaining work becomes a first-class follow-up spec + backlog row that any fresh session can claim cold — there is no conversation-prose bridge to preserve, so do not summarize state into chat instead of splitting.

**Payload file** (JSON). Write it under the session-namespaced scratch dir — derive it here rather than assuming Phase 7 ran, because an early halt can land before Phase 7 ever executed:

```
SCRATCH=".devx-cache/scratch/${DEVX_SESSION:-$(git branch --show-current)}"
mkdir -p "$SCRATCH"   # gitignored; fresh worktrees have no .devx-cache
```

Payload shape → `$SCRATCH/split-payload.json`:

```json
{
  "title": "<single-line follow-up title; no `;`>",
  "goal": "<optional; defaults to a generated continuation line>",
  "remaining_acs": ["<each unfinished AC, one line each — non-empty>"],
  "carried_forward": {
    "state_to_trust": ["<branch, worktree, pushed commits, mode, what CI last said>"],
    "gotchas": ["<anything that cost more than a minute to figure out>"],
    "do_not": ["<work already done that must not be redone; files out of scope>"]
  },
  "learnings": ["<optional; extra notes worth carrying>"]
}
```

Rules:
- **Choose the shape deliberately.** merge-first (default) = the done portion is coherent and green: land it through Phases 5–8 first, then split. branch-handoff = the work is mid-stream: push the WIP branch FIRST (the CLI refuses the shape when `git ls-remote --heads origin <branch>` is empty), then split.
- **Split before the lock goes.** `devx split` guards on the parent's spec lock and exits 3 once it's gone. On merge-first that means splitting **after the merge but before Phase 8's after-merge bookkeeping** (worktree removal / `status: done`) — the follow-up is `Blocked-by: <parent>`, immediately satisfied by the merge just landed. On branch-handoff you release the lock yourself, *after* the split returns 0: `rm .devx-cache/locks/spec-<hash>.lock` from the main worktree. The parent goes `superseded` and the follow-up inherits the pushed branch; skipping the release leaves a lock that classifies `live` — and so masks the spec from `devx next` — for as long as this session's process survives, which is exactly the `/clear`-and-resume window the split exists to serve.
- `--session-token` is never auto-derived for split — pass the token this session claimed with. Exit codes: 0 success · 1 backlog-lock contention (retry shortly) · 2 other failure (stage named in the error) · 3 ownership mismatch (not your claim — do not retry) · 64 usage.
- Gotchas are the highest-value field. Be concrete: every fact a fresh agent would otherwise grep for belongs there.

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
3. **Friction-observed nudge**: if this run hit real friction, apply the
   nudge — the canonical sentence is defined exactly once, at the
   `nudge-canonical` HTML-comment marker in
   `.claude/commands/devx-learn.md`; read it there and act on it.
   Reference it, never restate it.

Do NOT promote `develop → main`. That's `/devx-manage`'s job, gated by the promotion rules in [`MODES.md`](../../docs/MODES.md).

## Stage: Address (`/devx address <pr>`)

Consume human review input from a PR. Every comment gets a response —
a reply, a commit, or a filed spec — never silent resolution.

1. Fetch comments + review threads (`gh api repos/{owner}/{repo}/pulls/<n>/comments`
   + reviews). Inline comments carry `path:line` anchors — map each to the
   spec AC it bears on mechanically.
2. Triage each comment: **in-scope** (fix on the PR branch now, reply with
   what was done + the commit sha) / **out-of-scope** (file a debug/test
   spec + backlog row, reply with the spec path) / **question** (answer in
   a reply with file:line evidence).
3. Re-run local CI after fixes; push; the PR updates in place.
4. Append a status-log line: `address: <n> comments — <f> fixed, <s> filed,
   <q> answered`.
5. If the PR carried a hold, ask the reviewer to lift it (reply summarizing
   dispositions); the merge tail re-checks via `check-hold`.

## Stage: Loop (`/devx loop` — good night, have fun)

Unattended operation. The trust model is transactional git + the failure
ladder + merge-gate — NOT permission bypass (D-6; LOCKDOWN refuses the loop
entirely).

1. Entry: `devx loop [--until <HH:MM>] [--max-items N] [--max-tokens N]
   [--only <type>] [--dry-run] [--force]`. Budgets come from
   `devx.config.yaml → loop:`; flags override downward only. Run `--dry-run`
   first when the user is present and show them the plan.
1b. **Scope (mlc106)** — `[--epic <slug|plan-hash>]…
   [--workstream <slug>]… [--items <h1,h2,…>] [--exclude <hash|epic>]…
   [--focus <text>]`. Repeated flags union within a dimension; different
   dimensions intersect. Scope MASKS, never drops: an out-of-scope row
   still blocks its in-scope dependents, and an in-scope item held by an
   out-of-scope unfinished blocker is reported by hash (stdout, event,
   morning report) rather than silently skipped. `--items` also dictates
   pick order. `--focus` masks nothing — it rides into every iteration
   prompt verbatim as a Specialty directive. Malformed scope flags — and
   any scope that selects zero claimable rows — exit 4 against the parsed
   backlog before any lock, claim, or file write. Use scope to run
   N loops on disjoint slices; the scope descriptor shows up in the
   instance file, `devx next` row 1, `devx status`, and the report
   header.
1.5. **Preflight main-health (lpf101).** The CLI probes the integration
   branch's remote CI before claiming anything and exits 5 when it's red —
   a red main converts the whole night into unmergeable open PRs (every
   branch inherits the red check; the tail hands every item off with zero
   merges). Fix main first. `--force` (or `loop.preflight_main_health:
   warn`) starts anyway and threads a "treat as baseline" line into every
   iteration prompt + the morning report; probe failure or no decisive
   signal never blocks the run.
2. The CLI owns the loop: item pick (reconcile), worker spawn, the
   iteration contract (fresh session per iteration; smallest verifiable
   slice; structured report), commit-or-reset transactions, the failure
   ladder (reported → continue; hard error → backoff; permanent → abort;
   3 strikes → abandon item, preserve worktree; 3 abandoned → stop), and
   the morning report. The skill's job is to start it, not to be it.
3. **Loop completion is not acceptance (D-11).** `acs_met` routes items
   into the normal PR + CI + merge-gate tail; nothing reaches main any
   other way.
4. Workers inside the loop obey the iteration contract verbatim: read the
   status log first, never commit, never edit the status log (the loop
   owns both), report failure instead of pivoting forever, stop background
   processes before finishing.
5. Morning: the first `/devx` of the day runs the morning review
   (dispatcher Routing rule 1) — reconstruct from disk, read the report's
   claims as claims, verify merges via `gh pr view` before trusting them.

## Stage: Outcome (`/devx outcome <hash>`)

Weeks after a workstream ships, score its numeric goals against reality —
the loop v1 never closed.

1. Arming happens at workstream close: `devx outcome arm <hash>
   [--measure-by <date|+Nw>]` (default +4 weeks). `devx next` surfaces due
   outcomes automatically (row 5.5).
2. When due: gather each `G-` goal's actual value with a real source (a
   metric, an eval run, a count — never vibes), then
   `devx outcome score <hash> --verdict keep|tune|restart|retire
   --goal G-N=<actual> --source G-N=<where> [...]`. The CLI writes
   RESULTS.md and applies the verdict mechanics.
3. Verdicts: **keep** is mechanical (goals hit). **tune** reopens via the
   revision cascade keyed to the missed expectations (`--reopen E-n,...`).
   **restart** links a successor workstream (`--successor <slug>`) with
   learns_from/superseded_by lineage. **retire** records the sunset.
4. tune/restart/retire are product judgments — when unattended, file the
   recommendation in INTERVIEW.md instead of deciding silently.

## Stage: Retro (native, replaces the retrospective workflow)

Runs at epic/workstream close (the `*ret` item). Contract (D-3): the
LEARN.md row format is byte-compatible with v1.

1. Evidence: read every shipped spec's status log, the epic's PR bodies
   (`gh pr view`), and the diff stats. Reconstruct from disk, not memory.
2. Write the retro artifact `_devx/workstreams/<slug>/RETRO-<date>.md`
   (standalone epics: `_devx/retros/<epic-slug>-<date>.md`): Outcome
   (test-count growth, wall-clock, review-pattern stats) + findings.
3. Append rows to `LEARN.md § <epic-slug>`:
   `- [confidence] [blast-radius] finding — applied|filed-as|pending`.
   Misses are the highest-value entries — tag them (miss).
4. Promotion check: any pattern with ≥3-retro concordance moves to
   `LEARN.md § Cross-epic patterns` with per-epic evidence.
5. Apply low-blast findings in the retro PR; file higher-blast ones as
   specs/backlog rows. Ship through the normal PR flow.

## Key References

- **DESIGN.md § Branching model** — `develop`/`main` split, feature-branch naming, worktree rules.
- **MODES.md** — mode-derived gate behavior for auto-merge, coverage threshold, and PR discipline.
- **SELF_HEALING.md** — every status-log line, every CI failure, every fix-forward commit is a signal LearnAgent reads.
- **QA.md** — scripted tests run in this loop; exploratory QA is `/devx-test`'s domain, not `/devx`'s.
- **`devx.config.yaml`** — `stack` / `projects` (what to lint/test/cover), `mode`, `promotion.autonomy.count`, `branch.develop` (default: `develop`), `branch.main` (default: `main`).
- **Engine stages** — `/devx-plan` (PRD → Design → Plan → RED); `_devx/workstreams/<slug>/` artifacts; `devx gate evals` RED artifacts consumed by Phase 2.

## Pairs with

- **/devx-plan** — produces the artifacts this command consumes. Contract stability matters.
- **/devx-manage** — decides when parallel `/devx` agents should run, handles `develop → main` promotion, rebalances `DEV.md` priorities. Not invoked from here.
