# Proposal: work types — a lightweight track for bugs and tasks

**Status:** proposal. Nothing here is implemented. Ported from
`mycase/8am-harness` PR #66 (open, itself still a draft) and re-grounded in
devx's own spec-type model.

---

## The problem

devx has exactly one shape of work that gets the full engine: a workstream,
run through PRD → Design → Plan → RED, four gates, then phases. That shape is
correct for a feature. It is absurd for "the merge tail leaves a spec lock
behind."

So small work escapes the engine entirely. It goes straight to `dev/` or
`debug/` as a spec with hand-written ACs, and skips everything the engine is
actually good at — investigation grounded in code truth, a recorded decision,
cross-workstream context, evidence-based verification. The useful parts and
the ceremonial parts are welded together, and dodging the ceremony means
dodging the rigor.

The result is visible in this repo's own backlog: `debug/` and one-off `dev/`
specs carry no expectations, no coverage table, no eval — and their status
logs are correspondingly thin. They are the items most likely to be redone.

## The proposal

A **work type** on every spec: `feature` | `bug` | `task`.

| | `feature` | `bug` | `task` |
| --- | --- | --- | --- |
| Ceremony | Full workstream: 4 gates, phases | Repro-first, no gates | None |
| Artifacts | `<root>/<slug>/` stage folders | `debug/` spec + a repro eval | `dev/` spec only |
| Required discipline | Everything today's engine requires | **A committed repro before any fix** | Evidence in the status log |
| Emits | Dev specs per phase | One PR | One PR |
| Retro | At workstream close | Feeds the owning workstream's retro | None |

`feature` is exactly today's behavior, renamed. The proposal adds nothing to
it and changes nothing about it.

## What the light types keep, deliberately

The point is not "less rigor." It is *the rigor that pays at this size*:

- **Repro before fix** (`bug`). This is devx's strongest single discipline and
  the one most often skipped on small work. It is the RED gate at bug scale —
  same claim (this artifact was watched failing before code existed to pass
  it), a fraction of the cost. It is also what makes the incident-becomes-eval
  rule work: a repro is already the eval.
- **Grounded investigation.** A `task` still grep-verifies every path it
  cites. Cheap, and it is where most small-work rework comes from.
- **Evidence in the status log.** Hypothesis → check → result. One line each.
- **The self-review.** Non-skippable at every size — the empirical record is
  that it catches real bugs on small diffs too.

## What they drop

- The four gates and their artifacts. A `bug` has no PRD to gate.
- The workstream folder. `bug` and `task` stay flat in `debug/` / `dev/`.
- Phases. One item, one PR, by construction.
- The coverage table and expectations file.

## Open questions — the sharpest ones first

1. **Does `task` earn its own type at all?** The strongest version of this
   proposal may be **bug-only**. `task` risks becoming the default anyone
   reaches for to skip a gate, which is precisely the failure mode the
   ceremony exists to prevent. A `task` that turns out to need a design is
   worse than a `feature` that was over-ceremonied. *Recommendation: ship
   `bug` first, measure how often `feature` was the wrong call, and let that
   decide whether `task` exists.*
2. **Where does the type live?** Frontmatter `type:` already exists and means
   the spec's *kind* (`dev`, `debug`, `test`, `qa`). A work type is an
   orthogonal axis — a `dev` spec can be a task. This needs a second field
   (`work_type:`), not an overloading of the first. Overloading `type:` would
   break every consumer that switches on it.
3. **What promotes a `bug` to a `feature`?** Discovering mid-repro that the
   bug is a missing capability is common. There must be a named promotion
   path that does not lose the repro — probably: the repro becomes the new
   workstream's first expectation, and the bug spec closes pointing at it.
4. **Does `devx next` rank light items above or below workstream phases?** A
   `bug` blocking a workstream should outrank it; a cosmetic `task` should
   not. This likely needs the existing blocked-by graph rather than a new
   priority field.
5. **What does the merge gate do differently?** Probably nothing — mode still
   governs, CI still runs. Worth confirming there is no gate that assumes a
   workstream exists.

## Cost estimate

"No new skills" does not mean no work. The engine's artifact set is welded
into the gate-flag chain, so every consumer that assumes a workstream needs a
branch: `devx next` row construction, `devx todo sync`, `devx status`, the
gate resolvers, `devx graph` grouping, and the retro/outcome arms. Upstream's
audit of the equivalent surface found ~13 skill-level edits; devx's CLI-heavy
shape probably trades some of those for typed code changes, which is the
better trade.

**A `CLAUDE.md` / `docs/DESIGN.md` amendment must precede any of it** — the
spec-file convention is documented as the contract, and a second axis on it
is a contract change, not an implementation detail.

## Prior art in this repo

devx already ships two-thirds of `bug` under a different name: `/devx`
**Stage: Debug** is repro-first, files to `DEBUG.md`, and routes the fix
through the normal execute arm. This proposal is largely a matter of naming
that path, giving it a frontmatter field, and letting `devx next` rank it —
rather than inventing a track from scratch.

---

*Ported from `mycase/8am-harness` #66. Upstream's outline + critique pair is
still iterating; this doc is devx's independent read, not a translation.*
