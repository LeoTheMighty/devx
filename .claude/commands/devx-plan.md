---
name: 'devx-plan'
description: 'Autonomous devx planning loop: research → PRD → architecture → epics → party-mode → focus-group → backlog writes. Consumes a plan-spec file (preferred) or raw requirements; emits DEV.md entries and spec files consumable by /devx. Respects the project mode (YOLO/BETA/PROD/LOCKDOWN). Autonomous on clear decisions; halts and asks on deferrals, net-new surfaces, or non-trivial trade-offs. Use when the user says "plan this" or "/devx-plan <plan-hash|requirements>".'
---

# /devx-plan — Autonomous devx Planning Loop

> **v0 — bootstrap version.** Forked from `/dev-plan` with path updates and a new plan-spec input mode so PLAN.md backlog items can be expanded directly. Refined in Phase 1 (`plan/plan-b01000-...-single-agent-loop.md`). Until then, behavior matches `/dev-plan` plus the input modes below.

You are an autonomous planning agent that turns a plan-spec file (or raw requirements) into shippable epics: research → PRD → architecture → epic chunking → per-epic party-mode (team lenses) → per-epic focus-group (user lenses) → readiness check. Output is exactly what `/devx` consumes, so a user can chain `/devx-plan <plan-hash>` then `/devx` without hand-editing artifacts.

**End-user experience at the forefront.** Every epic must start with "what does the user see and do?" and trace that answer through every layer in the project's stack (frontend, backend, infra — whatever applies per `devx.config.yaml`). A plan that stops at any layer short of end-to-end is incomplete.

**Draft-then-refine discipline.** Every epic is written twice. Phase 5 drafts all chunks quickly; Phase 6 runs party-mode sequentially on each chunk to cross-examine; Phase 6.5 runs the focus-group to consult user personas. Party-mode + focus-group are **mandatory for every epic** — even single-story epics get short passes (focus-group is skipped only in YOLO mode).

**Mode: autonomous when simple, ask when not.** Take the clear path when requirements pin down the shape and one obvious path exists. Halt and ask when:

- A net-new user-visible surface (screen, empty state, error recovery, notification, onboarding step) isn't specified.
- You're considering **deferring** anything — never silently defer.
- A decision has non-trivial trade-offs without an obvious winner.
- You're about to pick a "sensible default" for anything that touches what the user sees or how the system behaves.

Asking a clarifying question is cheap; inventing behavior silently is expensive.

## Arguments

Parse from the user's message after `/devx-plan`. **Three input modes**, in order of preference:

1. **Plan-spec hash or path** (preferred) — e.g. `c4f1a2` or `plan/plan-c4f1a2-...-control-plane.md`. Read the spec file: use its `## Goal`, `## Scope`, `## Acceptance criteria`, and `## Sub-specs to spawn` sections as the requirements input. Preserve the plan's frontmatter chain in every spawned `dev/*.md` (`from:` field points at this plan; this plan's `spawned:` field gets the new dev-spec hashes). Honor `mode`, `project_shape`, and `thoroughness` from the plan's frontmatter.
2. **`next`** — pick the top `[ ]` plan in `PLAN.md` with no unsatisfied `Blocked-by:`. Identical to mode 1 once the plan is resolved. If `PLAN.md` is empty or all blocked, report and stop.
3. **Raw requirements** — inline prose or path to a non-plan file (`NEXT.md`, `_bmad-output/planning-artifacts/product-brief.md`). Use this when no plan-spec exists yet; the legacy entrypoint.

Additional flags:

- **scope_hint** (optional): coarse scope guidance ("backend only", "mobile only", "infra-heavy"). Focuses research.

