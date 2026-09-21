---
hash: 09451f
type: debug
created: 2026-09-20T18:25:00-06:00
title: workstream-migration-integrity asserts >=9 workstreams; only 1 remains after archiving
from: 828385
spawned: []
status: ready
owner: null
branch: null
---

## Goal

`npm test` is green on `main`.

## Evidence

`test/workstream-migration-integrity.test.ts:36` asserts:

```ts
expect(slugs.length).toBeGreaterThanOrEqual(9);
```

`_devx/workstreams/` now contains exactly **one** entry
(`usage-window-governor`); the rest were moved to `_devx/archive/`. So the
guard fails:

```
AssertionError: expected 1 to be greater than or equal to 9
  test/workstream-migration-integrity.test.ts:36:26
```

**Pre-existing, not caused by 828385.** Reproduced on a clean `main`
worktree with no local changes — same assertion, same numbers — before any
828385 work was applied. Full suite otherwise green: 140/141 files,
3315 passing.

The assertion is a self-check ("scan isn't running on an empty dir"), i.e.
a guard against the test silently passing vacuously. Archiving hollowed out
the directory it guards, so the guard now fires on the healthy state.

## Acceptance criteria

- [ ] `npm test` is green on `main`
- [ ] The vacuous-pass protection the assertion exists for is preserved —
      do not simply delete it. Either scope the scan to include
      `_devx/archive/`, or lower the floor to the number that is
      structurally guaranteed, with the reason recorded
- [ ] A comment records why the number is what it is, so the next archive
      pass does not re-break it silently

## Technical notes

- `WS_ROOT` and the `slugs` scan are at the top of the test file.
- Worth checking whether the other assertions in the file (which loop over
  `slugs`) are now covering one workstream where they used to cover nine —
  if so the file's real coverage dropped and the floor is the lesser issue.

## Status log

- 2026-09-20T18:25 — filed from 828385 Phase 8 gap-filing. Confirmed
  pre-existing by running the file on clean `main` (branch main, working
  tree clean) and getting the identical failure.
