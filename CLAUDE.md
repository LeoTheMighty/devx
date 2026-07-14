# CLAUDE.md — Agent context for the devx project

This file is loaded into every agent's context. Keep it short, scan-first, and
authoritative. When in doubt, read the linked source-of-truth file rather than
duplicating its contents here.

---

## What this project is

**devx is a self-contained closed-loop autonomous development system with a
native engine (`v2/`).** Planning and dev commands are excellent in isolation,
but the human is usually the glue between them. devx replaces the human glue
with a filesystem graph: every unit of work is a markdown spec file, every
backlog is a markdown file referencing those specs, agents read backlogs and
append status to specs as they work, and a supervisor agent (`ManageAgent`)
keeps the loop running across context rot. The engine — PRD → Design → Plan →
RED → Execute → Verify stages, mechanical gates as CLI primitives, judgment as
thin skill bodies — ships inside the devx package; there is no third-party
framework underneath. (devx bootstrapped on BMAD through Phases 0–1; the
capture and ejection record is `v2/01-bmad-capture.md`.)

This repo is **devx building itself** — the project is bootstrapping its own
tooling. Phase 0 (foundation) closed 2026-04-27 with all 5 epics shipped +
retroed; Phase 1 (single-agent loop) closed 2026-07-05 at 5/5 epics; the v2
migration (native engine, review tours, dispatcher, overnight loop) is in
flight. Mobile companion app runs in parallel from Phase 8.

Read `README.md` for the public pitch, `docs/DESIGN.md` for the full system
shape, and `v2/README.md` + `v2/02-engine.md` for the native engine.

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
├── v2/                    ← native-engine design docs (engine, tours, loop, decisions)
├── _devx/
│   ├── workstreams/       ← engine workstream artifacts (prd/design/plan/evals per slug)
│   ├── templates/engine/  ← stage templates shipped in the npm package
│   └── config-schema.json ← devx.config.yaml JSON schema
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
└── _bmad-output/          ← frozen BMAD-era archive (read-only; never rewritten)
    ├── planning-artifacts/    ← prd.md, epic-*.md from Phases 0–1
    └── implementation-artifacts/ ← sprint-status.yaml (retired), retro files
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
3. **Working artifacts (v2 — spec ACs direct)**: the spec's acceptance
   criteria ARE the working artifact; there is no intermediate story file.
   (The story-file step was retired at v2x101 after the skip pattern held
   49/49 stories across all 10 BMAD-era epics; see `v2/01-bmad-capture.md`.)
   If the spec belongs to a workstream, read
   `_devx/workstreams/<slug>/plan.md` for this phase's Verification plan;
   `tests-first` phases re-run their already-RED artifact and watch it fail
   NOW, before writing code.
4. **Implement (native discipline)**: work directly from spec ACs +
   workstream context; red-green-refactor; execute ALL ACs/tasks with no
   milestone stops; maintain a File List for the PR body and review.
5. **Self-review (adversarial, native)**: hunt semantics bugs, not lint;
   audit the diff against every spec AC; fix ALL findings automatically;
   re-review. 3-agent parallel shape at the substantial-surface threshold
   (see Working agreements below); explicit-zero status-log line when clean.
6. **Local CI**: per `devx.config.yaml → projects:`, run lint/test/coverage on
   touched-surface projects only.
7. **Commit**: one commit per story; conventional-commit prefix; message links
   to the spec file.
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
  utilities — the same principle that kept BMAD a library rather than a fork,
  now applied to devx's own internals. Same applies across internal modules.
- **One commit per story / sub-task.** Atomic, reviewable. Don't bundle
  unrelated changes.
- **Fix forward.** If review finds issues, fix them in the same item; don't
  skip and don't open follow-up items for in-scope work.
- **Don't overwrite user-typed lines.** Anything marked `[locked]` in a backlog
  file is sacrosanct. Same for `MANUAL.md` items the user has hand-edited.
- **No silent product decisions.** When ambiguous, file an `INTERVIEW.md` entry
  with options and a recommendation; don't pick a default in code.
- **Ejectability is sacrosanct (D-2).** The engine is native and ships in the
  devx package; markdown + git are ground truth; `devx eject` leaves a working
  repo with readable history, backlogs, specs, and workstream artifacts.
  `_bmad-output/` is a frozen BMAD-era archive — read-only, never rewritten;
  links in shipped specs must keep resolving.
- **Mode change is a config edit.** To bump out of YOLO, run `/devx-mode beta`
  (once that skill lands) or edit `devx.config.yaml → mode:`. Don't add
  one-off mode-aware logic without updating `docs/MODES.md`.
- **Status log is append-only.** Add lines; don't rewrite history.
- **Worktrees are isolation, not staging.** Don't run a non-`/devx` flow inside
  a worktree; don't share a worktree across agents.
