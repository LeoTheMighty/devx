# Retrospective — epic-config-schema

**Epic:** `_bmad-output/planning-artifacts/epic-config-schema.md`
**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Stories:** cfg201 (JSON schema for 15 sections) · cfg202 (eemeli/yaml round-trip lib) · cfg203 (validation on load) · cfg204 (`devx config <key>` CLI)
**Run by:** /devx cfgret (interim retro discipline — `LEARN.md § epic-config-schema` is the source of truth for action items; this file is a BMAD-shaped sibling for traceability)
**Run date:** 2026-04-27
**Mode at execution:** YOLO · empty-dream · send-it (single-branch on `main`)

---

## 1. Epic summary

| Metric | Value |
|---|---|
| Stories planned | 4 |
| Stories shipped | 4 (cfg201, cfg202, cfg203, cfg204) |
| Completion % | 100% |
| PRs | #4 (cfg201 → cb73bc5), #5 (cfg202 → c6a5625), #6 (cfg203 → b00ef2e), #8 (cfg204 → 1ba275f) |
| Production incidents | 0 |
| Rollbacks | 0 |
| Self-review findings (auto-fixed) | cfg201 ≈5 + cfg202 ≈1 + cfg203 ≈2 + cfg204 5/12 = ~13 |
| Tests at end of epic | 40+ vitest (5 cli + 35 config-command) + cfg202 17 + cfg203 32 + 3 schema-smoke ≈ 77 distinct cases |
| Acceptance criteria met | All cfg201 AC1–7, all cfg202 AC1–7, all cfg203 AC1–7, all cfg204 AC1–8 |
| Final artifacts | `_devx/config-schema.json`, `src/lib/config-io.ts`, `src/lib/config-validate.ts`, `src/commands/config.ts`, fixtures + tests |

Status check at retro time: epic ships every promised deliverable. The
party-mode-flagged extras (anchor/alias preservation regression, friendly
fuzzy-match errors, `devx config --list`) all landed in cfg204.

This is the project's **first real-functional command** — every other Phase 0
command is a stub. `devx config get/set` round-trips comment-preserving YAML
end-to-end against the validated schema.

---

## 2. What worked

1. **Sequential 4-story handoff via dependency-explicit blocking.** cfg201
   shipped first (no deps), cfg202 shipped against cfg201's schema +
   fixtures, cfg203 against cfg201+cfg202, cfg204 against cfg202+cfg203+cli301.
   The `blocked_by:` frontmatter held; nothing claimed prematurely. Same
   sequential pattern as audret's 3-story chain, scaled cleanly to 4.
2. **Self-review caught real defects in every story (not lint-class).**
   - cfg201 (5): dropped ajv-strict-incompatible `not.required` mutex idiom;
     added project-config validation as third smoke check; simplified
     addFormats ESM-interop; symmetrized stack/projects mutex notes; dropped
     unused shebang.
   - cfg202 (1, but load-bearing): `setIn` on a Scalar replaces the node and
     loses inline comments — workaround mutates `Scalar.value` in place,
     falls back to `setIn` only when path doesn't exist. The "no comments
     lost" diff regression catches this.
   - cfg203 (2): tightened cache key to `(projectPath, userPath)` to prevent
     cross-config bleed; cleaned addFormats ESM import.
   - cfg204 (5 of 12 surfaced): suppressed spurious "unknown key" warning
     when no schema file is on disk; friendly error on corrupt schema JSON;
     reject array-element writes (numeric segment into existing Seq) up
     front to avoid eemeli/yaml setIn silently writing a stringly-keyed
     phantom; widened number-coercion regex to accept `.5` and `5.`;
     `--user` on a `get` now warns the flag is ignored.
   None were lint-class; all caught semantics issues that would have shipped.
3. **Source-of-truth precedence was applied in real time.** cfg202 status
   log: "Following spec ACs (source of truth). On macOS the two are
   identical so no behavior delta for this project." This is the pattern
   later codified in `docs/DESIGN.md § Source-of-truth precedence` and
   promoted to LEARN.md cross-epic. cfg202 is the canonical example.
4. **eemeli/yaml `parseDocument` mode held end-to-end.** Round-trip fixtures
   covered: hand-edited-with-comments YAML, anchors+aliases (per epic
   QA-lens addition), dotted paths, leaf-only writes, missing-mode corrupt
   fixture. Zero loss across 40+ vitest cases. Validates the locked-decision
   "eemeli/yaml NOT js-yaml as the canonical YAML library across all devx
   Node code" — no second-guessing the choice.
