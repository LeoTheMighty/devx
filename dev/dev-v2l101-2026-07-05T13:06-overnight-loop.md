---
hash: v2l101
type: dev
created: 2026-07-05T13:06:00-06:00
title: V2.5 — overnight loop (gnhf fold-in)
from: v2/06-phases.md
plan: v2/
status: in-review
owner: /devx-2026-07-05T1350-57819
blocked_by: [v2d101, roc101]
branch: feat/dev-v2l101
---

## Goal

`devx loop`: trusted unattended operation — gnhf's iteration contract +
failure ladder + hang immunity bolted onto the manager. Per
`v2/04-overnight-loop.md`.

## Acceptance criteria

- [ ] Inner iteration contract: prompt frame (§2.2 — smallest verifiable
      slice, read status log first, report-don't-pivot, no commits/log edits
      by the worker), structured report schema
      `{success, summary, key_changes_made, key_learnings, acs_met}`
      validated with retry; control flow branches only on the object.
- [ ] Transactional outcomes: success → loop commits + appends status-log
      entry (Summary/Changes/Learnings); failure → `reset --hard` +
      `clean -fd` + `[FAIL]` entry; no-op detection = failure; commit-failure
      → preserve + bounded repair iteration.
- [ ] Failure ladder (§3): reported→continue / hard-error→backoff
      `[60s,120s,240s]` / permanent-error→abort-loop-now / 3-consecutive →
      abandon item (release claim, `[-]` blocked, preserve worktree, print
      path) / 3 abandoned items → stop loop.
- [ ] Budgets: `loop:` config (max_iterations_per_item, max_tokens_per_item,
      max_consecutive_failures, max_items, max_total_tokens, backoff_ms) +
      `--until <time>`; checked pre-claim and pre-iteration; mode-aware
      (LOCKDOWN disables loop entirely, D-6).
- [ ] Hang immunity: `GIT_TERMINAL_PROMPT=0` on every loop git call;
      `-c commit.gpgsign=false -c tag.gpgsign=false`; argv-array exec with an
      injection regression test; push never forces/pulls, push-failure aborts
      item after preserving commit; worker grace-kill ~15s post-report.
- [ ] `devx loop` entry on the manager (reuses mgr101–106 + roc101
      verify-claim in worker bootstrap); sleep-inhibit re-exec in the
      supervisor entrypoint (sup40x dispatch).
- [ ] JSONL lifecycle log in `.devx-cache/loop/<run-id>/`: per-iteration git
      snapshot (head/branch/commit-count), error.cause chains.
- [ ] Morning report (§5): report.md with items
      attempted/merged/abandoned/blocked, iteration + token stats, per-item
      tour links + diff stats, next-step commands. Morning-review discipline
      in the skill body (reconstruct-from-disk rule).
- [ ] Chaos test: kill -9 mid-iteration ⇒ resume leaves zero residue
      (worktree clean or preserved-with-commits, never half).
- [ ] Supervised-night AC (S-3) runs post-merge as MANUAL.md item.
- [ ] Full suite green.

## Technical notes

- Absorbs plan-c4f1a2's restart-from-status-log scope (falls out of the
  iteration contract). Loop completion is not acceptance (D-11): merge-gate
  + CI remain the only path to main.

## Status log

