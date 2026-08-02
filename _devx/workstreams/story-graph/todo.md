<!-- todo.md — Story Graph working memory (harness-fold-in FR-1).

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
  - [x] User decisions locked (publish surface, depends_on frontmatter, node scope, backfill shape)
  - [x] PRD draft written (all sections, G-1..3, FR-1..6)
  - [x] Research folded in (state-encoding audit; friend-finder-mesh + palateful drift audit)
  - [x] expectations.md E-blocks promoted
- [x] Gate: prd
- [x] Stage: Design
  - [x] Code grounding (Explore ×2: parser surface; CLI/flow-helper surface)
  - [x] design.md authored (architecture, interfaces, data, migration, regen hooks incl. new `mark-done` helper)
  - [x] Coverage gate run: CONCERNS — FR-4 (emission commit pathspec) + FR-6 (downstream skill distribution) partials fixed in design.md post-verdict
- [x] Gate: coverage(design)
- [ ] Stage: Plan
- [ ] Gate: coverage(plan)
- [ ] Stage: RED
- [ ] Gate: evals
- [ ] Stage: Execute
- [ ] Stage: Retro
- [ ] Stage: Outcome
