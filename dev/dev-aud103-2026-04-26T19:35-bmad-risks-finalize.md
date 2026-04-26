---
hash: aud103
type: dev
created: 2026-04-26T19:35:00-07:00
title: Risks subsection + finalize bmad-audit.md
from: _bmad-output/planning-artifacts/epic-bmad-audit.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx-2026-04-26-aud103
blocked_by: [aud102]
branch: feat/dev-aud103
---

## Goal

Author the Risks section (Section 3) of `bmad-audit.md` covering the four findings from Phase 2 research, plus Section 4 (Recommendations for downstream phases) and Section 5 (BMAD module versions + audit date). Commit the complete document.

## Acceptance criteria

- [ ] Risk 1 (TEA orphan): explicit list of every unwired TEA workflow + downstream impact + Phase 5 wiring recommendation
- [ ] Risk 2 (sprint-planning shadow): how `DEV.md`'s continuous flow differs from BMAD's sprint model; note the conflict if a user runs `bmad-sprint-planning` standalone after devx is installed
- [ ] Risk 3 (retrospective gap): note that devx assumes manual `LESSONS.md` updates instead of running `bmad-retrospective`; recommend Phase 5 wiring (`epic-retro-agent`)
- [ ] Risk 4 (UX timing): UX design happens late in devx party-mode (Phase 6) vs. BMAD's Phase 2; flag risk of UX rework + recommend an opt-in `bmad-create-ux-design` invocation in `/devx-plan` Phase 3 for thoroughness=`thorough`
- [ ] Section 4 (Recommendations) summarizes the Phase 5 / Phase 9 wirings each risk implies
- [ ] Section 5 (Versions + date) records `_bmad/_cfg/manifest.yaml` versions + audit run date
- [ ] `_bmad-output/planning-artifacts/bmad-audit.md` complete + committed

## Technical notes

- Update `docs/CONFIG.md § Schema validation` path correction (`_bmad/devx/config-schema.json` → npm-package-embedded) as part of this story's PR; or file as a follow-up MANUAL entry. **Lean: include in this PR — small + cohesive.**

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T23:30 — claimed by /devx in session devx-2026-04-26-aud103; branch corrected to feat/dev-aud103 (single-branch model per devx.config.yaml git.integration_branch=null).
- 2026-04-26T23:38 — Sections 3 (5 risks: TEA orphan, sprint-planning shadow, retrospective gap, UX timing, manifest drift), 4 (wirings + no-new-epic fixes + cross-cutting note), 5 (versions + audit re-run trigger) written to `_bmad-output/planning-artifacts/bmad-audit.md`. CONFIG.md path correction folded in (`_bmad/devx/config-schema.json` → npm-package-embedded). Forward-pointing notes in §1 and §2.6 annotated with resolution markers. Self-review fixed 4 issues: stale forward-pointing-note language, §3.5 cross-ref to non-existent §4.2 row, §4.3 misclassification of `bmad-retrospective`, "single conditional" overstatement in §3.4. Local CI: cli placeholders pass; mobile/worker untouched.
- 2026-04-26T23:41 — PR #3 opened: https://github.com/LeoTheMighty/devx/pull/3 (target main, head feat/dev-aud103, commit 6e83a61). mergeStateStatus CLEAN; no required checks (CI workflow not yet wired by ini503). Squash-merged to main as 82ed445. Worktree + remote/local branches removed. Status: done.
