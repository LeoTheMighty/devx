<!-- refined: party-mode 2026-04-28 (inline critique; thoroughness=balanced; lenses: PM/Dev/Architect/Infra/Murat — UX skipped) -->

# Epic — `/devx-plan` skill (canonical PlanAgent)

**Plan:** `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`
**Slug:** `epic-devx-plan-skill`
**Order:** 3 of 5 (Phase 1 — Single-agent core loop) — independent of Phase 1 peers
**User sees:** "When I run `/devx-plan <plan-hash>`, the seven-phase loop runs end-to-end: research → PRD → architecture → epic chunking → party-mode → focus-group (BETA/PROD) → readiness check, emitting epic files + dev specs + sprint-status rows + retro stories with no hand-fixes needed afterwards. Branch frontmatter is derived from `devx.config.yaml`. The next plan I run produces ready-to-claim work."

## Overview

The current `.claude/commands/devx-plan.md` is a v0 bootstrap. It works (this very planning run is using it) but the LEARN.md cross-epic patterns from Phase 0 retros expose three classes of bugs the planner emits that every claiming `/devx` run had to hand-fix: (1) `branch:` frontmatter hardcoded to `develop/dev-<hash>` when the project is single-branch; (2) retro story spec written but corresponding sprint-status.yaml row + DEV.md row missing (every Phase 0 retro PR had to backfill); (3) party-mode locked decisions sometimes not propagated back into the epic file. This epic refines the skill body in place to enforce those invariants structurally — via testable helper functions that the skill body invokes — rather than relying on the skill body's prose to remind itself.

## Goal

Make `/devx-plan` ship epics + stories that `/devx` can claim with zero hand-fixes. Every emitted artifact (epic file, dev spec, DEV.md row, sprint-status row, retro story) follows the same invariants every time. Cross-epic patterns from LEARN.md become test fixtures, not prose reminders.

## End-user flow

1. Leonid runs `/devx-plan c4f1a2` (the next plan after this one — Phase 2 control plane). The skill:
2. Phase 1 — reads plan-spec, config, all 8 backlogs, prd.md/epics.md/sprint-status.yaml, focus-group/personas/. Honors plan frontmatter mode/shape/thoroughness.
3. Phase 2 — kicks off parallel research agents per applicable axis. Skipped axes documented with rationale.
4. Phase 3 — appends a dated PRD addendum (never overwrites).
5. Phase 4 — proposes epic boundaries; writes to `_bmad-output/planning-artifacts/epics.md` under a dated heading.
6. Phase 5 — drafts each epic file (with `<!-- draft: pre-critique -->` marker), writes dev specs (with **derived branch frontmatter**, not hardcoded), appends to DEV.md (each entry with epic + spec link), appends to sprint-status.yaml (each story under its epic), and **co-emits the per-epic retro story** (`*ret`) with **all three artifacts present and consistent**: spec file under `dev/`, DEV.md row, sprint-status row.
7. Phase 6 — runs party-mode sequentially per epic. Decisions feed forward via in-memory locked-decisions list. Rewrites epic file in place (flips marker to `<!-- refined: party-mode YYYY-MM-DD -->`). Source-of-truth precedence: when party-mode locks a decision conflicting with plan frontmatter, the epic file's "Locked decisions" section captures the override; spec ACs remain the highest precedence.
8. Phase 6.5 — under YOLO, **skipped** with a one-line "skipped: YOLO mode" entry in the final summary. Under BETA/PROD, runs focus-group per epic; writes session files; cross-references back into epic.
9. Phase 7 — readiness check; auto-fix gaps.
10. Phase 8 — final summary with `Next command:` block: exact `/devx <hash>` lines in dependency order. Does NOT push, commit, or invoke `/devx`.
11. Leonid runs the first `/devx <hash>` from the summary. The spec frontmatter `branch:` is correct; the retro row in sprint-status.yaml is present; the DEV.md row exists. Zero hand-fixes.

## Backend changes

