# Design — Harness Fold In

<!-- Stage: Design. Gate: `devx gate coverage eac479` (design mode — one
     tri-state row per G-/UC-/CAP-/FR- ID in prd.md). Hard rule: don't plan
     here. No phases, no tasks — design is the approach, not the sequence. -->

## Overview

- **Objective**: Give devx durable working memory (per-workstream `todo.md`),
  honest gate history (persisted verdicts distinguishing FAIL from never-run),
  and a framework self-improvement loop (`/devx-learn`) — folding the
  8am-harness §27/§24 shapes in devx-flavored: markdown + git ground truth,
  mechanical checks in the CLI, judgment in thin skill bodies.
- **Solution**: Four sub-systems, all additive. (1) A `todo.md` template +
  pure parser/focus/drift module in the engine, scaffolded by
  `devx workstream new`, trued mechanically by a new `devx todo sync`
  primitive, written by the lifecycle skills, and **never read by any gate**.
  (2) A `gate_verdicts:` sibling frontmatter map written by all three gate
  CLIs on every evaluated run (including FAIL), cleared by the revise
  cascade, rendered by `devx next` and a minimal real `devx status`.
  (3) A `/devx-learn` skill (canonical `.claude/commands/`, shipped via the
  pin101 `skills/` mirror) with a pure slug-sanitizer helper and three
  carried-over guards. (4) Todo seed/reconcile steps + a single-sourced
  friction-only learn nudge wired into the existing skill bodies, pinned by
  static tests per the dvx103/dvx107 precedent.

## Constraints

- **Additive frontmatter only.** The v1 flat-scalar parsers
  (`src/lib/merge-gate.ts` readFrontmatter, `src/lib/plan/validate-emit.ts`
  parseFrontmatterValue, `src/lib/devx/claim.ts` line-splicing) read
  positional scalar lines; `gate_verdicts:` must be a new nested map handled
  only via `parseDocument` round-trip in `src/lib/engine/frontmatter.ts`.
  `gate_status` booleans are unchanged in shape and semantics.
- **D-9 verdict vocabulary is locked** (`PASS|CONCERNS|FAIL|WAIVED`,
  `src/lib/engine/verdict.ts` VERDICTS) — the map reuses it verbatim.
- **todo.md is never a gate input** (FR-3) — no `devx gate` code path may
  import or read it; pinned by a static read-surface test.
- **Skills prose budget**: the S-1 canary gates skill prose at
  `engine.prose_budget_kb` (60KB). Additions to `devx.md` / `devx-plan.md`
  must be pointer-style steps, not restated contracts.
- **`/devx-learn` is user-foreground only** — skill/settings edits prompt
  for confirmation even on bypass-perms (harness constraint; see memory
  `project_skill_perms_block_subagents.md`). The skill body says so.
- **No new npm dependencies** — `yaml` (already a runtime dep) covers all
  parsing needs.
- **D-10**: no external trackers; everything lands as files in the repo.

## Risks

- **FAIL runs now write frontmatter** (previously "frontmatter untouched" on
  exit 1, `src/commands/gate.ts` header). A malformed spec could be
  corrupted by the new write path → mitigation: `applyEnginePatch` throws on
  missing/broken frontmatter and the gate exits 2 writing nothing; the
  boolean flags still only flip on pass → proven by **E-3**.
- **Todo parser over-matching free-form nested text** → mitigation: derived
  lines are a fixed top-level prefix vocabulary (`Stage:`/`Gate:`/`Phase`);
  everything nested is opaque free text, parsed generically and never
  validated → proven by **E-1**.
- **Stale hand-checked checkbox misdirecting resume** → mitigation: the
  focus walk starts from the frontmatter-derived current stage, never from
  the first unchecked line → proven by **E-5**.
- **Silent coupling of gates to todo state** → mitigation: static
  read-surface assertion + byte-identical verdict fixtures (present /
  absent / checked / unchecked) → proven by **E-2**.
