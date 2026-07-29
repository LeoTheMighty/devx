---
hash: mlcret
type: dev
created: 2026-07-28T09:04:23-06:00
title: Retro + LEARN.md updates (interim retro discipline)
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
status: in-progress
owner: /devx-2026-07-29T0932-37184
blocked_by: [mlc101, mlc102, mlc103, mlc104, mlc105, mlc106]
branch: feat/dev-mlcret
---

## Goal

Run the native retro stage (`/devx retro` — the `## Stage: Retro` section of `.claude/commands/devx.md`) on epic-multi-loop-concurrency; append findings to `LEARN.md § epic-multi-loop-concurrency`.

## Acceptance criteria

- [ ] `/devx retro` stage run against shipped stories (mlc101, mlc102, mlc103, mlc104, mlc105, mlc106).
- [ ] Findings appended to `LEARN.md § epic-multi-loop-concurrency` (create section if absent).
- [ ] Each finding tagged `[confidence]` (low/med/high) + `[blast-radius]` (memory/skill/template/config/docs/code).
- [ ] Low-blast findings applied in retro PR.
- [ ] Higher-blast findings filed as MANUAL.md or new specs.
- [ ] Cross-epic patterns hitting ≥3 retros total promoted into `LEARN.md § Cross-epic patterns`.

## Technical notes

- Sunset per Phase 5 epic-retro-agent + epic-learn-agent.
- Emitted by `/devx-plan` Phase 5 (pln102) at planning time — mode=YOLO, shape=empty-dream, thoroughness=send-it (provenance; the retro itself runs under whatever mode is active at /devx claim time).

## Status log

- 2026-07-28T09:04:23-06:00 — created by /devx-plan
- 2026-07-29T09:32:58-06:00 — claimed by /devx in session /devx-2026-07-29T0932-37184
- 2026-07-29T09:5x — phase 2: spec ACs direct (v2 native); 6 ACs;
  workstream=multi-loop-concurrency (Stage: Retro); red-artifacts=none
  (retro stage has no RED gate). Evidence base reconstructed FROM DISK per
  the retro contract, not from memory: six spec status logs, `gh pr view`
  metadata for PRs #91–#100, `git log` merge timestamps, live
  `.devx-cache/locks/` + `loop/instances/` contents, `_devx/workstreams/
  multi-loop-concurrency/{prd,expectations,todo}.md`, and the installed
  CLI's own `--help`/`dist/` state.
