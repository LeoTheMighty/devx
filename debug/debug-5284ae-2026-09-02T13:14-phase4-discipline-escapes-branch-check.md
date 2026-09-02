---
hash: 5284ae
type: debug
created: 2026-09-02T13:14:00-06:00
title: "Phase-4 discipline check escapes the feature branch and reds main at merge"
from: dev/dev-dlr105-2026-09-02T09:14-identity-rekey-privatization.md
status: ready
owner: null
branch: null
---
## Goal

`test/devx-status-log-discipline.test.ts` should fail on the FEATURE BRANCH of
a story that is about to ship without its `phase 4:` line. Today a story can
merge clean and red `main` instead — which is exactly what dlr104 did, and the
next agent to claim anything inherits a red gate it did not cause.

## Expected vs actual

The test's own message states the intended design:

> Ship stage = `status: done`, `merged via PR`, or a `phase 5:`/`phase 7:`
> line — the last two land on the feature branch, which is why this can now
> fail your PR rather than main.

That reasoning holds only for a status log that CONTAINS a `phase 5:` or
`phase 7:` line. `status: done` and `merged via PR` are both written by
`finalize`, i.e. AFTER the merge — so for a story whose log has neither of the
branch-time markers, every ship-stage trigger is post-merge by construction.

dlr104's log goes `phase 2:` → `phase 3:` → `merged via PR #154`. On the
branch it had no ship-stage marker at all, so the discipline test passed; the
moment `finalize` wrote `status: done` onto `main`, `main` went red — and
stayed red for ~1h until dlr105 hit it.

## Acceptance criteria

- [ ] AC 1: A repro exists — a fixture spec whose status log carries a
      `phase 3:` line and no `phase 4:`/`phase 5:`/`phase 7:` line is NOT
      flagged by the current predicate, and IS flagged after the fix.
- [ ] AC 2: The ship-stage predicate gains a branch-time trigger that does not
      depend on the author having written a later phase line. Candidates, to
      be decided in the fix, not here: any `phase <n>:` line with n ≥ 3; or
      the presence of an open PR for the spec's `branch:`; or `merge-gate`
      running the check as a gate rather than relying on the suite.
- [ ] AC 3: Whatever the trigger becomes, a story that legitimately has not
      reached Phase 4 yet (mid-implementation, `phase 2:` only) still passes —
      the check must not fire on work in flight, or it becomes noise the next
      author learns to ignore.
- [ ] AC 4: dlr104's own case is a regression test, using its real (now
      corrected) status log as the fixture.

## Technical notes

Root cause is a **timing** bug in the predicate, not a missing rule: all three
of its ship-stage triggers can be satisfied for the first time after the merge
commit exists. The two the message calls branch-time (`phase 5:`, `phase 7:`)
are branch-time only when the author wrote them — which is the same discipline
the test exists to enforce, so it cannot be assumed.

Worth noting for the fix: the merge gate (`devx merge-gate <hash>`) already
runs per-PR and is the natural home for a check that must block a merge rather
than notice one. The suite is the wrong instrument for a rule about what a
branch may merge.

Found while implementing dlr105, which inherited the red. dlr104's missing
line was reconstructed there from PR #154's body (the review demonstrably ran;
only the line was omitted), so `main` is green again — but the escape route is
untouched and the next story can walk it.

## Status log

- 2026-09-02T13:14 — filed by /devx during dlr105 (out-of-scope finding; the
  inherited red was fixed in dlr105's PR, this spec owns the escape route).
