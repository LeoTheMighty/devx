# BMAD audit

**Status:** Section 1 complete; Sections 2–5 pending (aud102, aud103).
**Audit date:** 2026-04-26
**Audited by:** /devx aud101 (inventory only).
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

_Pending — story `aud102`._

## Section 3 — Risks

_Pending — story `aud103`._

## Section 4 — Recommendations for downstream phases

_Pending — story `aud103`._

## Section 5 — Module versions + audit re-run trigger

_Pending — story `aud103`. Will record the versions stamped in §1.1 plus a
"re-run when `_bmad/_config/manifest.yaml` modules\[\].version changes"
trigger._
