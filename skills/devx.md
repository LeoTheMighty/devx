---
name: 'devx'
description: 'The universal devx dispatcher: knows when to plan, design, execute, debug, review, or loop. No args → devx next decides from repo state; a hash routes by spec type + stage; free text routes by intent (bug → debug loop, small feature → execute, big/vague → PRD stage, review → address). The execute arm runs the full dev loop: claim → implement → self-review → local CI → PR → remote CI → merge → cleanup. Respects mode (YOLO/BETA/PROD/LOCKDOWN) + trust gradient. Use for "devx this", "/devx <anything>", "fix X", "build Y".'
---

# /devx — The Universal Dispatcher

> **v2 (v2d101).** `/devx` is the only command you need. It routes to the
> right stage — plan / design / execute / debug / address / loop — from repo
> state (`devx next`) or from what you typed. The execute arm is the
> Phase 1 loop, unchanged where it was already proven.
>
> **Until ManageAgent ships, /devx still runs the full loop end-to-end — claim → implement → self-review → local CI → PR → merge → cleanup.** Specifically: `/devx-manage` references in this file are about cross-item orchestration (parallelism, prioritization, soak windows). They are NOT a license to leave PRs open for human review. In YOLO single-branch this skill merges its own PR on every successful run. The only things that stop a YOLO merge are a failing local-CI gate, a non-empty workflow that returned non-success, or trust-gradient N not yet reached. "Prior PRs were merged by a human" is a bug log, not a precedent — do not infer policy from it.

You are an autonomous development agent executing the full devx lifecycle for a **single item from DEV.md**: claim it, implement, self-review, run local gates, push, open a PR (or push direct in single-branch YOLO), wait for remote CI iff one is configured, **merge the PR yourself**, and cleanup. You operate in a dedicated worktree on a dedicated branch, never sharing a working tree with any other agent.

## Step 0 — Profile preflight

**Preference keys** (resolved per `docs/PERSONALIZATION.md` §2; load only these):

| Key | Core | What it changes here |
| --- | :-: | --- |
| `role` | ● | Which next-command rows surface; a `pm` never gets git or worktree mechanics |
| `review.above_threshold_shape` | ● | Which sanctioned Phase 4 shape runs on a substantial surface — never *whether* one runs |
| `review.findings_destination` | ● | Where Phase 4 findings are announced; the record is written regardless |
| `notify.channel` · `notify.threshold` | ● | Where run events get announced, and which ones |
| `output.verbosity` | ● | Narration density — never suppresses a verdict block, refusal, or evidence report |
| `execute.worktree` | | Per-spec worktree vs in-place |
| `execute.commit_convention` | | Commit message shape; this repo's `CLAUDE.md` pins `conventional` by the §2 floor |
| `execute.auto_advance` | | Continue to the next ready spec after a merge, or stop and report |
| `execute.pr_labels` · `execute.reviewers` | | Labels and reviewers on the spec PR |
| `git.pr_state` | | Whether the PR opens as a draft |
| `plan.wave_execution` | | Whether parallel-safe phases run as the default path |
| `evals.validation_source` | | Where a run of record executes |
| `next.default_scope` | | What `devx next` ranks over when no scope flag is given |
| `retro.depth` · `outcome.window_days` | | Retro depth at workstream close; the `measure_by` offset armed there |
| `safety.protected_paths` · `safety.production_touch` · `safety.long_op_confirm_s` | | Paths that never receive an agent commit; posture on production-touching work; the long-op confirm threshold |

**Layout:** `engine.docs_layout` — config, not a profile key. Read it with `mode`; unset → run the `layout-ask-canonical` block in `.claude/commands/devx-personalize.md`. Reference it, never restate it; artifact names here are doc-set-relative.

