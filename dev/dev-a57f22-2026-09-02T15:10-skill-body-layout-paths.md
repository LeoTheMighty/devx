---
hash: a57f22
type: dev
created: 2026-09-02T15:10:00-06:00
title: "Skill bodies name the folder shape, not the layout"
status: in-progress
from: dev/dev-dlr107-2026-09-02T09:14-doc-truth.md
blocked_by: []
branch: null
owner: /devx-2026-09-03T0956-12807
---
## Goal

Nine path references in the two writing skills hardcode the
folder-per-artifact shape. Under `engine.docs_layout: project-level` an agent
following those instructions writes into `_devx/workstreams/<slug>/prd/` while
every CLI consumer — gates, `devx next`, `devx todo sync`, scaffolding —
reads the flat root. That is the same reader/writer split the
docs-layout-resolution workstream exists to close, one layer out: dlr101–106
closed it in code, and the skill bodies are where the WRITER's instructions
live.

Filed by dlr107 (AC 6) rather than fixed there: dlr107's own diff is
docs + schema + tests, and this one edits shipped skill prose that the S-1
canary measures.

The sites:

- `.claude/commands/devx-plan.md` — lines 12, 113, 129, 135, 165, 223
- `.claude/commands/devx.md` — lines 189, 203, 698

## Acceptance criteria

- [ ] AC 1: Each of the nine references either resolves through the layout
      ("the workstream's `plan/agent.md` — under `project-level`, `plan.md` at
      the repo root") or is replaced by the CLI that already resolves it.
      Prefer the CLI: a skill body that names a command cannot drift from the
      resolver, and a skill body that names a path can.
- [ ] AC 2: The rewrite does NOT restate §15's table. `docs/CONFIG.md` §15 is
      the registry (dlr107); the skill bodies link to it. A second copy of the
      table is the failure this workstream is about.
- [ ] AC 3: A test pins the invariant — no shipped skill body spells a
      workstream-relative artifact path as if it were absolute-truth. Model it
      on `test/engine-layout-docs-truth.test.ts`: scan the two files for the
      `_devx/workstreams/<slug>/<artifact>` shape and require each hit to sit
      inside a layout-qualified sentence, or be absent. The scan reads prose,
      so it must be structural (a path-shape regex plus a proximity check),
      never a wording diff.
- [ ] AC 4: S-1 stays green — `test/engine-prose-budget.test.ts` passes
      without raising `engine.prose_budget_kb`. Measured 2026-09-02 on
      `main`: the CI-gated surface (`_devx/templates/engine/**` +
      `.claude/commands/devx-plan.md`) is **55,338 of 61,440 bytes — 6,102
      bytes of headroom**, so this fits comfortably; prefer the CLI-naming
      rewrite anyway, which is shorter than the prose it replaces.
      `.claude/commands/devx.md` is NOT in the canary's surface, but it is in
      the full-run surface behind INTERVIEW Q#9 (64.2 KB vs the 60 KB
      end-to-end target) — do not grow it.
- [ ] AC 5: `npm test` green; `devx graph --check` green.

## Technical notes

dlr107's spec sized this as blocked on "single-digit bytes of headroom"
against the 60 KB budget. That figure did not survive measurement — it
conflated the CI-gated canary surface with the Q#9 full-run surface. The
canary has 6,102 bytes free. The work is still worth its own item (it edits
the two most load-bearing prose files in the repo, and AC 3's scan is a real
piece of test design), but it is not budget-blocked.

Related: `dev-lay101` (the `project-level` one-doc-set refusal, still
unenforced) — same family, different surface.

## Status log

- 2026-09-02T15:10 — filed by /devx on dlr107 (AC 6); nine sites confirmed
  present at the cited line numbers on `feat/dev-dlr107`, and the S-1
  headroom re-measured rather than inherited.
- 2026-09-03T09:56:47-06:00 — claimed by /devx in session /devx-2026-09-03T0956-12807
