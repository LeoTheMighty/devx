---
hash: 8b9165
type: test
created: 2026-08-05T11:40:00-06:00
title: "QA walkthrough — sgr105 mark-done helper + Phase-8 rewrite"
from: sgr105
status: ready
---

# QA walkthrough — Story `sgr105`

> Merge-cleanup is now a mechanical host: `devx devx-helper mark-done <hash>
> --pr <n> --merge-sha <sha>` does the spec flip, the backlog flip + PR-URL
> append, the workstream `todo.md` sync, and the `GRAPH.md` regen, then hands
> back the exact pathspecs to stage. The user-visible surfaces are the CLI's
> stdout JSON, its exit-code contract, the shape of the rewritten DEV.md row,
> and `/devx` Phase 8's after-merge prose. This walkthrough does NOT cover the
> backfill (sgr106) or the packaged-CLI portability proof (sgr107).

## Pre-flight

```bash
cd /Users/leonidbelyi/personal/devx/.worktrees/dev-sgr105
npm run build                      # the checks below drive dist/cli.js
DEVX=$PWD/dist/cli.js

rm -rf /tmp/qa-sgr105 && mkdir -p /tmp/qa-sgr105/dev && cd /tmp/qa-sgr105
cp /Users/leonidbelyi/personal/devx/devx.config.yaml .
git init -q . && git config user.email q@a && git config user.name q
git remote add origin git@github.com:LeoTheMighty/devx.git
printf '# DEV\n\n### Epic — qa demo\n- [/] `dev/dev-qaa111-2026-08-01T08:00-one.md` — One. Status: in-progress.\n' > DEV.md
printf -- '---\nhash: qaa111\ntype: dev\ncreated: 2026-08-01T08:00:00-06:00\ntitle: "One"\nstatus: in-progress\n---\n\n## Goal\n\nx\n\n## Status log\n\n- claimed.\n' > dev/dev-qaa111-2026-08-01T08:00-one.md
node $DEVX graph >/dev/null 2>&1 && git add -A && git commit -qm base
```

## Manual checks

### 1. `mark-done` returns the pathspecs it wrote, and nothing else

- [x] `machine` — stdout is one JSON object naming exactly the files that changed

```bash
cd /tmp/qa-sgr105 && node $DEVX devx-helper mark-done qaa111 --pr 118 --merge-sha 9f3c1d20ab; echo "exit=$?"
```

Expected:

```
{"hash":"qaa111","paths":["DEV.md","dev/dev-qaa111-2026-08-01T08:00-one.md","GRAPH.md"],"todoSynced":false}
exit=0
```

Invariant: `paths` is what Phase 8 step 5 stages (`git add -- <paths>`). It
must list every file the call wrote and no others — a missing entry leaves an
uncommitted rewrite on `main` for the next session to trip over, and a spurious
one re-opens the blanket-stage authorship bug (`ba3c65b`) through the back
door. `todoSynced: false` here is correct: this fixture's item has no
workstream.

### 2. Both flips land, in the shape prior rows use

- [x] `machine` — backlog row `[/]→[x]` + `Status: done` + PR URL; spec `status: done` + append-only status-log line

```bash
cd /tmp/qa-sgr105 && grep -n 'qaa111' DEV.md && sed -n '1,16p' dev/dev-qaa111-2026-08-01T08:00-one.md
```

Expected:

```
4:- [x] `dev/dev-qaa111-2026-08-01T08:00-one.md` — One. Status: done. PR: https://github.com/LeoTheMighty/devx/pull/118 (merged 9f3c1d2)
---
hash: qaa111
type: dev
created: 2026-08-01T08:00:00-06:00
title: "One"
status: done
---

## Goal

x

## Status log

- claimed.
- 2026-08-05T11:37:21-06:00 — merged via PR #118 (squash → 9f3c1d2)
```

Invariant: the prior status-log line survives verbatim — the log is
append-only (CLAUDE.md working agreement), and mark-done is the first
mechanical writer to it. The PR URL is derived from `git remote get-url
origin`; a non-GitHub remote degrades to `PR: #<n>` rather than fabricating a
github.com link. The timestamp is wall-clock, so yours will differ.

### 3. The board is fresh with no manual regen in between

- [x] `machine` — `devx graph --check` exits 0 immediately after the cleanup flow

```bash
cd /tmp/qa-sgr105 && node $DEVX graph --check; echo "exit=$?"
```

Expected:

