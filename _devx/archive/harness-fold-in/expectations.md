# Expectations — Harness Fold In

<!-- Gate 1 input. Minimum 3 E-blocks (config: engine.expectations_min).
     Every business goal (G-) must be covered by at least one expectation;
     every Covers: ID must resolve in prd.md. EARS regex enforced by
     `devx gate prd`: "When .+, the system SHALL .+". A P0 with a vague
     Verified-by target fails the gate. -->

## E-1: todo.md scaffold honors the parse contract

- **Priority:** P0
- **Covers:** `FR-1, CAP-1, UC-2`
- **Trigger:** `devx workstream new <slug>` on a repo with the engine
  templates installed.
- **Expectation (EARS):** When a workstream is scaffolded, the system SHALL
  create `_devx/workstreams/<slug>/todo.md` from the engine template with
  the full devx lifecycle skeleton, whose top-level line prefixes match the
  parse contract exactly.
- **Threshold:** 100% of skeleton items present in template order; the
  parser extracts all lifecycle items from a fresh scaffold with 0 unparsed
  top-level lines.
- **Verified by:** `test/workstream-todo-scaffold.test.ts`

## E-2: Gates never read todo.md

- **Priority:** P0
- **Covers:** `FR-3, CAP-1`
- **Trigger:** Any `devx gate prd|coverage|evals` invocation.
- **Expectation (EARS):** When any gate command executes, the system SHALL
  compute its verdict without reading `todo.md` — an unchecked item blocks
  nothing and a checked item proves nothing.
- **Threshold:** Static read-surface assertion: 0 references to `todo.md`
  in the gate implementation modules; gate verdict on a fixture workstream
  is byte-identical with `todo.md` present, absent, fully checked, and
  fully unchecked (4/4 fixtures).
- **Verified by:** `test/gate-todo-isolation.test.ts`

## E-3: Gate verdicts persist, including FAIL

- **Priority:** P0
- **Covers:** `FR-6, FR-7, G-2, UC-3, CAP-3`
- **Trigger:** Any gate run completing with any verdict; a subsequent
  `devx revise` cascade touching that gate's stage.
- **Expectation (EARS):** When a gate command completes, the system SHALL
  persist its verdict (`PASS|CONCERNS|FAIL|WAIVED`) additively in the plan
  spec's frontmatter without altering existing `gate_status` booleans, and
  the revise cascade SHALL clear the verdicts whose flags it resets.
- **Threshold:** 100% of gate runs across all 3 gate commands write the
  verdict in fixtures (including FAIL runs); post-revise, reset stages read
  verdict `null`; `devx next` renders FAIL distinctly from never-run in
  both fixtures.
- **Verified by:** `test/gate-verdict-persist.test.ts`

## E-4: Drift detection is mechanical and advisory

- **Priority:** P1
- **Covers:** `FR-4, CAP-2, G-1`
- **Trigger:** `devx next [<hash>]` over a workstream whose `todo.md`
  contradicts ground truth.
- **Expectation (EARS):** When a "Pass Gate" item contradicts its
  `gate_status` flag or a phase pointer line contradicts phase state, the
  system SHALL report an advisory drift row naming the contradiction class,
  without failing the command or mutating any file.
- **Threshold:** Both contradiction classes detected (2/2 fixtures); exit
  code unchanged vs the no-drift fixture; 0 file writes.
- **Verified by:** `test/next-todo-drift.test.ts`

## E-5: Current focus derives from ground truth

- **Priority:** P1
- **Covers:** `FR-5, G-1, UC-1, UC-5`
- **Trigger:** `devx next` / `devx status` on a workstream with `todo.md`.
- **Expectation (EARS):** When rendering a workstream that has a `todo.md`,
  the system SHALL emit a one-line current focus equal to the first
  unchecked deepest item under the frontmatter-derived current stage, and
  SHALL omit the line without error when `todo.md` is absent.
- **Threshold:** Focus line correct on 3 fixtures (mid-intake, mid-execute,
  stale hand-checked stage-parent — the stale checkbox does not move the
  focus head); absent-file fixture exits 0 with no focus line.
- **Verified by:** `test/next-current-focus.test.ts`

## E-6: /devx-learn guard rails hold

- **Priority:** P1
- **Covers:** `FR-8, FR-9, CAP-4, G-3, UC-4`
- **Trigger:** `/devx-learn` deriving branch/PR identifiers from a session
  containing hostile or degenerate material (injected directives,
  shell-metachar slugs, empty session).
- **Expectation (EARS):** When `/devx-learn` derives branch or PR
  identifiers, the system SHALL sanitize them to `[a-z0-9-]`, ≤40 chars
  (empty → `session-retro`), and the shipped skill body SHALL carry the
  locked-machinery and untrusted-input guard sections.
- **Threshold:** Slug fuzz set (≥8 cases: metachars, unicode, >40 chars,
  empty, injection strings) → 100% sanitized by the pure helper; static
  skill-body assertion finds both guard sections (dvx103/dvx107 precedent).
- **Verified by:** `test/learn-skill-guards.test.ts`

## E-7: Lifecycle skill bodies carry the todo write steps

- **Priority:** P2
- **Covers:** `FR-2, FR-10, UC-5`
- **Trigger:** CI over the shipped skill bodies.
- **Expectation (EARS):** When the skill bodies are checked in CI, the
  system SHALL find a todo seed/reconcile/write step in each `/devx-plan`
  stage and the `/devx` execute arm, and exactly one canonical source for
  the friction-only learn nudge.
- **Threshold:** 5/5 stage+execute sections carry the step; nudge sentence
  defined in exactly 1 place and referenced (not restated) elsewhere;
  prose-budget canary stays under `engine.prose_budget_kb` (60KB).
- **Verified by:** `test/skill-todo-discipline.test.ts`
