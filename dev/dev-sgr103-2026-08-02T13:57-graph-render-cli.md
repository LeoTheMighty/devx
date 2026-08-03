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

- [x] AC 1: `src/lib/graph/render.ts` (new) — `renderStoryGraph(model):
      string`; everything sorted (nodes by hash within groups, groups by
      kind then id, edges by from/to/kind); banner + legend + one fenced
      mermaid flowchart + sorted Warnings section; no timestamps; labels
      escaped + truncated (T3.1).
- [x] AC 2: `src/commands/graph.ts` (new) `CommandModule` with the
      `status.ts` seam shape; default atomic write via `writeAtomic`
      (supervisor-internal.ts:85); `--stdout`; `--format mermaid|json`
      (payload on stdout, warnings on stderr — the `devx merge-gate
      --json` precedent); exit codes 0/1/2; root via `resolveRepoRoot()`
      (repo-root.ts:121), never the cwd config-walk. Registered in
      `src/cli.ts` with a deliberate `attachPhase(...)` help-phase slot;
      `test/help.test.ts` `expectedOrder` + `devx --help` snapshot
      refreshed (T3.2).
- [x] AC 3: `--check` byte-compare drift gate (`diffMirror` idiom): exit 0
      fresh, non-zero naming GRAPH.md + the regen command on drift (T3.3).
- [x] AC 4: `--epic`/`--workstream` scope flags (`devx loop` vocabulary):
      scoped output contains only the scope's nodes while the WRITTEN
      GRAPH.md remains the full board (T3.4).
- [x] AC 5: E-1, E-2, E-3, E-4 evals re-run RED first (fail for the stated
      missing-feature reason), then flip green — all structural
      assertions, byte-identical second run, 3/3 `--check` exit phases,
      0 phantoms, full edge recovery from both dialect fixtures, live-leg
      thresholds (< 2s, 0 phantom nodes, byte-identical double render via
      the built CLI) (T3.5).
- [x] AC 6: Unit tests green (`test/graph-render.test.ts`,
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
      (Write leg done — GRAPH.md committed. The ATTENDED leg stays
      unchecked until a human confirms the render on the PR; tracked as
      3 `human` items in `test/test-97f6d8-2026-08-03T09:50-sgr103-qa-walkthrough.md`.)

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
- 2026-08-03T09:05 — phase 2: spec ACs direct (v2 native); 7 ACs; workstream=story-graph; red-artifacts=E-1,E-2,E-3,E-4 — all four re-run RED first and failed for the STATED reason (`unknown command 'graph'`), not harness breakage.
- 2026-08-03T09:14 — phase 3: renderer + CLI implemented (T3.1–T3.4). E-1..E-4 driven RED→green from the built CLI; live-repo leg 0.26s (< 2s), 0 phantoms, byte-identical double render. Plan unresolved Q2 answered empirically: the live board's mermaid block is 17,219 chars vs GitHub's 50,000 maxTextSize — scoping is NOT needed as a size fallback. Q1 (glyphs) settled: `-->` blocking, `-.->` lineage, `--- |par|` parallel-safe (arrowless AND labeled, so the class survives a restyle on either axis).
- 2026-08-03T09:20 — phase 4: single-pass adversarial review (rigorous, non-parallel — the operator instruction for this session forbids spawning subagents; recorded here rather than silently substituted); 8 findings (2 HIGH, 4 MED, 2 LOW); ALL fixed in-place. Most load-bearing: node labels wrapped badges in `[...]` INSIDE the `id["…"]` construct and `escapeLabel` passed `]` through — Mermaid fails the ENTIRE block on one parse error, and `mss103` carries an `INTERVIEW Q#15` badge on the live board, so the pre-fix renderer would have shipped a blank diagram in THIS PR (live bug, not latent). Also: `classDef` used `#ffffff`, a hash-shaped token that made E-1's own phantom check fire on the palette (whole palette now 3-digit hex); added a renderer-level guard dropping any edge whose endpoint was never declared as a node (Mermaid mints phantoms for unseen ids — the exact class this workstream exists to kill, arriving via the back door); orphan-bucket subgraph id now goes through the same collision uniquifier as real groups; config-path probe moved off the injectable fs seam onto the real fs so it cannot disagree with the loader two lines later; unified duplicated warning emission and removed a discarded double render on the scoped write path. Re-review of every changed hunk clean; +4 regression tests pin the two label-safety bugs and the phantom guard.
- 2026-08-03T09:35 — phase 5: local CI green — `npm test` (schema smoke + config-io + config-validate + build + typecheck + vitest) 139 files / 3040 tests passed, exit 0. All four evals green from the rebuilt dist. QA walkthrough emitted at `test/test-97f6d8-2026-08-03T09:50-sgr103-qa-walkthrough.md` (5 machine checks executed inline with real output pasted; 3 human checks left for the PR — AC 7's attended GitHub-render leg) + TEST.md row.
- 2026-08-03T09:55 — phase 7: PR #112 opened (body rendered by `devx pr-body`, no unresolved placeholders). Then hit a BLOCKING defect of my own making: the QA walkthrough emitted as `test/test-sgr103-qa-walkthrough.md` reused the STORY's hash, and the by-hash resolver requires uniqueness across type dirs — `devx tour gather sgr103` AND `devx merge-gate sgr103` both failed with `resolves to 2 spec files`, i.e. Phase 8's own gate could not resolve this story. Fixed forward (no history rewrite on a pushed branch): renamed to canonical `test/test-97f6d8-2026-08-03T09:50-sgr103-qa-walkthrough.md` + canonical frontmatter, repointed TEST.md and this spec. Both CLIs verified resolving afterwards. Root cause is the Phase-5 emission instruction itself (naming the walkthrough after the story hash), which is uncommitted work-in-flight belonging to another session — filed out-of-scope as `debug/debug-ea4f41` + DEBUG.md row rather than editing their file, with a regression test for cross-dir hash uniqueness as the durable fix.
- 2026-08-03T09:50 — phase 7 (remote CI, fix-forward): CI red — but NOT from this diff. `main` had been red since 14:57 (3 consecutive runs: rtl106 14:57, rtl104 14:59/15:00) on `test/devx-status-log-discipline.test.ts`, and PR CI runs on the merge commit, so this PR inherited it. Root cause: `devx loop` writes `loop iteration N:` + Change/Learning bullets and never emits the mandated `phase 4:` token, so rtl104 + rtl106 violated the gate the moment their merge-tail commits set `status: done`. Compounding it, the assertion triggered ONLY on `status: done` — a flip that /devx pushes directly to main AFTER the PR merges — so the class was structurally uncatchable on a PR and could only ever redden main. Merged origin/main into this branch and, with explicit user approval on both counts: (1) appended honest `phase 4:` lines to both specs — rtl104's reformats the cross-seam adversarial review its own log already records, rtl106's states plainly that NO review pass is recorded and asserts nothing about one having happened (no invented findings, in either); (2) widened the assertion's trigger to `status: done` OR `merged via PR` OR a `phase 5:`/`phase 7:` line — the latter two land on the feature branch, so an attended story that skips its review line now fails its OWN PR. Verified the widening can fail: removing this spec's phase-4 line reddens 2 of the 4 tests while the spec is still `in-progress` (invisible under the old trigger). The loop-side emission half is NOT fixed here — a loop story writes neither phase 5 nor phase 7 — and is filed as `debug/debug-3b9e07` + DEBUG.md row.
