# Setup

One thing to install: **devx** (the CLI, slash commands, hooks, and opinions). The engine — stage templates, gate CLIs, and skill bodies — is native and ships inside the devx npm package; there is no separate framework to install underneath. Parts of this doc are still early design — treat the exact commands below as the current plan, not a frozen contract.

---

## Prerequisites

- **Node.js** ≥ 20 (the devx CLI is a Node package).
- **Claude Code** installed and signed in (`claude --version` should work).
- **git** ≥ 2.30 (we rely on `git worktree`).
- **gh** (GitHub CLI), authenticated — needed for the CI-as-source-of-truth loop.
- A GitHub repo you have push access to (even if it's brand new and empty).

Optional but recommended:
- **Playwright** (auto-installed by `/devx-init` when it wires the browser QA agent).
- **Docker** — only if your project wants containerized test envs.

---

## Part 1 — The engine (nothing to install)

The devx engine is native: the stage templates (`_devx/templates/engine/` — prd, expectations, design, plan, red-report, checkpoint, decision, results), the gate CLIs (`devx gate prd|coverage|evals`), and the skill bodies all ship inside the `@devx/cli` npm package (see [`INSTALL.md`](../INSTALL.md) for the CLI install matrix). `/devx-init` copies the templates into your repo under `_devx/`.

Generated outputs live under:
- `_devx/workstreams/<slug>/` — per-workstream planning artifacts: prd.md, expectations.md, design.md, plan.md, decisions/, checkpoints/, evals/ (version-controlled).
- `dev/`, `plan/`, etc. — the lightweight spec-file index the backlogs point at.

*(Historical note: through Phases 0–1 devx ran on top of the BMAD framework, installed via `npx bmad-method install` into `_bmad/`. The v2 migration ejected it — see `v2/01-bmad-capture.md`. Repos from that era keep a frozen, read-only `_bmad-output/` archive; nothing reads or writes it.)*

---

## Part 2 — Install devx skills

devx skills are Claude Code slash commands (`.claude/commands/*.md` files) plus a few hook scripts. They live in this repo under `skills/`, and are installed either **globally** (into `~/.claude/commands/`, available in every repo) or **per-project** (into `<repo>/.claude/commands/`, scoped to that project).

### Recommended: global install

devx is meant to be the default workflow for every project, so install the skills globally:

```bash
# From anywhere
git clone https://github.com/<you>/devx ~/src/devx
cd ~/src/devx
./install.sh --global
```

This copies (or symlinks, with `--link`) every file in `skills/` to `~/.claude/commands/`, giving you:

```
~/.claude/commands/
  devx-init.md
  devx-plan.md
  devx.md
  devx-test.md
  devx-debug.md
  devx-focus.md
  devx-triage.md
```

### Per-project install

When you want to pin a specific devx version to a repo (e.g., a client project that shouldn't auto-update with your global):

```bash
cd <your-project>
~/src/devx/install.sh --project .
```

This copies the skills into `<your-project>/.claude/commands/` and adds a `devx.version` file so you can reproduce the exact setup later.

### Symlink vs. copy

- `--link` (symlink) during dev on devx itself: edits to `~/src/devx/skills/*.md` take effect immediately in Claude Code.
- `--copy` (default): isolated from future changes in this repo, good for stable installs.

### Uninstall

```bash
./install.sh --uninstall --global     # or --project <path>
```

Removes every `devx-*` file from the target commands directory. Does not touch any other commands.

---

## Part 3 — Bootstrap a project with `/devx-init`

Once devx is installed, the first and only command you run against a fresh repo is:

```
/devx-init
```

This is the "simple guy to talk to" — it walks you through a short interview (not a wall of menus) and then sets everything up:

1. **Repo detection** — empty vs. existing vs. active. Adapts the rest of the flow.
2. **Project brief** — 5-question interview: what are you building, who is it for, what stack, solo or team, infra preferences.
3. **Engine scaffolding** — copies the packaged engine templates into `_devx/` (workstream templates, config schema).
4. **Backlog scaffolding** — creates `DEV.md`, `PLAN.md`, `TEST.md`, `DEBUG.md`, `FOCUS.md`, `INTERVIEW.md`, `MANUAL.md` at the repo root, and `dev/`, `plan/`, `test/`, `debug/`, `focus/` subdirectories for individual spec files.
5. **CI/CD scaffolding** — a minimal GitHub Actions workflow with lint + test + coverage gates, plus a PR template that links back to the spec file.
6. **Observability wiring** — prompts for how to connect logs/metrics/DB (read-only token, or "set up later"). Writes a `devx.config.yaml` with the connection details.
7. **Branch hygiene** — configures the default worktree location (`.worktrees/` ignored), adds a `pre-push` hook for coverage enforcement.
8. **Hand-off** — ends with `INTERVIEW.md` pre-populated with the questions `/devx-plan` is going to need to know next. You answer when ready; `/devx-triage` will pick up from there.

`/devx-init` is idempotent. Run it again to reconfigure or to upgrade a project to a newer devx version.

---

## Part 4 — Starting the loop

After `/devx-init`:

```
/devx-triage
```

This is the daemon-equivalent. It reads every backlog file, figures out what's runnable right now (no blockers, no open interview questions, capacity available), and spawns the appropriate agent (`PlanAgent`, `DevAgent`, `TestAgent`, `DebugAgent`, `FocusAgent`) in a new worktree.

You can run `/devx-triage` manually on demand, or wire it to `/loop 30m /devx-triage` for hands-off operation.

Direct invocations still work too — call `/devx-plan <idea>` to kick off planning for something specific, `/devx` to force-pick the next item off `DEV.md`, etc. Triage respects in-flight manual invocations.

---

## Upgrading

```bash
# Upgrade devx
cd ~/src/devx && git pull && ./install.sh --global
```

The installer is additive — it re-generates commands but doesn't touch your backlog files, planning artifacts, or spec files.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/devx-*` commands don't appear in Claude Code | Check `~/.claude/commands/` exists and contains `devx-*.md`. Restart Claude Code. |
| `git worktree` errors during `/devx` | Ensure `.worktrees/` is in `.gitignore` and the parent dir is writable. Run `git worktree prune`. |
| CI step fails but local passes | Expected — CI is ground truth. Read the failing job logs (`gh run view <id> --log-failed`) and let `/devx-debug` handle it. |
| Coverage gate fails a merge | Either the DevAgent missed a file (let `/devx-test` write the gap) or the surface genuinely doesn't need coverage (mark `# devx:no-coverage <reason>` inline). |
