---
hash: rtl101
type: dev
created: 2026-07-30T09:31:00-06:00
title: "Listener — nudge pattern, queue store, `learn-helper listen`, wire-protocol pin"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 1
status: done
owner: /devx-loop-2026-07-30T16-02-29-879-60783
blocked_by: []
branch: feat/dev-rtl101
---

## Goal

The detection half of the retro listener, end to end, plus the pin that makes
the wire protocol safe to build on: a nudge printed at wrap-up becomes a
durable queue entry, mechanically and never disruptively. Plan phase 1 of
workstream retro-listener — read
`_devx/workstreams/retro-listener/plan/agent.md` §Phase 1 and `design.md`
§Architecture (Detect/Queue/Pin) before starting; the RED artifacts
(`evals/E-1`, `E-2`, `E-6`, `E-10`, `E-7`) define the API contract and must
flip green.

## Acceptance criteria

- [ ] AC 1: `src/lib/learn/nudge.ts` exports `NUDGE_PATTERN` (single source,
      a mid-sentence substring of the `nudge-canonical` marker prose in
      `.claude/commands/devx-learn.md`, commented back to it — rewording the
      marker MUST update this constant in the same PR),
      `collapseWhitespace`, and `containsNudge` (whitespace-collapsed
      matching: hard-wrapped copies detect, reworded ones don't).
- [ ] AC 2: `src/lib/learn/queue.ts` exports learn-home resolution
      (`DEVX_LEARN_HOME` env > default `~/.claude/devx`; no config load —
      G-3 latency bound), tolerant JSONL readers `readQueue`/`readDone`
      (skip torn lines; entries carry an identity usable by
      `removeFromQueue` so sid-less entries are removable), `appendPending`,
      `appendDone`, `removeFromQueue` (`writeAtomic` rewrite),
      `withQueueLock` (wraps `acquirePathLockBlocking`; `PathLockHeldError`
      on deadline), and marker path helpers. `ts` written as
      `new Date().toISOString()`.
- [ ] AC 3: `src/lib/learn/listener.ts` exports `handleHookPayload`: Stop
      arm (nudge check → locked dedupe+append; lock contention → drop the
      detection, never delay the turn), SessionEnd arm (reason denylist
      `clear|resume|bypass_permissions_disabled|logout` → no marker;
      unknown/absent reason + pending session → `.ended` marker),
      `DEVX_RETRO` short-circuit before any read.
- [ ] AC 4: `devx learn-helper listen` subcommand reads stdin, wraps
      everything in try/catch, exits 0 on every path including garbage.
- [ ] AC 5: `test/learn-listener.test.ts` (E-1, E-2, E-10 cases as named
      tests) and `test/learn-nudge-pin.test.ts` (E-6: pattern ⊂ marker
      whitespace-collapsed + ≥2 in-memory mutation negatives) green.
- [ ] AC 6: `.claude/settings.json` committed with Stop + SessionEnd
      registrations invoking `devx learn-helper listen` (activation now —
      the queue is durable; a watcher drains it whenever it starts).
- [ ] AC 7: RED artifacts flip: `npx tsx` on evals `E-1`, `E-2`, `E-6`,
      `E-10` exit 0; `E-7_hook-latency.ts` run against the rebuilt dist
      reports p95 < 500ms, recorded in this spec's status log (G-3).

## Technical notes

- Reuse: `acquirePathLockBlocking` (`src/lib/manage/lock.ts`), `writeAtomic`
  (`src/lib/supervisor-internal.ts`), JSONL append/read precedent
  (`appendEvent`/`readEvents`, `src/lib/loop/state.ts`), `listen` wired
  inside `src/commands/learn-helper.ts`'s existing `register` (no
  `src/cli.ts` change, no help-snapshot churn).
- Upstream reference: `_devx/workstreams/retro-listener/reference/`
  (`learn-listener.py` is the ported semantics; its docstrings are the trap
  inventory).

## Status log

