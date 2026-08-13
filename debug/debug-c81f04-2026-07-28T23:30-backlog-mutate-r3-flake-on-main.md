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
- 2026-08-05T17:14:13.178Z — loop stopped mid-item (stopped by signal); worktree + claim preserved
- 2026-08-12 — reconciliation audit: owner PID 34486 is DEAD, so this claim is a dead-owner hold, not a live one. **Deliberately left claimed** — unlike the sibling ecdcda claim, this worktree is not empty: `.worktrees/debug-c81f04` holds 132 uncommitted insertions across `src/lib/locks/classify.ts`, `src/lib/manage/lock.ts`, and `test/manage-lock-mgr106.test.ts` implementing a compare-and-delete guard for lock reaping (the `stale` verdict carries the exact bytes it was computed from, so a reap can confirm the file still holds them before unlinking). That is a plausible R3 root cause — a lock re-acquired between classify and unlink is exactly a lost update — and it is uncommitted, so `git` is not protecting it. Owner decision needed: commit it on `feat/debug-c81f04` and resume, or discard. Do not reap this lock mechanically.
- 2026-08-12 — `test/backlog-mutate.test.ts` passed under full parallel suite load at `d5336ff`. Not a clearance: the reported failures were macos-latest CI timing, which a local green does not disprove.

- 2026-08-13 — **reproduced on main again, and the platform claim in this spec's title/Goal is now WRONG.** Run 31711774250, commit `34dfa52`, job `cli (ubuntu-latest / node 20)`: `flips lost under concurrency despite the backlog lock: w1k0a, w1k1a: expected [ 'w1k0a', 'w1k1a' ] to deeply equal []`. `Test Files 1 failed | 111 passed (112)` / `Tests 1 failed | 2522 passed (2523)`, 24.37s.
  Three things this run establishes that earlier evidence did not:
  1. **Not macOS-specific.** Every prior instance was macos-latest; this is ubuntu-latest. Any hypothesis resting on macOS fs/scheduler behaviour is dead. The remaining candidates are a real lost-update window in `withBacklogLock` or a genuinely racy harness — same two the spec opened with, minus the platform escape hatch.
  2. **The commit was markdown-only** (`dev/dev-db36af-*.md`, prose). The diff cannot have caused it; this is the flake in isolation, with no code change anywhere near it.
  3. **The very next commit passed the same suite** (`10907cd`, success). Intermittent, not a deterministic break — consistent with a race rather than a broken assertion.
  Cost, exactly as this spec predicted: main was red for one commit and the reflex is to re-run. It also means `lpf101`'s loop preflight would have refused to start an overnight run against that tip.
  Note the preserved worktree's uncommitted compare-and-delete guard reads as a candidate fix for reading (1) — a lock re-acquired between `classifyExistingLock` and the unlink IS a lost update — which raises the value of deciding what to do with that work rather than leaving it uncommitted.

- 2026-08-13 — **second red on main in a row, with a DIFFERENT signature that names the race directly.** Run 31712187479, commit `1a12194` (again markdown-only), job `cli (ubuntu-latest / node 20)` failed while `cli (macos-latest / node 20)` PASSED the same commit — the platform inversion of every earlier observation:
```
AssertionError: worker failed: devx lock: lock at
  /tmp/devx-r3-locked-Cz8Md8/.devx-cache/locks/backlog.lock
  vanished between EEXIST and read; retrying
```
  This is NOT the `flips lost under concurrency` assertion. So R3 has (at least) two distinct failure modes, and this second one is far more diagnostic: the string is emitted verbatim by `classifyExistingLock` (`src/lib/locks/classify.ts`) on the branch where the lock file disappears between the `O_EXCL` EEXIST and the follow-up read. A worker is dying on that path instead of retrying through it.
  **That is exactly the window the preserved worktree's uncommitted diff targets** — it makes the `stale` verdict carry the bytes it was computed from so a reap can compare-and-delete rather than blind-unlink. Read together: worker A classifies the lock stale, worker B re-acquires it in the gap, A unlinks B's lock, and the next reader finds the file vanished. That is a single coherent mechanism producing BOTH signatures — a genuine lost update, not a racy harness. AC 1's two candidate readings can now be decided in favour of "real lost-update window in the reap path".
  Tally for AC 4 (10 consecutive green): 2 of the last 4 main runs red, both today, both on markdown-only commits. The rate is not improving, and main is red as of this entry — `lpf101` preflight would refuse an overnight run right now.
  **Recommendation to the owner:** commit the worktree's guard on `feat/debug-c81f04` and resume this item rather than discarding. It is no longer a speculative direction; it addresses the mechanism the run log just named.

## Links

- Found during: `dev/dev-mss103-2026-07-28T13:43-loop-split-integration.md`
- Surface owner: workstream `multi-loop-concurrency` (mlc102 backlog lock)
- Failing run: https://github.com/LeoTheMighty/devx/actions/runs/30407045825
