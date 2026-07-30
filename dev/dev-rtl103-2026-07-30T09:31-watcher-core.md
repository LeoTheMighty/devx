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
- 2026-07-30T18:10:38.360Z — loop iteration 2: Completed the watcher core by adding entry classification, skip-don't-starve pickReady, outcome mapping, finish/requeue queue ops, and the watcher singleton claim (AC 4–6) to src/lib/learn/watch.ts, taking test/learn-watch.test.ts from 35 to 79 green tests with E-3 exiting 0.
  - Change: Added the servability layer (AC 4): `classifyEntry` retires entries with no `session_id`, an unsafe `session_id`, or no `cwd` as `error-malformed` before any prompt or spawn path, and `pickReady(interactive, skip)` returns the first servable ready entry plus the unservable ones it walked past — a non-interactive run passes over unreviewed repos instead of letting one unknown repo starve every other repo's retro. Malformed entries are classified *before* the allowlist arm, diverging from upstream where a cwd-less entry keys as `""`, reads as 'never reviewed', and is reported as an unreviewed repo forever rather than retired.
  - Change: Added `repoDecision`, the single prompting site for an unrecorded repo: a recorded verdict short-circuits, otherwise it re-runs `canPrompt` immediately before reading (a watcher Ctrl-Z'd and `bg`'d after launch takes SIGTTIN and stops, which no catch can cover), and a vanished stdin yields `unknown` so the caller drops to non-interactive for the rest of the run instead of looping on an unanswerable prompt.
  - Change: Added the outcome vocabulary and queue ops (AC 5): `mapMarkerToOutcome` (`""`/`"0"`→`completed`, `"signal"` and ≥128→`completed-interrupted`, `error-cd`→`error-cd`, other nonzero→`error-fork:<status>` with a length cap on the echoed status, absent→`timeout`); `finish` appends to the done log *before* cutting the queue row so a crash between the two duplicates a visible row rather than losing the phase-2 dataset, and cuts by line identity inside the queue lock so an id-less malformed line can be retired at all; `requeueFromDone` strips `processed_ts`/`outcome`, keeps the original `ts`, adds `requeued_ts`, and refuses an entry already pending; `claimWatcherSingleton` acquires the watch path lock so a second claim throws.
  - Change: Added `skipKey` so `--dry-run` can remember what it has already dealt with (session id, or the raw line for a malformed entry that has none) instead of re-picking and re-printing the same line every pass.
  - Change: Extended `test/learn-watch.test.ts` from 35 to 79 cases covering all five marker mappings, both malformed shapes, requeue-keeps-`ts`, skip-don't-starve, canPrompt-flip deferral, finish's crash-ordering and line-identity removal, and singleton double-claim — each named for the trap it pins.
  - Learning: `finish`'s write order is a deliberate asymmetry, not an implementation detail: done-log-append-then-queue-cut duplicates a row on a mid-crash (visible, de-dupable later), while the intuitive cut-first order silently loses the row — and the done log is the dataset phase 2 consumes, so a lost row is worse than a doubled one.
  - Learning: Retiring malformed entries has to happen *before* the allowlist arm, not after. Upstream classifies after, so a cwd-less entry keys as the empty string, looks up as 'never reviewed', and a non-interactive watcher reports it as an unreviewed repo on every single pass forever instead of ever retiring it — the same entry is both malformed and unservable, and which check runs first decides whether the queue drains.
  - Learning: `repoDecision` must re-check `canPrompt` at the moment of the read rather than trusting the value captured at watcher start. A process backgrounded after launch leaves the terminal's foreground group; reading stdin there does not throw, it delivers SIGTTIN and stops the process, so no try/catch can recover it — two extra syscalls versus a permanently wedged watcher.
  - Learning: An empty marker file means `completed`, not `timeout`: the marker existing at all proves the wrapper reached its write, so emptiness is a pre-`rc=$?` wrapper rather than an absent completion. Only a genuinely missing marker is the bounded-await giving up.
  - Learning: The full `npm test` suite was never observed to finish in the prior iteration (it ran >10 min and the session ended first), so the green claim here rests on the targeted file, both evals, and typecheck. That is defensible because `grep -rl learn/watch test src` shows no consumer of the module outside its own test and the eval artifacts — but the loop's CI tail is what actually closes it.

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 3
- Design: `_devx/workstreams/retro-listener/design.md` §Architecture (Watch)
