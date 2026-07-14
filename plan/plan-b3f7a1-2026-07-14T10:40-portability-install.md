---
hash: b3f7a1
type: plan
created: 2026-07-14T10:40:00-07:00
title: "Vision-gap Track 1 — Portability & install: packaged skills, real `devx init` scaffold, S-5 on a real external repo"
status: ready
from: PLAN.md#vision-gap-tracks (drift audit 2026-07-14; approved plan sparkling-bubbling-pie)
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: send-it
stack_layers: [ backend ]
blocked_by: []
stage: design
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: false
  plan_verified: false
  evals_red: false
outcome:
  status: null
  measure_by: null
workstream: _devx/workstreams/portability-install
---

## Goal

`npm run install:global && cd <any-repo> && devx init` yields a working `/devx`
in under two minutes (S-5, `v2/00-vision.md`), on a repo that is not devx
itself — validated for real on the owner's `palateful` repo.

## Why now

Drift audit 2026-07-14: `devx init` v2 shipped (V2.4) but the package is
`private: true` and the skill bodies (`.claude/commands/{devx,devx-plan,devx-interview}.md`)
ship **nowhere** — they exist only in this repo. `docs/SETUP.md` Part 2
references a `skills/` dir + `install.sh` that do not exist. Portability is
the prerequisite for every other vision-gap track (usage governor needs a repo
to loop on; fleet needs ≥2 initialized repos).

## Scope

- **Packaged skills**: new top-level `skills/` dir = canonical skill bodies,
  added to `package.json → files`. This repo's `.claude/commands/*.md` become
  symlinks into `skills/`, with a content-sync check in `npm test`.
  **The symlink move is user-foreground** (harness gates `.claude/` writes in
  this repo). Writing *other* repos' `.claude/` from the CLI is ungated.
- **`devx init` real scaffold path**: bare `devx init` = non-interactive
  scaffold reusing `src/lib/init-orchestrator.ts` + `init-write.ts` (already
  stamps `devx_version`), plus a new skills-install step writing the target
  repo's `.claude/commands/` (per-repo default with a version header
  `<!-- devx-skill v<version>+<sha> -->`; `--global` opt-in installs to
  `~/.claude/commands/`). `/devx-init` remains the interview wrapper over the
  same pure modules.
- **Distribution v1 — no npm publish**: `npm run install:global` =
  `npm run build && npm i -g .`; build embeds the git SHA into `--version` so
  scaffolded repos record provenance. `private: true` stays. Explicitly warn
  against `npm link` in INSTALL.md (links HEAD live; loop semantics change
  under you mid-hack).
- **Docs to reality**: rewrite `docs/SETUP.md` Part 2 (delete phantom
  `install.sh`, v1 skill names) + INSTALL.md. Flag the work-repo caveat: mode
  must be BETA/PROD there (no YOLO auto-merge); org policy on sending code to
  Claude is the owner's call (INTERVIEW Q#11).

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed. Sketch from the
approved plan: skl (packaged skills/ + symlinks + sync check, user-foreground)
→ ini6xx (`devx init` scaffold + skills install + SHA-stamped version) →
dist (install:global + INSTALL/SETUP rewrite) → val (S-5 timed runs: scratch
repo + palateful) → ret.

## Acceptance criteria

- [ ] `npm run install:global` from this checkout produces a `devx` on PATH
      whose `--version` carries the git SHA.
- [ ] `devx init` on a fresh non-devx repo scaffolds config, backlogs, spec
      dirs, CLAUDE.md block, CI workflow, **and** `.claude/commands/` skills —
      and `/devx` renders the dispatcher there in < 2 min (S-5, timed).
- [ ] The npm pack tarball contains the skill bodies; this repo's
      `.claude/commands/*.md` and `skills/*` cannot silently diverge
      (`npm test` fails on drift).
- [ ] S-5 validated on `palateful`: init → one real bug symptom → merged fix
      via `/devx`; `devx loop --max-items 1` completes with a morning report;
      no writes outside the repo except `~/.devx/`.
- [ ] SETUP.md/INSTALL.md describe only paths that exist.

## Status log

- 2026-07-14T10:40 — filed from the vision-gap drift audit (plan
  sparkling-bubbling-pie, approved 2026-07-14). Track 1 of 4; ships first.
- 2026-07-14T11:05 — PRD stage: workstream scaffolded (`devx workstream new
  portability-install --hash b3f7a1`); prd.md (G-1..4, UC-1..4, CAP-1..5,
  FR-1..7) + expectations.md (E-1..7; 3×P0, 2×P1, 2×P2) authored from the
  approved drift-audit plan + this session's code research (no fresh
  Explore fan-out — audit already grounded every claim). Critique skipped
  (thoroughness send-it). `devx gate prd b3f7a1` → FAIL ×2 (E-7
  Verified-by trailing prose — parser folds continuation lines; trimmed to
  bare path) → **PASS**; prd_validated flipped, stage: design. Artifacts:
  _devx/workstreams/portability-install/{prd,expectations}.md.

## Links

- Approved drift-audit plan: `~/.claude/plans/sparkling-bubbling-pie.md`
- S-5 criterion: `v2/00-vision.md`
- Existing init modules: `src/lib/init-orchestrator.ts`, `src/lib/init-write.ts`
- Docs to fix: `docs/SETUP.md` Part 2, `INSTALL.md`