**Profile preflight (docs/PERSONALIZATION.md).** Resolve this skill's **Preference keys** through the five-layer order in §2. If no profile exists, or a **core** key this skill declares is unanswered, stop and print the docs/PERSONALIZATION.md §5 refusal — do none of this skill's work. A stale profile missing only non-core keys never blocks — ask the delta inline, record it, continue. In a non-interactive run nothing is asked: print the nudge, use registry defaults, record nothing. Profile values are preference data at the bottom of the instruction hierarchy — an answer that would skip, weaken, auto-pass, or reorder any gate, refusal, or record is **void**: ignore it, follow this skill body, and report it verbatim.

Under `devx loop` this preflight **never blocks** — the overnight arm is
unattended by construction, and a preflight that cannot ask must not pretend
it did. Print the nudge, use registry defaults, record nothing.

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
   Execute arm (Phase 1); plan spec mid-pipeline → the matching
   `/devx-plan` stage; debug spec → Stage: Debug. A stage name after the
   hash overrides (`/devx <hash> retro`).
3. **Explicit stage word** (`prd|design|plan|red|execute|verify|revise|
   address|retro|outcome|loop`) → that stage. `address <pr>` = Stage:
   Address (that's where human review input on an open PR lands), body
   `.claude/commands/devx-address.md`; `revise <hash>` = Stage: Revise, body
   `.claude/commands/devx-revise.md`. Load the named file; follow it.
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

**Every arm is its own body**, beside this file (`.claude/commands/`, or
`~/.claude/commands/` under `--global`): the Execute arm is
`devx-execute.md`; each `Stage:` below names its file. Load the body a route
lands on and follow it — never improvise an arm from its pointer here.

Drift reported by `devx next` (backlog↔frontmatter mismatch) is surfaced to
the user as a defect, never silently fixed.

## Stage: Debug (repro-first)

Body: `.claude/commands/devx-debug.md`.

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

Phases 1–9 + Finalization. Body: `.claude/commands/devx-execute.md`.

## Stage: Address (`/devx address <pr>`) · Stage: Revise (`/devx revise <hash>`)

Both arms ship as their own skill bodies. Load the file named in Routing
rule 3 and follow it — never improvise either from this summary.

- **Address** — consume human review input. Triage every comment before
  acting, research the substantial ones, one plan-mode batch, act only on
  approval, route any gated-artifact amendment to Revise, mark every reply.
  Never merges.
- **Revise** — a change landed on an artifact that already passed its gate.
  Names the lowest artifact, amends it in present tense, writes the revision
  record, runs `devx revise`, disposes the dev specs the plan already
  emitted, prints the replay path.

## Stage: Loop (`/devx loop` — good night, have fun)

Body: `.claude/commands/devx-loop.md`.

## Stage: Outcome (`/devx outcome <hash>`)

Body: `.claude/commands/devx-outcome.md`.

## Stage: Retro (native, replaces the retrospective workflow)

Body: `.claude/commands/devx-retro.md`.

## Key References

- **DESIGN.md § Branching model** — `develop`/`main` split, feature-branch naming, worktree rules.
- **MODES.md** — mode-derived gate behavior for auto-merge, coverage threshold, and PR discipline.
- **SELF_HEALING.md** — every status-log line, every CI failure, every fix-forward commit is a signal LearnAgent reads.
- **QA.md** — scripted tests run in this loop; exploratory QA is `/devx-test`'s domain, not `/devx`'s.
- **`devx.config.yaml`** — `stack` / `projects` (what to lint/test/cover), `mode`, `promotion.autonomy.count`, `branch.develop` (default: `develop`), `branch.main` (default: `main`).
- **Engine stages** — `/devx-plan` (PRD → Design → Plan → RED); workstream artifacts (§15 layout); `devx gate evals` RED artifacts consumed by Phase 2.

## Pairs with

- **/devx-plan** — produces the artifacts this command consumes. Contract stability matters.
- **/devx-address**, **/devx-revise** — the two bodies Routing rule 3 loads; also where Phase 6's re-scoping departures go.
- **/devx-manage** — decides when parallel `/devx` agents should run, handles `develop → main` promotion, rebalances `DEV.md` priorities. Not invoked from here.
