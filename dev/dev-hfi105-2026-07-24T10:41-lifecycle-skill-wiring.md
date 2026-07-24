---
hash: hfi105
type: dev
created: 2026-07-24T10:41:50-06:00
title: Lifecycle skill wiring + nudge single-sourcing
from: plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md
plan: _devx/workstreams/harness-fold-in
status: ready
blocked_by: [hfi103, hfi104]
branch: feat/dev-hfi105
---

## Goal

Wire the working memory into the skills that do the work: pointer-style
todo steps in every `/devx-plan` stage and the `/devx` execute arm,
phase-pointer emission at RED, the friction-only learn nudge referenced
(not restated) from its canonical source, and the E-7 static discipline
test. Phase 5 of workstream `harness-fold-in` (plan.md § Phase 5). Last
because it references `devx todo sync` (hfi103) and the nudge canonical
source (hfi104).

## Acceptance criteria

- [ ] `.claude/commands/devx-plan.md`: each of the 4 stage sections gains a
      pointer-style step — run `devx todo sync <hash>`, read the
      current-stage section, expand this session's sub-items as free-nested
      lines, check them as work lands. RED stage additionally writes one
      `  - [ ] Phase <n>: <title> → <dev-hash>` pointer line per emitted
      spec. Wrap-up gains the friction-observed nudge conditional (pointer
      to the canonical sentence).
- [ ] `.claude/commands/devx.md`: execute arm gains the same pointer-style
      todo step (worktree agents write workstream artifacts via absolute
      paths into the main worktree) + the nudge conditional.
- [ ] `skills/devx-plan.md`, `skills/devx.md`: byte-identical mirrors.
- [ ] `test/skill-todo-discipline.test.ts` (E-7 permanent suite): 5/5
      stage+execute sections carry the todo step; nudge sentence defined in
      exactly 1 place (`<!-- nudge-canonical -->` in devx-learn.md) and
      referenced (not restated) elsewhere; prose-budget canary respected.
- [ ] Workstream eval E-7 flips GREEN:
      `npx tsx harness-fold-in/evals/E-7_skill-todo-discipline.ts`
      (cwd `_devx/workstreams`) exits 0.
- [ ] `test/skills-sync.test.ts` passes for both updated mirror pairs; full
      suite green (`npm test`, typecheck included).

## Technical notes

- S-1 prose budget (`engine.prose_budget_kb: 60`) is already contested
  (INTERVIEW Q#9: 64.2KB full-surface) — additions must be pointer-style;
  net-new prose target < 3KB across both bodies (design §Risks, E-7).
- Derived lines belong to `devx todo sync`; skills only check/expand free
  items — stage parents are never hand-checked (FR-2).
- Test + prose ship atomically in the same PR (dvx103 pattern — no
  grandfather window).
- Exact nudge sentence + todo-step prose settle here inside the pinned test
  (design §Unresolved — none blocking).
- RED evidence: `_devx/workstreams/harness-fold-in/evals/RED-report.md`
  (E-7 right-reason).

## Status log

- 2026-07-24 — emitted by /devx-plan RED stage (eac479, phase 5/5).
