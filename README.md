# devx — Developer Execute

**The only tool you need to get a project off the ground and keep it moving.**

`devx` is an opinionated execution harness built on top of the [BMAD Method](https://github.com/bmad-code-org) framework. It wires BMAD's planning, dev, and test workflows into a closed-loop system where a graph of parallel agents pick work off shared backlog files, hand results back, and keep your project running while you sleep.

The goal: one command (`/devx-init`) gets any repo — brand new or already shipping — onto the devx rails. From there, a small set of slash commands does the rest.

---

## Why devx exists

BMAD on its own gives you world-class planning (PRD → architecture → epics → stories) and a solid dev story executor, but:

- The loop is **not closed** — you run `/dev-plan`, then manually run `/dev <epic>` on each output. Planning and dev don't talk to each other without you in the middle.
- It's **too much menu for a solo dev** — BMAD's full agent set (analyst, PM, architect, SM, dev, QA, UX, tech writer, TEA) is powerful, but a first-time user sees a wall of options instead of a way in.
- **Testing, observability, and QA** live as separate concerns instead of being an always-on feedback signal the dev loop reads from.
- **Triage and prioritization** are implicit — there's no single place that says "here's what we're working on, here's what's next, here's what's blocked on you."

devx closes those gaps by treating the project as a graph of backlog files that agents read and write, with one boss agent (`/devx-triage`) keeping the graph honest.

---

## The commands

Every command is a thin shell over a BMAD workflow plus devx-specific opinions (worktrees, CI, coverage gates, observability hooks). All seven are installed as slash commands into `~/.claude/commands/` by `/devx-init`.

| Command | What it does | Writes to | Reads from |
|---|---|---|---|
| `/devx-init` | Walks a repo (empty or existing) onto the devx rails. Installs BMAD, sets up backlog files, configures CI/CD scaffolding, wires observability. The "simple guy to talk to" that BMAD's raw menu isn't. | everything, first-time | nothing |
| `/devx-plan` | Autonomous planning loop: requirements → research → PRD → architecture → epics → party-mode refinement. Same shape as the existing `/dev-plan`, but writes units of work directly into `DEV.md`, `INTERVIEW.md`, and `FOCUS.md` instead of leaving slugs on the floor. | `DEV.md`, `INTERVIEW.md`, `FOCUS.md`, `dev/plan-*.md` | requirements, repo state |
| `/devx` | Autonomous dev loop: picks the next item off `DEV.md`, implements it in a worktree, runs tests, opens a PR, waits for CI, merges. Same shape as the existing `/dev`, but driven by the backlog instead of an epic slug. | `DEV.md` (progress), `TEST.md`, `DEBUG.md` | `DEV.md`, plan file refs |
| `/devx-test` | Autonomous test authoring + audit loop. Enforces 100% coverage on touched surface. Reads test gaps from `TEST.md`, runs browser-agent QA on user flows, writes regressions to `DEBUG.md` on failure. | `TEST.md`, `DEBUG.md` | `DEV.md`, coverage reports, logs |
| `/devx-debug` | Autonomous debug loop. Reads `DEBUG.md` (bugs, flaky tests, production errors, user reports). Pulls logs/latency/DB state via the observability hooks. Reproduces, fixes, writes the regression test. | `DEBUG.md` (progress), `TEST.md` | `DEBUG.md`, production signals |
| `/devx-focus` | Focus-group / real-user feedback loop. Synthesizes patterns from user sessions (via observability) and targeted interviews (via `INTERVIEW.md` prompts). Output is items added back to `DEV.md` and `DEBUG.md`. | `DEV.md`, `DEBUG.md`, `INTERVIEW.md` | `FOCUS.md`, user telemetry |
| `/devx-triage` | The boss. Reads every backlog file, reconciles priorities, resolves conflicts, assigns owners (which agent type picks it up next), and decides what actually runs when parallel capacity opens up. Can be manually overridden. | every backlog file | every backlog file |
| `/devx-learn` | Self-healing loop. Scans the request graph for patterns (repeated questions, CI fails, user corrections), proposes lessons, and — gated by confidence — writes them back into skills, `CLAUDE.md`, project memory, config, or templates so the next agent doesn't repeat the work. | `LESSONS.md`, memory, skills, `CLAUDE.md`, config | every backlog, git log, skill-edit log |

---

## The backlog files

devx runs on eight top-level files at the project root. Each is both a human-readable document and a machine-readable backlog. Agents read and append; humans can edit directly.

| File | Owned by | Purpose |
|---|---|---|
| `DEV.md` | PlanAgents write → DevAgents execute | The "what to build" queue. Entries are references to `dev/dev-<hash>-<timestamp>-<slug>.md` spec files. |
| `PLAN.md` | PlanAgents | Planning work in progress — research questions open, epics being refined, architecture decisions pending. |
| `TEST.md` | DevAgents write → TestAgents execute | Test work: coverage gaps, missing e2e flows, flaky tests to stabilize. |
| `DEBUG.md` | anyone writes → DebugAgents execute | Bugs, production errors, failing CI runs, user-reported issues. |
| `FOCUS.md` | FocusAgent writes → PlanAgents read | Signals from real users: friction points, requested features, abandonment spots. |
| `INTERVIEW.md` | PlanAgents write → **user answers** | Questions the planner needs answered to move forward. The human's inbox. |
| `MANUAL.md` | any agent writes → **user executes** | Actions only a human can do: approve a cloud resource, paste a secret, review a sensitive PR, sign in to a third-party service. |
| `LESSONS.md` | LearnAgent writes → **user approves / auto-applies** | Learned improvements awaiting review: skill edits, CLAUDE.md additions, memory updates, config tweaks, template changes. Each is evidence-backed and gated by confidence. |

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

## The agent graph

```
                        ┌──────────────┐
                        │ /devx-triage │ ← the boss (rebalances priorities)
                        └───────┬──────┘
                                │ reads/reorders all backlogs
      ┌──────────────┬──────────┴────────┬──────────────┬──────────────┐
      ▼              ▼                   ▼              ▼              ▼
┌───────────┐  ┌───────────┐      ┌────────────┐  ┌────────────┐  ┌────────────┐
│ PlanAgent │  │ DevAgent  │      │ TestAgent  │  │ DebugAgent │  │ LearnAgent │
│ (parallel)│  │ (parallel)│      │ (parallel) │  │ (parallel) │  │ (idle time)│
└─────┬─────┘  └─────┬─────┘      └──────┬─────┘  └──────┬─────┘  └──────┬─────┘
      │ writes       │ writes           │ writes        │ writes        │ writes
      ▼              ▼                  ▼               ▼               ▼
  PLAN.md ───────→  DEV.md ────→    TEST.md  ────→  DEBUG.md       LESSONS.md
  INTERVIEW.md                                          ▲            │ applies to
  FOCUS.md                                              │            ▼
                                                  ┌─────┴──────┐  skills / CLAUDE.md /
                                                  │ FocusAgent │  memory / config /
                                                  │ (polls     │  templates
                                                  │  telemetry)│
                                                  └────────────┘
```
LearnAgent closes the loop back onto the system itself: it reads the whole request graph as training signal and edits the skills, project rules, memory, config, and templates so the next run is a little tighter.

Parallel agents operate in **worktrees on separate branches**, so two DevAgents working different items don't collide.

---

## Opinionated defaults

devx has strong opinions. Each can be overridden per-project, but the defaults are what make it fast.

### 1. Worktrees + branches + `develop`/`main` split

Every item a DevAgent picks up gets its own `git worktree` and a branch off `develop` (`develop/<type>-<hash>`). Two agents never share a working directory. Merges happen through PRs, not through shared mutation.

`main` is production — deployed, protected, only reached via an explicit **promotion gate** that runs extended checks before merging `develop → main`. Agents never push to `main`. The mobile app never pushes to `main`. This keeps production isolated from the churn of the work graph. See [`DESIGN.md § Branching model`](./DESIGN.md#branching-model).

### 2. CI/CD on day one

`/devx-init` sets up a CI pipeline (GitHub Actions by default) before any code is written. Agents **push branches and read CI results** rather than running the full test suite locally every time. This matters because:
- It's how the loop stays fast when agents run in parallel.
- It's the ground truth — local passes are no guarantee of CI passes, so let CI be the source of truth.
- It's the gate for merges — no CI, no merge.

### 3. Tests early, 100% coverage enforced

`/devx-init` wires a test runner and a coverage reporter, and adds a CI gate that blocks merges below 100% coverage on **touched surface** (not the whole codebase — that's pedantic). `/devx-test` keeps coverage green as `/devx` writes code.

### 4. Observability access

Agents need to see what real users experience. `/devx-init` wires access (read-only by default) to:
- Application logs
- Latency / error-rate metrics
- User flow / session replays
- A read replica of the DB

This is what makes `/devx-debug` and `/devx-focus` actually useful — they can reproduce, audit, and prioritize from real signal instead of guessing.

### 5. Browser agent for QA

A browser-driving agent (Playwright under the hood) operates the app the way a user would. `/devx-test` uses it for end-to-end flows; `/devx-focus` uses it to re-walk paths that real users got stuck on. This catches things unit tests never will.

### 6. Self-healing — the system learns from its own work

Every repeated question, CI failure, user correction, and flaky test is a signal. `/devx-learn` scans those signals, extracts a lesson, and writes it back into the system — into project memory, `CLAUDE.md`, skill files, config, or templates — so the next agent doesn't repeat the work. Gated by confidence + blast radius: personal-memory updates auto-apply; agent-prompt changes run a canary comparison and require explicit approval. See [`SELF_HEALING.md`](./SELF_HEALING.md).

---

## How it's different from raw BMAD

| | raw BMAD | devx |
|---|---|---|
| Planning → dev handoff | manual (`/dev-plan` → copy slug → `/dev <slug>`) | automatic via `DEV.md` |
| Agent coordination | one agent at a time, serial | parallel across worktrees, coordinated via backlog files |
| Test/debug loops | separate workflows | first-class commands with shared backlog |
| User feedback loop | not built in | `/devx-focus` + `FOCUS.md` |
| User input channel | ad-hoc inline questions | `INTERVIEW.md` / `MANUAL.md` — queued, async |
| Getting started | read all the BMAD docs, pick your agents, learn the menus | `/devx-init` |
| Observability | not addressed | first-class, wired by `/devx-init` |
| CI/CD | not addressed | scaffolded by `/devx-init` |

BMAD supplies the workflows, the personas, and the discipline. devx supplies the loop, the backlog, and the opinions that turn it into something you can leave running.

---

## Status

This repo is where devx itself is being built. We're using devx to build devx — `/devx-init` run against a fresh repo is both the first feature we ship and the first dogfood test.

See:
- [`SETUP.md`](./SETUP.md) — install BMAD + devx skills on your machine.
- [`DESIGN.md`](./DESIGN.md) — the backlog graph, filesystem layout, agent contracts, `develop`/`main` branching.
- [`MOBILE.md`](./MOBILE.md) — the Flutter companion app (iOS + Android + web + desktop), GitHub-as-backend, push notifications via a single Cloudflare Worker.
- [`SELF_HEALING.md`](./SELF_HEALING.md) — how `/devx-learn` turns repeated signals into memory/skill/config/template edits, with confidence gates and canary runs for risky changes.
- [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md) — design decisions still open (observability hosting, usage-limit handling, terminal control, BMAD integration audit).
