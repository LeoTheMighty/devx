---
hash: 7e2b56
type: debug
created: 2026-08-03T14:40:00-06:00
title: "emit-retro-story writes its artifacts to a linked worktree's root"
from: sgr104
status: done
owner: /devx-loop-2026-08-19T19-39-20-483-20983
---

## Goal

`devx plan-helper emit-retro-story` run with a cwd inside
`.worktrees/<type>-<hash>/` should write its artifacts to the **main
checkout**, or refuse — not silently fork a copy of the board and the backlog
onto a feature branch.

## Repro

```bash
cd <repo>/.worktrees/dev-<hash>
devx plan-helper emit-retro-story --epic-slug <slug> --parents <h1> --plan <path>
```

`runEmitRetroStory` resolves `repoRoot = opts.repoRoot ?? dirname(findProjectConfig())`
(`src/commands/plan-helper.ts`), and `findProjectConfig()` walks up from cwd —
which finds the **worktree's own** `devx.config.yaml`. The emitted `dev/<spec>`,
the spliced `DEV.md`, and (since sgr104) the regenerated `GRAPH.md` all land
inside the worktree, on the feature branch. The main checkout's copies stay
untouched, so `devx next` and `devx graph --check` never see the emission.

## Root cause

Two sibling surfaces already solve this and `emit-retro-story` is the odd one
out:

- `claimSpec` **refuses** a linked-worktree `repoRoot` outright — the mlc101
  canonical-root assertion (`src/lib/devx/claim.ts`, stage `validate`).
- `devx graph` **retargets** to the canonical main checkout —
  `resolveGraphRoot()` in `src/commands/graph.ts`, whose header comment calls
  the linked-worktree arm "load-bearing".

`plan-helper.ts` does neither; it trusts the config-walk.

## Acceptance criteria

- [ ] AC 1: repro exists — a test standing up a real repo + linked worktree
      and running `runEmitRetroStory` with a cwd inside it.
- [ ] AC 2: the resolution is shared, not re-implemented — `plan-helper`
      routes through the same primitive `claimSpec` / `resolveGraphRoot` use
      (`resolveRepoRoot` in `src/lib/repo-root.ts`).
- [ ] AC 3: the chosen posture (refuse like claim, or retarget like graph) is
      stated in the file header with its reason. Refuse is the recommendation:
      an emission is a planning act on `main`, and silently retargeting would
      write files the operator's cwd says nothing about.
- [ ] AC 4: regression test pinning it; no change to the non-worktree path.

## Technical notes

- Pre-dates sgr104 — the spec + DEV.md have always gone to the resolved root.
  sgr104 only adds a third file (`GRAPH.md`) to the same wrong place, which is
  how it surfaced (3-agent adversarial review, all three agents independently).
- Low reach in practice: `/devx-plan` runs from the main checkout, and
  "worktrees are isolation, not staging" (CLAUDE.md) already forbids running a
  non-`/devx` flow inside one. This is a guard, not a live incident.

## Status log

- 2026-08-03T14:40 — filed from sgr104's Phase 4 self-review (out of scope
  there: sgr104 adds a file to an existing misresolution rather than causing
  it).
- 2026-08-19T14:57:55-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-19T21:27:10.827Z — loop iteration 1: `devx plan-helper emit-retro-story` now refuses a linked-worktree repo root via the shared resolveRepoRoot primitive, with a real-worktree repro/regression suite and the posture documented in the file header.
  - Change: runEmitRetroStory classifies its resolved repoRoot through resolveRepoRoot (src/lib/repo-root.ts) and refuses a linked worktree with exit 1 naming the canonical main checkout; indeterminate probes skip the check, matching claim's and split's posture
  - Change: plan-helper.ts header states the refuse-not-retarget posture and why emit-retro-story diverges from `devx graph` (three planning-act writes vs one derived artifact), documents the new exit-1 case, and links the debug spec
  - Change: test/worktree-refusal.test.ts gains a real git repo + linked-worktree fixture and three cases: cwd-inside-worktree refusal (asserting no spec/DEV.md/GRAPH.md in either checkout), explicit repoRoot seam refusal, and an unchanged main-checkout emission
  - Learning: The bug is worse than 'writes to the wrong place': with the guard stubbed out, the worktree run returns exit 0 and prints a normal `spec=... dev_md=... graph=...` summary line, so the /devx-plan skill body would happily `git add` three files that only exist on a feature branch — silent success, not a visible failure.
  - Learning: test/worktree-refusal.test.ts is already the canonical multi-surface home for this class (loop + manage) and is already listed in SYNC_BLOCKING_TESTS in vitest.shared.ts, so real-git + process.chdir cases can be added there with no vitest config change and no partition risk.
  - Learning: Every existing plan-helper/emit-retro test uses non-git mkdtemp roots, so the indeterminate-probe skip means the 58 pre-existing tests are untouched by the guard — that is what makes 'no change to the non-worktree path' cheap to guarantee here.
  - Learning: resolveRepoRoot has a side effect on the refusal path: it mkdirs `.devx-cache` at the canonical root when that root has a devx.config.yaml. Harmless (gitignored, and loop/manage already do it) but worth knowing before asserting 'refusal writes nothing' too literally in future tests.
- 2026-08-19T21:30:29.225Z — phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103
- 2026-08-19T21:30:29.225Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/129
