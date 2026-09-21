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

### Third instance, measured: the fence parser has the same divergence

`palateful-2d` found, while checking a passing remark of mine, that its new
`splitFrontmatter` was **not** CRLF-tolerant while the engine's function of
the same name is. The same divergence is live in the readers this spec
already names. Measured 2026-09-20 on this branch:

```
LF    readFrontmatter        -> branch="feat/debug-crlf01" pr=27 status="in-progress"
LF    parseFrontmatterBranch -> "feat/debug-crlf01"
LF    engine splitFrontmatter -> parsed OK

CRLF  readFrontmatter        -> branch=undefined pr=undefined status=undefined
CRLF  parseFrontmatterBranch -> null
CRLF  engine splitFrontmatter -> parsed OK
```

`engine/frontmatter.ts:156` uses `/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/`.
Four other sites use `/^---\n([\s\S]*?)\n---/`:
`merge-gate.ts:138`, `split.ts:459`, `split.ts:520`, `split.ts:902`.

The merge-gate consequence is the worst of them and is not about branches at
all: on a CRLF spec `readFrontmatter` returns **every** key undefined, so an
explicit `pr: 27` in frontmatter is silently ignored and the gate falls
through to the `gh pr list` lookup. The one mechanism a spec has for pinning
its PR number — the priority-1 source the code's own comment documents —
does not survive a line ending.

**This is the same class as the null rule, one layer down.** The engine module
parses the fence correctly; four readers reimplemented it more narrowly. The
remedy 2d applied is the one this spec should generalize: delegate the fence
parse to the engine module — **one parser, two views** — rather than fixing
four regexes to agree.

### And a name collision, which is the hazard `artifacts.ts` warns about

There are now **two exported `splitFrontmatter` functions** with different
contracts: `engine/frontmatter.ts` returning `{fmText, delim, body}` and
2d's returning `{before, lines, after}`. Two spellings of one concept is
precisely what `artifacts.ts` privatized its constants to prevent, and it is
the kind of thing a hand-resolved merge conflict silently gets wrong. Worth
resolving to one name before both land.

Note how this was found, because it bears on AC 4: **not by review.** 2d's
self-review had passed over that module twice. It surfaced because I remarked
in passing that `splitFrontmatter` already existed on main, and 2d checked the
claim. Review asks what the code does; the remark made it ask what *else in
the repo shares this name* — a question review does not naturally generate.
Three findings now, none of them produced by reading the code under review.

### `"no PR yet"` is a catch-all for at least three unrelated causes

`palateful-2d` hit the CRLF failure's twin this morning from a different
direction, and the gate gave the same answer both times. Collected:

| Cause | How `fm.branch` ends up wrong | Gate output |
|---|---|---|
| No PR has been opened | correct branch, genuinely no PR | `no PR yet` |
| Authoring sentinel (`branch: unassigned`) | non-empty string, so the guard passed | `no PR yet` |
| CRLF spec | `readFrontmatter` returned `{}`; **nothing was read at all** | `no PR yet` |

The third is the worst because it reports a fact about **GitHub** when the
cause is entirely **local** — the spec was never read. `debug-1dfbdd` fixes
the first two (the reason now names the branch queried, and a non-existent
authored branch gets its own verdict). The third is untouched, because it is
caused by the fence parser above and not by the branch guard.

**The gate must distinguish "read the spec, found no PR" from "could not read
the spec."** Those want opposite responses: the first is "wait for Phase 7",
the second is "your spec file is unparseable." 2d's cost was a wrong
diagnosis until devx-b6 traced it; the CRLF variant's cost is a silent
fallback nobody knows happened.

**Sequencing constraint — this AC must land WITH AC 5, not before it.**
Today a CRLF spec is often still *correct by accident*: `readFrontmatter`
returns `{}`, so `authoredBranch` is null, so the gate derives the branch —
and if the PR is on the derived name, which is the normal case, it resolves
fine. Adding a hard "could not read the spec" verdict on its own would
convert those working-by-luck runs into loud failures. The detection is only
safe once the fence parse actually works, at which point `{}` genuinely means
"unparseable" instead of "CRLF". Landing them in the wrong order trades a
silent right answer for a loud wrong one — the same trap that killed the
precondition design in `debug-1dfbdd`.

### The recurring shape: a fix for a silent-wrong-answer bug fails loud-wrong

Three times on 2026-09-20, a proposed fix for a quiet wrong answer would have
shipped a loud wrong one. None of the three was caught by its own author:

| Proposed fix | Would have broken | Caught by |
|---|---|---|
| Validate branch existence as a **precondition** (`debug-1dfbdd`) | every spec with a merged PR whose branch was deleted — the normal end state under `--delete-branch` | `devx-b6` |
| Move `workstream-migration-integrity`'s floor from 9 to **1** (`wsmig1`) | the only assertion standing between 24 never-registered tests and total silence | `palateful-fb`, then `palateful-2d` |
| Emit "could not read the spec" **before** fixing the fence parse (AC 7) | every CRLF spec that currently resolves correctly by derivation | this spec's author, after 2d proposed it |

The mechanism is the same each time: the quiet bug leaves a fallback path
doing something reasonable, and the fix removes the quiet without checking
what the fallback was carrying. **It does not announce itself while you are
pleased with the diagnosis** — each of these was proposed immediately after
correctly root-causing something hard.

The practical rule: when a fix converts a silent state into a reported one,
enumerate what is *currently* reaching the silent path and succeeding. If
anything is, the fix is a sequencing problem, not a one-liner. That is why
AC 7 is explicitly not startable before AC 5.

Worth noting none of the three authors caught their own. That is a fourth
independent argument for AC 4's preference for structural controls: review by
the person holding the diagnosis is the weakest link in this whole story, and
it failed three times out of three in a single day.

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
5. The frontmatter **fence** parse is delegated to `engine/frontmatter.ts`
   at all four narrow sites (`merge-gate.ts:138`, `split.ts:459`,
   `split.ts:520`, `split.ts:902`) rather than fixed four times to agree —
   one parser, two views. Regression test covers a CRLF spec round-tripping
   `branch:`, `pr:` and `status:`; the `pr:` case is the load-bearing one,
   since today a CRLF spec silently loses its pinned PR number.
6. Exactly one exported `splitFrontmatter` exists in the tree. Two functions
   sharing a name with different return contracts is the hazard
   `artifacts.ts` privatized its constants to prevent, and a hand-resolved
   conflict between them is how it gets shipped.
   **Decided:** `engine/frontmatter.ts` keeps the bare name — it is the real
   parser — and the `frontmatter-keys.ts` view is renamed
   `splitFrontmatterLines`. 2d proposed this and it is right: the name
   without a qualifier should belong to the thing that does the parsing, not
   to a view over it. Renaming happens on #162 rather than being left for a
   conflict resolution to guess at. **Landed 2026-09-20.**
   Evidence that "before both land" was the right instruction: performing the
   rename caught a doc comment that referred to the *engine's*
   `splitFrontmatter` and renamed that too, leaving the comment explaining the
   delegation describing a function that does not exist. It typechecked and
   the suite passed — a mechanical rename across a name-collision boundary
   cannot distinguish "my symbol" from "prose about yours", and neither can
   the compiler. Caught by reading the diff. Resolving a collision *during* a
   merge, with two branches' prose in play, is strictly worse odds.
7. `merge-gate` distinguishes "read the spec, found no PR" from "could not
   read the spec". **Must land with AC 5, not before it** — see the
   sequencing constraint above; on its own it converts CRLF specs that
   currently resolve correctly by derivation into loud failures.
8. Consider whether "consolidation module with unmigrated callers" is a
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
