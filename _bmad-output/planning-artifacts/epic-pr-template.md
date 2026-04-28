<!-- refined: party-mode 2026-04-28 (inline critique; thoroughness=balanced; lenses: PM/Dev/Architect/Infra/Murat — UX skipped) -->

# Epic — PR template (spec link as first line + Mode stamp)

**Plan:** `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`
**Slug:** `epic-pr-template`
**Order:** 2 of 5 (Phase 1 — Single-agent core loop) — independent of Phase 1 peers; depends on epic-init-skill (shipped)
**User sees:** "Every PR `/devx` opens has a `Spec:` link as the first line of the body and a `Mode:` line stamped with the current devx mode. Reviewers know exactly which gate auto-merge is applying."

## Overview

Two pieces ship together: (1) the canonical `pull_request_template.md` text added to `_devx/templates/` and written to `.github/pull_request_template.md` by `/devx-init` (idempotent — never clobbers a hand-edited existing template); (2) `/devx` Phase 7 wired to read the template and substitute the mode stamp + spec path before calling `gh pr create --body`. This epic is small (2 stories) but kept separate because it has an independent deliverable (the template ships and is visible on GitHub immediately) and because folding it into `epic-devx-skill` would couple the skill stories to a one-line text deliverable.

## Goal

Make every agent-emitted PR self-describing on GitHub itself: which spec it implements, which mode auto-merge is gated on, what was tested, what the reviewer should look at. Removes the "what is this PR even" cost on every PR scan, and makes mode regressions (e.g., a project unintentionally still in YOLO when it should be BETA) immediately visible to a reviewer or to the future user reading the merged commit.

## End-user flow

1. After `/devx-init` runs (or upgrades), the repo has `.github/pull_request_template.md`. GitHub's PR-create UI auto-populates new PRs from this template.
2. Leonid scans an open `/devx` PR on github.com. First line of the body: ``Spec: `dev/dev-<hash>-<ts>-<slug>.md` ``. Second non-empty line: `Mode: YOLO`. Then `## Summary`, `## Acceptance criteria`, `## Test plan`, `## Notes for reviewers`.
3. (Failure mode) The repo already had a `.github/pull_request_template.md` before `/devx-init` ran. `/devx-init` does NOT clobber. It either appends a `## devx` section if no `<!-- devx:mode -->` marker is present, or skips entirely if the marker is present. Idempotent.
4. (Skill consumer) `/devx` Phase 7 reads the on-disk template, substitutes `<!-- devx:auto:mode -->` → current mode + `<dev/dev-<hash>...>` → actual spec path, and emits the rendered body via `gh pr create --body`.

## Backend changes

