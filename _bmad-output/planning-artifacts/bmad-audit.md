# BMAD audit

**Status:** Complete (Sections 1–5).
**Audit date:** 2026-04-26
**Audited by:** /devx aud101 (inventory), /devx aud102 (classification), /devx aud103 (risks + finalize).
**Subject of audit:** the BMAD installation under `_bmad/` in this repo, as of the
versions stamped below. Re-run this audit when any module version changes (see
`_bmad/_config/manifest.yaml` → `modules[].version`).

---

## Section 1 — Module inventory

This section lists every BMAD skill and agent installed under `_bmad/{core,bmm,tea}/`
with module / path / name / one-line purpose. Classification (invoke / wrap /
escape-hatch / shadow / orphan) is the next story's job (aud102) and is intentionally
absent here.

### Source of truth for this section

The directory walk of `_bmad/{core,bmm,tea}/` in this repo yields only manifests and
config files — the per-skill `SKILL.md` / `workflow.yaml` source files are **not
vendored into this repo's tree**. They live alongside the skill loader (Claude
Code's `~/.claude/skills/` and the BMAD npm package) and are referenced by name.
What IS in this repo is the canonical inventory data, written by the BMAD
installer:

- `_bmad/_config/manifest.yaml` — installation + module versions.
- `_bmad/_config/skill-manifest.csv` — every skill's canonical-id, name,
  description, owning module, and intended `_bmad/...` path. **Authoritative for
  this inventory.**
- `_bmad/_config/agent-manifest.csv` — bmm-side named agents (persona, role,
  identity, principles).
- `_bmad/_config/bmad-help.csv` — workflow-level help table (phase, code,
  sequence, command, output location, sequence dependencies).
- `_bmad/{core,bmm,tea}/config.yaml` — per-module configuration generated at
  install time.
- `_bmad/{core,bmm,tea}/module-help.csv` — per-module help (subset of
  `bmad-help.csv`).

Drift check: counts in this section reconcile with the BMAD skills exposed to
Claude Code at session start (51 skills total). The `description` column from
`skill-manifest.csv` is the content of each skill's `description:` SKILL.md
frontmatter — the same text Claude Code surfaces in its skill list — and serves
here as the "one-line purpose" required by aud101 AC2.

> **Forward-pointing note for aud103.** The Phase 0 commit
> `508a62c chore: vendor BMAD framework + skills` stamps the manifests but does
> not actually vendor the SKILL.md / workflow.yaml source into this repo's
> tree. If `~/.claude/skills/` and the manifests in `_bmad/_config/` ever
> diverge (e.g., the user updates the npm-installed BMAD version on their
> machine while the in-repo manifests stay pinned), this audit goes stale
> silently. aud103 should add this as a risk in Section 3 with whatever
> ordering fits the rest of that section's risks. **Resolved: §3.5.**

### 1.1 Module versions

From `_bmad/_config/manifest.yaml`:

| Module | Version | Source | Install date |
|---|---|---|---|
| `core` | 6.3.0 | built-in | 2026-04-23 |
| `bmm` | 6.3.0 | built-in | 2026-04-23 |
| `tea` | 1.13.1 | external (npm: `bmad-method-test-architecture-enterprise`) | 2026-04-23 |

BMAD installer version: 6.3.0. IDE: claude-code.

### 1.2 `core` — cross-cutting reasoning, editorial, and meta skills (11 skills, 0 named agents)

`core` provides phase-agnostic skills usable from anywhere in any BMAD workflow.
No named agents (no personas registered in `agent-manifest.csv`).

| Skill | Path | One-line purpose |
|---|---|---|
| `bmad-advanced-elicitation` | `_bmad/core/bmad-advanced-elicitation/` | Push the LLM to reconsider, refine, and improve recent output (Socratic, first principles, pre-mortem, red team). |
| `bmad-brainstorming` | `_bmad/core/bmad-brainstorming/` | Facilitate interactive brainstorming sessions using diverse creative techniques and ideation methods. |
| `bmad-distillator` | `_bmad/core/bmad-distillator/` | Lossless LLM-optimized compression of source documents. |
| `bmad-editorial-review-prose` | `_bmad/core/bmad-editorial-review-prose/` | Clinical copy-editor that reviews text for communication issues. |
| `bmad-editorial-review-structure` | `_bmad/core/bmad-editorial-review-structure/` | Structural editor proposing cuts, reorganization, and simplification while preserving comprehension. |
| `bmad-help` | `_bmad/core/bmad-help/` | Analyze current state and user query to recommend the next BMAD skill(s) to use. |
| `bmad-index-docs` | `_bmad/core/bmad-index-docs/` | Generate or update an `index.md` referencing all docs in a folder. |
| `bmad-party-mode` | `_bmad/core/bmad-party-mode/` | Orchestrate group discussions between installed BMAD agents (each agent a real subagent with independent thinking). |
| `bmad-review-adversarial-general` | `_bmad/core/bmad-review-adversarial-general/` | Cynical review producing a findings report. |
| `bmad-review-edge-case-hunter` | `_bmad/core/bmad-review-edge-case-hunter/` | Walk every branching path and boundary condition; report only unhandled edge cases. Method-driven, orthogonal to adversarial review. |
| `bmad-shard-doc` | `_bmad/core/bmad-shard-doc/` | Split large markdown documents into smaller files based on level-2 sections. |

Workflow-level help (`bmad-help.csv` "Core" rows) registers 9 of these as having
an associated workflow command; `bmad-advanced-elicitation` and `bmad-help` are
present in the skill manifest but absent from the Core workflow help — they
behave as on-demand utilities, not workflow steps.

### 1.3 `bmm` — BMad Method core SDLC workflows (30 skills, 6 named agents)

`bmm` is the workflow backbone — an opinionated SDLC organized into four phases.
Each phase has skills (workflow steps) and, where applicable, a phase-anchoring
named agent.

#### 1.3.1 bmm — named agents (`agent-manifest.csv`)

| Skill | Persona | Title | Role | Phase home |
|---|---|---|---|---|
| `bmad-agent-analyst` | Mary | Business Analyst | Strategic Business Analyst + Requirements Expert | 1-analysis |
| `bmad-agent-tech-writer` | Paige | Technical Writer | Technical Documentation Specialist + Knowledge Curator | 1-analysis |
| `bmad-agent-pm` | John | Product Manager | PRD creation, requirements discovery, stakeholder alignment | 2-plan-workflows |
| `bmad-agent-ux-designer` | Sally | UX Designer | User research, interaction design, UI patterns | 2-plan-workflows |
| `bmad-agent-architect` | Winston | Architect | System Architect + Technical Design Leader | 3-solutioning |
| `bmad-agent-dev` | Amelia | Developer Agent | Senior Software Engineer (story execution + TDD) | 4-implementation |

