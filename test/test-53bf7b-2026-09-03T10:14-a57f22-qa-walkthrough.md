---
hash: 53bf7b
type: test
created: 2026-09-03T10:14:00-06:00
title: "QA walkthrough — skill bodies name the folder shape, not the layout (a57f22)"
from: dev/dev-a57f22-2026-09-02T15:10-skill-body-layout-paths.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `a57f22`

> Removes every hardcoded `_devx/workstreams/<slug>/…` path from the two
> writing skills (and two engine templates), replacing them with either the
> CLI that already resolves the path or a doc-set-relative name covered by
> each document's **Layout:** anchor; adds a structural test that keeps them
> out. The user-visible surface is agent-facing prose shipped in the npm
> package — no CLI behavior, no gate verdict, and no resolver code changes.
> This walkthrough does NOT cover the `project-level` layout end-to-end
> (`devx layout migrate` is dlr106's surface, already shipped and tested).

## Pre-flight

```bash
cd /Users/leonidbelyi/personal/devx
git checkout feat/dev-a57f22
npm ci --silent   # only if node_modules is stale; the checks below need tsx + vitest
```

## Manual checks

### 1. No shipped prose surface names a workstream-rooted artifact path

- [x] `machine` — proves the defect class is gone from every skill body and
  engine template, not just the nine cited sites.

```bash
grep -rn '_devx/workstreams' .claude/commands/ skills/ _devx/templates/ || echo "(no hits)"
```

Expected:

```
(no hits)
```

Invariant: that prefix does not exist under `engine.docs_layout:
project-level` — the doc set is the repo root. Any occurrence is prose
telling an agent to write where no CLI reads, and it fails silently: the
gate reports a missing subject while a good artifact sits three directories
away.

### 2. The new invariant test passes, and actually fails on the regression

- [x] `machine` — proves the guard is a guard, not a tautology. The injected
  line is the exact bare-root shape `devx-plan.md` used before this story.

```bash
npx vitest run test/skill-body-layout-paths.test.ts 2>&1 | tail -4
cp .claude/commands/devx-walk.md /tmp/ws.bak
printf '\nWorkstream artifacts live in `%s/`.\n' '_devx/workstreams' >> .claude/commands/devx-walk.md
npx vitest run test/skill-body-layout-paths.test.ts 2>&1 | grep -E 'devx-walk.md:[0-9]+' | head -1
cp /tmp/ws.bak .claude/commands/devx-walk.md && rm /tmp/ws.bak && echo REVERTED
```

Expected:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
  .claude/commands/devx-walk.md:163 — _devx/workstreams/: expected [ Array(1) ] to deeply equal []
REVERTED
```

Invariant: the scan must name the offending `file:line` and the matched
path. A guard that only says "failed" costs the next agent a bisect.

### 3. S-1 prose budget stays green without raising `engine.prose_budget_kb`

- [x] `machine` — proves AC 4, including the full-run drift tripwire that had
  only 37 bytes of headroom on `main` before this change.

```bash
npx vitest run test/engine-prose-budget.test.ts 2>&1 | tail -4
P=$(wc -c < .claude/commands/devx-plan.md); D=$(wc -c < .claude/commands/devx.md)
T=$(find _devx/templates/engine -name '*.md' -exec wc -c {} + | tail -1 | awk '{print $1}')
echo "canary headroom $((61440-T-P)) | tripwire headroom $((122880-T-P-D))"
```

Expected:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
canary headroom 6127 | tripwire headroom 61
```

Invariant: both numbers stay positive and `engine.prose_budget_kb` stays at
60. The tripwire is the tight one — it was at 37 bytes on `main`, so any
future prose PR must measure it, not just the canary.

### 4. `skills/` mirror is byte-identical to `.claude/commands/`

- [x] `machine` — the npm package ships `skills/`; editing only the canonical
  dir would ship the old prose.

```bash
npx vitest run test/skills-sync.test.ts 2>&1 | tail -3
```

Expected:

```
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

Invariant: every skill-body edit runs `npm run sync:skills` before commit.

### 5. `devx graph --check` is clean

- [x] `machine` — AC 5's second half; the new test spec adds a node.

```bash
npx devx graph --check
```

Expected:

```
devx graph: GRAPH.md is up to date — 230 node(s), 448 edge(s), 25 group(s)
```

Invariant: `GRAPH.md` is generated; drift means a spec was added without
regenerating.

### 6. The two rewritten skill bodies still read as coherent instructions

- [ ] `human` — the nine sites lost their absolute prefix; a reader must
  still be able to tell WHERE an artifact goes · how to verify: open
  `.claude/commands/devx-plan.md` and read the **Layout:** line in Step 0
  (~line 31) plus the PRD stage's "Artifacts:" and "Todo step:" lines
  (~lines 122–130); then `.claude/commands/devx.md` **Layout:** line
  (~line 40) plus Phase 2 steps 2–3 (~lines 188–203). Each artifact name
  should read as a name whose location the anchor and the CLIs decide.

Invariant: the anchor is one sentence pointing at `docs/CONFIG.md` §15. A
second copy of §15's table anywhere in a skill body is the failure dlr107
closed (AC 2) — if you find one, that is a bug.

### 7. Rule 8 still tells an agent how to FIND an outline in both layouts

- [ ] `human` — byte-trimming removed and then restored this; confirm it
  survived · how to verify: `.claude/commands/devx-plan.md` rule 8 (~line 66)
  must still name `<stage>-outline.md` at the repo root for `project-level`.
  Agents read outlines but never write them, so losing that name makes the
  "Present → read it" step fail to find a file that exists.

Invariant: outlines stay human-only in both layouts, and the read path must
work in both.

## Regressions to watch

- **A future prose PR trips the S-1 full-run tripwire.** It sits at 61 bytes
  of headroom (was 37 on `main`). The canary assertion in the same test file
  has ~6 KB free, so measuring only the canary — as this story's own AC 4
  did — reads as "comfortable" while the binding constraint is one sentence
  away from red. Measure both; see INTERVIEW Q#9.
- **A new skill body ships with hardcoded paths.** The scan globs
  `.claude/commands/*.md` rather than listing files, so a seventh command
  inherits the invariant automatically — but only if it is added to that
  directory. A skill shipped from anywhere else is unguarded.
- **`_devx/templates/engine/` gains a new scaffold with a "Lives in …"
  header.** Two existed and both hardcoded the root. The scan now covers the
  templates tree recursively, so this fails at CI rather than at the next
  layout switch.

## Post-merge follow-ups

- No CLI prints a resolved artifact path today (`devx layout` has only
  `migrate`), so AC 1's preferred "name the CLI" form was available at only
  two of the nine sites. A `devx layout path <kind> [<hash>]` primitive would
  let skill bodies name a command everywhere instead of a name-plus-anchor —
  deliberately not built here (new CLI surface, out of this item's scope).
- `dev-lay101` — the `project-level` one-doc-set refusal is still unenforced;
  same family, different surface.
