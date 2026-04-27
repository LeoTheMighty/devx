# CLAUDE.md — Agent context for the devx project

This file is loaded into every agent's context. Keep it short, scan-first, and
authoritative. When in doubt, read the linked source-of-truth file rather than
duplicating its contents here.

---

## What this project is

**devx is a closed-loop autonomous development system built on top of BMAD.** The
existing `/dev` and `/dev-plan` commands are excellent in isolation, but the
human is the glue between them. devx replaces the human glue with a filesystem
graph: every unit of work is a markdown spec file, every backlog is a markdown
file referencing those specs, agents read backlogs and append status to specs as
they work, and a supervisor agent (`ManageAgent`) keeps the loop running across
context rot.

This repo is **devx building itself** — the project is bootstrapping its own
tooling. Phase 0 (foundation) is in flight; the Phase 1 single-agent loop
(`/devx-plan`, `/devx`, minimal `/devx-manage`) lands next. Mobile companion app
runs in parallel from Phase 8.

Read `README.md` for the public pitch and `docs/DESIGN.md` for the full system
shape.

---

## Strategic axes (current settings)

These three knobs cascade to every gate, autonomy ladder, and ceremony in the
system. Source of truth: `devx.config.yaml`.

| Axis | Setting | Why |
|---|---|---|
| `mode` | **YOLO** | No real users; pre-launch dogfood. Move fast, ship on green, no soak. |
| `project.shape` | **empty-dream** | Bootstrapping; aggressive parallelism, tests-alongside not tests-first. |
| `thoroughness` | **send-it** | Minimum ceremony — skip party-mode unless ≥2 surfaces; LearnAgent threshold raised so the system mutates slowly while we move fast. |

Mode + shape + thoroughness combine — a YOLO + empty-dream + send-it project
runs minimum gates. See `docs/MODES.md` §2 for the per-subsystem behavior matrix
and `docs/DESIGN.md` §"Thoroughness levels" + §"Project shapes" for the
explanation of why three independent axes.

**Critical:** YOLO does not mean "no discipline." CI still runs, lint still
runs, tests still run. YOLO relaxes the *gates* (what blocks merge), not the
*code quality*. Coverage is informational; coverage opt-out per line is
`# devx:no-coverage <reason>`.

---

## Repo layout (what lives where)

```
<repo>/
├── README.md              ← public pitch
├── CLAUDE.md              ← you are here
├── DEV.md                 ← features-to-build backlog (drives /devx)
├── PLAN.md                ← planning-work-in-flight backlog (drives /devx-plan)
├── MANUAL.md              ← things only the user can do
├── INTERVIEW.md           ← questions for the user
├── devx.config.yaml       ← every knob; see docs/CONFIG.md
├── dev/                   ← spec files (one per DEV.md entry)
├── plan/                  ← spec files (one per PLAN.md entry)
├── docs/
│   ├── DESIGN.md          ← full system shape (load-bearing)
│   ├── MODES.md           ← what each mode does to each subsystem
│   ├── CONFIG.md          ← every knob's name, type, default, meaning
│   ├── ROADMAP.md         ← phased buildout, locked decisions, what we won't build
│   ├── MOBILE.md          ← Flutter companion contract
│   ├── SELF_HEALING.md    ← LearnAgent contract
│   ├── FOCUS_GROUP.md     ← persona panel contract
│   ├── QA.md              ← Layer-1 / Layer-2 split, exploratory QA
│   ├── COMPETITION.md     ← competitive analysis
│   ├── SETUP.md           ← installer notes
│   └── OPEN_QUESTIONS.md  ← unresolved design qs
├── focus-group/           ← persistent persona panel (personas, sessions, prompts)
├── _bmad/                 ← BMAD framework — never edited by devx code
└── _bmad-output/
    ├── planning-artifacts/    ← prd.md, architecture.md, epic-*.md
    └── implementation-artifacts/ ← sprint-status.yaml, story-*.md
```

Phase 8+ adds:
```
mobile/                 ← Flutter companion app (lib/, test/, ios/, android/, web/, macos/)
worker/                 ← Cloudflare Worker (webhook → FCM relay)
.worktrees/             ← live agent worktrees (gitignored)
.devx-cache/            ← events, locks, intents, heartbeat (gitignored)
.github/workflows/
  ├── devx-ci.yml
  ├── devx-promotion.yml
  └── devx-deploy.yml
```

