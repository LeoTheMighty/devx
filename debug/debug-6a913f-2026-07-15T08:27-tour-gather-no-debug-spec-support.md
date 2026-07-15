---
hash: 6a913f
type: debug
created: 2026-07-15T08:27:00-06:00
title: hash→spec resolution hardcodes dev/ across v2 CLIs (tour gather, merge-gate) — debug-loop PRs ship without tours and the merge gate false-negatives
from: debug/debug-9c4e21-2026-07-14T12:15-manual-append-read-check-write-race.md
status: ready
owner: null
branch: feat/debug-6a913f
---

## Goal

Every hash-resolving v2 CLI (`devx tour gather`, `devx merge-gate`, plus an
audit of `devx outcome`/others) resolves specs of any backlog type (dev,
debug, test, …), so the Stage: Debug execute tail ("worktree → PR + tour →
merge") ships a review tour AND clears the canonical merge gate on debug PRs.

## Acceptance criteria

- [ ] Repro exists: tests showing `tour gather` (exit 65, stage `no-spec`)
      AND `merge-gate` (exit 1, reason "no spec file for hash under dev/")
      failing on a `debug/` spec hash.
- [ ] Root cause documented (per-command `dev/`-hardcoded findSpecForHash
      duplicates; compare `devx-helper claim --type debug`, which already
      grew the flag — a wrap-don't-duplicate violation).
- [ ] Fix + regression tests: one shared type-aware spec resolver consumed by
      tour gather + merge-gate (and any other hash-resolving CLI found in the
      audit); debug hashes resolve end-to-end.
- [ ] merge-gate's dev/-miss emits exit 1 + advice "manual merge required" —
      a resolution failure mis-shaped as a gate decision; it should be the
      exit-2 investigation shape (like "no PR yet") so Phase 8 doesn't file a
      spurious MANUAL.md row.

## Technical notes

- Found during debug-9c4e21's Phase 7.5 + Phase 8: PR #71 shipped tour-less
  under the fail-soft rule, and the merge gate had to be run via the library
  (mergeGateFor + deriveMergeAdvice with hand-resolved PR signals) because the
  CLI couldn't find the spec. `devx devx-helper claim` solved the same problem
  with `--type debug` (v2d101 debug loop); the other CLIs never got the
  equivalent.
- Keep `deriveBranch`/spec-path conventions as the single source of truth for
  the per-type path shape — wrap, don't duplicate.

## Status log

- 2026-07-15T08:27 — filed by /devx during debug-9c4e21 Phase 7.5 (tour
  fail-soft path; out-of-scope tooling gap).
- 2026-07-15T08:31 — widened by /devx during 9c4e21 Phase 8: `devx merge-gate` hit the same dev/ hardcoding (false-negative "manual merge required" on PR #71); scope is now the resolution class, not just tour gather.
