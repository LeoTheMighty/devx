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

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 3
- Design: `_devx/workstreams/retro-listener/design.md` §Architecture (Watch)
