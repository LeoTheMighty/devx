---
hash: v2e102
type: dev
created: 2026-07-05T13:02:00-06:00
title: V2.1-B — stage skill bodies (prd / design / plan / red)
from: v2/06-phases.md
plan: v2/
status: in-review
owner: /devx-2026-07-05T1044-87192
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
- 2026-07-05T10:44:39-06:00 — claimed by /devx in session /devx-2026-07-05T1044-87192
- 2026-07-05T11:05 — implemented: /devx-plan rewritten as the four engine stages (36KB → ~14KB incl. verbatim v1 Hand-off port); prose canary now covers the skill body; discipline tests refit (pln104/pln105/pln106 lineage preserved in v2 shape). Dogfood: v2x101 workstream driven PRD→Design→Plan(+4-lens critique)→RED — all four gates PASS; seeded defect (E-2 missing Threshold) refused correctly; fix-forward: parseExpectations wrapped-field folding (v2e101 parser bug surfaced by the first real gate run, regression-tested).
- 2026-07-05T11:05 — phase 4: self-review — 13 findings (1 seeded-defect probe + 4 from live gate refusals incl. the wrapped-field parser bug + 8 accepted critique-lens findings incl. 1 HIGH wrong-schema-path in the E-2 eval), all fixed; 2 lens findings rejected with rationale in decisions/2026-07-05-plan-critique.md.