- **Prose-budget breach** from skill-body additions (budget already
  contested — INTERVIEW Q#9, 64.2KB full-surface vs 60KB gated set) →
  mitigation: single-sourced nudge, pointer-style todo steps, net-new skill
  prose target < 3KB across both bodies → proven by **E-7** (canary row).
- **Hostile session content reaching git/gh commands** via `/devx-learn` →
  mitigation: pure sanitizer helper + untrusted-input guard section →
  proven by **E-6**.

## Trade-offs

- **Verdicts in spec frontmatter over a `.devx-cache` state file** — chose
  git-tracked, diff-reviewable truth (the spec already carries gate state;
  cache files are gitignored and lose history) at the cost of one more
  frontmatter writer.
- **Write-verdict-on-FAIL over derive-from-decisions/-reports at render
  time** — chose one authoritative field over re-parsing dated report files
  (fragile latest-file scan; `gate prd` FAIL writes no report at all, so
  derivation can't even cover it).
- **A mechanical `devx todo sync` primitive over pure-LLM reconciliation** —
  chose CLI truing of derived lines (same "mechanical checks live in the
  CLI" tenet as claim/merge-gate/derive-branch) at the cost of one new
  subcommand; the LLM only writes free-nested items it owns.
- **Static skill-body tests over runtime enforcement** for FR-2/FR-10 —
  skills are prose; the dvx103 (`test/devx-status-log-discipline.test.ts`)
  and dvx107 (`test/devx-handoff-snippet.test.ts`) precedent is the proven
  way to pin prose contracts without executing them.
- **Minimal real `devx status` now over waiting for Concierge** — G-1 names
  it; an 11-line stub (`src/commands/status.ts`) becomes a thin renderer
  over engine reads, and Concierge (Phase 2) extends rather than replaces it.

## Out of scope

- Everything in the PRD's Non-goals: per-workstream health queue
  (`plan-e5a9c0`), CI audit agent, external trackers, execution-graph
  parallelism (`plan-f1d6b2`), eval-manifest RED artifacts.
- TUI / web / mobile rendering of focus lines and verdicts (they consume
  `devx status` output later; no UI work here).
- Auto-applying `/devx-learn` findings without user approval — plan-first is
  the contract, always.
- Backfilling `todo.md` or `gate_verdicts` into shipped/closed workstreams.

## Assumptions

- **A dev spec's `status: done` is the mechanical proxy for "phase
  verified"** — merge only happens after the /devx verification tail, so
  done ⇒ verified. Revision trigger: if per-phase `checkpoints/` reports
  become mandatory, drift class (b) re-keys onto checkpoint presence.
- **`package.json` `"name": "@devx/cli"` at repo root uniquely identifies
  the devx repo** for `/devx-learn`'s framework-fix-PR predicate. Revision
  trigger: a rename or fork invalidates the predicate.
- **Workstream artifacts (incl. todo.md) are written from the main worktree
  via absolute paths** — same convention backlog files already use
  (CLAUDE.md branching model); worktree agents don't carry their own copy.
- **Gates are the only writers of `gate_verdicts`** — skills and humans
  hand-edit `gate_status` never, verdicts never; `devx revise` is the only
  eraser.

## Discarded considerations

- **Storing verdicts inside `gate_status` (e.g. flag → string)** — breaks
  the fail-closed `=== true` reads in `readEngineState` and every consumer;
  rejected for the additive sibling map (intake decision, confirmed at
  design).
- **`gate_verdicts` keys mirroring flag names** (`prd_validated: PASS`) —
  redundant suffixes; gate-name keys map 1:1 to the gate commands and the
  replay path (user decision 2026-07-24).
- **todo drift as a blocking `devx next` state** — violates CAP-2's
  advisory-only contract and would make todo.md a de-facto gate input;
  drift is a bug in the last writer, not in the reader.
- **A `devx learn` CLI arm that mines transcripts mechanically** — session
  threads live in the harness, not the repo; mining is judgment. Only the
  slug sanitizer is mechanical enough to be CLI.
- **`_devx/proposals/` as the consumer-repo learn home** — splits proposal
  files across two homes; `docs/updates/` already owns "proposed, not
  applied" via the locked-machinery guard (user decision 2026-07-24).

## Wrap, don't duplicate

- **Reuses**:
  - `src/lib/engine/frontmatter.ts` — `readEngineState` /
    `applyEnginePatch` / `ensureEngineFrontmatter` grow the new map; no new
    parser.
  - `src/lib/engine/verdict.ts` — `VERDICTS` / `Verdict` type verbatim.
  - `src/lib/engine/workstream.ts` — `createWorkstream`'s write-if-missing
    template loop gains one entry; `resolveWorkstream` resolves every new
    CLI surface.
  - `src/lib/engine/revise.ts` — `CASCADE_TABLE` rows drive verdict
    clearing; no second cascade.
  - `src/lib/engine/next.ts` `nextForWorkstream` — unchanged; new renderers
    sit beside it.
  - `src/lib/next/gather.ts` / `decide.ts` — `RepoSnapshot` seams +
    `DriftEntry` advisory pattern extended, not forked.
  - `src/lib/init-skills.ts` + `skills/` mirror + `test/skills-sync.test.ts`
    (pin101) — ships `/devx-learn` to consumers with zero new plumbing.
  - `package.json` `files: ["_devx/templates", …]` — ships the todo
    template as-is.
  - dvx103/dvx107 static-test shape for all skill-body pins.
- **Adds** (genuinely new): `_devx/templates/engine/todo.md`;
  `src/lib/engine/todo.ts` (parse / focus / drift / sync-truing);
  `devx todo sync` subcommand; `src/lib/learn/slug.ts` +
  `devx learn-helper slug`; `.claude/commands/devx-learn.md` (+ mirror);
  verdict plumbing in `gate.ts`/`revise.ts`; a real `src/commands/status.ts`
  body.

## Design

### Architecture

Four sub-systems compose left-to-right: **template → parser → writers →
renderers**, with gates explicitly firewalled from the parser.

**1. todo.md working memory.**
`_devx/templates/engine/todo.md` ships the fixed lifecycle skeleton.
`createWorkstream` (`src/lib/engine/workstream.ts`) adds it to the existing
write-if-missing template loop. A new pure module `src/lib/engine/todo.ts`
owns: parsing (the line-prefix contract below), the focus walk (FR-5), drift
computation (FR-4), and derived-line truing. A new `devx todo sync <hash>`
subcommand is the one mechanical writer: absent file → create from template
trued to frontmatter (the FR-1 grandfathering path); present file → true
derived lines against ground truth, never touching free-nested items.
Lifecycle skills call `devx todo sync` at seed time (their
"reconcile-before-write"), then check/expand free items themselves.

**2. Gate-verdict persistence.**
`frontmatter.ts` grows `gateVerdicts` (parse + patch). Each gate in
`src/commands/gate.ts` writes its verdict on every **evaluated** run at the
existing three `applyEnginePatch` call sites (gate-prd ~:170, coverage
~:310, evals ~:431): pass/CONCERNS → one combined patch (flag + stage +
verdict); FAIL → a verdict-only patch (booleans and stage untouched).
**Refusals write nothing**: missing Gate-1 inputs, coverage with no open
mode, evals with predecessors open, `--dry-run`, and every exit-2 error path
— a gate that never evaluated has no verdict. `revise.ts` clears the
verdicts of every flag its cascade row resets. Renderers: `devx next`
(workstream rows + `devx next <hash>`) and the new `devx status` render the
per-gate summary; FAIL rows carry the report path + re-run command.

**3. /devx-learn.**
A skill body (`.claude/commands/devx-learn.md`, canonical; byte-mirrored to
`skills/devx-learn.md` per pin101, auto-installed to consumers by
`src/lib/init-skills.ts`). Judgment (mining the session thread, bucketing,
the evidence table) is prose; the only code is
`src/lib/learn/slug.ts → sanitizeLearnSlug()` exposed as
`devx learn-helper slug <raw…>` for branch/PR naming. The framework-fix
bucket opens a `fw/learn-YYYY-MM-DD-<slug>` PR only when root
`package.json` name is `@devx/cli`; in consumer repos the same finding is
written to `docs/updates/<date>-<slug>.md` — the identical home the
locked-machinery guard uses, so all "proposed, not applied" findings live in
one place.

**4. Skill wiring + nudge.**
`.claude/commands/devx-plan.md` (4 stage sections) and
`.claude/commands/devx.md` (execute arm) each gain a pointer-style todo
step: run `devx todo sync <hash>`, read the current-stage section, expand
this session's sub-items as free-nested lines, check them off as work lands
(derived lines belong to sync). The learn nudge sentence is defined once in
`devx-learn.md` under a `<!-- nudge-canonical -->` marker; the two lifecycle
skills carry only the friction-observed conditional + a pointer to it.

#### todo.md parse contract (the FR-1 fixed skeleton)

Top-level derived lines (column 0), fixed vocabulary — this exact regex is
the contract: `/^- \[( |x)\] (Stage|Gate|Phase \d+): .+$/`.

```
- [ ] Stage: PRD
- [ ] Gate: prd
- [ ] Stage: Design
- [ ] Gate: coverage(design)
- [ ] Stage: Plan
- [ ] Gate: coverage(plan)
- [ ] Stage: RED
- [ ] Gate: evals
- [ ] Stage: Execute
- [ ] Stage: Retro
- [ ] Stage: Outcome
```

- **Gate labels** are the fixed set `prd | coverage(design) |
  coverage(plan) | evals`, mapping 1:1 onto `gate_verdicts` keys and
  `gate_status` flags.
- **Phase pointer lines** nest one level (2 spaces) under `Stage: Execute`,
  shape `  - [ ] Phase <n>: <title> → <dev-hash>` — a pointer to the
  emitted dev spec, never a content copy. Written by the RED stage at
  emission; checked when the linked spec reaches `status: done`.
- **Free items**: any deeper-nested checkbox line under any parent. Parsed
  generically `{checked, depth, text}`; never validated, never trued, owned
  by the skills/user.
- **Derived-truth mapping** (what `sync` trues, what drift checks):
  `Gate: <g>` checked ⟺ its `gate_status` flag is true; `Stage: <s>`
  checked ⟺ frontmatter `stage` ordinal is past it (stage parents are
  derived, never hand-checked — FR-2); phase pointer checked ⟺ linked dev
  spec `status: done`. Retro/Outcome parents key off spec `status: done` +
  `outcome.status` being a scored verdict respectively.
- **Header contract** rides as an HTML comment at the top of the template:
  auto-maintained; never a gate input; pointers not copies; done = checked,
  abandoned = deleted; hand-edits legal — the next writer reconciles.

#### Focus walk (FR-5)

Start from the frontmatter-derived current stage (never from checkbox
state): locate that stage's skeleton section (its top-level line through the
next top-level line), then DFS: descend into the first unchecked child,
repeat until a node has no unchecked children — that node's text is the
focus. Section fully checked or empty → fall back to the section parent's
text. `todo.md` absent → `null`, renderers omit the line, exit code
unchanged (E-5's absent-file fixture).

#### Drift classes (FR-4)

- **(a) gate-flag**: a `Gate: <g>` checkbox contradicting its
  `gate_status` flag (either direction).
- **(b) phase-pointer**: a phase pointer checkbox contradicting the linked
  dev spec's done-state (either direction).

Computed inside `gatherRepoSnapshot` (`src/lib/next/gather.ts`) per
workstream signal and rendered by `devx next` as advisory rows alongside the
existing backlog↔frontmatter `DriftEntry` rows (`src/lib/next/decide.ts`)
— never blocking, never mutating, exit code unchanged (E-4).

### Interfaces

**`src/lib/engine/todo.ts`** (pure, no I/O):

```ts
export interface TodoItem {
  kind: "stage" | "gate" | "phase" | "free";
  label: string;            // "Design" | "coverage(design)" | "3" | free text
  checked: boolean;
  depth: number;            // 0 = top-level derived
  line: number;             // 1-indexed, for drift reports
  pointer: string | null;   // dev-hash on phase lines
  children: TodoItem[];
}
export interface TodoDoc { items: TodoItem[]; unparsedTopLevel: number[]; }
export function parseTodo(content: string): TodoDoc;
export interface TodoGroundTruth {
  state: EngineState;                         // frontmatter
  phaseDone: Record<string, boolean>;         // dev-hash → status: done
}
export function currentFocus(doc: TodoDoc, stage: Stage): string | null;
export type TodoDriftClass = "gate-flag" | "phase-pointer";
export interface TodoDrift { class: TodoDriftClass; line: number; message: string; }
export function computeTodoDrift(doc: TodoDoc, truth: TodoGroundTruth): TodoDrift[];
/** True derived lines only; free items byte-preserved. */
export function trueDerivedLines(content: string, truth: TodoGroundTruth):
  { content: string; trued: string[] };
```

**`devx todo sync <hash>`** (new subcommand, `src/commands/todo.ts`):
resolve via `resolveWorkstream`; absent todo.md → write template trued to
ground truth; present → `trueDerivedLines`. Stdout JSON
`{hash, created, trued: [...]}`. Exit 0 on success (including no-op),
2 on resolution/parse errors. Never runs from gate code.

**`src/lib/engine/frontmatter.ts`** (extended):

```ts
export const GATE_KEYS = ["prd", "design", "plan", "evals"] as const;
export type GateKey = (typeof GATE_KEYS)[number];
export type GateVerdicts = Record<GateKey, Verdict | null>;
// EngineState.gateVerdicts: GateVerdicts  (defensive: value ∉ VERDICTS → null)
// EnginePatch.gateVerdicts?: Partial<Record<GateKey, Verdict | null>>
export const FLAG_TO_GATE_KEY: Record<GateFlag, GateKey>; // prd_validated → prd, …
```

**`src/commands/gate.ts`** (contract change, header comment updated): every
evaluated run patches `gateVerdicts[key]` with the computed D-9 verdict;
FAIL patch carries the verdict only; refusals/dry-run/errors write nothing.

**`src/lib/engine/revise.ts`**: `ReviseComputation` gains
`verdictsCleared: GateKey[]` (the reset flags' keys whose verdict is
non-null); the CLI adds `gateVerdicts: {<key>: null, …}` to its existing
patch. Replay-path output unchanged.

**Rendering** (shared helpers in `todo.ts` or a sibling `render.ts`), both
consumed by `devx next` AND `devx status`:
- `renderGateSummary(state): string` →
  `gates: prd PASS · design FAIL · plan — · evals —`, with the fallback rule
  **verdict ≠ null → verdict; else flag true → PASS (legacy pre-verdict
  runs); else —**. FAIL rows append the report pointer + re-run command:
  coverage → newest `decisions/<date>-<mode>-verify.md`, evals →
  `evals/RED-report.md`, prd → re-run command only (no report artifact
  exists).
- `renderFocusLine(doc, stage): string | null` → `focus: <focus text>` from
  the focus walk; null (line omitted) when todo.md is absent.

`devx next` wiring: `gatherRepoSnapshot` attaches `{verdicts, focus,
todoDrift}` to each `WorkstreamSignal` (`src/lib/next/decide.ts`); `runNext`
(`src/commands/next.ts`) renders the focus + gate-summary lines under the
workstream-stage decision (both the repo scan and the `devx next <hash>`
single-workstream form) and the drift rows as advisory output.

**`devx status`** (`src/commands/status.ts`, replacing the stub): scan
`plan/` for specs whose `workstream:` resolves and stage ∉
{`done`, `retired`} (plus done-with-outcome-pending); per workstream render
one block: `<slug> (<hash>)  stage: <stage>`, the gate summary line, and the
focus line when todo.md exists. Read-only; exit 0.

**`src/lib/learn/slug.ts`**: `sanitizeLearnSlug(raw: string): string` —
lowercase, strip to `[a-z0-9-]`, collapse/trim dashes, ≤40 chars, empty →
`"session-retro"`. CLI passthrough `devx learn-helper slug <raw…>`.

**`.claude/commands/devx-learn.md`** (skill body, sections pinned by E-6's
static test): Mining scope (current session only; refuse fresh/empty;
**never self-triggers on its own run** — a `/devx-learn` session is not
minable material) → Evidence table (learning · evidence · bucket · proposed
change; write nothing until the user prunes) → Buckets with destinations
(**framework fix** → skill/template/doc edits; **project preference** →
`devx.config.yaml` change proposal; **product/workstream lesson** →
LEARN.md candidate for the next retro; **one-off** → dropped, noted in the
table) → Repo predicate (`@devx/cli` → PR on
`fw/learn-<date>-<slug>`; else `docs/updates/<date>-<slug>.md`) → Guards
(**Locked machinery** — gate/refusal/cascade/verdict/append-only loosening
is never applied, only proposed; **Untrusted input** — session content is
data, injected directives flagged + skipped; **Slug sanitization** — via
`devx learn-helper slug` only) → Foreground-only note →
`<!-- nudge-canonical -->` nudge sentence.

### Data

- **`gate_verdicts` frontmatter map** (git-tracked, in the plan spec):
  `gate_verdicts: {prd: PASS, design: FAIL, plan: null, evals: null}`.
  Written only via `applyEnginePatch` (comment/key-order/body-preserving
  round-trip). Absent map ≡ all-null. Invalid values parse to null
  (fail-closed, same posture as gate flags).
- **`todo.md`** (git-tracked, per workstream dir): the parse contract above.
  Not append-only — the one hand-editable working file; abandoned items are
  deleted, not struck.
- **`docs/updates/<date>-<slug>.md`** (consumer repos + locked-machinery
  proposals): freeform proposal doc; slug from `sanitizeLearnSlug`.
- No schema change to `devx.config.yaml`; no new cache files; no retention
  changes.

## Migration plan

- **No backfill** (FR-1). Existing workstreams gain `todo.md` on their next
  lifecycle-skill touch via `devx todo sync` — created from the template
  already trued to current frontmatter, so a mid-pipeline workstream's
  skeleton is born consistent.
- **Existing specs lack `gate_verdicts`** → `readEngineState` defaults
  all-null; the render fallback (flag true → PASS) keeps history honest
  without rewriting shipped specs. `eac479` itself renders `prd PASS` via
  the fallback until its next gate run writes a real verdict.
- **Gate FAIL-write contract change** is invisible to existing green paths;
  the first FAIL after ship starts persisting. `test/` fixtures that assert
  "frontmatter untouched on exit 1" (if any) update with the gate.ts header.
- **Skill-body edits** land with their static tests in the same PR (the
  dvx103 pattern: test + prose ship atomically, no grandfather window
  needed beyond the frozen list dvx103 already carries).
- **Consumer repos** receive `/devx-learn` + the todo template on their
  next `devx init` upgrade (init-skills ownership rules + packaged
  templates); nothing breaks for repos that never upgrade — absent todo.md
  reads as silence everywhere.

## Resolved design questions

- Verdict key shape → **gate-name keys** (`prd/design/plan/evals`) — user,
  2026-07-24, AskUserQuestion at design open.
- Consumer-repo learn-proposal home → **`docs/updates/<date>-<slug>.md`**,
  shared with the locked-machinery guard — user, 2026-07-24.
- `devx status` scope → **minimal real implementation now** (stage + gates +
  focus per active workstream); Concierge extends later — user, 2026-07-24.
- "Phase verified" ground truth → **linked dev spec `status: done`** —
  this design (see Assumptions; checkpoint-presence rejected as optional
  today).
- devx-repo predicate for the framework-fix PR bucket → **root
  `package.json` name `@devx/cli`** — this design.
- Legacy passed-flag rendering → **flag true + verdict null renders PASS**
  (booleans stay ground truth for pass/fail history) — this design.
- Mechanical reconcile → **new `devx todo sync` primitive**; skills call it
  instead of hand-truing derived lines — this design (FR-2's
  "reconcile before writing" made structural).

## Unresolved design questions

- None blocking (no P0 depends on an open question). Exact prose of the
  todo template's Retro/Outcome items and the nudge sentence settle at
  implementation inside their pinned tests.