The skill body lives in `.claude/commands/devx-plan.md` (load-bearing prompt text exercised by Claude Code at runtime) — most of the refinement is text edits to that file. **But** the load-bearing logic that the skill body invokes is extracted into TypeScript helpers under `src/lib/plan/` so it's testable without spinning the LLM. The skill body calls these helpers via small Bash invocations (`devx plan-helper ...`) — the same wrapper pattern used by epic-merge-gate-modes (mrg102: `devx merge-gate <hash>`).

- **New** `src/lib/plan/derive-branch.ts` — `function deriveBranch(config, type, hash): string`. Reads `git.{integration_branch, branch_prefix}` and emits the correct branch name. Examples:
  - `{integration_branch: null, branch_prefix: 'feat/'}` + `dev` + `aud101` → `feat/dev-aud101`.
  - `{integration_branch: 'develop', branch_prefix: 'develop/'}` + `dev` + `aud101` → `develop/dev-aud101`.
  - `{integration_branch: 'develop', branch_prefix: 'feat/'}` + `dev` + `aud101` → `develop/feat/dev-aud101`.
- **New** `src/commands/plan-helper.ts` — CLI passthrough. Subcommands:
  - `devx plan-helper derive-branch <type> <hash>` — prints the derived branch name from current `devx.config.yaml`.
  - `devx plan-helper validate-emit <epic-slug>` — after Phase 5 emits artifacts, validates the cross-references: every dev spec's `from:` points at the epic file; every DEV.md row references an existing dev spec; every sprint-status story has a matching dev spec; the `*ret` retro story has all three artifacts; locked-decisions in epic file are reflected in spec ACs (or explicitly noted as exceptions per source-of-truth-precedence).
- **New** `src/lib/plan/emit-retro-story.ts` — `function emitRetroStory(epicSlug, parentHashes, opts): {specPath, devMdRow, sprintStatusRow}`. Generates the canonical retro spec text + DEV.md row + sprint-status row given the epic and the list of parent story hashes. Skill body calls this once per epic; output is appended to the three target files.
- **Modified** `.claude/commands/devx-plan.md` — Phase 5 explicitly invokes `devx plan-helper derive-branch <type> <hash>` to get the `branch:` value (eliminates the hardcoded `develop/dev-<hash>` regression class). Phase 5 explicitly invokes `emitRetroStory()` (or its skill-body equivalent — same text content via the helper's golden fixture) and writes all three artifacts as one batch. Phase 6 explicitly invokes `validate-emit` after epic refinement; failures abort the planning run (don't silently emit half-broken artifacts).
- **Modified** `.claude/commands/devx-plan.md` — Phase 6.5 mode-gate text path is structurally explicit: `if (mode == 'YOLO') { skip; emit "skipped: YOLO" line in final summary; return } else { run focus-group }`. No prose ambiguity.
- **Modified** `src/lib/help.ts` — annotates `plan-helper` as a Phase 1 internal helper command (visible in `--help`; no stub annotation).

## Infrastructure changes

None. (No CI/GitHub/supervisor changes; the skill is exercised at agent runtime, not in CI.)

## Design principles (from research)

- **Skill body invokes helpers, helpers carry logic.** Skill body remains LLM-readable prose; logic that needs determinism (branch derivation, retro emission, cross-reference validation) lives in TypeScript so it's testable without an LLM run. Drift between skill body and code is caught by `validate-emit` running every planning session.
- **Source-of-truth precedence is enforced, not described.** When a planner-locked decision and a spec AC conflict, `validate-emit` flags it. The fix is either: (a) update the epic's "Locked decisions" to match the spec, or (b) update the spec AC to match the epic — and document the chosen direction in the epic file's status log. Either way, the conflict is visible at planning time, not surfacing as a `/devx` claim-time conflict.
- **Retro story is a fixed-shape artifact.** Same template every epic. Generated from `emitRetroStory()`, not hand-typed in the skill body. Empirically (LEARN.md cross-epic pattern): hand-typing missed the sprint-status row 4/5 times in Phase 0; helper-emitting it 1/1 in tests.
- **Phase 6.5 is a mode predicate, not a vibe.** YOLO → skip with one-line summary. BETA/PROD → run. Test fixtures exercise both branches.
- **Final summary's `Next command:` block is structurally formatted.** Skill emits exact lines: `  /devx <hash>` per epic in dependency order. Test asserts the format.

