<!-- todo.md — Multi Loop Concurrency working memory (harness-fold-in FR-1).

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
  - [x] Phase 1: Canonical repo root + worktree refusal → mlc101
    - [x] T1.1 resolveRepoRoot + unit tests (repo-root.ts, repo-root.test.ts)
    - [x] T1.2 loop/manage refusal + --allow-worktree-root + canonical cacheDir
    - [x] T1.3 claim-path root assertion (exec-seam probe, skip-on-indeterminate)
    - [x] T1.4 E-2 GREEN (+ _fixture.ts tsx-resolution infra fix for worktree runs)
    - [x] full suite green + 3-agent review (10 findings, 9 fixed) + PR #91 merged 68646b3
  - [x] Phase 2: Backlog mutation lock + atomic-writer conversion → mlc102
    - [x] T2.1 withBacklogLock + timeout diagnostics (backlog/mutate.ts, backlog-mutate.test.ts)
    - [x] T2.2 claim transaction + driver mutation blocks wrapped
    - [x] T2.3 manage/gate writers → writeAtomic + lock
    - [x] T2.4 R3 dual-writer repro red→green; full suite
  - [ ] Phase 3: Spec-lock lifecycle (classify, reap, guarded release) → mlc103
  - [ ] Phase 4: Claim contention + lock-aware picking + overlap harness → mlc104
  - [ ] Phase 5: Instance registry + capacity admission + aggregation → mlc105
  - [ ] Phase 6: Scope model + flags + degenerate-case sweep → mlc106
- [ ] Stage: Retro
- [ ] Stage: Outcome
