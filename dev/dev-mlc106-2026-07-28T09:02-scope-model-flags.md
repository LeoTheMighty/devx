---
hash: mlc106
type: dev
created: 2026-07-28T09:02:00-06:00
title: "Scope model: epic-aware rows + loop scope flags"
status: done
from: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
plan: _devx/workstreams/multi-loop-concurrency
blocked_by: [mlc105]
branch: feat/dev-mlc106
owner: /devx-2026-07-28T1708-47064
---
## Goal

`devx loop` gains `--epic` / `--workstream` / `--items` / `--exclude` /
`--focus`; DEV.md epic headings become machine-readable row fields; scope
masks (never drops) out-of-scope rows and is surfaced in instance file,
report, and `devx next`; the N=1 degenerate-case sweep closes the
workstream (goals UC-1/2/3, E-8). Plan phase 6 of workstream
multi-loop-concurrency.

## Acceptance criteria

- [ ] AC 1: `parseDevMd` stamps rows with `{epicSlug, epicPlanHash}` from
      `### Epic — {name} (plan: {hash})` headings (additive fields; rows
      above any heading get nulls); `test/backlog-parse-epic.test.ts`.
- [ ] AC 2: `src/lib/loop/scope.ts` — `buildScopeMask(rows, scope)`;
      `--epic` matches slug or plan hash (normalized); `--workstream`
      resolves membership via the extracted frontmatter walk (shared with
      gather, not duplicated); masking uses the existing excluded-set
      mask-to-blocked mechanism so cross-scope Blocked-by edges hold.
- [ ] AC 3: `--items` restricts to the listed hashes AND overrides pick
      order to list order; an in-scope item blocked by an out-of-scope
      unfinished item is reported (event + morning-report line naming the
      blocking hash), never silently skipped.
- [ ] AC 4: `--focus` text lands verbatim in the iteration prompt frame as
      a Specialty directive; scope recorded in the instance file, report
      header, and `devx next` row-1 rendering; malformed scope flags fail
      fast (exit 4) against the parsed backlog.
- [ ] AC 5: eval E-6_scope-semantics.ts flips GREEN; `test/loop-scope.test.ts`
      added; E-8 degenerate-case sweep checklist
      (evals/E-8_degenerate-case.md) fully checked incl. PR-body
      mechanical-update callouts; E-7 live-overnight checklist wired into
      the morning-report Next-steps template; `npm test` green.

## Technical notes

Design §Architecture 6. Blocker status lookup is already global
(`gather.ts:245-253`) — cross-scope edges hold for free.

## Status log

- 2026-07-28T09:02 — emitted by /devx-plan (RED gate passed; workstream
  multi-loop-concurrency, plan phase 6).
- 2026-07-28T17:1x — phase 2: spec ACs direct (v2 native); 5 ACs;
  workstream=multi-loop-concurrency (plan phase 6, tests-first);
  red-artifacts=E-6_scope-semantics.ts (re-run NOW: honest RED — all three
  clauses report feature-absence, the CLI spawned and commander itself
  emitted "unknown option"), E-8_degenerate-case.md + E-7_live-overnight.md
  (deferred checklists, swept at phase exit). E-8 box-3 baseline captured
  BEFORE any edit: bare `devx loop --dry-run` on a 3-item fixture is
  byte-identical between pre-workstream 8b757b8 and mlc105 HEAD.
- 2026-07-28T18:0x — phase 3: T6.1 epic-aware `parseDevMd`
  (`epicSlug`/`epicPlanHash`, additive+OPTIONAL so ~20 hand-built DevRow
  literals in the manage suites keep compiling — zero mechanical test
  churn); T6.2 `src/lib/loop/scope.ts` (buildScopeMask/applyScopeOrder/
  validateScope/describeScope) + membership-walk extraction to
  `resolveSpecWorkstream` in engine/workstream.ts, which gather.ts's
  `resolveWorkstreamGate` now CALLS (walk deleted there, gate output
  byte-identical); T6.3 five flags + fail-fast exit 4 + driver plumb +
  scope in instance file/report header/`devx next` row 1 + Specialty
  directive; T6.4 evals + 2 new test files. Files: parse.ts, loop/scope.ts
  (new), engine/workstream.ts, next/gather.ts, next/decide.ts,
  commands/loop.ts, loop/driver.ts, loop/iteration.ts, loop/report.ts,
  v2/04-overnight-loop.md, skills/devx.md + .claude/commands/devx.md
  (mirror pair, verified identical), test/backlog-parse-epic.test.ts +
  test/loop-scope.test.ts (new).
