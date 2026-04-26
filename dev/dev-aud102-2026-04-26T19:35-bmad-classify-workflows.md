---
hash: aud102
type: dev
created: 2026-04-26T19:35:00-07:00
title: Classify each BMAD workflow + map to devx command
from: _bmad-output/planning-artifacts/epic-bmad-audit.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx-2026-04-26-aud102
blocked_by: [aud101]
branch: feat/dev-aud102
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
- 2026-04-26T20:30 — claimed by /devx in session devx-2026-04-26-aud102; branch corrected to feat/dev-aud102 (single-branch model per devx.config.yaml git.integration_branch=null).
- 2026-04-26T20:50 — Section 2 (classification table + recommendations + totals) written to `_bmad-output/planning-artifacts/bmad-audit.md`. All 51 skills classified (14 invoke / 0 wrap / 19 escape-hatch / 4 shadow / 14 orphan). TEA wiring map written for aud103 §4. Three forward-pointing notes left for aud103: (1) `/devx-plan` Phase 6 references non-existent `bmad-agent-qa` lens; (2) `bmad-create-epics-and-stories` shadow → wrap evaluation; (3) the TEA-orphan ranking in §3. Self-review fixed 4+1 issues (methodology block didn't define wrap-vs-orchestration boundary; §2.6 intro contradicted with `bmad-teach-me-testing`; §2.7 Phase column ambiguous for `bmad-tea`; backtick consistency). Local CI: cli placeholders pass; mobile/worker untouched.
- 2026-04-26T20:55 — PR #2 opened: https://github.com/LeoTheMighty/devx/pull/2 (target main, head feat/dev-aud102, commit 714828c).
- 2026-04-26T23:26 — merged. mergeStateStatus was CLEAN (no required checks: .github/workflows/ doesn't exist yet — that's dev-ini503's job, downstream of aud103). Squash-merged to main as 2697f54. Worktree + local branch removed. Status: done.
