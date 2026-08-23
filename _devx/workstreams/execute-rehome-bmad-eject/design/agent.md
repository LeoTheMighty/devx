# Design — Execute re-home + BMAD ejection (V2.2)

## Overview

- **Objective**: remove every live BMAD dependency from devx's execution
  path while re-homing the three disciplines with retro-proven value
  (adversarial self-review, story-execution rules, retrospectives) as
  native skill-body prose + CLI checks.
- **Solution**: a single user-foreground PR that (1) rewrites
  `.claude/commands/devx.md` Phases 2–4 natively, (2) adds the `engine:` +
  `loop:` config sections with a `bmad:` deprecation shim, (3) deletes the
  BMAD skill tree/manifests/legacy commands, (4) retargets the two source
  string templates, and (5) sweeps the docs. Ordered per
  `v2/01-bmad-capture.md` §4 (smallest blast radius first).

## Constraints

- YOLO mode stays live during the migration — the loop must be able to ship
  the very next dev item under the rewritten skill (v2x101's own proof AC).
- `.claude/` edits and deletions prompt for user confirmation (harness
  structural gate) — everything user-foreground lands in ONE batched PR.
- `_bmad-output/` is frozen; links in shipped specs must keep resolving.

## Risks

- Skill-body rewrite regresses the 49-story-proven loop → proven by E-1's
  post-merge run + the dvx103/dvx107 discipline tests updated in-PR (E-4
  guards the suite count).
- Config migration breaks existing user configs carrying `bmad:` → the
  deprecation shim tolerates the key with a warning (E-2 proves the new
  block validates).
- Init regression for fresh repos → E-3 (ini508 harness extension).

## Trade-offs

- Batching all `.claude/` changes into one PR trades review granularity for
  a single foreground-approval session — chosen because the harness prompt
  cost dominates (D-1 execution note).
- Deleting (not archiving) the skill tree trades rollback convenience for
  repo hygiene — git history is the archive.

## Out of scope

Review tour (v2t101), dispatcher rename (v2d101), overnight loop (v2l101),
outcome stage (v2o101), any `_bmad-output/` rewrite.

## Assumptions

- mgrret was the last sprint-status.yaml write (verified in its retro).
- No other repo consumer reads `.claude/skills/bmad-*` (bmad-audit.md §2.8
  orphan classification).

## Discarded considerations

- Keeping BMAD installed-but-unwired ("escape hatch"): rejected — 11MB of
  prose nobody loads is pure confusion surface, and D-1 already decided it.
- A gradual per-skill ejection across multiple PRs: rejected — every PR
  would re-pay the user-foreground prompt cost.

## Wrap, don't duplicate

- Reuses: `devx merge-gate`, `pr-body`, `claim`, `verify-claim`,
  `await-remote-ci`, `plan-helper *` (all untouched); the v2e101 engine
  modules for config reads; ini50x write helpers for the init de-BMAD.
- Adds: `engine:`/`loop:` schema sections, the native Phase 2–4 prose, the
  `/devx retro` stage section, deletion of dead surfaces. No new business
  logic beyond the config shim.

## Design

### Architecture

Skill-body layer: `.claude/commands/devx.md` keeps its phase skeleton
(claim → worktree → implement → review → CI → PR → merge → cleanup);
Phases 2–3 collapse into one "Implement" phase reading spec ACs directly;
Phase 4 gets the native review contract (explicit-zero + 3-agent threshold
per LEARN cross-epic rows); a new `## Stage: Retro` section replaces the
retrospective workflow. CLI layer: `src/lib/config-*` gains the `engine:` +
`loop:` schema keys and the deprecation shim; `src/lib/plan/emit-retro-story.ts`
and `src/lib/devx/should-create-story.ts` templates retarget/retire.
Deletion layer: `.claude/skills/bmad-*`, `_bmad/`,
`.claude/commands/dev.md`, `.claude/commands/dev-plan.md`,
`src/lib/init-*` BMAD paths.

### Interfaces

- `devx config get engine.workstreams_root` → `_devx/workstreams` (E-2).
- Existing CLI surfaces unchanged; `should-create-story` subcommand removed
  from `devx-helper` (breaking, announced in the PR body).

### Data

No stores. Config schema version note appended to `docs/CONFIG.md`.

## Migration plan

Ordered steps 1–9 of `v2/01-bmad-capture.md` §4; the PR ships them as one
reviewable unit with the E-1/E-2 evals flipping RED→green as proof.

## Resolved design questions

- Where do engine defaults live? → `src/lib/engine/config.ts`
  (`ENGINE_DEFAULTS`, shipped in v2e101); the yaml block overrides.
- Does `devx eject` change? → contract re-worded only (D-2); mechanics
  already never touched `_bmad/`.

## Unresolved design questions

- None — remaining judgment calls are pre-decided in v2/07-decisions.md
  (D-1, D-2, D-3, D-7).
