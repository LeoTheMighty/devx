---
hash: wsmig1
type: debug
created: 2026-09-20T18:45:00-06:00
title: "workstream-migration-integrity pins a hardcoded floor of 9 that the archival invalidated"
from: debug/debug-f4149e-2026-09-02T11:55-todo-phase-pointer-arrow-silent.md
status: in-progress
owner: /devx-2026-09-20T1831-10025
branch: feat/debug-wsmig1
---

## Goal

`npm test` is green on `main`.

Today it is not: `test/workstream-migration-integrity.test.ts` >
"found the real workstreams (scan isn't running on an empty dir)" fails at

```
expect(slugs.length).toBeGreaterThanOrEqual(9);   // actual: 1
```

Reproduces on a clean, unmodified `main` checkout — it is not caused by any
branch currently in flight.

## Cause

The workstream archival moved 8 of the 9 workstreams into `_devx/archive/`:

```
_devx/archive/    harness-fold-in, multi-loop-concurrency, mid-story-split,
                  retro-listener, docs-layout-resolution, portability-install,
                  story-graph, blocker-push-interim        (8)
_devx/workstreams/ usage-window-governor                   (1)
```

The assertion's floor of 9 was written when 9 lived in `_devx/workstreams/`.
The archival changed the world under a hardcoded number; nothing updated the
number.

The test's own name says what it is defending — *"scan isn't running on an
empty dir"*. That intent is still valid and still worth a test: a scan
silently returning nothing is exactly the failure it exists to catch. It is
the **encoding** of the intent that broke, not the intent. Same class as any
fixture baseline pinned to a count that drifts.

## Acceptance criteria

- [ ] AC 1: `npm test` green on `main`.
- [ ] AC 2: The "scan isn't running on an empty dir" intent still has a test
      that fails when the scan genuinely returns nothing. Deleting the
      assertion satisfies AC 1 and fails this one.
- [ ] AC 3: Whichever option is taken (below), the new assertion does not
      re-encode a number that the next archival will invalidate — or, if it
      does, it says so at the assertion site so the next person knows to
      move it.

## Options — a judgement call, deliberately not made here

1. **Move the floor to 1.** Cheapest. Keeps a real assertion (a zero-slug
   scan still fails) but the signal is weak, and it will need moving again
   the next time the population changes.
2. **Scan the archive too.** Restores the original count and arguably the
   original intent, if the point was "the artifact set is findable" rather
   than "the live set is non-empty". Changes what the test means.
3. **Make it shape-based.** Assert the scan resolves every slug that exists
   on disk — derive the expected set from the filesystem rather than pinning
   a literal. No number to drift. Most work; only option that cannot rot
   the same way.

Option 3 is the only one immune to recurrence, and the recurrence is what
filed this. But it changes the test from a floor to an equivalence, which is
a real decision about what the invariant protects — hence: not made here.

## Technical notes

- Found while running the full suite for `f4149e` and deliberately kept out
  of that PR: unrelated cause, and the fix is a judgement about the
  invariant rather than a mechanical repair.
- Whoever owns the archival workstream is the right owner — they hold the
  intent that the floor was standing in for.
- Rest of the suite at the time of filing: 139 files / 3292 tests pass. This
  is the only red.

## Status log

- 2026-09-20T18:45 — filed from `f4149e`'s full-suite run. Confirmed
  pre-existing by reproducing on a clean unmodified `main`, so it belongs to
  the archival, not to any in-flight branch.
- 2026-09-20T18:31:30-06:00 — claimed by /devx in session /devx-2026-09-20T1831-10025
- 2026-09-20T19:10 — **option 2, and the spec's own framing was wrong.**
  Filed as "the intent is valid, the encoding broke". The opposite: the
  encoding worked. `expect(slugs.length).toBeGreaterThanOrEqual(9)` is a
  canary and it fired correctly. The loop at :38 generates **three `it()`
  per slug**, so 9 slugs = 27 tests and 1 slug = 3 — and vanished generated
  tests do not fail, they are never registered, so the suite just reports a
  smaller number. 24 of 27 integrity tests had silently stopped existing,
  and the floor is the only reason anyone noticed. Options 1 and 3 both
  "fix" it by teaching the canary to accept the new world, i.e. by deleting
  the mechanism that caught the thing. Credit: palateful-fb, who wrote the
  option list and then read the loop and argued against its own option 3.
- 2026-09-20T19:10 — implemented. `SUBJECT_ROOTS` now spans
  `_devx/workstreams/` (1) **and** `_devx/archive/` (9). Archived
  workstreams carry the full folder-per-artifact structure — that is what
  migration integrity is about, and archiving moved them without making
  them uninteresting. Three guards replace the one floor:
  1. every subject root exists;
  2. the scan covers every directory present under each root, and each root
     is non-empty (shape — catches a filter or path bug);
  3. **the subject population has not shrunk** — a literal floor of 10, and
     deliberately still a literal. This is the AC that matters (fb): a
     shape-only guard stays true while the disk empties, so "scan matches
     disk" cannot protect a count. What changed is *what* it counts — the
     UNION of both roots. Archival moves an entry between roots and leaves
     the union unchanged, so the operation that invalidated the old floor
     cannot invalidate this one. Only a genuine deletion lowers it, and the
     failure message says to lower the floor in the same commit.
  Test count: 4 → 33 (3 guards + 30 looping over 10 subjects).
- 2026-09-20T19:10 — **fb's open caveat resolved: all 30 looping assertions
  pass against the archive.** fb had verified the archive structure by `ls`
  + an `expectations.md` check but had not run the loop over it, and flagged
  that a genuine flat-era leftover would be a real finding rather than a
  reason to narrow the scan. There is none — no archived workstream carries
  a flat-era `prd.md`/`design.md`/`plan.md`, every stage dir with agent-side
  content has its `agent.md`, and every subject has `expectations.md` at
  root. The 8 workstreams that spent the outage unchecked were in fact
  clean; the risk was that nobody could have known.
- 2026-09-20T19:10 — phase 5: `npm test` **exit 0** — 140 files / 3320 +
  39 files / 881 = 4201 passing, 0 failing, typecheck + build clean. Exit
  code captured directly rather than through a pipe: an earlier run of mine
  reported through `grep` would have shown tail's status, not npm's (thanks
  devx-b6, who hit exactly that and reported REAL_EXIT=0 over 11 typecheck
  failures). One transient on the first run —
  `manage-loop > exits 0 with the lock released after SIGTERM` — did not
  reproduce in isolation, on clean `main`, or on the second full run;
  recorded as a flake, not fixed, and not mine to claim either way.