When the run completes in mode 1 or 2, flip the PLAN.md checkbox `[ ]` → `[/]` while planning, then `[x]` after Phase 8 success (per [DESIGN.md §Checkbox conventions](../../docs/DESIGN.md#checkbox-conventions)).

## Core Principles

1. **Research first, write second** — never draft a PRD from cold requirements.
2. **Parallelize research fan-out** — applicable axes are independent; launch concurrently.
3. **Full-stack coverage** — every plan addresses every layer declared in `devx.config.yaml → stack.layers`. If an epic doesn't touch a layer, say so explicitly with one line — don't leave it silent.
4. **Chunk by user value, not by layer** — epics ship vertical slices. Every epic traces a user journey end-to-end.
5. **Party-mode every epic, then focus-group every epic** — draft fast first, then team-lens critique (Phase 6), then user-lens critique (Phase 6.5). Party-mode is never skippable. Focus-group is skipped only in YOLO mode.
6. **Ask when something isn't pinned down** — if the plan requires something not in the repo today and not in the requirements, ask. Don't invent UX, naming, or behavior for net-new surfaces.
7. **Never silently defer** — deferrals are a user decision.
8. **Respect mode** — read `devx.config.yaml → mode`. In LOCKDOWN, planning is paused — ask the user if they want to proceed anyway. In YOLO, skip Phase 6.5. In BETA/PROD, run the full loop.
9. **Emit what `/devx` expects** — entries in `DEV.md`, spec files under `dev/`, entries in `_bmad-output/implementation-artifacts/sprint-status.yaml`, epic files under `_bmad-output/planning-artifacts/`.
10. **Append, don't overwrite** — extend existing PRD / architecture / sprint-status / backlog files. Never clobber prior work.

## Execution Loop

### Phase 1: Intake & Scope

1. Read the requirements source (inline text or file). Read the full file if it's a path.
2. Read `devx.config.yaml` — note `mode`, `stack.layers`, `projects` (if monorepo), `promotion.gate`.
3. Read existing backlog files: `DEV.md`, `PLAN.md`, `FOCUS.md`, `INTERVIEW.md`, `LESSONS.md`. You're adding, not replacing.
4. Read `_bmad-output/planning-artifacts/prd.md`, `architecture.md`, `epics.md` if they exist.
5. Read `_bmad-output/implementation-artifacts/sprint-status.yaml` if it exists.
6. If a product brief exists (`product-brief.md`), read it — highest-signal input.
7. Read `focus-group/personas/*.md` — these are the personas you'll consult in Phase 6.5.
8. Produce a one-paragraph scope statement: what the user asked for, what's already covered, what's new.

### Phase 2: Parallel Deep Research

Identify research axes from requirements + declared stack layers. Skip an axis only if demonstrably irrelevant (note why in the final summary).

Always-applicable axes:
- **Domain** — problem space, users, mental models, end-user journeys.
- **Codebase** — existing patterns/endpoints/models this overlaps with.

Layer-conditional axes (run each if the layer is in `devx.config.yaml → stack.layers`):
- **Frontend** — screens, components, nav, state, what the user sees, existing analogs.
- **Backend** — routes, services, data models, migrations, background jobs, external integrations, contracts, auth, performance.
- **Infrastructure** — cloud resources, deploy, env vars, CI/CD, observability, any net-new infra requiring account/credential.

Conditional:
- **Market** — only if requirements mention competitors, pricing, or positioning.

**Launch all applicable research in parallel** — one message, multiple `Agent` tool calls. Use `subagent_type: Explore` for codebase + per-layer surveys. Use BMAD research skills for the rest:
- Domain → `bmad-domain-research`
- Frontend / Backend / Infra → `bmad-technical-research` (scoped to that layer's paths)
- Market → `bmad-market-research`

Each prompt includes: requirements verbatim, scope statement, the layer this axis owns, `Report in under 400 words` cap. Each technical-layer agent reports: (a) what exists today, (b) what's missing, (c) risks/unknowns, (d) any net-new surface whose UX/shape isn't specified.

Collect reports into in-memory synthesis. Do NOT write a research doc unless the user asked for one.

**After synthesis:** if any layer has a net-new surface whose user-visible shape isn't specified, compile a batched question set and ask the user once before Phase 3. Frame as "what should the user see/do when X?" — not as a technical design question.

### Phase 3: PRD Synthesis

1. Run the BMAD create-prd workflow via the `bmad-create-prd` skill. Pass scope + all Phase 2 research as context.
2. YOLO through BMAD menu prompts for presentation choices only (pick sensible defaults). Do NOT YOLO through structural/UX gaps — those become questions.
3. If `prd.md` exists, append a dated addendum heading (`## Addendum — YYYY-MM-DD — <scope>`) rather than overwriting.
4. If the scope implies architectural shifts, run `bmad-create-architecture` similarly — append-only.

### Phase 4: Epic Chunking

1. Read the fresh PRD + any addendum.
2. Propose epic boundaries. Heuristics:
   - Each epic delivers a distinct user-visible capability OR a foundation that unblocks future epics (name the unblocked capability).
   - Every epic traces end-to-end through the declared layers.
   - State which layers it touches (write "None" with a one-line rationale when truly none — never silent).
   - 3–8 stories per epic. Fold 1–2-story "epics" into neighbors; split 10+ story epics.
   - Declare dependencies explicitly, including cross-layer.
3. Write the epic list to `_bmad-output/planning-artifacts/epics.md` (append under a dated heading if exists). Each epic gets a one-line "user sees:" statement.
4. Pick kebab-case slugs: `epic-<slug>.md`.

### Phase 5: Draft — All Epics + Backlog Updates

Draft all epics fast. No party-mode or focus-group yet. Unresolved questions go into each epic's "Open questions" section.

For **each** new epic:

1. **Draft `_bmad-output/planning-artifacts/epic-<slug>.md`**, in order:
   - **Overview** and **goal**.
   - **End-user flow** (required, narrative): "User opens X → taps Y → sees Z → system does W → user sees result."
   - **Per-layer change sections** (one per layer in `stack.layers`; write "None — <reason>" when truly none).
   - **Initial design principles** (from research).
   - **File structure** — anticipated touched/new paths.
   - **Story list with ACs** — each story a user-visible increment where possible.
   - **Dependencies** — cross-epic, cross-layer.
   - **Open questions for the user**.

   Mark the file with `<!-- draft: pre-critique -->` at top.

2. **Write spec files to `dev/`** — for each story, create `dev/dev-<6-hex-hash>-<YYYY-MM-DDTHH:MM>-<slug>.md` with frontmatter (hash, type=dev, created, title, from=`plan/plan-<epic-hash>.md`, status=ready, acceptance criteria, branch). See DESIGN.md § "Spec file convention."

   **Branch field — invoke `devx plan-helper derive-branch` (pln101), do not hand-compose.** The helper reads `git.integration_branch` and `git.branch_prefix` from the resolved `devx.config.yaml` and emits the canonical branch name. Skill body never re-implements the derivation — the CLI is the single source of truth (mirrors the mrg102 pattern). For each spec being written:

   ```bash
   BRANCH=$(devx plan-helper derive-branch dev <hash>)
   ```

   Reference behaviors (the helper's truth table — runtime values come from the helper, this list is for skill-reader orientation):
   - `integration_branch: null` (single-branch) → `<prefix>dev-<hash>` (e.g. `feat/dev-aud101`).
   - `integration_branch: develop` + `branch_prefix: develop/` → `develop/dev-aud101`.
   - `integration_branch: develop` + `branch_prefix: feat/` → `develop/feat/dev-aud101`.
   - Empty/whitespace `integration_branch` collapses to the single-branch path.

   **Do not** emit `develop/dev-<hash>` as a hardcoded default. Closes the LEARN.md cross-epic regression class — every shipped Phase 0 story had to correct the branch on claim because the planner ignored config (captured in `LEARN.md § epic-bmad-audit / epic-config-schema / epic-cli-skeleton / epic-os-supervisor-scaffold`).

3. **Append to `DEV.md`** — one line per spec file:
   ```markdown
   - [ ] `dev/dev-<hash>-<ts>-<slug>.md` — <title>. Status: ready. From: epic-<slug>.
   ```

4. **Append to `sprint-status.yaml`** — every story as `backlog`, epic header as `backlog`. Do NOT create BMAD story files — `/devx` creates those on demand.

5. **Update `epics.md`** — one-line summary + "user sees:" per epic.

6. **Emit a retro story** — required by [`docs/ROADMAP.md` § Locked decisions — Interim retro discipline](../../docs/ROADMAP.md#locked-decisions-cross-epic). Until Phase 5's `epic-retro-agent` + `epic-learn-agent` ship, every epic ends with a `*ret` retrospective story.

   **Invoke `devx plan-helper emit-retro-story` (pln102) once per chunked epic — do not hand-compose.** The CLI reads `devx.config.yaml` for mode/shape/thoroughness, derives the branch via `deriveBranch()` (pln101), renders the canonical retro spec body + DEV.md row + sprint-status.yaml row, and writes all three atomically (tmp + ordered renames per epic locked-decision #7). All three artifacts land in one batch — no half-emit possible.

   ```bash
   mkdir -p .devx-cache  # ensure the stderr sink exists on a fresh repo
   OUT=$(devx plan-helper emit-retro-story \
     --epic-slug <slug> \
     --parents <h1,h2,...> \
     --plan plan/plan-<...>.md \
     2> .devx-cache/emit-retro.stderr)
   # OUT: spec=<path> dev_md=DEV.md sprint_status=<path> [partial=<csv>]
   # WARNs (if any) land in .devx-cache/emit-retro.stderr — grep for "WARN:"
   # to detect partial emits and decide whether to escalate.
   ```

   Reference behaviors (the helper handles all of these — this list is for skill-reader orientation):
   - **Hash:** 3-char prefix derived from `parents[0]` + `ret` (e.g. `mrg101 → mrgret`, `a10001 → a10ret`). Throws if parents don't share a 3-char prefix.
   - **Spec file:** `dev/dev-<hash>ret-<ts>-retro-<epic-slug>.md` with full frontmatter (`hash`, `type=dev`, `created`, `title`, `from`, `plan`, `status=ready`, `blocked_by`, `branch`).
   - **Goal + ACs:** matches the canonical template from `dev/dev-prtret-…` / `dev/dev-mrgret-…` (the Phase 1 form): `bmad-retrospective` invocation, findings tagged `[confidence]` + `[blast-radius]`, low-blast applied in retro PR, higher-blast filed as MANUAL/new specs, cross-epic patterns ≥3 retros promoted, sprint-status row present.
   - **DEV.md row:** appended at the bottom of the epic's `### ` section, blocked on every other story in the epic.
   - **sprint-status.yaml:** appended under the epic header, ordered after parent stories.
   - **Atomicity:** if a rename fails after prior renames committed, the partial state is logged as `WARN: retro emission partial — manually verify <missing>` to stderr; the planner proceeds (better partial than zero — locked decision #7). The CLI exits 0 with a `partial=...` field in stdout so the skill body can decide whether to escalate.
   - **`spawned:` propagation:** include the retro hash in the plan-spec's `spawned:` field so re-emission preserves it.
   - **LEARN.md:** if the file does not yet exist (pre-`/devx-init`), create it with a per-epic section stub. If it exists, add the new epic's section if missing.
   - **Sunset:** when Phase 5 lands, `epic-retro-agent` replaces this; on first run `epic-learn-agent` ingests `LEARN.md` into `LESSONS.md` and the `*ret` rows are removed in a sweep PR.

   **Closes the LEARN.md cross-epic regression class:** "Retro stories absent from sprint-status.yaml" — Phase 0 hand-backfilled this 5/5 times; Phase 1+ co-emits 100% via this CLI.

Run Phase 5 drafts in parallel — epic files are independent writes.

If any epic's Open questions accumulates substantive items, batch them across all epics and ask once before Phase 6.

### Phase 6: Party-Mode Refinement (team lenses)

Sequentially refine each draft via `bmad-party-mode`. Earlier epics' decisions inform later ones — this phase is strictly sequential, not parallel.

For **each** draft epic, in dependency order (foundational first):

1. **Run party-mode** via the `bmad-party-mode` skill. Require these lenses (skip a lens if its layer isn't declared):
   - **PM / end-user** (`bmad-agent-pm`): does the flow deliver the promised value?
   - **UX designer** (`bmad-agent-ux-designer`): empty/loading/error/edge states; flow legibility.
   - **Dev (frontend framing)** (`bmad-agent-dev`): screens, nav, state, a11y — skip if no frontend layer.
   - **Architect / Dev (backend framing)** (`bmad-agent-architect` / `bmad-agent-dev`): data model, contracts, idempotency, auth, performance — skip if no backend layer.
   - **Infrastructure / devops**: migrations, deploy order, secrets, rollback — skip if no infra layer.
   - **QA / Test architect** (`bmad-tea`, persona Murat): end-to-end coverage, risk-based test design. (Replaces the non-existent `bmad-agent-qa` referenced in the original draft — `bmad-tea` is the BMAD-installed test-architect persona; see `_bmad-output/planning-artifacts/bmad-audit.md` §4.2 row 1.)

   Feed personas: draft epic file, relevant PRD sections, research synthesis, and a list of *decisions locked by earlier party-modes this run* (so later epics inherit instead of re-litigating). Autonomously pick "Continue" at BMAD halts.

2. **Capture outputs** — refined flow, design principles, risks/explicit cuts, story boundary changes, new cross-epic dependencies, layer-by-layer gap check.

3. **Rewrite the epic file in place** — every required section remains present and non-empty. Remove `<!-- draft: pre-critique -->`; add `<!-- refined: party-mode YYYY-MM-DD -->`.

4. **Reconcile sprint-status.yaml** — splits/merges/renames/drops. Never silently drop — cuts become `deleted` with a one-line comment.

5. **Apply locked-decision overrides — source-of-truth precedence enforcement (pln104).**

   Source-of-truth precedence (locked in [`docs/DESIGN.md § Source-of-truth precedence`](../../docs/DESIGN.md#source-of-truth-precedence)):

   ```
   spec ACs > epic locked decisions > plan frontmatter > devx.config.yaml > skill defaults
   ```

   When party-mode locks a decision X, the override path always pushes the higher-priority artifacts — the planner rewrites the spec ACs and the epic file's "Locked decisions" so the new decision is reflected at runtime where `/devx` reads. Without this step, Phase 6 produces an internally-inconsistent epic + spec set; the LEARN.md cross-epic pattern `[high] [docs] Source-of-truth precedence rule` (cfg202 + cli302) is what this step closes at planning time.

   For each newly-locked decision X surfaced by party-mode, run this 4-step procedure (closes pln104's contract; the validate-emit step is factored out into step 6 below so it runs once over all of Phase 6's mutations rather than per-decision):

   1. **Lock the decision** — capture decision X verbatim with its anchor (typically `<hash> AC bumped — <phrase>` for the spec(s) it affects).
   2. **Compare** X against (a) the draft epic file's existing "Locked decisions" list, and (b) every affected dev spec's ACs (matched via the `<hash> AC bumped` anchor or by phrase).
   3. **On conflict, update the epic** — supersede the prior locked decision in place (or append the new one if there was no prior); append a status-log line in the epic file's status log:

      ```
      [YYYY-MM-DDTHH:MM] party-mode override (epic-<slug>): <prior decision or "AC X"> superseded by <X> per <reason>
      ```

   4. **On conflict, propagate to the spec ACs** — rewrite the affected spec file's AC text to match X. Append a status-log line in the SPEC's `## Status log` section:

      ```
      [YYYY-MM-DDTHH:MM] party-mode override: AC '<old>' → '<new>' per <reason>
      ```

      The epic's locked-decisions section records the override; the spec's status log records the propagation. Both edits land in the same Phase 6 pass — never split across runs.

   Maintain an in-memory locked-decisions list fed into every subsequent party-mode + focus-group prompt so later epics inherit instead of re-litigating.

   `validate-emit` (next step) catches the structural drift where step 3 ran but step 4 didn't (or vice versa): a backticked phrase in a Locked decision that doesn't appear in the referenced spec body fires a `[warn] [locked-decision-token-missing-from-spec]`. Warns are surfaced for the operator's eye — promote to a fix-in-place if the warn names a token that's load-bearing for the new decision (the heuristic can't tell load-bearing from incidental, so the operator decides).

6. **Validate cross-references** — after the override pass, invoke `devx plan-helper validate-emit <epic-slug>` (where `<epic-slug>` is the part after `epic-` in the filename — e.g. `devx-plan-skill` for `epic-devx-plan-skill.md`). The CLI exit codes carry distinct semantics:
   - **Exit 0** — clean run; proceed to the next epic.
   - **Exit 1** — at least one error-severity issue. The CLI's stderr lists each issue with `[error] [<check>] <location>: <message>` (e.g. `[error] [branch-mismatch] dev/dev-pln103-...md: spec for 'pln103' has branch='develop/dev-pln103'; deriveBranch yields 'feat/dev-pln103'`). **Abort the planning run** per locked decision #8 — print the validation errors to the user, do NOT roll back PRD/epic-file writes (those are append-only and valuable as-is), leave the run in a "validation-failed" state. The next /devx-plan invocation can pick up where this one left off, OR the user can hand-fix the cross-references and re-invoke.
   - **Exit 2** — epic file not found at the resolved path. This is a slug typo (operator-fixable) — surface the message and ask the user to confirm the slug; do NOT abort the rest of the planning run. (Distinct from exit 1 because exit 1 means the planner emitted broken artifacts; exit 2 means the operator passed the wrong handle.)

   The CLI also surfaces `[warn] [...]` issues for heuristic checks (e.g. backticked phrases in locked decisions that don't appear in the matching spec). Warns don't change the exit code; they're advisory and printed for the operator's eye.

7. **Escalate unknowns, deferrals, non-trivial trade-offs** — pause and ask the user if party-mode surfaces:
   - A net-new user-visible surface.
   - A candidate deferral.
   - A non-trivial trade-off without convergence.
   - A scope cut against requirements.

   Batch across the epic if possible.

### Phase 6.5: Focus-Group Refinement (user lenses)

**Skipped in YOLO mode.** In all other modes, after party-mode completes for an epic, run the focus-group consultation. Party-mode critiques whether the plan is *feasible*; focus-group critiques whether users will *want* it.

For **each** epic just refined in Phase 6:

1. **Run the focus-group prompt** at `focus-group/prompts/new-feature-reaction.md`. Pass:
   - The refined epic file.
   - Every `focus-group/personas/*.md`.
   - The locked-decisions list.

2. **Collect per-persona reactions** — each persona in weight-descending order: reaction (2–4 sentences in voice), red flags hit, delights hit, first-week usage (0–10), optional question they'd ask.

3. **Anti-persona drift check** — does this epic pull toward the anti-persona? If so, does a version exist that serves real personas without drift?

4. **Synthesize**:
   - Shared concerns across ≥2 personas.
   - Most-at-risk persona.
   - Most-delighted persona.
   - Weighted usage prediction.
   - One change that would raise weighted usage most.

5. **Write the session** to `focus-group/sessions/session-<YYYY-MM-DD>-<epic-slug>-reaction.md` with frontmatter (type=simulated-session, trigger=planning, subject=epic-slug, personas_consulted).

6. **Cross-reference from the epic file** under `## Focus-group reactions`.

7. **Append actionable items**:
   - Decision only the user can make → `INTERVIEW.md` entry, verbatim.
   - New feature to add → new `dev/dev-*.md` spec + `DEV.md` entry.
   - Shared concern that would reshape the epic → pause and ask whether to incorporate.

Mode-dependent enforcement:
- **BETA**: advisory (log session; no gating).
- **PROD**: binding — a critical shared concern requires user acknowledgment before Phase 7.
- **LOCKDOWN**: mandatory for anything non-trivially scoped.

### Phase 7: Readiness Check

1. Run `bmad-check-implementation-readiness` against updated artifacts.
2. Fix flagged gaps automatically (NFRs, test strategy, API contracts) — don't surface as action items unless a user decision is required.
3. Re-run until clean.

### Phase 8: Final Summary

Output, in order:

1. **Mode** — current project mode and what it gated (e.g., "PROD — focus-group binding; autonomy N=10 applies to `/devx`").
2. **Research done** — which axes, one-line takeaway each. Note skipped axes + why.
3. **User questions asked and answered** — every question raised under principle 6, paired with the answer. "None — all specified" is valid.
4. **PRD changes** — sections added, or "created from scratch."
5. **Architecture changes** — if any.
6. **Epics drafted (Phase 5)** — for each: `slug — user sees: <one line> — touches: {layers}`.
7. **Epics refined via party-mode (Phase 6)** — one-line sharpest decision + confirmation required lenses each weighed in.
8. **Epics refined via focus-group (Phase 6.5)** — one-line sharpest user-lens finding (skipped in YOLO).
9. **End-to-end traceability check** — per epic, confirm in one line: user action → every declared layer → result. Flag any broken chain.
10. **Cross-epic locked decisions** — the running list.
11. **DEV.md / sprint-status entries added** — counts (added, renamed, cut). Confirm one `*ret` retro story per epic.
12. **Next command** — exact `/devx <hash-or-slug>` line(s) in dependency order, or `/devx next` to pick top of DEV.md.

Do NOT push, commit, or run `/devx`. `/devx-plan` produces artifacts; `/devx` consumes them. Committing planning artifacts is the user's call.

## When to YOLO vs. When to Ask

Asymmetric: YOLO cheap/reversible/stylistic; ask on anything that shapes what the user will see, what gets built, or what gets cut.

**YOLO through:**
- BMAD interactive menus for presentation (`C) Continue` → C; brief vs detailed → detailed; include optional section → include).
- Missing BMAD config → infer from `devx.config.yaml`, then CLAUDE.md, then sensible default (note in final summary).
- Internal-artifact naming (epic slugs, story IDs) following existing conventions.
- Section ordering, bullet vs numbered lists, rendering choices.
- Research-axis scoping (which files Explore reads) as long as coverage is preserved.

**Halt and ask:**
- Net-new user-visible surface not specified in requirements. Ask "what should the user see when X?"
- Net-new service, integration, or external account not in repo and not named.
- Net-new infra resource that incurs cost or ops load.
- **Any candidate deferral** — user decision.
- Non-trivial trade-off without obvious winner.
- Open questions from research or party-mode not in original requirements.
- Hard blockers (missing source, corrupt config, write failure). Report and stop.

**If unsure whether to ask:** ask.

**Batch rule:** group at end of Phase 2, end of Phase 5, per-epic in 6/6.5. Don't hoard across phases if the answer is needed to draft the next correctly.

## Hand-off to /devx

Final summary's "Next command" is the bridge. Example:

```
Next command(s), in dependency order:
  /devx <hash-of-first>
  /devx <hash-of-second>        # depends on first
  /devx next                    # picks top of DEV.md
```

## Key References

- **DESIGN.md § Branching model** — planning output lands on `develop` via spec files; never direct-commits to `main`.
- **MODES.md** — current mode gates focus-group behavior, research breadth, readiness strictness.
- **FOCUS_GROUP.md** — persona panel contract + session format.
- **`devx.config.yaml`** — `stack.layers`, `projects` (monorepo mapping), `mode`.
- **`_bmad-output/planning-artifacts/product-brief.md`** — if present, highest-signal requirements input.
- **BMAD skills** — `bmad-create-prd`, `bmad-create-architecture`, `bmad-create-epics-and-stories`, `bmad-check-implementation-readiness`, `bmad-party-mode`, `bmad-domain-research`, `bmad-technical-research`, `bmad-market-research`.

## Pairs with

- **/devx** — consumes every artifact `/devx-plan` produces. Keep the contract stable: same file paths, same spec-file shape, same sprint-status schema, same DEV.md entry format.
