# Plan — Harness Fold In

<!-- Stage: Plan. Gate: `devx gate coverage eac479` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. Default to
     more, smaller phases. One phase ≙ one dev spec ≙ one PR ≙ one tour. -->

## Current state

- Workstream position lives in plan-spec frontmatter (`stage:` +
  `gate_status:` booleans, `src/lib/engine/frontmatter.ts`); intent dies at
  every `/clear` — no `todo.md` exists anywhere.
- Gates (`src/commands/gate.ts`, three `applyEnginePatch` call sites at
  ~:170 / ~:310 / ~:431) flip booleans on pass and write **nothing** on FAIL
  — a FAILed gate is stored identically to a never-run gate. Verdict
  vocabulary exists (`src/lib/engine/verdict.ts` VERDICTS) but is never
  persisted.
- `devx next` (`src/lib/next/gather.ts` + `decide.ts` + `src/commands/next.ts`)
  renders workstream stage rows and backlog↔frontmatter `DriftEntry` advisory
  rows; no focus line, no gate history.
- `devx status` is an 11-line stub (`src/commands/status.ts`).
- `devx revise` (`src/lib/engine/revise.ts` CASCADE_TABLE +
  `src/commands/revise.ts`) resets gate flags; there are no verdicts to clear.
- Skills ship via the `skills/` mirror auto-globbed by
  `src/lib/init-skills.ts` (pin101); no `/devx-learn` exists. Framework
  friction observed in sessions evaporates.
- `package.json` `files:` already ships `_devx/templates` + `skills` — no
  packaging change needed anywhere in this workstream.

## Desired state

