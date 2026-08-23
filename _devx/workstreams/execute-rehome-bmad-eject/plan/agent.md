<!-- refined: critique 2026-07-05 (lenses: pm/architect/dev/qa — 4 parallel agents; 8 accepted findings incl. HIGH schema-path bug; see decisions/2026-07-05-plan-critique.md) -->
# Plan — Execute re-home + BMAD ejection (V2.2)

## Current state

`/devx` execution (`.claude/commands/devx.md`) routes Phases 2–4 through
`bmad-create-story` (canary-gated, never fires), `bmad-dev-story`, and
`bmad-code-review`; retros invoke `bmad-retrospective`. `.claude/skills/`
carries ~11MB of bmad-* sources; `_bmad/` holds manifests;
`devx.config.yaml` §15 is a `bmad:` block; `emit-retro-story.ts` +
`should-create-story.ts` embed BMAD names; legacy `dev.md`/`dev-plan.md`
commands linger; docs describe the BMAD era in present tense.

## Desired state

One merged PR after which: `/devx` implements from spec ACs natively with
the re-homed review + retro disciplines; `engine:` + `loop:` config blocks
validate (with `bmad:` shim); zero BMAD files or references on the
execution surface (E-1 green); `devx init` scaffolds engine-only (E-3);
suite ≥1571 green (E-4); docs describe v2 in present tense and BMAD in
past tense.

## What we're NOT doing

Tour, dispatcher, loop, outcome stages; `_bmad-output/` edits; PLAN.md
restructuring; any new execution features beyond the re-home.

## Expectation coverage

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 1 | tests-first | _devx/workstreams/execute-rehome-bmad-eject/evals/E-1_bmad-free.ts | full |
| E-2 | P0 | 1 | tests-first | _devx/workstreams/execute-rehome-bmad-eject/evals/E-2_engine-config.ts | full |
| E-3 | P1 | 1 | tests-after | test/init-e2e.test.ts | full |
| E-4 | P1 | 1 | tests-after | test/ | full |

## Phase checklist

- [x] Phase 1: the ejection PR (dev spec: v2x101)

## Phases

### 1. Phase: the ejection PR

**Overview**: the entire migration lands as one user-foreground PR — the
harness confirmation prompt for `.claude/` edits dominates the cost, so
batching is the point (design §Trade-offs). Execution tracker:
`dev/dev-v2x101-2026-07-05T13:03-execute-rehome-bmad-eject.md`
(pre-existing dev spec = this phase; no re-emission).

**Files**:
- `.claude/commands/devx.md` — Phases 2–4 native; Stage: Retro section;
  discipline-test pins updated.
- `.claude/commands/dev.md`, `.claude/commands/dev-plan.md` — delete.
- `.claude/skills/bmad-*`, `_bmad/` — delete.
- `devx.config.yaml` + `_devx/config-schema.json` + `src/lib/config-*` —
  `engine:`/`loop:` blocks, `bmad:` shim, §15 removal.
- `src/lib/plan/emit-retro-story.ts` + `src/commands/plan-helper.ts` +
  `test/plan-helper-emit-retro-story.test.ts` — AC template names
  `/devx retro`; sprint-status row emission removed (D-7) including the
  CLI's `sprint_status=` output line and its test expectations.
- `.claude/commands/devx-interview.md` — BMAD reference swept (E-1 scans
  all of .claude/commands/).
- `src/lib/devx/should-create-story.ts` + `src/commands/devx-helper.ts` +
  its tests — retire subcommand + canary.
- `src/lib/init-*.ts` + `src/lib/init-failure.ts` — de-BMAD scaffold +
  failure modes; ship engine templates.
- `CLAUDE.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`, `docs/SETUP.md`,
  `docs/MODES.md`, `docs/CONFIG.md`, `LEARN.md` header — sweep. Scope
  bound: present-tense prose only; historical mentions in capture docs,
  retros, and shipped specs stay (PRD non-goal).
- `test/` — dvx103/dvx107-class pins updated; ini508 harness extension
  (E-3); BMAD-free grep test promoted from v2s101's template-only seed to
  the execution surface.

**Context**: migration order per v2/01-bmad-capture.md §4; decisions
D-1/D-2/D-3/D-7; the E-1/E-2 evals are already RED (authored at this
workstream's RED gate) and flip green here.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npx tsx` E-1 and E-2 eval scripts exit 0 (were RED pre-PR).
  - `bmad:` shim behavior tested: a config carrying a leftover `bmad:` key
    loads with a deprecation warning, not an error (FR-3).
  - Full suite green, ≥1571 tests (E-4).
  - `grep -ri bmad src/ .claude/` → 0 hits.
  - Proof run: the next DEV.md item reaches a squash-merged PR with remote
    CI green under the rewritten skill, with zero BMAD prose loaded
    (falsifiable via its PR + status log).

**Tasks**:
- [x] T1.1 skill-body re-home — files: `.claude/commands/devx.md`
- [x] T1.2 config migration + shim — files: `devx.config.yaml`, `_devx/config-schema.json`, `src/lib/config-*` (order constraint: lands before or with T1.1 — the skill body references `engine:`/`loop:` keys)
- [x] T1.3 source-template retargeting — files: `src/lib/plan/emit-retro-story.ts`, `src/commands/plan-helper.ts`, `src/lib/devx/should-create-story.ts`
- [x] T1.4 deletions (skills, _bmad/, legacy commands) — files: `.claude/skills/`, `_bmad/`, `.claude/commands/dev*.md`
- [x] T1.5 init de-BMAD + engine scaffold — files: `src/lib/init-*.ts`
- [x] T1.6 docs + command sweep — files: `CLAUDE.md`, `docs/*`, `LEARN.md`, `.claude/commands/devx-interview.md`
- [x] T1.7 test updates + proof run — files: `test/`