- `.claude/commands/devx.md` Phase 7 (PR open) section updated: reads `.github/pull_request_template.md`, substitutes `<!-- devx:auto:mode -->` with `devx.config.yaml → mode`, substitutes spec path placeholder, passes the rendered text to `gh pr create --body "$(...)"`. Falls back to a built-in default if `.github/pull_request_template.md` is absent (covers repos that haven't run `/devx-init` upgrade since this epic shipped).

## Infrastructure changes

- New file `_devx/templates/pull_request_template.md`. Distributed in the npm package `@devx/cli` (already in `package.json → files: ["_devx/templates"]`).
- `src/lib/init-write.ts` (epic-init-skill, already shipped) extended with a `writePrTemplate(repoRoot)` function called from `init-orchestrator.ts`. Idempotent: skip if `<!-- devx:mode -->` marker present in existing template; append `## devx` section if file exists but lacks marker; write fresh template if file absent.
- `_devx/templates/pull_request_template.md` content (canonical):
  ```markdown
  <!-- devx:mode -->
  **Spec:** `<dev/dev-<hash>-<ts>-<slug>.md>`
  **Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*

  ## Summary
  <1–3 bullets on what changed>

  ## Acceptance criteria
  <checkbox list copied from spec>

  ## Test plan
  <bulleted list of what local CI gates covered + any manual steps>

  ## Notes for reviewers
  <surprises, deviations, follow-ups>
  ```

## Design principles (from research)

- **First line is the spec link.** Reviewers and the mobile companion app's PR card need a stable anchor — first non-frontmatter line of the body. Not buried under "Summary."
- **Mode is stamped at PR-open time, not declared in the template.** A static `Mode: YOLO` would rot when modes change. The `<!-- devx:auto:mode -->` placeholder forces `/devx` to read live config, eliminating the rot path.
- **Idempotence first, override never.** Phase 0's epic-init-skill principle (LEARN.md cross-epic pattern: "MANUAL.md as a designed signal") applies: existing user content is sacrosanct; we add markers and detect them on re-run, never overwrite. A user with a hand-edited PR template gets a `## devx` section appended (visible, opt-out by deletion); a fresh repo gets the canonical template.
- **Substitution is text replace, not template engine.** No mustache, no handlebars. `String.prototype.replaceAll('<!-- devx:auto:mode -->', mode)` and `replaceAll('<dev/dev-<hash>-<ts>-<slug>.md>', specPath)`. No new dependency.
- **Fallback-on-missing.** If `.github/pull_request_template.md` is absent (repo predates this epic and didn't run `/devx-init` upgrade), `/devx` falls back to a built-in default. Never blocks PR open on missing template.

## File structure

```
_devx/templates/
└── pull_request_template.md                ← new: canonical template, shipped via npm

src/
├── lib/
│   └── init-write.ts                       ← modified: + writePrTemplate(repoRoot, dryRun?)
└── commands/(no new commands)

test/
├── init-pr-template-fresh.test.ts          ← new: fresh repo writes canonical template
├── init-pr-template-with-marker.test.ts    ← new: existing template with marker → skip
├── init-pr-template-without-marker.test.ts ← new: existing template no marker → append ## devx
└── devx-pr-body-substitution.test.ts       ← new: skill-body substitution unit test (string-in → string-out)

.claude/commands/
└── devx.md                                 ← modified: Phase 7 reads template + substitutes
```

## Story list with ACs

### prt101 — Template ships + `/devx-init` writes it idempotently
- [ ] `_devx/templates/pull_request_template.md` exists with the canonical content above (verified by snapshot test).
- [ ] `package.json → files` already includes `_devx/templates` — no change needed.
- [ ] `src/lib/init-write.ts` exports `writePrTemplate(repoRoot, opts?: {dryRun?: boolean})`. Behavior:
  - File absent → write canonical template to `.github/pull_request_template.md`. Return `{action: 'wrote'}`.
  - File present + contains `<!-- devx:mode -->` marker → skip; return `{action: 'skipped'}`.
  - File present + no marker → append a `## devx` section with the same fields under `<!-- devx:mode -->` marker; return `{action: 'appended'}`.
- [ ] `init-orchestrator.ts` calls `writePrTemplate()` after the existing CLAUDE.md write step.
- [ ] Tests cover all three branches with fixture repos.
- [ ] Idempotence test: run `writePrTemplate()` twice; second call returns `{action: 'skipped'}` and produces no diff.

### prt102 — `/devx` Phase 7 reads template + substitutes mode + spec path
- [ ] `.claude/commands/devx.md` Phase 7 PR-open section explicitly reads `.github/pull_request_template.md`. If absent, uses a hardcoded default in the skill body matching the canonical template.
- [ ] Substitutes `<!-- devx:auto:mode -->` with `devx.config.yaml → mode` (uppercase: YOLO/BETA/PROD/LOCKDOWN).
- [ ] Substitutes `<dev/dev-<hash>-<ts>-<slug>.md>` with the actual spec path (already known to /devx by Phase 7).
- [ ] Substitutes `<checkbox list copied from spec>` with the AC list from the spec frontmatter (each `- [ ]` line).
- [ ] Substitutes `<1–3 bullets on what changed>` and other free-text placeholders by best-effort generation from the implementation diff (or leaves the placeholder in if uncertain — visible to the reviewer that something needed filling in).
- [ ] First non-empty body line is the `**Spec:**` line — verified by an integration test that opens a real PR via `gh` against a fixture repo and reads back the body.
- [ ] Skill-body substitution unit test (`devx-pr-body-substitution.test.ts`): given a fixture spec + config + template string, asserts the rendered output matches a golden file.

### prtret — Retro: bmad-retrospective on epic-pr-template
- [ ] Run `bmad-retrospective` against the 2 shipped stories (prt101, prt102); append findings to `LEARN.md § epic-pr-template`.
- [ ] Each finding tagged `[confidence]` + `[blast-radius]`.
- [ ] Low-blast findings applied in the retro PR.
- [ ] Sprint-status row for `prtret` present + `LEARN.md § epic-pr-template` section exists.

## Dependencies

- **Blocked-by:** none (epic-init-skill already shipped; this epic adds one orchestrator-call site + one template file).
- **Blocks:** `epic-devx-skill` (dvx wires the substitution into the skill body via prt102; if prt102 hasn't shipped, dvx falls back to the built-in default).

## Open questions for the user

None.

## Layer-by-layer gap check

- **Backend (skill body):** prt102 — `/devx` Phase 7 substitution. ✓
- **Infrastructure:** prt101 — template file ships in npm package; `/devx-init` writes it idempotently to `.github/`. ✓
- **Frontend:** None — no UI surface, but the rendered template appears on github.com (out of system control). ✓ explicit.

## Why this is at the small-epic threshold but stays separate

- 2 stories + retro = 3 spec files. Skill spec heuristics call for 3–8 stories per epic with single-story epics folded.
- Folding into `epic-devx-skill` would couple a one-line text deliverable to the broader skill refactor; both shipping cleanly is faster as separate PRs.
- prt101 ships independently (template visible on github.com after one PR merge) before any /devx skill change runs. Decoupled deliverable is the deciding factor.

## Party-mode refined (2026-04-28, inline)

Lenses applied: PM, Dev (backend), Architect, Infra, Murat (QA / test architect). UX skipped — no frontend layer (the rendered template appears on github.com but is out-of-system).

### Findings + decisions

**PM (end-user value).** Concern: "Mode: <!-- devx:auto:mode -->" is opaque if the user reads the template directly on GitHub before /devx fills it in. **Locked decision:** prt101 AC bumped — the canonical template's `Mode:` line includes a parenthetical `*(stamped at PR-open by /devx)*` so a user reading the template before /devx runs sees what's expected. (Already in the canonical content; reaffirming.)

**Dev (backend framing).** Concern: substitution is plain `replaceAll` — what if the template has multiple `<dev/dev-<hash>-<ts>-<slug>.md>` placeholders, or a comment block matching the placeholder by accident? **Locked decision:** prt102 AC bumped — substitute placeholders only when they appear in the canonical positions (line-anchored: `**Spec:**` line for the spec path; `Mode:` line for the mode). A regex like `/^\*\*Spec:\*\* `<dev\/dev-.*?\.md>`$/m` matches one-and-only-one placeholder. Test fixture exercises a malicious template with a placeholder in a code block (must NOT substitute).

**Architect.** Concern: prt101's `writePrTemplate()` operates inside `init-orchestrator.ts` — that orchestrator already has a complex idempotency contract from epic-init-skill (LEARN.md cross-epic). Adding writePrTemplate without crashing the existing flow is critical. **Locked decision:** prt101 AC bumped — `writePrTemplate()` is invoked at a fixed position in the orchestrator (after `writeClaudemd()`, before the supervisor install step), and `init-e2e.test.ts` is extended to assert the template appears in the resulting `.github/pull_request_template.md` and the existing 13-question + idempotency tests still pass. No regression in init-skill's contract.

**Infra.** Concern: `.github/pull_request_template.md` interacts with GitHub's per-repo PR-template rendering. If a user has multiple templates (`.github/PULL_REQUEST_TEMPLATE/foo.md`, `.github/PULL_REQUEST_TEMPLATE/bar.md`), `/devx-init` writing the singular file may not affect the chooser. **Locked decision:** out of scope for Phase 1; documented in epic file's "Open questions" — the system targets the singular file path; multi-template repos are an edge case for /devx-learn to capture if it surfaces.

**Murat (QA / Test architect).** Risks:
- *Substitution silently leaves a placeholder in the rendered body.* If `/devx`'s spec frontmatter is missing the AC list, the `<checkbox list copied from spec>` placeholder remains in the rendered PR body — visible on GitHub. **Locked decision:** prt102 AC bumped — when a placeholder cannot be substituted (missing source data), `/devx` leaves the placeholder visible (don't silently render an empty section); status-log line records "phase 7: pr body had unresolved placeholder <name>" so the issue is grep-able post-merge.
- *Idempotence when the user manually edits the template after init.* User edits `.github/pull_request_template.md` to add a section; re-runs `/devx-init`. Per prt101's design, the marker is preserved, the user's edits are preserved. ✓ Already in spec.

### Cross-epic locked decisions added to global list (continued from mrg)
4. **Substitution placeholders are line-anchored, not free-form regex.** Reduces accidental matches; testable.
5. **Unresolved placeholders remain visible in PR body.** No silent empty-section rendering. Grep-able audit trail in spec status log.
6. **`init-orchestrator.ts` invocations preserve existing idempotency contract.** New init-write sites land at fixed orchestrator positions; e2e test asserts no regression in the 13-question + idempotency surface.

### Story boundary changes
None. prt101 / prt102 / prtret unchanged in scope.
