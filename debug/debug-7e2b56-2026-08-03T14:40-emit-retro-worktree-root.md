---
hash: 7e2b56
type: debug
created: 2026-08-03T14:40:00-06:00
title: "emit-retro-story writes its artifacts to a linked worktree's root"
from: sgr104
status: ready
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
