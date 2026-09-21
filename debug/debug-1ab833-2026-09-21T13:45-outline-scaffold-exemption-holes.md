---
hash: 1ab833
type: debug
created: 2026-09-21T13:45:00-06:00
title: "L2's scaffold exemption lets a PR erase or rewrite a human outline and still pass"
from: debug/debug-00b4d3-2026-09-02T14:36-migration-commit-blocked-by-outline-check.md
status: ready
owner: null
branch: null
---

## Goal

`devx outline check` — L2 of the human-only outline guarantee — must fail a
PR that erases or rewrites a human-typed outline. It does not, in several
shapes that all predate `debug-00b4d3` and were found by that story's
three-agent review. None is a rename, so they were deliberately NOT fixed
there: `00b4d3`'s own spec says a guard change gets its own diff and its own
review, and folding these in would have widened a rename fix into a rewrite
of the exemption.

All reproduced by the reviewers against both the pre-00b4d3 code and the
fixed code — same verdict both times, so none is a regression.

## The holes

1. **HIGH — overwrite a human outline with the pristine scaffold.** A PR that
   replaces a human outline's content with the untouched `devx outline init`
   scaffold shows as `M`, the scaffold exemption classifies it pristine, and
   the check exits 0. The human's bullets are deleted. The exemption exists
   so that BOOTSTRAPPING an empty outline can ride a PR; it was never meant
   to cover a file that already held human content. (Edge Case Hunter C2.)
2. **HIGH — template poisoning.** `scaffoldBodies`
   (`src/lib/engine/outline-scaffold.ts:~177`) accepts the repo's own copy of
   the template under `_devx/templates/engine/` as a pristine scaffold, and
   templates are not protected. So one PR can set the template to arbitrary
   text X and a human outline to X, and the outline is exempt as a
   "scaffold" (both reviewers; Auditor scenario S19). Worse in two PRs: land
   the template first, and every L2 site reads it as legitimate. `devx
   outline init`, which agents may run, would then stamp the agent's text
   into new outlines.
3. **MED — symlinked stage directory.** Make a workstream's stage directory a
   symlink to an unprotected directory holding an outline with agent text.
   The diff shows the symlink and an unprotected file; the check exits 0,
   and reading through the workstream path yields the agent text. (Blind
   Hunter P2.)
4. **Decision needed — archived outlines are not protected.** An archived
   workstream's outline (`<archive_root>/<slug>/<stage>/`) matches no
   protected shape, so after `devx archive` an agent may edit it freely.
   `00b4d3` keeps `devx archive --restore` blocked precisely so those edits
   cannot be laundered back into a protected outline — but whether archived
   outlines should stay human-only at all is a product decision, filed as an
   INTERVIEW question rather than decided here.

## Acceptance criteria

- [ ] AC 1: Each of holes 1–3 has a failing repro test against real git.
- [ ] AC 2: The scaffold exemption applies only to an outline ADDED by the
      PR (status `A`), never to one that existed at the base — a modified or
      replaced outline blocks even when its new content is the scaffold.
- [ ] AC 3: The pristine scaffold is read from a source the PR cannot
      change: the base revision's template, or the scaffold shipped with the
      CLI — never the head's working-tree copy.
- [ ] AC 4: A symlink at or above a protected outline's path blocks.
- [ ] AC 5: No legitimate flow regresses: `devx outline init` bootstrapping
      in a PR, `devx layout migrate`, and `devx archive` still pass
      (`test/outline-check-renames.test.ts`, `test/outline-check-git.test.ts`).
- [ ] AC 6: Hole 4 routed to INTERVIEW.md with a recommendation; not decided
      in code.
- [ ] AC 7: Phase 4 three-agent review BEFORE merge — this is the guard.

## Status log

- 2026-09-21T13:45-06:00 — filed from `debug-00b4d3`'s Phase 4 three-agent
  review (Blind Hunter P1/P2, Edge Case Hunter P1/P2, Acceptance Auditor
  S19). Every hole reproduced by the reviewers against both the pre- and
  post-00b4d3 code with the same verdict — pre-existing, not introduced.
