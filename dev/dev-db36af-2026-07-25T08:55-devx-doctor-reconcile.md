---
hash: db36af
type: dev
created: 2026-07-25T08:55:00-06:00
title: devx doctor — mechanical state reconciliation (self-healing primitive)
from: debug/debug-dc7514-2026-07-25T08:55-loop-infra-failure-classification.md
status: ready
branch: feat/dev-db36af
blocked_by: [dc7514]
---

## Goal

A `devx doctor` CLI that detects — and with `--fix` mechanically repairs —
the repo-state debris that today requires human forensics: dead-PID spec
locks, dead-owner claims, checkbox↔frontmatter mirror drift, orphan
worktrees, and content-free loop abandonments. This is the reconcile()
role from the ManageAgent design surfaced as a standalone primitive, wired
into `devx next` (advisory) and loop start (self-healing), so a wedged
backlog heals itself instead of waiting for a human. Motivated by the
2026-07-24 incident where every repair step was mechanical once the facts
were established (see debug-dc7514's Evidence).

## Acceptance criteria

- [ ] `src/commands/doctor.ts` (new) + `src/cli.ts` registration:
      `devx doctor` is read-only, prints findings; `devx doctor --fix`
      applies the mechanical class. Stdout JSON
      `{findings: [{class, target, detail, fixable}], fixed: [...]}`;
      exit 0 clean, 3 when unfixed findings remain (advisory shape — never
      a merge gate).
- [ ] Detectors (each with a fixture-backed test):
      - stale-lock: `.devx-cache/locks/spec-*.lock` whose recorded PID is
        dead → fixable (delete).
      - dead-owner: spec with `status:` ∈ {in-progress, blocked} whose
        `owner:` session token maps to a dead PID/lockless claim →
        fixable when status is loop-abandoned (clear owner); otherwise
        report-only.
      - mirror-drift: backlog checkbox vs spec frontmatter `status`
        disagreement (frontmatter is source of truth per CLAUDE.md) →
        fixable (rewrite the checkbox + `Status:` prose on the backlog
        line, `[locked]` lines excluded).
      - orphan-worktree: `.worktrees/<type>-<hash>/` whose spec is not
        `in-progress` (done/ready/absent) → report-only with advice
        (worktrees are never auto-deleted; judgment stays human).
      - bookkeeping-only-abandonment: spec abandoned by a loop run whose
        preserved worktree holds only loop bookkeeping commits (predicate
        shared from debug-dc7514) → fixable (discard worktree + branch,
        reset spec to `ready`, status-log line appended).
- [ ] `--fix` boundary test: the two report-only classes are never
      mutated even with `--fix`; every fix appends an audit line to the
      affected spec's status log (append-only discipline).
- [ ] `devx next` surfaces doctor findings as advisory drift rows (reuse
      the existing `drift[]` channel in gather/decide); exit code
      unchanged; 0 file writes from `next` itself.
- [ ] `devx loop` runs the fixable class at run start (before item pick)
      and events `doctor:fixed` entries; a repo wedged in the
      2026-07-24 shape (blocked spec + dead owner + bookkeeping worktree)
      self-heals and the loop proceeds to claim the item — end-to-end
      test.
- [ ] **Source fix — stop the leak doctor would otherwise sweep forever.**
      `devx devx-helper mark-done` releases `spec-<hash>.lock` as part of
      the closing flip, exactly as `claim` acquires it in the opening one.
      Today nothing releases a `done` spec's lock: reaping only fires on a
      contending claim for the same hash, which never comes once the item
      is closed. This absorbs `dev-ee7049` (guarded release CLI) and
      `dev-b931a1` AC 3 — build the release primitive once, call it from
      mark-done, the loop merge tail, and `doctor --fix`. A detector that
      cleans up after a bug we know how to prevent is a mop, not a fix.
- [ ] **New detector — dead-blocker** (not in the original AC list; found
      by the 2026-08-12 audit): a `blocked_by:` / `Blocked-by:` naming a
      hash that is (a) absent from disk, (b) already `done`, or (c) struck
      `~~superseded~~` in its backlog. Report-only with the specific
      reason — the fix (re-root vs retire) is judgment. Motivating case:
      8 of 10 blocked PLAN.md rows sat behind `c4f1a2`, superseded
      2026-07-05, so their blocker could never clear and nothing noticed
      for five weeks.
- [ ] Full suite green (`npm test`, typecheck included). **Precondition
      CLEARED 2026-08-13**: the 3 `manage-spawn-integration.test.ts`
      failures that blocked this AC were `debug-ecdcda`, shipped via PR
      #125 (merged `a3ad57f`). Pass 2 is now 26 files / 721 tests / 0
      failures. This AC is achievable as written; no known red remains.
      Budget ~15 min for the gate — pass 2 alone runs ~850s.

## Technical notes

- Wrap, don't duplicate: backlog parsing via `src/lib/backlog/parse.ts`;
  spec resolution via `findSpecForHashAnyType` (engine/frontmatter.ts);
  lock format + liveness via the verify-claim/lock code in
  `devx-helper` (claim.ts); frontmatter flips via the loop's
  replaceFrontmatterStatus path. Doctor should be almost entirely glue.
- Fix class boundary is the design's spine: mechanical = derivable from
  ground truth with zero judgment (locks, mirrors, owner tokens,
  bookkeeping-only worktrees); anything touching real uncommitted or
  committed work is report-only, always.
- Sequencing: blocked-by debug-dc7514 — the bookkeeping-commit predicate
  and the abandon-path contract land there, and both items edit
  `src/lib/loop/driver.ts` (avoid a cross-branch conflict).
- Concierge (roadmap Phase 2) extends this surface; keep doctor a thin
  renderer + applier over lib detectors (`src/lib/doctor/`).

## Status log

- 2026-07-25T08:55 — filed from the loop-2026-07-24 post-mortem: the
  hand-reset in main commit 5f83f3e was 100% mechanical — evidence this
  belongs to a CLI, not a session. Part of the skill/loop fixups track.
- 2026-08-12 — second, larger dataset from a full manual reconciliation
  pass (commit `9e1d9d3`). Every class in the AC list was present in the
  wild, and the pass took a session of forensics to do by hand — the same
  argument as 5f83f3e, now with counts:
  - **stale-lock: 14 instances.** `.devx-cache/locks/` held 16 locks; 14
    were on `done` specs with dead PIDs, the oldest from 2026-07-26 (16
    days). Because the sole reaper fires on a contending claim, a closed
    item's lock is immortal. Detection is two lines (spec `status` +
    `kill -0`); nobody was running them.
  - **dead-owner: 2 instances, and they needed OPPOSITE verdicts** — which
    is the strongest argument for the report-only boundary already in the
    ACs. `ecdcda` had a dead owner and a worktree with no commits and no
    dirty files (its findings had gone straight to main), so releasing it
    was pure gain. `c81f04` had an equally dead owner but 132 uncommitted
    insertions in its worktree — a compare-and-delete guard for lock
    reaping, unprotected by git. Same detector signature, opposite action.
    A `--fix` that treated dead-owner as mechanical would have destroyed
    real work. Keep dead-owner + orphan-worktree report-only; the
    discriminator is worktree contents, not owner liveness.
  - **mirror-drift: 2 instances** (`e0a67e`, `620c74` — PLAN.md `[x]` over
    `in-progress` frontmatter, both rows' own Status prose reading
    "executing", so the checkbox alone was wrong). Note `devx next`
    ALREADY reports this on its `drift[]` channel and did, correctly, for
    weeks — nothing acted on it. The detect half exists; the fix half and
    the "somebody actually runs this" half do not. Proof it works: during
    this very pass, `devx next` caught the author flipping a DEBUG.md row
    to `[x]` without the matching frontmatter flip, one command later.
  - **dead-blocker: 8 instances**, a class the original ACs missed
    entirely — hence the new detector AC above.
  - **orphan-worktree: 2 instances**, both correctly report-only.
- 2026-08-12 — sequencing note: the final AC ("full suite green") cannot be
  met at `d5336ff`. `npm test` gives `Test Files 1 failed | 25 passed (26)`
  / `Tests 3 failed | 723 passed (726)`, all three the
  `Test timed out in 5000ms` shape in `manage-spawn-integration.test.ts`.
  That is `debug-ecdcda`, now precisely scoped (per-FILE vs per-TEST
  partition misclassification, not the exec seam). Land ecdcda first.

- 2026-08-13 — the SOURCE-FIX AC demonstrated itself, unprompted, one day after being written. `debug-ecdcda` shipped through the full attended `/devx` loop (PR #125, merged a3ad57f). `devx devx-helper mark-done ecdcda --pr 125 --type debug` returned exit 0 with `paths: ["DEBUG.md", "<spec>", "GRAPH.md"]` — and left `.devx-cache/locks/spec-ecdcda.lock` on disk. So the 14 stale locks cleared in `9e1d9d3` were not historical debris from an older, buggier era: the leak is live in the current code path, and it reproduces on every clean, green, correctly-executed run. Lock #15 was created and orphaned inside the same session that documented why #1-14 existed. Released by hand again; that hand-release is the thing this AC deletes.
