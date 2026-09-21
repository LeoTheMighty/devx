---
hash: f4149e
type: debug
created: 2026-09-02T11:55:00-06:00
title: "An ASCII `->` in a todo.md phase pointer silently disables truing and drift for the whole workstream"
status: in-progress
owner: palateful-fb (session_01CRtBZrqLympjpdFnUonhZy)
branch: fix/f4149e-phase-pointer-loud
from: dev/dev-dlr103-2026-09-02T09:14-workstream-resolution-flat-guard.md
---
## Goal

`devx todo sync` trues `Phase <n>:` pointer lines against the linked dev
spec's `status:`, and `devx status` / `devx next` report `phase-pointer` drift
when the two disagree. Both are supposed to be mechanical.

Expected: a phase line whose dev spec is `done` gets checked by sync; a
mismatch is reported as drift.

Actual: **neither happens, silently**, if the line separates its title from
its dev-hash with an ASCII `->` instead of the Unicode `→`.
`POINTER_RE = /\s+→\s+(\S+)\s*$/` (`src/lib/engine/todo.ts:115`) matches only
the Unicode arrow. On a miss, `pointerOf()` returns `null`; the item still
parses as `kind: "phase"`, so it passes every structural check, but
`phaseDoneFor()` never keys it (`todo-truth.ts:68` guards on
`item.pointer !== null`) and `todoDrift()` skips it the same way
(`todo.ts:275`). The line is inert, and nothing says so.

## Evidence

`_devx/workstreams/docs-layout-resolution/todo.md` carried `->` on all 7
phase lines. With dlr101/dlr102/dlr103 all merged and their dev specs
`status: done`:

```
$ devx todo sync a494be
{"hash":"a494be","created":false,"trued":[]}

$ devx status | grep -A2 docs-layout
docs-layout-resolution (a494be)  stage: executing
  focus: Phase 1: The artifact map and the single layout reader -> dlr101   <- Phase 1 shipped 2026-09-02
```

After converting the 7 arrows to `→` and changing nothing else:

```
$ devx todo sync a494be
{"hash":"a494be","created":false,"trued":["Phase 1 → checked","Phase 3 → checked"]}

$ devx status | grep -A2 docs-layout
  focus: Phase 4: Consumer sweep and layout-aware scaffolding → dlr104
```

Two consequences worth naming:

- **The focus pointer had been wrong for the life of the workstream**, naming
  a shipped phase. `focus:` is what `devx next` and the overnight loop read to
  decide what a session works on.
