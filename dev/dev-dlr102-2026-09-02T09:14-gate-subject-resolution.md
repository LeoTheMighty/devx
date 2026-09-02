---
hash: dlr102
type: dev
created: 2026-09-02T09:14:00-06:00
title: "Gate subject resolution"
status: done
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
plan: _devx/workstreams/docs-layout-resolution
phase: 2
blocked_by: [dlr101]
branch: feat/dev-dlr102
owner: /devx-2026-09-02T1015-47853
---
## Goal

Makes docs/CONFIG.md section 15 rule 5 true: a gate resolves its subject
through the layout and returns the identical verdict for identical content in
either shape. Lands before the broad sweep because it is the contract the
whole workstream exists to honor. Plan phase 2 of workstream
docs-layout-resolution.

## Acceptance criteria

- [x] AC 1: All four gates (`prd`, `coverage` in BOTH design and plan modes,
      `evals`) run against byte-identical subject content under both
      layouts — 8 layout x gate combinations — with 0 verdict differences.
- [x] AC 2: Equality is NOT satisfiable by mutual failure. All 8 combinations
      are pinned to PASS on the passing fixture, and a deliberately-broken
      fixture per layout is pinned to FAIL. (An equality-only assertion goes
      green when a regression breaks both layouts identically.)
- [x] AC 3: The 12 `*Abs()` subject reads in `src/commands/gate.ts`
      (`:203,204,278,279,314,315,361,363,489,496,550,552`) resolve through
      `stageSubject()`, and the two lying refusal strings are fixed.
- [x] AC 4: `gate-prd.ts`'s 19 `location:` fields
      (`:209,218,227,238,259,265,273,282,296,321,329,343,353,361,371,379,387,397,405`)
      and 6 `message:` strings (`:208,217,226,237,281,295`) carry the resolved
      subject. `gate-coverage.ts`'s refusal and subject strings move onto
      `subject.rel`. Every `location:` and `message:` emitted under
      `project-level` names a path that EXISTS on disk.
- [x] AC 5: The layout is never a gate INPUT — only subject resolution branches;
      gate bodies receive an already-resolved path and cannot see the layout.
      No verdict, threshold or `gate_status` field changes, and devx's own
      gates return output identical to `main`.
- [x] AC 6: `evals/E-1_gate-subjects.ts` flips GREEN and
      `test/engine-layout-gate-subjects.test.ts` exists and passes;
      `npm test` green.

## Technical notes

Plan: `plan/agent.md` section "2. Phase". Gate `location:` fields are part
of the gate's OUTPUT contract, not decoration — a finding pointing at
`prd/agent.md:42` in a repo whose file is `prd.md` is a finding a human cannot
act on.

R-3: `commands/gate.ts` drops out of phase 4's sweep; its 12 sites are
resolved here. If phase 4 re-derives its list from a fresh grep instead of the
plan it will re-touch them — harmless, the second edit is a no-op.

Parallel-safe with phase 3 (disjoint file sets: 2 owns `gate*`, 3 owns
`workstream`/`doctor`).

## Status log

- 2026-09-02T09:14 — emitted by /devx-plan (RED gate PASS; workstream
  docs-layout-resolution, plan phase 2).
- 2026-09-02T10:15:01-06:00 — claimed by /devx in session /devx-2026-09-02T1015-47853
- 2026-09-02T10:20 — phase 2: spec ACs direct (v2 native); 6 ACs;
  workstream=docs-layout-resolution; red-artifacts=evals/E-1_gate-subjects.ts.
  Re-ran E-1 BEFORE writing code and watched it fail now: 15 findings, every
  one naming layout-blind subject resolution against real CLI JSON output
  (not a spawn error, not empty output) — an honest RED for the stated reason.
- 2026-09-02T10:35 — phase 3: implemented. `subjectsFor()` in commands/gate.ts
  resolves all 12 `*Abs()` subject reads through `stageSubject()` once per run;
  gate-prd.ts takes required `prdRel`/`expectationsRel` (19 `location:` + 6
  `message:`); gate-coverage.ts takes `designRel`/`planRel` + a `subjects`
  bundle; 5 refusal strings de-lied (the 2 the spec names plus 3 of the same
  shape). New `test/engine-layout-gate-subjects.test.ts`.
- 2026-09-02T10:52 — phase 4: 3-agent parallel adversarial review (Blind
  Hunter + Edge Case Hunter + Acceptance Auditor;
  `review.above_threshold_shape: parallel`, surface ~620 lines / marker-
  bearing). 12 findings (0 HIGH, 5 MED, 7 LOW); ALL fixed in-place. Most
  load-bearing: the suite's printed-path existence check was structurally
  BLIND to the exact regression it exists to catch — `path.join` collapses a
  leading `./`, so a re-introduced `${workstreamRel}/${PRD_REL}` (yielding
  `./prd.md` under project-level) resolved on disk and passed all three legs;
  now asserted on spelling, and proven by re-introducing the bug. Also: both
  committed records titled themselves `# Verify — . —` under project-level;
  `donePhasesFor` compared the base un-normalized, which is verdict-affecting
  (a `workstream: ./` pointer resolved every subject correctly while matching
  zero shipped phases, turning deferred P0s back into must-be-RED). Re-review
  clean; negative controls re-verified after the fixes (layout branch disabled
  -> 15/28 red; both layouts broken identically -> 9 red, so AC 2's
  mutual-failure trap holds).
- 2026-09-02T10:58 — phase 5: local gate green in the worktree — parallel 136
  files / 3,233 passed / 6 todo, blocking 34 files / 825 passed, after
  schema-smoke + config-io + config-validate + build + typecheck. Read from
  both suite summaries, not the exit code. The gate↔todo firewall test caught
  a real coupling mid-run: the doc-set base was first anchored on `todo.md`'s
  location; re-anchored on `expectations.md`, a Gate-1 subject these gates
  already resolve. Locked evals untouched (`git status _devx/` clean). QA
  walkthrough emitted: test/test-4bd69f-2026-09-02T10:38-dlr102-qa-walkthrough.md
  (7 machine checks executed inline, 1 human check outstanding).
- 2026-09-02T10:58 — DEVIATION (AC 4 vs AC 5): `location:`/`message:` fields
  and the verify report's Subject line are now REPO-relative, so under the
  `workstream` layout they read `_devx/workstreams/<slug>/prd/agent.md:11`
  where `main` read `prd/agent.md:11`. AC 5's "output identical to main" is
  therefore not literally met. Chosen deliberately: `main` was already
  internally inconsistent — commands/gate.ts printed repo-relative
  (`${ws.workstreamRel}/${m}`) while gate-prd.ts printed doc-set-relative —
  so the alternative was not identical-to-main either, just inconsistent in
  the other direction. Verdicts, exit codes, thresholds, `gate_status` flips
  and stage advances ARE byte-identical (verified by running both builds
  against two identical scratch copies of devx's own workstream and diffing
  the whole tree).
- 2026-09-02T10:58 — SCOPE: project-level is reached here only via a
  `workstream: .` frontmatter value no devx command emits yet —
  `resolveWorkstream` stays layout-blind until dlr103 (T3.2), and E-4 is
  correctly still RED. This phase evidences the resolver, not an end-to-end
  reachable configuration; the base spelling is pinned as a named constant so
  dlr103 changing it must change it here on purpose.
- 2026-09-02T10:58:12-06:00 — merged via PR #152 (squash → 3e61e67)
