# devx v2 — The Plan Directory

**Created 2026-07-05.** This directory is the from-scratch plan for devx's second
architecture: BMAD out, a native lightweight engine in, static-HTML review tours
on every PR, a universal `/devx` dispatcher, and a gnhf-grade overnight loop.

Everything in here was synthesized from four deep-research passes run on
2026-07-05:

1. `mycase/8am-harness` — the lightweight workstream engine we're adopting the
   shape of (PRD → Design → Plan → RED gate → Execute, with deterministic gates).
2. `LeoTheMighty/code-review-tour` — the guided-tour review UI we're adapting
   into a self-contained static HTML artifact per PR.
3. `kunchenguid/gnhf` — the overnight-loop discipline ("good night, have fun")
   we're folding into the manager for trusted unattended operation.
4. This repo itself — an exact inventory of every BMAD touchpoint, what BMAD
   actually provides vs. dead weight, and the in-flight work to absorb.

## Reading order

| File | What it is |
|---|---|
| [`00-vision.md`](00-vision.md) | The end state: `/devx` anything, on any repo. Principles that survive from v1. |
| [`01-bmad-capture.md`](01-bmad-capture.md) | Full capture of the BMAD era — what it gave us, what we keep (as native disciplines), the exact migration & eject plan. |
| [`02-engine.md`](02-engine.md) | The new lightweight engine: stages, artifacts, IDs, gates, templates, CLI primitives. 8am-harness adapted, JIRA/Confluence stripped. |
| [`03-review-tour.md`](03-review-tour.md) | PR-as-review: the static HTML tour artifact generated per PR, hosting, and the human-input loop via PR comments. |
| [`04-overnight-loop.md`](04-overnight-loop.md) | The gnhf-derived unattended loop: iteration contract, failure ladder, budgets, morning report. |
| [`05-dispatcher.md`](05-dispatcher.md) | Universal `/devx`: intent routing (plan / design / execute / debug / review / loop), the next-command table, any-repo portability. |
| [`06-phases.md`](06-phases.md) | The phased buildout: V2.0 → V2.6, epic-level scope, dependencies, in-flight absorption (mgrret, roc101, mobile). |
| [`07-decisions.md`](07-decisions.md) | Decision ledger: locked, re-decided (vs. v1's locked decisions), and open questions needing user input. |

## The one-paragraph summary

devx v1 proved the outer loop: spec files + backlogs + claim/merge-gate/pr-body
CLI primitives + a `/devx` skill that ships PRs autonomously (1,309 tests, 9
epics, 43/43 stories shipped). But it rides on BMAD, which is wide-in-prose /
narrow-in-practice: only 3 of 51 skills are on the hot path, `bmad-create-story`
was skipped 43/43 times, and a single `/devx-plan` run loads ~450–500KB of BMAD
workflow prose. v2 replaces BMAD with a native engine in devx's own design
language (behavior-as-CLI-primitive + thin skill bodies): six ID-traceable
stages (PRD → Design → Plan → RED → Execute → Verify) with deterministic
mechanical gates, a static HTML **review tour** attached to every PR so human
review is a guided walkthrough instead of a raw diff, a **universal dispatcher**
so `/devx` on any repo knows whether to plan, design, execute, debug, or review
next, and an **overnight loop** with gnhf's transactional-git iteration
contract so the system can be trusted to work through the night and hand you a
reconstructable morning report.

## Ground rules for this directory

- These files are the v2 source of truth until superseded by emitted epics and
  spec files. v1 docs (`docs/DESIGN.md` etc.) remain authoritative for the
  running v1 system until each phase lands.
- Nothing in `v2/` modifies v1 behavior by existing. Migration happens through
  normal `/devx` PRs per `06-phases.md`.
- Decisions marked **[user]** in `07-decisions.md` need Leo's sign-off before
  the phase that consumes them starts.