5. **Test-count compounding continued.** cfg201 schema-smoke (3) → cfg202
   added 17 → cfg203 reached 32 PASS → cfg204 reached 40+ vitest plus the
   tsx suites still green (~77 distinct cases). Same green-check pattern as
   sup. No flakes.
6. **Phase-0 stub policy carved-out cleanly for the only real command.**
   cfg204 AC#7: `devx config` (no args) prints usage to stderr and exits 0
   (not 64) — Phase 0 stub policy applies even though config is real.
   Subtle but right: keeps CLI ergonomics consistent across stub and real
   commands, so the user can't distinguish "not implemented" from "needs
   args" by exit code alone. Worth memorializing as a Phase 1+ ergonomic
   default.
7. **YOLO single-branch auto-merge held end-to-end across 4 PRs.** No human
   merge intervention; trust-gradient threshold = 0 / count = 0 keeps the
   ladder open from commit 1. cfg202's status log explicitly notes the user
   feedback that corrected an earlier "manual-merge default" reading and
   confirmed: "in YOLO single-branch repos /devx auto-merges on local-CI
   green, no human in the loop." That correction propagated to /devx skill
   v0 and held for cfg203, cfg204, plus all of cli/sup/aud/audret. Live
   memorialized in `feedback_yolo_auto_merge.md`.

---

## 3. What didn't

