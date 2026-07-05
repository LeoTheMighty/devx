---
hash: v2d101
type: dev
created: 2026-07-05T13:05:00-06:00
title: V2.4 — universal /devx dispatcher + debug loop + init v2
from: v2/06-phases.md
plan: v2/
status: in-review
owner: /devx-2026-07-05T1247-2860
blocked_by: [v2x101]
branch: feat/dev-v2d101
---

## Goal

`/devx` becomes the only command: state-driven next-action routing + free-text
intent classification + first-class debug loop + any-repo init. Per
`v2/05-dispatcher.md`.

## Acceptance criteria

- [ ] `devx next` v2: full 12-row first-match decision table (§2) over
      backlogs, spec frontmatter, open PRs + CI, `.devx-cache` state;
      `--prefer plan` flag; unit-test matrix covering every row + ordering
      (S-4).
- [ ] Dispatcher skill body (user-foreground): entry forms (§1), intent
      classification (§3: bug/small-feature/large-feature/question/review),
      stage-skip recording (`entered_at:`, D-8), morning-review-on-first-run
      hook, `/devx-plan` aliased into the stages.
- [ ] Debug loop (§4): DEBUG.md consumer; debug spec shape (repro-first =
      RED for bugs; root-cause evidence in status log); fix via execute tail;
      learnings → LEARN candidates.
- [ ] `devx init` v2: engine templates + `engine:`/`loop:` config in
      scaffold; no BMAD anywhere; fresh-repo e2e test (ini508 harness
      extension) proving S-5: init → `devx next` → correct first action on
      an empty repo.
- [ ] Backlog↔frontmatter reconcile drift is a reported defect in `devx next`
      output (not silently fixed).
- [ ] Full suite green.

## Technical notes

- Decision table lives in the CLI (pure fn); skill renders its output — the
  8am-harness `next_command()` move. Rows 1–8 need the manager/loop state
  shapes from mgr102; loop-row (#1) degrades gracefully until v2l101 lands.

- Inherited from v2x101: `devx plan-helper validate-emit` still resolves
  epics only under `_bmad-output/planning-artifacts/` (frozen); for v2
  workstream slugs it soft-exits 2 (route-to-user, no abort). Retarget it
  to `_devx/workstreams/<slug>/plan.md` (or fold into `devx next`
  emission checks) as part of the dispatcher work.

## Status log

- 2026-07-05T13:05 — created from v2/06-phases.md § V2.4.
- 2026-07-05T12:47:47-06:00 — claimed by /devx in session /devx-2026-07-05T1247-2860
- 2026-07-05T12:55 — phase 2: spec ACs direct (v2 native); CLI/library scope in this worker (skill-body routing/§1/§3 + morning-review hook run in the coordinating session). v2/05-dispatcher.md §2 read as the source of truth for the 12-row table; v1 `nextForWorkstream` (rows 9–12 of the v1 stage table) reused verbatim for row 9; mgr102 heartbeat readers + mgr103 backlog parser + roc101 verify-claim semantics + pln103 validate-emit all wrapped, not duplicated.
- 2026-07-05T13:42 — implementation: `devx next` v2 — new `src/lib/next/decide.ts` (pure 12-row first-match table over a RepoSnapshot; `--prefer plan` flips 8/9 evaluation keeping canonical row numbers; drift REPORTED never fixed) + `src/lib/next/gather.ts` (IO gatherer with fs/exec/now/sessionToken seams: heartbeat + v2l101 loop-state probe w/ freshness, gh PR+CI rollup folding, lock-ownership, workstream evals_red gate chain via `workstream:`/`from:`/`plan:`, mid-pipeline scan, overnight-report probe) + `src/commands/next.ts` dual-form CLI (JSON `{row, action, command, detail, drift, warnings, overnight_report}` on stdout + human line on stderr; v1 `<hash>` form byte-identical). Debug loop: `claimSpec`/`flipDevMdRow`/`findSpecForHash`/`verifyClaim` extended to debug-type specs (DEBUG.md row flip, `.worktrees/debug-<hash>`, `feat/debug-<hash>`); `devx devx-helper claim|verify-claim --type debug`. validate-emit retargeted: `_devx/workstreams/<slug>/plan.md` resolves FIRST (frozen `_bmad-output/` epic fallback; `source`/`triedPaths` in result; `parsePlanStoryHashes` = checklist `(dev spec: <hash>)` markers + Execution-tracker refs, fence-stripped; retro-trifecta skipped in plan mode per D-3; check names stable). S-4 matrix: `test/next-dispatch.test.ts` (79 tests — every row in isolation, 1→12 strip-down chain, pairwise cartesian ordering, prefer-plan flip, gatherer + CLI layers). S-5: ini508 harness extension (init → `devx next` → row 12; seeded PLAN.md item → row 10 `/devx prd <hash>`, zero BMAD). +~107 net tests (1627 → 1741 excl. coordinator's discipline pins); typecheck + E-1/E-2 green.
- 2026-07-05T13:55 — phase 4: 3-agent parallel adversarial review (Blind Hunter 10 / Edge Case Hunter 14 / Acceptance Auditor 7 findings; ~19 unique actionable, all fixed): (1) HIGH struck-row blockers diverged from mgr103 reconcile — struck rows now feed blocker resolution (deleted/superseded = settled) so dispatcher and manager agree; (2) HIGH+MED crash-orphaned `loop/state.json` `status:"running"` and future-dated heartbeats wedged row 1 forever — |now−ts| freshness window on both probes (mgr106 stale-PID lesson); (3) MED case-sensitive status compare → `status: Done` row-4 livelock — lowercased at the seam; (4) MED PLAN.md done-mismatch emitted unclaimable `/devx <plan-hash>` — plan specs are drift-report-only, row 4 is execute-arm-only; (5) MED row-5/row-3 commands structurally failed for debug claims/PRs — verify-claim command gains `--type debug` + is verbatim-executable (no placeholder), row 3 routes non-dev PRs through `/devx <hash>` (merge-gate resolves dev/ only); (6) MED overnight report unreachable when loop dead — surfaced on EVERY decision (`overnight_report` field + human-line nudge); (7) MED other-session claims + unreadable backlog files vanished into "genuinely empty" — both warn now; (8) MED parsePlanStoryHashes counted fenced examples + Files-bullet/cross-workstream refs as stories — fence-stripped (blankFencedLines reuse) + pass 2 restricted to Execution-tracker lines; (9) unreadable-spec ready rows de-routed (no fail-open gate); orphan-claim boundary regex (trailing text counts, `backup_devx/` suffix collision doesn't); flag-value swallowing (`--session-token --no-gh`) rejected across next + devx-helper; workstream form rejects repo-level flags; `(default)`-shape null-workstream detail fallback; garbled comment fixed; verify-claim debug seam test-covered. Documented-not-changed (accepted v1 bounds, in decide.ts comments): row 3 fires on ci "none" (merge-gate re-verifies), pending-CI PRs fall through (no §2 row), row 9 includes done-but-unscored workstreams. Re-ran: typecheck + full vitest (87 files / 1741) + E-1 + E-2 green.
- 2026-07-05T13:20 — coordinator slice: devx.md rewritten as the universal dispatcher (routing via devx next, intent classification, Stage: Debug repro-first, morning-review rule) + devx-dispatcher-discipline pins (7). Live smoke on the real repo: row 8 → /devx a10001 correct; drift detection surfaced 13 real pre-existing inconsistencies (12 v1-era PLAN.md status vocab mismatches + 1 vantage bound: worktree-local .devx-cache hides main's locks from in-worktree `devx next` runs — dispatcher normally runs from the main worktree; documented).
