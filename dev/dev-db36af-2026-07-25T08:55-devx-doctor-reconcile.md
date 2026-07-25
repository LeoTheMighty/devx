---
hash: db36af
type: dev
created: 2026-07-25T08:55:00-06:00
title: devx doctor — mechanical state reconciliation (self-healing primitive)
from: debug/debug-dc7514-2026-07-25T08:55-loop-infra-failure-classification.md
status: ready
branch: feat/dev-db36af
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
- [ ] Full suite green (`npm test`, typecheck included).

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