---

## Branching model (this project: single-branch on `main`)

devx **recommends** a `develop`/`main` split with branch protection on `main`,
but it's optional. This project explicitly opted out per INTERVIEW Q#7
(`git.integration_branch: null`, `git.protect_main: false`) — pre-launch solo
YOLO doesn't need the ceremony. Read `docs/DESIGN.md` §"Branching model" for
the recommended shape and what changes when single-branch is chosen.

For this project specifically:

- **`main`** = the only long-lived branch. Not protected; agents and the user
  push to it (via PRs for CI, not direct push).
- **Feature branches** = `feat/<type>-<hash>`, one per spec file. Branched off
  `main`, PR'd back into `main`.
- **Worktrees** = `.worktrees/<type>-<hash>/` per agent. Agents never share a
  worktree.
- **No promotion gate.** The merge gate is the deploy gate. Mode rules
  (currently YOLO → CI green only) apply to every PR.

Backlog files live on `main` in the main worktree. Agents in a worktree write
status to the spec file in the main worktree via path-relative edits.

---

## Spec file convention

Every backlog item points at a file. Path encodes type + identity + time + slug:

```
<type>/<type>-<hash>-<timestamp>-<slug>.md
e.g. dev/dev-aud101-2026-04-26T19:35-bmad-modules-inventory.md
```

- `<type>` ∈ {`dev`, `plan`, `test`, `debug`, `focus`, `learn`, `qa`}
- `<hash>` = 6 random hex chars (unique handle, short enough to grep)
- `<timestamp>` = ISO 8601 local time, minute precision
- `<slug>` = kebab-case, ≤50 chars

Frontmatter carries `hash`, `type`, `created`, `title`, `from:` (parent), `spawned:`
(children), `status`, `owner`, `branch`. Body has Goal, Acceptance criteria,
Technical notes, Status log (append-only), Links. See `docs/DESIGN.md` §"Spec
file contents" for the canonical shape.

**Status log is append-only.** Agents add lines; they don't rewrite them. This
is the request history — where a thing came from, where it went.

### Checkbox conventions on backlog files

| Marker | Status | Behavior |
|---|---|---|
| `[ ]` | `ready` | claimable; `/devx` no-args picks the top one |
| `[/]` | `in-progress` | claimed by a worker; spec lock held |
| `[-]` | `blocked` | waiting on INTERVIEW / MANUAL / dependency |
| `[x]` | `done` | merged to the integration branch (this project: `main`) |
| `~~…~~` | `deleted` / abandoned | kept for audit |

The Status field in frontmatter is the source of truth; the checkbox mirrors
it. ManageAgent reconciles the two on every tick.

---

## Backlog files (the eight)

Each is a markdown file with a bullet list of spec-file references plus
human-readable context.

| File | Written by | Read by |
|---|---|---|
| `DEV.md` | PlanAgents (new), DevAgents (progress), ManageAgent (reprio) | DevAgents, TestAgents |
| `PLAN.md` | PlanAgents, ManageAgent | PlanAgents, user |
| `TEST.md` | DevAgents (gaps), TestAgents (progress), FocusAgent | TestAgents |
| `DEBUG.md` | anyone (DevAgent on CI red, FocusAgent, TestAgent on flake, user) | DebugAgents |
| `FOCUS.md` | FocusAgent, user | PlanAgents, DebugAgents |
| `INTERVIEW.md` | any agent when blocked on a human decision | the user |
| `MANUAL.md` | any agent when action requires a human | the user |
| `LESSONS.md` | LearnAgent, user (`--add`) | ManageAgent, user, mobile |

INTERVIEW.md = decisions the user must make. MANUAL.md = actions the user must
take. Don't conflate.

---

## How `/devx` runs (in this repo)

