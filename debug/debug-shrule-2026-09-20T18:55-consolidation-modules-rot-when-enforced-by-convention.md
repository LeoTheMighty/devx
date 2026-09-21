---
hash: shrule
type: debug
created: 2026-09-20T18:55:00-06:00
title: "a consolidation module enforced only by convention rots: debug-7b3e2a's fix was live in three readers seven weeks after it closed"
from: debug/debug-1dfbdd-2026-09-20T10:25-merge-gate-accepts-any-string-as-branch.md
spawned: []
status: ready
owner: null
branch: null
---

## Goal

`debug-7b3e2a` fixed merge-gate's hand-rolled YAML-null test and created
`src/lib/frontmatter-scalar.ts` so every regex frontmatter reader could share
one rule. Its own header states the intent: the readers "each one used to
decide for itself what 'no value' looked like, and they disagreed."

**The module was created. The callers were never migrated. The spec was
closed.** Seven weeks later, three readers still carried their own narrower
copies:

| Reader | Hand-rolled rule | Missed |
|---|---|---|
| `src/lib/devx/split.ts:907` | `v === "" \|\| v === "null"` | `Null` `NULL` `~` |
| `src/lib/doctor/detect.ts:714` | `"" \| "null" \| "~"` | `Null` `NULL` |
| `src/lib/doctor/detect.ts:110` (`ownerOf`) | same subset, **and unquotes before testing** | `Null` `NULL` |

These were live defects, not style drift. `branch: NULL` became the branch
*name* `"NULL"`; in doctor's case that reached `git branch -D NULL`. `ownerOf`
is worse, because `owner:` feeds the **dead-owner detector** — a spec with
`owner: NULL` looked owned and was therefore never reported, which is the
detector silently failing exactly the case it exists for.

