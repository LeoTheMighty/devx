---
hash: pin105
type: dev
created: 2026-07-14T12:04:00-07:00
title: S-5 validation — timed scratch scenario + live palateful checklist
from: plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md
plan: _devx/workstreams/portability-install
status: ready
owner: null
blocked_by: [pin103, pin104]
branch: feat/dev-pin105
---

## Goal

Prove S-5 (`v2/00-vision.md`): `devx init` on a non-devx repo yields a
working `/devx` in under two minutes — scripted in the harness, live on
`palateful`. Phase 5 of workstream `portability-install`
(plan.md § Phase 5). Closes G-1/G-3.

## Acceptance criteria

- [ ] `evals/E-7_s5-palateful.md` (workstream) filled in: step↔threshold
      table completed per the design contract (design.md § Migration
      plan) — timed init, symptom→merged-fix, `devx loop --max-items 1`,
      out-of-repo write audit via `find … -newer <stamp>`.
- [ ] Timed scratch scenario in `test/init-cli-scaffold.test.ts`: fresh
      fixture init completes < 120s (generous CI margin documented in the
      test).
- [ ] MANUAL.md entries filed for the owner-run steps (timed palateful
      init; bug pick; `/devx` render check) — designed signal, not
      blockers hidden in prose.
- [ ] Live run executed on `palateful` (owner present): results recorded
      in `evals/E-7_s5-palateful.md` § Results + this spec's status log.
      Thresholds: < 120s to dispatcher; 1 merged PR; 1 morning report;
      audit clean (only `~/.devx/` outside the repo).
- [ ] Full suite green.

## Technical notes

- The live half needs the owner at the keyboard (Claude Code on
  palateful) — schedule via MANUAL.md; the scripted half merges without
  it, but the workstream's outcome scoring (`devx outcome`, G-1/G-3)
  waits for the live results.
- Unresolved design question to settle during the live run: repo-level
  vs user-level `/devx` command precedence when both exist (design.md
  § Unresolved).

## Status log

- 2026-07-14T12:04 — emitted by /devx-plan RED stage (b3f7a1, phase 5/5).
