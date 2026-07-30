<!-- todo.md — Retro Listener working memory (harness-fold-in FR-1).

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
  - [ ] Phase 1: Listener — nudge pattern, queue store, `learn-helper listen`, wire-protocol pin → rtl101
  - [ ] Phase 2: `learn:` config section → rtl102
  - [ ] Phase 3: Watcher core — readiness, allowlist, outcomes, queue ops → rtl103
  - [ ] Phase 4: Watcher CLI — spawn arms, drain loop, `devx learn-watch` → rtl104
  - [ ] Phase 5: Hook registration template + `/devx-init` distribution → rtl105
  - [ ] Phase 6: `/devx-learn` outlet routing rework → rtl106
- [ ] Stage: Retro
- [ ] Stage: Outcome
