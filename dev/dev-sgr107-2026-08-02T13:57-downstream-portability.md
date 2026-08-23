---
hash: sgr107
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Downstream portability — packaged CLI proof + MANUAL.md handoff"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 7
status: done
owner: /devx-2026-08-05T1125-93663
blocked_by: [sgr103]
branch: feat/dev-sgr107
---

## Goal

Prove the packaged CLI works in downstream-shaped repos (FR-6) and file
the human path for friend-finder-mesh + palateful. Pure verification +
distribution tail — no new product features. Plan phase 7 of workstream
story-graph — read `_devx/workstreams/story-graph/plan/agent.md` §Phase 7; the
RED artifact `evals/E-7_downstream-portability.ts` defines the contract
and must flip green. Parallel-safe with sgr104/sgr105/sgr106.

## Acceptance criteria

- [x] AC 1: E-7's pack-and-run harness completed inside the eval (T7.1):
      build + pack (`npm run build` / `npm pack`), run the packaged CLI in
      a downstream-shaped fixture (ffm/palateful layout incl. audited
      drift), assert GRAPH.md lands at the fixture root. The "0 reads
      outside the fixture root" threshold keeps its real mechanism: a
      `NODE_OPTIONS --require` fs-audit preload recording every path the
      process opens (works against plain-node dist — no CLI feature
      added), every recorded path inside the fixture root (node internals
      + package code excluded).
- [x] AC 2: E-7 re-run RED first, then green; any portability gaps the
      eval surfaces are fixed wherever they live (expected: none —
      `resolveRepoRoot` + config-defaulting already carry this) (T7.2).
- [x] AC 3: MANUAL.md rows filed for the user, dated against G-2's
      2026-08-23 target, each ending in a committed GRAPH.md (T7.3):
      (1) `npm run install:global`; (2) re-run `/devx-init` in ffm +
      palateful to refresh skill bodies (rtl105 mechanism); (3) per repo:
      attended `devx graph backfill` PR, then `devx graph` + commit
      GRAPH.md in that same PR (backfill writes edges, not GRAPH.md — the
      render step is explicit).
- [x] AC 4: Full suite + typecheck green.

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
- 2026-08-05T11:25:29-06:00 — claimed by /devx in session /devx-2026-08-05T1125-93663
- 2026-08-05T11:27 — phase 2: spec ACs direct (v2 native); 4 ACs; workstream=story-graph; red-artifacts=E-7_downstream-portability.ts (re-ran RED: exits 1 — but partly for a fixture defect: dwn111-row/dwn222-frontmatter drift edges form a cycle, CLI correctly refuses; honest feature-RED is the missing npm-pack leg — T7.1 fixes both)
- 2026-08-05T11:47 — phase 3: T7.1 pack-and-run harness in E-7 (build-when-missing → `npm pack` → tar extract → symlinked dep tree for offline resolution → packed CLI run under fs-audit preload); fixed the fixture's accidental blocking-edge cycle (dwn111-row ↔ dwn222-frontmatter) by rerouting the prose-only edge to a new dwn000 done spec — a cycle is refused by design, not tolerated drift; T7.2 E-7 RED (pre-harness) → GREEN, zero portability gaps surfaced (as plan expected — resolveRepoRoot + config-defaulting carry it); T7.3 MANUAL.md rows MV-sgr107.1–.3 filed, dated against G-2 2026-08-23, each per-repo row ending in a committed GRAPH.md.
- 2026-08-05T11:47 — phase 4: single-pass adversarial review (~210-line surface, below 3-agent threshold); 3 findings (0 HIGH, 2 MED, 1 investigated-n/a); ALL fixed in-place — most load-bearing: leak guard was blind to main-checkout reads when repoRoot is a linked worktree (baked-in absolute paths would evade it); now guards both repoRoot and the checkout owning node_modules. Dangling worktree node_modules symlink target fixed via module-walk resolution; async-fs preload blind spot investigated — no fs/promises usage anywhere in src/, n/a. Re-review clean; E-7 re-run GREEN under the strengthened guard.
- 2026-08-05T11:48 — phase 5: workstream-evals gate: E-7 GREEN. cli gate: build + typecheck green; full vitest 130/134 files green — 4 red files (loop-worker, manage-spawn ×2, manage-crash-restart-loop; all real-child-process spawners) re-ran 61/61 green in isolation at the same commit: pre-existing macOS parallel-load flake class, already filed as debug-7c1e93 (+ corroborating status line appended there); diff imports none of them. No QA walkthrough: no user-visible runtime surface — deliverables are a verification harness + MANUAL.md prose (the human path IS MV-sgr107.1–.3).
- 2026-08-05T11:50 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/117 (pr-body clean, no unresolved placeholders).
- 2026-08-05T12:11 — merged via PR #117 (squash → 119f933). Phase 7 CI: success — devx-ci (run 31031613347). Phase 8: check-hold clean ({"hold":false} after transient GitHub GraphQL 401s), merge-gate {"merge":true}.
