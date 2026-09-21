---
hash: evlk02
type: debug
created: 2026-09-21T11:30:00-06:00
title: "RED eval lock is detection-only — the write-time guard (L1, evalsGuardDecision) has no caller"
from: debug/debug-75563d-2026-09-02T09:20-red-eval-sha-lock-unwired.md
spawned: []
status: ready
owner: null
branch: null
---

## Goal

debug-75563d designed the RED eval lock in three layers and wired two:

- **L2** — Gate 4 stamps `gate_status.red_eval_shas` (wired by #164).
- **L3** — `devx gate evals --verify` detects a moved/missing eval (wired by #164).
- **L1** — `evalsGuardDecision`, meant to run as a PreToolUse hook and
  **refuse** an edit to a locked eval at write time. **Still has zero callers
  in `src/`.**

75563d's status log says L1 was "deliberately out of scope, filed as a
follow-up". **No follow-up was filed** — the retroactive review of #164 found
no spec, row, or backlog entry for it. This spec is that follow-up.

The consequence is that the lock is detection-on-request only. Nothing refuses
the edit, and nothing runs `--verify` automatically: `/devx` Phase 5's "hard
stop" is enforced only by the agent following the skill prose. AC 3 of 75563d
("Phase 5's hard stop fires on a `moved` body") is therefore met only in prose.

## Acceptance criteria

1. Decide whether L1 should exist as a PreToolUse hook, or whether the hard
   stop should instead be mechanical in the loop (e.g. `devx next` / the loop's
   Phase 5 invoking `--verify` itself). Record the decision.
2. If L1: wire `evalsGuardDecision` so an edit to a stamped eval in a workstream
   with `evals_red: true` is refused, with a test that FAILS on current `main`.
3. Whichever is chosen, a `moved` eval must stop the story **without depending
   on an agent choosing to run a command**.
4. Coordinate with debug-evlk01: if a re-pointed or added eval should block,
   the guard and `--verify` must agree on what "locked" covers.

## Status log

- 2026-09-21T11:30-06:00 — filed from the retroactive review of #164. Makes
  true a follow-up that 75563d's status log claimed was already filed.
