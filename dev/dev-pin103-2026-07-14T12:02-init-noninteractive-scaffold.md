---
hash: pin103
type: dev
created: 2026-07-14T12:02:00-07:00
title: Bare `devx init` non-interactive scaffold (defaults AnswerProvider + skills install)
from: plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md
plan: _devx/workstreams/portability-install
status: in-progress
owner: /devx-2026-07-15T0854-58427
blocked_by: [pin102]
branch: feat/dev-pin103
---

## Goal

Bare `devx init` scaffolds a working devx repo non-interactively:
`detectInitState()` → defaults AnswerProvider → `runInit()`
(fresh|upgrade) → `installSkills()`. Phase 3 of workstream
`portability-install` (plan.md § Phase 3).

## Acceptance criteria

- [ ] `src/lib/init-defaults.ts`: non-interactive AnswerProvider —
      stack-derived answers from `detectedStack`/`detectedStackFile`
      (src/lib/init-state.ts:101, detectStack at :248); conservative
      defaults elsewhere; real decisions filed as INTERVIEW.md seeds (the
      same artifact `/devx-init` writes) — no silent product decisions.
- [ ] `src/commands/init.ts`: bare `devx init` runs the scaffold path;
      flags `--global` (skills → `~/.claude/commands/`), `--skip-skills`;
      `--resume-gh` behavior unchanged (regression suite green). Zero new
      write logic — orchestrator + init-write + init-upgrade + init-skills
      do all writes (wrap-don't-duplicate).
- [ ] Re-run on an initialized repo takes the `upgrade` path
      (runInitUpgrade, src/lib/init-upgrade.ts:229): header-bearing skills
      upgraded in place, headerless user-owned files preserved
      byte-identical + MANUAL.md entry.
- [ ] `test/init-cli-scaffold.test.ts`: fresh-repo full-artifact-set
      scenario + re-run idempotency/user-owned scenario, built on the
      ini508 fixture-harness pattern (test/init-e2e.test.ts).
- [ ] Workstream evals E-3 + E-4 flip GREEN
      (`npx tsx portability-install/evals/E-3_init-scaffold.ts`,
      `…/E-4_reinit-idempotent.ts` exit 0).
- [ ] First-real-run rule (LEARN cross-epic): before this PR merges, run
      `devx init` once on a real scratch repo outside the fixtures; every
      surprise recorded as a finding in the status log.
- [ ] Full suite green.

## Technical notes

- E-3's eval asserts: devx.config.yaml + 8 backlogs + dev/ plan/ dirs +
  CLAUDE.md devx block + .github/workflows + 3 header-bearing skills,
  exit 0. Watch it: the eval spawns `node dist/cli.js init` — build before
  running.
- gh-dependent scaffolding follows the existing failure-mode handling
  (init-failure.ts queue) — a repo with no remote must still scaffold
  locally (graceful degradation, ini506 precedent).

## Status log

- 2026-07-14T12:02 — emitted by /devx-plan RED stage (b3f7a1, phase 3/5).
- 2026-07-15T08:54:27-06:00 — claimed by /devx in session /devx-2026-07-15T0854-58427
- 2026-07-15T09:02 — phase 2: spec ACs direct (v2 native); 7 ACs; workstream=portability-install; red-artifacts=E-3_init-scaffold.ts,E-4_reinit-idempotent.ts — re-ran both, RED confirmed (E-3: 16 missing artifacts; E-4: no skills from first init).
- 2026-07-15T09:20 — phase 3: implemented — src/lib/init-defaults.ts (buildDefaultsAsk + appendDeferredDecisions under the 9c4e21 lock family), src/commands/init.ts scaffold path + --global/--skip-skills, init-state precedence fix. E-3 + E-4 GREEN; init suites 73/73.
- 2026-07-15T09:21 — T3.4 first real run (scratch TS repo w/ README + commit, outside fixtures) — findings: (1) README-derived n1 worked, only n2+n3 deferred; (2) ts stack → YOLO + mature-refactor-and-add + single-branch/feat/, no Q32 conflict; (3) ini504 stack seeds + pin103 deferred sections coexist in INTERVIEW.md without clobbering; (4) scaffold leaves all files untracked — first commit is the user's (as designed); (5) SURPRISE caught pre-run by the E-4 vitest scenario: detectInitState treated an uncommitted scaffold as kind=empty (hasCommits checked before devx-on-disk), so re-init re-ran fresh instead of upgrade — precedence fixed in this PR + pinned in init-state.test.ts; the standalone E-4 eval had missed it because it never asserts the mode.
- 2026-07-15T09:45 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor); 15 unique findings (3 HIGH, 6 MED, 6 LOW); ALL fixed in-place — most load-bearing: (a) provider's mode precompute now mirrors the skip table's n7 inference (production-careful → PROD), killing the PROD-config-with-single-branch+initial_n=0 divergence; (b) upgrade arm's supervisor repair pinned off (empirically confirmed host mutation: the unpinned E-4 eval rewrote ~/Library/LaunchAgents/dev.devx.manager.plist at 09:24 — MANUAL entry filed for the user); (c) INTERVIEW/MANUAL bookkeeping moved BEFORE installSkills so a mid-scaffold throw can't strand deferred decisions behind the upgrade path; plus halt recording via onHalt (uncommitted-changes/non-default-branch/q32 all deferred+warned, never silent), conservative shape for commits-without-stack-file, eager-q32 removed (upgrade runs no longer append false INTERVIEW entries), header+older upgrade arm now e2e-tested, degraded-gh --resume-gh hint on stdout, CRLF normalize, userPrefs gap documented; re-review clean.
- 2026-07-15T09:46 — phase 5: local CI green — full suite 2121 passed (108 files; was 2107), typecheck + schema + config-io + config-validate gates green; --help snapshot refreshed for the new init description.
