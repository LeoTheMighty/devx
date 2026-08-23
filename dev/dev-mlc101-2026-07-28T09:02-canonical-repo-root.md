---
hash: mlc101
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Canonical repo root + worktree refusal"
status: done
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: []
branch: feat/dev-mlc101
owner: /devx-2026-07-28T0929-23201
---
## Goal

Every devx process resolves one repo root and one `.devx-cache` via git's
common dir; `devx loop` and `devx manage` refuse to start from a linked
worktree (race R1 dead). Plan phase 1 of workstream multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: `src/lib/repo-root.ts` exports `resolveRepoRoot(cwd)` (git
      `rev-parse --git-common-dir --show-toplevel`) returning `{root,
      cacheDir, isLinkedWorktree}`, unit-tested in `test/repo-root.test.ts`
      (fixture repo + linked worktree).
- [ ] AC 2: `devx loop` and `devx manage` started with cwd inside a linked
      worktree refuse with exit != 0 and an error naming the main checkout
      path; `--allow-worktree-root` (test-only, documented) overrides.
- [ ] AC 3: `src/commands/manage.ts` passes the canonical cacheDir into
      `acquireManagerLock` (no more cwd-relative ".devx-cache" default).
- [ ] AC 4: claim path asserts the passed repoRoot is the canonical main
      root (defense in depth).
- [ ] AC 5: eval `_devx/workstreams/multi-loop-concurrency/evals/E-2_root-canonicalization.ts`
      flips GREEN; `npm test` green.

## Technical notes

Design: `_devx/workstreams/multi-loop-concurrency/design/agent.md` §Architecture 1.
`findProjectConfig` (`src/lib/config-io.ts:43`) stays for config discovery;
the canonical root check wraps it.

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 1).
- 2026-07-28 — phase 2: spec ACs direct (v2 native); 5 ACs;
  workstream=multi-loop-concurrency; red-artifacts=evals/E-2_root-canonicalization.ts
  (re-ran RED: refusal missing + repo-root.ts missing — both fail as expected).
- 2026-07-28T09:29:57-06:00 — claimed by /devx in session /devx-2026-07-28T0929-23201
- 2026-07-28 — phase 3: implemented all 5 ACs — src/lib/repo-root.ts
  (resolveRepoRoot + interpretRevParse), loop/manage worktree refusal +
  --allow-worktree-root, canonical cacheDir → acquireManagerLock, claim-path
  linked-worktree assertion via exec seam; E-2 flipped GREEN. Eval infra fix:
  _fixture.ts resolved tsx via createRequire (worktree runs spawn-failed
  silently with empty output — the pre-fix RED's part (a) was failing for the
  wrong reason); E-1's spawn updated to match, no assertions touched.
- 2026-07-28 — phase 4: 3-agent parallel adversarial review (Blind Hunter +
  Edge Case Hunter + Acceptance Auditor); 10 unique findings (2 HIGH, 1 MED,
  7 LOW); 9 fixed in-place, 1 accepted-by-design (claim probe fail-open on
  indeterminate exec output — the seam contract). Most load-bearing fix:
  linked-worktree discriminator switched from path-shape (basename ==
  ".git") to git-dir != git-common-dir — the first cut misclassified
  submodule and separate-git-dir MAIN checkouts as linked worktrees (false
  refusal + claims hard-blocked with no override). Second HIGH: manage
  passed canonical cacheDir to the lock but not the tick — lock guarded
  universe A while state wrote universe B; both + cwd now plumb through.
  Re-review of fix hunks clean; E-2 still GREEN.
- 2026-07-28 — phase 5: local CI green — cli project: lint (placeholder),
  npm test (typecheck + vitest 122 files / 2,371 tests, exit 0); coverage
  not wired for cli (null runner; YOLO informational anyway).
  workstream-evals project: E-2 GREEN via npx tsx.
- 2026-07-28 — phase 7: PR opened — https://github.com/LeoTheMighty/devx/pull/91
  (body via devx pr-body, no unresolved placeholders).
- 2026-07-28 — phase 7.5: tour published (8 stops, 6 decisions, 3 trails) —
  https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/mlc101/tour.html
- 2026-07-28 — phase 7: CI success — devx-ci (run 30376266400).
- 2026-07-28 — merged via PR #91 (squash → 68646b3). check-hold clean;
  merge-gate {"merge":true}. AC boxes all verified: AC1 repo-root.ts +
  12 tests; AC2 refusal both commands + override; AC3 canonical cacheDir
  (lock AND tick); AC4 claim assertion; AC5 E-2 GREEN + npm test 2,371.

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
