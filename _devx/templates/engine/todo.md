<!-- todo.md — <workstream title> working memory (harness-fold-in FR-1).

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

- [ ] Stage: PRD
- [ ] Gate: prd
- [ ] Stage: Design
- [ ] Gate: coverage(design)
- [ ] Stage: Plan
- [ ] Gate: coverage(plan)
- [ ] Stage: RED
- [ ] Gate: evals
- [ ] Stage: Execute
- [ ] Stage: Retro
- [ ] Stage: Outcome
