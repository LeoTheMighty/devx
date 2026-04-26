<!-- refined: party-mode 2026-04-26 -->

# Epic — BMAD audit

**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Slug:** `epic-bmad-audit`
**Order:** 1 of 5 (Phase 0 — Foundation)
**User sees:** "I can open `bmad-audit.md` and see which BMAD workflows devx invokes, wraps, escape-hatches, shadows, or leaves orphaned — and the risks."

## Overview

Audit every BMAD workflow + skill installed under `_bmad/` (modules: core, bmm, tea), classify each by devx's relationship to it, and surface risks. Output is one markdown file at `_bmad-output/planning-artifacts/bmad-audit.md` that downstream phases reference. No code; pure research.

## Goal

Resolve OPEN_QUESTIONS Q7 ("What does BMAD actually cover, and where does devx add?") with a definitive, version-stamped audit so Phase 1+ epics can claim or defer specific BMAD workflows without re-research.

## End-user flow

1. Leonid runs `/devx aud101` (or claims this off `DEV.md`'s top entry).
2. The dev agent walks `_bmad/{core,bmm,tea}/` and lists every workflow with name + one-line purpose.
3. For each workflow, the agent classifies it: **invoked** (devx calls it directly), **wrapped** (devx adds opinions around it), **escape-hatch** (devx exposes it for power-user invocation but doesn't call it itself), **shadowed** (devx replaces this with a different mechanism — e.g., `bmad-sprint-planning` → `DEV.md`), or **orphaned** (devx neither invokes nor exposes it; risk to flag).
4. The agent writes risks: TEA workflows currently orphaned in `/devx-plan` and `/devx`; sprint-planning shadowed by `DEV.md`; retrospective workflow not invoked; UX-design timing mismatch (BMAD Phase 2 vs. devx party-mode Phase 6).
5. Leonid opens `_bmad-output/planning-artifacts/bmad-audit.md`, reads the table, and knows what to wire next phase.

## Frontend changes (CLI)

None — this epic is a documentation deliverable, no CLI surface.

## Backend changes

None.

## Infrastructure changes

None.

## Design principles (from research)

- **One classification per workflow.** A workflow is exactly one of `invoke / wrap / escape-hatch / shadow / orphan`. No multi-class entries.
- **Inventory first, classify second.** The Phase 2 research reports show inventory drift between docs and reality; the inventory step is the load-bearing one.
- **Risks are first-class.** TEA orphan + sprint-planning shadow + retrospective gap + UX timing each get their own subsection, not a footnote.
- **Versioned audit.** Audit doc records BMAD module versions found (`core` v6.x, `bmm` v6.x, `tea` v1.x) so it can be re-run on upgrades.

## File structure

```
_bmad-output/planning-artifacts/
└── bmad-audit.md                    ← single output deliverable
```

Sections of `bmad-audit.md`:
1. Module inventory (core / bmm / tea), each with workflow list + one-line purpose
2. Classification table (workflow → invoke|wrap|escape-hatch|shadow|orphan + which devx command)
3. Risks (TEA orphan, sprint-planning shadow, retrospective gap, UX timing mismatch)
4. Recommendations for downstream phases (which orphans Phase 5 should wire)
5. Module versions + audit date

## Story list with ACs

### aud101 — Inventory BMAD modules + workflows
- [ ] Walk `_bmad/{core,bmm,tea}/` directories
- [ ] List every workflow / skill / agent with name + 1-line purpose (extracted from workflow.yaml or first heading of corresponding md file)
- [ ] Capture installed module versions
- [ ] Section 1 of `bmad-audit.md` complete

### aud102 — Classify each workflow + map to devx command
- [ ] Every workflow from aud101 gets exactly one classification: invoke / wrap / escape-hatch / shadow / orphan
- [ ] Each "invoke" or "wrap" entry names the devx command that does so (e.g., `bmad-create-prd` → invoked by `/devx-plan` Phase 3)
- [ ] Section 2 of `bmad-audit.md` (classification table) complete
- [ ] Recommendations subsection lists every TEA workflow with the Phase 5 epic that should wire it

### aud103 — Risks subsection + finalize
- [ ] Risk 1 (TEA orphan): explicit list of unwired TEA workflows + downstream impact
- [ ] Risk 2 (sprint-planning shadow): how `DEV.md`'s continuous flow differs from BMAD's sprint model + where they could conflict
- [ ] Risk 3 (retrospective gap): note that devx assumes manual `LESSONS.md` updates instead of running `bmad-retrospective`; recommend Phase 5 wiring
- [ ] Risk 4 (UX timing): UX design happens late in devx party-mode (Phase 6) vs. BMAD's Phase 2; flag risk of UX rework
- [ ] Final section 4 + 5 (recommendations + versions) written
- [ ] `bmad-audit.md` committed under `_bmad-output/planning-artifacts/`

## Dependencies

- **External:** none.
- **Repo prerequisites:** `_bmad/` directory present (BMAD installed). Already true in this repo.

## Open questions

None — research complete in Phase 2 of this `/devx-plan` run; story work is just authorship.

## Party-mode critique (team lenses)

- **PM**: Delivers the promised value — a clear, current `bmad-audit.md` that downstream phases can cite. Approve. One miss: the audit doc itself has no refresh trigger. Add a "re-run when `_bmad/_cfg/manifest.yaml` versions change" recommendation in Section 5.
- **UX**: N/A — pure documentation deliverable, no end-user surface.
- **Frontend (CLI)**: N/A this epic.
- **Backend**: N/A this epic.
- **Infrastructure**: N/A this epic.
- **QA**: Section 1's inventory completeness needs a verification step — count of workflows in `_bmad/` should match count in doc. Add a manual completeness check to aud103's ACs (or as a `learn/` follow-up: a future `/devx-learn` rule could flag drift).
- **Locked decisions fed forward**:
  - `bmad-audit.md` records BMAD module versions + audit run date so it's re-runnable.
  - Audit doc structure: 5 sections (inventory / classification / risks / recommendations / versions).
  - CONFIG.md `_bmad/devx/config-schema.json` path correction lives in this PR (small + cohesive).
  - Devx assumes manual `LESSONS.md` updates instead of `bmad-retrospective` — explicit known gap to wire in Phase 5 (`epic-retro-agent`).

## Focus-group reactions

Skipped — YOLO mode.
