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
- [x] Stage: Execute
  - [x] Phase 1: Split primitive (lib + CLI) → mss101
    - [x] T1.1 SplitPayload + validateSplitPayload
    - [x] T1.2 composeSplit (both shapes)
    - [x] T1.3 writeSplitAtomically (claim rollback posture)
    - [x] T1.4 performSplit + generateHash export/widen
    - [x] T1.5 insertDevMdRow generalization (type param + after-parent anchor)
    - [x] T1.6 devx split CLI + registration + ls-remote refusal
    - [x] T1.7 E-1 case group green (eval RED re-run observed 2026-07-28T13:54, right-reason; GREEN 14:04; E-5 still RED)
  - [x] Phase 2: Claim branch inheritance → mss102
    - [x] T2.1 parseSpecClaimFields surfaces branch: (E-5 RED re-run observed 2026-07-28T14:20, right-reason; GREEN 15:05)
    - [x] T2.2 claimSpec attach arm (no -b) when branch: names an existing branch — keyed on recorded != derived (INTERVIEW Q#14)
    - [x] T2.3 E-5 case group green (dispatch row 8, claim inheritance both shapes, drift = 0); 5 → 12 cases after review
  - [x] Phase 3: Loop split integration → mss103
    - [x] T3.1 split_request validation + explicit copy-through (iteration.ts)
    - [x] T3.2 OUTPUT_FIELD_LINES + clean-seam prompt wording
    - [x] T3.3 split outcome across report/label/counts/nextSteps/itemSection
    - [x] T3.4 splitItem terminal helper + commitOnMain extraPaths + abandon fallback
    - [x] T3.5 budget-rail predicate at exhaustion (both rails; gated on
          hasCommittedProgress — goodWithFiles + clean tree + not
          bookkeeping-only)
    - [x] T3.6 worker-request merge-first path in the merge tail (merged +
          handed-off tails; same progress gate)
    - [x] T3.7 events + rail wiring into afterItemCompleted
    - [x] T3.8 E-3/E-4 evals RED→GREEN + case groups + fallback test (RED
          observed 2026-07-28T14:15 right-reason; both GREEN 17:00;
          loop-driver 57 passed. 4 pre-existing budget-rail tests retargeted
          to the new contract — MED-4 rerouted to the failure-ladder abandon
          path so its guarantee stays pinned)
    - [x] Phase 4 self-review: 3-agent parallel (Blind Hunter + Edge Case
          Hunter + Acceptance Auditor); 20 unique findings, all fixed
          in-place; chain-cap product question → INTERVIEW Q#15
  - [x] Phase 4: Handoff Snippet retirement sweep → mss104
    - [x] E-2 re-run RED first — 39 live token sites enumerated; honest RED
    - [x] T4.1 Phase 9 rewrite → `devx split` + payload shape + shape rules;
          `## Handoff Snippet` section deleted; devx.md:110 clause fixed;
          mirror re-synced byte-identical
    - [x] T4.2 deleted parser + test + fixture; fixed the dangling reference
          in `test/devx-skill-phase1-resume.test.ts:22`; also swept 2 comment
          tokens out of `src/lib/devx/split.ts` (in E-2's scanned set, not in
          any AC)
    - [x] T4.3 `test/devx-skill-phase9-split.test.ts` — `phase9Body()` moved
          verbatim (kept the `^(### |## )` bound); 8 tests
    - [x] T4.4 cross-ref sweep: v2/03, v2/05, HOW_TO_USE, CLAUDE.md,
          LEARN.md E12 + shape-(c) append-only amendments
    - [x] T4.5 E-2 flipped GREEN
    - [x] Phase 4 self-review: single-pass (192 lines, below the 3-agent
          threshold; marker-bearing so reviewed at regex level); 3 findings
          (1 HIGH lock-release mechanism unnamed, 2 MED `$SCRATCH` scope +
          merge-first ordering vs the ownership guard), all fixed in-place
- [x] Stage: Retro
- [x] Stage: Outcome
