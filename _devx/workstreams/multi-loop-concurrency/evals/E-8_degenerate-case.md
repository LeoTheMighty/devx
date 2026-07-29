# E-8 — N=1 remains the degenerate case (P1, tests-after)

Deferred artifact (tests-after; final sweep runs in Phase 6). The
degenerate case is a bare `devx loop` with no scope flags: it must behave
exactly as today, minus the fixed races.

## Sweep checklist (Phase 6 exit)

- [x] `npm test` exits 0 with 0 failing tests (full suite incl.
      typecheck per the repo's `npm test` gate).
- [x] 0 existing loop/claim/manage/next tests deleted or semantically
      weakened — verified by diff review of `test/` against the phase
      base; mechanical-only updates (lock-body JSON fixtures, state-file
      relocation to `loop/instances/`) are each called out in the PR
      body.
- [x] Bare `devx loop --dry-run` output on a fixture backlog is unchanged
      vs a pre-workstream baseline capture (same pick order, same plan
      lines).
- [x] A single unscoped loop run end-to-end (fake worker fixture) merges
      the same items in the same order as the pre-workstream driver
      (covered by test/loop-concurrency.test.ts's serial baseline).

Any unchecked box = E-8 fails; fix forward within the phase (no
follow-up items for in-scope regressions).

## Sweep result — 2026-07-28 (mlc106, phase 6 exit)

**PASS, 4/4.** Evidence, box by box:

1. **`npm test` exits 0.** Full suite green on the phase-6 branch:
   **130 files, 2,630 tests, 0 failing, exit 0**. `npm test` is the whole
   local gate — schema smoke + config-io + config-validate + `npm run
   build` + `npm run typecheck` + `vitest run` (the typecheck wiring is
   mgrret's). Re-run AFTER the adversarial-review fixes, not before.
   Separately, all six workstream evals pass under the `workstream-evals`
   project runner (`npx tsx`): E-1, E-2, E-3, E-4, E-5 non-regressed and
   E-6 flipped RED → GREEN.
2. **No existing test weakened.** Diffed against the phase base — the
   branch point `git merge-base main HEAD`, NOT `main`'s tip, which has
   since advanced under a concurrent session and would otherwise show that
   session's new tests as phantom "deletions":

   ```
   $ git diff --stat $(git merge-base main HEAD) -- test/
    test/backlog-parse-epic.test.ts | 295 +++
    test/loop-scope.test.ts         | 818 +++++
    test/next-dispatch.test.ts      |  62 +++
    3 files changed, 1175 insertions(+)
   $ git diff $(git merge-base main HEAD) -- test/ | grep -c '^-[^-]'
   0
   ```

   **0 deletions, 0 modified lines** across all of `test/`. Two files are
   new; the third (`test/next-dispatch.test.ts`) is append-only — six
   added cases pinning `devx next` row 1's scope rendering, a surface that
   had no test at all before (adversarial-review finding). Nothing is
   rewritten, so there are **no mechanical updates to call out in the PR
   body** — the clause is satisfied vacuously.

   That was bought deliberately: `DevRow.epicSlug`/`epicPlanHash` ship as
   OPTIONAL fields precisely so the ~20 hand-built `DevRow` literals in
   `test/manage-*.test.ts` keep compiling untouched. Making them required
   would have forced a 20-site mechanical edit across the very
   manage/reconcile suites this box exists to protect.
3. **Bare `devx loop --dry-run` unchanged.** A 3-item fixture backlog was
   run through the CLI at pre-workstream commit `8b757b8` (the commit
   before mlc101 merged) and at the phase-6 tip; the captures are
   byte-identical — same header, same budget line, same "would claim, in
   order:" list, same pick order `aa1101 → bb2202 → cc3303`. The capture
   was taken BEFORE any phase-6 edit and re-taken after, so it pins the
   whole workstream, not just this phase. The scope line
   (`scope: <descriptor>`) is emitted ONLY when a scope flag is present —
   an unscoped run prints nothing new.
4. **Serial baseline unchanged.** `test/loop-concurrency.test.ts`'s serial
   baseline (one loop, fake worker + fake tail, real
   claim/spec-lock/backlog code) passes unmodified: the unscoped path
   through `pickNextItem` builds the identical row set — `buildScopeMask`
   returns an empty mask and a null order for an empty scope, and
   `applyScopeOrder(rows, null)` is the identity.

Degenerate-case preservation is enforced going forward by
`test/loop-scope.test.ts`, which pins the "omit when unscoped" behavior of
each new surface: the iteration prompt's Specialty directive, the morning
report's `**Scope:**` header, the E-7 pointer, and the held-blockers
section.
