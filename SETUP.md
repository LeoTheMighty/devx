# Setup

Two layers to install: **BMAD** (the underlying workflow engine) and **devx** (the slash commands, hooks, and opinions layered on top). Both are currently in early design — treat the exact commands below as the current plan, not a frozen contract.

---

## Prerequisites

- **Node.js** ≥ 20 (BMAD's installer is a Node CLI).
- **Claude Code** installed and signed in (`claude --version` should work).
- **git** ≥ 2.30 (we rely on `git worktree`).
- **gh** (GitHub CLI), authenticated — needed for the CI-as-source-of-truth loop.
- A GitHub repo you have push access to (even if it's brand new and empty).

Optional but recommended:
- **Playwright** (auto-installed by `/devx-init` when it wires the browser QA agent).
- **Docker** — only if your project wants containerized test envs.

---

## Part 1 — Install BMAD

BMAD v6 ships as an npm-based installer that drops a `_bmad/` directory into your project and generates Claude Code slash commands for each agent and workflow.

We install **three modules**:

| Module | Package | What it gives us |
|---|---|---|
| `core` | built-in | Workflow engine (`_bmad/core/tasks/workflow.xml`), party-mode, shard-doc, brainstorming. |
| `bmm` | built-in | The BMAD Method — analyst, PM, architect, SM, dev, QA, UX, tech-writer agents, plus the full planning/solutioning/implementation workflow set (`create-prd`, `create-architecture`, `create-story`, `dev-story`, `code-review`, `check-implementation-readiness`, etc.). |
| `tea` | `bmad-method-test-architecture-enterprise` | Test Architecture Enterprise — test strategy, ATDD, automation, CI setup, NFR testing, coverage tracing. **This is the testing/QA muscle we lean on for `/devx-test`.** |

### Install steps

From the project root of the repo you want to add BMAD to:

```bash
# One-time installer — interactive, picks Claude Code as the IDE
npx bmad-method@latest install

# When prompted:
#   - IDE: claude-code
#   - Modules: core, bmm, tea   ← pick all three
#   - Module source for tea: external (npm: bmad-method-test-architecture-enterprise)
```

Verify:

```bash
ls _bmad/_cfg/manifest.yaml           # BMAD installed
ls _bmad/bmm/agents/                  # analyst, pm, architect, dev, qa, ux-designer, sm, tech-writer, quick-flow-solo-dev
ls _bmad/tea/agents/                  # tea (test architect)
ls .claude/commands/ | grep bmad-     # ~50 bmad-* slash commands registered
```

Generated outputs will live under:
- `_bmad/` — the framework itself (version-controlled).
- `_bmad-output/planning-artifacts/` — PRD, architecture, epics (version-controlled).
- `_bmad-output/implementation-artifacts/` — story files, sprint-status.yaml, QA walkthroughs (version-controlled).

### What to keep across upgrades

BMAD upgrades rewrite `_bmad/` but leave `_bmad-output/` and `.claude/commands/bmad-*` alone. Your planning artifacts are durable; only the framework itself changes.

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

Removes every `devx-*` file from the target commands directory. Does not touch BMAD commands (they were installed by BMAD's own installer).

---

## Part 3 — Bootstrap a project with `/devx-init`

Once BMAD and devx are installed, the first and only command you run against a fresh repo is:

```
/devx-init
```

This is the "simple guy to talk to" — it walks you through a short interview (not BMAD's full menu) and then sets everything up:

1. **Repo detection** — empty vs. existing vs. active. Adapts the rest of the flow.
2. **Project brief** — 5-question interview: what are you building, who is it for, what stack, solo or team, infra preferences.
3. **BMAD init** — runs `npx bmad-method install` if not present.
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
# Upgrade BMAD
npx bmad-method@latest install     # detects existing install and prompts

# Upgrade devx
cd ~/src/devx && git pull && ./install.sh --global
```

Both installers are additive — they re-generate commands but don't touch your backlog files, planning artifacts, or spec files.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/devx-*` commands don't appear in Claude Code | Check `~/.claude/commands/` exists and contains `devx-*.md`. Restart Claude Code. |
| `bmad-*` commands don't appear | Check `.claude/commands/` in the repo. Re-run `npx bmad-method install` and pick `claude-code` as the IDE. |
| `git worktree` errors during `/devx` | Ensure `.worktrees/` is in `.gitignore` and the parent dir is writable. Run `git worktree prune`. |
| CI step fails but local passes | Expected — CI is ground truth. Read the failing job logs (`gh run view <id> --log-failed`) and let `/devx-debug` handle it. |
| Coverage gate fails a merge | Either the DevAgent missed a file (let `/devx-test` write the gap) or the surface genuinely doesn't need coverage (mark `# devx:no-coverage <reason>` inline). |
