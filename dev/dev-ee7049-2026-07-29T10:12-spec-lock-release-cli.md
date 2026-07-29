---
hash: ee7049
type: dev
created: 2026-07-29T10:12:00-06:00
title: "Guarded spec-lock release CLI for the Phase 9 branch-handoff path"
status: ready
from: dev/dev-mss104-2026-07-28T13:43-handoff-snippet-retirement.md
branch: feat/dev-ee7049
owner: null
---
## Goal

`/devx` Phase 9's branch-handoff path instructs the agent to release the
parent's spec lock with a raw `rm .devx-cache/locks/spec-<hash>.lock`.
That works, but it is the one lock mutation in the whole system that goes
around `releaseSpecLockGuarded` — every other release path (claim
rollback, loop `splitItem`, Phase 8 cleanup) goes through the guarded
primitive. Wrap it in a CLI so the interactive path gets the same
ownership check the programmatic paths already have.

Filed out of mss104 (see its tour, decision D3 — the alternative
deliberately deferred there). Low priority: at the point Phase 9 issues
the `rm`, `devx split` has just returned 0, which required passing
`performSplit`'s ownership guard, so ownership was verified moments
earlier. The gap is narrow, not theoretical — a retry, a typo'd hash, or
a copy-pasted line from another item's handoff all land outside that
verification.

## Acceptance criteria

- [ ] AC 1: `devx devx-helper release-lock <hash> --session-token <token>`
      wrapping `releaseSpecLockGuarded` (`src/lib/devx/spec-lock.ts:417`).
      Exit codes follow the devx-helper convention: 0 released · 2 other
      failure · 3 ownership mismatch · 64 usage. A missing lock is exit 0
      with `{"released":false,"reason":"missing"}` — releasing an already
      released lock is not an error.
- [ ] AC 2: `--session-token` is required and never auto-derived, matching
      `devx split`'s posture (auto-derive would always mismatch and defeat
      the guard — the roc101/E13 shape).
- [ ] AC 3: `.claude/commands/devx.md` + `skills/devx.md` Phase 9
      branch-handoff bullet swaps the raw `rm` for the CLI; mirror
      re-synced byte-identical (`test/skills-sync.test.ts`).
- [ ] AC 4: `test/devx-skill-phase9-split.test.ts` pin updated — the
      verbatim-invocation assertion covers the release command too, so the
      raw `rm` cannot drift back in.
- [ ] AC 5: tests for the three exit paths (owned → released, other
      session → 3, missing → 0/false); full suite + typecheck green.

## Technical notes

`releaseSpecLockGuarded` already exists and is library-only — this is the
pure-fn + CLI-passthrough pattern (`LEARN.md § Cross-epic patterns`), same
shape as `devx split` wrapping `performSplit`. No new decision logic.

Ownership vocabulary to reuse: `specLockOwner` /
`parseLockOwner` / `normalizeSessionToken`
(`src/lib/devx/verify-claim.ts:126,141`), exit-3-is-owned-by-other-session
per `src/commands/devx-helper.ts`.

## Status log

- 2026-07-29T10:12 — filed by /devx during mss104's Phase 8 gap sweep
  (out-of-scope hardening surfaced by mss104's self-review finding that
  the branch-handoff release step had no named mechanism at all).

## Links

- Parent: `dev/dev-mss104-2026-07-28T13:43-handoff-snippet-retirement.md`
- Tour (decision D3): https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/mss104/tour.html
