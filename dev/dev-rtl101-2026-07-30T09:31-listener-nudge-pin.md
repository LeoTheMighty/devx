---
hash: rtl101
type: dev
created: 2026-07-30T09:31:00-06:00
title: "Listener — nudge pattern, queue store, `learn-helper listen`, wire-protocol pin"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 1
status: in-progress
owner: /devx-loop-2026-07-30T16-02-29-879-60783
blocked_by: []
branch: feat/dev-rtl101
---

## Goal

The detection half of the retro listener, end to end, plus the pin that makes
the wire protocol safe to build on: a nudge printed at wrap-up becomes a
durable queue entry, mechanically and never disruptively. Plan phase 1 of
workstream retro-listener — read
`_devx/workstreams/retro-listener/plan.md` §Phase 1 and `design.md`
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

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 1
- Design: `_devx/workstreams/retro-listener/design.md`
- RED report: `_devx/workstreams/retro-listener/evals/RED-report.md`
