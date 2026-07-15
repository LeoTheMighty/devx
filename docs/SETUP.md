# Setup

One thing to install: **devx** (the CLI, slash commands, and opinions). The
engine — stage templates, gate CLIs, and skill bodies — is native and ships
inside the devx npm package; there is no separate framework to install
underneath.

---

## Prerequisites

- **Node.js** ≥ 20 (the devx CLI is a Node package).
- **Claude Code** installed and signed in (`claude --version` should work).
- **git** ≥ 2.30 (we rely on `git worktree`).
- **gh** (GitHub CLI), authenticated — needed for the CI-as-source-of-truth loop.
- A GitHub repo you have push access to (even if it's brand new and empty).

Optional:
- **Docker** — only if your project wants containerized test envs.

---

## Part 1 — The engine (nothing to install)

The devx engine is native: the stage templates (`_devx/templates/engine/` — prd, expectations, design, plan, red-report, checkpoint, decision, results), the gate CLIs (`devx gate prd|coverage|evals`), and the skill bodies all ship inside the `@devx/cli` npm package (see [`INSTALL.md`](../INSTALL.md) for the CLI install — a local global install from a checkout while the package is unpublished). `devx init` copies the templates into your repo under `_devx/`.

Generated outputs live under:
- `_devx/workstreams/<slug>/` — per-workstream planning artifacts: prd.md, expectations.md, design.md, plan.md, decisions/, checkpoints/, evals/ (version-controlled).
- `dev/`, `plan/`, etc. — the lightweight spec-file index the backlogs point at.

*(Historical note: through Phases 0–1 devx ran on top of the BMAD framework. The v2 migration ejected it — see `v2/01-bmad-capture.md`. Repos from that era keep a frozen, read-only `_bmad-output/` archive; nothing reads or writes it.)*

---

## Part 2 — Install the devx skills

devx skills are Claude Code slash commands (`.claude/commands/*.md` files). The canonical copies live in this repo under `.claude/commands/`; the npm package ships byte-identical mirrors under `skills/` (kept in sync by `npm run sync:skills` + a drift test). Three skills exist today:

```
devx.md             ← the universal dispatcher (/devx)
devx-plan.md        ← planning stages (/devx-plan)
devx-interview.md   ← walk pending INTERVIEW.md questions (/devx-interview)
```

They are installed by the CLI, not by hand:

```bash
# Per-project (recommended): into <repo>/.claude/commands/
cd <your-project>
devx init                    # scaffolds the repo AND installs the skills

# Global: into ~/.claude/commands/, available in every repo
devx init --global

# Scaffold without touching skills
devx init --skip-skills
```

Every installed skill file carries a version header (`<!-- devx-skill v<version> -->`). The installer's ownership rules:

- **absent** → write
- **header, older version** → overwrite in place
- **header, same version** → no-op
- **no header** → the file is **yours**; devx never touches it and files a MANUAL.md entry instead

So hand-edited skill files are safe: strip the header (or just edit a file you created yourself) and re-runs will skip it.

---

## Part 3 — Bootstrap a project

Two flavors:

**Non-interactive (bare `devx init`)** — scaffolds everything with
stack-derived answers and conservative defaults. Product decisions it can't
derive (what you're building, the first slice, the audience) are filed in
`INTERVIEW.md` for you to answer afterward; the OS-supervisor install is
deferred to `MANUAL.md`.

**Interactive (`/devx-init` in Claude Code)** — the "simple guy to talk to":
a short interview, then the same scaffold with your answers instead of
defaults.

Either way you get:

1. **Repo detection** — empty vs. existing vs. already-on-devx. Re-runs take the upgrade path (header-bearing files refreshed, your files preserved).
2. **Engine scaffolding** — packaged engine templates into `_devx/`.
3. **Backlog scaffolding** — `DEV.md`, `PLAN.md`, `TEST.md`, `DEBUG.md`, `FOCUS.md`, `INTERVIEW.md`, `MANUAL.md`, `LESSONS.md` at the repo root, plus `dev/`, `plan/`, `test/`, `debug/`, `focus/` spec dirs.
4. **CI/CD scaffolding** — a minimal GitHub Actions workflow with lint + test gates, plus a PR template that links back to the spec file.
5. **Config** — `devx.config.yaml` with the strategic axes (mode / shape / thoroughness) and every knob (`docs/CONFIG.md`).
6. **Skills install** — per Part 2.

`devx init` is idempotent: run it again to upgrade a repo to a newer devx version.

---

## Part 4 — Starting the loop

After the scaffold:

```
/devx
```

`/devx` is the universal dispatcher — with no arguments it runs `devx next`
(the state-driven decision table) and does whatever the repo state calls
for: plan, execute, debug, review, or merge-tail. Point it at something
specific with `/devx <hash>` or free text (`/devx fix the login 500`), or
kick off planning with `/devx-plan <idea>`.

For unattended operation there's `devx loop` (overnight mode — budgets from
`devx.config.yaml → loop:`; see `v2/04-loop.md`). Answer pending questions
with `/devx-interview`.

---

## Upgrading

```bash
cd ~/src/devx && git pull && npm ci && npm run install:global
cd <your-project> && devx init      # upgrade path: refreshes header-bearing files
```

The upgrade never touches your backlog files, planning artifacts, spec
files, or any skill file you've taken ownership of (header removed).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/devx` commands don't appear in Claude Code | Check `.claude/commands/` (project) or `~/.claude/commands/` (global) contains the skill files. Restart Claude Code. |
| `devx: command not found` after install | PATH issue — see [`INSTALL.md`](../INSTALL.md) platform notes. |
| `git worktree` errors during `/devx` | Ensure `.worktrees/` is in `.gitignore` and the parent dir is writable. Run `git worktree prune`. |
| CI step fails but local passes | Expected — CI is ground truth. Read the failing job logs (`gh run view <id> --log-failed`) and let the debug loop handle it. |
| Coverage gate fails a merge | Either a test gap (file it in `TEST.md`) or the surface genuinely doesn't need coverage (mark `# devx:no-coverage <reason>` inline). |
