# 00 — Vision: `/devx` anything

## The end state

On **any** repo — this one, a fresh idea, a legacy brownfield — you run
`devx init` once, and from then on `/devx` is the only command you need:

```
/devx                          # figure out the next right thing and do it
/devx "add dark mode"          # route: needs a PRD? design? or just execute?
/devx debug "login 500s"       # route to the debug loop
/devx plan mobile-v2           # route to the planning stages
/devx review 42                # build the review tour for PR #42
/devx loop --until 07:30       # good night, have fun
```

`/devx` knows **when to plan, when to design, when to execute, when to debug,
and when to stop and ask** — because every unit of work is a markdown artifact
with machine-readable gate state, and a deterministic next-command function
reads that state and routes. The human's job collapses to three surfaces:

1. **PRs** — every change arrives as a PR carrying a static HTML review tour;
   you review by taking the tour and commenting on the PR. Your comments are
   the steering input.
2. **Backlog files** — `DEV.md`, `PLAN.md`, `DEBUG.md`, `INTERVIEW.md`,
   `MANUAL.md` stay the shared TODO surface between you and the agents. Agents
   update them; you can hand-edit them; `[locked]` lines are sacrosanct.
3. **The morning report** — after an overnight loop, a reconstructed-from-disk
   summary of what shipped, what failed and why, and what needs you.

No JIRA. No Confluence. No BMAD. Markdown + git is the entire state store.

## What "not vibe coding" means here

The engine's job is to make autonomy *reviewable*, at three altitudes:

- **Before code**: PRD → Design → Plan stages with mechanical, ID-traceable
  coverage gates (every goal maps to expectations, every expectation to a plan
  phase, every P0 expectation to a runnable check observed failing RED before
  implementation). You can't execute what hasn't passed its gates.
- **At code**: non-skippable adversarial self-review (the one BMAD discipline
  with 9-epics-deep evidence it catches real bugs every time), local CI on
  touched surfaces, remote CI as the merge gate.
- **At review**: the PR is not a raw diff — it's a guided tour with a decision
  ledger, dependency-ordered stops, verified call-chain trails, and blast
  radius. Reviewing well becomes cheap, so it actually happens.

## Principles carried forward from v1 (non-negotiable)

These survived 9 epics and are load-bearing. v2 keeps all of them:

1. **Spec files are the graph.** `<type>/<type>-<hash>-<timestamp>-<slug>.md`
   with frontmatter + append-only status log. The status log is the resume
   protocol.
2. **Backlog files + checkbox conventions** (`[ ]` `[/]` `[-]` `[x]` `~~…~~`),
   frontmatter status is truth, checkbox mirrors it.
3. **Three orthogonal axes** — mode × shape × thoroughness — cascade to every
   gate. YOLO relaxes gates, not code quality.
4. **Behavior-as-CLI-primitive, prose-as-passthrough.** Anything mechanical
   lives in the `devx` CLI as a pure function with adversarial tests; skill
   bodies stay thin and call it. (This is v1's promoted cross-epic pattern —
   v2 is essentially *finishing* it.)
5. **Source-of-truth precedence**: spec ACs > epic locked decisions > plan
   frontmatter > config > skill defaults; fix the loser.
6. **Worktree isolation** — one worktree per agent, branch names derived from
   config, never hardcoded.
7. **Coordination primitives** — `.devx-cache/` locks (O_EXCL), heartbeat,
   events; verify claim ownership before resuming.
8. **Ejectability** — `devx eject` must always work. v1 phrased this as "BMAD
   is a library, not a fork"; v2 re-phrases it as: *the engine is native, the
   state is plain markdown + git, and removing devx leaves a working repo with
   readable history.* (Formally re-decided in `07-decisions.md`.)
9. **No silent product decisions** — ambiguity goes to `INTERVIEW.md` with
   options and a recommendation.
10. **LEARN.md** — retros produce confidence/blast-radius-tagged lessons;
    ≥3-concordance promotes to cross-epic patterns; the system mutates slowly.

## What changes

| v1 (today) | v2 |
|---|---|
| Planning = `/devx-plan` invoking ~450–500KB of BMAD workflows (research → PRD → party-mode → readiness) | Planning = PRD / Design / Plan stages as flat skill bodies + `devx gate *` CLI checks; ~10–20KB loaded per stage |
| Execution = `/devx` invoking `bmad-dev-story` + `bmad-code-review` (story file skipped 43/43 times) | Execution = native execute stage working directly from spec ACs; adversarial review re-homed as a native skill + CLI-pinned status lines |
| Review = human reads a raw GitHub diff | Review = static HTML tour linked from the PR description; human comments on the PR; `/devx` addresses comments |
| Retro = `bmad-retrospective` (63KB) → LEARN.md rows | Retro = native retro stage (~5KB) → same LEARN.md contract, plus an outcome gate weeks after ship |
| `/devx` = dev-execution only; `/devx-plan` separate; no debug loop | `/devx` = universal dispatcher with intent routing; plan/design/execute/debug/review/loop are stages behind it |
| Overnight = manager spawns workers, but no iteration contract, no failure ladder, no budgets | Overnight = gnhf-grade loop: commit-or-reset iterations, 3-strike abort, token/iteration caps, morning report |
| sprint-status.yaml maintained at real cost, zero consumers | Retired. The spec graph + backlogs are the only tracking state |
| Works on this repo (bootstrap) | `devx init` makes any repo devx-able; the engine ships in the npm package |

## Success criteria for v2 as a whole

- **S-1**: A full feature travels PRD → Design → Plan → RED → Execute → PR with
  tour → merge with zero BMAD skill invocations and < 60KB of engine prose
  loaded across all stages combined.
- **S-2**: Every PR opened by `/devx` carries a working, self-contained review
  tour link; Leo reviews ≥1 real PR using only the tour + PR comments.
- **S-3**: An overnight `devx loop` run completes ≥3 backlog items unattended,
  with every failure either recovered or cleanly rolled back, and produces a
  morning report reconstructable from disk alone.
- **S-4**: `/devx` with no arguments, on a repo in any state (mid-plan, mid-epic,
  red CI, empty backlog), prints/does the correct next action per the
  next-command table — verified by a test matrix.
- **S-5**: `devx init` on a non-devx repo yields a working `/devx` in under two
  minutes, with no references to BMAD, JIRA, or Confluence anywhere in the
  scaffold.
