---
hash: lay101
type: dev
created: 2026-09-01T12:40:00-06:00
title: "Enforce project-level's one-doc-set rule at the config seam"
from: null
spawned: []
status: ready
owner: null
branch: null
---

## Goal

`engine.docs_layout: project-level` holds **exactly one** in-flight doc set —
the flat repo-root shape has nowhere to put a second PRD. Nothing enforces
that today.

It used to be enforced, in prose, by `/devx-personalize`: the skill refused to
record `docs.layout: project-level` while more than one workstream was in
flight, naming the slugs it found. When the layout moved out of the preference
bank into `engine.docs_layout` (2026-09-01), that refusal lost its home — the
skill no longer owns the key. The constraint is documented in `docs/CONFIG.md`
§15 rule 3 and enforced by nothing.

Two things can violate it, and they want different answers:

1. **Setting the layout** to `project-level` in a repo that already has ≥2
   live workstreams.
2. **Creating a second workstream** (`devx workstream new`) in a repo already
   on `project-level` — the case `docs/PERSONALIZATION.md` §4.1 called out as
   never having carried the matching refusal, even when the interview did.

## Acceptance criteria

1. `devx workstream new` refuses under `engine.docs_layout: project-level`
   when a doc set already exists at the repo root, naming what it found and
   the two ways forward (finish that one, or switch layouts). Exit 1
   (refusal), not 2.
2. A layout-vs-repo-state mismatch that already exists is surfaced by
   `devx doctor` as a finding — a repo that got into this state some other way
   (a hand config edit, a merge) should not stay silently broken. Advisory
   class; `devx doctor --fix` never moves artifacts on its own.
3. Neither check reads a preference profile. This is repo state vs committed
   config; both inputs are committed.
4. The rules live in one pure predicate with unit tests over the state matrix
   (0/1/≥2 doc sets × both layouts), consumed by both call sites — not two
   hand-rolled copies that can disagree.
5. `docs/CONFIG.md` §15 rule 3 loses its "not mechanically enforced today"
   caveat and names the enforcing surfaces instead.

## Technical notes

- Layout resolution is already central: `docsLayoutFrom()` in
  `src/lib/engine/artifacts.ts` (reads `engine.docs_layout`, falls back to the
  legacy `personalization["docs.layout"]`). Wrap it; do not re-read config.
- "A doc set exists at the root" is `projectAgentRel(stage)` / `prd.md` etc.
  from the same module — reuse the resolvers rather than joining basenames.
- `src/lib/doctor/detect.ts` owns finding classes; this is a new class, and
  `src/lib/doctor/types.ts` carries the union.
- Scope guard: this story does NOT migrate a tree between layouts. Moving
  artifacts is a separate, riskier piece of work (`/devx-personalize` used to
  state the migration cost precisely because nothing automated it).

## Status log

- 2026-09-01T12:40 — Filed while moving `docs.layout` → `engine.docs_layout`
  (the layout is repo policy, not a preference). The move deliberately dropped
  the interview-side refusal rather than leaving it in a skill that no longer
  owns the key; this spec is the replacement, filed so the enforcement gap is
  recorded rather than silently lost.

## Links

- `docs/CONFIG.md` §15 — `docs_layout`, the two shapes, rule 3
- `docs/PERSONALIZATION.md` §3 — why the key was routed out of the bank
- `src/lib/engine/artifacts.ts` — `docsLayoutFrom()`, project-level resolvers
