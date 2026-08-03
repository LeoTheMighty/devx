---
hash: sgr107
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Downstream portability — packaged CLI proof + MANUAL.md handoff"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 7
status: ready
blocked_by: [sgr103]
branch: feat/dev-sgr107
---

## Goal

Prove the packaged CLI works in downstream-shaped repos (FR-6) and file
the human path for friend-finder-mesh + palateful. Pure verification +
distribution tail — no new product features. Plan phase 7 of workstream
story-graph — read `_devx/workstreams/story-graph/plan.md` §Phase 7; the
RED artifact `evals/E-7_downstream-portability.ts` defines the contract
and must flip green. Parallel-safe with sgr104/sgr105/sgr106.

## Acceptance criteria

- [ ] AC 1: E-7's pack-and-run harness completed inside the eval (T7.1):
      build + pack (`npm run build` / `npm pack`), run the packaged CLI in
      a downstream-shaped fixture (ffm/palateful layout incl. audited
      drift), assert GRAPH.md lands at the fixture root. The "0 reads
      outside the fixture root" threshold keeps its real mechanism: a
      `NODE_OPTIONS --require` fs-audit preload recording every path the
      process opens (works against plain-node dist — no CLI feature
      added), every recorded path inside the fixture root (node internals
      + package code excluded).
- [ ] AC 2: E-7 re-run RED first, then green; any portability gaps the
      eval surfaces are fixed wherever they live (expected: none —
      `resolveRepoRoot` + config-defaulting already carry this) (T7.2).
- [ ] AC 3: MANUAL.md rows filed for the user, dated against G-2's
      2026-08-23 target, each ending in a committed GRAPH.md (T7.3):
      (1) `npm run install:global`; (2) re-run `/devx-init` in ffm +
      palateful to refresh skill bodies (rtl105 mechanism); (3) per repo:
      attended `devx graph backfill` PR, then `devx graph` + commit
      GRAPH.md in that same PR (backfill writes edges, not GRAPH.md — the
      render step is explicit).
- [ ] AC 4: Full suite + typecheck green.

## Technical notes

- No new distribution channel — package `files:` list + `/devx-init`
  refresh is the whole mechanism (design Migration §4). Downstream
  backfill runs themselves are out of scope (NOT-doing fence); only the
  MANUAL.md handoff lands here.
- G-3 measurement (recorded so the outcome has a procedure): at
  workstream close, arm via `devx outcome arm 62bcd1` (default +4w);
  scoring re-runs `devx graph --check` at each merge commit in the window
  (`git log --merges --since` → checkout → `--check`), sourced in
  RESULTS.md per the outcome contract.

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage (workstream 62bcd1).
