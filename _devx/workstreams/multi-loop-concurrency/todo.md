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
  - [x] Phase 3: Spec-lock lifecycle (classify, reap, guarded release) → mlc103
    - [x] T3.1 classifier extraction → src/lib/locks/classify.ts (manager lock re-imports; mgr106 tests stay green)
    - [x] T3.2 spec-lock module: JSON v1 body + legacy parse + classifySpecLock + acquire (reap+retry once) + guarded release
    - [x] T3.3 claim/driver/gather integration: claim swaps acquire; ownsClaim/release migrate; pick-time live-held masking; 2h live-PID WARN (next drift + run event)
    - [x] T3.4 E-3 eval GREEN; test/spec-lock.test.ts; full suite
    - [x] full suite green (2427) + 3-agent review (16 findings incl. 1 HIGH row-gated reap, all fixed) + PR #94 merged f5fa72f
  - [x] Phase 4: Claim contention + lock-aware picking + overlap harness → mlc104
  - [x] Phase 5: Instance registry + capacity admission + aggregation → mlc105
    - [x] T5.1 instances module + admission (src/lib/loop/instances.ts)
    - [x] T5.2 driver swap (manager.lock → admission + instance lock) + legacy state.json write retirement
    - [x] T5.3 next/status aggregation (gather.ts loops[], decide.ts row 1 payload, status.ts section)
    - [x] T5.4 scratch namespacing mirror-pair edit (skills/devx.md + .claude/commands/devx.md)
    - [x] T5.5 E-5 GREEN + E-1 fully GREEN (both clauses); E-2/E-3/E-4 non-regressed; first-real-run on this repo (next + status + admission refusal)
    - [x] full suite green (2504) + single-pass 3-lens review (4 findings incl. 1 HIGH scratch-reap path escape, all fixed) + PR #98 merged a19eb6d
  - [ ] Phase 6: Scope model + flags + degenerate-case sweep → mlc106
- [ ] Stage: Retro
- [ ] Stage: Outcome
