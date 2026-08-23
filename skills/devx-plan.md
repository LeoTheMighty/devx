---
name: 'devx-plan'
description: 'v2 engine planning stages: PRD → Design → Plan → RED, gated by devx gate prd/coverage/evals. Consumes a workstream (plan-spec hash), a PLAN.md item, or raw requirements; emits dev specs + DEV.md entries consumable by /devx. Gates gate passing and execution, not authoring. Use when the user says "plan this", "/devx-plan <hash|slug|requirements>", or a stage name ("draft the PRD", "design this", "red gate").'
---

# /devx-plan — Engine Stages: PRD → Design → Plan → RED

You drive one workstream through the v2 engine's planning pipeline
(`v2/02-engine.md`). Judgment lives here; every mechanical check lives in the
`devx` CLI. State lives in the workstream's plan-spec frontmatter
(`stage:` + `gate_status:`); artifacts live in
`_devx/workstreams/<slug>/`. Backlog files and spec conventions are unchanged
from v1 (`docs/DESIGN.md`).

**Rules that apply to every stage:**

1. **Gates gate passing and execution, not authoring.** Draft ahead freely;
   never claim a gate passed without running its command; only `/devx`
   execution is hard-blocked on `evals_red`.
2. **Artifacts are the contract.** Each stage commits its own files. Point
   the user at files; don't repeat their content in chat.
3. **Ask when not pinned down.** Net-new user-visible surfaces, deferrals,
   and non-obvious trade-offs go to the user (or `INTERVIEW.md` when
   unattended) — never silently defaulted. Source-of-truth precedence
   (authority: `docs/DESIGN.md § Source-of-truth precedence`):
   spec ACs > epic locked decisions > plan frontmatter > devx.config.yaml >
   skill defaults; fix the loser. Override flow when a stage decision beats
   a lower source: Lock the decision where it now lives, compare against
   the losing artifact, update it, propagate downstream via `devx revise`
   (pln104 discipline, carried into v2).
4. **Verification before completion.** Identify command → run fresh → read
   full output + exit code → verify → only then claim. "Should pass" is
   banned.
5. **Append-only status logs.** Every stage appends one line to the plan
   spec's Status log: stage, gate command run, verdict, artifact paths.
6. **Mode + thoroughness** come from `devx.config.yaml` (read once).
   LOCKDOWN pauses planning — ask first. Thoroughness gates the critique
   step (see Plan stage).
7. **End every stage** by printing the output of `devx next <hash>` and
   recommending `/clear` before the next stage on long sessions. At
   wrap-up, if the session hit real friction, apply the friction-observed
   nudge — the canonical sentence is defined exactly once, at the
   `nudge-canonical` HTML-comment marker in
   `.claude/commands/devx-learn.md`; read it there and act on it.
   Reference it, never restate it.
8. **Outline step (every stage, attended sessions).** Each stage folder
   (`prd/ design/ plan/ evals/`) may hold a human-typed `outline.md` —
   optional, NEVER agent-written (PreToolUse hook + `devx outline check`
   in CI + merge-gate enforce this), never a gate input. At stage open:
   absent → offer once: "an outline is optional but genuinely helpful —
   run `devx outline init <hash> <stage>` from your own terminal and type
   it yourself; typing it is the point." Present → read it (Read tool);
   when you have findings (gaps, misinformation, design problems, places
   to expand) write/refresh `<stage>/outline-critique.md`; when clean,
   delete a stale critique. At PRD open also read the repo-root
   `OUTLINE.md` as seed context (critique → `OUTLINE-CRITIQUE.md`).
   Never `git add` an outline path — outlines reach `main` only via the
   human's `devx outline commit`.
9. **human.md (every stage, before its gate).** Write/refresh
   `<stage>/human.md`: the succinct human digest — mermaid first, brevity
   with nothing load-bearing dropped. When `<stage>/outline.md` exists,
   its structure IS human.md's structure (the outline dictates the shape);
   `agent.md` keeps the template's gate-required sections either way.
   human.md is never a gate input; conflicts resolve to `agent.md`.

## Arguments

- **Workstream hash or slug** (preferred): resolve via the plan spec /
  `_devx/workstreams/<slug>/`. Route to its current stage per
  `devx next <hash>`. A stage name after the hash ("<hash> design")
  overrides the routing.
- **`next`**: top `[ ]` item in `PLAN.md` with no unsatisfied Blocked-by;
  then as above. Flip its checkbox `[ ]` → `[/]` when starting, `[x]` when
  RED passes and dev specs are emitted.
- **Raw requirements** (prose or file path): run
  `devx workstream new <slug>` first (kebab-case slug from the topic), then
  start the PRD stage with the requirements as seed material.
