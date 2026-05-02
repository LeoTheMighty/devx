---
hash: prt101
type: dev
created: 2026-04-28T19:30:00-07:00
title: Template ships + /devx-init writes it idempotently
from: _bmad-output/planning-artifacts/epic-pr-template.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
branch: feat/dev-prt101
---

## Goal

Add canonical `pull_request_template.md` text under `_devx/templates/`; extend `/devx-init`'s init-write step to write it to `.github/pull_request_template.md` idempotently (skip-with-marker / append-without-marker / write-fresh). **Supersedes the Phase 0 ini503 PR-template write site** (`init-gh.ts:248` → `writePrTemplate()` at `init-gh.ts:455`, template file `_devx/templates/init/pull_request_template.md`) — that surface is deleted as part of this story per the source-of-truth-precedence rule (`docs/DESIGN.md §185`): the Phase 1 spec shape (Spec link as literal first body line + two-marker design separating `<!-- devx:mode -->` idempotency from `<!-- devx:auto:mode -->` substitution) wins over the Phase 0 shape (spec link buried under `## Spec`, single conflated marker).

## Acceptance criteria

### New surface (Phase 1 shape)

- [ ] `_devx/templates/pull_request_template.md` exists with the canonical content from `epic-pr-template.md` § "Infrastructure changes". Verified via snapshot test. Marker `<!-- devx:mode -->` is line 1; `**Spec:** \`<dev/dev-<hash>-<ts>-<slug>.md>\`` is line 2; `**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*` is line 3.
- [ ] `package.json → files` includes `_devx/templates` (already does — verify, no change needed).
- [ ] `src/lib/init-write.ts` exports `writePrTemplate(repoRoot, opts?: {dryRun?: boolean, templatesRoot?: string})`. Three branches:
  - File absent → write canonical → `{action:"wrote"}`.
  - File present + contains `<!-- devx:mode -->` → skip → `{action:"skipped"}`.
  - File present + no marker → append `## devx` section (with the canonical Spec/Mode/Summary/AC/Test plan/Notes block under a fresh `<!-- devx:mode -->` marker) → `{action:"appended"}`.
- [ ] `init-orchestrator.ts:251` calls `writePrTemplate()` after `writeInitFiles()` (which writes CLAUDE.md) and **before** `writeInitGh()` at `init-orchestrator.ts:254`. Result is threaded into the orchestrator return shape so the e2e test can assert on it.
- [ ] Tests: `test/init-pr-template-fresh.test.ts`, `test/init-pr-template-with-marker.test.ts`, `test/init-pr-template-without-marker.test.ts`.
- [ ] Idempotence test: run `writePrTemplate()` twice; second call returns `{action:"skipped"}` and produces no diff.

### Phase 0 surface removal (source-of-truth-precedence migration)

- [ ] `_devx/templates/init/pull_request_template.md` deleted (the old shape with marker at the bottom under `## Mode`).
- [ ] `src/lib/init-gh.ts`:
  - Delete the `writePrTemplate()` function at `:455` and the `PrTemplateOpts` interface at `:449`.
  - Delete the call site at `:248` and the `// ---- 2. PR template` comment block.
  - Delete the `prTemplate` field from `WriteInitGhResult` and from every return-object literal in the file (no-remote path, gh-not-authed path, green path, etc. — grep for `prTemplate:` in `init-gh.ts`).
  - Delete the `PR_TEMPLATE_MODE_MARKER` constant at `:206` (only consumer was the deleted function).
  - Delete the now-unused `writeWorkflowOutcomeFor` helper at `:476` if no other call sites remain (grep first; keep if used by the workflow path).
  - Update the file header comment block (`:1-29`) to drop "PR template" from the public-surface enumeration and the phase-2 line.
- [ ] `test/init-gh.test.ts`: remove the `result.prTemplate.outcome` assertion at `:304` and the `**YOLO**` + marker assertions at `:309-310`. Drop the surrounding `it(...)` block if it tests only the PR template; otherwise keep the block and just remove the PR-template-specific assertions.
- [ ] `src/lib/init-upgrade.ts:558` (`defaultDetectPrTemplate`) — verify still works (path unchanged: `.github/pull_request_template.md`). No code change expected; add a comment noting the writer moved from `init-gh.ts` → `init-write.ts` so future readers don't grep the wrong file.
- [ ] `test/init-e2e.test.ts`: add an assertion that the resulting `.github/pull_request_template.md` matches the **new** Phase 1 shape (marker at line 1, `**Spec:**` at line 2, `**Mode:**` at line 3). Remove any existing assertions that check for the old shape (marker at the bottom under `## Mode`).
- [ ] All existing init tests still pass — the 13-question + idempotency surface from epic-init-skill is not regressed (party-mode locked decision: cross-epic locked decision #6 in `epic-pr-template.md §Cross-epic locked decisions`).

### Substitution-marker hygiene (party-mode locked decision #4)

- [ ] The two markers are NOT conflated. `<!-- devx:mode -->` is the idempotency marker that `/devx-init` uses to detect "already written"; `<!-- devx:auto:mode -->` is the substitution placeholder that `/devx` Phase 7 (prt102) replaces with the active mode at PR-open. The old `init-gh.ts` code conflated them as a single `<!-- devx:mode -->` and rendered `**${mode}**` directly above the marker — that conflation is removed; the new template carries both markers verbatim, and `writePrTemplate()` does NOT substitute the mode (substitution is prt102's job, not /devx-init's).

## Technical notes

- Reuse the LEARN.md cross-epic "idempotency state file pattern" mental model (no SHA-256 needed here; marker-based detection is sufficient).
- Existing user content is sacrosanct (LEARN.md cross-epic "MANUAL.md as designed signal" — same principle: never overwrite hand-edited).
- **Why the migration was added to this story (planning blind-spot):** `/devx-plan` planned this epic without grepping the existing `init-*` modules for already-shipped PR-template surfaces. ini503 (PR #24) shipped a PR-template write site under a different file path (`_devx/templates/init/...`), a different module (`init-gh.ts` instead of `init-write.ts`), and a different shape (marker at the bottom, single conflated marker, spec link buried under `## Spec`). Shipping prt101 as originally written would have produced two write sites both targeting `.github/pull_request_template.md` with the second overwriting the first — broken end-state. The fix-the-loser direction is unambiguous (spec wins; the Phase 1 shape is genuinely better — Spec link as literal first body line is load-bearing for the mobile companion app's PR card per `epic-pr-template.md § Design principles`); the migration files added here put it on rails. Capture this as a finding for `epic-devx-plan-skill` retro: "`/devx-plan` must grep existing `src/lib/<area>-*.ts` for shipped surfaces an epic intends to redesign, before emitting story ACs."

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-02T — claimed by /devx; halted in Phase 4 on a conflict with the Phase 0 ini503 PR-template surface (`init-gh.ts:248`, `_devx/templates/init/pull_request_template.md`). Spec did not mention the existing surface; shipping as written would create two write sites both targeting `.github/pull_request_template.md`. Halt was correct per CLAUDE.md "No silent product decisions" + `docs/DESIGN.md §185` source-of-truth-precedence rule.
- 2026-05-02T — spec amended (this revision) to add explicit Phase 0 surface-removal ACs + substitution-marker hygiene AC. Resolution = option (c) from the handoff snippet: source-of-truth-precedence-correct, with the migration spelled out as ACs so it's tracked, reviewed, and retro-able. Resuming /devx prt101 next.
- 2026-05-02T — claimed by /devx (resumed); status flipped to in-progress; bringing the amended ACs onto main as part of the claim so the worktree branches off the resolved spec.
