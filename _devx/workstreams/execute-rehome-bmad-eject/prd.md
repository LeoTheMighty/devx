# PRD — Execute re-home + BMAD ejection (V2.2)

## Problem

devx's execution loop still routes through BMAD skill invocations
(`bmad-dev-story`, `bmad-code-review`, `bmad-retrospective`) that the v2
migration has already re-designed as native disciplines, and ~11MB of BMAD
skill sources plus the `_bmad/` manifests remain installed with 33/51 skills
orphaned. Every `/devx` story pays ~48KB of foreign prose; the repo carries a
dead `bmad:` config section, a retired-but-still-written sprint-status.yaml
writer path, and legacy `/dev` + `/dev-plan` commands. Phase 1 closed the
BMAD era at mgrret — the code now has to follow.

## Goals

- **G-1**: BMAD-free execution surface by V2.2 close — `src/`,
  `.claude/commands/`, and `.claude/skills/` contain 0 BMAD references or
  skill directories (measured by the E-1 eval script, exit 0).
- **G-2**: Engine configuration is first-class by V2.2 close — the `engine:`
  block exists in `devx.config.yaml`, schema-validated, with
  `workstreams_root` resolvable (E-2 eval exit 0).
- **G-3**: Zero regression — the full test suite stays green (≥1571 tests)
  through the ejection PR.

## Non-goals

- Rewriting `_bmad-output/` history — frozen per the v2s101 freeze note.
- The review tour, dispatcher, or overnight loop (v2t101 / v2d101 / v2l101).
- Deleting docs' historical mentions of BMAD (capture docs keep the record).

## Users

- **Primary**: Leo + the devx agents executing dev items in this repo.
- **Secondary**: future `devx init` users on fresh repos (no BMAD install).
- **Anti-persona**: existing BMAD-workflow users — devx v2 does not aim to
  stay BMAD-compatible.

## Use cases

- **UC-1**: an agent runs `/devx <hash>` and implements from spec ACs with
  native review discipline, loading no BMAD prose.
- **UC-2**: an agent runs `/devx retro` at epic close and produces the retro
  file + LEARN.md rows natively.
- **UC-3**: a user runs `devx init` on a fresh repo and gets the engine
  scaffold with no BMAD install step or failure mode.

## Capabilities

- **CAP-1**: native execute discipline in the `/devx` skill body (spec-ACs
  direct, red-green-refactor, 3-agent adversarial review at threshold).
- **CAP-2**: native retro stage replacing the retrospective workflow.
- **CAP-3**: engine + loop configuration sections with schema validation and
  a `bmad:`-key deprecation shim.

## Feature requirements

### FR-1: BMAD-free skill bodies

`.claude/commands/devx.md` Phases 2–4 re-homed natively; dvx103 status-log
pinning updated; `.claude/commands/dev.md` + `dev-plan.md` deleted.

### FR-2: BMAD artifact removal

`.claude/skills/bmad-*` and `_bmad/` deleted; `devx init` sheds the
`npx bmad-method install` path and the ini506 BMAD-fail failure mode.

### FR-3: Config migration

`devx.config.yaml` §15 `bmad:` replaced by `engine:` + `loop:` blocks
(schema + defaults per v2/02-engine.md §7 and v2/04-overnight-loop.md §3);
leftover `bmad:` keys tolerated with a deprecation warning.

### FR-4: Source-template retargeting

`emit-retro-story` AC template names `/devx retro`; `should-create-story` +
canary retired; `Story:` commit-template line dropped; sprint-status.yaml
writer steps removed (D-7).

### FR-5: Docs sweep

CLAUDE.md, docs/DESIGN.md, docs/ROADMAP.md (D-2 re-wording), docs/SETUP.md
ghost path, LEARN.md header, docs/MODES.md refs updated; eject contract
re-worded per v2/01-bmad-capture.md §6.

## Evals seed

- grep-based BMAD-free check over src/ + .claude/ (currently fails — that's
  the point; goes green when FR-1/FR-2 land).
- `engine:` block presence + workstreams_root resolvability (currently
  fails; green at FR-3).
- init scaffold BMAD-free (currently fails; green at FR-2).

## Open questions

- None blocking — D-1/D-2/D-3/D-7 in v2/07-decisions.md pre-decided the
  contentious parts; D-2's re-wording needs Leo's sign-off inside the
  v2x101 PR review.

## Reference links

- Spec: dev/dev-v2x101-2026-07-05T13:03-execute-rehome-bmad-eject.md
- Capture + migration order: v2/01-bmad-capture.md §4
- Prior art: v2/02-engine.md §7 (engine config), v2/04-overnight-loop.md §3
