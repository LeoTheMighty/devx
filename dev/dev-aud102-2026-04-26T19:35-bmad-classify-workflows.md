---
hash: aud102
type: dev
created: 2026-04-26T19:35:00-07:00
title: Classify each BMAD workflow + map to devx command
from: _bmad-output/planning-artifacts/epic-bmad-audit.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
blocked_by: [aud101]
branch: develop/dev-aud102
---

## Goal

For every workflow listed in aud101's inventory, assign exactly one classification (`invoke`, `wrap`, `escape-hatch`, `shadow`, `orphan`) and the devx command (if any) that does so. Write Section 2 of `bmad-audit.md` (classification table).

## Acceptance criteria

- [ ] Every workflow has exactly one classification
- [ ] Each `invoke` or `wrap` entry names the devx command + the phase that calls it
- [ ] Each `shadow` entry names what devx replaced the workflow with (e.g., `bmad-sprint-planning` → `DEV.md` continuous flow)
- [ ] Each `orphan` entry tagged with a recommended target phase (e.g., TEA workflows → Phase 5 `epic-devx-test-layer-1`)
- [ ] Recommendations subsection lists every TEA workflow with the Phase 5 epic that should wire it
- [ ] Section 2 of `bmad-audit.md` complete

## Technical notes

- Reference Phase 2 research findings (loaded into context during this `/devx-plan` run) for the initial classification draft.
- Don't write the risks subsection here — that's aud103.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
