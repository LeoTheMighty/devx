---
hash: eac611
type: test
created: 2026-07-28T10:12:00-06:00
title: "Integration: manage tick writes state in the canonical universe from a subdir launch"
status: done
from: dev/dev-mlc101-2026-07-28T09:02-canonical-repo-root.md
owner: null
branch: null
---
## Goal

mlc101 fixed the manage lock/state split-brain (canonical `cacheDir` + `cwd`
now flow into `runManagerOnce`/`runManagerLoop`, not just
`acquireManagerLock`), but the plumb is only compile-checked — no test
drives a real `runManageCommand({once:true})` from a **subdirectory of a
main checkout** and asserts manager.json / heartbeat.json / the DEV.md read
all land in `<root>/.devx-cache`, not `<cwd>/.devx-cache`.

## Acceptance criteria

- [ ] AC 1: an integration test launches the manage tick (spawn machinery
      stubbed via `disableSpawn` or the existing seams) with cwd =
      `<fixture-root>/subdir` and asserts `manager.json` + `heartbeat.json`
      exist under `<fixture-root>/.devx-cache/` and nothing was created
      under `<fixture-root>/subdir/.devx-cache/`.
- [ ] AC 2: same launch shape asserts reconcile read the fixture root's
      DEV.md (e.g. a ready row is observed in the tick summary/state).

## Technical notes

The tick's heavy half is already seam-rich (`RunManagerOnceOpts`:
`disableSpawn`, `out`, `now`) — the gap is purely that no test enters via
`runManageCommand` (the CLI arm mlc101 changed) rather than
`runManagerOnce` directly. See `test/worktree-refusal.test.ts` for the
fixture shape; the tour's coverage row for Stop 3 documents why this was
deferred (PR #91).

## Status log

- 2026-07-28T10:12 — filed by /devx during mlc101 cleanup (test gap
  observed in review-tour coverage, Stop 3).
- 2026-08-21T12:55 — shipped interactively (harness sweep). `test/manage-tick-canonical-state.test.ts`, 4 tests. Enters through the real `runManageCommand({once:true})` — the CLI arm mlc101 actually changed — from a subdir of a REAL git checkout, because the canonical-root decision runs through `resolveRepoRoot()` and a non-git fixture would take the legacy branch and test nothing. `disableSpawn` is not reachable from `runManageCommand`, so the spawn arm runs for real against a `DEVX_CLAUDE_BIN` stub instead of being switched off. Also pins the mlc101 linked-worktree refusal, which the same code path owns.
- 2026-08-21T12:55 — phase 4: test-only diff over shipped code. Single-pass review; one finding fixed in place — the `process.chdir` restore moved into `afterEach` as well as the local `finally`, so a mid-test throw cannot poison every later test in the worker (`project_worktree_cwd_drift`).
- 2026-08-21T13:55 — merged via PR #140 (https://github.com/LeoTheMighty/devx/pull/140, squash 4be6b35). Flipped by hand: `test` is not a claimable type, so `devx devx-helper finalize` correctly refuses it — the execute arm claims dev/ and debug/ only.

## Links

- Parent: `dev/dev-mlc101-2026-07-28T09:02-canonical-repo-root.md`
- PR that introduced the plumb: https://github.com/LeoTheMighty/devx/pull/91