- **Verify claim ownership before resuming.** A spec marked `in-progress` with
  an existing `.worktrees/dev-<hash>/` is **not** necessarily yours. The
  structural check shipped with roc101 (PR #60): `/devx` Phase 1's
  resume-detection branch runs `devx devx-helper verify-claim <hash>
  --session-token ...` before any worktree edit and HALTS on an ownership
  mismatch — never pass a token copied from the spec's `owner:` frontmatter or
  the lock file (that trivially always matches and defeats the check). Any
  non-`/devx` flow touching an in-progress spec applies the same rule
  manually: check `.devx-cache/locks/spec-<hash>.lock` and halt if the
  recorded session token isn't yours. Why: a fresh post-`/clear` session can
  otherwise silently stomp on a live peer's work — the 2026-05-07 dvxret
  resume-collision incident. See `LEARN.md § epic-devx-skill` E13.
- **Self-review is non-skippable.** Every dev story runs the native Phase 4
  adversarial self-review after implementation, fixes ALL findings
  (HIGH/MED/LOW) without asking,
  and re-runs to verify. Empirically (LEARN.md cross-epic patterns) this
  catches real semantics bugs every time across all 10 shipped epics — all 5
  Phase 0 epics + all 5 Phase 1 epics (mrg + prt + pln + dvx + mgr). It pays
  for itself on every run. Skip this step and load-bearing bugs ship. The
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
- `v2/README.md` + `v2/02-engine.md` — the native engine (stages, gates,
  workstreams); `v2/07-decisions.md` — the v2 decision ledger.
- `docs/CONFIG.md` — every knob in `devx.config.yaml`.
- `docs/MODES.md` — what each mode does to each subsystem.
- `docs/ROADMAP.md` — phased buildout + locked cross-epic decisions
  (Phases 2+ re-cut by `v2/06-phases.md`).
- `.claude/commands/devx.md` — `/devx` command spec (execute loop + retro
  stage); `.claude/commands/devx-plan.md` — planning stages (PRD → Design →
  Plan → RED).
- `_devx/workstreams/<slug>/` — engine workstream artifacts (prd.md,
  design.md, plan.md, evals/); spec files in `dev/` remain the lightweight
  index on top.
- `_bmad-output/` — frozen BMAD-era archive (Phases 0–1 planning +
  implementation artifacts; read-only).

---

## Status: Phase 0 — Foundation (closed 2026-04-27)

All 5 epics shipped + retroed: BMAD audit (PR #19 retro), config schema +
CLI (PR #20), CLI skeleton (PR #21), OS supervisor scaffold (PR #22),
`/devx-init` skill (PR #30). 25 parent stories across the 5 epics; +225
net tests in the ini epic alone (largest of any Phase 0 epic).

## Status: Phase 1 — Single-agent core loop (closed 2026-07-05, 5/5 epics shipped + retroed)

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
#41 pln104 + #42 pln105 + #43 pln106 + #44 plnret). +207 net tests
across the 6 stories — 2nd-largest growth of any epic to date (ini was
+225 in Phase 0). Delivers the `/devx-plan` skill body wired to three
new CLI primitives: `devx plan-helper derive-branch <type> <hash>`
(pln101 — kills the hardcoded-`develop/dev-<hash>` regression class
structurally), `devx plan-helper emit-retro-story` (pln102 — co-emits
all three retro artifacts atomically; closes MP0.2), `devx plan-helper
validate-emit <epic-slug>` (pln103 — six structural checks + one
warn-severity heuristic; aborts the planning run on error). Phase 6
source-of-truth override flow + Phase 6.5 mode predicate + Phase 8
Next-command block format are all structurally pinned.

epic-devx-skill shipped (PRs #45 dvx101 + #46 dvx102 + #47 dvx103 + #48
dvx104 + #49 dvx105 + #50 dvx106 + #51 dvx107 + this PR dvxret). +255
net tests across the 7 stories — **largest growth of any Phase 1 epic**
(mrg ~92, prt ~46, pln ~207); within Phase 0+1 only ini's +225 was
previously the high-water mark. Delivers the v1 `/devx` skill body
wired through 5 new CLI primitives: `devx devx-helper claim`
(dvx101 — atomic 6-step claim with rollback; closes
`feedback_devx_push_claim_before_pr.md` structurally), `devx
devx-helper should-create-story` (dvx102 — canary-gated Phase 2
conditional, ships off; closes the LEARN cross-epic 43/43 silent-skip
contract), `devx devx-helper await-remote-ci`
(dvx105 — three-state remote-CI probe with ScheduleWakeup polling),
`devx merge-gate <hash>` enriched with `advice` array routing
(dvx106 — Phase 8 dispatch removes per-mode "Behavior by mode" table
from skill body entirely), `parseHandoffSnippet` test-only validator
(dvx107 — pins skill-body Handoff Snippet template against silent
prose drift). Plus `coverageTouchedGate` (dvx104, library-only) and
`Phase 4 status-log discipline test` (dvx103 — frozen pre-discipline
grandfather list). dvxret PR (this PR) is the fourth Phase 1 retro
PR; every Phase 1 PR since prt102 merged is rendered via `devx
pr-body` and gated via `devx merge-gate`. Filed `dev-roc101` follow-up
(resume-detection / verify-claim) as load-bearing for Phase 2's
mgr104 worker-spawn discipline — see LEARN.md § epic-devx-skill E13.

epic-devx-manage-minimal shipped (PRs #53 mgr101 + #54 mgr102 + #55
mgr103 + #56 mgr104 + #57 mgr105 + #58 mgr106 + mgrret). +263 net tests
across the 6 stories (1046 → 1309) — **largest growth of any epic to
date** (dvx +255, ini +225). All six stories shipped in a single
calendar day (2026-05-07, ~7h45m) — the fastest multi-story epic by
wall-clock. Delivers the v0 `/devx-manage` scheduler under
`src/lib/manage/`: `devx manage --once` single-tick CLI + loop driver
(mgr101), atomic tmp+rename state persistence for
schedule/manager/heartbeat JSON with crash-mid-write recovery (mgr102),
pure `reconcile()` + shared backlog parser `src/lib/backlog/parse.ts`
with `HARD_CAP_PHASE_1 = 1` (mgr103), detached `claude /devx <hash>`
worker spawn with log rotation (mgr104), crash backoff + max-restarts
gate + manager-restart PID-recovery (mgr105), and O_EXCL manager lock
with stale-PID + PID-recycling cross-check + SIGTERM-clean drain
(mgr106). First epic where every story used 3-agent parallel
adversarial review (~97 unique actionable findings, all fixed
in-place). mgrret (retro PR) promoted "atomic state writes via
tmp+rename" to `LEARN.md § Cross-epic patterns` (sup + ini + pln + mgr
= 4 epics) and wired `npm run typecheck` into the local `npm test`
gate (closes the twice-recurring typecheck-only CI-red class from
mgr102 + mgr104).

**Phase 1 is closed — and with it the BMAD era.** Phase 1 totals: 24
parent stories + 5 retros, +863 net tests (mrg ~92 + prt ~46 + pln ~207
+ dvx ~255 + mgr ~263). mgrret is the FINAL BMAD-era retrospective;
sprint-status.yaml received its last touch in the mgrret PR. Next work
happens under the v2 migration (`v2/README.md`: native engine, review
tours, universal dispatcher, overnight loop); `dev-roc101`
(verify-claim) shipped via PR #60 concurrently with the mgrret retro
and is inherited by the v2 dispatcher.
Mobile companion v0.1 runs in parallel from Phase 8.

## Status: v2 migration (closed 2026-07-05 — planned AND shipped in one day)

All 10 items merged, PRs #59–#68: v2s101 engine templates (#59), roc101
verify-claim (#60), mgrret final BMAD retro (#61), v2e101 gate CLIs
(#62), v2e102 planning stages + first real gate run (#63), v2x101 BMAD
ejection (~950 files deleted, `/devx` native, `engine:`/`loop:` config)
(#64), v2t101 review tours + `devx: hold` (#65), v2d101 universal
dispatcher + 12-row `devx next` (#66), v2l101 overnight loop (#67),
v2o101 outcome loop + migration retro (#68).

Numbers: 1,309 → 2,039 tests; ~111 adversarial-review findings fixed
in-place; planning prose ~550KB → 23.9KB (S-1, CI-gated at 60KB); net
−247K lines. First real outcome verdict: v2x101 scored **keep, 3/3
goals**. Retro: `_devx/retros/v2-migration-2026-07-05.md` (LEARN.md §
v2-migration E1–E10 + 1 cross-epic promotion). Every PR since #65
carries a review tour on the `devx-tours` branch.

The system's surfaces now: `/devx` (universal dispatcher; no-args →
`devx next`), `/devx-plan` (PRD → Design → Plan → RED gates),
`devx loop` (overnight; D-6/D-11), `devx tour` (review artifacts),
`devx outcome` (post-ship scoring). Decision ledger: `v2/07-decisions.md`.

Open human items: INTERVIEW.md Q#9 (full-surface prose budget, 64.2KB vs
60KB target) + MANUAL.md MV2.1 (S-3 supervised first night of
`devx loop`). Next work per `devx next`: the mobile companion backlog
(a10001 Flutter scaffold onward), unchanged and migration-safe.
