---
hash: inert1
type: debug
created: 2026-09-20T18:40:00-06:00
title: "\"Computed and never read\" — a mechanically-testable class of inert mechanism"
from: debug/debug-f4149e-2026-09-02T11:55-todo-phase-pointer-arrow-silent.md
status: ready
owner: null
branch: null
---

## Goal

Nothing in this repo can tell you that a field is computed on every call and
read by nobody. That state is invisible to types, to tests, and to review —
it compiles, it is covered, and it is dead.

This asks for the cheapest possible detector for one specific shape:
**a value that is produced and never consumed.** Not "the detector is wrong",
which is `plan-4c827d`'s subject and needs judgement. This one is decidable
by symbol reachability, which is why it is worth separating.

## Why this is worth a story

Found while fixing `f4149e`. That spec's AC 2(b) directed a new signal into
`TodoDoc.violations`, "which `parseTodo` already carries for exactly this
class". **There is no such field.** What exists is `unparsedTopLevel` — and it
is computed on every parse, stored on every `TodoDoc`, and read by nobody.

So the instruction was to route a new signal into a channel nobody reads, in
the fix for a bug whose entire content is *a signal that went nowhere*. The
bug reproduced itself inside its own remedy, one level up, and nothing would
have caught it: the code would have compiled, the field would have been
populated, and a test asserting `doc.violations.length === 1` would have
passed forever while no operator ever saw a word of it.

That is the argument for a mechanical check. A reviewer cannot see this. A
type cannot see it. A unit test asserting on the field *cannot* see it —
asserting on a dead field is indistinguishable from asserting on a live one.

## Specimens — verified, not relayed

Claims were circulating for four instances. I checked each by symbol search
across `src/`. **Three hold, one is false.** Recording every state including
the false one, because a pattern argued from four specimens with a wrong one
in it is weaker than one argued from three that are right.

| symbol | occurrences outside its own module | verdict |
|---|---|---|
| `unparsedTopLevel` | 0 (5 total, all `engine/todo.ts`) | **inert** |
| `proseBudgetKb` | 0 (3 total, all `engine/config.ts`) | **inert** |
| `archiveRoot` | 1 — **consumed** at `lib/archive/plan.ts:181` | **NOT inert** |
| `stampEvalShas` | 0 in `src/` (definition only, `engine/evals-lock.ts:85`); **2 in `test/`** | **inert in production** |

`stampEvalShas` (the RED eval lock's producer — b6 supplied the symbol; my
own search missed it because the field is `gate_status.red_eval_shas` but the
producer is named for the action, not the field) is the **strongest** of the
three, for two reasons.

*It is provably inert from history, not from a snapshot.*
`git log --all -S "stampEvalShas(" -- src/` returns only the commit that
introduced it (the 8am-harness fold-in, 2026-09-01). It has never had a
caller in the repo's history — born inert, not a regression and not a removed
call site. That technique generalises: a snapshot says "nothing reads this
now", `-S` over history says "nothing has ever read this", and the second is
a much harder claim to argue with. Worth using on every true positive before
anyone proposes deleting it.

*It is the canonical fixture for AC 4, not merely a specimen.* It has **two
callers in `test/evals-lock.test.ts` and none in `src/`.** So it is covered,
it is exercised, it looks alive to every tool that counts references — and no
production path has ever called it. A detector that counts test reads as
consumption gives this one a clean bill of health, which is exactly the
failure AC 4 exists to prevent.

*Its failure is compositional, and it lands on AC 6 from a second direction.*
The lock classifies an eval it never stamped as `unstamped`, and
`evals-lock.ts:104-105,143` record that `unstamped` is how a grandfathered
workstream legitimately looks and that it **never blocks**. So an inert
producer does not surface as an error — every eval reads as unstamped, and
unstamped reads as permission. The mechanism being dead is indistinguishable
from the mechanism deliberately not applying. That is AC 6's property
("silence and cleanliness must not look identical") arriving independently
from a different surface, which is worth more than the AC restated.