```
devx graph: GRAPH.md is up to date — 1 node(s), 0 edge(s), 1 group(s)
exit=0
```

Invariant: this is FR-4's third host and the leg that flips E-5 green. If a
future edit moves the regen before the rename batch, the board in the cleanup
commit disagrees with the DEV.md row inside the same commit — and `--check`
here is the only thing that catches it.

### 4. A state mismatch refuses and writes nothing

- [x] `machine` — a second `mark-done` on the same hash exits 1 and leaves DEV.md byte-identical

```bash
cd /tmp/qa-sgr105 && cp DEV.md .dev-before
node $DEVX devx-helper mark-done qaa111 --pr 119 --merge-sha abc1234; echo "exit=$?"
diff -q .dev-before DEV.md && echo "DEV.md UNCHANGED"
```

Expected:

```
{"error":"mark-done-failed","stage":"state"}
devx devx-helper mark-done: [state] row for hash 'qaa111' is in [x] state, not [/] (in-progress) — mark-done closes a claimed item; claim it first, or it is already done
exit=1
DEV.md UNCHANGED
```

Invariant: exit 1 is the do-not-write tier. An agent that merged the wrong PR,
or a second session racing the first, must bounce off this — never overwrite a
row a peer owns. The "nothing was written" half matters as much as the exit
code: the flips are composed before either is renamed, so a mismatch found on
the spec cannot leave the backlog flipped.

### 5. The exit-1 message is actionable without reading the source

- [ ] `human` — the stage-`state` stderr line tells an operator what went wrong and what to do next · how to verify: run check 4 and read the stderr line alone, without the JSON; it should name the observed state (`[x]`), the required state (`[/]`), and the two plausible causes — no source dive.

Invariant: mark-done's failures land on operators mid-merge, when context is
thin. A message that only says "state mismatch" costs a source read at the
worst moment.

### 6. Phase 8's rewritten prose is followable as written

- [ ] `human` — an agent reading `.claude/commands/devx.md` §Phase 8 "After merge" top-to-bottom can execute steps 1–7 with no hand-editing and no guesswork · how to verify: read the after-merge list; confirm step 4's three exit-code routes each say what to DO (not just what happened), and that step 5's `git add -- <paths from step 4>` reads as the only staging instruction.

Invariant: this list is the program. The pre-sgr105 version told agents to
hand-edit three files and then remember an explicit-pathspec rule; the
rewrite's whole value is that the pathspecs arrive as data. Prose that drifts
back toward "update the spec file, update DEV.md" reintroduces the incident
class.

## Regressions to watch

- **The claim path.** `mark-done` and `claim` now share `escapeRegex`,
  `relativeFromRepo`, `formatIsoLocal`, `BACKLOG_BY_TYPE` and the status-log
  splice (extracted to `src/lib/devx/status-log.ts`). The extraction is
  behaviour-preserving, and `test/devx-claim.test.ts` is what proves it —
  if it goes red, suspect the splice, not the new code.
- **Row shape drift.** `flipBacklogRowDone` anchors `Status: in-progress` on a
  `.`/whitespace/EOL lookahead, same as the claim's flip. A backlog row that
  stops matching fails loudly (exit 1), but a row that matches the WRONG item
  would not — the path-component anchor (`dev-<hash>-`) is the guard, and the
  `sgr10` vs `sgr105` decoy case in the unit tests is what pins it.
- **Where it may run.** `mark-done` refuses a linked worktree (exit 2, stage
  `resolve`) via mlc101's `interpretRevParse` — the same guard `claimSpec`
  carries, and the hole `debug-7e2b56` tracks in `emit-retro-story`. Phase 8
  runs it after step 2 removes the worktree, so the guard should never fire in
  practice; if it does, the operator is in the wrong tree and the message says
  which one is right.
- **E-5.** `_devx/workstreams/story-graph/evals/E-5_loop-freshness.ts` is the
  three-flow contract. Re-run it (`npx tsx …`) after any change to the claim,
  the emission, or this helper — it is the only artifact that asserts all
  three flows keep the board fresh together.

## Post-merge follow-ups

- `mark-done` is write-only in v1: the skill still owns `git add` / `commit` /
  `push`, symmetric with it owning the merge. Folding those in is a recorded
  non-blocking question in `_devx/workstreams/story-graph/design.md`.
- The abandoned/superseded path (`~~…~~` row) stays a hand edit — mark-done
  deliberately covers the merged case only. Next revisit of the split/abandon
  flow picks it up.
