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
tooling. Phase 0 (foundation) closed 2026-04-27 with all 5 epics shipped +
retroed; the Phase 1 single-agent loop (`/devx-plan`, `/devx`, minimal
`/devx-manage`) lands next. Mobile companion app runs in parallel from
Phase 8.

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
   read the existing one. *Empirically across 8 shipped epics (Phase 0 +
   Phase 1's first 3 epics; 36/36 stories: aud × 3, cfg × 4, cli × 5, sup × 5,
   ini × 8, mrg × 3, prt × 2, pln × 6) this step has been skipped because
   spec ACs already cover what `bmad-create-story` would generate; the
   contract-vs-reality drift is tracked in `LEARN.md § Cross-epic patterns`
   and reaffirmed in every retro to date (audret + cfgret + cliret + supret
   + iniret + mrgret + prtret + plnret). The actual /devx skill change
   (enforce / make conditional / drop) remains user-review-required per
   `self_healing.user_review_required_for: [skills]`.*
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
  catches real semantics bugs every time across 8 shipped epics — all 5
  Phase 0 epics + Phase 1's first 3 epics (mrg + prt + pln). It pays for
  itself on every run. Skip this step and load-bearing bugs ship. The
  correct shape when there's nothing to fix is explicit-zero ("self-review
  found nothing actionable"), not omission — see `LEARN.md §
  epic-merge-gate-modes` E7. **For substantial-surface stories (>500 lines
  / multi-regex / marker-bearing), prefer 3-agent parallel adversarial
  review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) over
  single-pass** — promoted to a cross-epic pattern at plnret (prt102 + pln
  × 4 = 5 internal observations across 2 epics; pln104 was the first
  story to apply the threshold heuristic for single-pass on a 290-LoC
  surface). See `LEARN.md § Cross-epic patterns` row "3-agent parallel
  adversarial review."

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

## Status: Phase 0 — Foundation (closed 2026-04-27)

All 5 epics shipped + retroed: BMAD audit (PR #19 retro), config schema +
CLI (PR #20), CLI skeleton (PR #21), OS supervisor scaffold (PR #22),
`/devx-init` skill (PR #30). 25 parent stories across the 5 epics; +225
net tests in the ini epic alone (largest of any Phase 0 epic).

## Status: Phase 1 — Single-agent core loop (in flight, 3/5 epics shipped)

epic-merge-gate-modes shipped (PRs #31 mrg101 + #32 mrg102 + #33 mrg103 +
#34 mrgret). +92 net tests across the 3 stories. Delivers the single
mode-derived merge-gate primitive consumed by `/devx` Phase 8 today (via
`devx merge-gate <hash>`) and by the latent `/devx-manage` promotion path
when split-branch users arrive (`promoteIntegrationToDefault`). mrg102
specifically unblocks dvx101 + dvx106 in epic-devx-skill.

epic-pr-template shipped (PRs #35 prt101 + #36 prt102 + #37 prtret).
+46 net tests across the 2 stories (10 prt101 init-write tests +
36 prt102 substitution + CLI tests). Delivers the canonical
`pull_request_template.md` shipped via npm + idempotently written by
`/devx-init`, plus the `devx pr-body` CLI consumed by `/devx` Phase 7 at
PR-open time. prt102 specifically unblocks dvx101 + dvx106 in
epic-devx-skill. PR #36's body itself was rendered by `devx pr-body` —
the strongest possible AC 5 verification (the consumer ran on the same
PR, not the next one).

epic-devx-plan-skill shipped (PRs #38 pln101 + #39 pln102 + #40 pln103 +
#41 pln104 + #42 pln105 + #43 pln106 + this PR plnret). +207 net tests
across the 6 stories — 2nd-largest growth of any epic to date (ini was
+225 in Phase 0); largest of any Phase 1 epic so far. Delivers the
`/devx-plan` skill body wired to three new CLI primitives: `devx
plan-helper derive-branch <type> <hash>` (pln101 — kills the
hardcoded-`develop/dev-<hash>` regression class structurally), `devx
plan-helper emit-retro-story` (pln102 — co-emits all three retro
artifacts atomically; closes MP0.2), `devx plan-helper validate-emit
<epic-slug>` (pln103 — six structural checks + one warn-severity
heuristic; aborts the planning run on error). Phase 6 source-of-truth
override flow + Phase 6.5 mode predicate + Phase 8 Next-command block
format are all structurally pinned. plnret PR (this PR) is the third
Phase 1 retro PR; like every Phase 1 PR since prt102 merged it's
rendered via `devx pr-body` and gated via `devx merge-gate`.

2 epics remaining: epic-devx-skill (still fully unblocked: mrg102 ✓ +
prt102 ✓ + pln epic ✓), epic-devx-manage-minimal (blocked-by dvxret).
Mobile companion v0.1 runs in parallel from Phase 8.