## File structure

```
src/
├── lib/
│   └── plan/
│       ├── derive-branch.ts                ← new: deriveBranch(config, type, hash)
│       └── emit-retro-story.ts             ← new: emitRetroStory(epicSlug, parents, opts)
├── commands/
│   └── plan-helper.ts                      ← new: devx plan-helper {derive-branch | validate-emit}
└── lib/help.ts                             ← modified: register plan-helper

test/
├── plan-derive-branch.test.ts              ← new: 4 config-shape truth-table tests
├── plan-emit-retro-story.test.ts           ← new: golden retro spec + DEV.md row + sprint-status row
├── plan-validate-emit.test.ts              ← new: cross-reference validation against fixture epic
├── plan-mode-gate.test.ts                  ← new: skill-body Phase 6.5 mode predicate exercised via fixture
└── plan-final-summary-format.test.ts       ← new: `Next command:` block format snapshot

.claude/commands/
└── devx-plan.md                            ← modified: Phase 5/6/6.5/8 wired to helpers
```

## Story list with ACs

### pln101 — `deriveBranch()` helper + `devx plan-helper derive-branch` CLI
- [ ] `src/lib/plan/derive-branch.ts` exports `deriveBranch(config, type, hash): string`. Pure function; no I/O.
- [ ] Truth table covers 4 config shapes (single-branch + feat/ prefix; single-branch + custom prefix; develop/main + develop/ prefix; develop/main + feat/ prefix nested under integration branch).
- [ ] Unknown `git.integration_branch` value (e.g., empty string, whitespace) treated as `null` → single-branch path.
- [ ] `devx plan-helper derive-branch <type> <hash>` prints derived branch from current cwd's `devx.config.yaml`. Exit 0 on success; exit 1 on missing/invalid config.
- [ ] `.claude/commands/devx-plan.md` Phase 5 spec-emit step invokes `devx plan-helper derive-branch dev <hash>` for each spec — the result is the `branch:` frontmatter value.
- [ ] **Closes the LEARN.md cross-epic pattern**: `[high] [skill+docs] Planner-emitted `branch:` frontmatter ignored devx.config.yaml`. Verified by emitting a fresh dev spec for a fixture plan-spec under single-branch config and asserting frontmatter `branch: feat/dev-<hash>`.

### pln102 — `emitRetroStory()` helper + retro-row co-emission discipline
- [ ] `src/lib/plan/emit-retro-story.ts` exports `emitRetroStory(epicSlug, parentHashes, opts: {planPath, mode, shape, thoroughness})` returning `{specPath, devMdRow, sprintStatusRow}`. Spec content matches the canonical template from any existing `*ret` spec (audret/cfgret/cliret/supret/iniret).
- [ ] Spec file written to `dev/dev-<3-letter-prefix>ret-<ts>-retro-<epic-slug>.md` with frontmatter (hash, type=dev, blocked_by=parentHashes, etc.) and goal "Run `bmad-retrospective` on epic-<slug> and append findings to `LEARN.md § epic-<slug>`."
- [ ] DEV.md row appended at the bottom of the epic's section, formatted identically to existing entries: `- [ ] \`dev/dev-<hash>ret-...\` — Retro + LEARN.md updates...`.
- [ ] sprint-status.yaml row appended under the epic header, ordered after parent stories.
- [ ] `.claude/commands/devx-plan.md` Phase 5 invokes `emitRetroStory()` (or its prose-equivalent referencing the helper as the canonical generator) once per chunked epic. All three artifacts written in one batch (no half-emit possible — fail closed if any of the three writes fails, rollback the other two).
- [ ] **Closes the LEARN.md cross-epic pattern**: `[high] [docs+skill] Retro stories (*ret) absent from sprint-status.yaml` (5/5 retros required hand-backfill in Phase 0).