- 2026-07-28T18:1x — phase 4: 3-agent parallel adversarial review (Blind
  Hunter + Edge Case Hunter + Acceptance Auditor; substantial surface —
  ~1,700 insertions, multi-regex, marker-bearing). 26 unique actionable
  findings (3 HIGH, 11 MED, 12 LOW); ALL fixed in-place. Most load-bearing
  fix: a scope whose dimensions intersected to nothing (`--epic alpha
  --items <hash-in-beta>`, `--items X --exclude X`, `--only dev --items
  <debug-hash>`) passed per-dimension validation and then took the lock,
  registered an instance, spawned nothing, and wrote a report saying "0
  attempted" with no reason — the exact silent-no-op night validateScope
  exists to prevent; now an exit-4 refusal naming "selects 0 of N rows".
  Other HIGHs: `--items` was commander last-wins, so `--items a,b --items
  c` silently discarded `a,b` and ran the wrong set unattended (now
  repeatable + concatenating); E-8 was entirely unswept. Notable MEDs: the
  E-7 pointer + report treatment fired for the PRE-EXISTING `--only` flag
  (now gated on `scopeMasks`); the cross-scope dedupe key included the
  blocker list, so a peer loop landing one of two blockers re-reported the
  same item, and holds were never pruned — a report could list an item as
  merged AND "never started" (now keyed by hash, last-wins, pruned against
  attempted items); an ASCII-hyphen epic heading was not just unrecognized
  but TERMINATED the preceding section, silently orphaning its rows;
  `~~~` fences leaked fake epic headings into real rows; epic names
  truncated at the first ` (` collapsed `Epic — devx (v2) engine` to
  `devx`. Re-review clean. Verification: E-6 GREEN; E-1/E-2/E-3/E-4/E-5
  non-regressed; E-8 4/4 with the dry-run baseline re-diffed post-fix
  (still byte-identical to pre-workstream 8b757b8); all five flags smoked
  against this repo's real 131-row backlog.
- 2026-07-28T17:08:52-06:00 — claimed by /devx in session /devx-2026-07-28T1708-47064
- 2026-07-29T00:20 — phase 5/6/7: local gate green (`npm test` → 130 files /
  2,656 tests / exit 0 on the final merged tree); committed; PR #100 opened
  with a `devx pr-body`-rendered body; review tour built + published.
- 2026-07-29T00:35 — phase 7 CI: FIRST remote run (30410808302) went RED on
  two failures, NEITHER from this diff. (1) `devx-status-log-discipline`
  named mss103: its phase 2/3/4/5 status lines had been appended AFTER
  `## Links`, and the test deliberately bounds its scan to the `## Status
  log` section — so `main` itself was red for every PR built on it. Repaired
  on main in `fb7561f` (pure relocation of five lines; zero status-log text
  rewritten) and merged in. (2) macOS `ENOTEMPTY` rmdir-ing a tmp
  `origin.git` in mss103's own new `test/loop-driver.test.ts` fixture
  teardown — a pre-existing macOS-only teardown race; filed as a debug spec
  rather than fixed here (out of scope). Merged `origin/main` in (mss102 +
  mss103 had landed); mss103 touched driver.ts/iteration.ts/report.ts — the
  same three files — so the merge was verified SEMANTICALLY: typecheck
  clean, every scope call site re-grepped, `--focus` confirmed still ahead
  of the Output contract after mss103 rewrote the prompt frame. Tour anchors
  were recomputed by grep (the merge shifted driver.ts ~500 lines) and the
  builder now derives every `path:line` at build time, so a stale anchor is
  a build-time throw instead of a wrong link. Re-run 30463113330: success.
- 2026-07-29T00:45 — merged via PR #100 (squash → 1cdf435). check-hold
  clean, merge-gate `{"merge":true}`. Closes plan phase 6 and the
  multi-loop-concurrency execute stage; mlcret is now unblocked.

## Links

- Plan: `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md`
- Workstream: `_devx/workstreams/multi-loop-concurrency/` (prd/design/plan/evals)
