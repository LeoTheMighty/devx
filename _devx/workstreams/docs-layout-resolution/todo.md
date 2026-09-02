<!-- todo.md — Docs Layout Resolution working memory (harness-fold-in FR-1).

  Contract (design §"todo.md parse contract"):
  - Auto-maintained: `devx todo sync <hash>` trues the derived lines below.
    Derived = top-level lines matching `- [ ] Stage:|Gate:|Phase <n>: …`;
    their checkboxes mirror spec frontmatter + linked dev-spec state.
    Free-nested items (any deeper checkbox) belong to skills and humans —
    sync never touches them.
  - Never a gate input: no `devx gate` code path reads this file.
  - Pointers, not copies: phase lines point at emitted dev specs
    (`  - [ ] Phase <n>: <title> → <dev-hash>`); content lives in the spec.
  - Done = checked; abandoned = deleted. This file is NOT append-only.
  - Hand-edits are legal — the next writer reconciles.
-->

- [x] Stage: PRD
- [x] Gate: prd
- [x] Stage: Design
- [x] Gate: coverage(design)
- [x] Stage: Plan
  - [x] Owner Q: phase shape → 6 phases, layered
  - [x] Owner Q: 4 PRD baseline corrections → deferred (no `devx revise`)
  - [x] Owner Q: `lay101` sequencing → local predicate, deleted on adoption
  - [x] Profile delta recorded: `docs.human_render`, `plan.wave_execution`, `plan.risks_depth`
  - [x] Ground the blast radius: 33 `*Abs()` + 72 `*_REL` across 17 modules
  - [x] Draft `plan/agent.md` (7 phases, 4 waves, interrogated Risks)
  - [x] Critique step (4 lenses) — 26 findings applied, 1 declined
  - [x] Judge E-id → phase coverage table (8/8 covered after the E-3 re-order)
  - [x] Refresh `plan/human.md`
- [x] Gate: coverage(plan)
- [ ] Stage: RED
- [ ] Gate: evals
- [ ] Stage: Execute
- [ ] Stage: Retro
- [ ] Stage: Outcome
