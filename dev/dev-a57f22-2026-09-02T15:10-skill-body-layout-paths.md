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
- 2026-09-03T10:00 — phase 2: spec ACs direct (v2 native); 5 ACs;
  workstream=none (plain dev spec, `from: dlr107`; no `gate_status:`, so no
  locked-eval verification applies); red-artifacts=none.
- 2026-09-03T10:05 — phase 3: rewrote all 9 cited sites plus 3 uncited ones of
  the same shape (devx.md Key References, and the `checkpoint.md` /
  `decision.md` engine templates). 2 sites resolve via the CLI that already
  resolves them (`devx todo sync` in both skills — AC 1's preferred form); the
  rest became doc-set-relative names covered by each document's existing
  **Layout:** anchor, extended by one sentence pointing at `docs/CONFIG.md`
  §15. No path-printing CLI exists today (`devx layout` has only `migrate`),
  which is why the CLI form was available at only 2 of 9 — noted as a
  follow-up rather than built here. AC 3's guard is
  `test/skill-body-layout-paths.test.ts`.
- 2026-09-03T10:13 — phase 4: sequential multi-lens adversarial review (Blind
  Hunter / Edge Case Hunter / Acceptance Auditor run one at a time, context
  reset between). The **parallel shape was unavailable**: this session's
  policy forbids subagent fan-out ("Do not call the AgentTool unless the user
  requested it"), so per `/devx` Phase 4 step 2b an above-threshold surface
  (multi-regex) takes a sanctioned compensation rather than a plain single
  pass. 7 findings (2 HIGH, 3 MED, 2 LOW); ALL fixed in-place; re-review
  clean. Most load-bearing: the scan regex required a path segment after
  `<root>/`, so it did **not** match the bare `` `_devx/workstreams/` ``
  form — which is exactly cited site devx-plan.md:12, i.e. the guard would
  not have caught the bug it was written for; the trailing segment is now
  optional and the bare-root shape is verified RED. Also HIGH: AC 4's
  measurement covered only the S-1 *canary* (6,102 B free) and missed the
  full-run *drift tripwire* in the same test file, which had **37 bytes** of
  headroom on `main` — the first draft (+588 B) reddened it. Others: the
  proximity check had no test of its own (a bug there would silently make the
  invariant vacuous); two shipped engine templates carried the same hardcoded
  root and were outside the scan; byte-trimming had dropped the
  `project-level` outline filename that rule 8's own "Present → read it" step
  depends on.
- 2026-09-03T10:30 — phase 5: local gates green in the worktree —
  `npm test` (build + typecheck + 140 parallel + 38 blocking test files,
  REAL_EXIT=0), `devx graph --check` clean (230 nodes / 448 edges / 25
  groups). AC 4 verified on both assertions without raising
  `engine.prose_budget_kb`: canary 6,127 B free; full-run tripwire 61 B free,
  up from 37 B on `main` (devx-plan.md −3 B, devx.md +1 B, templates −22 B).
  QA walkthrough emitted at `test/test-53bf7b-2026-09-03T10:14-a57f22-qa-walkthrough.md`
  — 5 machine checks executed inline with real evidence pasted, 2 human
  checks outstanding.
