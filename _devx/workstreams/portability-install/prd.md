# PRD — Portability Install

<!-- Stage: PRD. Gate: `devx gate prd <hash>`. Every concrete item gets a
     stable ID (G-/UC-/CAP-/FR-). IDs are never renumbered. Traceability is
     by ID, not by prose. -->

## Problem

devx only works in the devx repo. The npm package is `private: true`; the
skill bodies (`.claude/commands/{devx,devx-plan,devx-interview}.md`) ship
nowhere — they exist solely in this repo's `.claude/` directory, which the
package's `files` list does not include. `docs/SETUP.md` Part 2 documents a
`skills/` directory and an `install.sh` that do not exist. `devx init` (the
CLI command) only replays queued GitHub ops (`--resume-gh`); the real
scaffold flow is the `/devx-init` slash command — which a target repo cannot
invoke because it doesn't have the skill installed. Chicken-and-egg: the
skills install the repo, but nothing installs the skills.

The owner's intended use (drift audit 2026-07-14, INTERVIEW Q#10 context)
is to run devx on `palateful` and a new website repo, overnight, eventually
under a fleet layer (plan f1d6b2). Every downstream vision-gap track
depends on this one: the usage governor (c8e2d4) needs a real second repo
to loop on; the fleet needs ≥2 initialized repos and a globally runnable
skill.

## Goals

<!-- User goals in prose; business/project goals MUST be numeric + dated so
     /devx outcome can score them later. -->

- **G-1**: `devx init` on a non-devx repo yields a working `/devx`
  dispatcher in **< 2 minutes**, timed live on `palateful`, by
  **2026-07-21** (S-5, `v2/00-vision.md`).
- **G-2**: **3/3** skill bodies ship in the npm tarball and **0** silent
  divergence is possible between `.claude/commands/` and the shipped
  copies (`npm test` fails on drift), by **2026-07-18**.
- **G-3**: **1** real palateful bug goes symptom → merged fix via `/devx`,
  and `devx loop --max-items 1` completes there with a morning report, by
  **2026-07-21**.
- **G-4**: **0** references to nonexistent paths/flows in `INSTALL.md` +
  `docs/SETUP.md` install sections, by **2026-07-18**.

## Non-goals

- **npm public publish** — `private: true` stays; distribution is
  `npm i -g .` from the local checkout (owner decision, approved plan
  2026-07-14). Publishing is a later call.
- **Fleet layer / multi-repo orchestration** — plan f1d6b2, blocked on this
  track.
- **Usage-window governor** — plan c8e2d4, separate track.
- **Work-repo rollout** — INTERVIEW Q#11, deferred; docs only flag the
  mode/policy caveat.
- **Skill auto-update daemon** — version stamping + idempotent re-init is
  the v1 upgrade story; nothing watches for new versions.

## Users

- **Primary**: the owner — solo dogfooder installing devx globally from
  this checkout and initializing personal repos (`palateful`, website).
- **Secondary**: future external dogfooders (post-publish) — same flow,
  npm registry instead of local checkout; nothing in this track may
  hard-code owner-specific paths.
- **Anti-persona**: teams wanting hosted/multi-user devx — out per
  ROADMAP "what we won't build".

## Use cases

- **UC-1**: Owner runs `npm run install:global` from the devx checkout and
  gets a `devx` binary on PATH whose `--version` carries the git SHA it was
  built from.
- **UC-2**: Owner cds into a fresh repo, runs `devx init`, and gets a fully
  scaffolded devx project — config, backlogs, spec dirs, CLAUDE.md block,
  CI workflow, **and** `.claude/commands/` skills — with `/devx` working in
  Claude Code immediately.
- **UC-3**: Owner re-runs `devx init` on an already-initialized repo and
  gets an idempotent upgrade — newer skills installed, user-owned files
  never clobbered.
- **UC-4**: A devx maintainer edits a skill body once and cannot ship a
  package whose copies diverge from the repo's live `.claude/commands/`.

## Capabilities

- **CAP-1**: Skill bodies are package content — a `skills/` dir in
  `package.json → files`, canonical source for what installers copy.
- **CAP-2**: A real non-interactive CLI scaffold path on `devx init`,
  reusing the existing pure init modules (`init-orchestrator.ts`,
  `init-write.ts`, `init-upgrade.ts`) — `/devx-init` remains the
  interview-driven wrapper over the same modules.
