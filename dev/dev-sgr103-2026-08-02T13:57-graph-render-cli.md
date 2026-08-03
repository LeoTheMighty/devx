---
hash: sgr103
type: dev
created: 2026-08-02T13:57:00-06:00
title: "Renderer + devx graph CLI (write/stdout/check/json/scoping) + initial GRAPH.md"
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
phase: 3
status: in-progress
owner: /devx-2026-08-03T0855-68612
blocked_by: [sgr102]
branch: feat/dev-sgr103
---

## Goal

The user-visible surface — deterministic Mermaid renderer + thin
`devx graph` CLI — and the phase where all four P0 render/check/hardening
evals go green. Ends with the live-repo run and the initial GRAPH.md
commit. Plan phase 3 of workstream story-graph — read
`_devx/workstreams/story-graph/plan.md` §Phase 3; the RED artifacts
(`evals/E-1` … `E-4`) define the CLI contract and must flip green.

**Attended-only: loop must `--exclude`** — T3.6's GitHub-render
verification (Mermaid renders, glyphs distinct) needs a human looking at
the PR.

## Acceptance criteria

- [ ] AC 1: `src/lib/graph/render.ts` (new) — `renderStoryGraph(model):
      string`; everything sorted (nodes by hash within groups, groups by
      kind then id, edges by from/to/kind); banner + legend + one fenced
      mermaid flowchart + sorted Warnings section; no timestamps; labels
      escaped + truncated (T3.1).
- [ ] AC 2: `src/commands/graph.ts` (new) `CommandModule` with the
      `status.ts` seam shape; default atomic write via `writeAtomic`
      (supervisor-internal.ts:85); `--stdout`; `--format mermaid|json`
      (payload on stdout, warnings on stderr — the `devx merge-gate
      --json` precedent); exit codes 0/1/2; root via `resolveRepoRoot()`
      (repo-root.ts:121), never the cwd config-walk. Registered in
      `src/cli.ts` with a deliberate `attachPhase(...)` help-phase slot;
      `test/help.test.ts` `expectedOrder` + `devx --help` snapshot
      refreshed (T3.2).
- [ ] AC 3: `--check` byte-compare drift gate (`diffMirror` idiom): exit 0
      fresh, non-zero naming GRAPH.md + the regen command on drift (T3.3).
- [ ] AC 4: `--epic`/`--workstream` scope flags (`devx loop` vocabulary):
      scoped output contains only the scope's nodes while the WRITTEN
      GRAPH.md remains the full board (T3.4).
- [ ] AC 5: E-1, E-2, E-3, E-4 evals re-run RED first (fail for the stated
      missing-feature reason), then flip green — all structural
      assertions, byte-identical second run, 3/3 `--check` exit phases,
      0 phantoms, full edge recovery from both dialect fixtures, live-leg
      thresholds (< 2s, 0 phantom nodes, byte-identical double render via
      the built CLI) (T3.5).
- [ ] AC 6: Unit tests green (`test/graph-render.test.ts`,
      `test/graph-cli.test.ts`, new), incl. the named cases: `--format
      json` stdout parses as pure JSON matching the pinned GraphModel
      interface with warnings only on stderr; exit 2 on
      config-load/resolution failure (run outside any repo); scoping;
      `devx graph` invoked from a linked-worktree cwd writes the MAIN
      checkout's GRAPH.md (fixture precedent:
      `_devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts`) (T3.7).
- [ ] AC 7: Live-repo run committed — initial `GRAPH.md` at the repo root;
      rendered GRAPH.md verified on GitHub in the PR itself (attended,
      T3.6). Mermaid glyphs for parallel/lineage settled here against real
      GitHub rendering; E-1's fixture pins the choice.

## Technical notes

- Worktree-safety is load-bearing: a regen inside `.worktrees/dev-<hash>/`
  must write the main checkout's GRAPH.md — tested, not just stated.
- Interregnum note (accepted transient drift): between this phase's merge
  and phase 5's, after-merge bookkeeping is still prose-only, so GRAPH.md
  goes stale on every claim/cleanup. Mitigation: this phase's after-merge
  commits manually run `devx graph` and include GRAPH.md in the pathspec;
  residual drift is accepted (`--check` is not CI-wired).
- If the live board exceeds GitHub's Mermaid ceiling, scope flags are the
  designed fallback (measured here — plan unresolved Q2).
- E-1's live leg spawns the built CLI (`dist/cli.js`) — stale-dist is a
  known false-red source; rebuild before trusting a red.

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage (workstream 62bcd1).
- 2026-08-03T08:55:15-06:00 — claimed by /devx in session /devx-2026-08-03T0855-68612
