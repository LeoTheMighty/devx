---
hash: f4149e
type: debug
created: 2026-09-02T11:55:00-06:00
title: "An ASCII `->` in a todo.md phase pointer silently disables truing and drift for the whole workstream"
status: ready
owner: null
branch: null
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

- [ ] AC 1: Repro — a `todo.md` with one `->` phase line whose dev spec is
      `done`; assert today's behavior (no true, no drift, no warning), then
      assert the fixed behavior.
- [ ] AC 2: Decide and implement ONE of: (a) accept both arrows in
      `POINTER_RE`, or (b) keep `→` canonical and make the miss LOUD — a
      `Phase <n>:` line under a `Stage:` parent that yields no pointer is a
      malformed derived line and belongs in `TodoDoc.violations`, which
      `parseTodo` already carries for exactly this class. (b) is the better
      shape if the arrow is meant to be canonical: leniency that silently
      drops a mechanism is not leniency, it is a hole. Whichever is chosen,
      the OTHER form must not stay silently inert.
- [ ] AC 3: Whatever emits phase pointer lines writes the canonical form. The
      shipped template documents `→` (`_devx/templates/engine/todo.md:11`), so
      establish where the `->` in this workstream came from — the plan-stage
      emitter, `devx todo sync`'s scaffold, or hand-authoring — and close it
      there too. A parser fix alone leaves the next hand-typed `->` inert
      under option (a) only.
- [ ] AC 4: Regression test; and add the expectation to the owning
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

## Status log

- 2026-09-02T11:55 — filed by /devx during dlr103 post-merge verification,
  after `devx todo sync a494be` reported `trued: []` for a phase whose dev
  spec was `done`.
