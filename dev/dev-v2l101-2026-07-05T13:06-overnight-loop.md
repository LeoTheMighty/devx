---
hash: v2l101
type: dev
created: 2026-07-05T13:06:00-06:00
title: V2.5 — overnight loop (gnhf fold-in)
from: v2/06-phases.md
plan: v2/
status: in-progress
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