- **Stage skips are legal and recorded** (D-8): small, unambiguous work may
  enter at Plan (or go straight to `/devx` as a dev spec). Say the sizing
  call out loud; record `entered_at:` in the plan-spec frontmatter.

## Stage: PRD

Inputs: requirements seed, `LEARN.md`, existing backlogs, config, repo-root
`OUTLINE.md` (rule 8). Artifacts: `_devx/workstreams/<slug>/prd/agent.md` +
`expectations.md` + `prd/human.md` (rule 9) (templates:
`_devx/templates/engine/`).

Todo step: run `devx todo sync <hash>` (the workstream's plan-spec hash —
the CLI rejects slugs), read the current-stage section of
`_devx/workstreams/<slug>/todo.md`, expand this session's sub-items as
free-nested lines, and check them as work lands. Derived `Stage:` /
`Gate:` / `Phase <n>:` lines belong to sync — never hand-check them.

1. Read `LEARN.md` cross-epic patterns + relevant sections first; budget for
   known traps ("a prior workstream found X").
2. Research before writing: fan out `Explore` subagents per unfamiliar axis
   (codebase surfaces, prior art, external constraints) in parallel; keep
   the main context clean. No PRD from cold requirements.
3. Interview the user through the template's sections **in order**, writing
   each section to disk as it settles (interruption-survivable). When
   `prd/outline.md` exists (rule 8), it drives emphasis and content within
   those sections. Assign IDs as you go: `G-` (business goals MUST be numeric + dated), `UC-`, `CAP-`,
   `FR-`. IDs are never renumbered; traceability is by ID, not prose.
4. Promote the Evals-seed into `expectations.md` E-blocks (≥
   `engine.expectations_min`, default 3): Priority, Covers (real IDs),
   Trigger, EARS sentence, measurable Threshold, concrete runnable
   Verified-by (a `projects:`-runnable path for anything P0 — `.md` prose
   targets count as deferred and fail a P0 at the RED gate).
5. Optional (`--review`, or thoroughness ≥ balanced): spawn one critique
   subagent to cross-reference other active workstreams + LEARN.md; write
   findings to `decisions/<date>-prd-critique.md`. Non-gating.
6. Run **`devx gate prd <hash>`**. On fail: fix the reported gaps (ask the
   user where a gap is a real decision), re-run until PASS. On pass the CLI
   flips `prd_validated` + `stage: design`.
7. Commit (`plan: <slug> — prd stage`), append status log, print
   `devx next <hash>`.

## Stage: Design

Inputs: prd/agent.md + expectations.md. Artifacts: `design/agent.md` +
`design/human.md` (rules 8–9 apply). **No phases, no tasks — design is the
approach, not the sequence.**

Todo step: `devx todo sync <hash>`, then expand + check this session's
free-nested sub-items (contract in Stage: PRD).

1. Open by asking the user's design questions: "You've got the PRD — what
   are you unsure about?" Work those first.
2. Ground every architectural claim in real code: read the paths in
   `engine.code_citation_hints` (plus what Explore finds); every cited
   path must exist — grep-verify before writing it down.
3. Fill the template: Overview, Constraints, Risks (each proven by an
   E-id), Trade-offs, Out of scope, Assumptions, Discarded considerations,
   **Wrap-don't-duplicate** (list what's reused vs genuinely new — the v1
   working agreement), Design (architecture / interfaces / data), Migration
   plan, Resolved + Unresolved questions.
4. Coverage gate: spawn one subagent to judge coverage — for every
   `G-/UC-/CAP-/FR-` ID in prd/agent.md, a row `{id, status: ✅|⚠️|❌, where,
   note}`; write the JSON table to a temp file. Then run
   **`devx gate coverage <hash> --table <path>`** (the CLI owns
   completeness, verdict computation, and the decisions/ report; extras
   beyond the PRD are flagged for product approval, not deleted).
5. FAIL → fix design (or `devx revise` if the PRD itself is wrong),
   re-judge, re-run. PASS/CONCERNS advances `design_verified` +
   `stage: plan`.
6. Commit, status log, print `devx next <hash>`.

## Stage: Plan

Inputs: design/agent.md + expectations.md. Artifacts: `plan/agent.md` +
`plan/human.md` (rules 8–9 apply).

Todo step: `devx todo sync <hash>`, then expand + check this session's
free-nested sub-items (contract in Stage: PRD).

1. Ask the user for their rough phase breakdown first; explore code to
   test it.
2. **Sizing rule:** a phase is one cohesive concern with a verifiable exit,
   sized to land as a single reviewable PR. Default to more, smaller
   phases. One phase ≙ one dev spec ≙ one PR (D-12).