All three are fixed in `debug-1dfbdd` (devx PR #163) along with a tree-wide
guard, `test/nullish-rule-single-source.test.ts`. **This spec is not about
those three.** It is about why a closed fix stayed live for seven weeks, and
what stops the next one.

### The evidence that names the cause

Two consolidation modules in this tree made the same promise. One held; one
did not. The difference is not diligence:

- **`src/lib/engine/artifacts.ts` — structural.** Its header makes the same
  claim ("the single source of truth… all path construction routes through
  these exports"). At `dlr105` the `*_REL` constants were made **module-
  private**, so a bypass does not compile. Measured 2026-09-20: zero
  hand-rolled artifact-path literals anywhere outside it. The
  `workstream-migration-integrity` test even records the reasoning — a test
  that kept a private spelling alive "would be the first caller of the
  bypass."
- **`src/lib/frontmatter-scalar.ts` — conventional.** It exports a function
  and relies on authors choosing to call it. Nothing prevents, detects or
  even discourages a local `v === "null"`. Three readers wrote one anyway,
  and one of them (`split.ts`) *already imported the module* for a different
  call on line 493 while hand-rolling the rule on line 907.

That last detail is the point. The `split.ts` author was not unaware of the
shared rule; the file was already importing it. Convention does not fail
because people do not know — it fails because nothing is checking, and a
local two-term comparison is easier to type than an import is to remember.

### Why this is worth a spec rather than a line in 1dfbdd

Three of the four defects in this family were found by *reading the files
somebody else had already listed*. The third (`ownerOf`) only appeared when a
check read the whole tree — nobody had pointed at it, and nobody would have.
A class defined by turning up where nobody pointed cannot be closed by an
audit, and `7b3e2a` closing on an audit is precisely how it survived.

This also makes four separate things today that **read as done and were not**:
`7b3e2a` (this), a `Blocked-by:` naming a story closed seven weeks earlier,
an assertion pinned to a cron string rather than the interval it protected,
and a fix whose own acceptance test was never re-run.

### `ownerOf` had two more defects, found independently — which strengthens the thesis

`palateful-2d` reached the same function from the opposite direction:
`debug-828385`'s AC 5 asked it to audit the hand-rolled frontmatter readers,
and it fixed `ownerOf` as one of six sites (devx PR #162) before this spec was
filed. Its version is a **strict superset** of the nullish fix, because the
function carried three stacked defects, not one:

1. the narrow nullish rule (found here, via the tree-wide guard);
2. `/^owner:\s*(.+?)\s*$/` — `.+?` requires a character, so a bare `owner:`
   read as **absent** rather than **empty**;
3. the `m` flag anchored to any line in the file rather than to the
   frontmatter block, so an `owner:` line in a spec's *body* could answer for
   its frontmatter.

`detect.ts:712`'s `branch:` read carries the identical `.+?`-and-unscoped-`m`
pair and is also fixed in #162.

Two independent audits, from different specs, converging on one function that
had been wrong three ways since it was written. Neither audit would have found
all three alone: 828385's found the shape defects by reading the readers,
1dfbdd's found the rule defect by checking the whole tree for a pattern. That
is the argument for AC 4 preferring structural controls over either — both
audits were competent, both were partial, and the function stayed broken until
they happened to collide on the same day.

Ownership: `ownerOf` and the `branch:` read belong to **#162**, whose version
supersedes the minimal nullish fix carried in #163. Verified 2026-09-20 that
#162's `ownerOf` produces zero hits against `nullish-rule-single-source`'s
guard, so the merge resolution "take #162's version" keeps that guard green;
the two PRs are compatible in either merge order.

## Acceptance criteria

1. `debug-7b3e2a`'s Status log records that its fix was incomplete, which
   readers carried the defect, for how long, and where it was completed
   (`debug-1dfbdd`, PR #163). A closed spec that reads as fully applied when
   it was not is the artifact this spec exists to correct — leaving the record
   wrong reproduces the failure at the bookkeeping layer.
2. Every other consolidation module in `src/lib/` is audited for unmigrated
   callers, using a tree-wide check rather than a reading of its callers.
   Candidates observed to make the "single source" claim in their headers:
   `engine/artifacts.ts` (verified clean 2026-09-20), `devx/spec-lock.ts`,
   `devx/verify-claim.ts`, `devx/finalize.ts`, `engine/outline-scaffold.ts`,
   `init-hooks.ts`.
3. For each module found to have unmigrated callers: migrate them, and add a
   guard or a structural control so the next one fails at write time.
4. **Prefer the structural control to the guard where it is available.**
   Privatizing a constant beats a grep test, because it fails at compile time
   in the author's editor rather than in CI after review. Where only a guard
   is possible (a function cannot be privatized from its own callers), the
   guard must include a self-test proving the regex matches the real historical
   offenders verbatim — a guard that cannot fail reports clean forever and
   trains people to trust it (see `f83b04` for what a detector nobody believes
   costs, and note that cost outlives the fix).
5. Consider whether "consolidation module with unmigrated callers" is a
   `devx doctor` finding or a lint rule. **Weigh it against current detector
   noise before adding it** — `f83b04` has already trained multiple sessions
   to ignore dead-owner findings, and a new class landing into a detector
   people are dismissing is negative value however correct it is.

## Technical notes

### Do NOT close this by re-auditing the frontmatter readers

`1dfbdd` already fixed all three and added the tree-wide guard. Re-reading
those files finds nothing and proves nothing — that is the same audit that let
`7b3e2a` close. The open work is ACs 2-4, on *other* modules.

### The guard in 1dfbdd is deliberately narrow, and that is a decision

`test/nullish-rule-single-source.test.ts` does not flag a bare `~`, because in
this tree `~` usually means `$HOME` (`learn/config.ts:131`,
`learn/route.ts:101`) and a guard that cries wolf on path handling is one
someone deletes. A hand-rolled rule testing *only* `~` would slip through.
That is an accepted trade for a guard that stays credible, and any widening
should be argued against the same standard rather than added because it is
more thorough.

## Status log

- 2026-09-20T18:55:00-06:00 — filed from `debug-1dfbdd` implementation.
  All three offending readers fixed and guarded in PR #163; the generalized
  cause (consolidation enforced by convention rather than structure) is
  carried here because it is not that spec's surface. The
  `artifacts.ts`-vs-`frontmatter-scalar.ts` contrast was measured, not
  assumed: zero bypasses of the privatized constants, three of the exported
  function. Requested by the coordinator session on the grounds that a fix
  closed weeks ago with the defect live in multiple readers is worse than an
  open bug.