- Every scaffolded workstream carries `_devx/workstreams/<slug>/todo.md`
  (fixed lifecycle skeleton per the design's parse contract), maintained by
  the lifecycle skills, trued mechanically by `devx todo sync <hash>`, and
  **never read by any gate**.
- All three gates persist their D-9 verdict in an additive `gate_verdicts:`
  frontmatter map on every evaluated run (including FAIL); `devx revise`
  clears verdicts alongside the flags it resets.
- `devx next` and a real `devx status` render per-gate verdict summaries
  (FAIL distinct from never-run, with report path + re-run command), a
  current-focus line from the todo focus walk, and advisory todo-drift rows.
- `/devx-learn` ships (canonical `.claude/commands/devx-learn.md` +
  `skills/` mirror) with the three guards and the pure slug sanitizer
  (`devx learn-helper slug`); lifecycle skills carry todo seed/reconcile
  steps and a single-sourced friction-only learn nudge, all pinned by static
  tests.

## What we're NOT doing

- Per-workstream health/blocker queue (`plan-e5a9c0`), CI audit agent,
  external trackers (D-10), execution-graph parallelism (`plan-f1d6b2`),
  eval-manifest RED artifacts — PRD Non-goals verbatim.
- No UI/TUI/mobile rendering of focus or verdicts.
- No backfill of `todo.md` or `gate_verdicts` into shipped/closed
  workstreams (FR-1 grandfathering: next lifecycle touch creates it).
- No auto-applying `/devx-learn` findings — plan-first, user approval always.
- No new npm dependencies; no `devx.config.yaml` schema change; no changes
  to `gate_status` boolean shape or semantics.

## Expectation coverage

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 1 | tests-first | `test/workstream-todo-scaffold.test.ts` | full |
| E-2 | P0 | 1 | tests-first | `test/gate-todo-isolation.test.ts` | full |
| E-3 | P0 | 2 | tests-first | `test/gate-verdict-persist.test.ts` | full |
| E-4 | P1 | 3 | tests-first | `test/next-todo-drift.test.ts` | full |
| E-5 | P1 | 3 | tests-first | `test/next-current-focus.test.ts` | full |
| E-6 | P1 | 4 | tests-first | `test/learn-skill-guards.test.ts` | full |
| E-7 | P2 | 5 | tests-first | `test/skill-todo-discipline.test.ts` | full |

## Phase checklist

- [ ] Phase 1: todo core — template, parser, scaffold, gate isolation
- [ ] Phase 2: gate-verdict persistence + revise clearing + gate summary
- [ ] Phase 3: todo sync + focus/drift renderers + real `devx status`
- [ ] Phase 4: /devx-learn skill + slug helper
- [ ] Phase 5: lifecycle skill wiring + nudge single-sourcing

## Phases

### 1. Phase: todo core — template, parser, scaffold, gate isolation

**Overview**: Land the ground layer everything else reads: the shipped
`todo.md` template, the pure engine module (parse / focus walk / drift /
derived-line truing), scaffold wiring, and the two P0 pins — scaffold
honors the parse contract (E-1) and gates are firewalled from todo.md
(E-2). First because Phases 3 and 5 consume the module and the contract.

**Files**:
- `_devx/templates/engine/todo.md` — new template: header contract as HTML
  comment + the 11-line lifecycle skeleton from design §"todo.md parse
  contract". Ships automatically via existing `package.json` `files:` entry.
- `src/lib/engine/todo.ts` — new pure module (no I/O): `parseTodo`,
  `currentFocus`, `computeTodoDrift`, `trueDerivedLines` + the `TodoItem` /
  `TodoDoc` / `TodoGroundTruth` / `TodoDrift` interfaces from design
  §Interfaces.
- `src/lib/engine/workstream.ts` — add `todo.md` to `createWorkstream`'s
  write-if-missing template loop (TEMPLATES list feeding the scaffold at
  ~:257).
- `test/workstream-todo-scaffold.test.ts` — E-1 RED artifact.
- `test/gate-todo-isolation.test.ts` — E-2 RED artifact: static
  read-surface scan (0 `todo.md` references in `src/commands/gate.ts` +
  `src/lib/engine/gate-prd.ts` / `gate-coverage.ts` / `gate-evals.ts`) +
  4-fixture byte-identical gate output (todo present / absent / fully
  checked / fully unchecked).

**Context**:
- The parse contract is fixed: top-level derived lines match
  `/^- \[( |x)\] (Stage|Gate|Phase \d+): .+$/`; gate labels are the fixed
  set `prd | coverage(design) | coverage(plan) | evals`; phase pointers
  nest 2 spaces under `Stage: Execute`; anything deeper is opaque free text
  `{checked, depth, text}` — never validated.
- Focus walk starts from the frontmatter-derived current stage, never from
  checkbox state (E-5's stale-checkbox mitigation); absent file → `null`.
- Drift classes: (a) gate-flag, (b) phase-pointer — both directions.
- `computeTodoDrift` / `currentFocus` land here (pure, fully unit-testable)
  even though their CLI rendering lands in Phase 3 — the module is one
  cohesive concern; the wiring is another.
- E-2's byte-identity fixtures run against today's gates — the invariant is
  provable before Phase 2 touches gate.ts, and the static scan keeps it
  pinned afterward.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `devx workstream new` fixture produces `todo.md` with 100% of skeleton
    items in template order; `parseTodo` extracts all lifecycle items with
    0 unparsed top-level lines (E-1 threshold).
  - Static scan finds 0 `todo.md` references in gate implementation
    modules; gate verdict byte-identical across all 4 todo fixtures (E-2
    threshold).
  - `npm test` green (typecheck included per mgrret wiring).

**Tasks**:
- [ ] T1.1 Author the template with header contract + skeleton — files:
      `_devx/templates/engine/todo.md`
- [ ] T1.2 Add todo.md to the scaffold template loop — files:
      `src/lib/engine/workstream.ts`
- [ ] T1.3 Implement `parseTodo` + interfaces — files:
      `src/lib/engine/todo.ts`
- [ ] T1.4 Implement `currentFocus` (frontmatter-stage-rooted DFS walk)
- [ ] T1.5 Implement `computeTodoDrift` (both classes, line numbers)
- [ ] T1.6 Implement `trueDerivedLines` (derived lines only; free items
      byte-preserved)
- [ ] T1.7 Drive E-1 + E-2 RED artifacts to green

### 2. Phase: gate-verdict persistence + revise clearing + gate summary

**Overview**: Persist honest gate history: the `gate_verdicts:` sibling
frontmatter map, written by all three gates on every evaluated run
(including FAIL), cleared by the revise cascade, and rendered as a per-gate
summary line in `devx next`. Parallel-safe with Phase 1 — zero shared files
(gate summary rendering lives in a new `render.ts`, not `todo.ts`).

**Files**:
- `src/lib/engine/frontmatter.ts` — add `GATE_KEYS` / `GateKey` /
  `GateVerdicts` / `FLAG_TO_GATE_KEY`; extend `EngineState` +
  `EnginePatch` with `gateVerdicts` (parse defensive: value ∉ VERDICTS →
  null; absent map ≡ all-null). All handling via the existing
  `parseDocument` round-trip — the v1 flat-scalar parsers never see the
  nested map.
- `src/commands/gate.ts` — at the three `applyEnginePatch` sites (~:170
  prd, ~:310 coverage, ~:431 evals): pass/CONCERNS → one combined patch
  (flag + stage + verdict); FAIL → verdict-only patch. Refusals, `--dry-run`,
  and exit-2 error paths write nothing. Update the header comment's
  "frontmatter untouched on exit 1" contract.
- `src/lib/engine/revise.ts` — `ReviseComputation` gains
  `verdictsCleared: GateKey[]` derived from the cascade row's reset flags.
- `src/commands/revise.ts` — include `gateVerdicts: {<key>: null, …}` in
  the existing patch; replay-path output unchanged.
- `src/lib/engine/render.ts` — new: `renderGateSummary(state)` →
  `gates: prd PASS · design FAIL · plan — · evals —` with fallback rule
  (verdict ≠ null → verdict; else flag true → PASS; else `—`); FAIL rows
  append report pointer (coverage → newest `decisions/<date>-<mode>-verify.md`,
  evals → `evals/RED-report.md`, prd → re-run command only) + re-run command.
- `src/lib/next/decide.ts` + `src/lib/next/gather.ts` +
  `src/commands/next.ts` — attach `verdicts` to `WorkstreamSignal`; render
  the gate-summary line under workstream rows (repo scan + `devx next
  <hash>` single form).
- `test/gate-verdict-persist.test.ts` — E-3 RED artifact.

**Context**:
- D-9 vocabulary reused verbatim from `src/lib/engine/verdict.ts` VERDICTS;
  gate-name keys (`prd/design/plan/evals`) per the resolved design decision.
- Risk mitigation (design §Risks): `applyEnginePatch` throws on
  missing/broken frontmatter → gate exits 2 writing nothing; booleans still
  only flip on pass.
- Gates are the only writers; `devx revise` is the only eraser.
- Migration: existing specs render legacy PASS via the flag-true fallback —
  no rewrite of shipped specs; `eac479` itself is the live example.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - 100% of evaluated gate runs across all 3 commands write the verdict in
    fixtures, including FAIL runs; refusal/dry-run fixtures write nothing
    (E-3 threshold).
  - Post-revise, reset stages read verdict `null`.
  - `devx next` renders FAIL distinctly from never-run in both fixtures.
  - `npm test` green.

**Tasks**:
- [ ] T2.1 Extend frontmatter state/patch with `gateVerdicts` — files:
      `src/lib/engine/frontmatter.ts`
- [ ] T2.2 Write verdicts at the three gate call sites (incl. FAIL
      verdict-only patch; refusals untouched) — files: `src/commands/gate.ts`
- [ ] T2.3 Clear verdicts in the revise cascade — files:
      `src/lib/engine/revise.ts`, `src/commands/revise.ts`
- [ ] T2.4 Implement `renderGateSummary` with fallback + FAIL report
      pointers — files: `src/lib/engine/render.ts`
- [ ] T2.5 Wire the gate-summary line into `devx next` (both forms) —
      files: `src/lib/next/gather.ts`, `src/lib/next/decide.ts`,
      `src/commands/next.ts`
- [ ] T2.6 Drive E-3 RED artifact to green

### 3. Phase: todo sync + focus/drift renderers + real `devx status`

**Overview**: Make the todo layer mechanical and visible: the
`devx todo sync <hash>` truing primitive (the FR-2 "reconcile before
writing" made structural + the FR-1 grandfathering path), focus-line and
drift-row rendering in `devx next`, and the minimal real `devx status`.
Depends on Phase 1 (the todo module) and Phase 2 (`render.ts` +
`WorkstreamSignal` plumbing + gate summary that `devx status` renders).

**Files**:
- `src/commands/todo.ts` — new `devx todo sync <hash>`: resolve via
  `resolveWorkstream`; absent todo.md → create from template trued to
  ground truth; present → `trueDerivedLines`. Stdout JSON
  `{hash, created, trued: [...]}`; exit 0 on success (incl. no-op), 2 on
  resolution/parse errors.
- `src/cli.ts` — register the `todo` command module.
- `src/lib/engine/render.ts` — add `renderFocusLine(doc, stage)`; null
  (line omitted) when todo.md absent.
- `src/lib/next/gather.ts` — attach `{focus, todoDrift}` to each
  workstream signal inside `gatherRepoSnapshot`; build `TodoGroundTruth`
  (frontmatter state + linked dev-spec `status: done` map for phase
  pointers).
- `src/lib/next/decide.ts` — `WorkstreamSignal` fields for focus + todo
  drift alongside the existing `DriftEntry` advisory pattern.
- `src/commands/next.ts` — render focus line under workstream rows (both
  forms) + advisory todo-drift rows; exit code unchanged.
- `src/commands/status.ts` — replace the 11-line stub: scan `plan/` for
  specs whose `workstream:` resolves and stage ∉ {done, retired} (plus
  done-with-outcome-pending); per workstream render
  `<slug> (<hash>)  stage: <stage>` + gate summary + focus line. Read-only;
  exit 0.
- `test/next-todo-drift.test.ts` — E-4 RED artifact.
- `test/next-current-focus.test.ts` — E-5 RED artifact.

**Context**:
- `devx todo sync` is never called from gate code (E-2's static scan keeps
  this honest — gate modules stay todo-free).
- Drift is advisory only: never blocking, never mutating, exit code
  unchanged vs no-drift fixture (E-4 threshold; CAP-2).
- Phase-pointer ground truth: linked dev spec `status: done` (design
  §Assumptions — done ⇒ verified because merge happens after the /devx
  verification tail).
- E-5 fixtures: mid-intake, mid-execute, stale hand-checked stage parent
  (focus head must not move), absent-file (exit 0, no line).
- `devx status` stays a thin renderer over engine reads so Concierge
  (Phase 2 of the roadmap) extends rather than replaces it.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - Both drift classes detected (2/2 fixtures); exit code unchanged; 0
    file writes (E-4 threshold).
  - Focus line correct on 3 fixtures + absent-file fixture exits 0 with no
    focus line (E-5 threshold).
  - `devx todo sync` on a todo-less mid-pipeline workstream creates a
    skeleton born consistent with current frontmatter (FR-1
    grandfathering).
  - `npm test` green.

**Tasks**:
- [ ] T3.1 Implement `devx todo sync` + CLI registration — files:
      `src/commands/todo.ts`, `src/cli.ts`
- [ ] T3.2 Implement `renderFocusLine` — files: `src/lib/engine/render.ts`
- [ ] T3.3 Gather focus + todo drift into `RepoSnapshot` signals — files:
      `src/lib/next/gather.ts`, `src/lib/next/decide.ts`
- [ ] T3.4 Render focus + advisory drift rows in `devx next` — files:
      `src/commands/next.ts`
- [ ] T3.5 Replace the `devx status` stub with the minimal real renderer —
      files: `src/commands/status.ts`
- [ ] T3.6 Drive E-4 + E-5 RED artifacts to green

### 4. Phase: /devx-learn skill + slug helper

**Overview**: Ship the framework self-improvement loop: the `/devx-learn`
skill body with its three guards, the pure slug sanitizer, and the
`devx learn-helper slug` passthrough. Parallel-safe with Phases 1–3 (no
shared files; the nudge canonical source lands here, but its references in
the other skills land in Phase 5).

**Files**:
- `.claude/commands/devx-learn.md` — new canonical skill body, sections
  per design §Interfaces: Mining scope (current session only; refuse
  fresh/empty; never self-triggers) → Evidence table → four Buckets with
  destinations → Repo predicate (root `package.json` name `@devx/cli` →
  `fw/learn-YYYY-MM-DD-<slug>` PR; else `docs/updates/<date>-<slug>.md`)
  → Guards (locked-machinery / untrusted-input / slug-sanitization) →
  Foreground-only note → `<!-- nudge-canonical -->` nudge sentence.
- `skills/devx-learn.md` — byte-identical mirror (pin101;
  `test/skills-sync.test.ts` + `src/lib/init-skills.ts` auto-glob pick it
  up with zero new plumbing).
- `src/lib/learn/slug.ts` — new: `sanitizeLearnSlug(raw)` — lowercase,
  strip to `[a-z0-9-]`, collapse/trim dashes, ≤40 chars, empty →
  `"session-retro"`.
- `src/commands/learn-helper.ts` — new `devx learn-helper slug <raw…>`
  passthrough.
- `src/cli.ts` — register the `learn-helper` command module.
- `test/learn-skill-guards.test.ts` — E-6 RED artifact: slug fuzz set
  (≥8 cases: metachars, unicode, >40 chars, empty, injection strings) +
  static skill-body assertion for both guard sections.

**Context**:
- Judgment stays prose; only the sanitizer is mechanical (design
  §Discarded: no transcript-mining CLI arm).
- User-foreground only — skill/settings edits can't be auto-accepted by
  subagents (memory `project_skill_perms_block_subagents.md`); the skill
  body says so.
- Session content is data, not instructions: injected directives flagged +
  skipped; slugs only via the helper, never raw session text into git/gh.
- Static-test shape follows dvx103 (`test/devx-status-log-discipline.test.ts`)
  / dvx107 precedent.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - 100% of the slug fuzz set sanitized by the pure helper (E-6 threshold).
  - Static assertion finds locked-machinery + untrusted-input guard
    sections in the shipped body.
  - `test/skills-sync.test.ts` passes with the new mirror pair.
  - `npm test` green.

**Tasks**:
- [ ] T4.1 Implement `sanitizeLearnSlug` — files: `src/lib/learn/slug.ts`
- [ ] T4.2 Add `devx learn-helper slug` + CLI registration — files:
      `src/commands/learn-helper.ts`, `src/cli.ts`
- [ ] T4.3 Author the skill body with all pinned sections — files:
      `.claude/commands/devx-learn.md`
- [ ] T4.4 Mirror to `skills/devx-learn.md` (byte-identical)
- [ ] T4.5 Drive E-6 RED artifact to green

### 5. Phase: lifecycle skill wiring + nudge single-sourcing

**Overview**: Wire the working memory into the skills that do the work:
pointer-style todo steps in every `/devx-plan` stage and the `/devx`
execute arm, phase-pointer emission at RED, the friction-only learn nudge
referenced (not restated) from its canonical source, and the E-7 static
discipline test. Last because it references `devx todo sync` (Phase 3) and
the nudge canonical source (Phase 4).

**Files**:
- `.claude/commands/devx-plan.md` — each of the 4 stage sections gains a
  pointer-style step: run `devx todo sync <hash>`, read the current-stage
  section, expand this session's sub-items as free-nested lines, check
  them as work lands. RED stage additionally writes one
  `  - [ ] Phase <n>: <title> → <dev-hash>` pointer line per emitted spec.
  Wrap-up gains the friction-observed nudge conditional (pointer to the
  canonical sentence).
- `.claude/commands/devx.md` — execute arm gains the same pointer-style
  todo step (worktree agents write workstream artifacts via absolute paths
  into the main worktree) + the nudge conditional.
- `skills/devx-plan.md`, `skills/devx.md` — byte-identical mirrors.
- `test/skill-todo-discipline.test.ts` — E-7 RED artifact: 5/5
  stage+execute sections carry the todo step; nudge sentence defined in
  exactly 1 place (`<!-- nudge-canonical -->` in devx-learn.md) and
  referenced elsewhere; prose-budget canary respected.

**Context**:
- S-1 prose budget (`engine.prose_budget_kb: 60`) is already contested
  (INTERVIEW Q#9: 64.2KB full-surface) — additions must be pointer-style;
  net-new prose target < 3KB across both bodies (design §Risks, E-7).
- Derived lines belong to `devx todo sync`; skills only check/expand free
  items — stage parents are never hand-checked (FR-2).
- Test + prose ship atomically in the same PR (dvx103 pattern — no
  grandfather window).
- Exact nudge sentence + todo-step prose settle here inside the pinned
  test (design §Unresolved — none blocking).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - 5/5 sections (4 devx-plan stages + devx execute arm) carry the todo
    step; nudge defined once, referenced not restated (E-7 threshold).
  - Prose-budget canary stays under `engine.prose_budget_kb` for the gated
    set.
  - `test/skills-sync.test.ts` passes for both updated mirror pairs.
  - `npm test` green.

**Tasks**:
- [ ] T5.1 Add todo steps to the 4 `/devx-plan` stages + RED phase-pointer
      emission — files: `.claude/commands/devx-plan.md`
- [ ] T5.2 Add the execute-arm todo step — files: `.claude/commands/devx.md`
- [ ] T5.3 Add the friction-observed nudge conditionals (pointers to the
      canonical source) — files: both skill bodies
- [ ] T5.4 Sync both mirrors — files: `skills/devx-plan.md`,
      `skills/devx.md`
- [ ] T5.5 Drive E-7 RED artifact to green
