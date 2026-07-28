# E-8 — N=1 remains the degenerate case (P1, tests-after)

Deferred artifact (tests-after; final sweep runs in Phase 6). The
degenerate case is a bare `devx loop` with no scope flags: it must behave
exactly as today, minus the fixed races.

## Sweep checklist (Phase 6 exit)

- [ ] `npm test` exits 0 with 0 failing tests (full suite incl.
      typecheck per the repo's `npm test` gate).
- [ ] 0 existing loop/claim/manage/next tests deleted or semantically
      weakened — verified by diff review of `test/` against the phase
      base; mechanical-only updates (lock-body JSON fixtures, state-file
      relocation to `loop/instances/`) are each called out in the PR
      body.
- [ ] Bare `devx loop --dry-run` output on a fixture backlog is unchanged
      vs a pre-workstream baseline capture (same pick order, same plan
      lines).
- [ ] A single unscoped loop run end-to-end (fake worker fixture) merges
      the same items in the same order as the pre-workstream driver
      (covered by test/loop-concurrency.test.ts's serial baseline).

Any unchecked box = E-8 fails; fix forward within the phase (no
follow-up items for in-scope regressions).
