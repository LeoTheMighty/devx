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
- [x] Stage: Plan
  - [x] User phase breakdown locked (6 phases: parser → model → CLI → hooks → backfill → portability)
  - [x] plan.md authored (coverage table E-1..E-7, dependency + attended-step notes; 7 phases post-critique)
  - [x] Critique pass (lenses: pm, architect, dev, qa — 2 HIGH + ~12 MED + ~10 LOW applied; phase 4 split → 7 phases)
  - [x] Coverage gate run: PASS (judge 7/7 ✅, 10 extras flagged)
- [x] Gate: coverage(plan)
- [x] Stage: RED
  - [x] 7 eval artifacts authored at Verified-by paths (+ shared `_fixture.ts`)
  - [x] All 7 confirmed right-reason RED standalone (unknown command 'graph')
  - [x] `devx gate evals 62bcd1` PASS — evals_red flipped, stage → executing
  - [x] sgr101–sgr107 + sgrret emitted; DEV.md epic section; validate-emit ok
- [x] Gate: evals
- [ ] Stage: Execute
  - [x] Phase 1: Parser completion + hardening → sgr101
  - [x] Phase 2: Graph model → sgr102
  - [x] Phase 3: Renderer + `devx graph` CLI → sgr103
  - [x] Phase 4: Regen hooks (claim + emission) → sgr104
  - [ ] Phase 5: `mark-done` helper + Phase-8 rewrite → sgr105
  - [ ] Phase 6: Backfill → sgr106
  - [x] Phase 7: Downstream portability → sgr107
    - [x] T7.1 pack-and-run harness (npm pack leg) + fs-audit preload in E-7; fix fixture cycle bug
    - [x] T7.2 E-7 RED → green; fix surfaced portability gaps (expected none)
    - [x] T7.3 MANUAL.md rows (global update + /devx-init refresh + per-repo backfill + render/commit, dated for G-2)
- [ ] Stage: Retro
- [ ] Stage: Outcome
