---
hash: ef5059
type: test
created: 2026-09-02T13:16:00-06:00
title: "QA walkthrough — identity re-key and privatization (dlr105)"
from: dev/dev-dlr105-2026-09-02T09:14-identity-rekey-privatization.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `dlr105`

> `CASCADE_TABLE` is now keyed on `ArtifactKind` instead of a path string, and
> the six stage-shaped `*_REL` constants plus `artifactAbs` went module-private.
> The user-visible surfaces are `devx revise`'s help text, its two refusals and
> its JSON `touched:` field, plus the refusal text of `devx plan-helper
> validate-emit` and the help text of `devx workstream new`. This walkthrough
> does NOT cover `project-level` behavior end-to-end — no repo in this
> organization runs that layout yet, so those checks are human and deferred to
> the same first-real-repo pass dlr106 needs (MANUAL.md MV-a494be.1).

## Pre-flight

```bash
cd .worktrees/dev-dlr105
npm run build
```

## Manual checks

### 1. The `--touched` help still lists real paths, not `[object Object]`

- [x] `machine` — `KNOWN_ARTIFACTS` survived the re-key with a `display`
  projection; this is the surface that renders it with no repo in hand.

```bash
node dist/cli.js revise --help
```

Expected:

```
Options:
  --touched <path>  the artifact being revised: prd/agent.md | expectations.md
                    | design/agent.md | plan/agent.md (workstream-relative
                    path, root basename, or stage shorthand prd|design|plan)
  -h, --help        display help for command
```

Invariant: `CascadeEntry.artifact` is an object. Any site that interpolates it
directly renders `[object Object]` — which is not a crash, does not change the
frontmatter the command writes, and no other test in the suite would notice.

### 2. The unknown-artifact refusal renders paths and writes nothing

- [x] `machine` — the refusal is the one place a typo is caught; it has to say
  what the user should have typed, and it must not touch the spec.

```bash
node dist/cli.js revise a494be --touched notes.md; echo "exit=$?"
git diff --stat -- plan/
```

Expected:

```
devx revise: unknown artifact 'notes.md' — the cascade table covers: prd/agent.md, expectations.md, design/agent.md, plan/agent.md. Refusing (a typo here must not reset gate flags).
exit=1
```

(`git diff --stat -- plan/` prints nothing — the spec is untouched.)

Invariant: a refused `--touched` never clears a gate flag. This is the worst
possible failure shape for the command, which is why the refusal path is
checked before the success path.

### 3. The cross-workstream refusal names the expected path through the layout

- [x] `machine` — this hint used to be built as `${ws.workstreamRel}/${entry.artifact}`;
  it now comes from `stageSubject().rel`, which is where the layout is applied.

```bash
node dist/cli.js revise a494be --touched _devx/workstreams/harness-fold-in/design/agent.md; echo "exit=$?"
```

Expected:

```
devx revise: '_devx/workstreams/harness-fold-in/design/agent.md' is not an artifact of workstream '_devx/workstreams/docs-layout-resolution' (expected _devx/workstreams/docs-layout-resolution/design/agent.md or the bare basename)
exit=1
```

Invariant: the path in the hint is the path the command would actually accept.
A hint rendered from a different resolver than the check is a hint that sends
the user to a file the check will reject.

### 4. `validate-emit`'s refusal names the plan artifact through the layout

- [x] `machine` — it lost its `PLAN_REL` import; the name is now resolved from
  the repo's own layout, so a flat repo will read `plan.md` here.

```bash
node dist/cli.js plan-helper validate-emit no-such-epic
```

Expected:

```
devx plan-helper validate-emit: no plan/agent.md or epic file found for 'no-such-epic' (tried: <repo>/_devx/workstreams/no-such-epic/plan/agent.md, <repo>/_bmad-output/planning-artifacts/epic-no-such-epic.md)
```

Invariant: this line tells the operator which file to go author. Genericizing
it to "no plan artifact" (the first fix attempted here) compiles, passes
typecheck, and breaks `test/plan-validate-emit.test.ts:818` — the assertion
exists because the specific name is the useful part.

### 5. E-2 is GREEN and E-3 stayed GREEN

- [x] `machine` — E-2 is this phase's expectation; E-3 is the one the
  privatization must not disturb.

```bash
npx tsx _devx/workstreams/docs-layout-resolution/evals/E-2_single-reader.ts
npx tsx _devx/workstreams/docs-layout-resolution/evals/E-3_no-hand-joins.ts
```

Expected:

```
E-2 GREEN — exactly one function reads the layout key; artifacts.ts exports no orphaned resolver.
E-3 GREEN — 0 hand-joined stage-subject paths outside the resolver; the negative control still discriminates.
```

Invariant: E-3's verdict must not move. The privatization is a structural
defense — it makes a future bypass harder to write; it does not close a live
one, and a scan whose verdict changed would mean it had been blunted.

### 6. A real cascade still resets the right flags

- [ ] `human` — MUTATES a spec, so it is not run at emission · how to verify:
  pick a workstream whose gates you are willing to roll back (or copy one to a
  scratch repo), run `devx revise <hash> --touched design.md`, and confirm the
  JSON carries `"touched":"design/agent.md"` (a path, not `[object Object]`),
  `"stage":"design"`, and that the spec's `design_verified` / `plan_verified` /
  `evals_red` went false while `prd_validated` survived. `git checkout` the
  spec afterwards.

Invariant: the flat-era spelling `design.md` must keep working in this
folder-layout repo — every pre-migration `decisions/` report says it. Refusing
it would silently leave stale gate flags standing over a rewritten artifact.

### 7. `project-level` renders the flat spellings

- [ ] `human` — no repo here runs that layout · how to verify: on the first
  real `project-level` repo (MANUAL.md MV-a494be.1 / dlr106), run `devx revise
  <hash> --touched notes.md` and confirm the covered list reads `prd.md,
  expectations.md, design.md, plan.md` — NOT the `prd/agent.md` spellings the
  help text shows. The help text is layout-blind by design (it renders with no
  repo in hand); the refusal is not.

Invariant: a flat repo must never be told to type a path it does not have.

## Regressions to watch

- **`devx revise` refusing every invocation.** The failure mode this phase
  exists to prevent: a `CASCADE_TABLE` keyed on one layout's spelling matches
  nothing under the other, `cascadeFor()` returns null, and the command
  refuses 100% of the time. Fastest proof it didn't: check 1 plus
  `node dist/cli.js revise a494be --touched design.md` returning exit 0.
- **`--touched PLAN.md` cascading the plan gates.** The reverse index
  lowercases its keys, and devx's own `PLAN.md` backlog sits beside the doc
  set's `plan.md` under `project-level`. `cascadeFor` narrows the lookup back
  to an exact spelling for exactly this reason; `test/engine-revise.test.ts`
  pins `PLAN.md`, `PRD`, `Design.md` and `prd/AGENT.md` as refusals.
- **A privatized constant coming back.** `test/engine-layout-single-reader.test.ts`
  asserts each of the six is defined-but-not-exported. It checks BOTH halves on
  purpose: a constant that was deleted rather than privatized would satisfy the
  "not exported" half and make the guard vacuous.

## Post-merge follow-ups

- `debug/debug-5284ae` — the phase-4 discipline check escapes the feature
  branch and reds `main` at merge time. Found here; dlr104's missing line was
  reconstructed in this PR, the escape route is not fixed.
- `dlr106` (`devx layout migrate`) and `dlr107` (doc truth) are unblocked by
  this phase and own the remaining `project-level` verification, including
  check 7 above.
