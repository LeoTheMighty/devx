<!-- refined: party-mode 2026-04-26 -->

# Epic — `/devx-init` skill

**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Slug:** `epic-init-skill`
**Order:** 5 of 5 (Phase 0 — Foundation, foundational user-facing surface)
**User sees:** "I run `/devx-init` once and walk through ≤13 questions. ≤5 minutes later my repo is on the devx rails — backlog files, config, supervisor units, branch protection, CI workflow, personas — all without a single half-bricked surface."

## Overview

`/devx-init` is the user's first impression of devx and the load-bearing onboarding surface. This epic implements the 13-question conversation per `docs/CONFIG.md` (reordered for narrative flow), the inferred-default skip table, write-the-world local + GitHub-side scaffolding, idempotent re-runs (upgrade mode), and graceful failure modes for BMAD-install / `gh`-not-authenticated / no-remote scenarios.

This epic depends on every other Phase 0 epic having landed — it's the orchestration layer that ties them together.

## Goal

By M-A0.5, `/devx-init` against an empty repo produces all 8 backlog files + `devx.config.yaml` + `.devx-cache/` + `.gitignore` updates + `CLAUDE.md` seed + CI workflows + PR template + branch protection on `main` + `develop` branch + supervisor units running + 5 seeded personas + 3 stack-templated INTERVIEW questions — in under 5 minutes, with zero half-bricked state on success and one MANUAL.md entry per blocker on partial-success failure modes.

## End-user flow

1. **Greeting:** Leonid runs `/devx-init` in his fresh `reading-tracker/` repo. The skill greets:
   > **devx:** Hey. I'm going to get this project set up in about 5 minutes. No menus, ≤13 quick questions. Answer however — one word or a paragraph is fine.
2. **Detection:** the skill detects empty-vs-existing-vs-already-on-devx + uncommitted changes + non-default-branch + remote presence; asks halt-and-confirm questions if needed.
3. **Conversation:** asks N1–N13 in narrative order (per PRD addendum FR-A), skipping any whose default can be inferred from repo state per the skip table. Worst case: 13 questions; best case (existing mature repo + `~/.devx/config.yaml`): 3 questions.
4. **Echo-back:** every freeform answer gets a one-line reflective echo. Mode/shape inferences get confirmed before locking.
5. **"Setting up now…" phase:** static checklist appears, lines fill in as steps complete:
   ```
   BMAD installed                  ✓
   8 backlog files scaffolded      ✓
   devx.config.yaml written        ✓
   develop branch created          ✓
   main branch protected           ✓
   CI workflow scaffolded          ✓
   PR template installed           ✓
   supervisor units installed      ✓
   personas seeded (4 + 1 anti)    ✓
   INTERVIEW seeded (3 questions)  ✓
   CLAUDE.md seed                  ✓
   ```
6. **Hand-off:** the closing message lists 3 numbered next-steps — answer the 3 INTERVIEW questions, run `/devx-plan` or `/devx`, optionally install the mobile app — exactly per product-brief Moment 2.
7. **Re-run later:** Leonid bumps to a newer `@devx/cli` and re-runs `/devx-init`. Detection finds existing `devx.config.yaml` with `devx_version: 0.1.0`; current version is 0.2.0; only the deltas prompt. Final summary: "kept 11 / added 2 / migrated 0."
8. **Failure example:** `gh` isn't authenticated. All local steps complete; GitHub-side ops (branch protection, develop push) get queued in `.devx-cache/pending-gh-ops.json`; `MANUAL.md` shows one entry: "Run `gh auth login`, then `devx init --resume-gh`. Local setup is complete and works without it."

## Frontend changes (CLI)

