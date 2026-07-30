---
hash: rtl103
type: dev
created: 2026-07-30T09:31:00-06:00
title: "Watcher core — readiness, allowlist, outcomes, queue ops"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 3
status: in-progress
owner: /devx-loop-2026-07-30T16-02-29-879-60783
blocked_by: [rtl101]
branch: feat/dev-rtl103
---

## Goal

Every watcher decision as pure, injectable functions — no process spawning,
no terminal I/O beyond seams. This is where upstream's five review rounds of
semantics live. Plan phase 3 of workstream retro-listener; the RED artifacts
`evals/E-3` and the phase-3 half of `E-4` define the contract and must flip
green.

## Acceptance criteria

- [ ] AC 1: `src/lib/learn/watch.ts` exports `queuedAt` (strict ISO-8601
      regex, not lenient `Date.parse` — a hand-edited date-only string is
      undatable; requeued entries keep the ORIGINAL `ts` so they're
      instantly ready) and `sessionOver` (`.ended` marker ∨ transcript
      mtime idle ∨ (no transcript to stat) age-out against the entry's own
      `ts` — never instantly ready; undatable entry serves rather than
      wedging), with injectable `now()`/home/idle.
- [ ] AC 2: `repoKey` — memoized `git rev-parse --show-toplevel` behind an
      injectable exec seam (per-test memo reset), cwd fallback for
      non-repos; `repoLookup`/`recordRepoDecision` over `repos.json`;
      empty/absent cwd can never poison the allowlist (`{"": "allow"}`
      unreachable).
- [ ] AC 3: `canPrompt` — stdin `isatty()` AND `ps -o stat= -p <pid>`
      trailing `+` (foreground), behind an injectable seam (Node has no
      `getpgrp`/`tcgetpgrp` binding); consumers re-check it immediately
      before any prompt (SIGTTIN stops rather than raises).
- [ ] AC 4: `pickReady(interactive, skip)` returns the first servable ready
      entry + the unservable list (skip-don't-starve: an unservable head
      entry never blocks a later servable one; noted once per session);
      `classifyEntry` retires entries missing `session_id` or `cwd` as
      `error-malformed` before any prompt or spawn path.
- [ ] AC 5: `mapMarkerToOutcome` (`"0"`→`completed`, ≥128→
      `completed-interrupted`, `error-cd`→`error-cd`, other nonzero→
      `error-fork:<status>`, absent→`timeout`), `finish` (done-log append +
      queue removal + marker cleanup), `requeueFromDone` (strip
      `processed_ts`/`outcome`, keep `ts`, add `requeued_ts`, refuse
      pending), `claimWatcherSingleton` via `acquirePathLock` (second
      claim throws).
- [ ] AC 6: `test/learn-watch.test.ts` green with E-3's readiness matrix
      (fresh/idle/missing-transcript/undatable), all 5 marker mappings,
      both malformed shapes, requeue-keeps-`ts`, allowlist keying via the
      exec seam, skip-don't-starve, and canPrompt-flip deferral as named
      cases; evals `E-3` exits 0 and `E-4`'s phase-3 assertions pass.

## Technical notes

- All time via injected `now()`; all fs under a temp `DEVX_LEARN_HOME`.
- Upstream trap inventory: `reference/2026-07-28-retro-listener.md`
  §"Failure modes & mitigations" + `reference/harness-learn-watch`
  docstrings (fail-open readiness, cwd-less wedge, allowlist poisoning,
  requeue idle-window re-serve).

## Status log

- 2026-07-30T09:31 — emitted by /devx-plan RED stage (workstream 620c74).
- 2026-07-30T11:34:28-06:00 — claimed by /devx in session /devx-loop-2026-07-30T16-02-29-879-60783
- 2026-07-30T17:50:54.687Z — loop iteration 1: Implemented the readiness, repo-allowlist, and prompt-ability halves of the watcher core (AC 1–3) in src/lib/learn/watch.ts with 35 green tests in test/learn-watch.test.ts.
  - Change: Added `src/lib/learn/watch.ts` readiness layer (AC 1): `queuedAt` parses only strict ISO-8601 instants (with explicit calendar range checks so `2026-02-31T…` is rejected rather than rolled forward by Date.parse) and keys off the original `ts`, never `requeued_ts`; `sessionOver` resolves in confidence order — `.ended` marker, then transcript-mtime idle, then age-out against the entry's own `ts` when there is no transcript to stat — with injectable `now()`, home, idle window, and stat seam, and an undatable entry serving rather than wedging the serial queue.
  - Change: Added the repo-allowlist layer (AC 2): `repoKey` memoizes `git rev-parse --show-toplevel` behind an injectable exec seam with `resetRepoKeyCache()` for per-test resets and cwd fallback for non-repos; `readRepos` degrades a garbage or unknown-verdict `repos.json` to 'never reviewed' instead of an implicit allow; `repoLookup` consults repo-root then legacy raw-cwd keys, skipping blank keys on both arms; `recordRepoDecision` throws on a keyless cwd and persists via `writeAtomic` — making `{"": "allow"}` structurally unreachable.
  - Change: Added the prompt-ability layer (AC 3): `canPrompt` combines `isatty(0)` with the trailing `+` of `ps -o stat= -p <pid>` behind injectable seams, failing closed on no tty, missing/unparseable `ps`, or a throwing tty probe — the Node stand-in for the getpgrp/tcgetpgrp comparison Node doesn't bind.
  - Change: Added `test/learn-watch.test.ts` with 35 passing cases covering the E-3 readiness matrix (fresh / idle / missing-transcript / undatable, plus the whole-idle-window and marker-fast-path arms), unsafe-session-id fallthrough, injected vs default idle window, repo-root keying, git-fork memoization, allowlist-poisoning unreachability, legacy cwd-keyed rows, and the four `canPrompt` fail-closed paths including the BSD-nohup background case.
  - Learning: Shape-valid ISO strings are not value-valid: V8's `Date.parse` silently rolls `2026-02-31T00:00:00Z` forward to March 3rd, so a regex-only guard yields a *wrong* age (which can hold an entry back for days) rather than no age (which serves). Explicit month/day/hour range checks after the regex are load-bearing, not belt-and-braces.
  - Learning: `sessionOver`'s marker fast path must tolerate an unsafe `session_id`: `isSafeSessionId` gates path derivation, and the unsafe case has to fall through to the mtime/age arms instead of throwing — an id that can't reach the marker path never had a marker written either.
  - Learning: `repoKey` memoization is a correctness-adjacent perf seam, not a micro-optimization: `pickReady` resolves a key per ready entry per poll, so an unserved 4-entry backlog at a 5s poll would fork `git` ~69k times a day without it — which is why the memo needs a test-visible reset rather than being module-private.

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 3
- Design: `_devx/workstreams/retro-listener/design.md` §Architecture (Watch)
