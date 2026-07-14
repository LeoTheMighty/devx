---
hash: pin101
type: dev
created: 2026-07-14T12:00:00-07:00
title: Packaged skills mirror + drift guard (skills/, sync script, npm-test lock)
from: plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md
plan: _devx/workstreams/portability-install
status: done
owner: /devx-2026-07-14T1116-78325
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
- 2026-07-14 — phase 2: spec ACs direct (v2 native); 6 ACs; workstream=portability-install; red-artifacts=E-1,E-2 (re-ran both in worktree — RED for the right reason: skills/ absent, drift test absent).
- 2026-07-14 — phase 3: implemented scripts/sync-skills.mjs (one-way sync + --check; exported diffMirror/syncMirror), generated skills/{devx,devx-plan,devx-interview}.md via the script, package.json files+=skills scripts+=sync:skills, test/skills-sync.test.ts (14 tests) + test/skills-packaging.test.ts (4 tests, real pack manifest). E-1 + E-2 flipped GREEN.
- 2026-07-14 — phase 4: single-pass adversarial review (surface ~330 hand-written LoC, under 3-agent threshold per pln104 heuristic); 2 findings (1 MED: unknown CLI arg fell through to write mode — now exits 2 with a pinning test; 1 LOW: non-recursive listing, acceptable on flat layout, noted in PR); ALL fixed in-place; re-review clean, 19/19 suite tests green.
- 2026-07-14 — phase 5: local gate green — schema/config/build/typecheck + vitest 2052 passed; only red file was test/tour-render.test.ts (stale node_modules missing diff2html, dep since v2t101; npm install repaired, file re-run green — environmental, not this diff).
- 2026-07-14 — phase 7: PR https://github.com/LeoTheMighty/devx/pull/69 (body via devx pr-body, zero unresolved placeholders); tour published https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/pin101/tour.html.
- 2026-07-14 — phase 8: remote CI success (run 29354167937); check-hold clean; merge-gate {"merge":true}; merged via PR #69 (squash → 33d236c).
- 2026-07-14T11:16:52-06:00 — claimed by /devx in session /devx-2026-07-14T1116-78325