#### 1.3.2 bmm — Phase 1: analysis (8 skills)

| Skill | Path | One-line purpose |
|---|---|---|
| `bmad-agent-analyst` | `_bmad/bmm/1-analysis/bmad-agent-analyst/` | Strategic business analyst + requirements expert (agent: Mary). |
| `bmad-agent-tech-writer` | `_bmad/bmm/1-analysis/bmad-agent-tech-writer/` | Technical documentation specialist + knowledge curator (agent: Paige). |
| `bmad-document-project` | `_bmad/bmm/1-analysis/bmad-document-project/` | Document brownfield projects for AI context. |
| `bmad-prfaq` | `_bmad/bmm/1-analysis/bmad-prfaq/` | Working Backwards PRFAQ challenge to forge and stress-test product concepts. |
| `bmad-product-brief` | `_bmad/bmm/1-analysis/bmad-product-brief/` | Create or update product briefs through guided or autonomous discovery. |
| `bmad-domain-research` | `_bmad/bmm/1-analysis/research/bmad-domain-research/` | Conduct domain and industry research. |
| `bmad-market-research` | `_bmad/bmm/1-analysis/research/bmad-market-research/` | Conduct market research on competition and customers. |
| `bmad-technical-research` | `_bmad/bmm/1-analysis/research/bmad-technical-research/` | Conduct technical research on technologies and architecture. |

#### 1.3.3 bmm — Phase 2: planning (6 skills)

| Skill | Path | One-line purpose |
|---|---|---|
| `bmad-agent-pm` | `_bmad/bmm/2-plan-workflows/bmad-agent-pm/` | Product manager for PRD creation and requirements discovery (agent: John). |
| `bmad-agent-ux-designer` | `_bmad/bmm/2-plan-workflows/bmad-agent-ux-designer/` | UX designer and UI specialist (agent: Sally). |
| `bmad-create-prd` | `_bmad/bmm/2-plan-workflows/bmad-create-prd/` | Create a PRD from scratch. |
| `bmad-create-ux-design` | `_bmad/bmm/2-plan-workflows/bmad-create-ux-design/` | Plan UX patterns and design specifications. |
| `bmad-edit-prd` | `_bmad/bmm/2-plan-workflows/bmad-edit-prd/` | Edit an existing PRD. |
| `bmad-validate-prd` | `_bmad/bmm/2-plan-workflows/bmad-validate-prd/` | Validate a PRD against standards. |

#### 1.3.4 bmm — Phase 3: solutioning (5 skills)

| Skill | Path | One-line purpose |
|---|---|---|
| `bmad-agent-architect` | `_bmad/bmm/3-solutioning/bmad-agent-architect/` | System architect + technical design leader (agent: Winston). |
| `bmad-check-implementation-readiness` | `_bmad/bmm/3-solutioning/bmad-check-implementation-readiness/` | Validate PRD, UX, Architecture, and Epics specs are complete. |
| `bmad-create-architecture` | `_bmad/bmm/3-solutioning/bmad-create-architecture/` | Create architecture solution-design decisions for AI agent consistency. |
| `bmad-create-epics-and-stories` | `_bmad/bmm/3-solutioning/bmad-create-epics-and-stories/` | Break requirements into epics and user stories. |
| `bmad-generate-project-context` | `_bmad/bmm/3-solutioning/bmad-generate-project-context/` | Scan existing codebase to generate a lean LLM-optimized `project-context.md`. |

#### 1.3.5 bmm — Phase 4: implementation (11 skills)

| Skill | Path | One-line purpose |
|---|---|---|
| `bmad-agent-dev` | `_bmad/bmm/4-implementation/bmad-agent-dev/` | Senior software engineer for story execution and code implementation (agent: Amelia). |
| `bmad-checkpoint-preview` | `_bmad/bmm/4-implementation/bmad-checkpoint-preview/` | LLM-assisted human-in-the-loop review — make sense of a change, focus attention, test. |
| `bmad-code-review` | `_bmad/bmm/4-implementation/bmad-code-review/` | Adversarial code review with parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). |
| `bmad-correct-course` | `_bmad/bmm/4-implementation/bmad-correct-course/` | Manage significant changes during sprint execution. |
| `bmad-create-story` | `_bmad/bmm/4-implementation/bmad-create-story/` | Create a dedicated story file with all context the agent will need to implement it later. |
| `bmad-dev-story` | `_bmad/bmm/4-implementation/bmad-dev-story/` | Execute story implementation following a context-filled story spec file. |
| `bmad-qa-generate-e2e-tests` | `_bmad/bmm/4-implementation/bmad-qa-generate-e2e-tests/` | Generate end-to-end automated tests for existing features. |
| `bmad-quick-dev` | `_bmad/bmm/4-implementation/bmad-quick-dev/` | Unified intent-in / code-out workflow: clarify, plan, implement, review, present. |
| `bmad-retrospective` | `_bmad/bmm/4-implementation/bmad-retrospective/` | Post-epic review to extract lessons and assess success. |
| `bmad-sprint-planning` | `_bmad/bmm/4-implementation/bmad-sprint-planning/` | Generate sprint status tracking from epics. |
| `bmad-sprint-status` | `_bmad/bmm/4-implementation/bmad-sprint-status/` | Summarize sprint status and surface risks. |

### 1.4 `tea` — Test Architecture Enterprise (10 skills, 1 named agent)

`tea` is an external module (npm: `bmad-method-test-architecture-enterprise`)
focused on test design, automation, and quality gates. One named agent (Murat),
nine workflow skills under `workflows/testarch/`.

#### 1.4.1 tea — named agent

| Skill | Persona | Title | Role | Path |
|---|---|---|---|---|
| `bmad-tea` | Murat | Test Architect | Master Test Architect + Quality Advisor | `_bmad/tea/agents/bmad-tea/` |

> Note: Murat is registered in `skill-manifest.csv` but **not** in
> `agent-manifest.csv` — bmm and tea use different conventions for representing
> their named agents. aud102 should treat all 7 personas (Mary, Paige, John,
> Sally, Winston, Amelia, Murat) as agents regardless of where they are
> manifest-registered.

#### 1.4.2 tea — testarch workflows (9 skills)

All under `_bmad/tea/workflows/testarch/`.

| Skill | One-line purpose |
|---|---|
| `bmad-teach-me-testing` | Teach testing fundamentals progressively through 7 sessions (TEA Academy). |
| `bmad-testarch-atdd` | Generate red-phase acceptance test scaffolds using the TDD cycle. |
| `bmad-testarch-automate` | Expand test automation coverage for the codebase. |
| `bmad-testarch-ci` | Scaffold a CI/CD quality pipeline with test execution. |
| `bmad-testarch-framework` | Initialize a production-ready test framework (Playwright or Cypress). |
| `bmad-testarch-nfr` | Assess non-functional requirements (performance, security, reliability). |
| `bmad-testarch-test-design` | Create system-level or epic-level test plans (risk-based). |
| `bmad-testarch-test-review` | Review test quality using best-practices validation (0–100 scoring). |
| `bmad-testarch-trace` | Generate a traceability matrix and quality-gate decision. |