Note: b6 is implementing a caller for this under `75563d`, so by the time any
check exists the symbol should be live. **Use it as a regression fixture, not
as a finding** — pin the pre-fix state in a test rather than expecting the
detector to report it.

The `archiveRoot` case is the instructive one: it looks inert from the config
side (declared, defaulted, parsed, three touches all in `config.ts`) and is
genuinely read one hop away. A detector that flagged it would be wrong, and a
detector that is wrong about a live field is how this class of check gets
switched off in week two. Whatever ships must handle the one-hop read.

## Acceptance criteria

- [ ] AC 1: A check that reports exported/interface members produced by the
      codebase and read nowhere outside their defining module. Start with
      `TodoDoc`/`EngineConfig`-shaped interface fields; a whole-program
      unused-export sweep is a superset and also acceptable.
- [ ] AC 2: `unparsedTopLevel` and `proseBudgetKb` are both reported.
      `stampEvalShas` is the third specimen but is being given a caller under
      `75563d` — pin its pre-fix state as a fixture rather than expecting a
      live report.
- [ ] AC 3: `archiveRoot` is **not** reported — it is read at
      `lib/archive/plan.ts:181`. This is the false-positive guard, and it is
      the AC that decides whether the check is trustworthy enough to leave on.
- [ ] AC 4: Test-only reads do not count as consumption. A field read solely
      by its own unit test is still inert in production, and that is exactly
      the shape that survives review. **`stampEvalShas` is the fixture**: two
      callers in `test/`, none in `src/`. A detector that counts test reads
      passes it, and passing it is the bug.
- [ ] AC 5: Output lands somewhere consumed — `devx doctor`, a CI step, or a
      `DEBUG.md` write. A report that only prints into a run log reproduces
      the defect it detects. (See `plan-4c827d`; also the palateful
      `deploy-freshness` case, where the detector authenticated for 51 days
      against nobody reading it.)
- [ ] AC 6: The check must distinguish "inert" from "I could not resolve the
      symbol" and fail loudly on the latter, rather than emitting an empty
      list. Silence and cleanliness must not look identical.
- [ ] AC 7: Decide the disposition for each true positive — delete the field,
      or wire it to a consumer. Do not leave a reported field reported
      forever; a permanent finding is noise within a week, which is the
      habituation failure `f83b04`'s dead-owner spam is currently
      demonstrating.

## Technical notes

- Confirm every true positive against history before proposing a deletion:
  `git log --all -S "<symbol>(" -- src/`. "Never had a caller" (born inert)
  and "lost its caller" (a regression) want different dispositions, and the
  snapshot cannot tell them apart.
- `ts-prune`, `knip`, or `tsc`'s own unused diagnostics are all plausible
  off-the-shelf answers; prefer one of those to a bespoke AST walk unless the
  false-positive rate on this codebase is unacceptable. Measure before
  building.
- Interaction with `f4149e`: that fix deliberately routed its new signal
  through `computeTodoDrift` rather than adding a field, *because* the field
  it was told to use turned out to be dead. The general rule worth extracting
  is **prefer an already-consumed channel to a new one**, and this check is
  how you find out which is which before committing to a design.
- Relationship to `plan-4c827d`: b6 holds nine specimens there, all about
  detectors being *wrong* — a judgement problem. "Computed and never read" is
  a distinct and strictly cheaper shape: it is decidable without knowing what
  the value means. Worth keeping separate so the cheap half can ship without
  waiting on the hard half.

## Status log

- 2026-09-20T18:40 — filed from `f4149e`, where the spec's prescribed fix
  target turned out not to exist and the field that does exist has no
  consumers. Specimens re-verified individually rather than carried over;
  one of the four circulating claims (`archive_root`) is false and is
  recorded as the false-positive guard rather than dropped.
- 2026-09-20T19:10 — b6 supplied the RED eval lock's real symbol
  (`stampEvalShas`); verified independently and promoted to the third
  specimen. It is the strongest of the three: provably never-called across
  the whole history, and test-covered-but-production-dead, which makes it
  AC 4's fixture rather than just another instance. b6 also confirmed the
  `archiveRoot` correction at source.