- 2026-07-30T09:31 — emitted by /devx-plan RED stage (workstream 620c74).
- 2026-07-30T10:02:30-06:00 — claimed by /devx in session /devx-loop-2026-07-30T16-02-29-879-60783
- 2026-07-30T16:09:58.522Z — loop iteration 1: Implemented the nudge pattern pin (nudge.ts) and the shared queue store (queue.ts) with 65 passing tests, flipping RED eval E-6 to green.
  - Change: src/lib/learn/nudge.ts: NUDGE_PATTERN + collapseWhitespace + containsNudge — the pattern is the minimal marker slice forced by the eval mutations (must span 'friction' through 'run `/devx-learn`'), mid-sentence on both ends so markdown restyling can't break detection (AC 1)
  - Change: src/lib/learn/queue.ts: config-free learn-home resolution, tolerant JSONL readQueue/readDone, appendPending/appendDone, removeFromQueue via writeAtomic, withQueueLock over acquirePathLockBlocking, and traversal-refusing marker path helpers (AC 2)
  - Change: Entry identity implemented as non-enumerable lineIndex/rawLine tags so sid-less rows are removable while the tag never leaks into serialized JSON; removeFromQueue re-finds its line when the index goes stale rather than cutting blind
  - Change: test/learn-nudge-pin.test.ts (24 tests): containment against the on-disk marker and the skills/ mirror, four mutation negatives each guarded against vacuous passes, matcher and whitespace-collapse tables (AC 5, E-6 half)
  - Change: test/learn-listener.test.ts started (41 tests): the queue-store half — damaged-log tolerance, ts stamping, identity-based removal incl. stale-index re-find, pendingSessionIds, marker safety, lock release and PathLockHeldError on deadline
  - Learning: The eval mutations mechanically pin NUDGE_PATTERN's extent: E-1 case (d) replaces 'friction' and E-6 mutation (b) replaces the first 'run' occurrence, so any passing pattern must span from 'friction' through 'run `/devx-learn`' — which necessarily includes both em-dashes. There is no shorter or em-dash-free pattern that satisfies both evals.
  - Learning: E-1 accesses queue entries as flat objects (entries[0]['session_id']), so the plan's 'entries carry an identity' requirement cannot be met with a {entry, index} wrapper. Non-enumerable Object.defineProperty tags are the shape that satisfies both the eval and the no-leak-into-JSON requirement (they are also invisible to vitest's toEqual).
  - Learning: The Write tool emitted a literal NUL byte when the intended source text was the escape sequence \u0000, which turned the test file into a binary file that grep silently refused to read. Escape sequences destined for source strings need to be written as escaped backslashes or patched in afterwards.
  - Learning: src/lib/manage/lock.ts already exports BlockingAcquireOpts with timeoutMs/pollMs/nowMs/sleep seams, so withQueueLock needs no timeout machinery of its own — it just forwards opts and lets acquirePathLockBlocking rethrow PathLockHeldError on deadline.
- 2026-07-30T16:33:46.721Z — loop iteration 2: Implemented the listener core (Stop/SessionEnd/DEVX_RETRO guard) and the `devx learn-helper listen` hook subcommand, flipping RED evals E-1, E-2 and E-10 green with the full suite passing.
  - Change: src/lib/learn/listener.ts: total `handleHookPayload` — Stop arm does the whitespace-collapsed nudge check then a locked dedupe+append, treating PathLockHeldError as 'drop the detection, never delay the turn'; SessionEnd arm applies the clear|resume|bypass_permissions_disabled|logout denylist and touches `.ended` only for sessions the queue is waiting on; DEVX_RETRO short-circuits ahead of every read (AC 3)
  - Change: Session ids are refused at the queue's entrance unless they could be a marker filename, and learn-home resolution is deferred into the arms so the Stop miss path — taken at ~every turn end — computes no path and touches no disk (E-1 case f)
  - Change: src/commands/learn-helper.ts: `listen` subcommand + `runLearnListen` with env/stdin/deps/onResult seams — guard answered before stdin, non-JSON payload is a no-op, exit 0 on every path including EAGAIN on a TTY and an unwritable learn home (AC 4)
  - Change: test/learn-listener.test.ts: 41 → 94 tests — E-1 detection/dedupe/hard-wrap/reword/malformed/miss-path-writes-nothing, E-2 inertness across all three payload shapes, E-10's 6 reason cases plus non-pending and drained-entry negatives, lock-contention drop, and the CLI arm (AC 5 complete)
  - Change: Verified: evals E-1/E-2/E-6/E-10 exit 0; full `npx vitest run` green at 2760 passed / 23 skipped; `npm run typecheck` clean
  - Learning: The evals call `handleHookPayload` directly and require no-throw on `null`/garbage, so totality has to live in the core, not only in the CLI's try/catch — the command's catch is the second belt.
  - Learning: A test that asserts inside a callback passed into `runLearnListen` is vacuous: the command's own catch swallows the thrown expect() and the test passes for the wrong reason. Results must be collected and asserted after the call.
  - Learning: The repo has no lint script — `npm test` is `schema-smoke + config evals + build + typecheck + vitest`, and the full vitest run takes ~16 minutes (960s), so any iteration that runs it should budget for that rather than expecting a quick gate.
  - Learning: `readFileSync(0)` is the right stdin read for the hook (no event-loop turn), but it raises EAGAIN when a human runs the subcommand from a terminal — that path has to look exactly like a miss, not like an error.