### 1.5 Inventory totals

| Dimension | core | bmm | tea | Total |
|---|---:|---:|---:|---:|
| Skills (`skill-manifest.csv`) | 11 | 30 | 10 | **51** |
| Named agents (with personas) | 0 | 6 | 1 | **7** |
| Phase-organized workflows | 9 | 30 | 9 | 48 |

Reconciliation: 51 skill-manifest entries match the 51 BMAD skills exposed to
Claude Code at session start.

### 1.6 Per-module config files (referenced by aud102)

| Module | Config path | Notable values |
|---|---|---|
| `core` | `_bmad/core/config.yaml` | `user_name: Leonid`. |
| `bmm` | `_bmad/bmm/config.yaml` | `project_name: devx`, `user_skill_level: intermediate`, `planning_artifacts: {project-root}/{output_folder}/planning-artifacts`, `implementation_artifacts: {project-root}/{output_folder}/implementation-artifacts`, `project_knowledge: {project-root}/docs`. |
| `tea` | `_bmad/tea/config.yaml` | `tea_use_playwright_utils: true`, `risk_threshold: p1`, `test_design_output: {output_folder}/test-artifacts/test-design`, `test_review_output: {output_folder}/test-artifacts/test-reviews`, `trace_output: {output_folder}/test-artifacts/traceability`. |

These are the configuration knobs aud102's classifications and aud103's
recommendations should reference (e.g., the test-artifact output paths bind
the TEA wiring to the `_bmad-output/test-artifacts/` tree).

---

## Section 2 — Classification table

For each of the 51 skills inventoried in §1, exactly one classification:

- **invoke** — a devx command calls the skill directly (`Skill` tool with that
  name) as part of its prescribed flow.
- **wrap** — a devx command invokes the skill but constrains/extends its
  behavior with devx-specific opinions (extra structure, looping, post-checks).
- **escape-hatch** — no devx command invokes the skill, but the skill remains
  callable by the user via Claude Code's BMAD skill surface and is reasonably
  useful in this project's context (one-off, on-demand, or power-user).
- **shadow** — devx replaces the skill's purpose with a different mechanism
  (different artifact, different cadence, different tool); the skill is not
  invoked even though its problem domain is in scope.
- **orphan** — neither invoked nor exposed by devx; not directly useful in
  the current `devx.config.yaml` shape; tagged with the recommended target
  phase that should wire it.

> **Methodology — sources of truth.** Classifications below derive from a
> directed read of `.claude/commands/devx-plan.md` and `.claude/commands/devx.md`
> (the two devx commands that actually exist today), plus `docs/ROADMAP.md`
> for phase ownership of work not yet wired. Where `/devx-plan` or `/devx`
> reference a BMAD skill by name, the row is **invoke** (or **wrap** when
> devx constrains the skill's own inputs/outputs — note that surrounding
> orchestration like worktree management, fix-forward looping, or PR
> ceremony does NOT promote `invoke` to `wrap`; that orchestration lives
> in the devx command rather than around the BMAD call itself; see §2.8
> for why the `wrap` column ends up empty). Where neither command names the
> skill but a future ROADMAP epic clearly should wire it, the row is **orphan**
> with that epic named. Where devx solves the same problem differently
> (e.g., DEV.md replaces sprint planning), the row is **shadow** with the
> replacement named. Everything else is **escape-hatch**.

> **Forward-pointing notes for aud103.**
>
> 1. `/devx-plan` Phase 6 enumerates a `bmad-agent-qa` lens that **does not
>    exist** in the BMAD inventory (no skill of that name in
>    `_bmad/_config/skill-manifest.csv`). The closest analogue is `bmad-tea`
>    (Murat) under the `tea` module. This is a discrepancy between the
>    /devx-plan spec and the installed BMAD surface — flag in §3 risks and
>    decide whether /devx-plan should be edited (replace `bmad-agent-qa` with
>    `bmad-tea`) or `bmad-agent-qa` should be added (a new bmm Phase-4 agent).
>    **Resolved: §3.1 mitigation + §4.2 row 1 (replace with `bmad-tea`).**
> 2. The BMAD `bmad-create-epics-and-stories` workflow exists but `/devx-plan`
>    Phase 4 chunks epics with custom heuristics (vertical user-value slices
>    + per-layer end-user-flow narrative). Classified **shadow** below; §3
>    should evaluate whether the BMAD workflow could be invoked first and
>    then refined by devx (i.e., promote shadow → wrap), or whether the
>    custom logic is materially different enough to keep them disjoint.
>    **Resolved: §4.3 closing paragraph (deferred to first /devx-plan
>    touch-up after Phase 5 wiring lands; not a §3 risk).**
> 3. Eight of the nine `tea/workflows/testarch/*` skills + `bmad-tea` are
>    classified **orphan** — this is the TEA-orphan risk that aud103's §3 must
>    expand. The recommendations subsection below names the target phase /
>    epic for each, so aud103's §4 can quote it directly.
>    **Resolved: §3.1 (TEA-orphan as the largest-blast-radius §3 risk) +
>    §4.1 rows quoting the §2.7 wiring map.**

### 2.1 `core` — 11 skills

| Skill | Classification | devx command + phase / replacement / target |
|---|---|---|
| `bmad-advanced-elicitation` | escape-hatch | User-callable from any session; not invoked by `/devx` or `/devx-plan` (devx-plan does its own per-axis research synthesis). |
| `bmad-brainstorming` | escape-hatch | User-callable for ideation; `/devx-plan` Phase 1 produces a scope statement directly from requirements rather than running a brainstorming pass. |
| `bmad-distillator` | orphan | **Target:** Phase 2 `epic-context-rot-detection` (worker context-rot summarization) and/or Phase 10 `epic-claude-md-compaction` (CLAUDE.md compaction passes). |
| `bmad-editorial-review-prose` | escape-hatch | User-callable for doc polish on planning artifacts and CLAUDE.md; not in any devx loop. |
| `bmad-editorial-review-structure` | escape-hatch | Same as `bmad-editorial-review-prose`; structural counterpart for long docs. |
| `bmad-help` | escape-hatch | User-callable BMAD-skill navigator; `/devx-init` (Phase 0 `epic-init-skill`) provides its own onboarding flow. |
| `bmad-index-docs` | orphan | **Target:** Phase 0 `epic-init-skill` (ini502 — local file writes) follow-up to keep `docs/index.md` current as design docs accrete. |
| `bmad-party-mode` | invoke | `/devx-plan` Phase 6 — runs sequentially on every drafted epic with PM/UX/Dev/Architect/QA lenses. |
| `bmad-review-adversarial-general` | escape-hatch | User-callable for general adversarial review of any artifact; `/devx` Phase 4 uses the more specific `bmad-code-review` (which itself layers Blind Hunter / Edge Case Hunter / Acceptance Auditor). |
| `bmad-review-edge-case-hunter` | escape-hatch | User-callable; the same edge-case-hunter discipline is folded into `bmad-code-review`'s parallel layers, which `/devx` Phase 4 invokes. |
| `bmad-shard-doc` | orphan | **Target:** Phase 10 `epic-claude-md-compaction` (when CLAUDE.md exceeds the compaction threshold) and ad-hoc when planning artifacts grow beyond the per-doc readability limit. |

