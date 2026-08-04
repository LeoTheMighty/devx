---
hash: 4d9c1a
type: test
created: 2026-08-03T14:38:00-06:00
title: "QA walkthrough — sgr104 regen hooks (claim + RED emission)"
from: sgr104
status: ready
---

# QA walkthrough — Story `sgr104`

> Two state-flipping flows now regenerate `GRAPH.md` before they commit:
> `devx devx-helper claim` and `devx plan-helper emit-retro-story`. The
> user-visible surfaces are the emission CLI's new `graph=` stdout key, the
> claim's new WARN lines, and the contents of the claim commit. This
> walkthrough does NOT cover the merge-cleanup flow (`mark-done`) — that host
> is Phase 5 (sgr105), and E-5 stays RED until it lands.

## Pre-flight

```bash
cd /Users/leonidbelyi/personal/devx/.worktrees/dev-sgr104
npm run build                      # the checks below drive dist/cli.js
DEVX=$PWD/dist/cli.js
```

## Manual checks

### 1. The emission CLI reports a regenerated board on its key=value line

- [x] `machine` — `graph=` is appended after `dev_md=`, repo-relative, and the file it names exists

```bash
mkdir -p /tmp/qa-sgr104/dev && cd /tmp/qa-sgr104
cp /Users/leonidbelyi/personal/devx/devx.config.yaml .
printf '# DEV\n\n### Epic — qa demo\n- [x] `dev/dev-qaa111-2026-08-01T08:00-one.md` — One. Status: done.\n' > DEV.md
printf -- '---\nhash: qaa111\ntype: dev\ncreated: 2026-08-01T08:00:00-06:00\ntitle: "One"\nstatus: done\n---\n\n## Goal\n\nx\n\n## Status log\n\n- filed.\n' > dev/dev-qaa111-2026-08-01T08:00-one.md
node $DEVX plan-helper emit-retro-story --epic-slug qa-demo --parents qaa111 --plan plan/plan-qqq111-2026-08-01T08:00-qa.md
ls GRAPH.md
```

Expected:

```
spec=dev/dev-qaaret-2026-08-03T14:35-retro-qa-demo.md dev_md=DEV.md graph=GRAPH.md
GRAPH.md
```

Invariant: the line stays **key=value, not JSON** — `/devx-plan`'s RED stage
greps it with `sed -n 's/^graph=//p'`. Changing the separator, the key name,
or the key order breaks the commit pathspec in `.claude/commands/devx-plan.md`
silently, with no test between the rename and a broken planning run.

### 2. `devx graph --check` is green immediately after an emission

- [x] `machine` — the emission left the board fresh, with no manual regen in between

```bash
cd /tmp/qa-sgr104 && node $DEVX graph --check; echo "exit=$?"
```

Expected:

```
devx graph: GRAPH.md is up to date — 2 node(s), 1 edge(s), 1 group(s)
exit=0
```

Invariant: this is the emission arm of eval `E-5_loop-freshness.ts`. If it
goes red, the regen is running before the rename batch (rendering pre-emission
state) rather than after it.

### 3. The claim commit carries the board it just re-rendered

- [x] `machine` — `GRAPH.md` is in the claim commit alongside DEV.md and the spec, and `--check` is green afterwards

```bash
mkdir -p /tmp/qa-claim && cd /tmp/qa-claim
git init --bare -q -b main origin.git && git clone -q origin.git repo && cd repo
# … seed devx.config.yaml, .gitignore, DEV.md, dev/dev-qaa222-*.md, commit, push …
node $DEVX graph && git add GRAPH.md && git commit -q -m "chore: board" && git push -q origin main
node $DEVX devx-helper claim qaa222
git show --name-only --format= HEAD
node $DEVX graph --check; echo "exit=$?"
```

Expected:

```
{"branch":"feat/dev-qaa222","lockPath":"…/spec-qaa222.lock","claimSha":"6b4cf7b…"}
DEV.md
GRAPH.md
dev/dev-qaa222-2026-08-01T08:00-two.md
devx graph: GRAPH.md is up to date — 1 node(s), 0 edge(s), 1 group(s)
exit=0
```

Invariant: a claim commit whose DEV.md says `[/]` while its GRAPH.md still
renders `ready` is the drift this whole workstream exists to kill. The board
must be in the *same* commit as the flip, not a follow-up.

