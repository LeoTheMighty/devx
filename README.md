# devx — Developer Execute

**The only tool you need to get a project off the ground and keep it moving.**

`devx` is an opinionated, self-contained execution harness with a native engine: PRD → Design → Plan → RED → Execute → Verify stages, mechanical gates as CLI primitives, judgment as thin skill bodies. It wires planning, dev, and test into a closed-loop system where a graph of parallel agents pick work off shared backlog files, hand results back, and keep your project running while you sleep. (devx began as a layer over the [BMAD Method](https://github.com/bmad-code-org); it ejected the framework once the native engine landed — the record is `v2/01-bmad-capture.md`.)

The goal: one command (`devx init`) gets any repo — brand new or already shipping — onto the devx rails. From there, a small set of slash commands does the rest.

---

## Quickstart

```bash
npm i -g @devx/cli          # or: git clone … && npm ci && npm run install:global
cd <your-repo>
devx init                   # scaffolds config, backlogs, CI, skills, hooks
```

Then open Claude Code in that repo and run `/devx`. With no arguments it reads
repo state and tells you the next move. Full walkthrough, including `--global`
skill installs and the upgrade path: [`SETUP.md`](./docs/SETUP.md).

---

## Why devx exists

Agentic planning/dev frameworks give you good planning artifacts (PRD → design → epics) and a solid dev executor, but (as devx learned first-hand building on BMAD):

- The loop is **not closed** — you run a planning command, then manually run a dev command on each output. Planning and dev don't talk to each other without you in the middle.
- It's **too much menu for a solo dev** — a full agent set (analyst, PM, architect, SM, dev, QA, UX, tech writer, test architect) is powerful, but a first-time user sees a wall of options instead of a way in.
- **Testing, observability, and QA** live as separate concerns instead of being an always-on feedback signal the dev loop reads from.
- **Scheduling and prioritization** are implicit — there's no single place that says "here's what we're working on, here's what's next, here's what's blocked on you."

devx closes those gaps by treating the project as a graph of backlog files that agents read and write, with a dispatcher (`/devx`) that decides what to do next from repo state, and an unattended runner (`devx loop`) that keeps going while you sleep.

---

## The commands

Five slash commands, each a thin skill body over the native engine's stages and
the `devx` CLI gates. `devx init` installs them into `<repo>/.claude/commands/`
(or `~/.claude/commands/` with `--global`).

| Command | What it does | Writes to | Reads from |
|---|---|---|---|
| `/devx` | The universal dispatcher. No args → `devx next` reads repo state and does what it calls for: plan, execute, debug, review, or merge-tail. A hash routes by spec type + stage; free text routes by intent. The execute arm runs the full loop: claim → implement → self-review → local CI → PR → remote CI → merge → cleanup. | `DEV.md`, `TEST.md`, `DEBUG.md`, spec status logs | every backlog, spec frontmatter, CI |
| `/devx-plan` | Planning stages PRD → Design → Plan → RED, gated by `devx gate prd/coverage/evals`. Consumes a workstream, a `PLAN.md` item, or raw requirements; emits dev specs + `DEV.md` rows that `/devx` can execute. | `DEV.md`, `PLAN.md`, `_devx/workstreams/<slug>/` | requirements, repo state |
| `/devx-test` | Attended exploratory QA (`docs/QA.md` Layer 2). Drives a real Chrome session against a local build, walks the journeys a user would walk, routes findings out. | `TEST.md`, `DEBUG.md` | running app, `DEV.md` |
| `/devx-learn` | Self-improvement loop. Mines a session for lessons, lays them out as an evidence table, and routes each surviving finding to its destination — skills, `CLAUDE.md`, config, or `LEARN.md`. | `LEARN.md`, skills, `CLAUDE.md`, config | session transcript, git log |
| `/devx-interview` | Walks unanswered `[ ]` questions in `INTERVIEW.md` one at a time, writes the `→ Answer:` line, and propagates the answer into each blocked spec. | `INTERVIEW.md`, blocked specs | `INTERVIEW.md` |
| `/devx-walk` | The health queue's resolver — one blocker per invocation. Picks by a fixed rule, digs against code truth, proposes in plan mode, routes the resolution back to whoever wrote the entry. Where `/devx-interview` *asks*, this *investigates*. | backlog rows, `INTERVIEW.md`, `MANUAL.md`, spec status logs | blocked specs, git history, code |
| `/devx-personalize` | The preference interview. Answers a bounded bank (`docs/PERSONALIZATION.md`) across four scopes and refuses anything that would loosen a gate. Every writing skill blocks until the core bank is answered. | `~/.claude/devx/`, `devx.config.yaml` | `docs/PERSONALIZATION.md` |

Everything else is the `devx` CLI rather than a slash command — `devx init`,
`devx next`, `devx loop` (unattended overnight runs), `devx graph`,
`devx merge-gate`, `devx outcome`, `devx learn-watch`. Run `devx --help` for
the full surface.

> **Story graph.** [`GRAPH.md`](./GRAPH.md) is a generated Mermaid board of
> every spec and its blocking edges, grouped by workstream. Regenerate with
> `devx graph`; `devx graph --check` fails on drift. Scope a readable slice
> with `devx graph --workstream <slug> --stdout`.

---

## The backlog files

devx runs on eight top-level files at the project root. Each is both a human-readable document and a machine-readable backlog. Agents read and append; humans can edit directly.

| File | Owned by | Purpose |
|---|---|---|
| `DEV.md` | PlanAgents write → DevAgents execute | The "what to build" queue. Entries are references to `dev/dev-<hash>-<timestamp>-<slug>.md` spec files. |
| `PLAN.md` | PlanAgents | Planning work in progress — research questions open, epics being refined, architecture decisions pending. |
| `TEST.md` | DevAgents write → TestAgents execute | Test work: coverage gaps, missing e2e flows, flaky tests to stabilize. |
| `DEBUG.md` | anyone writes → DebugAgents execute | Bugs, production errors, failing CI runs, user-reported issues. |
| `INTERVIEW.md` | PlanAgents write → **user answers** | Questions the planner needs answered to move forward. The human's inbox. |
| `MANUAL.md` | any agent writes → **user executes** | Actions only a human can do: approve a cloud resource, paste a secret, review a sensitive PR, sign in to a third-party service. |
| `LEARN.md` | `/devx-learn` writes → **user reviews + applies** | Retrospective findings — what to change about the spec template, skill prompts, `CLAUDE.md`, config, or docs. Tagged with confidence + blast radius; low-blast items applied immediately. |
| `GRAPH.md` | generated by `devx graph` | Mermaid board of every spec and its blocking edges, grouped by workstream. Never hand-edited; `devx graph --check` fails on drift. |

Every item in every backlog is a one-line entry pointing at a detailed spec file under `dev/`, `plan/`, `test/`, etc. The spec file is the full context; the backlog entry is just the handle.

### Entry shape

```markdown
- `dev/dev-a3f2b9-2026-04-23T14:22-add-oauth-google.md` — [in-progress by DevAgent-7] Add Google OAuth to login. Blocked on INTERVIEW q about redirect URI.
```

### Request history lives in the filesystem

No database. Every request gets its own file that tracks where it came from, where it went, and what happened:

```
dev/
  dev-a3f2b9-2026-04-23T14:22-add-oauth-google.md
    → spawned by: plan/plan-9c1d4a-epic-auth.md
    → spawned: test/test-f8e2a1-oauth-callback-coverage.md
    → status log (appended, not overwritten):
         [2026-04-23T14:22] created by PlanAgent-3
         [2026-04-23T14:25] picked up by DevAgent-7
         [2026-04-23T14:28] blocked — see INTERVIEW.md q#4
         [2026-04-23T15:10] unblocked — user answered
         [2026-04-23T15:45] implementation complete, PR #142
         [2026-04-23T15:50] test gaps written to test/test-f8e2a1-...
```

Because it's all files, `git log` is your audit trail, and you can `grep` across the whole history of any request.

---

## How the loop actually runs

```
                    devx next            ← reads repo state, picks the move
                        │
                        ▼
   ┌──────────────────/devx──────────────────┐   the universal dispatcher
   │  plan · execute · debug · review · tail │
   └────────────────────┬────────────────────┘
                        │ execute arm, one item at a time
                        ▼
   claim → worktree → implement → self-review → local CI
                        → PR → remote CI → merge → cleanup
                        │
                        ▼
   DEV.md / DEBUG.md / TEST.md rows flip, spec status logs append

   devx loop            ← the same arm, unattended, under budgets
   Stop/SessionEnd hooks → learn-queue → devx learn-watch → /devx-learn
                                         (mines sessions, edits the system)
```

One dispatcher, not a fleet. `/devx` decides what to do from repo state and
does it; `devx loop` runs that same arm unattended under item, iteration, and
token budgets, writing a morning report. Work happens in **worktrees on
separate branches**, so concurrent items can't collide, and a spec's status
log carries enough context that any session can resume any other's job.

The learn loop closes back onto the system itself: Claude Code hooks record
finished sessions, `devx learn-watch` replays each one into `/devx-learn`, and
that edits the skills, project rules, and config so the next run is tighter.

> A larger control plane (a supervisor scheduling parallel worker agents, plus
> a concierge for user I/O) is designed in [`DESIGN.md`](./docs/DESIGN.md) and
> partially built under `src/lib/manage/`, but it is **not** what ships today.
> Today the surface is the five slash commands plus the `devx` CLI.

---

## Opinionated defaults

devx has strong opinions. Each can be overridden per-project, but the defaults are what make it fast.

### 0. Mode — one knob that tunes every gate

Every project runs in one of four modes: **YOLO**, **BETA**, **PROD**, or **LOCKDOWN**. The discriminator is "do we have user data whose integrity matters?" Set at `devx init`, changed by editing `devx.config.yaml → mode:`, and cascades to every other subsystem: promotion gates, autonomy ladder, self-healing auto-apply ceilings, focus-group block thresholds, coverage requirements, exploratory QA cadence, DB operations, agent parallelism, mobile-app permissions. Going up in risk is cheap; going down is deliberate and logged. See [`MODES.md`](./docs/MODES.md).

### 1. Worktrees + branches + `develop`/`main` split

Every item a DevAgent picks up gets its own `git worktree` and a branch off `develop` (`develop/<type>-<hash>`). Two agents never share a working directory. Merges happen through PRs, not through shared mutation.

`main` is production — deployed, protected, only reached via an explicit **promotion gate** that runs extended checks before merging `develop → main`. Agents never push to `main`. The mobile app never pushes to `main`. This keeps production isolated from the churn of the work graph. See [`DESIGN.md § Branching model`](./docs/DESIGN.md#branching-model).

### 2. CI/CD on day one

`devx init` sets up a CI pipeline (GitHub Actions by default) before any code is written. Agents **push branches and read CI results** rather than running the full test suite locally every time. This matters because:
- It's how the loop stays fast when agents run in parallel.
- It's the ground truth — local passes are no guarantee of CI passes, so let CI be the source of truth.
- It's the gate for merges — no CI, no merge.

### 3. Tests early, 100% coverage enforced

`devx init` wires a test runner and a coverage reporter, and adds a CI gate that blocks merges below 100% coverage on **touched surface** (not the whole codebase — that's pedantic). `/devx-test` keeps coverage green as `/devx` writes code.

### 4. Observability access

Agents need to see what real users experience. `devx init` wires access (read-only by default) to:
- Application logs
- Latency / error-rate metrics
- User flow / session replays
- A read replica of the DB

This is what makes the dispatcher's debug arm useful — it can reproduce and audit from real signal instead of guessing.

### 5. Browser agent for QA — two layers

- **Regression layer:** scripted Playwright tests, written by `TestAgent`, run in CI on every `develop` PR. Deterministic, $0, per-PR gate.
- **Exploratory layer:** LLM-driven browser agent (browser-use by default) runs against preview deploys on a nightly cadence. Finds UX pain a regression suite wouldn't. Runs as a subprocess with its own Anthropic API key — does **not** touch your Claude Code usage window.

See [`QA.md`](./docs/QA.md).

### 6. Self-healing — the system learns from its own work

Every repeated question, CI failure, user correction, and flaky test is a signal. `/devx-learn` scans those signals, extracts a lesson, and writes it back into the system — into project memory, `CLAUDE.md`, skill files, config, or templates — so the next agent doesn't repeat the work. Gated by confidence + blast radius: personal-memory updates auto-apply; agent-prompt changes run a canary comparison and require explicit approval. See [`SELF_HEALING.md`](./docs/SELF_HEALING.md).

### 7. Persistent user focus group — personas you can actually ask

`devx init` seeds a panel of 4–6 detailed user personas (plus one explicit anti-persona) stored as markdown files in `focus-group/`. Party-mode covers team lenses (PM, UX, backend); the focus group covers the user lens. The panel is a prompt + persona set you invoke deliberately; wiring it automatically into every epic and promotion is designed, not built. The interaction primitive (reactions → concerns → priorities panel flow) was seeded from BMAD's "User Persona Focus Group" elicitation method and is now a native devx prompt; the devx contribution is making it stateful and wired into every decision. See [`FOCUS_GROUP.md`](./docs/FOCUS_GROUP.md).

---

## How it's different from raw BMAD (devx's origin)

devx was built on BMAD through its first two phases; the comparison below is why the loop existed at all, and it still holds against any workflow-menu framework:

| | raw BMAD | devx |
|---|---|---|
| Planning → dev handoff | manual (`/dev-plan` → copy slug → `/dev <slug>`) | automatic via `DEV.md` |
| Agent coordination | one agent at a time, serial | parallel across worktrees, coordinated via backlog files |
| Test/debug loops | separate workflows | first-class commands with shared backlog |
| User feedback loop | not built in | persona panel under `focus-group/` (designed; no command yet) |
| User input channel | ad-hoc inline questions | `INTERVIEW.md` / `MANUAL.md` — queued, async |
| Getting started | read all the BMAD docs, pick your agents, learn the menus | `devx init` |
| Observability | not addressed | first-class, wired by `devx init` |
| CI/CD | not addressed | scaffolded by `devx init` |

BMAD supplied the workflows, the personas, and the discipline during the bootstrap; devx captured what was load-bearing as native disciplines (`v2/01-bmad-capture.md`) and now supplies the whole stack itself — the engine, the loop, the backlog, and the opinions that turn it into something you can leave running.

---

## Honest ROI

The promises, with real numbers:

- **5 minutes to initialized.** `devx init` is non-interactive; `--global` installs the skills once for every repo.
- **30 minutes to first real payoff.** Your first feature shipped via the closed loop.
- **~2 weeks to felt benefit.** Self-healing starts applying your preferences; the system feels lighter each week.
- **~1 month to "I can't build any other way."** The mobile companion is ambient, exploratory QA catches UX pain before users do, promotion cadence has settled.

**Lock-in risk:** low. If you ever want to leave, run `devx eject` — `.devx-cache/` and `.worktrees/` are removed, the devx slash commands are uninstalled, and you're left with a working repo with readable history, backlogs, specs, and workstream artifacts. Markdown + git are ground truth; learned CLAUDE.md rules stay. Nothing is proprietary.

## Status

This repo is where devx itself is being built. We're using devx to build devx — `devx init` run against a fresh repo is both the first feature we ship and the first dogfood test.

Phases 0–1 (foundation + single-agent loop) shipped on the BMAD bootstrap; the v2 migration replaced it with the native engine (`v2/`). The BMAD-era planning artifacts — including the founding [`product-brief.md`](./_bmad-output/planning-artifacts/product-brief.md) — are frozen read-only under `_bmad-output/`. Current planning happens in `_devx/workstreams/`.

See:
- [`SETUP.md`](./docs/SETUP.md) — install devx on your machine.
- [`DESIGN.md`](./docs/DESIGN.md) — the backlog graph, filesystem layout, agent contracts, control plane, observability surfaces, `develop`/`main` branching.
- [`CONFIG.md`](./docs/CONFIG.md) — every configurable knob (capacity, permissions, git strategy, promotion gates, notifications, UI), what `devx init` scaffolds vs. defaults.
- [`ROADMAP.md`](./docs/ROADMAP.md) — phased buildout plan, locked decisions, dependency graph, what we won't build. Backlog state itself lives in `PLAN.md` at root.
- [`MODES.md`](./docs/MODES.md) — YOLO / BETA / PROD / LOCKDOWN and how each one tunes every gate in the system.
- [`MOBILE.md`](./docs/MOBILE.md) — the Flutter companion app (iOS + Android + web + desktop), GitHub-as-backend, push notifications via a single Cloudflare Worker.
- [`FOCUS_GROUP.md`](./docs/FOCUS_GROUP.md) — persistent user-persona panel consulted throughout planning, shipping, and iteration. The user lens to complement party-mode's team lenses.
- [`QA.md`](./docs/QA.md) — the two-layer browser QA subsystem: scripted Playwright for regressions, subprocess-spawned browser-use for exploratory UX pain hunting.
- [`SELF_HEALING.md`](./docs/SELF_HEALING.md) — how `/devx-learn` turns repeated signals into memory/skill/config/template edits, with confidence gates and canary runs for risky changes.
- [`OPEN_QUESTIONS.md`](./docs/OPEN_QUESTIONS.md) — design decisions still open (observability hosting, usage-limit handling, terminal control).
- [`NOTES.md`](./docs/NOTES.md) — Leonid's raw scratchpad; periodically batch-absorbed into the formal docs above.