### 2.2 `bmm` Phase 1 — analysis (8 skills)

| Skill | Classification | devx command + phase / replacement / target |
|---|---|---|
| `bmad-agent-analyst` (Mary) | escape-hatch | Not summoned by `/devx-plan` (planning party-mode focuses on PM/UX/Dev/Architect lenses, not analyst); user-callable for upstream requirements work. |
| `bmad-agent-tech-writer` (Paige) | escape-hatch | Not summoned by any devx command; user-callable for one-off technical writing on docs/ or planning artifacts. |
| `bmad-document-project` | escape-hatch | Brownfield-only utility; this project is greenfield-bootstrapping and CLAUDE.md is curated by hand. Useful for a future ejected/imported project. |
| `bmad-prfaq` | escape-hatch | One-shot ideation; already used to produce `_bmad-output/planning-artifacts/product-brief.md`. Not part of the steady-state loop. |
| `bmad-product-brief` | escape-hatch | Same lifecycle as `bmad-prfaq` — used once at project genesis; not part of `/devx-plan` recurring flow. |
| `bmad-domain-research` | invoke | `/devx-plan` Phase 2 — domain-axis research, run in parallel with the codebase + per-layer fan-out. |
| `bmad-market-research` | invoke | `/devx-plan` Phase 2 — conditional, run only when requirements mention competitors, pricing, or positioning. |
| `bmad-technical-research` | invoke | `/devx-plan` Phase 2 — fan-out per declared `stack.layers` (frontend / backend / infrastructure). |

### 2.3 `bmm` Phase 2 — planning (6 skills)

| Skill | Classification | devx command + phase / replacement / target |
|---|---|---|
| `bmad-agent-pm` (John) | invoke | `/devx-plan` Phase 6 party-mode — required PM / end-user lens on every drafted epic. |
| `bmad-agent-ux-designer` (Sally) | invoke | `/devx-plan` Phase 6 party-mode — required UX lens on every drafted epic (skipped only if no frontend layer). |
| `bmad-create-prd` | invoke | `/devx-plan` Phase 3 — append-only addendum to existing `prd.md`, or create from scratch if absent. |
| `bmad-create-ux-design` | escape-hatch | UX shape currently emerges from `/devx-plan` Phase 6 party-mode (Sally lens). User-callable when a formal UX-design artifact is needed (e.g., before mobile Phase 8 visual work). |
| `bmad-edit-prd` | escape-hatch | `/devx-plan` Phase 3 appends rather than edits, so this skill is not invoked. User-callable for manual PRD revisions. |
| `bmad-validate-prd` | escape-hatch | `/devx-plan` Phase 7 uses `bmad-check-implementation-readiness` (broader gate covering PRD + UX + architecture + epics) instead. User-callable for PRD-only validation. |

### 2.4 `bmm` Phase 3 — solutioning (5 skills)

| Skill | Classification | devx command + phase / replacement / target |
|---|---|---|
| `bmad-agent-architect` (Winston) | invoke | `/devx-plan` Phase 6 party-mode — required architect/backend lens on every drafted epic (skipped only if no backend layer). |
| `bmad-check-implementation-readiness` | invoke | `/devx-plan` Phase 7 — readiness gate; auto-fix flagged gaps, re-run until clean. |
| `bmad-create-architecture` | invoke | `/devx-plan` Phase 3 — conditional, run when scope implies an architectural shift; append-only. |
| `bmad-create-epics-and-stories` | shadow | **Replaced by:** `/devx-plan` Phase 4 custom epic chunking (vertical user-value slices + per-layer end-user-flow narrative + locked-decisions propagation). The BMAD skill is referenced in `/devx-plan`'s Key References list but not invoked; aud103 should evaluate whether to invoke-then-refine (shadow → wrap). |
| `bmad-generate-project-context` | escape-hatch | One-shot codebase scan; CLAUDE.md is curated by hand and (Phase 5+) by LearnAgent rather than auto-regenerated. User-callable on import of a brownfield project. |

### 2.5 `bmm` Phase 4 — implementation (11 skills)