### 4. A project that gitignores its generated board still claims

- [x] `machine` — `git add` refusing GRAPH.md warns; the claim commit lands with the two authored artifacts

```bash
cd /tmp/qa-claim/repo
printf '.devx-cache/\n.worktrees/\nGRAPH.md\n' > .gitignore
git rm -q --cached GRAPH.md && git add .gitignore && git commit -q -m "chore: ignore board" && git push -q origin main
node $DEVX devx-helper claim qaa222
git show --name-only --format= HEAD
```

Expected:

```
devx claim: WARN — git add GRAPH.md failed (exit 1): The following paths are ignored by one of your .gitignore files:
GRAPH.md
…; the claim commit ships without the board — run `devx graph` and commit it separately
DEV.md
dev/dev-qaa222-2026-08-01T08:00-two.md
```

(The real run also reported `{"error":"rollback","stage":"worktree"}` because
the fixture reused a branch name left over from check 3 — `fatal: a branch
named 'feat/dev-qaa222' already exists`. The claim itself was durable
(`claim 8577f8b… is durable on origin/main`) and the commit contents are the
assertion here; a fresh fixture exits 0.)

Invariant: a **derived** file must never be able to fail a claim. Gitignoring
a generated board is an ordinary user choice; before this warn-and-continue
split, it would have made every claim in that repo fail permanently at stage
`git-add`.

### 5. The warnings read like something an operator can act on

- [ ] `human` — each new WARN names the file, the cause, and the recovery command · how to verify: run checks 1–4 and read every `devx claim: WARN —` / `WARN:` line; each should end in a concrete next step (`run \`devx graph\``, `commit it separately`), never just a stack-shaped complaint

Invariant: the whole failure posture is warn-and-continue, so the warning IS
the user interface for a failed regen. A warning nobody can act on turns a
recoverable staleness into a silent one.

### 6. The RED-stage prose is followable as written

- [ ] `human` — a reader can extract `graph=` and build the pathspec from the snippet alone · how to verify: read `## Stage: RED` step 4 in `.claude/commands/devx-plan.md`; confirm `$EMIT_LINE` is defined before use, and that the note about leaving `${GRAPH_PATH}` unquoted is present and explains why (a quoted empty pathspec is `fatal: empty string is not a valid pathspec`)

Invariant: this prose is executed by an agent, not a shell. An unexplained
"leave it unquoted" gets "fixed" by the next reader.

## Regressions to watch

- **The claim's rebase-retry (mlc104).** `GRAPH.md` carries a repo-wide
  summary banner that every status transition rewrites, so keeping it in a
  contended claim commit makes `pull --rebase` conflict and burns the retry
  budget at zero retries used. The board is now dropped from the commit the
  moment a race-shaped rejection is seen. Fastest proof:
  `npx vitest run test/graph-regen.test.ts -t "contended"`.
- **Rollback cleanliness.** A rolled-back claim must leave no trace of the
  board — restored bytes when one pre-existed, unlinked when the regen minted
  it. Proof: `npx vitest run test/graph-regen.test.ts -t "claim hook"`, plus
  `git status --porcelain` being empty in each of those fixtures.
- **Hook/CLI render parity.** If `regenerateGraph` and `devx graph` ever
  render differently, `--check` goes red on a clean tree with nothing to point
  at. Pinned byte-for-byte by the "renders byte-identically to what `devx
  graph` writes" case in `test/graph-regen.test.ts`.

## Post-merge follow-ups

- **E-5 stays RED** until sgr105 adds the third host (`devx devx-helper
  mark-done`). Its claim and emission arms pass now; the mark-done arm is what
  keeps it failing, and that is the intended Phase-4 state.
- **`emit-retro-story` run from inside a worktree** writes its artifacts —
  now including `GRAPH.md` — to the worktree instead of the main checkout.
  Pre-existing (it already wrote the spec and DEV.md there); filed as
  `debug/debug-7e2b56-…-emit-retro-worktree-root.md`.
- **Model warnings are dropped on the hook path.** `devx graph` prints
  `edge-drift` / `unknown-blocker` to stderr; `regenerateGraph` discards them
  by design (a claim should not spray board diagnostics). Revisit if
  `edge-drift` turns out to be worth surfacing at claim time.
