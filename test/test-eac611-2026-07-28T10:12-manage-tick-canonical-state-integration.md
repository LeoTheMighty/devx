---
hash: eac611
type: test
created: 2026-07-28T10:12:00-06:00
title: "Integration: manage tick writes state in the canonical universe from a subdir launch"
status: ready
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

## Links

- Parent: `dev/dev-mlc101-2026-07-28T09:02-canonical-repo-root.md`
- PR that introduced the plumb: https://github.com/LeoTheMighty/devx/pull/91