| Skill | Classification | devx command + phase / replacement / target |
|---|---|---|
| `bmad-agent-dev` (Amelia) | invoke | `/devx-plan` Phase 6 party-mode — required dev (frontend and/or backend framing) lens on every epic. The agent's anchored skill `bmad-dev-story` is invoked separately by `/devx` Phase 3. |
| `bmad-checkpoint-preview` | escape-hatch | YOLO-mode `/devx` auto-merges on CI green with no checkpoints. User-callable for HITL review of a specific change; binding under future LOCKDOWN-mode flows. |
| `bmad-code-review` | invoke | `/devx` Phase 4 — adversarial self-review; all findings auto-fixed in the same item, then re-reviewed. |
| `bmad-correct-course` | escape-hatch | `/devx` is fix-forward in the same item rather than running a sprint-correction workflow. User-callable for mid-sprint pivots that span multiple items. |
| `bmad-create-story` | invoke | `/devx` Phase 2 — runs only if `_bmad-output/implementation-artifacts/story-<hash>.md` does not yet exist. |
| `bmad-dev-story` | invoke | `/devx` Phase 3 — main implementation step; executes all tasks/subtasks red-green-refactor. |
| `bmad-qa-generate-e2e-tests` | orphan | **Target:** Phase 5 `epic-devx-test-layer-1` (`/devx-test` test-authoring flow) and/or Phase 7 `epic-story-derived-qa` (auto-filed `test/test-*-qa-walkthrough.md` derived from story acceptance criteria). |
| `bmad-quick-dev` | shadow | **Replaced by:** `/devx`'s full lifecycle — claim DEV.md item → worktree → BMAD story → implement → adversarial review → local CI → push → PR → wait remote CI → auto-merge → cleanup. `bmad-quick-dev`'s "intent-in / code-out" loop covers the same domain (clarify → plan → implement → review → present) but does not produce devx's spec-file-graph state, branch hygiene, or PR ceremony. |
| `bmad-retrospective` | orphan | **Target:** Phase 5 `epic-retro-agent` — RetroAgent runs at the end of every `/devx` and `/devx-plan` and writes `retros/retro-<spec-hash>.md`. Until that epic lands, devx assumes manual `LESSONS.md` updates (already noted as a known gap in `epic-bmad-audit.md`'s locked decisions). |
| `bmad-sprint-planning` | shadow | **Replaced by:** `DEV.md` continuous flow — `/devx-plan` appends spec files to `DEV.md`, `/devx` (and Phase 1+ ManageAgent) drains the top of the queue. There is no sprint window or sprint scope; specs are claimed in dependency order as they become unblocked. |
| `bmad-sprint-status` | shadow | **Replaced by:** the three observability surfaces under Phase 4 (`devx ui` TUI, `devx serve` web, mobile Activity tab) reading `.devx-cache/events/*.jsonl` + DEV.md/PLAN.md state. `sprint-status.yaml` is still maintained as a BMAD-shaped artifact (written by `/devx-plan`, updated by `/devx`), but the BMAD skill that summarizes it is not invoked — the live dashboards are the surface. |

### 2.6 `tea` — Test Architecture Enterprise (10 skills)

Nine of the ten `tea` skills are currently **orphan** (all eight `testarch/`
workflows + the named agent `bmad-tea`). The tenth, `bmad-teach-me-testing`,
is **escape-hatch** (educational, user-callable). This near-total absence of
wiring is the TEA-orphan risk referenced in §1.4 and slated for §3 expansion
under aud103. Per-skill classification + recommended wiring epic below; the
§2.7 recommendations subsection collates the orphan rows into the canonical
wiring list.

| Skill | Classification | devx command + phase / replacement / target |
|---|---|---|
| `bmad-tea` (Murat) | orphan | **Target:** Phase 5 `epic-devx-test-layer-1` — wire as the persona that anchors `/devx-test`'s authoring flow (mirrors how Amelia anchors `/devx`). Phase 6 party-mode should also adopt Murat for the QA lens (resolving the missing `bmad-agent-qa` referenced by `/devx-plan` Phase 6 — see forward-pointing note 1 above). |
| `bmad-teach-me-testing` | escape-hatch | Educational TEA Academy module; user-callable, not part of any devx loop. (The only `tea` skill that is escape-hatch rather than orphan.) |
| `bmad-testarch-atdd` | orphan | **Target:** Phase 5 `epic-devx-test-layer-1` — red-phase acceptance test scaffolds for stories whose acceptance criteria are written before implementation; complements `/devx`'s Phase 3 red-green-refactor loop. |
| `bmad-testarch-automate` | orphan | **Target:** Phase 5 `epic-devx-test-layer-1` — backfill automation coverage when `/devx` Phase 8 files `test/test-*.md` for a known coverage gap. |
| `bmad-testarch-ci` | orphan | **Target:** Phase 0 `epic-init-skill` (ini503 — GitHub-side scaffolding) — co-locate the CI quality-pipeline scaffold with the existing `.github/workflows/devx-ci.yml` writer. Re-runnable via `/devx-init --upgrade` (ini507). |
| `bmad-testarch-framework` | orphan | **Target:** Phase 0 `epic-init-skill` (ini503 follow-up) for initial framework selection at project init; usable on-demand thereafter when a new layer is added (e.g., when mobile Phase 8 needs Playwright on Flutter web surfaces). |
| `bmad-testarch-nfr` | orphan | **Target:** Phase 9 `epic-promotion-gate-prod` — NFR (performance / security / reliability) assessment as a PROD-gate check, complementing CI + soak + QA + panel. |
| `bmad-testarch-test-design` | orphan | **Target:** Phase 5 `epic-devx-test-layer-1` — system / epic-level test plans, run after `/devx-plan` Phase 6 produces the refined epic and before `/devx` claims its first story. |
| `bmad-testarch-test-review` | orphan | **Target:** Phase 5 `epic-devx-test-layer-1` — test-quality scoring (0–100) over `/devx`-authored test files; surfaces low scores into TEST.md for follow-up. |
| `bmad-testarch-trace` | orphan | **Target:** Phase 5 `epic-devx-test-layer-1` — traceability matrix + quality-gate decision; output binds to `tea/config.yaml → trace_output: {output_folder}/test-artifacts/traceability` (per §1.6). |

### 2.7 Recommendations — TEA wiring map

Per AC4 of aud102: every TEA workflow + the Phase 5 epic that should wire it,
collated for §4 (`Recommendations for downstream phases`) in aud103. Phase
references match `docs/ROADMAP.md` epic naming.

| TEA workflow | Wiring epic | Phase | Trigger inside devx |
|---|---|---|---|
| `bmad-testarch-atdd` | `epic-devx-test-layer-1` | 5 | `/devx` Phase 2.5 (after `bmad-create-story`, before implementation): when the story's ACs are red-phase-able. |
| `bmad-testarch-automate` | `epic-devx-test-layer-1` | 5 | `/devx-test` worker claiming a `test/test-*.md` spec filed by `/devx` Phase 8. |
| `bmad-testarch-test-design` | `epic-devx-test-layer-1` | 5 | `/devx-plan` Phase 7 readiness check: produce a system-level test plan per refined epic. |
| `bmad-testarch-test-review` | `epic-devx-test-layer-1` | 5 | `/devx-test` after authoring; surfaces low-score tests into TEST.md. |
| `bmad-testarch-trace` | `epic-devx-test-layer-1` | 5 | End of epic: traceability matrix written to `_bmad-output/test-artifacts/traceability/` (per `tea/config.yaml`). |
| `bmad-testarch-ci` | `epic-init-skill` (ini503) | 0 | `/devx-init` GitHub scaffolding: TEA-shaped CI alongside `devx-ci.yml`. |
| `bmad-testarch-framework` | `epic-init-skill` (ini503 follow-up) | 0 | `/devx-init` initial framework selection per declared layer. |
| `bmad-testarch-nfr` | `epic-promotion-gate-prod` | 9 | PROD promotion gate: NFR check before merge to `main`. |
| `bmad-tea` (Murat) † | `epic-devx-test-layer-1` | 5 | TestAgent persona that anchors `/devx-test`'s authoring flow. |

† `bmad-tea` (Murat) ALSO wires into `/devx-plan` Phase 6 party-mode as the
QA lens (replacing the non-existent `bmad-agent-qa` currently referenced by
`/devx-plan`). That second wiring is a one-line edit to the already-shipped
`/devx-plan` command, not a ROADMAP phase, and is therefore not represented
as a Phase entry above.

`bmad-teach-me-testing` is the sole `tea` skill not on this wiring list — it
is escape-hatch (user-callable) rather than orphan.

### 2.8 Classification totals

| Classification | core | bmm | tea | Total | % of 51 |
|---|---:|---:|---:|---:|---:|
| invoke | 1 | 13 | 0 | **14** | 27% |
| wrap | 0 | 0 | 0 | **0** | 0% |
| escape-hatch | 7 | 11 | 1 | **19** | 37% |
| shadow | 0 | 4 | 0 | **4** | 8% |
| orphan | 3 | 2 | 9 | **14** | 27% |
| **Total** | 11 | 30 | 10 | **51** | 100% |

Per AC1: every workflow has exactly one classification (column sums equal §1.5
totals). The `wrap` column is empty — every devx-invoked BMAD skill is invoked
verbatim, with the surrounding orchestration (looping, fix-forward, append-only
artifacts, ceremony) living in the devx command rather than around the BMAD
call itself. `bmad-create-epics-and-stories` is the closest candidate to
promote shadow → wrap; aud103 should evaluate.

The 14-skill orphan column splits across three sources, in descending blast
radius: `tea` (9 of 10 skills — an entire declared module unwired), three
`core` doc utilities (`bmad-distillator`, `bmad-index-docs`, `bmad-shard-doc`),
and two `bmm` Phase-4 skills (`bmad-qa-generate-e2e-tests`,
`bmad-retrospective`). aud103 §3 should rank these by impact — the TEA
orphan is unambiguously the largest risk because it leaves a whole installed
module unused while the project's stack already declares testing as a
first-class concern.

## Section 3 — Risks

Five risks. Risks 1–4 follow the `aud103` acceptance-criteria ordering,
opening with the largest-blast-radius risk (TEA orphan — an entire installed
module unused). Risk 5 is the manifest-vs-installed-skills drift
forward-pointed from §1's source-of-truth note, appended last. Each
subsection states severity and impact and points at the recommendation in §4
that resolves it.

### 3.1 TEA orphan

**Severity:** High — entire installed module unused.

The `tea` module ships 10 skills (1 named agent + 9 testarch workflows) plus
`tea/config.yaml` (with `tea_use_playwright_utils: true`, `risk_threshold: p1`,
and three configured output paths under `{output_folder}/test-artifacts/`).
All installed, all wired through BMAD's manifest, and currently invisible to
devx commands. Per §2.6, 9 of the 10 are classified `orphan`; only
`bmad-teach-me-testing` is escape-hatch by design (TEA Academy is educational,
not a workflow step).

Unwired TEA workflows + their downstream impact:

| Skill | What devx loses by leaving it orphan |
|---|---|
| `bmad-tea` (Murat) | Test-architect persona absent from `/devx-plan` Phase 6 party-mode. `/devx-plan` currently references a non-existent `bmad-agent-qa` lens (no such skill in `skill-manifest.csv`) — the QA voice is silenced at planning time. |
| `bmad-testarch-atdd` | Stories with red-phase-able acceptance criteria don't get scaffold tests written before implementation. `/devx` Phase 3's red-green-refactor proceeds without ATDD priming, losing the BMAD-prescribed step that catches AC misinterpretation early. |
| `bmad-testarch-test-design` | No system-level / epic-level test plan after `/devx-plan` Phase 6. Risk-based prioritization (`risk_threshold: p1`) is not applied; coverage gaps are discovered ad-hoc by `/devx` Phase 8 instead of designed up-front. |
| `bmad-testarch-automate` | Test gaps filed into `TEST.md` by `/devx` Phase 8 have no consumer skill — there is no `/devx-test` worker to drain them into automated coverage. |
| `bmad-testarch-test-review` | Tests authored by `/devx`'s red-green-refactor loop are never quality-scored; low-quality tests pass CI undetected. |
| `bmad-testarch-trace` | No traceability matrix is produced; the configured `trace_output: {output_folder}/test-artifacts/traceability` stays empty; PROD-gate quality decisions have no traceability evidence. |
| `bmad-testarch-ci` | `/devx-init` GitHub-side scaffolding (ini503) writes its own `devx-ci.yml` without the TEA-shaped quality pipeline scaffold; CI structure diverges from BMAD's recommended shape. |
| `bmad-testarch-framework` | Initial test-framework selection at project init is hand-rolled per `devx.config.yaml → projects[].test`; Playwright/Cypress bootstrap is not wired into `/devx-init`. |
| `bmad-testarch-nfr` | NFR (performance / security / reliability) assessment has no Phase-9 PROD-gate hook; PROD promotions can clear without an NFR pass. |

**Mitigation → §4.1.** Wire all 9 orphans per the §2.7 TEA wiring map. The
bulk lands in Phase 5's new `epic-devx-test-layer-1` (5 testarch skills +
`bmad-tea` as the TestAgent persona); two skills wire into Phase 0
`epic-init-skill` (`testarch-ci` and `testarch-framework`); one wires into
Phase 9 `epic-promotion-gate-prod` (`testarch-nfr`). The non-existent
`bmad-agent-qa` reference in `/devx-plan` Phase 6 resolves to `bmad-tea`
(Murat) as a one-line edit (§4.2).

