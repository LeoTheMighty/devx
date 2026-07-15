---
hash: 6a913f
type: debug
created: 2026-07-15T08:27:00-06:00
title: hash→spec resolution hardcodes dev/ across v2 CLIs (tour gather, merge-gate) — debug-loop PRs ship without tours and the merge gate false-negatives
from: debug/debug-9c4e21-2026-07-14T12:15-manual-append-read-check-write-race.md
status: done
owner: /devx-2026-07-15T0831-76905
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
- 2026-07-15T08:31:55-06:00 — claimed by /devx in session /devx-2026-07-15T0831-76905
- 2026-07-15T08:38 — phase 2 (debug RED): repro committed — test/spec-resolve-any-type.test.ts, 5 failing (merge-gate debug-spec gate, per-type branch fallback, exit-2 miss shape, tour gather debug spec, shared resolver unit).
- 2026-07-15T08:38 — root cause (evidence): hypothesis: per-command dev/ hardcoding → check: src/commands/merge-gate.ts:133 findSpecForHash reads only `dev/` + L306 falls back to `feat/dev-<hash>`; src/lib/tour/gather.ts:32 SPEC_DIR="dev" though findSpecForHashIn (engine/frontmatter.ts:341) is already dir-parameterized; claim.ts:396 + workstream.ts findSpecForHashInFs are already type-aware → result: confirmed, 4 resolvers exist where 1 should; two consumers pinned to dev/.
- 2026-07-15T08:41 — phase 3: fix implemented — shared findSpecForHashAnyType (+ AmbiguousSpecHashError, SPEC_TYPE_DIRS) in engine/frontmatter.ts; merge-gate + tour gather consume it; merge-gate miss/ambiguity → exit 2 no-advice; branch fallback via deriveBranch(config, type, hash); skill-body exit-2 row updated + skills mirror synced; stale decide.ts row-3 comments corrected.
- 2026-07-15T08:48 — phase 4: single-pass adversarial review (~230 LoC src, under 3-agent threshold); 4 findings (0 HIGH, 2 MED, 2 LOW); ALL fixed in-place — MED: next/decide.ts row-3 comments still claimed merge-gate is dev-only (would re-teach the regression); MED: merge-gate ambiguous-hash path untested (test added); LOW: unused fs imports; LOW: emitDecision doc drift; re-review clean.
- 2026-07-15T08:48 — phase 5: local CI green — full suite 2107 passed (was 2099), typecheck + skills-drift guard included in npm test.
- 2026-07-15T08:57 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/72; remote CI devx-ci green (run 29425258499).
- 2026-07-15T08:58 — phase 7.5: tour built + published (devx-tours 9f7cdef) — gathered from this debug-type spec BY the fixed code; PR body re-rendered with tour link.
- 2026-07-15T08:59 — phase 8: hold clear; `merge-gate 6a913f` run via the branch's own CLI → {"merge":true} exit 0 — the type-aware gate resolved the debug spec itself.
- 2026-07-15T08:59 — merged via PR #72 (squash → 1284e01)
