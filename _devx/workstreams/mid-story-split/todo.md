<!-- todo.md — Mid Story Split working memory (harness-fold-in FR-1).

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
  - [x] Research: sweep skills for handoff-snippet surfaces (Explore agent)
  - [x] Research: loop + dep-tree + spec-creation + abandonment-state mechanics (Explore agent)
  - [x] Interview user through PRD sections in order
  - [x] Promote evals-seed into expectations.md E-blocks
- [x] Gate: prd
- [x] Stage: Design
  - [x] Research: split-kernel reuse surfaces (emit-retro-story, mutate lock, parse.ts, claim/locks, drift) (Explore agent)
  - [x] Research: loop driver terminal paths + iteration-report schema (Explore agent)
  - [x] Research: Handoff Snippet surface inventory, classified LIVE/CROSS-REF/HISTORICAL (Explore agent)
  - [x] Ask user's design questions; settle PRD open questions (terminal vocab, exitInProgress, LEARN exemplar, CLI name)
  - [x] Write design.md (grep-verify every cited path)
  - [x] Coverage-judge subagent → table JSON (1 UC-3 gap fixed + re-judged → 20 ✅)
- [x] Gate: coverage(design)
- [x] Stage: Plan
  - [x] Re-check mlc103 assumption (design revision trigger) — resolved; design.md Assumptions amended to the spec-lock.ts primitives
  - [x] User settled phase cut: 4 phases (primitive / claim inheritance / loop integration / retirement sweep), 1 → {2,3} → 4
  - [x] Write plan.md (coverage table, phase checklist, per-phase files/context/verification/tasks)
  - [x] Critique step skipped (send-it; single backend stack layer < min_surfaces 2)
  - [x] Coverage-judge subagent → table JSON → `devx gate coverage` (5✅/0⚠️/0❌ → PASS)
- [x] Gate: coverage(plan)
- [x] Stage: RED
  - [x] Revise cascade (`--touched plan.md`): RED artifacts retargeted from in-suite test files to evals/ wrappers (CI-green constraint — see plan.md RED-stage note); coverage gate replayed → PASS
  - [x] Author 5 eval wrappers (E-1..E-5) + run each standalone — all RED for named missing-feature reasons
  - [x] `devx gate evals e0a67e` → PASS (5 right-reason runs, 0 deferred) → evals_red, stage: executing
  - [x] Emit mss101–mss104 + mssret (validate-emit ok)
- [x] Gate: evals
- [ ] Stage: Execute
  - [x] Phase 1: Split primitive (lib + CLI) → mss101
    - [x] T1.1 SplitPayload + validateSplitPayload
    - [x] T1.2 composeSplit (both shapes)
    - [x] T1.3 writeSplitAtomically (claim rollback posture)
    - [x] T1.4 performSplit + generateHash export/widen
    - [x] T1.5 insertDevMdRow generalization (type param + after-parent anchor)
    - [x] T1.6 devx split CLI + registration + ls-remote refusal
    - [x] T1.7 E-1 case group green (eval RED re-run observed 2026-07-28T13:54, right-reason; GREEN 14:04; E-5 still RED)
  - [ ] Phase 2: Claim branch inheritance → mss102
  - [ ] Phase 3: Loop split integration → mss103
  - [ ] Phase 4: Handoff Snippet retirement sweep → mss104
- [ ] Stage: Retro
- [ ] Stage: Outcome