### 3.2 Sprint-planning shadow

**Severity:** Medium — collision risk on user-initiated invocation; no impact
in steady state.

`bmad-sprint-planning` reads epics and produces a `sprint-status.yaml`
describing a discrete sprint window with story-by-story status. devx
**replaces** this with `DEV.md` continuous flow: `/devx-plan` appends spec
files to `DEV.md`, `/devx` (and Phase 1+ ManageAgent) drains the top of the
queue. There is no sprint window or sprint scope — specs are claimed in
dependency order as they become unblocked. `sprint-status.yaml` is still
maintained as a BMAD-shaped artifact (written by `/devx-plan`, updated by
`/devx`) but is no longer the planning surface. Per §2.5, `bmad-sprint-planning`
is classified `shadow`.

**Conflict surface.** The skill remains exposed by Claude Code's BMAD skill
surface — a user can invoke it directly at any time, in any session. If they
do so after devx is installed, three failure modes exist:

1. **Artifact divergence.** `bmad-sprint-planning` rewrites `sprint-status.yaml`
   from epics, ignoring the spec-file graph under `dev/`. The result diverges
   from `DEV.md` until the next `/devx-plan` or `/devx` run reconciles it.
2. **Status overwrites.** `/devx` writes story status (`ready-for-dev`,
   `done`) into `sprint-status.yaml` keyed on story IDs from the BMAD story
   file. A standalone `bmad-sprint-planning` run can clobber those keys when
   it regenerates the file from epics, masking in-flight work.
3. **User-mental-model fork.** A user prompted to think in BMAD-sprint terms
   (sprint window, sprint scope, sprint velocity) starts asking for ceremonies
   the devx loop doesn't perform — `DEV.md` continuous flow has no sprint
   boundary, no sprint retro, and no sprint-velocity number to report.

