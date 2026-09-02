---
hash: 4bd69f
type: test
created: 2026-09-02T10:38:00-06:00
title: "QA walkthrough — gate subject resolution through engine.docs_layout (dlr102)"
from: dev/dev-dlr102-2026-09-02T09:14-gate-subject-resolution.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `dlr102`

> The four engine gates (`devx gate prd`, `devx gate coverage` in design and
> plan modes, `devx gate evals`) now resolve their artifact subject through
> `engine.docs_layout`, so a `project-level` repo gets the same verdict — and
> a usable refusal — for the same content as a `workstream` repo. Covers the
> gate CLI's stdout contract (verdicts, `gaps[].message`, `gaps[].location`,
> refusals) and the verify-report Subject line. Does NOT cover
> `devx workstream new` scaffolding, `devx doctor`, `devx next`, or
> `devx revise` under `project-level` — those are phases 3–5.

## Pre-flight

```bash
cd /path/to/devx && npm ci
# Two throwaway repos with byte-identical PRD content, one per layout.
# The `workstream:` frontmatter is `.` for project-level and
# `_devx/workstreams/demo` for workstream — that is the ONLY difference
# besides where the files sit.
```

## Manual checks

### 1. A `project-level` repo's gate refusal names a file that can exist there

- [x] `machine` — the pre-fix bug: `gate prd` told a flat-layout author to go
  author `./prd/agent.md`, a path that layout never has.

```bash
# project-level repo, no artifacts authored yet
cd "$FLAT_REPO" && npx tsx "$DEVX/src/cli.ts" gate prd qa0001
```

Expected:

```
{"gate":"FAIL","hash":"qa0001","gaps":[{"check":"gate-input-missing","message":"prd.md does not exist — run `/devx prd qa0001` first"},{"check":"gate-input-missing","message":"expectations.md does not exist — run `/devx prd qa0001` first"}]}
exit=1
```

Invariant: the refusal names `prd.md`, never `prd/agent.md` and never a
`./`-prefixed spelling. A refusal that names a file the layout cannot hold is
a dead end for the author it is addressed to.

### 2. The same command in a `workstream` repo names that layout's path

- [x] `machine` — same state, same verdict, the other spelling.

```bash
cd "$FOLDER_REPO" && npx tsx "$DEVX/src/cli.ts" gate prd qa0001
```

Expected:

```
{"gate":"FAIL","hash":"qa0001","gaps":[{"check":"gate-input-missing","message":"_devx/workstreams/demo/prd/agent.md does not exist — run `/devx prd qa0001` first"},{"check":"gate-input-missing","message":"_devx/workstreams/demo/expectations.md does not exist — run `/devx prd qa0001` first"}]}
exit=1
```

Invariant: identical `gate`, identical `check`, identical exit code. Only the
path differs, because only the path differs on disk.

### 3. A `location:` on a real gap points at the file the author must open

- [x] `machine` — `location:` is part of the gate's output contract. Both
  repos carry the same PRD with one placeholder section.

```bash
cd "$FLAT_REPO"   && npx tsx "$DEVX/src/cli.ts" gate prd qa0001
cd "$FOLDER_REPO" && npx tsx "$DEVX/src/cli.ts" gate prd qa0001
```

Expected:

```
{"gate":"FAIL","hash":"qa0001","gaps":[{"check":"prd-section-placeholder","message":"prd.md `## Non-goals` still contains template furniture: <what we are not doing>","location":"prd.md:11"}]}
exit=1

{"gate":"FAIL","hash":"qa0001","gaps":[{"check":"prd-section-placeholder","message":"_devx/workstreams/demo/prd/agent.md `## Non-goals` still contains template furniture: <what we are not doing>","location":"_devx/workstreams/demo/prd/agent.md:11"}]}
exit=1
```

Invariant: same `check`, same line number, same furniture quoted. The
`location:` is repo-relative in BOTH layouts now — clickable from the repo
root rather than resolvable only if you already knew the workstream dir.

### 4. All 8 layout×gate combinations agree, and cannot agree by failing together

- [x] `machine` — the workstream's P0 eval, which builds real git repos and
  shells the CLI once per combination.

```bash
npx tsx _devx/workstreams/docs-layout-resolution/evals/E-1_gate-subjects.ts
```

Expected:

```
E-1 GREEN — all 8 layout×gate combinations agree, are pinned absolutely, and print only paths that exist.
exit=0
```

Invariant: GREEN requires all three legs — equality, the absolute PASS/FAIL
pins on good/broken fixtures, and printed-path existence under
`project-level`. Equality alone would go green on a regression that broke
both layouts identically.

### 5. The same invariant is pinned in `npm test`, not only in the eval

- [x] `machine` — 28 in-process tests over the same 8 combinations, the three
  refusal strings, the two committed records, and the structural
  layout-blindness pin.

```bash
npx vitest run test/engine-layout-gate-subjects.test.ts
```

Expected:

```
 ✓ test/engine-layout-gate-subjects.test.ts (28 tests)
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