3. Fill the template: Current / Desired / NOT doing; **Expectation
   coverage table** (every E-id: phase, validation type, artifact path,
   full/partial); Phase checklist; per-phase Overview / Files-with-why /
   Context / Verification plan (tests-first | tests-after | human | none +
   success criteria) / Tasks.
4. **Critique step** (re-homed party-mode; thoroughness-gated: skip at
   send-it unless the plan touches ≥ `engine.critique.min_surfaces`
   config/stack layers): spawn the configured lenses
   (`engine.critique.lenses`, default pm/architect/dev/qa) as parallel
   subagents, each critiquing the full plan from its lens. **Grounding
   rule: every lens claim citing a file must be grep-verified or dropped.**
   Apply accepted findings; record the pass as an HTML comment marker at
   the top of plan/agent.md (`<!-- refined: critique <date> (lenses: …) -->`)
   and a decisions/ entry.
5. Coverage gate, plan mode: subagent judges the E-id → phase map into a
   table JSON; run **`devx gate coverage <hash> --table <path>`**. The P0
   floor is mechanical: every P0 `full` + runnable artifact. PASS/CONCERNS
   → `plan_verified` + `stage: red`.
6. Commit, status log, print `devx next <hash>`.

## Stage: RED

Inputs: plan/agent.md coverage table + expectations.md. Artifacts:
`evals/*` + `evals/RED-report.md` (+ `evals/human.md`, rules 8–9), then
emitted dev specs.

Todo step: `devx todo sync <hash>`, then expand + check this session's
free-nested sub-items (contract in Stage: PRD).

1. For every expectation, author the runnable artifact **at the exact
   Verified-by path** agreed at the coverage gate (retargeting requires
   `devx revise`): a failing test at the named path, or an eval script
   under `evals/` (runnable by a `projects:` runner — keep eval scripts
   out of the default suite globs so CI stays green). tests-after / human
   types get stubs (legal for P1+; a deferred P0 fails).
2. Run **`devx gate evals <hash>`** (use `--dry-run` first to sanity-check
   resolution). Every P0 must fail *for the right reason* — missing
   feature, not an import/wiring error. Read the failure quotes in
   `evals/RED-report.md` and confirm each one; wrong-reason failures are
   yours to fix before the gate counts.
3. On PASS (flips `evals_red` + `stage: executing`): **emit the dev specs**
   — one per plan phase, v1 contract unchanged: spec file under `dev/`
   (frontmatter `from:` the plan spec; Goal + ACs from the phase's success
   criteria + tasks), branch via `devx plan-helper derive-branch dev
   <hash>`, DEV.md entries appended in dependency order, retro story
   co-emitted via `devx plan-helper emit-retro-story`, the whole emission
   validated with `devx plan-helper validate-emit <epic-slug>` (abort on
   error). Then write one `  - [ ] Phase <n>: <title> → <dev-hash>` pointer
   line per emitted spec under `Stage: Execute` in the workstream's
   `todo.md` (subsequent `devx todo sync` runs true their checkboxes).
