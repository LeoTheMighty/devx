---
hash: hfi105
type: dev
created: 2026-07-24T10:41:50-06:00
title: Lifecycle skill wiring + nudge single-sourcing
from: plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md
plan: _devx/workstreams/harness-fold-in
status: done
owner: /devx-2026-07-25T1519-13231
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
- 2026-07-25T15:19:51-06:00 — claimed by /devx in session /devx-2026-07-25T1519-13231
- 2026-07-25 — phase 2: spec ACs direct (v2 native); 6 ACs; workstream=harness-fold-in; red-artifacts=E-7_skill-todo-discipline.ts (re-ran RED: 8 failures, all feature-missing — right reasons).
- 2026-07-25 — phase 3: T5.1–T5.5 done — todo steps in 4 devx-plan stages + devx.md Phase 2, RED pointer-line emission, nudge references (marker named, never reproduced), mirrors synced, test/skill-todo-discipline.test.ts (11 tests). E-7 eval GREEN; targeted suites 51/51.
- 2026-07-25 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor); 8 unique findings (3 MED, 5 LOW); ALL fixed in-place — most load-bearing: added the non-restatement pin (canonical-sentence paragraph asserted absent from both lifecycle bodies) + bounded the execute-arm slice at section end; re-review clean (E-7 GREEN, suite 12/12, trigger clause single-sourced 0/0/1).
- 2026-07-25 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/86 (body via devx pr-body, no unresolved placeholders).
- 2026-07-25 — phase 7.5: review tour built + published (5 stops, 5 decisions, 2 grep-verified trails) — https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/hfi105/tour.html; PR body re-rendered with tour link.
- 2026-07-25 — merged via PR #86 (squash → 9070cd3); remote CI devx-ci success (run 30176105776); worktree removed, branch deleted, lock released.