- **Phases 1 and 2 read `[x]` because earlier sessions hand-checked them** —
  the exact thing `/devx` Phase 2 step 3 forbids ("Derived `Stage:` / `Gate:` /
  `Phase <n>:` lines belong to sync — never hand-check them"). The rule was
  followed by nobody because the mechanism it defers to was dead, and the
  workaround looked like it worked.

Survey at the time of filing — this workstream was the only one affected;
`harness-fold-in`, `mid-story-split`, `multi-loop-concurrency`,
`retro-listener` and `story-graph` all use `→`:

```
$ for f in _devx/workstreams/*/todo.md; do ... done
_devx/workstreams/docs-layout-resolution/todo.md  ascii=7 unicode=0
(every other workstream: ascii=0)
```

## Acceptance criteria

- [x] AC 1: Repro — a `todo.md` with one `->` phase line whose dev spec is
      `done`; assert today's behavior (no true, no drift, no warning), then
      assert the fixed behavior.
- [x] AC 2: Decide and implement ONE of: (a) accept both arrows in
      `POINTER_RE`, or (b) keep `→` canonical and make the miss LOUD — a
      `Phase <n>:` line under a `Stage:` parent that yields no pointer is a
      malformed derived line and belongs in `TodoDoc.violations`, which
      `parseTodo` already carries for exactly this class. (b) is the better
      shape if the arrow is meant to be canonical: leniency that silently
      drops a mechanism is not leniency, it is a hole. Whichever is chosen,
      the OTHER form must not stay silently inert.
- [x] AC 3: Whatever emits phase pointer lines writes the canonical form. The
      shipped template documents `→` (`_devx/templates/engine/todo.md:11`), so
      establish where the `->` in this workstream came from — the plan-stage
      emitter, `devx todo sync`'s scaffold, or hand-authoring — and close it
      there too. A parser fix alone leaves the next hand-typed `->` inert
      under option (a) only.
- [x] AC 4: Regression test; and add the expectation to the owning
      workstream's `evals/` if one owns `todo.md`'s derived-line contract
      (harness-fold-in shipped it) — otherwise say so here explicitly.

## Technical notes

`parseTodo` is documented "lenient by contract: never throws". Leniency is
right for free text; it is wrong for a line that matches the derived
vocabulary's shape (`Phase <n>: …` under `Stage:`) but fails its pointer
contract. That line is not free text — it is a derived line with a typo, and
`violations` exists to say so.

The immediate data fix (7 arrows in this workstream's `todo.md`) shipped with
the dlr103 merge bookkeeping; this spec is the structural half.

Filed out of scope by dlr103 (`/devx` Phase 8 step 2): found while verifying
that item's own `todo.md` bookkeeping, but the defect is in the derived-line
contract, not in layout resolution.

## Findings (2026-09-20)

Three things the spec assumed turned out to be wrong or unmeasured. All three
were checked against the code and the repo, not reasoned about.

**1. `TodoDoc.violations` does not exist.** AC 2's option (b) says the
malformed line "belongs in `TodoDoc.violations`, which `parseTodo` already
carries for exactly this class". There is no such field. `TodoDoc` carries
`items` and `unparsedTopLevel: number[]` (`todo.ts:50-56`), and
`unparsedTopLevel` has **zero consumers outside `todo.ts` itself** — it is
computed on every parse, stored, and never read by any command.

That matters more than a naming correction: implementing (b) as written would
have routed the new signal into a field nobody reads, producing a detector
that reports nowhere. That is the same defect as the bug being fixed, one
level up.

**2. The population is zero, so there is nothing to drain.** Re-surveyed
2026-09-20 across every `todo.md` in both repos — 12 files, not just the live
workstream dirs:

```
devx  _devx/archive/harness-fold-in          ascii=0 unicode=5
      _devx/archive/multi-loop-concurrency   ascii=0 unicode=6
      _devx/archive/mid-story-split          ascii=0 unicode=4
      _devx/archive/retro-listener           ascii=0 unicode=6
      _devx/archive/docs-layout-resolution   ascii=0 unicode=7
      _devx/archive/story-graph              ascii=0 unicode=7
      _devx/archive/portability-install      ascii=0 unicode=0
      _devx/archive/blocker-push-interim     ascii=0 unicode=0
      _devx/templates/engine                 ascii=0 unicode=0
      _devx/workstreams/usage-window-governor ascii=0 unicode=0
pal   _devx/workstreams/browser-qa-agent     ascii=0 unicode=7
      _devx/workstreams/rotation-self-heal   ascii=0 unicode=9
```

The first pass of this survey only globbed `_devx/workstreams/*/todo.md` and
would have missed 8 of the 12 files: devx has since archived all but one
workstream into `_devx/archive/`, so the live dir holds a single workstream
that has no phase lines yet. The wider search was run because that number
looked wrong, and the zero holds on the complete set — but the partial survey
is worth recording as a near-miss, since it would have supported the same
conclusion for the wrong reason.

The single `->` hit in `usage-window-governor/todo.md` is `-->`, the close of
the template's HTML contract comment, not a pointer. The only real instance
(docs-layout-resolution, 7 lines) was repaired by the dlr103 bookkeeping. So
no normalisation pass is needed, and this fix is purely forward-looking — the
`fxfuse` drain problem does not apply here. Recorded because "zero" is a
measurement, and the next person should not have to re-derive it.

**3. Nothing emits phase pointer lines, so AC 3 closes by inspection.**
`trueDerivedLines` only flips a checkbox in place (`lines[line - 1].replace(/\[( |x)\]/, …)`)
— it never writes a pointer. The shipped template carries `Stage:` and
`Gate:` lines but no `Phase` lines at all. So every phase line in existence is
hand-authored, and the `->` came from a human typing it, exactly as AC 3's
third option guessed. There is no emitter to fix.

Worth noting the near-miss: `src/lib/graph/backfill.ts:274` holds a *second*
phase-pointer regex, `PLAN_PHASE_POINTER_RE`, but it reads a different
artifact (`plan/agent.md`) with a different syntax — `Phase 1: … (dev spec:
v2x101)`, parenthesised, no arrow. It is unaffected by this bug and must not
be "unified" with `POINTER_RE`; the two encode different contracts.

## Decision (AC 2): option (b), and why not (a)

Accepting both arrows would fix the one typo that was observed and leave the
class intact. `=>`, `-->`, a non-breaking space around the arrow, a trailing
comment after the hash — every one of those still yields `pointer: null` and
still vanishes silently. Widening the regex buys one character and keeps the
hole.

Making the miss loud covers every near-miss, including the ones nobody has
typed yet. A `Phase <n>:` line under a `Stage:` parent is not free text — it
matched the derived vocabulary's shape and then failed its pointer contract,
which is precisely the case the spec's own Technical notes argue should not be
treated leniently.

The signal rides `computeTodoDrift`, **not** a new field, because drift is the
channel that is already consumed end-to-end: `computeTodoDrift` -> `gather.ts`
-> `decide.ts` -> `next.ts:250`, which prints every row generically as
`todo-drift (<class>) <slug>: <message>`. The new class surfaces in both
`devx next` forms with no further wiring, and in the JSON as `todo_drift`.
Choosing an already-consumed channel over a new one is the direct lesson of
finding (1).

## Implementation

- `TodoDriftClass` gains `"phase-pointer-malformed"`.
- `computeTodoDrift` gains a branch for `kind === "phase" && pointer === null`
  ahead of the existing `pointer !== null` branch. The message names the line,
  says sync and drift both skip it, and states the canonical form including
  the codepoint (U+2192) — a reader hitting this cannot see the difference
  between the two arrows in most terminals, so the message says it in words.
- `POINTER_RE` keeps its exact shape and gains a comment recording that the
  narrowness is deliberate and why widening was rejected, so the next reader
  does not "fix" it back.

Two regression tests in `test/next-todo-drift.test.ts`, at CLI level:

- the ASCII fixture now yields exactly one `phase-pointer-malformed` row at
  the right line, renders on stderr, and is **not** classed as an ordinary
  `phase-pointer` contradiction (there is no done-state to contradict when the
  pointer could never be read);
- the canonical arrow does **not** produce the new class — without this, the
  class would fire on every healthy phase line in the repo and be ignored
  within a day, which is the failure mode this bug is an instance of.

Both are mutation-verified: neutering the new branch (`false &&`) fails the
ASCII test and leaves the other five green. The fixture also asserts its own
`->` substitution landed, so a silent no-op in the replace cannot let the test
pass against the canonical arrow and prove nothing.

## Unrelated red found while running the suite

`test/workstream-migration-integrity.test.ts` fails on clean unmodified
`main` (`slugs.length >= 9`, actual 1) — the archival moved 8 of 9
workstreams into `_devx/archive/` and the floor did not move. Not caused by
this change and **filed separately as `debug/debug-wsmig1-…`** rather than
carried in this PR: unrelated cause, and the fix is a judgement about what
the invariant protects.

Rest of the suite: 139 files / 3292 tests pass.

## AC 4 — eval placement

`harness-fold-in` owns `todo.md`'s derived-line contract and ships
`evals/E-4_next-todo-drift.ts`; `test/next-todo-drift.test.ts` is that eval's
permanent suite, and the two new cases are added there rather than in a new
file. No separate eval artifact is needed.

## Status log

- 2026-09-02T11:55 — filed by /devx during dlr103 post-merge verification,
  after `devx todo sync a494be` reported `trued: []` for a phase whose dev
  spec was `done`.
- 2026-09-20T18:05 — claimed and fixed on `fix/f4149e-phase-pointer-loud`.
  Chose AC 2 option (b). Corrected three spec assumptions: `TodoDoc.violations`
  does not exist (and `unparsedTopLevel`, the field that does, has no
  consumers); the affected population is zero today, so no drain is needed;
  and nothing emits phase lines, so AC 3 closes by inspection rather than by a
  code change.
- 2026-09-20T18:50 — filed the two out-of-scope findings as their own specs
  rather than leaving them in this one: `inert1` (computed-and-never-read as
  a testable class, from the dead `unparsedTopLevel`) and `wsmig1` (the
  hardcoded workstream floor the archival invalidated).
