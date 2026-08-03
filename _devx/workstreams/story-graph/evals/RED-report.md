---
gate: PASS
status_reason: 'Every runnable expectation observed RED for the right reason (7 run(s), 0 deferred).'
reviewer: 'devx gate evals'
updated: 2026-08-02
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/story-graph — 2026-08-02

## Runs

### E-1: Mechanical, deterministic render (P0)

- **Artifact**: _devx/workstreams/story-graph/evals/E-1_render-deterministic.ts
- **Command**: `npx tsx story-graph/evals/E-1_render-deterministic.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-1 RED — the story graph does not render mechanically yet:
    - `devx graph` exited 1 — the graph CLI is not implemented yet (Phase 3, T3.2): error: unknown command 'graph'
  ```
- **RED verdict**: right-reason

### E-2: `--check` catches drift (P0)

- **Artifact**: _devx/workstreams/story-graph/evals/E-2_check-drift.ts
- **Command**: `npx tsx story-graph/evals/E-2_check-drift.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-2 RED — GRAPH.md drift is not detectable yet:
    - `devx graph` exited 1 — the graph CLI (and with it --check) is not implemented yet (Phase 3, T3.3): error: unknown command 'graph'
  ```
- **RED verdict**: right-reason

### E-3: Edge hardening — phantoms dropped, markup stripped, cycles fail (P0)

- **Artifact**: _devx/workstreams/story-graph/evals/E-3_edge-hardening.ts
- **Command**: `npx tsx story-graph/evals/E-3_edge-hardening.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-3 RED — edge hardening is not in place yet:
    - `devx graph --format json` exited 1 — the graph CLI is not implemented yet (Phase 3 / Phase 1 tokenization): error: unknown command 'graph'
    - cycle error does not enumerate cyc111
    - cycle error does not enumerate cyc222
    - self-block cycle error does not name slf111
  ```
- **RED verdict**: right-reason

### E-4: Edge-source union + heading tolerance across repo dialects (P0)

- **Artifact**: _devx/workstreams/story-graph/evals/E-4_source-union.ts
- **Command**: `npx tsx story-graph/evals/E-4_source-union.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-4 RED — edge-source union / heading tolerance not in place yet:
    - ffm fixture: `devx graph --format json` exited 1 — graph CLI / heading tolerance not implemented yet (Phases 1+3): error: unknown command 'graph'
    - palateful fixture: `devx graph --format json` exited 1 — graph CLI / source union not implemented yet: error: unknown command 'graph'
  ```
- **RED verdict**: right-reason

### E-5: State-flipping flows leave GRAPH.md fresh (P1)

- **Artifact**: _devx/workstreams/story-graph/evals/E-5_loop-freshness.ts
- **Command**: `npx tsx story-graph/evals/E-5_loop-freshness.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  To /var/folders/y_/sc23spkj46318zzjqj4fw0gc0000gn/T/e5-fresh-origin-9rVdm0
   * [new branch]      main -> main
  To /var/folders/y_/sc23spkj46318zzjqj4fw0gc0000gn/T/e5-fresh-origin-9rVdm0
     3cfd261..6009b6c  main -> main
  E-5 RED — state-flipping flows leave GRAPH.md stale:
    - `devx graph` exited 1 — no graph CLI, so no flow can keep GRAPH.md fresh (Phases 3–5 unimplemented): error: unknown command 'graph'
  ```
- **RED verdict**: right-reason

### E-6: Backfill is mechanical-first, adds-only, idempotent (P0)

- **Artifact**: _devx/workstreams/story-graph/evals/E-6_backfill.ts
- **Command**: `npx tsx story-graph/evals/E-6_backfill.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-6 RED — backfill is not implemented (or not adds-only/idempotent):
    - `devx graph backfill --dry-run` exited 1 — backfill is not implemented yet (Phase 6, T6.5): error: unknown command 'graph'
    - `devx graph backfill` exited 1 on the drifted fixture (expected 0): error: unknown command 'graph'
  ```
- **RED verdict**: right-reason

### E-7: Ships in the package for downstream repos (P1)

- **Artifact**: _devx/workstreams/story-graph/evals/E-7_downstream-portability.ts
- **Command**: `npx tsx story-graph/evals/E-7_downstream-portability.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-7 RED — the packaged CLI does not serve downstream repos yet:
    - built CLI `devx graph` exited 1 in the downstream fixture — the packaged CLI does not carry the graph surface yet (Phase 3 code, Phase 7 verification): error: unknown command 'graph'
  ```
- **RED verdict**: right-reason

## Deferred stubs

- none