- **CAP-3**: A skills-install step — per-repo `.claude/commands/` by
  default (version-header stamped), `~/.claude/commands/` via `--global`.
- **CAP-4**: Version provenance — build embeds the git SHA in `--version`;
  scaffolded repos record `devx_version`; installed skill files carry a
  version header.
- **CAP-5**: A structural drift guard between `.claude/commands/*.md` and
  `skills/*.md` wired into `npm test`.

## Feature requirements

### FR-1: Packaged `skills/` directory

Top-level `skills/` holds the canonical skill bodies
(`devx.md`, `devx-plan.md`, `devx-interview.md`). `package.json → files`
includes it; `npm pack` tarball contains all three.

### FR-2: Repo `.claude/commands/` stays in lockstep

This repo's `.claude/commands/*.md` become symlinks into `skills/` (or
byte-identical copies if symlinks prove hostile to the harness), with an
`npm test` check that fails on any content divergence. **The `.claude/`
edit is user-foreground** (harness gate — LEARN.md cross-epic
"bypass-permissions does NOT auto-accept skill edits").

### FR-3: `devx init` non-interactive scaffold

Bare `devx init` in a git repo: detects stack (ts/go/python/rust/flutter/
empty — the existing template seeds), writes the full scaffold via the
existing init modules with conservative defaults, seeds INTERVIEW.md with
the deferred decisions (MANUAL/INTERVIEW-as-designed-signal, not silent
defaults), and is idempotent on re-run via the existing `init-upgrade`
path. `--resume-gh` behavior unchanged.

### FR-4: Skills-install step

Init installs skills to the target repo's `.claude/commands/` with header
`<!-- devx-skill v<version>+<sha> -->`. Rules: absent → write; present
with devx header → overwrite on version change; present **without** header
(user-owned) → skip + MANUAL.md entry. `--global` installs to
`~/.claude/commands/` instead. Writing other repos'/`~`'s `.claude/` from
the CLI is ungated (only this repo's is harness-gated).

### FR-5: `install:global` + SHA-stamped version

`npm run install:global` = build + `npm i -g .`; the build embeds the git
SHA so `devx --version` reports `<semver>+<sha>`. INSTALL.md warns against
`npm link` (links HEAD live; loop semantics change mid-hack).

### FR-6: Docs describe only what exists

`docs/SETUP.md` Part 2 rewritten around `skills/` + `devx init` (phantom
`install.sh` and v1 skill names deleted); `INSTALL.md` gains the
local-global-install path + work-repo caveat (BETA/PROD mode, org policy —
INTERVIEW Q#11).

### FR-7: S-5 validation, scripted + live

Scripted: the init e2e fixture harness (ini508 pattern) gains a
fresh-repo CLI-scaffold scenario asserting the full artifact set including
skills. Live: timed S-5 run on `palateful` (< 2 min to working `/devx`),
one real symptom→merged-fix, `devx loop --max-items 1` with a report, and
an assertion that nothing outside the repo except `~/.devx/` was written.

## Evals seed

<!-- Raw material for expectations.md — behaviors worth pinning, thresholds
     worth measuring. Promoted into E-blocks before Gate 1. -->

- `npm pack --dry-run --json` lists `skills/{devx,devx-plan,devx-interview}.md` → 3/3.
- Divergent byte between `skills/devx.md` and `.claude/commands/devx.md` → suite fails.
- `devx init` in a fresh fixture repo → full artifact set incl. skills, exit 0.
- Re-run `devx init` → idempotent; user-owned skill file (no header) preserved + MANUAL entry.
- `devx --version` after install:global → `<semver>+<sha>` shape.
- SETUP/INSTALL path references all resolve.
- Live S-5 on palateful < 2 min (human-timed).

## Open questions

- None blocking. Symlink-vs-copy for FR-2 resolves at design (grep how the
  harness + git treat symlinked `.claude/commands/`); the drift check
  makes either safe. — owner: research

## Reference links

- Spec: `plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md`
- Approved drift-audit plan: `~/.claude/plans/sparkling-bubbling-pie.md`
- S-5 criterion: `v2/00-vision.md`
- Prior art: `src/lib/init-*.ts` (Phase 0 ini epic), `test/` ini508 e2e
  fixture harness, `scripts/postinstall-lib.mjs` (PATH verification),
  LEARN.md § epic-init-skill + Cross-epic patterns (installer-shape rows)
