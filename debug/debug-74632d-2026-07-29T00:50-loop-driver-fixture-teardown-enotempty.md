---
hash: 74632d
type: debug
created: 2026-07-29T00:50:00-06:00
title: "loop-driver fixture teardown races on macOS: ENOTEMPTY rmdir origin.git"
from: dev/dev-mlc106-2026-07-28T09:02-scope-model-flags.md
status: done
owner: null
branch: null
---
## Goal

`npm test` on macOS should tear its tmp git fixtures down cleanly. Today
`test/loop-driver.test.ts` intermittently dies in teardown with
`ENOTEMPTY: directory not empty, rmdir '<tmp>/devx-loop-driver-XXXX/origin.git'`,
reddening CI for a reason unrelated to the code under test.

## Repro

Observed on remote CI, not yet reproduced locally:

- Run `30410808302`, job `cli (macos-latest / node 20)`, 2026-07-29.
- `test/loop-driver.test.ts (58 tests | 1 failed)`, failing test:
  `E-3: budget-rail split (mss103) > real progress at iteration-budget
  exhaustion → outcome split: WIP branch pushed, follow-up spec + DEV.md row
  committed on main, report names the follow-up path`.
- Error surfaces at `test/loop-driver.test.ts:46` (the fixture cleanup), not
  inside an assertion:
  `Serialized Error: { errno: -66, code: 'ENOTEMPTY', syscall: 'rmdir',
  path: '/var/folders/.../T/devx-loop-driver-rbUyYc/origin.git' }`.
- The SAME suite passed on `ubuntu-latest / node 20` in the same run, and the
  same test passes locally on macOS (observed green across four full local
  runs during mlc106).

So: macOS-only, intermittent, teardown-side.

## Acceptance criteria

- [ ] AC 1: A repro exists — either a local reproduction (e.g. a loop running
      the fixture setup/teardown N times), or, if it proves irreproducible
      locally, a documented CI-only reproduction with the run IDs and the
      instrumentation that confirms WHICH handle is still open.
- [ ] AC 2: Root cause documented with evidence (hypothesis → check → result,
      one line each). The two leading hypotheses to discriminate between:
      (a) a git subprocess spawned by the fixture is still alive when
      `rmSync` runs — macOS is stricter than Linux about unlinking a
      directory with an open descriptor, which would explain the
      platform split; (b) the split path (`pushCurrentBranch` →
      `performSplit`) leaves a handle on the bare `origin.git` that the
      test's cleanup does not await.
- [ ] AC 3: Fix + regression test. If the cause is an un-awaited subprocess,
      the fix belongs in the shared fixture helper
      (`test/helpers/loop-git-fixture.ts`) so every consumer inherits it —
      not a `try/catch` around the `rmSync`, which would convert a real
      leaked-handle bug into silent tmp-dir litter.
- [ ] AC 4: `npm test` green on macOS across ≥3 consecutive CI runs after the
      fix (the failure is intermittent, so one green run proves nothing).

## Technical notes

Do NOT "fix" this by swallowing the teardown error. A leaked git subprocess
is worth knowing about: the loop driver spawns real git in the fixtures, and
a handle that outlives the test is the same class of bug that would leave a
worktree half-removed in production.

Related but distinct: `debug-c81f04` is also a macOS-only intermittent CI
red, but in `test/backlog-mutate.test.ts` and about lost updates under the
backlog lock, not fixture teardown. If both turn out to be the same
underlying macOS timing/handle issue, merge them — but treat them as separate
until evidence says so.

## Status log

- 2026-07-29T00:50 — filed from mlc106 Phase 7 (out-of-scope gap: the failing
  test and its fixture both arrived with mss103, and the failure is on the
  teardown path, not in anything mlc106 touched). mlc106's own CI re-run
  (30463113330) was green, so this is intermittent rather than a hard break.
- 2026-08-12 — phase 4: closed by reconciliation audit, not by a fix authored
  here. Root cause WAS addressed, and not by swallowing the teardown error
  (the spec's explicit prohibition): `mlcret` (PR #103) added
  `gc.auto=0` / `receive.autogc=false` / `maintenance.auto=false` to BOTH
  fixture sides in `test/helpers/loop-git-fixture.ts`, eliminating the
  background `git gc --auto` fired on the origin's receive path — that daemon
  was the handle outliving `rmSync`. The `maxRetries: 10, retryDelay: 50` in
  `afterEach` is belt-and-braces layered on top of the root-cause fix, not in
  place of it. Verification: full `npm test` at `d5336ff` on macOS ran
  `loop-driver.test.ts` 62/62 green under full parallel suite load, no
  ENOTEMPTY. Sibling `test/test-b7f2c1` stays OPEN — its AC 1–2 are this same
  fix, but its AC 3–4 (persistent failure-detail reporting) are untouched.

## Links

- Failing run: https://github.com/LeoTheMighty/devx/actions/runs/30410808302
- Fixture: `test/helpers/loop-git-fixture.ts` (added by mss103, PR #99)
- Sibling macOS flake: `debug/debug-c81f04-2026-07-28T23:30-backlog-mutate-r3-flake-on-main.md`
