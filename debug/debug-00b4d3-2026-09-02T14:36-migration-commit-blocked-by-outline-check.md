---
hash: 00b4d3
type: debug
created: 2026-09-02T14:36:00-06:00
title: "A layout-migration commit is blocked by devx outline check"
from: dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md
status: ready
owner: null
branch: null
---

## Goal

A repo that runs `devx layout migrate` can commit the result and open a PR.

Today it cannot. `devx layout migrate` moves the human-only outline files —
AC 8 of dlr106 requires it, because a migration that moved everything except
the human's outlines would break the tree in the one place the human cares
most. But `devx outline check` classifies a path by NAME and fails the diff
whenever an outline appears in it and its content is not byte-identical to a
pristine scaffold. A rename satisfies neither condition it looks for, so the
migration commit is refused by the repo's own merge gate with no escape hatch.

Reproduced during dlr106's Phase 4 review (Blind Hunter finding 7): migrate,
`git add -A && git commit`, then

```
runOutlineCheck({ diff: "HEAD~1...HEAD" })
→ exit 1
  {"clean":false,"touched":["prd-outline.md"],"scaffolds":[],"range":"HEAD~1...HEAD"}
```

## Acceptance criteria

- [ ] AC 1: A repro exists — a test that migrates a fixture, commits, and
      asserts `devx outline check` on that range.
- [ ] AC 2: Root cause documented with evidence: which predicate in
      `src/lib/engine/outline.ts` / `src/commands/outline.ts` decides, and why
      a rename reaches it.
- [ ] AC 3: A pure rename whose blob is unchanged passes the check
      (`git diff --name-status -M` reports it as `R100`), OR an explicit,
      documented escape is defined. The guarantee must not weaken: a rename
      adds no human content, which is the same criterion the existing
      pristine-scaffold exemption already applies. A change of CONTENT plus a
      rename must still fail.
- [ ] AC 4: The chosen behavior is added to the migration's own
      documentation — MANUAL.md MV-a494be.1 currently tells the operator to
      expect this and work around it by hand.

## Technical notes

Deliberately NOT fixed inside dlr106. The fix edits the outline guard, which
is a three-layer human-only guarantee (PreToolUse hook + `outline check` +
`outline commit`) owned by a different subsystem, and dlr106's scope is the
migration surface. Widening a phase to weaken a guard it merely collides with
is how guards get weakened quietly — this gets its own diff and its own review.

Workaround until then, recorded in MANUAL.md MV-a494be.1: commit the outline
renames separately on the base branch with `devx outline commit`, or land the
migration on the base branch directly (migration is an attended, human-run
operation, so neither is the burden it would be for an agent flow).

## Status log

- 2026-09-02T14:36 — filed from dlr106 Phase 4 adversarial review (3-agent
  parallel shape; Blind Hunter finding 7, reproduced against a real fixture).