Invariant: the eval is a one-shot RED-gate artifact; this file is what keeps
the invariant from rotting between workstreams. It is also strictly stricter
than the eval — it asserts no printed path is `./`-prefixed, which the
existence check alone cannot see (`path.join` collapses `./`), and it reaches
the three refusal strings no verdict combination touches.

### 6. The layout is never a gate INPUT

- [x] `machine` — the pure evaluators import no layout symbol, so no branch
  inside a gate body can ever disagree with another.

```bash
npx vitest run test/engine-layout-gate-subjects.test.ts -t "layout is never a gate input"
```

Expected:

```
 Test Files  1 passed (1)
      Tests  4 passed | 24 skipped (28)
```

Invariant: `gate-prd.ts`, `gate-coverage.ts` and `gate-evals.ts` may mention
the layout in a comment but must never import `DocsLayout`, `stageSubject`,
or a hardcoded `*_REL` subject constant. They receive resolved paths.

### 7. devx's own gates behave exactly as they did on `main`

- [x] `machine` — run both builds against two identical scratch copies of
  devx's own `docs-layout-resolution` workstream and diff everything.

```bash
# copy the workstream twice; run main's CLI on one and the branch's on the other
( cd "$COPY_A" && npx tsx "$MAIN/src/cli.ts" gate prd a494be )
( cd "$COPY_B" && npx tsx "$BRANCH/src/cli.ts" gate prd a494be )
diff -r "$COPY_A" "$COPY_B"
```

Expected:

```
{"gate":"PASS","hash":"a494be","flipped":{"prd_validated":true,"stage":"executing"},"spec":"plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md"}
exit=0
```

and, after a real design-mode coverage PASS on both copies, the only file
difference in the whole tree:

```
13c13
< `design/agent.md` reviewed against `prd/agent.md` (design mode; workstream `a494be`).
---
> `_devx/workstreams/docs-layout-resolution/design/agent.md` reviewed against `_devx/workstreams/docs-layout-resolution/prd/agent.md` (design mode; workstream `a494be`).
```

Invariant: verdicts, exit codes, `gate_status` flips and stage advances are
byte-identical to `main`. The verify report's Subject line is the one
intended change (AC 4: gate-coverage's subject strings move onto
`subject.rel`), and it now agrees with the same report's own repo-relative
`report:` pointer instead of contradicting it.

### 8. A human reads one flat-layout refusal and knows what to do next

- [ ] `human` — the whole point of the change is that the message is
  actionable, not merely correct · how to verify: run check 1 in a
  `project-level` repo and confirm the named file is one you could create
  right now at the repo root, with no mental translation from the
  folder-layout spelling.

Invariant: a gate refusal is a work instruction. If a reader has to know
which layout the repo uses before they can act on it, the message has failed
even when the verdict is right.

## Regressions to watch

- **The `workstream`-layout `location:` spelling changed.** Gaps now read
  `_devx/workstreams/<slug>/prd/agent.md:42` instead of `prd/agent.md:42`.
  Anything that parsed the old form — a skill body, an editor jump, a
  downstream grep — sees a longer path. Prove it: `npx vitest run
  test/engine-gate-prd.test.ts` (the orphan-goal case asserts the new shape
  explicitly).
- **The verify report's Subject line.** Same change, in a committed
  artifact. Old reports under `decisions/` keep the old spelling; that is
  history, not drift. Prove it: check 7's diff.
- **`detectCoverageMode` and `evaluateGatePrd` gained required fields.** A
  new caller that forgets them fails to compile rather than silently
  defaulting to the folder spelling — that was deliberate. Prove it:
  `npx tsc --noEmit -p tsconfig.json`.

## Post-merge follow-ups

- `devx gate --help`'s phase blurbs still name `prd/agent.md` and
  `evals/RED-report.md` as static prose (`src/commands/gate.ts` in the
  `attachPhase` calls). No workstream is resolved there, so there is nothing
  to resolve against — dlr107 (doc truth) owns that surface.
- Workstream RESOLUTION under `project-level` for the two frontmatter states
  this walkthrough does not exercise (no `workstream:` pointer;
  filename-slug derivation) is dlr103.
- The remaining ~21 `*Abs()` call sites outside the gates are dlr104's sweep.
