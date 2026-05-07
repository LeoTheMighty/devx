---
hash: mgr103
type: dev
created: 2026-04-28T19:30:00-07:00
title: Reconcile loop: read backlogs + compute diff + detect unblocks
from: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
owner: /devx-2026-05-07T1006-55630
blocked_by: [mgr102]
branch: feat/dev-mgr103
---

## Goal

Ship `src/lib/manage/reconcile.ts → reconcile(state, backlogSnapshot): {desiredSpawns, desiredKills, statusLogUpdates}` as the pure reconcile function. Hard cap = 1 enforced inside.

## Acceptance criteria

- [ ] `src/lib/manage/reconcile.ts` exports `reconcile(state, backlogSnapshot)`.
- [ ] Inputs: current `manager.json` state + parsed DEV.md (rows + statuses) + parsed INTERVIEW.md (answered Qs) + parsed MANUAL.md (checked items).
- [ ] Outputs:
  - `desiredSpawns`: at most one `(spec_hash, worker_class, model)` triple. Empty if hard cap full or no ready specs.
  - `desiredKills`: PIDs whose target spec reached `done` / `blocked` / `deleted` / superseded.
  - `statusLogUpdates`: appended-line directives `(spec_hash, line)` for state transitions Manager observed (e.g., `manager: detected MANUAL M1.2 checked → spec dev-a10004 unblocked`).
- [ ] Pure function — no I/O; tests cover ≥ 8 fixtures: empty backlog; one ready; one ready + worker running; INTERVIEW unblock; MANUAL unblock; superseded entry; blocked-by chain; cap full.
- [ ] **Hard cap = 1** as constant `HARD_CAP_PHASE_1` with comment block: "Phase 1: hard cap. Phase 3 epic-capacity-management replaces this with `capacity.max_concurrent` from devx.config.yaml. Do not change without bumping the phase reference."
- [ ] Test asserts spawn-2 attempt is rejected with the exact "Phase 1 hard cap: cannot spawn second worker (running: <hash1>)" error message.
- [ ] **Locked from party-mode (Architect lens):** backlog parsing extracted into `src/lib/backlog/parse.ts` (pure parser, returns structured rows). Shared with dvx101's claim path. Phase 2's epic-events-stream extends with event emission; Phase 1 ships parsing only.

## Technical notes

- Reconcile is the load-bearing logic; spawn/kill execution is mgr104+105.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-07T10:06:55-06:00 — claimed by /devx in session /devx-2026-05-07T1006-55630
- 2026-05-07T10:07 — phase 2: canary=off, shouldCreateStory=project_shape=empty-dream + 7 ACs + no story file → bmad-create-story INVOKED (canary=off; helper decision logged not honored)
- 2026-05-07T10:07 — phase 2 override: bmad-create-story SKIPPED in practice — consistent with cross-epic 45/45 silent-skip pattern (LEARN.md cross-epic; spec ACs + party-mode-locked Architect-lens decision are the working artifact). Canary=off means dvx102 helper decision is logged but not honored; v0 behavior preserved by skipping per established empirical convention. Behavior shift to honor helper requires canary flip ("active") which is user-review-required.
- 2026-05-07T10:25 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — surface ~490 LoC across parse.ts + reconcile.ts + multi-regex parser + AC-pinned error marker. ~33 raw findings; ~28 unique post-dedupe across reviewers (5 HIGH, 11 MED, 12 LOW). Acceptance Auditor: 7/7 PASS. 9 fixes landed in-place covering ~14 of the unique findings. Most load-bearing fix: fence-aware parsing via `blankFencedLines()` — INTERVIEW.md's example footer at line 193 (`- [x] Q#7 (from DevAgent on dev-a3f2b9)` inside a markdown code fence) was previously being parsed as a real Q#7 entry, doubling question count + emitting spurious unblock directives on every tick (real-file smoke test went 9 → 8 questions after the fix). Other shipped fixes: CRLF stripping (BH/EC consensus); title regex tolerates en-dash/double-hyphen + cuts off at `Status:`/`Blocked-by:`/`Blocks:` markers when row lacks trailing period; `splitHashes` rejects pure-digit tokens (phantom blocker prevention) and normalizes uppercase dash-prefixed tokens; INTERVIEW/MANUAL body terminator uses header regex (not generic column-0 `^- `) so context bullets don't truncate Blocks:/Answer: detection; `pathOrHash` generic over spec types (was hardcoded `dev-` prefix → wrong stem for `plan-*`/`test-*` rows); `state.model = ""` falls through to DEFAULT_MODEL via `||` (BH/EC consensus on `??` not catching empty string); `state?.roster` optional-chain. Re-review pass: all 9 fixes PASS, 4 new LOW findings (tilde fences ~~~ unsupported, fence detection inside 4-space-indented blocks, regex readability nit, `\k<type>` backref — all out-of-scope for mgr103 per "don't expand scope" + Node 22+ runtime guarantee). 12 review findings deferred with explicit rationale: case-sensitive ROW_RE (real rows uniformly lowercase), MANUAL `**~~order` reverse (real MANUAL.md uses `~~**` order uniformly), `[X]` capital state typo (corner case), `.MD` capital extension (corner case), duplicate-hash hand-edit + concurrent worker (pathological). 56/56 new tests pass; 1184/1184 worktree-wide.