- New skill file `~/.claude/commands/devx-init.md` (the `/devx-init` slash command). Phased prompt: detection → questions → echoes → "setting up now…" checklist → hand-off.
- New CLI helper `devx init --resume-gh` (or `devx init --finish-remote`): re-runs only the GitHub-side ops queued in `.devx-cache/pending-gh-ops.json`. Stub or real-functional? — real-functional for Phase 0; otherwise the failure modes can't recover.
- New TypeScript modules:
  - `src/lib/init-questions.ts` — the 13-question flow + skip-table inference engine.
  - `src/lib/init-state.ts` — repo state intake (empty/existing/devx-installed/uncommitted/non-default-branch).
  - `src/lib/init-write.ts` — local file writes orchestration (config, backlog, .gitignore, CLAUDE.md, dev/* seed).
  - `src/lib/init-gh.ts` — GitHub-side scaffolding (workflows, PR template, develop branch, branch protection).
  - `src/lib/init-personas.ts` — persona file seeding from N3 answer.
  - `src/lib/init-interview.ts` — fixed-template INTERVIEW.md seeding per detected stack.
  - `src/lib/init-failure.ts` — `init.partial:true` flag + pending-gh-ops queue + MANUAL.md entries.
  - `src/lib/init-upgrade.ts` — upgrade-mode rerun + delta detection + summary.

## Backend changes

None.

## Infrastructure changes

- Triggers `epic-os-supervisor-scaffold`'s `installSupervisor()` for the auto-detected platform.
- Triggers `epic-config-schema`'s schema validation on the freshly-written `devx.config.yaml`.
- Calls `gh api` for branch protection (FR-J in PRD addendum).
- Optionally calls `npx bmad-method install` if `_bmad/` is missing.

## Design principles (from research)

- **Conversation, not a form.** Persona-leonid voice ("yeah / got it / hot"). No menus, no numbered options unless the question genuinely has 3+ discrete choices.
- **Skip everything you can infer.** Best case: 3 questions. The skip-table is the load-bearing UX feature.
- **Idempotent: re-run is upgrade mode.** Detection signal is `devx_version: <semver>` at top of `devx.config.yaml`. No file → fresh; missing version → corrupt + halt; present → upgrade.
- **Never half-brick.** Three failure modes (BMAD / gh / no-remote). Each degrades to one MANUAL.md entry + `init.partial:true` flag. Other devx commands respect the flag in modes ≥ BETA.
- **Static checklist progress display.** Not a live log tail. Matches Leonid's "yeah / got it" tempo and is faster than animation.
- **Welcome + hand-off copy locked from product-brief Moment 2.** Don't re-litigate copy.
- **Backlog files get auto-deleting empty-state headers.** Each newly-created backlog file gets a `<!-- devx-empty-state-start --> … <!-- devx-empty-state-end -->` block at top. Auto-deletes when the file holds N≥3 items.
- **3 fixed-template INTERVIEW.md questions per stack.** Not live-PlanAgent-generated (Phase 0 = no execution loop).

## File structure

```
@devx/cli/                                                   ← npm package
├── _devx/templates/init/
│   ├── backlog-headers/                                     ← per-backlog "what goes here" blocks
│   │   ├── DEV.md.header
│   │   ├── PLAN.md.header
│   │   ├── TEST.md.header
│   │   ├── DEBUG.md.header
│   │   ├── FOCUS.md.header
│   │   ├── INTERVIEW.md.header
│   │   ├── MANUAL.md.header
│   │   └── LESSONS.md.header
│   ├── interview-seed-<stack>.md                            ← 3 questions per stack (python, ts, rust, go, flutter, empty)
│   ├── personas/
│   │   ├── default-leonid.md                                ← fallback when N3 = "you propose"
│   │   ├── default-dana.md
│   │   ├── default-jess.md
│   │   ├── default-sam.md
│   │   └── default-anti-morgan.md
│   ├── claude-md.template                                   ← devx-managed CLAUDE.md block
│   ├── pull_request_template.md                             ← FR-I PR template
│   ├── github-workflows/
│   │   ├── devx-ci.yml                                      ← stack-conditional
│   │   ├── devx-promotion.yml                               ← Phase 1 placeholder
│   │   └── devx-deploy.yml                                  ← stub
│   └── gitignore.devx-block                                 ← managed `.gitignore` lines
├── src/
│   ├── lib/
│   │   ├── init-questions.ts
│   │   ├── init-state.ts
│   │   ├── init-write.ts
│   │   ├── init-gh.ts
│   │   ├── init-personas.ts
│   │   ├── init-interview.ts
│   │   ├── init-failure.ts
│   │   └── init-upgrade.ts
│   └── commands/
│       └── init.ts                                          ← `devx init --resume-gh` real command
└── test/
    ├── init-questions.test.ts
    ├── init-state.test.ts
    ├── init-write.test.ts
    ├── init-gh.test.ts                                      ← against gh stub server
    ├── init-failure.test.ts
    ├── init-upgrade.test.ts
    └── fixtures/repos/
        ├── empty/                                           ← fresh repo
        ├── existing-no-ci/                                  ← repo with commits, no CI, no devx
        ├── partial-on-devx/                                 ← repo where init aborted mid-way
        └── devx-installed/                                  ← repo on devx_version 0.1.0 (upgrade target)

# User-side outputs (after `/devx-init`):
<repo>/
├── DEV.md                                                   ← new, with empty-state header
├── PLAN.md                                                  ← (already exists in this repo; kept)
├── TEST.md
├── DEBUG.md
├── FOCUS.md
├── INTERVIEW.md                                             ← seeded with 3 stack-templated Qs
├── MANUAL.md
├── LESSONS.md
├── devx.config.yaml                                         ← all 15 sections, devx_version: x.y.z
├── .gitignore                                               ← `# >>> devx` block appended
├── CLAUDE.md                                                ← markers wrap devx-managed block
├── dev/                                                     ← (already exists; kept)
├── plan/                                                    ← (already exists; kept)
├── test/                                                    ← created
├── debug/                                                   ← created
├── focus/                                                   ← created
├── learn/                                                   ← created
├── qa/                                                      ← created
├── focus-group/                                             ← (already exists)
│   └── personas/                                            ← seeded if empty
├── _bmad/                                                   ← installed by `npx bmad-method install`
├── _bmad-output/                                            ← (already exists)
├── .devx-cache/                                             ← gitignored; pending-gh-ops.json lives here
└── .github/
    ├── workflows/{devx-ci,devx-promotion,devx-deploy}.yml
    └── pull_request_template.md
```

## Story list with ACs

### ini501 — 13-question flow + skip-table inference + state detection
- [ ] `init-questions.ts` implements the 13 questions in narrative order (PRD FR-A)
- [ ] Skip-table evaluator: for each question, check if a default can be inferred; if yes, skip + use inferred default
- [ ] `init-state.ts` detects: empty repo / existing repo / already-on-devx (via `devx_version`) / uncommitted-changes (`git status -s`) / non-default-branch HEAD / remote presence
- [ ] Halt-and-confirm prompts for uncommitted-changes (offer stash/commit-wip/abort) + non-default-branch (offer switch/abort)
- [ ] Tested: best-case 3 questions, worst-case 13, mid-case 7 — all produce a complete config object
- [ ] No side-effects from this story — output is the answers + the inferred config object

### ini502 — Local file writes (config + backlogs + spec dirs + CLAUDE.md + .gitignore)
- [ ] `init-write.ts` writes `devx.config.yaml` with all 15 sections + `devx_version` field + comments-on-inferred + comments-on-asked
- [ ] Creates 8 backlog files (DEV/PLAN/TEST/DEBUG/FOCUS/INTERVIEW/MANUAL/LESSONS) with empty-state headers from `_devx/templates/init/backlog-headers/`
- [ ] Creates spec subdirectories: `dev/`, `plan/`, `test/`, `debug/`, `focus/`, `learn/`, `qa/` (plus `focus-group/personas/` if missing)
- [ ] Writes/updates `CLAUDE.md` with markers wrapping the devx-managed block (template at `_devx/templates/init/claude-md.template`)
- [ ] Appends `.gitignore` with `# >>> devx` / `# <<< devx` block (idempotent: re-run skips if block already present)
- [ ] All file writes are atomic (write to tmp + rename) to avoid partial writes on crash
- [ ] Idempotent: existing files are never overwritten — touch only if missing

### ini503 — GitHub-side scaffolding (workflows, PR template, develop branch, branch protection)
- [ ] Writes `.github/workflows/devx-ci.yml` (stack-conditional per PRD FR-I); detects stack via `init-state.ts`
- [ ] Writes `devx-promotion.yml` placeholder + `devx-deploy.yml` stub
- [ ] Writes `.github/pull_request_template.md` with `<!-- devx:mode -->` marker
- [ ] Creates `develop` branch off `main` HEAD via `gh api`; sets as default
- [ ] Applies branch protection PUT to `main` per PRD FR-J (required contexts `[lint, test, coverage]`, enforce_admins true, linear history, no force push)
- [ ] Detects free-tier private repo + degrades to pre-push git hook + `MANUAL.md` warning
- [ ] Detects no-remote + skips all `gh` ops + queues to `.devx-cache/pending-gh-ops.json` + writes 1 MANUAL.md entry
- [ ] Idempotency: existing workflow files diff-and-skip; existing branch protection union (never replace)
- [ ] Vitest covers green-path + private-free-tier + no-remote + idempotent-rerun

### ini504 — Personas + INTERVIEW.md fixed-template seeding
- [ ] `init-personas.ts` reads N3 (who-for) answer; if user listed archetypes, expands each into a full persona file under `focus-group/personas/`; if user said "you propose," writes the 5-template default (4 real + Morgan anti)
- [ ] Anti-persona file is mandatory in either path
- [ ] `init-interview.ts` selects the right `_devx/templates/init/interview-seed-<stack>.md` based on detected stack; writes 3 stack-templated questions to INTERVIEW.md
- [ ] Existing personas are never overwritten; existing INTERVIEW questions are never overwritten
- [ ] Vitest covers: archetypes-given, archetypes-default, persona-already-present, INTERVIEW-already-seeded

### ini505 — Supervisor installer trigger + verify
- [ ] Calls `installSupervisor('manager')` and `installSupervisor('concierge')` from epic-os-supervisor-scaffold's `src/lib/supervisor.ts`
- [ ] Auto-detect platform via `uname` (or honor `manager.os_supervisor` config override)
- [ ] Post-install: calls `verifySupervisor()` for both roles; on success appends checkmark to the "setting up now…" checklist; on failure files MANUAL.md entry but does NOT abort init
- [ ] WSL host-vs-WSL PATH detection (cli305): warn if `npm config get prefix` is on `/mnt/c/`

### ini506 — Failure-mode handling (BMAD-fail / gh-not-auth / no-remote)
- [ ] `init-failure.ts` writes `init.partial: true` flag to `devx.config.yaml` whenever any deferred work exists
- [ ] BMAD-install failure: capture exit code + stderr; offer `[r]etry / [s]kip / [a]bort`; skip writes `bmad.modules: []` + MANUAL.md entry
- [ ] `gh` not authenticated: detected via `gh auth status` exit 1; queue branch-protection + develop-push + workflow-push to `.devx-cache/pending-gh-ops.json`; one MANUAL.md entry
- [ ] No remote: skip all `gh` ops; promotion gate forced to `manual-only`; one MANUAL.md entry
- [ ] `devx init --resume-gh` reads `.devx-cache/pending-gh-ops.json`, replays each op, clears flag if all succeed
- [ ] `init.partial:true` blocks `/devx-plan`, `/devx`, etc. in modes ≥ BETA (refuse-to-spawn check)
- [ ] Vitest covers all three failure modes against fixture repos

### ini507 — Idempotent upgrade-mode re-run
- [ ] `init-upgrade.ts` detects `devx_version` in existing `devx.config.yaml`
- [ ] Compares to current package version; computes delta (which sections / keys are new)
- [ ] Only prompts for delta keys; reuses existing values for unchanged keys
- [ ] Writes "kept N / added M / migrated K" summary at end
- [ ] Detects + repairs: missing CLAUDE.md devx-block markers, missing supervisor units, missing CI workflow, etc.
- [ ] Vitest covers: same-version (no-op), version-bump-with-new-key (one prompt), missing-supervisor (auto-repair)

### ini508 — End-to-end integration test
- [ ] Three fixture repos in `test/fixtures/repos/`: `empty/`, `existing-no-ci/`, `partial-on-devx/`
- [ ] For each: run the full `/devx-init` skill with scripted answers; assert all PRD FR-A through FR-N criteria met
- [ ] `/devx-init` on empty completes in < 30s of test wall-clock (excluding any user-prompt delays)
- [ ] Idempotent rerun against the same fixture is a sub-second no-op
- [ ] OS-specific tests gated to the host platform; rest run cross-platform on GitHub Actions matrix (macos-latest, ubuntu-latest)

## Dependencies

- **Blocks-on:** `epic-bmad-audit` (informs decisions about which BMAD installers to invoke), `epic-config-schema` (provides config-io + schema), `epic-cli-skeleton` (provides the `devx` binary that `init --resume-gh` registers under), `epic-os-supervisor-scaffold` (provides `installSupervisor`).
- **External:** `gh` CLI (degrades), `git` ≥ 2.30, GitHub repo (degrades).
- **Repo prerequisites:** None.

## Open questions

1. **`devx init --resume-gh` is a command name** — but cli305 only stubs out 10 commands; `init` isn't in the stubs list. **Lean: register `init` as the 12th non-stubbed command, real-functional in Phase 0 (since it's the deferred-work entry point).** Captured in ini506.
2. **What if the user's answer to N3 ("who for?") is 6+ archetypes?** Persona panel is 4–6; cap at 6, ask if they want to drop one or merge two. **Captured in ini504.**
3. **CLAUDE.md merger conflict if user has hand-edited inside the markers.** Detect non-devx content inside `<!-- devx:start --> … <!-- devx:end -->` markers; surface as INTERVIEW.md entry; don't auto-resolve. **Captured in ini502.**

## Party-mode critique (team lenses)

- **PM**: This is the user's first impression. Stakes: "does Leonid trust devx after `/devx-init`?" — every detail compounds. Approve, but two adds: (a) Q32 conflict-resolution (mode × project.shape contradictions per OPEN_QUESTIONS) — `production-careful + YOLO` and `empty-dream + PROD` should halt-and-confirm, not silently lock. ini501 must implement. (b) "kept N / added M / migrated K" final summary — make sure "added" counts include surfaces auto-repaired (missing supervisor, missing CLAUDE.md markers), not just new config keys.
- **UX**: Several misses:
  - Empty-state header auto-deletion at N≥3 items: who deletes? Right now nothing in Phase 0 reads-and-mutates backlogs. Lock: the deletion is done by a small `src/lib/empty-state.ts` helper imported by every devx command on backlog open. Specced now (in ini502 follow-up); implemented by Phase 1's `/devx-plan`.
  - 13 questions worst-case is heavy. Persona-leonid's reaction to 5→6 questions was "fine"; 7 was "too many." Mitigation: aggressive default-inference (skip table) targets 3–5 ask-count in mid-case. Confirm via end-to-end test (ini508).
  - Conversation tone: avoid "Great!" / "Awesome!" — persona-leonid is allergic to puffery. Use "got it" / "locked" / "next." Add to ini501's tone notes.
  - "Setting up now…" checklist: green checkmark after each line; if any step fails, that line shows ✗ + reason. Don't silently skip. ini502 + ini503 + ini505 each emit a single-line status update.
- **Frontend (CLI)**: Lots of orchestration. Each `init-*` module (ini502 through ini507) needs unit tests independent of the e2e in ini508. Add to each story's ACs: "vitest unit covers \<concern\>." (Already in ACs implicitly; make explicit.)
- **Backend**: N/A this epic.
- **Infrastructure**: Branch protection step requires `gh` token with `repo` + `workflow` scopes. ini503 checks `gh auth status` but missing-scope detection is via 403-probe in error path. Make the probe upfront — call `gh api repos/:owner/:repo/branches/main/protection` in dry-mode (or `-X HEAD`) before attempting the PUT, route 403 to INTERVIEW.md ("re-auth `gh` with scopes: `repo,workflow`"). Pulled out of failure path into proactive check.
- **QA**: ini508's three fixture repos cover most paths. Add a fourth — `existing-with-conflict-claude-md/` — where CLAUDE.md has user-written content inside `<!-- devx:start --> … <!-- devx:end -->` markers. Verifies ini502's conflict-detection-via-INTERVIEW behavior, which is otherwise easy to regress.
- **Locked decisions fed forward**:
  - 13-question narrative-flow ordering (FR-A) is locked.
  - Skip-table inference is the load-bearing UX feature; aim for 3–5 mid-case ask count.
  - `devx_version` field at top of `devx.config.yaml` is the idempotency signal.
  - `init.partial: true` flag blocks `/devx-plan`/`/devx`/etc. in modes ≥ BETA.
  - Three failure modes (BMAD / gh-auth / no-remote) → 1 MANUAL.md entry each + `init init --resume-gh` resume command.
  - Q32 mode×shape conflict halts-and-confirms (ini501).
  - Empty-state header auto-deletion handled by `src/lib/empty-state.ts` helper specced now, used by Phase 1+ commands.
  - Conversation tone: "got it" / "locked" / "next" — never "Great!" / "Awesome!"
  - "Setting up now…" checklist shows ✓ on success and ✗ + reason on failure (never silent skip).
  - `gh` scope check is proactive (HEAD probe), not reactive (catch-after-error).
  - `existing-with-conflict-claude-md/` fixture added to ini508.

## Focus-group reactions

Skipped — YOLO mode.