1. **Planner emitted `branch: develop/dev-<hash>` despite single-branch
   config — recurring (4/4 stories).** Same as audret. Already mitigated in
   commit `1b8edb3` (planner skills + `docs/DESIGN.md` updated as part of
   audret PR #19). Listed here for completeness; no new action.
2. **`bmad-create-story` step in `/devx` Phase 2 was silently skipped on
   every story.** Spec ACs were the de-facto source of truth. Empirically
   across all four cfg stories (and cross-checked against aud/cli/sup/ini),
   no `_bmad-output/implementation-artifacts/story-*.md` file was produced;
   only `epic-bmad-audit-retro-2026-04-27.md` and `sprint-status.yaml`
   exist in that directory. The /devx skill prescribes "if a BMAD story
   file exists, read it and skip … otherwise invoke `bmad-create-story`",
   but reality has been "skip when spec ACs are sufficient — and they
   always are in YOLO + empty-dream." This is a contract-vs-reality drift
   that the skill should either acknowledge ("YOLO + empty-dream may skip
   when spec ACs cover everything `bmad-create-story` would generate") or
   start enforcing.
3. **Retro stories (`*ret`) are absent from `sprint-status.yaml`.** cfgret
   (this story) and audret (PR #19, just merged) both file retros; neither
   has a row in `sprint-status.yaml`. The /devx Phase 8.6 step says to flip
   the matching `<hash>` story's status — there's nothing to flip. The
   planner skills (`/devx-plan`, `/dev-plan`) emitted retro rows into DEV.md
   but didn't append the matching rows to `sprint-status.yaml`. The
   cleanup-step no-op is mostly harmless for the retro itself but leaks
   inaccurate status into any downstream consumer that reads the yaml as
   ground truth (LearnAgent, Phase 5 `/devx-manage`).
4. **Pre-existing parent stories not flipped to `done` in
   `sprint-status.yaml`.** aud101–103 (`backlog`), cfg201 (`backlog`),
   sup405 (`backlog`) — all merged but yaml not updated by their respective
   /devx cleanup commits. /devx Phase 8.6 IS supposed to flip these. The
   drift accumulates silently. Drift = sustainable only because no
   downstream consumer reads the yaml yet; the moment LearnAgent or
   `/devx-manage` lands, this becomes a behavior bug. **Apply in this PR
   for cfg201 (in-scope, same epic); file remainder.**
5. **"Fix the loser" half of the source-of-truth precedence rule was
   skipped.** `epic-config-schema.md` "Locked decisions fed forward"
   (line 122) still says: "User-config path: `~/.devx/config.yaml`
   cross-platform (NOT XDG; one user-visible directory under `~/.devx/`)."
   But cfg202 implemented XDG-on-Linux + `~/.devx/` on macOS+WSL per its
   spec AC. cfg202 followed precedence (correct) but did NOT update the
   epic file's losing locked-decision (skipped). The rule is supposed to
   be: "fix the loser in the same PR." cfg202 fixed only the docs/DESIGN.md
   entry (which is the rule's home). The epic-file drift survived four
   stories. **Apply in this PR.**
6. **CLAUDE.md "How /devx runs" section is stale relative to the project's
   actual single-branch config.** Lines 184–185 say "Worktree: `git worktree
   add .worktrees/dev-<hash> -b develop/dev-<hash> develop`" — the project
   has been single-branch since INTERVIEW Q#7 (lines 102–103 of CLAUDE.md
   itself say so). Lines 195: "Push + PR to `develop`". Self-inconsistent
   inside CLAUDE.md. Same drift class as the planner-emitted stale `branch:`
   frontmatter. **Apply in this PR.**
7. **Self-review's cross-epic value warrants an explicit working agreement
   in CLAUDE.md.** LEARN.md cross-epic patterns row (line 101) already
   promoted "/devx self-review step is non-skippable and consistently finds
   real bugs" with confirmation across cfg201/cfg204/cli301/cli304/aud102/
   aud103. The pending action was: "confirm wording in CLAUDE.md, edit if
   missing." Confirmed missing. **Apply in this PR.**
8. **`docs/CONFIG.md` § Schema validation still names the wrong path.** The
   audit (`bmad-audit.md`) called this out and epic-config-schema.md's
   Infrastructure section explicitly noted "this is stale documentation.
   epic-config-schema corrects it as part of aud103's 'recommendations'
   output (or in its own follow-up MANUAL entry)." cfg201–204 shipped the
   correct path (`_devx/config-schema.json`) but did not update CONFIG.md's
   stale reference. **Verify and apply if still stale.**

---

## 4. Cross-references with the existing hand-extracted entries in LEARN.md

This formal pass reconciles with the hand-extracted entries in `LEARN.md §
epic-config-schema` (extracted 2026-04-27, ahead of cfgret running formally).

| Hand-extracted finding | Formal-pass status |
|---|---|
| Spec ACs vs. epic locked decisions precedence was undocumented | Confirmed; expanded with the cfg202 XDG-vs-`~/.devx/` example as the canonical case (see §2.3 above). The codified rule landed in `docs/DESIGN.md` (per cross-epic LEARN row); see §3.5 for the still-unfixed loser. |
| Self-review consistently catches real bugs (cfg201 + cfg204) | Confirmed; expanded with cfg202 + cfg203 evidence (§2.2). With cli/sup/audit numbers, the pattern crosses ≥3 epic threshold. The CLAUDE.md edit pending in cross-epic LEARN entry is now applied (§5.1). |
| eemeli/yaml `setIn`-on-Scalar trap | Confirmed; lives in `src/lib/config-io.ts`. No new action — reaffirmed as a `bmad-quick-dev` lesson candidate when bmad-quick-dev touches yaml round-tripping. |
| YOLO single-branch auto-merge confirmed across stories | Confirmed; expanded with the cfg202 user-feedback story (§2.7) as the moment the contract was made explicit. Already memorialized in `feedback_yolo_auto_merge.md`. |

This pass adds the following NEW findings (not previously hand-extracted):

- E1 (high, skill) — `bmad-create-story` step in /devx Phase 2 silently skipped across all 4 Phase 0 epics. Pending-concordance for skill change; surface as candidate for first LearnAgent pass when Phase 5 lands.
- E2 (high, skill+docs) — Retro stories absent from `sprint-status.yaml`. Planner skills should emit matching rows. 2/2 retros observed.
- E3 (high, docs) — Pre-existing parent-story sprint-status flips drifting (aud × 3, cfg201, sup405). Apply cfg201 fix in this PR; file rest.
- E4 (med, docs) — "Fix the loser" half of precedence rule skipped in cfg202 → epic-config-schema.md drift. Apply in this PR.
- E5 (med, docs) — CLAUDE.md "How /devx runs" section stale (`develop`-branch references in single-branch repo). Self-inconsistent. Apply in this PR.
- E6 (low, docs) — Phase-0 stub-policy carve-out for `devx config` (no-args → exit 0 not 64) is the right ergonomic default for Phase 1+ real commands. Pending-concordance.
- E7 (low, docs) — Verify `docs/CONFIG.md § Schema validation` path correction; apply if still stale.

---

## 5. Items applied in this PR (low blast radius)

1. **Add explicit "Self-review is non-skippable" working agreement to
   `CLAUDE.md`.** Single bullet under "Working agreements (project-specific)".
   Resolves the LEARN cross-epic-patterns "pending: confirm wording in
   CLAUDE.md, edit if missing" entry (line 101).
2. **Update `CLAUDE.md` "How /devx runs" section to reflect single-branch
   reality.** Lines 184–185 + 195: replace `develop`-branch references with
   `feat/<type>-<hash>` off `main`. Self-consistency with §"Branching
   model" earlier in the same file. Resolves E5.
3. **Update `epic-config-schema.md` "Locked decisions fed forward" line 122
   to match implemented user-config path** (XDG-on-Linux + `~/.devx/` on
   macOS+WSL, per cfg202 spec AC). Resolves E4 / "fix the loser" rule.
4. **Flip cfg201's `sprint-status.yaml` row from `backlog` to `done`** —
   in-scope (same epic as the retro). Resolves E3 (cfg201 only).
5. **Append the seven NEW findings (E1–E7) to `LEARN.md §
   epic-config-schema`.** Existing four hand-extracted entries kept verbatim;
   new entries appended with formal-pass attribution. Promote E1 + E2 +
   self-review-CLAUDE-entry to Cross-epic patterns where threshold met.
6. **Verify `docs/CONFIG.md` schema-path text** and update if still stale.
   Resolves E7.

---

## 6. Items NOT applied (filed instead)

| Finding | Why not applied here | Filed as |
|---|---|---|
| E1 (`bmad-create-story` skipped across Phase 0) | Skill-prompt change, blast radius = `skill` (`self_healing.user_review_required_for: [skills]`). User-review-required by config. 4/4 epics observed but the fix is "decide whether to enforce or codify the skip", which is a product decision, not a mechanical edit. | `LEARN.md § epic-config-schema` row (E1), tagged `pending-concordance + user-review`. Also note for `MANUAL.md`: user decides whether to (a) enforce bmad-create-story even in YOLO+empty-dream, (b) make it conditional on spec-AC-completeness, or (c) drop the step from /devx Phase 2 entirely. |
| E2 (retros absent from sprint-status.yaml) | Same class — touches `/devx-plan` and `/dev-plan` skill emit-templates; user-review-required. 2/2 retros observed (audret, cfgret) but a third would solidify before promoting. | `LEARN.md § epic-config-schema` row (E2), `pending-concordance`. |
| E3 backfill (aud × 3 + sup405 sprint-status flips) | Out of scope for cfgret (other epics). Mechanical one-line-per-row edits. | `MANUAL.md` row asking the user whether to backfill the four stale rows in a `chore:` commit (low cost, but a different epic's bookkeeping by definition). |
| E6 (stub-policy carve-out as Phase 1+ default) | Single-instance, low confidence. | `LEARN.md § epic-config-schema` row (E6), `pending-concordance`. |

---

## 7. Readiness check for next epic in dependency order

epic-config-schema is closed. The remaining ready retros in `DEV.md` (in
order) are `cliret`, `supret`, `iniret` (last one blocked-by ini502+).
ini502 is also unblocked and represents the next forward-progress story
(epic-init-skill: local file writes).

Phase 0 closure-readiness:
- aud + cfg + cli + sup retros: aud done (PR #19), cfg done (this PR),
  cli + sup pending.
- ini partial: ini501 done; ini502–508 ready, blocked only by ini502 head.
- Phase 0 has no surprise dependencies surfacing in this retro.

The next item `/devx` will pick up after cfgret merges is whichever ready
retro/forward item is at the top of `DEV.md`. Per the file ordering at
retro time: **cliret** (Epic 3 retro, blocked-by all-done cli301–305) is
next.

---

## 8. Closure

cfgret is the second application of the interim retro discipline. The
deliverable is:
- this BMAD-shaped retro file (sibling to LEARN.md for traceability),
- `LEARN.md § epic-config-schema` updated with E1–E7 alongside the four
  hand-extracted entries, plus cross-epic-patterns promotions where
  threshold met,
- five low-blast doc/config edits applied (CLAUDE.md self-review bullet,
  CLAUDE.md /devx-runs section, epic-config-schema.md locked-decision
  fix, cfg201 sprint-status flip, CONFIG.md path verification),
- one MANUAL.md row filed (E3 backfill across other epics),
- E1 + E2 + E6 deferred as `pending-concordance` for next retro / first
  LearnAgent pass.

Source of truth for action items going forward: `LEARN.md`. This file is a
parallel artifact for downstream BMAD-shaped consumers (RetroAgent +
LearnAgent in Phase 5) to ingest when those land.
