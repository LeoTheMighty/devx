<!-- todo.md — Harness Fold In working memory (harness-fold-in FR-1).

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
- [x] Gate: coverage(plan)
- [x] Stage: RED
- [x] Gate: evals
- [ ] Stage: Execute
  - [x] Phase 1: todo core — template, parser, scaffold, gate isolation → hfi101
  - [x] Phase 2: gate-verdict persistence + revise clearing + gate summary → hfi102
  - [ ] Phase 3: todo sync + focus/drift renderers + real devx status → hfi103
  - [x] Phase 4: /devx-learn skill + slug helper → hfi104
  - [ ] Phase 5: lifecycle skill wiring + nudge single-sourcing → hfi105
- [ ] Stage: Retro
- [ ] Stage: Outcome
