---
hash: ini502
type: dev
created: 2026-04-26T19:35:00-07:00
title: Local file writes (config + backlogs + spec dirs + CLAUDE.md + .gitignore)
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
blocked_by: [ini501, cfg204]
branch: feat/dev-ini502
owner: /devx-2026-04-27
---

## Goal

Implement `src/lib/init-write.ts` — orchestrates all local file writes: `devx.config.yaml`, 8 backlog files (with empty-state headers), spec subdirectories, CLAUDE.md (with markers), and `.gitignore` (managed block).

## Acceptance criteria

- [ ] `init-write.ts` writes `devx.config.yaml` with all 15 sections + `devx_version` field at top + comments-on-inferred + comments-on-asked
- [ ] Creates 8 backlog files (DEV/PLAN/TEST/DEBUG/FOCUS/INTERVIEW/MANUAL/LESSONS) each with empty-state header from `_devx/templates/init/backlog-headers/<NAME>.md.header`
- [ ] Creates spec subdirectories: `dev/`, `plan/`, `test/`, `debug/`, `focus/`, `learn/`, `qa/` (creates `focus-group/personas/` if missing)
- [ ] Writes/updates `CLAUDE.md`: if absent, creates with full template; if present and lacks markers, appends; if present with markers, updates only inside markers
- [ ] CLAUDE.md merge conflict detection: non-devx content found inside `<!-- devx:start --> … <!-- devx:end -->` markers → file 1 INTERVIEW.md entry; do NOT auto-resolve
- [ ] Appends `.gitignore` with `# >>> devx` / `# <<< devx` block; idempotent (re-run skips if block present)
- [ ] All file writes atomic (tmp + rename)
- [ ] Idempotent: existing files never overwritten — touch only if missing
- [ ] Vitest covers: fresh / re-run / CLAUDE.md-merge-conflict / .gitignore-already-managed / partial-existing-backlogs

## Technical notes

- Write order: config → backlogs → spec dirs → CLAUDE.md → .gitignore. config.yaml first so other steps can reference its values.
- Empty-state headers auto-delete when the file holds N≥3 items (logic added later; for now headers persist).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-27T13:00 — claimed by /devx in session devx-2026-04-27 (branch feat/dev-ini502; spec branch field bumped develop→feat per single-branch git config)
- 2026-04-27T13:10 — implementation pushed; PR #23 opened against main; 20 new vitest cases (270 total green locally); self-review surfaced 9 issues, all fixed in-PR
- 2026-04-27T13:12 — merged via PR #23 (squash → 1d98b6c); local + remote feat/dev-ini502 cleaned up