4. Flip the PLAN.md checkbox `[x]`, commit, status log, print the final
   summary: workstream, gate verdicts, emitted specs list, and the
   Next-command block rendered from the canonical template in the
   [Hand-off to /devx](#hand-off-to-devx) section below (pln106) — render
   it from the template, do not paraphrase; Concierge and the mobile relay
   parse this block downstream.

   **Commit pathspec.** Stage by explicit path — never `git add -A`; `main`
   is the tree every concurrent session shares. The set is: every emitted
   `dev/dev-*.md`, `DEV.md`, `PLAN.md`, the plan spec, the workstream's
   `todo.md` + `evals/`, **plus `GRAPH.md` iff `emit-retro-story` printed a
   `graph=` key** (sgr104). That helper's stdout is one greppable key=value
   line — `spec=… dev_md=… [graph=…] [partial=…]`, not JSON — and `graph=`
   is present exactly when its GRAPH.md regen succeeded:

   ```
   EMIT_LINE=$(devx plan-helper emit-retro-story --epic-slug <slug> --parents <h1,h2> --plan <path>)
   GRAPH_PATH=$(printf '%s' "$EMIT_LINE" | tr ' ' '\n' | sed -n 's/^graph=//p')
   git add -- <emitted specs> DEV.md PLAN.md <plan spec> <todo+evals> ${GRAPH_PATH}
   ```

   **Outline paths are never in any stage's pathspec** — not here, not in
   the PRD/Design/Plan stage commits. `outline-critique.md` and `human.md`
   are agent artifacts and ARE staged with their stage's commit.

   Leave `${GRAPH_PATH}` **unquoted** — that is what makes it vanish when the
   key is absent. Quoting it passes `git add` an empty string, which is
   `fatal: empty string is not a valid pathspec` and stages nothing at all.

   An absent `graph=` is **not** a failure to chase: the regen already
   WARNed on stderr and left GRAPH.md untouched (on a first emission it may
   not exist at all), so naming it would fail the whole `git add` over a
   derived file. `devx graph --check` is what catches the stale board.

## Hand-off to /devx

Final summary's "Next command(s)" block is the bridge from `/devx-plan` to `/devx`. The format is **pinned** (pln106) so Concierge (Phase 2) can parse it via `devx ask "what should I run next?"` without LLM reasoning, and so future regression tests can grep the rendered block byte-stably.

### Canonical Next-command block format (pln106)

The non-empty case (≥1 ready entries):

```
Next command(s), in dependency order:
  /devx <hash>          # <one-line title>
  /devx <hash>          # <one-line title>; depends on <hash>
  /devx <hash>          # <one-line title>; parallel-safe with <hash>
  /devx <hash>          # <one-line title>; depends on <hash>; parallel-safe with <hash>
```

The empty case (DEV.md has no `[ ]` ready entries) — emitted bare with no leading indent (it's a standalone single-line entry, not a list item under a header):

```
/devx next  # picks top of DEV.md (currently empty)
```

**Format invariants** (load-bearing for downstream parsers):

- **Header line.** Non-empty case opens with the literal `Next command(s), in dependency order:` (verbatim — comma + colon, no period at end). The empty case omits the header and emits only the single `/devx next` line.
- **Indent.** Every non-empty-case entry line starts with exactly 2 leading spaces (rendered under the header). The empty case has zero leading spaces (it's standalone — the "header omitted" rule extends to dropping the indent that pairs with the header).
- **Command token.** After the indent: `/devx`, then exactly one space, then either a hash (matches `[a-z0-9]{6}` — strictly 6 chars, lowercase + digits only) or the literal `next`. Renderers MUST validate the hash shape and reject otherwise.
- **Comment separator.** After the hash/`next` token: ≥1 spaces, then `#`, then exactly one space, then the title. Non-empty entries use **exactly 10 spaces** between a 6-char hash and `#` for column-aligned visual readability — total chars before `#` are 24 (2-space indent + `/devx ` + 6-char hash + 10 spaces), so `#` lands at 0-indexed string position 24 / 1-indexed column 25. (The "≥1 spaces" is the loosest tolerance a forgiving parser would accept; renderers MUST emit exactly 10.) The empty case uses **exactly 2 spaces** between `next` and `#` per spec AC#3.
- **Title.** A one-line title (no newlines, no leading/trailing whitespace) — the spec's `title:` frontmatter field, verbatim. Titles MUST NOT contain `;` (the annotation separator); MUST NOT contain `\n` (line break) — `/devx-plan` normalizes multi-line YAML scalars (`title: |`) to a single line by joining with a single space before rendering. Renderers MUST reject titles violating these rules.
- **Dependency annotation.** Append `; depends on <hash>` after the title for entries that have at least one prerequisite. Name the most-recently-required parent in the dep graph (deepest single edge); the parser does not enumerate the full transitive list.
- **Parallel-safe annotation.** Append `; parallel-safe with <hash>` for entries that can run concurrently with another sibling (no edge between them in the dep graph). Name one peer — the most recently emitted sibling without an edge to this entry.
- **Both annotations.** When an entry carries both, emit `; depends on <a>; parallel-safe with <b>` (depends-first, then parallel-safe). Order is load-bearing for the parser.
- **Empty-case literal.** When all epics drafted are already done OR DEV.md has no `[ ]` rows, emit exactly: `/devx next  # picks top of DEV.md (currently empty)` (no leading indent, 2 spaces between `next` and `#`). The trailing `(currently empty)` parenthesized literal is what Concierge greps for to distinguish "do this next" from "everything is shipped, idle."

**Stability.** Changes to this canonical format require a paired update to `test/plan-final-summary-format.test.ts` per Murat's locked decision (soft enforcement via retro discipline; test is the reference renderer for downstream consumers).

## Key references

- `v2/02-engine.md` — stage + gate semantics (source of truth).
- `v2/07-decisions.md` — D-8 stage skips, D-9 verdicts, D-10 no external
  trackers, D-12 sizing invariant.
- `_devx/templates/engine/` — artifact shapes.
- `devx gate prd|coverage|evals`, `devx workstream new`, `devx revise`,
  `devx next`, `devx plan-helper derive-branch|emit-retro-story|validate-emit`,
  `devx outline init|commit|check|guard` (human-only outline files).
