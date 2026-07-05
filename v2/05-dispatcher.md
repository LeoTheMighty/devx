# 05 — The Universal `/devx` Dispatcher

The end-state UX: **one command that knows when to plan, when to design, when
to execute, when to debug, and when to ask.** `/devx` stops being "the dev
loop" and becomes a thin router over the stages, with the dev loop as its
execute arm.

## 1. Entry forms

| Invocation | Routing |
|---|---|
| `/devx` | consult `devx next` (state-driven — §2) and do it |
| `/devx <hash\|slug>` | route by the spec's type + stage (a plan spec mid-design → design stage; a dev spec → execute; a debug spec → debug loop) |
| `/devx <free text>` | intent classification (§3) → create-or-route |
| `/devx prd\|design\|plan\|red\|execute\|verify\|revise\|address\|retro\|outcome\|review\|loop …` | explicit stage override — always available, dispatcher never traps you |

## 2. `devx next` — the state-driven decision table

A pure function (CLI, fully unit-tested — this is S-4's test matrix) over:
backlog files, spec frontmatter (stage + gate_status), open PRs, CI state,
`.devx-cache` locks/loop state. First match wins:

| # | Condition | Next action |
|---|---|---|
| 1 | a loop/manager run is live (heartbeat fresh) | report it; offer morning-review if a report landed overnight |
| 2 | own PR open with CI red | fix-forward on that branch |
| 3 | own PR open, CI green, unmerged | run merge-gate tail (respect `devx: hold`) |
| 4 | PR merged but spec/backlog not reconciled | cleanup phase (worktree, checkbox, status) |
| 5 | spec claimed by me, in-progress | resume it (after roc101 owner check) |
| 6 | INTERVIEW.md has unanswered items blocking ready work | surface them (`/devx-interview`) |
| 7 | DEBUG.md has ready items | top debug item → execute |
| 8 | DEV.md has ready items whose workstream gates pass | top item → execute |
| 9 | a workstream is mid-pipeline (any gate flag false, artifacts exist) | its next stage (prd → gate → design → …) |
| 10 | PLAN.md has ready plan items | start its PRD stage |
| 11 | nothing ready, blocked items exist | report blockers + owners |
| 12 | genuinely empty | propose: interview Leo for the next objective |

Row 8 before row 9 keeps shipping ahead of planning when both are available
(matches today's behavior); `--prefer plan` flips it. The skill body renders
the table's *output*; the table itself lives in the CLI so the dashboard,
mobile, and skill can never drift (the 8am-harness `next_command()` move).

## 3. Intent classification (free-text entry)

Thin prompt-level routing in the skill body — no ML ceremony. Signals:

- **Bug-shaped** ("broken", "500s", stack trace pasted, "why does…") →
  file `debug/debug-<hash>` spec + DEBUG.md entry → debug loop: reproduce
  first (a failing test = the RED artifact), then fix via execute stage.
- **Feature-shaped, small & unambiguous** (single surface, clear AC,
  ≤ ~1 phase of work) → file `dev/dev-<hash>` spec directly (stage-skip
  recorded as `entered_at: execute`) → execute. The dispatcher states its
  sizing call out loud; `/devx plan <it>` overrides.
- **Feature-shaped, large or vague** → `devx workstream new` → PRD stage
  (interview starts immediately with the free text as seed).
- **Question-shaped** ("how does X work", "what's left") → answer/status;
  file nothing unless asked.
- **Review-shaped** ("review PR 42", "address comments") → tour build /
  address stage.
- Ambiguity rule unchanged: silent product decisions are forbidden — when the
  route is genuinely unclear, ask (or INTERVIEW.md in unattended mode).

## 4. The debug loop (new stage, first-class)

DEBUG.md existed in v1 with no consumer skill. v2 wires it:

1. Intake: symptom → `debug/debug-<hash>` spec (Goal = expected behavior,
   ACs = "repro exists", "root cause documented", "fix + regression test").
2. **Reproduce before touching code**: a failing test or runnable repro
   script, committed — this *is* the RED gate for bugs.
3. Root-cause with evidence in the Status log (hypothesis → check → result).
4. Fix via the normal execute tail (worktree → PR + tour → merge). The tour's
   decision ledger carries the root-cause narrative — debug PRs become
   readable.
5. Learnings → LEARN.md candidates.

## 5. Any-repo portability

`devx init` (ini501–508, already shipped) is the porting surface. v2 changes:
- Scaffold gains `_devx/workstreams/` + engine templates + the `engine:` and
  `loop:` config blocks; drops the `npx bmad-method install` path entirely.
- The engine ships in the npm package (templates + CLI + skill bodies), so a
  fresh repo gets the full pipeline with zero framework installs — this is
  what makes "`/devx` any of my projects" real (S-5).
- Project shape (`empty-dream` / brownfield / etc.) tunes stage defaults:
  brownfield repos get `code_citation_hints` seeded from a quick structure
  scan; empty-dream repos start at PRD by default.

## 6. Updating the static TODO surfaces

"Update static files with the next TODOs" is already the v1 contract — v2
keeps the eight backlog files as the single TODO surface and tightens the
loop: every stage exit writes its follow-ups (next stage entry, spawned
specs, INTERVIEW/MANUAL items) *before* printing the next command, and
`devx next` reads only those files — so the printed next step and the files
can never disagree. The backlogs remain hand-editable; `[locked]` lines stay
sacrosanct.
