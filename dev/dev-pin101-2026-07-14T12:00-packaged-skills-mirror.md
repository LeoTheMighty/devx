---
hash: pin101
type: dev
created: 2026-07-14T12:00:00-07:00
title: Packaged skills mirror + drift guard (skills/, sync script, npm-test lock)
from: plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md
plan: _devx/workstreams/portability-install
status: ready
owner: null
blocked_by: []
branch: feat/dev-pin101
---

## Goal

The skill bodies ship in the npm package: `skills/` = byte-identical copies
of `.claude/commands/*.md`, refreshed by `npm run sync:skills`, locked by a
drift test in the default suite. Phase 1 of workstream
`portability-install` (plan.md § Phase 1).

## Acceptance criteria

- [ ] `scripts/sync-skills.mjs`: copies `.claude/commands/*.md` →
      `skills/*.md`; `--check` mode exits nonzero naming any divergent or
      missing file. `.claude/commands/` is canonical and NEVER written by
      this script (copies flow one way; design.md § Resolved questions —
      copies-not-symlinks, npm pack drops symlinks + gate-bypass hazard).
- [ ] `skills/devx.md`, `skills/devx-plan.md`, `skills/devx-interview.md`
      generated via the script and committed; `package.json → files` gains
      `skills`; `scripts` gains `sync:skills`.
- [ ] `test/skills-packaging.test.ts`: `npm pack --dry-run --json` manifest
      contains 3/3 skill files (subprocess smoke — LEARN cli301 E6).
- [ ] `test/skills-sync.test.ts`: byte-compares each pair; failure names
      the divergent file; part of the default vitest suite.
- [ ] Workstream evals E-1 + E-2 flip GREEN:
      `npx tsx portability-install/evals/E-1_skills-packaging.ts` and
      `…/E-2_skills-sync.ts` (cwd `_devx/workstreams`) exit 0.
- [ ] Full suite green.

## Technical notes

- This story reads `.claude/` but writes only `skills/`, `scripts/`,
  `test/`, `package.json` — no harness gate, normal `/devx` flow.
- RED evidence: `_devx/workstreams/portability-install/evals/RED-report.md`
  (E-1, E-2 right-reason).

## Status log

- 2026-07-14T12:00 — emitted by /devx-plan RED stage (b3f7a1, phase 1/5).
