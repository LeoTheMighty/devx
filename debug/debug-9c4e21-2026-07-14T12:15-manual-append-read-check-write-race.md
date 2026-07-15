---
hash: 9c4e21
type: debug
created: 2026-07-14T12:15:00-06:00
title: appendManualEntry read-check-write race can double-append or clobber concurrent MANUAL.md writes
from: dev/dev-pin102-2026-07-14T12:01-skills-installer-library.md
status: done
owner: /devx-2026-07-14T1217-1080
branch: feat/debug-9c4e21
---

## Goal

`appendManualEntry` (src/lib/init-failure.ts) is safe under concurrent
callers: two processes filing MANUAL.md entries at the same time never
double-append the same anchor kind and never lose each other's bullet.

## Acceptance criteria

- [ ] Repro exists: a test (or runnable script) demonstrating the race —
      two concurrent appends where one bullet is lost or one kind is
      duplicated.
- [ ] Root cause documented with evidence in this status log.
- [ ] Fix + regression test (e.g. an O_EXCL lock around the
      read-check-write sequence, or append-with-retry keyed on file
      mtime/content — reuse existing lock primitives, wrap-don't-duplicate).

## Technical notes

- Found during pin102's 3-agent adversarial review (PR #70). The write
  itself is atomic (`writeAtomic` tmp+rename) but the sequence
  read → anchor-check → write is not; the anchor idempotency check can
  miss a concurrent writer's entry, and the rename can clobber a bullet
  appended between the read and the write.
- Pre-existing class (shipped with the /devx-init failure path); pin102
  made it hotter — every `installSkills` run with a user-owned skill file
  now goes through this path, and Phase 2+ parallel agents / `devx loop`
  workers can overlap.
- Existing lock primitives to consider wrapping: the O_EXCL manager lock
  (mgr106, src/lib/manage/) and the spec lock in .devx-cache/locks/.

## Status log

- 2026-07-14T12:15 — filed by /devx during pin102 cleanup (out-of-scope
  finding from the 3-agent review; see PR #70 notes + tour blast radius).
- 2026-07-14T12:17:38-06:00 — claimed by /devx in session /devx-2026-07-14T1217-1080
- 2026-07-14T12:22 — phase 2 (debug RED): repro committed (3746764) — test/init-failure-append-race.test.ts, 2 failing tests via real child processes. Same-kind race: 3/4 processes returned appended:true (expected 1). Distinct-kind race: bullets lost.
- 2026-07-14T12:23 — root cause (evidence): hypothesis: read→anchor-check→writeAtomic not serialized → check: src/lib/init-failure.ts:272-313 reads at L277, checks anchor at L278, rename lands at L311 — no mutual exclusion; writeAtomic (supervisor-internal.ts:85) is atomic per-write but rename REPLACES the whole file, discarding any peer append between L277 and L311 → result: confirmed by RED repro (lost update + double-append both observed).
- 2026-07-15T08:20 — phase 3: fix implemented — mgr106 lock generalized to acquirePathLock + acquirePathLockBlocking (src/lib/manage/lock.ts); appendManualEntry holds the lock across read→check→write and re-reads inside it (src/lib/init-failure.ts). RED repro now green 8/8 consecutive runs.
- 2026-07-15T08:20 — phase 4: single-pass adversarial review (293 LoC, under 3-agent threshold); 3 findings (0 HIGH, 1 MED, 2 LOW); ALL fixed in-place — MED: cold tsx-cache stampede flake vector in the repro test, fixed with a warm-up worker; LOW: stale header comment + missing timeout/stale-reap unit coverage for the new blocking primitive; re-review clean.
- 2026-07-15T08:26 — phase 5: local CI green — full suite 2099 passed (106 files), includes typecheck per npm-test wiring.
- 2026-07-15T08:26 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/71 (body via devx pr-body, no unresolved placeholders); remote CI devx-ci in-progress (run 29423539763).
- 2026-07-15T08:27 — phase 7.5: tour skipped fail-soft — `devx tour gather` cannot resolve debug/ specs (exit 65, stage no-spec); gap filed as debug-6a913f + DEBUG.md row.
- 2026-07-15T08:30 — phase 8: hold check clear; `devx merge-gate 9c4e21` exit 1 with reason "no spec file under dev/" — the CLI's findSpecForHash hardcodes dev/ (same class as the tour gap; folded into debug-6a913f). Ran the canonical mergeGateFor/deriveMergeAdvice library path directly with the debug spec's PR #71 signals: {ciConclusion:success, blockingReviewComments:0, count:0, initialN:0} → merge:true.
- 2026-07-15T08:31 — merged via PR #71 (squash → 25cf144)
