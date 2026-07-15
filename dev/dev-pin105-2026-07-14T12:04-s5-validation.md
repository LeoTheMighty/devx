---
hash: pin105
type: dev
created: 2026-07-14T12:04:00-07:00
title: S-5 validation — timed scratch scenario + live palateful checklist
from: plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md
plan: _devx/workstreams/portability-install
status: blocked
owner: /devx-2026-07-15T1035-81896
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
- 2026-07-15T10:35:45-06:00 — claimed by /devx in session /devx-2026-07-15T1035-81896
- 2026-07-15T10:40 — phase 2: spec ACs direct (v2 native); 5 ACs; workstream=portability-install; red-artifacts=E-7_s5-palateful.md (human-run checklist — P2 deferred stub legal at RED; scripted half is the timed scratch test). Live half needs the owner on palateful → MANUAL entries per AC 3.
- 2026-07-15T10:52 — phase 3: scripted half implemented — timed scratch scenario in test/init-cli-scaffold.test.ts (<120s budget, margin documented), E-7 audit step aligned with the design contract (find includes the repo path), MANUAL.md MV-pin105.1 filed with the three owner-run steps + the repo-vs-user command precedence observation ask.
- 2026-07-15T10:52 — phase 4: clean review (0 issues; re-ran with stricter framing — confirmed clean; diff is 1 test + checklist alignment + MANUAL entries).
- 2026-07-15T10:52 — phase 5: local CI green — full suite 2127 passed (109 files; was 2126).
- 2026-07-15T10:49 — phase 7/8: PR https://github.com/LeoTheMighty/devx/pull/75 opened, tour published, devx-ci green, hold clear, merge-gate {"merge":true}; merged (squash → f9e4428).
- 2026-07-15T10:50 — scripted half merged via PR #75; spec parks as BLOCKED on MANUAL MV-pin105.1 (owner-run live half on palateful). AC 4 + E-7 Results remain open; workstream outcome scoring (G-1/G-3) and the workstream close wait on them. Do not arm `devx outcome` until the live results land.