This project runs single-branch on `main` (per INTERVIEW Q#7). The /devx
skill is branch-model-aware; values below are this project's resolution.

1. **Claim**: pick top `[ ]` ready item from `DEV.md`, flip to `[/]`, set
   `status: in-progress`, append status log line. **Push the claim commit
   to `origin/main` before opening the PR** (otherwise main diverges and
   `pull --ff-only` fails post-merge — see
   `feedback_devx_push_claim_before_pr.md`).
2. **Worktree**: `git worktree add .worktrees/dev-<hash> -b feat/dev-<hash>
   main`.
3. **BMAD story**: `bmad-create-story` if no story file exists; otherwise
   read the existing one. *Empirically across all 4 Phase 0 epics this
   step has been skipped because spec ACs already cover what
   `bmad-create-story` would generate; the contract-vs-reality drift is
   tracked in `LEARN.md § epic-config-schema` E1 and pending a /devx
   skill update once concordance is sufficient.*
4. **Implement**: `bmad-dev-story`, red-green-refactor, all tasks/subtasks.
5. **Self-review**: `bmad-code-review` adversarially; fix all findings
   automatically; re-review.
6. **Local CI**: per `devx.config.yaml → projects:`, run lint/test/coverage on
   touched-surface projects only.
7. **Commit**: one commit per story; conventional-commit prefix; message links
   to spec + story.
8. **Push + PR to `main`**: PR body includes spec link, ACs as checkboxes,
   test plan, current mode.
9. **Wait remote CI**: poll with `gh run list ... --branch feat/dev-<hash>`;
   verify `headSha` matches; fix-forward on failure.
10. **Auto-merge** (YOLO): `gh pr merge --squash --delete-branch` after CI
    green. (Note: `--auto` alone requires "Allow auto-merge" repo setting
    which isn't on; the direct squash form is what works.)
11. **File gaps**: test gaps → `test/test-*.md` + `TEST.md`; bugs out of scope
    → `debug/debug-*.md` + `DEBUG.md`. Don't expand the current item's scope.
12. **Cleanup**: remove worktree, mark spec `done`, flip `DEV.md` checkbox to
    `[x]`, append PR URL inline.

Full contract: `.claude/commands/devx.md`.

---

## Working agreements (project-specific)

- **Don't duplicate business logic.** Wrap existing endpoints, tools,
  utilities. The whole devx pitch is "BMAD as a library, not a fork." Same
  applies to internal modules.
- **One commit per story / sub-task.** Atomic, reviewable. Don't bundle
  unrelated changes.
- **Fix forward.** If review finds issues, fix them in the same item; don't
  skip and don't open follow-up items for in-scope work.
- **Don't overwrite user-typed lines.** Anything marked `[locked]` in a backlog
  file is sacrosanct. Same for `MANUAL.md` items the user has hand-edited.
- **No silent product decisions.** When ambiguous, file an `INTERVIEW.md` entry
  with options and a recommendation; don't pick a default in code.
- **Never edit `_bmad/`.** BMAD is a library. devx writes to `_bmad-output/`
  and consumes BMAD workflows but never modifies them. `devx eject` must
  always work.
- **Mode change is a config edit.** To bump out of YOLO, run `/devx-mode beta`
  (once that skill lands) or edit `devx.config.yaml → mode:`. Don't add
  one-off mode-aware logic without updating `docs/MODES.md`.
- **Status log is append-only.** Add lines; don't rewrite history.
- **Worktrees are isolation, not staging.** Don't run a non-`/devx` flow inside
  a worktree; don't share a worktree across agents.
- **Self-review is non-skippable.** Every dev story runs `bmad-code-review`
  after implementation, fixes ALL findings (HIGH/MED/LOW) without asking,
  and re-runs to verify. Empirically (LEARN.md cross-epic patterns) this
  catches real semantics bugs every time across 5+ stories spanning all 4
  Phase 0 epics — it pays for itself on every run. Skip this step and
  load-bearing bugs ship.

---

## Quick references

- `docs/DESIGN.md` — read this first for the full system shape.
- `docs/CONFIG.md` — every knob in `devx.config.yaml`.
- `docs/MODES.md` — what each mode does to each subsystem.
- `docs/ROADMAP.md` — phased buildout + locked cross-epic decisions.
- `.claude/commands/devx.md` — `/devx` command spec (single-agent loop today;
  ManageAgent + parallelism arrive Phase 2–3).
- `_bmad-output/planning-artifacts/` — PRD, architecture, epic-*.md (the big
  BMAD-shaped files; spec files in `dev/` are the lightweight index on top).

---

## Status: Phase 0 — Foundation

Currently building the rails: `/devx-init`, config schema + CLI, OS supervisor
scaffolds, CLI skeleton, BMAD audit. See `DEV.md § Phase 0` for the 25 spec
files spawned across 5 epics. The Phase 1 closed loop comes next.