**Mitigation → §4.2.** No new epic is required — divergence is recoverable on
the next `/devx-plan` or `/devx` run. Two lighter-touch fixes: (a) `/devx-init`
(ini504) seeds a clarifying note that devx supersedes `bmad-sprint-planning`;
(b) `/devx-manage` (Phase 2) detects divergent `sprint-status.yaml` and
reconciles from `DEV.md` on the next tick.

### 3.3 Retrospective gap

**Severity:** Medium — material learning surface absent until Phase 5.

`bmad-retrospective` runs at end-of-epic, extracts lessons, and assesses
success against the epic's locked decisions. devx currently has **no
retrospective wiring** — the assumption is that the user updates `LESSONS.md`
by hand whenever a meaningful learning surfaces (already noted as a known gap
in `epic-bmad-audit.md`'s locked decisions). Per §2.5, `bmad-retrospective` is
classified `orphan` with target `epic-retro-agent` (Phase 5).

**Downstream impact.** Three concrete losses while this stays orphan:

1. **LearnAgent has no canonical lessons feed.** `LESSONS.md` is the input
   surface LearnAgent reads (per `docs/SELF_HEALING.md`). With manual-only
   updates, the cadence is irregular and the corpus is sparse — auto-apply
   confidence (gated by `self_healing.auto_apply.confidence_min: 0.85`) won't
   trip, so LearnAgent stays inert.
2. **Locked decisions go un-audited.** Each epic's "Locked decisions"
   subsection (e.g., epic-bmad-audit's 4 entries) is supposed to be a contract
   — what was promised at planning, then verified at the end. Without
   `bmad-retrospective`, no one verifies that what shipped matches what was
   locked.
3. **Mobile companion has no retro feed.** Phase 8+ mobile shows a "retros"
   view per `docs/MOBILE.md`; with no agent writing them, the view shows
   whatever the user typed by hand, which is approximately nothing.

**Mitigation → §4.1.** Wire `bmad-retrospective` via Phase 5 `epic-retro-agent`.
RetroAgent runs at the end of every `/devx` and `/devx-plan`, and ManageAgent
triggers it at end-of-epic (when all stories under an epic are `done`). Output:
`retros/retro-<spec-hash>.md` plus a delta into `LESSONS.md`. The `retros/`
directory is a new sibling of `dev/`, `plan/`, etc.; LearnAgent reads
`LESSONS.md` as before, now with a steady feed.

### 3.4 UX timing mismatch

**Severity:** Low at YOLO, Medium at thoroughness=`thorough` — re-work cost
scales with epic size and downstream commitment.

BMAD's Phase 2 (planning) explicitly schedules `bmad-create-ux-design` (Sally)
before Phase 3 (solutioning) — UX shape is locked before architecture commits.
devx instead surfaces UX feedback in **Phase 6 party-mode** (per `/devx-plan`),
where Sally's lens is one voice among several on already-drafted epics. Per
§2.3, `bmad-create-ux-design` is `escape-hatch` (user-callable); the routine
UX touchpoint is the Phase 6 lens.

**Risk.** When a frontend-heavy epic lands at Phase 6 with a UX shape that
party-mode flags as wrong, the rework path is "edit the epic, re-validate via
Phase 7 readiness, possibly re-run Phase 6". Cost scales with epic size and
how committed downstream epics are to the wrong UX. At YOLO/empty-dream this
is cheap (no users yet, epics small, locked-decisions thin). At
thoroughness=`thorough` (and especially under PROD with locked-in users),
reworking late is materially more expensive than designing earlier.

**Mitigation → §4.2.** Make `bmad-create-ux-design` an opt-in invocation in
`/devx-plan` Phase 3 when `thoroughness == thorough` AND `stack.layers`
contains `frontend`:

- `thoroughness: send-it` — current behavior unchanged; UX surfaces in Phase 6.
- `thoroughness: balanced` — current behavior unchanged.
- `thoroughness: thorough` AND `frontend` declared — `/devx-plan` Phase 3
  invokes `bmad-create-ux-design` with the brief from Phase 1, output appended
  to `_bmad-output/planning-artifacts/ux-design.md`, then Phase 6 reads that
  file as input rather than producing the UX shape from scratch.

This is a small targeted edit to `/devx-plan` (Phase 3 conditional invocation
+ new `ux-design.md` artifact + Phase 6 reading that file as input), not a
new epic.

### 3.5 Manifest / installed-skills drift

**Severity:** Medium — silent staleness if the user upgrades BMAD or modifies
skill installs without re-running this audit.

Per §1's source-of-truth note, the BMAD inventory in this repo's tree is
**manifests only** (`_bmad/_config/{skill,agent}-manifest.csv`,
`_bmad/_config/manifest.yaml`, per-module `config.yaml`). The actual SKILL.md
and workflow.yaml source files are not vendored; they live in the npm package
and in Claude Code's `~/.claude/skills/` install. The Phase 0 commit
`508a62c chore: vendor BMAD framework + skills` stamps the manifests but does
not co-locate the source.

**Drift surfaces.** If `~/.claude/skills/` and `_bmad/_config/` diverge — for
example, the user upgrades the npm-installed BMAD version on their machine
while the in-repo manifests stay pinned — three things go silently wrong:

1. **Invocations resolve against the live skill, audits cite the pinned
   manifest.** A `Skill` tool call in `/devx` runs whatever
   `~/.claude/skills/` ships; the audit table cites whatever
   `_bmad/_config/skill-manifest.csv` says. The two can differ in input
   shape, output shape, or skill set.
2. **Orphan and escape-hatch classifications go stale.** A skill renamed or
   removed upstream stays in `skill-manifest.csv` until someone reinstalls;
   the classification table claims the skill exists when it doesn't.
3. **Wiring recommendations target nonexistent skills.** §2.7's TEA wiring
   map names `bmad-testarch-*` skills that may have moved, renamed, or split
   in a TEA upgrade; Phase 5 epic specs would be authored against ghosts.

**Mitigation → §4.1.** Two wirings (the second is advisory rather than a
wired skill, so it does not get its own §4.2 row):

- Phase 0 `epic-init-skill` (ini502 follow-up): `/devx-init` and
  `/devx-init --upgrade` (ini507) reconcile `_bmad/_config/skill-manifest.csv`
  against Claude Code's live skill list. Drift produces a `MANUAL.md` entry
  plus a stale-flag at the top of `bmad-audit.md`.
- Phase 5 LearnAgent (per `docs/SELF_HEALING.md`): on each weekly window,
  compare manifest against live and emit a `LESSONS.md` candidate when drift
  exceeds N skills. (LearnAgent's `auto_apply.blast_radius_max: medium` at
  YOLO keeps this advisory rather than auto-applied.)

A repo-resident `audit-stale-after` marker is unnecessary — re-run the audit
when `_bmad/_config/manifest.yaml` modules[].version changes (per §5).

## Section 4 — Recommendations for downstream phases

Each row in §4.1 and §4.2 cites the §3 risk it resolves. §4.3 is the
cross-cutting summary.

### 4.1 New-or-existing epic wirings

| Risk | Skill | Target epic | Phase | Trigger inside devx |
|---|---|---|---|---|
| 3.1 | `bmad-testarch-atdd` | `epic-devx-test-layer-1` (new) | 5 | `/devx` Phase 2.5 (after `bmad-create-story`, before implementation) when the story's ACs are red-phase-able. |
| 3.1 | `bmad-testarch-automate` | `epic-devx-test-layer-1` | 5 | `/devx-test` worker claiming a `test/test-*.md` filed by `/devx` Phase 8. |
| 3.1 | `bmad-testarch-test-design` | `epic-devx-test-layer-1` | 5 | `/devx-plan` Phase 7 readiness check; system-level test plan per refined epic. |
| 3.1 | `bmad-testarch-test-review` | `epic-devx-test-layer-1` | 5 | `/devx-test` after authoring; surfaces low-score tests into TEST.md. |
| 3.1 | `bmad-testarch-trace` | `epic-devx-test-layer-1` | 5 | End of epic; output to `tea/config.yaml → trace_output`. |
| 3.1 | `bmad-tea` (Murat) | `epic-devx-test-layer-1` | 5 | TestAgent persona anchoring `/devx-test`'s authoring flow; also the QA lens in `/devx-plan` Phase 6 (resolves the missing `bmad-agent-qa` reference — see §4.2). |
| 3.1 | `bmad-testarch-ci` | `epic-init-skill` (ini503) | 0 | `/devx-init` GitHub scaffolding writes a TEA-shaped CI quality pipeline alongside `devx-ci.yml`. |
| 3.1 | `bmad-testarch-framework` | `epic-init-skill` (ini503 follow-up) | 0 | `/devx-init` initial framework selection per declared layer; on-demand thereafter when a new layer is added (e.g., mobile Phase 8). |
| 3.1 | `bmad-testarch-nfr` | `epic-promotion-gate-prod` (new) | 9 | PROD-gate NFR (performance / security / reliability) check before merge to `main`. |
| 3.3 | `bmad-retrospective` | `epic-retro-agent` (new) | 5 | RetroAgent at end of every `/devx` / `/devx-plan` and end-of-epic (ManageAgent-triggered); writes `retros/retro-<hash>.md` + `LESSONS.md` delta. |
| 3.5 | manifest reconcile | `epic-init-skill` (ini502 follow-up) | 0 | `/devx-init` and `/devx-init --upgrade` reconcile `skill-manifest.csv` vs. Claude Code's live skill list; drift → MANUAL.md + `bmad-audit.md` stale marker. |

### 4.2 No-new-epic fixes (one-line / small edits)

| Action | Where | Risk |
|---|---|---|
| Replace `bmad-agent-qa` with `bmad-tea` (Murat) in the Phase 6 party-mode lens list | `.claude/commands/devx-plan.md` | 3.1 |
| Make `bmad-create-ux-design` opt-in in `/devx-plan` Phase 3 when `thoroughness=thorough` AND `stack.layers` contains `frontend`; output to `_bmad-output/planning-artifacts/ux-design.md`; Phase 6 consumes it | `.claude/commands/devx-plan.md` | 3.4 |
| Detect divergent `sprint-status.yaml` (story-IDs in the file that don't appear in `DEV.md` and vice versa); reconcile from `DEV.md` on next tick | `/devx-manage` (Phase 2) | 3.2 |
| Add a clarifying line to `/devx-init` skill help: "devx supersedes `bmad-sprint-planning`; standalone invocation produces a one-off snapshot, devx will overwrite on next run" | `/devx-init` (ini504) | 3.2 |

### 4.3 Cross-cutting note

Of the 14 orphans surfaced in §2.8, **9 are TEA, 3 are core doc utilities, and
2 are bmm Phase-4** — the orphan column collapses to two new Phase-5 epics
(`epic-devx-test-layer-1`, `epic-retro-agent`) plus three follow-ups in
already-planned Phase 0 (`epic-init-skill`) and Phase 9
(`epic-promotion-gate-prod`) epics. **No orphan requires a phase that isn't
already on the roadmap.** The TEA orphans and `bmad-retrospective` are
itemized in §4.1. The four orphans not in §4.1 (`bmad-distillator`,
`bmad-shard-doc`, `bmad-index-docs`, `bmad-qa-generate-e2e-tests`) are not
§3 risks and are already pointed at existing roadmap epics in their §2 rows;
no §4 entry is needed for them.

A separate forward-pointing item from §2.5: `bmad-create-epics-and-stories` is
the closest candidate to promote shadow → wrap. `/devx-plan` Phase 4 currently
chunks epics with custom heuristics and ignores the BMAD skill. Worth
evaluating whether invoke-then-refine produces materially better epics than
the current custom logic. Defer to the first `/devx-plan` touch-up after
Phase 5 wiring lands; not a §3 risk.

## Section 5 — Module versions + audit re-run trigger

| Module | Version | Source | Install date |
|---|---|---|---|
| `core` | 6.3.0 | built-in | 2026-04-23 |
| `bmm` | 6.3.0 | built-in | 2026-04-23 |
| `tea` | 1.13.1 | external (npm: `bmad-method-test-architecture-enterprise`) | 2026-04-23 |

- **BMAD installer version:** 6.3.0
- **IDE:** claude-code
- **Audit run date:** 2026-04-26
- **Source manifest:** `_bmad/_config/manifest.yaml` (note: the path is
  `_config/`, not `_cfg/` — the abbreviated form used in
  `epic-bmad-audit.md`'s party-mode notes does not exist on disk).

**Re-run trigger.** Re-run this audit (`/devx aud101`, then `aud102`, then
`aud103`, or a future consolidating skill) when ANY of the following changes:

- `_bmad/_config/manifest.yaml → modules[].version` for any of `core`, `bmm`,
  `tea`.
- `_bmad/_config/manifest.yaml → modules[]` set changes (a module is added or
  removed).
- `_bmad/_config/skill-manifest.csv` skill set changes (skill added, removed,
  or renamed).
- `~/.claude/skills/` skill set diverges from `skill-manifest.csv` (per §3.5
  — drift detector flags this once §4.1's ini502 follow-up lands).

**Audit-stale signal until §3.5's mitigation lands:** mtime of
`_bmad/_config/manifest.yaml` newer than mtime of this file is a sufficient
manual signal to re-run.
