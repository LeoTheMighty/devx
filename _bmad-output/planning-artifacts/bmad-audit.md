# BMAD audit

**Status:** Sections 1–2 complete; Sections 3–5 pending (aud103).
**Audit date:** 2026-04-26
**Audited by:** /devx aud101 (inventory), /devx aud102 (classification).
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
> ordering fits the rest of that section's risks.

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
> 2. The BMAD `bmad-create-epics-and-stories` workflow exists but `/devx-plan`
>    Phase 4 chunks epics with custom heuristics (vertical user-value slices
>    + per-layer end-user-flow narrative). Classified **shadow** below; §3
>    should evaluate whether the BMAD workflow could be invoked first and
>    then refined by devx (i.e., promote shadow → wrap), or whether the
>    custom logic is materially different enough to keep them disjoint.
> 3. Eight of the nine `tea/workflows/testarch/*` skills + `bmad-tea` are
>    classified **orphan** — this is the TEA-orphan risk that aud103's §3 must
>    expand. The recommendations subsection below names the target phase /
>    epic for each, so aud103's §4 can quote it directly.

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

_Pending — story `aud103`._

## Section 4 — Recommendations for downstream phases

_Pending — story `aud103`._

## Section 5 — Module versions + audit re-run trigger

_Pending — story `aud103`. Will record the versions stamped in §1.1 plus a
"re-run when `_bmad/_config/manifest.yaml` modules\[\].version changes"
trigger._