- 2026-07-30T16:37:40.633Z — loop iteration 3: Registered the retro-listener Stop/SessionEnd hooks in this repo's .claude/settings.json (AC 6) and added the E-7 latency eval pins against the rebuilt dist (AC 7), leaving only the full-suite confirmation outstanding.
  - Change: Added Stop and SessionEnd hook registrations invoking `devx learn-helper listen` to .claude/settings.json, closing AC 6 for this repo's own dogfood wiring.
  - Change: Added the E-7 latency eval covering the listener hook path against a freshly rebuilt dist, plus a companion pin that exercises the real commander route rather than asserting on a string split.
  - Change: Rebuilt dist so the latency measurement reflects the shipped listener code rather than a stale build.
  - Learning: The first cut of the second E-7 pin asserted on a string split of the command line, which would have passed even if commander stopped routing `learn-helper listen`; asserting through the real commander route is the only version that actually pins the contract.
  - Learning: Latency evals are meaningless against a stale dist — the rebuild has to be part of the eval's own setup, not an assumed precondition, or the number measured is from the previous build.
  - Learning: The full suite in this worktree takes roughly 16 minutes, which does not fit inside the tail of an iteration that also does implementation work; the gate run needs to be started earlier or owned by a dedicated iteration.
- 2026-07-30T16:56:00.490Z — loop iteration 4: Ran the full npm test gate to completion (133 files / 2785 tests, exit 0) and re-verified all five RED evals against the freshly rebuilt dist with E-7 at p95 101.9ms, closing the last outstanding AC.
  - Change: Full `npm test` gate (schema-smoke + config evals + build + typecheck + vitest) run to completion: exit 0, 133 test files / 2785 tests passed, 958s wall.
  - Change: All five RED evals re-run against the dist rebuilt by that gate: E-1, E-2, E-6, E-10 exit 0; E-7 reports p95 101.9ms over 20 runs (min 94.0, max 119.2) against the 500ms G-3 bound.
  - Change: AC-by-AC audit confirmed: nudge/queue/listener exports present, `learn-helper listen` routes through commander, the two AC-5 test files green at 120 tests, and .claude/settings.json registers Stop + SessionEnd as a new file with no pre-existing hooks displaced.
  - Learning: Iteration 3's status-log claim that the E-7 eval rebuilds dist as part of its own setup is wrong — E-7 only checks `existsSync(dist/cli.js)` and fails when absent, so a stale-but-present dist would silently measure the previous build. The ordering that actually guarantees a current measurement is running E-7 after `npm test` (which builds), not relying on the eval.
  - Learning: The full gate is ~16 min wall but ~51 min of aggregated test time (Duration 958s, tests 3059.55s) — it is heavily parallel, so it cannot be meaningfully shortened by sharding on this machine, and a verification-only iteration is the right shape for it.
  - Learning: The suite reports 2785 passed / 0 skipped here, versus iteration 2's 2760 passed / 23 skipped; iteration 3 only added ~2 tests, so ~23 tests are environment-conditionally skipped and the headline count is not a stable regression signal across iterations — compare pass/fail, not totals.
- 2026-07-30T16:58:47.217Z — phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103
- 2026-07-30T16:58:47.217Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/104

## Links

- Plan: `_devx/workstreams/retro-listener/plan/agent.md` §Phase 1
- Design: `_devx/workstreams/retro-listener/design/agent.md`
- RED report: `_devx/workstreams/retro-listener/evals/RED-report.md`