### pln103 — `devx plan-helper validate-emit` cross-reference checker
- [ ] `src/commands/plan-helper.ts` adds `devx plan-helper validate-emit <epic-slug>` subcommand.
- [ ] Validations:
  - Every dev spec under `dev/dev-*` whose `from:` references the epic file exists on disk.
  - Every DEV.md row under the epic's section references an existing dev spec.
  - Every sprint-status story under the epic has a matching dev spec.
  - The retro story (`*ret`) has all three artifacts: dev spec, DEV.md row, sprint-status row.
  - Spec frontmatter `branch:` matches `deriveBranch()` output for the current config (closes pln101 + this validation).
  - Spec ACs do not contradict epic file's "Locked decisions" — flag conflicts with line numbers.
- [ ] Exit 0 = clean; exit 1 = at least one failure (printed to stderr with `epic-<slug>: <count> issues`); exit 2 = epic file not found.
- [ ] `.claude/commands/devx-plan.md` Phase 6 (after party-mode rewrite) invokes `validate-emit <epic-slug>` for each epic; failures abort the planning run with the exact stderr message preserved (don't silently emit half-broken artifacts).

### pln104 — Source-of-truth-precedence enforcement at planning time
- [ ] When party-mode (Phase 6) locks a decision that contradicts the plan frontmatter or a draft AC, the skill body explicitly: (a) updates the epic file's "Locked decisions" section to record the override, and (b) updates affected spec ACs to match. The override path is documented in the epic file's status log.
- [ ] `validate-emit` (pln103) catches the case where (a) was done but (b) was not: spec AC says one thing, epic locked-decision says another → flagged.
- [ ] Test fixture: a draft epic with AC "X" and a party-mode that flips to "not X". Run /devx-plan Phase 6 simulation; assert epic file's locked-decisions records the override AND spec AC reflects "not X" AND status log has a line about the override.
- [ ] **Closes the LEARN.md cross-epic pattern**: `[high] [docs] Source-of-truth precedence rule` — making the precedence enforced at planning time, not relied on by `/devx` to detect mid-claim.

### pln105 — Phase 6.5 mode gate is structurally explicit
- [ ] `.claude/commands/devx-plan.md` Phase 6.5 section opens with an explicit predicate: `IF mode == 'YOLO' THEN skip-with-one-line-summary ELSE run-focus-group-per-epic`.
- [ ] When skipped under YOLO, the final summary contains: `Phase 6.5 (Focus-group): skipped — mode is YOLO per devx.config.yaml. Rerun /devx-plan after bumping mode to BETA+ to consult personas.`
- [ ] When run under BETA, focus-group is consulted per epic; sessions written to `focus-group/sessions/session-<date>-<epic-slug>-reaction.md`; cross-referenced from each epic file's "Focus-group reactions" section.
- [ ] PROD adds a binding-check: a critical shared concern across ≥2 personas requires user acknowledgment via INTERVIEW filing before Phase 7.
- [ ] Tests: `plan-mode-gate.test.ts` exercises YOLO branch (no session file written) and BETA branch (session file written). PROD acknowledgment branch covered with a fixture INTERVIEW filing.

### pln106 — Phase 8 final-summary `Next command:` block format
- [ ] Phase 8's "Next command" block emits exact format:
  ```
  Next command(s), in dependency order:
    /devx <hash-of-first>          # <one-line title>
    /devx <hash-of-second>         # <one-line title>; depends on <hash-of-first>
    ...
  ```
- [ ] When dependency graph has parallel-safe pairs (no edge between siblings), comment annotates `# parallel-safe with <other-hash>`.
- [ ] When all epics are done and there's nothing in DEV.md ready to claim, the block emits `/devx next  # picks top of DEV.md (currently empty)`.
- [ ] `plan-final-summary-format.test.ts` exercises the format against a fixture plan with 3 epics.

### plnret — Retro: bmad-retrospective on epic-devx-plan-skill
- [ ] Run `bmad-retrospective` against the 6 shipped stories (pln101–pln106); append findings to `LEARN.md § epic-devx-plan-skill`.
- [ ] Each finding tagged `[confidence]` + `[blast-radius]`.
- [ ] Low-blast findings applied in retro PR.
- [ ] Sprint-status row for `plnret` present + `LEARN.md § epic-devx-plan-skill` section exists.

## Dependencies

- **Blocked-by:** none (independent of mrg + prt + dvx).
- **Blocks:** none directly; epic-devx-skill consumes the same source-of-truth precedence rule but doesn't import any code from this epic.
- **Parallel-safe with:** epic-merge-gate-modes (mrg) and epic-pr-template (prt) — no shared files.

## Open questions for the user

None. Source-of-truth precedence is locked in DESIGN.md §"Source-of-truth precedence." Helpers + skill-body wiring is mechanical. Mode-gate is binary.

## Layer-by-layer gap check

- **Backend:** pln101 + pln102 + pln103 (helpers + CLI), pln104–106 (skill-body invariants). ✓
- **Infrastructure:** None — no CI/supervisor/GitHub state changes. ✓ explicit.
- **Frontend:** None — no UI surface. ✓

## Party-mode refined (2026-04-28, inline)

Lenses applied: PM, Dev (backend), Architect, Infra, Murat (QA). UX skipped.

### Findings + decisions

**PM (end-user value).** End-user value is "the next plan I run produces ready-to-claim work." Concern: pln105 covers Phase 6.5 mode gate but doesn't address what happens when a plan-spec frontmatter declares one mode and `devx.config.yaml` declares a different mode. **Locked decision:** pln104 already covers this via source-of-truth precedence (plan frontmatter overrides project config for that planning run). Reaffirmed; pln104 spec gets a one-line clarification.

**Dev (backend framing).** Concern: pln102's `emitRetroStory()` writes 3 artifacts atomically — but the rollback path is non-trivial. If the dev spec writes successfully but the DEV.md append fails, do we delete the spec? **Locked decision:** pln102 AC bumped — atomicity is implemented as: (a) write all 3 to `*.tmp` files first; (b) rename in this fixed order: spec → DEV.md → sprint-status.yaml; (c) on any rename failure, the prior renames are committed but the partial state is logged as `WARN: retro emission partial — manually verify <missing>`. Don't delete partial artifacts (better partial than zero). Test fixture covers each of the 3 failure points.

**Architect.** Concern: pln103's `validate-emit` runs at end of Phase 6 and aborts the planning run on failure. If a self-host /devx-plan run aborts mid-flight, the PRD addendum + epic files are already on disk. **Locked decision:** pln103 AC bumped — "abort the planning run" means: print the validation errors to stderr; do NOT roll back PRD/epic-file writes (those are append-only, valuable as-is); leave the planning run in a "validation-failed" state requiring user intervention. The next /devx-plan invocation can pick up where this one left off OR the user can manually fix the cross-references.

**Infra.** No infra surface — confirmed.

**Murat (QA / Test architect).** Risks:
- *pln103's validate-emit catches cross-reference breaks but not semantic drift.* If a spec's AC says "X" and the epic locked-decision says "not X" — semantic conflict. **Locked decision:** pln104 already covers this; pln103 + pln104 together cover the surface.
- *pln105 mode-gate test fixture for PROD acknowledgment.* Filing INTERVIEW for user acknowledgment is hard to test without a real user. **Locked decision:** pln105 AC bumped — test asserts INTERVIEW.md gets a new entry with the canonical Q-shape; user response is fixture-mocked (e.g., the test pre-populates INTERVIEW.md with `→ Answer: (a) acknowledge`). Real user acknowledgment is out-of-scope for unit tests.
- *pln106 final-summary test format snapshot.* Snapshot tests rot when format changes. **Locked decision:** pln106 AC bumped — snapshot test is paired with a format-stability assertion: any change to the snapshot requires a corresponding update to `.claude/commands/devx-plan.md` Phase 8 documentation referencing the format. (Soft enforcement; relies on retro discipline.)

### Cross-epic locked decisions added to global list
7. **Atomic multi-artifact emission uses `*.tmp` + ordered renames; partial state is logged WARN, not rolled back.** Better partial than zero.
8. **Plan-validation failure aborts forward progress but does not roll back append-only writes.** Manual or next-run fix-up is the recovery path.
9. **INTERVIEW.md acknowledgment paths are tested with fixture-mocked user responses, not real interaction.** Unit-test scope.

### Story boundary changes
None. pln101–pln106 + plnret unchanged in scope.
