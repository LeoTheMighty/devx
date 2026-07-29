---
hash: mlc103
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Spec-lock lifecycle: classify, reap, guarded release"
status: done
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: [mlc102]
branch: feat/dev-mlc103
owner: /devx-2026-07-28T1128-30636
---
## Goal

Spec locks carry owner-liveness metadata (JSON v1), reuse the mgr106
classifier (extracted to a shared module), reap dead owners at claim time,
and release only under an ownership re-check; pick-time masking keeps
live-held items out of `claimSpec` (races R7/R8/R12 dead, goal G-3). Plan
phase 3 of workstream multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: `classifyExistingLock` extracted to `src/lib/locks/classify.ts`;
      manager lock re-imports it; its existing tests stay green (incl. the
      2s PID-recycling grace).
- [ ] AC 2: `src/lib/devx/spec-lock.ts` — JSON v1 body `{schema, pid,
      pid_started_at, session, claimed_at}`; acquire = O_EXCL, on EEXIST
      classify → dead/recycled ⇒ reap+retry once (under the backlog lock);
      legacy 3-line bodies classify via their `pid=` line.
- [ ] AC 3: release re-reads the body and unlinks only on session match,
      inside the backlog lock; `ownsClaim` call sites migrate.
- [ ] AC 4: `pickNextItem` masks rows whose spec lock classifies live-held;
      live-PID locks older than 2h raise a WARN (`devx next` drift + run
      event) — never auto-reaped. `classifySpecLock` exported for
      `devx doctor` (db36af).
- [ ] AC 5: eval `_devx/workstreams/multi-loop-concurrency/evals/E-3_spec-lock-lifecycle.ts`
      flips GREEN; `test/spec-lock.test.ts` added; `npm test` green.

## Technical notes

Design §Architecture 4 + Resolved design questions (TTL demoted to
WARN+doctor — do NOT auto-reap live PIDs).

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 3).
- 2026-07-28 — phase 2: spec ACs direct (v2 native); 5 ACs;
  workstream=multi-loop-concurrency; red-artifacts=E-3_spec-lock-lifecycle.ts
  (re-ran RED: honest — claim exits 1 "spec lock already held" (no reap),
  spec-lock.ts missing; live-legacy-lock clause already conservative-green).
- 2026-07-28 — phase 3: implemented. classify.ts extraction (manager lock
  re-imports, byte-identical default), spec-lock.ts (JSON v1 + legacy parse,
  classifySpecLock, acquire reap+retry-once, guarded release), claim swaps
  acquire, driver ownsClaim/release migrate + pick-time live-held masking,
  gather stale-live-lock drift (>2h WARN). Design deviation (E-3(b)-pinned):
  legacy bodies classify on PID liveness ALONE — no claimed_at recycling
  cross-check (the eval's live fixture with backdated claimed_at would be
  mis-reaped); JSON v1 uses recorded pid_started_at instead. E-3 GREEN;
  test/spec-lock.test.ts 26 tests; full suite 2419 green.
- 2026-07-28 — phase 4: 3-agent parallel adversarial review (Blind Hunter +
  Edge Case Hunter + Acceptance Auditor); 16 unique findings (1 HIGH, 5 MED,
  10 LOW/INFO); ALL fixed in-place — most load-bearing: BH-F1 reap gated on
  row-readiness (interactive claims' recorded pid dies with the short-lived
  claim CLI, so pid-death ≠ claim-death; ungated reap let a duplicate claim
  destroy a live peer's lock — the E13 collision class). Also: guarded
  release unlinks empty bodies (release runs under backlog lock, mid-write
  impossible); invalid-pid JSON → reapable-unparseable with unknown-schema
  precedence; masked-kind WARNs (pick + devx next); stale-live-lock drift
  exempts own session + gather lockProbes seam; owner extraction keeps the
  historic first-line fallback; classify.ts dead seam stripped (divergences
  documented instead); design.md §Arch-4 legacy sentence corrected.
  Accepted-as-documented: in-progress-row >2h WARN surfaces via devx next
  drift only (AC letter met); legacy pid=0 stays conservative-held.
  Re-review clean; E-3 GREEN; suite 2427 green (34 spec-lock tests).
- 2026-07-28 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/94
  (feat/dev-mlc103 → main); remote CI devx-ci run 30388733971 queued —
  polling via await-remote-ci --once.
- 2026-07-28 — phase 7: CI success — devx-ci (run 30388733971). Tour
  published (devx-tours aedf121) + linked in PR body.
- 2026-07-28 — merged via PR #94 (squash → f5fa72f). merge-gate
  {"merge":true}; check-hold clean; gh exit-code quirk from worktree
  reconfirmed (state MERGED authoritative).
- 2026-07-28T11:28:35-06:00 — claimed by /devx in session /devx-2026-07-28T1128-30636

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