- 2026-07-29T10:2x — phase 3: retro executed. Wrote
  `_devx/workstreams/multi-loop-concurrency/RETRO-2026-07-29.md`; promoted
  `LEARN.md § multi-loop-concurrency` (E1–E10, superseding the three PR #92
  `/devx-learn` candidates C1–C3 → E8/E9 + C3 folded into the Cross-epic
  3-agent row); appended evidence to FOUR Cross-epic rows
  (externalize-as-CLI-primitive 5th epic; 3-agent review 6th epic;
  first-real-run **extended** to require the INSTALLED artifact; and
  generalized "attended-era contracts break on first unattended contact" →
  **"single-actor-era contracts break on first multi-actor contact"** on
  2nd concordant retro, since mlc's second actor was a concurrent
  interactive session, not an unattended loop). Filed `dev-b931a1`
  (merge-tail `finalize` primitive) + DEV.md row; filed MANUAL `MV-mlc.1`
  (E-7 real night, G-2's only evidence). Applied low-blast: plan-20eb6f
  frontmatter `ready`→`done` + `stage: executing`→`done` (the drift
  `devx next` was reporting), PLAN.md row reconciled, outcome armed →
  2026-08-31 via `devx outcome arm 20eb6f`.
- 2026-07-29T10:4x — phase 4: single-pass adversarial self-review (prose
  surface — ~700 lines of markdown, no code/regex/marker changes, so below
  the 3-agent threshold; the adversarial frame used was "a retro's only
  value is that its claims are TRUE — verify every number and causal claim
  against primary evidence"). 3 findings, ALL fixed in-place: (MED) the
  "eleven PRs alternating between two live interactive sessions" attribution
  was wrong — the window held eleven PRs (#91–#101) across TWO epics plus a
  concurrent `/devx-learn` run plus a third session on lpf101; corrected in
  both the retro and the LEARN section header. (MED) an unqualified "no lost
  backlog update, no corrupted DEV.md, no claim collision, no spec-lock
  stomp" claim was an absence-of-evidence assertion stated as an audit
  result; rewritten to say so explicitly. (LOW→load-bearing) the retro
  under-counted the bookkeeping-tail defect class — mss103's status lines
  appended after `## Links` redded main for every PR branched off it and
  cost mlc106 an inherited-red investigation cycle (`fb7561f`), making
  THREE tail defects in the window vs zero in the converted paths; added to
  E1 in both files and promoted into a `dev-b931a1` AC (append under
  `## Status log`, not EOF). Arithmetic re-verified independently: +8,388/
  −794 across 70 files, ~88 findings / 10 HIGH, 3-agent peer median 16 —
  all confirmed. Re-review clean.
- 2026-07-29T10:5x — phase 4 (cont.): mid-retro discovery — a peer
  `/devx-learn` session was concurrently editing MAIN's working tree with
  the prose+test half of finding E1 (explicit-pathspec rule in Phase 8 of
  both skill-body copies + `devx-skill-phase8-discipline` assertions
  pinning `never git add -A` in BOTH Phase 6 and Phase 8; their note
  records the sweep as having happened TWICE). Uncommitted at the time, so
  recorded as in-flight rather than merged, and `dev-b931a1` gained an
  explicit "do not duplicate the in-flight prose corrective" scope note.
  Their work was NOT touched. This is itself the epic's subject matter
  happening live — two sessions independently finding one defect within
  hours.
- 2026-07-29T11:1x — phase 5: local gate green on the pre-merge tree —
  `npm test` 130 files / 2,656 tests passed, exit 0 (verified from the
  "Test Files … passed" summary, not the exit code, per
  `feedback_never_kill_the_gate.md`). Duration 1,569s. No test delta: this
  item is markdown-only.
- 2026-07-29T11:2x — phase 5/6 (cont.): CORRECTION to the phase-4 line
  above — the peer corrective is no longer in-flight. It **merged as PR
  #102** (`8bd514e`) while this retro was mid-run, and `dev-ee7049`
  (`78a10b6`, guarded release-lock CLI) was filed independently from the
  mss104 gap sweep. Merged `origin/main` into `feat/dev-mlcret`; the sole
  conflict was LEARN.md and it was resolved SEMANTICALLY, not by ours/
  theirs: origin's Dogfood-mid-epic row (mss104 shape-(c) successor
  amendment) and mlcret's first-real-run row (INSTALLED-artifact
  extension) are DIFFERENT rows, so both were kept and each row's other
  side discarded. Verified post-resolve: 0 conflict markers, exactly one
  Dogfood row, no duplicated cross-epic rows. Reconciled the retro
  artifact + LEARN E1/E3 + `dev-b931a1` + its DEV.md row against both
  facts — #102 recorded as merged (plus the two adjacent repairs it made
  that this retro had MISSED: Phase 8's after-merge list was misnumbered
  1,2,3,4,5,7,8,9 with a commit step citing a nonexistent range `(4-6)`,
  and the workstream todo-sync step was absent), and b931a1 rescoped to
  CONSUME ee7049's CLI rather than write a second release path
  (CLAUDE.md "Don't duplicate business logic"). Staged by explicit
  pathspec throughout — the discipline this retro is about.
- 2026-07-29T11:46 — claim ADOPTED by session
  `/devx-2026-07-29T1108-89447` from dead owner
  `/devx-2026-07-29T0932-37184`. `devx devx-helper verify-claim mlcret`
  (tokenless, per roc101) exited 3 `owned-by-other-session`; `ps -p 37184`
  confirmed the owner process is gone, so this is a dead-owner lock, not a
  live peer. Halted and surfaced before any worktree edit; adopted only
  after the user chose to. Lock body rewritten in place (schema 1, this
  session's token, `adopted_from` recording the predecessor); prior body
  backed up to scratch. No shipped CLI adopts a stale claim — `ee7049`
  (`devx devx-helper release-lock`) is filed and unshipped, and a
  post-adoption `verify-claim --session-token` is tautological by
  construction (the token is read back from the lock this session just
  wrote), so neither closes this gap. `b931a1`/`ee7049` should.
- 2026-07-29T11:46 — phase 5 (RE-RUN, merged tree): the predecessor
  session's post-merge gate is why this item was NOT mergeable at adoption
  time — it reported **1 failed / 2664 passed (2665)**, `GATE2_EXIT=1`,
  and the session died before recording it (the phase-5 line above
  describes the PRE-merge tree only). Re-ran the full gate on the merged
  tree `951b4f8`: **131 files / 2,665 tests passed, exit 0**, 882s —
  read from the "Test Files … passed" summary per
  `feedback_never_kill_the_gate.md`, not the exit code. Bisected first to
  rule out a real regression: discipline/prose-budget class (80 tests),
  concurrency class (129), and the six merge-touched files (113) all
  green. The failing test's NAME IS UNRECOVERABLE — the background task's
  output file retained only its 4-line tail. Treated as load-sensitive
  flake (red run 3,155s wall vs 882s green — a far more loaded machine),
  NOT as proof of health; filed a test spec so an unidentified 1-in-2,665
  flake is not silently absorbed.
