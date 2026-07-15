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
