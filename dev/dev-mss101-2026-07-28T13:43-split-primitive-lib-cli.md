---
hash: mss101
type: dev
created: 2026-07-28T13:43:00-06:00
title: "Split primitive (lib + CLI)"
status: done
from: plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md
plan: _devx/workstreams/mid-story-split
phase: 1
blocked_by: []
branch: feat/dev-mss101
owner: /devx-2026-07-28T1352-33223
---
## Goal

The inert split kernel — pure composer + atomic writer + orchestrator +
`devx split` CLI. Nothing calls it until later phases; it lands first so
both consumers (claim inheritance, loop) build against a merged, tested
seam. Plan phase 1 of workstream mid-story-split.

## Acceptance criteria

- [ ] AC 1: `src/lib/devx/split.ts` exports `SplitPayload` +
      `validateSplitPayload` (title single-line, no `;`/`\n`;
      `remaining_acs` non-empty;
      `carried_forward.{state_to_trust,gotchas,do_not}`), `composeSplit`
      (pure; both shapes per design §Architecture 1: follow-up
      frontmatter/body with `## Carried forward` sections, parent
      `spawned:` append + status-log line, backlog row spliced
      after-parent; branch-handoff additionally strikes the parent row
      `superseded by <hash>` + `status: superseded`), `writeSplitAtomically`
      (claim posture: tmp siblings, capture originals, fixed rename order
      follow-up → parent → backlog, restore-on-partial), and `performSplit`
      (ownership guard → fresh hash → compose → locked atomic write).
- [ ] AC 2: `devx split <hash> --payload <file> --session-token <tok>
      [--shape merge-first|branch-handoff]` registered in `src/cli.ts`;
      exit codes 0 success / 1 backlog-lock contention / 2 other / 3
      ownership mismatch / 64 usage; `--shape branch-handoff` refuses
      unless `git ls-remote --heads origin <branch>` is non-empty.
      `--session-token` is always explicit — no auto-derive.
- [ ] AC 3: `generateHash` exported from `src/lib/engine/workstream.ts`
      with the collision scan widened from `plan/` to all
      `SPEC_TYPE_DIRS`; `insertDevMdRow`
      (`src/lib/plan/emit-retro-story.ts`) generalized with a `type` param
      + insert-after-parent-row anchor.
- [ ] AC 4: `test/devx-split.test.ts` E-1 case group (describe-title
      marker `"E-1:"`) green: merge-first round-trip via `parseBacklog`
      (blocked-by wiring), branch-handoff round-trip (branch recorded,
      parent row struck + `status: superseded`), injected rename failure
      leaves DEV.md byte-identical (0 changed bytes), ownership-mismatch
      refusal exits 3, all carried-forward section headings present —
      ≥6 cases, 0 failures.
- [ ] AC 5: eval
      `_devx/workstreams/mid-story-split/evals/E-1_split-roundtrip.ts`
      flips GREEN (re-run it RED first, per its failure list); `npm test`
      (typecheck included) green; the E-5 eval wrapper remains RED
      (feature lands in phase 2).

## Technical notes

Design: `_devx/workstreams/mid-story-split/design.md` §Architecture 1.
Rollback posture mirrors `claimSpec` capture-originals / restore-on-partial
(`src/lib/devx/claim.ts:632-691`); `withBacklogLock` bodies stay
synchronous (`src/lib/backlog/mutate.ts:82`). Ownership guard:
`specLockOwnedBy` (`src/lib/devx/spec-lock.ts:462`) +
`parseLockOwner`/`normalizeSessionToken` (`verify-claim.ts:141,126`).
`superseded` vocabulary is parser-free reuse (`src/lib/backlog/parse.ts:30-36,186-190`;
settled-blocker allowlists `src/lib/next/gather.ts:254-260`,
`src/lib/manage/reconcile.ts:466-472`). Row shape: retro-row pattern
(`emit-retro-story.ts:150`); merge-first follow-up branch via
`deriveBranch` (`src/lib/plan/derive-branch.ts:49`).

## Status log

- 2026-07-28T13:43 — emitted by /devx-plan (RED gate passed; workstream
  mid-story-split, plan phase 1).
- 2026-07-28T13:54 — phase 2: spec ACs direct (v2 native); 5 ACs;
  workstream=mid-story-split; red-artifacts=evals/E-1_split-roundtrip.ts
  (re-ran RED in worktree: 4 named missing-feature failures, right-reason).
- 2026-07-28T14:14 — phase 3: implemented split.ts (payload/compose/atomic
  write/performSplit) + devx split CLI + generateHash export/widen +
  insertDevMdRow type/anchor generalization; E-1 eval GREEN, E-5 stays RED,
  full suite 2441 passed (help snapshot refreshed for the new command row).
- 2026-07-28T14:35 — phase 4: 3-agent parallel adversarial review (Blind
  Hunter + Edge Case Hunter + Acceptance Auditor); 13 findings (4 MED, 9
  LOW; auditor: all 5 ACs met, 0 blocking); 11 fixed in-place — most
  load-bearing: backlog-row marker collision (a payload title carrying
  `Status:`/`Blocked-by:` hijacked parseDevMd's first-match markers on the
  composed row → now rejected at validate), plus backslash-title YAML
  corruption, canonical-root guard (mlc101 R1 class), after-parent anchor
  false-positive; 2 accepted with justification (takeValue `--` convention
  matches runClaim repo-wide; blocked_by []/owner null shapes test-pinned);
  re-review + 13/13 tests + E-1 GREEN clean.
- 2026-07-28T14:46 — phase 5: local CI green — typecheck + full vitest
  (125 files, 2440 tests) post-fixes; E-1 GREEN, E-5 RED (right-reason).
- 2026-07-28T14:57 — phase 7: PR opened
  https://github.com/LeoTheMighty/devx/pull/95 (body via devx pr-body, no
  unresolved placeholders); phase 7.5: tour published (7 stops, 6 decisions,
  trail A grep-verified) — body updated with tour link.
- 2026-07-28T15:00 — merged via PR #95 (squash → ec3af6e); remote CI
  devx-ci success (run 30397722313); worktree removed.
- 2026-07-28T13:52:42-06:00 — claimed by /devx in session /devx-2026-07-28T1352-33223

## Links

- Plan: `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md`
- Workstream: `_devx/workstreams/mid-story-split/` (prd/design/plan/evals)