- 2026-07-05T13:06 — created from v2/06-phases.md § V2.5.
- 2026-07-05T13:50:00-06:00 — claimed by /devx in session /devx-2026-07-05T1350-57819
- 2026-07-05T14:05:00-06:00 — phase 2 (working artifacts): spec ACs direct (v2 native, no story file); design source `v2/04-overnight-loop.md` read in full + D-6/D-11 + gnhf reference mechanisms (orchestrator/iteration-prompt/git/run/exit-summary/sleep) studied for shapes, not code.
- 2026-07-05T14:40:00-06:00 — phase 3 (implement): 11 new modules under `src/lib/loop/` (config, iteration, git-tx, ladder, state, spec-io, report, tail, worker, driver, sleep-inhibit) + `devx loop` CLI (`src/commands/loop.ts`, registered in cli.ts) + 2 exports widened in `src/lib/manage/loop.ts` (replaceFrontmatterStatus, flipDevMdCheckbox — wrap-don't-duplicate). 12 new test files (~170 tests): ladder truth table, iteration-prompt pins, report-schema recovery, git-tx injection regression, driver scenarios on real git fixtures (bare origin + clone), chaos kill-9 pair, morning-report golden, sleep-inhibit, CLI surface. Loop state aligned byte-level with `src/lib/next/gather.ts` row-1 probe (`.devx-cache/loop/state.json` {status,pid,ts}) + report copy in `.devx-cache/reports/` for the overnight-report probe. MANUAL.md MV2.1 (S-3 supervised night) filed. Missing node_modules dep (diff2html, pre-existing) restored via npm ci; `devx --help` snapshot updated for the new command.
- 2026-07-05T15:00:00-06:00 — phase 4 (self-review, 3-agent parallel adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor): 30 findings total, ~23 unique actionable (BH: 2 HIGH / 4 MED / 4 LOW; EC: 3 HIGH / 4 MED / 7 LOW, 5 overlapping BH; AA: 2 contract-drift MED + 2 test gaps + 2 retro notes). ALL fixed in place: pendingRepair cleared on every rollback path (BH-H1); permanent-error markers now scanned against raw worker output, no retry spawn against a dead API (BH-H2/EC-H1); mode gate FAILS CLOSED on unreadable config/missing mode (EC-H2); per-session 60min wall-clock ceiling + exit+drain settlement so a report-less hang can't eat the night (BH-M3/EC-H3); GIT_TERMINAL_PROMPT=0 injected into the claim's exec seam (BH-M4); mark-done/abandon commits pathspec-limited so user-staged work on main is never swept (BH-M5); merged-item diff captured pre-worktree-removal (BH-M6); $-token-safe backlog row replacement (EC-M4/BH-L7); CRLF frontmatter flips (EC-M5); fence-aware status-log section detection reusing blankFencedLines (EC-M6); validate-first report extraction (EC-M7); hostile-getter-safe error serialization (EC-L8); valid gh commands in morning-report next steps (BH-L8/EC-L9); non-ENOENT backlog reads surfaced (EC-L10); --only dev ordering fix for cross-backlog hash shadowing (EC-L11); strict digit-only CLI int flags (EC-L12); atomic backlog write in finalize (EC-L13); runItem-throw items still reach the report (BH-L10); setSpecStatus no-ops evented (BH-L9/EC-M5); ownership re-check (roc101 posture) before abandon/finalize main-state mutations (AA-F1). Regression tests added for every fix incl. driver-level 3-abandoned-items stop (AA-F3) and token-budget paths (AA-F4).
- 2026-07-05T15:00:00-06:00 — DEVIATION (recorded per AA-F1, no-silent-decisions): AC 6's "roc101 verify-claim in worker bootstrap" is intentionally reshaped — loop workers are prompt-framed fresh `claude -p` sessions that never re-claim, so there is no resume path to verify; instead the driver (a) treats the dvx101 lock file as the claim's ownership sentinel and (b) re-verifies lock ownership (parseLockOwner + normalizeSessionToken, the roc101 primitives) before every abandon/finalize mutation of main-worktree state, halting without touching state it no longer owns.
- 2026-07-05T15:00:00-06:00 — DEVIATION (recorded per AA-F2): AC 6's "sleep-inhibit re-exec in the supervisor entrypoint (sup40x dispatch)" ships as a helper-process inhibitor wired in the `devx loop` command (darwin `caffeinate -i -w <pid>`, linux `systemd-inhibit … sleep infinity`), keeping gnhf's `DEVX_SLEEP_INHIBITED` env loop-breaker but not the re-exec dance — the task brief explicitly allowed the cleaner seam ("the mechanism, not the full re-exec dance"). sup40x units are untouched; a supervisor-launched manager pre-wraps via the env breaker. Retro notes (AA-F5/F6): report's blocked-on-human category is forward surface (no mid-run INTERVIEW filing yet); design §3's DEBUG.md-filing + §2's LEARN.md-candidate queueing are not in the spec ACs and were not built.
- 2026-07-05T15:05:00-06:00 — phase 4 addendum: the staged-sweep regression test caught a SECOND instance of BH-M5 inside dvx101's `claimSpec` (bare `git commit -m` swept user-staged files into the claim commit and pushed them); fixed by pathspec-limiting the claim commit in `src/lib/devx/claim.ts` (existing 45 claim/CLI tests unchanged and green). Re-review of all touched surfaces after the fix batch: full loop test set green (178 tests across 13 loop files), typecheck green.
- 2026-07-05T15:15 — coordinator slice: Stage: Loop skill section (D-6/D-11 pins, CLI-owns-the-loop split, worker contract, morning-review handoff) + 6 discipline tests. Live smoke: `devx loop --dry-run` renders budgets + claim plan correctly. Watch item: one flaky failure observed when two vitest runs raced in the same worktree (agent's final suite || coordinator's) — re-runs clean ×2; loop tests + shared temp paths under concurrency is a candidate debug spec if it recurs. Full-suite duration grew to ~4–9 min (loop timing tests) — retro topic.
- 2026-07-05T16:06 — phase 4: 3-agent parallel adversarial review; 22 findings (1 HIGH, 8 MED, 13 LOW incl. auditor notes); ALL actionable fixed in-place — the HIGH: claimSpec's push-failure rollback ran `git reset --hard HEAD~1` in the MAIN worktree, destroying unrelated user WIP repo-wide; now `reset --soft HEAD~1` + restore scoped to exactly the claim's two files (real-git regression test seeds dirty WIP + a failing push); re-review clean. Also lands: repair-salvage commit re-attempt before any reset while pendingRepair is set (discarded-diff stat recorded when it too fails), tail-bounded + retry-corroborated permanent-error markers, madeProgress-aware abandoned rail, ALL-runs-for-head-SHA CI gate (limit 20, every run green), handed-off-ok/failure tail kinds routing the systemic 3-stop, consecutive-claim-failure bound, timeout token accounting, final-position report anchoring for the grace-kill, exitInProgress ownership guard + commit, main pushed after every loop-owned commit (failure ⇒ report WARN), lock-release failure surfaced, honest tour/test-delta report lines, heartbeat derived from manager.heartbeat_interval_s (clamped), defaultSleep + CLI signal wiring under test. +44 regression tests; full suite green + typecheck green + E-1 eval green.
- 2026-07-05T16:30 — fix-forward (CI red on #67): loop-worker tests relied on `node -p <prompt> -e <script>` last-flag-wins argv semantics, which differ between node 24 (local) and node 20 (CI runners) — both grace-kill tests hung 15s on both platforms. All six real-child test sites now inject a spawnFn seam (`node -e <script>` directly), keeping the real-process properties (own process group, pipes, kill -pid) while removing version-dependent argv parsing. LEARN candidate: version-skewed argv semantics are a hang-immunity blind spot the loop itself would have hit.
