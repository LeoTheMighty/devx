---
hash: v2e102
type: dev
created: 2026-07-05T13:02:00-06:00
title: V2.1-B — stage skill bodies (prd / design / plan / red)
from: v2/06-phases.md
plan: v2/
status: ready
blocked_by: [v2e101]
branch: feat/dev-v2e102
---

## Goal

The judgment layer: `/devx prd|design|plan|red` stage sections in the skill
body, calling the v2e101 primitives, per `v2/02-engine.md` §4. USER-FOREGROUND
(harness gate on `.claude/` edits).

## Acceptance criteria

- [ ] `.claude/commands/devx-plan.md` rewritten as the four stage bodies
      (PRD interview w/ LEARN read-back + incremental writes; design
      questions-first + code-grounding + no-phases rule; plan w/ sizing rule +
      critique step (re-homed party-mode, thoroughness-gated, grep-verified
      lens claims); RED authoring + `devx gate evals` + dev-spec emission via
      pln101–103 primitives). Zero `bmad-*` references.
- [ ] Each stage: reads only its inputs, commits its own artifacts, ends by
      printing `devx next <hash>` output.
- [ ] Dev-spec emission from plan phases preserves the v1 spec/backlog
      contract byte-compatibly (validate-emit passes).
- [ ] Discipline tests (dvx103/dvx107 pattern): stage sections present,
      primitive invocations verbatim, EARS/E-block templates referenced not
      inlined.
- [ ] Dogfood AC: V2.2's own workstream (`v2x101`) is driven PRD→RED with the
      new stages as the first real run; gates refuse correctly on at least
      one seeded defect during the run (recorded in the workstream's
      decisions/).
- [ ] Prose-budget canary updated to include stage sections; under budget.
- [ ] Full suite green.

## Technical notes

- Keep `/devx-plan` as the command name for now (alias into stages); the
  dispatcher rename lands in v2d101.
- Skill edits land as a user-foreground PR per
  `project_skill_perms_block_subagents.md`.

## Status log

- 2026-07-05T13:02 — created from v2/06-phases.md § V2.1 epic B.
