---
hash: c81f04
type: debug
created: 2026-07-28T23:30:00-06:00
title: "backlog-mutate R3 concurrency test is flaky on CI (reds main intermittently)"
status: in-progress
from: dev/dev-mss103-2026-07-28T13:43-loop-split-integration.md
branch: feat/debug-c81f04
owner: /devx-loop-2026-08-04T19-52-58-179-34486
---

## Goal

`test/backlog-mutate.test.ts` → `R3 reproduction — lost DEV.md update (AC 4)`
→ `N processes flipping distinct rows under the lock lose nothing` fails
intermittently on GitHub Actions, reddening **main**. It passes locally and
passes on most runs, so it is a flake, not a straight regression — which is
worse: it makes a red main gate ambiguous and trains everyone to re-run.

Expected behavior: the R3 reproduction is deterministic. Either the backlog
lock genuinely loses flips under CI's timing (a real mlc102 bug worth
knowing about) or the test's concurrency harness is timing-sensitive and
needs to be made robust.

## Acceptance criteria

- [ ] AC 1: root cause identified with evidence — is this a real lost-update
      under `withBacklogLock`, or harness timing (process spawn skew,
      macOS-runner slowness, a too-short wait)? State which, with the run
      log line that proves it.
- [ ] AC 2: if the lock is genuinely losing flips under CI timing, the fix is
      in `src/lib/backlog/mutate.ts` (or its callers) and a regression test
      reproduces the loss deterministically before the fix.
- [ ] AC 3: if it is harness timing, the test is made deterministic without
      weakening what R3 asserts — it must still fail if the lock is removed
      (verify by temporarily bypassing the lock).
- [ ] AC 4: 10 consecutive CI runs green on the touched surface (or a
      documented reason a lower bound is acceptable).

## Technical notes

Observed on main, 2026-07-28 (UTC):

- run 30407045825 (`394e5d22`) — **failure**, macos-latest / node 20
- run 30406815287 (`f2c9849a`) — success
- run 30406756616 (`36a4a143`) — success
- run 30406668976 (`a19eb6d8`) — **failure**

Failure signature (macos-latest / node 20; ubuntu not observed failing):

```
× R3 reproduction — lost DEV.md update (AC 4) > N processes flipping
  distinct rows under the lock lose nothing
AssertionError: flips lost under concurrency despite the backlog lock:
  w3k4a: expected [ 'w3k4a' ] to deeply equal []
 Test Files  1 failed | 127 passed (128)
       Tests  1 failed | 2517 passed (2518)
```

Only one worker's flip (`w3k4a`) is lost, and only sometimes — consistent
with either a genuine race window or a harness that under-waits for spawned
processes. Note `BACKLOG_LOCK_TIMEOUT_MS = 30_000` / `POLL_MS = 20` are
constants, not knobs (mlc102 design), so a slow macOS runner cannot be
tuned around from config.

Adjacent but distinct: `debug-a7c3f9` covers BacklogLockTimeoutError
accounting during claims, not lost updates.

## Status log

- 2026-07-28T23:30 — filed by /devx during mss103 Phase 7 (remote-CI
  investigation). Found while diagnosing why PR #99 had no CI run: the PR
  was `CONFLICTING`, and reviewing main's recent runs to establish a
  baseline surfaced 2 failures in the last 4 main runs, both this test.
  Not filed anywhere else at time of writing (grepped DEBUG.md + debug/).
- 2026-08-04T15:19:50-06:00 — claimed by /devx in session /devx-loop-2026-08-04T19-52-58-179-34486

## Links

- Found during: `dev/dev-mss103-2026-07-28T13:43-loop-split-integration.md`
- Surface owner: workstream `multi-loop-concurrency` (mlc102 backlog lock)
- Failing run: https://github.com/LeoTheMighty/devx/actions/runs/30407045825
