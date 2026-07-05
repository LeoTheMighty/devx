# 02 — The Engine: PRD → Design → Plan → RED → Execute → Verify

The v2 engine replaces BMAD with a native, filesystem-composed stage pipeline,
adapted from `mycase/8am-harness` and expressed in devx's own design language:
**mechanical checks as `devx` CLI primitives, judgment as thin flat skill
bodies, state as markdown frontmatter, gates as refusal conditions.**

All JIRA/Confluence machinery from 8am-harness is stripped at the source — we
adopt shapes, not integrations (the harness itself declares external surfaces
"renders downstream, fail-soft"; excision is deletion, not surgery). Nothing
in v2 may reference JIRA, Confluence, Atlassian, or external trackers.
GitHub PRs are the only external surface.

## 1. Design tenets (stolen from 8am-harness, verbatim where possible)

1. **Workstream-based, not task-based.** The unit of planning is a workstream
   (feature/epic-sized); PRD → design → plan are front-loaded across it;
   dev-stage spec files remain the downstream execution trackers.
2. **Gates gate *passing* and *execution*, not authoring.** Draft ahead
   freely; a gate can't pass before its predecessor; only Execute is
   hard-blocked on all gates. This kills BMAD-style pipeline rigidity.
3. **Artifacts are the contract; git is the audit trail.** Every stage commits
   its own work. Chat is ephemeral — anything that matters is in a file.
4. **State transitions are side effects of real actions.** No command exists
   solely to record progress.
5. **Deterministic verdicts.** Every gate/report artifact leads with a
   schema-fixed YAML verdict block; verdicts are computed from ✅/⚠️/❌ tables
   and ID sets, not vibes.
6. **ID traceability, not prose traceability.** Every concrete PRD item gets a
   stable ID; coverage and revision blast-radius become mechanical.
7. **Verification before completion.** Identify command → run fresh → read
   full output + exit code → verify → only then claim. "Should pass" is a
   banned phrase.
8. **Context hygiene by construction.** Each stage reads only its inputs,
   recommends `/clear` between stages, fans heavy reads out to subagents, and
   ends by printing the single next command.

## 2. The stage pipeline

```
 idea/backlog item
   │
   ▼
 ┌─────────┐   Gate 1    ┌──────────┐   Gate 2    ┌────────┐   Gate 3
 │  PRD    │──(prd ok?)──▶│  Design  │──(covers ──▶│  Plan  │──(covers design
 │ stage   │             │  stage   │   PRD?)     │ stage  │    + P0 floor?)
 └─────────┘             └──────────┘             └────────┘
                                                        │
                                              Gate 4 (RED: every P0 check
                                                       observed failing
                                                       for the right reason)
                                                        │
   ┌────────────────────────────────────────────────────┘
   ▼
 ┌──────────┐  per dev item   ┌────────────┐        ┌────────┐
 │ Emit     │───────────────▶ │  Execute   │───────▶│ Verify │──▶ merge
 │ dev specs│  (DEV.md +      │ (/devx v1  │  PR +  │ phase  │
 └──────────┘   spec files)   │  loop core)│  tour  └────────┘
                              └────────────┘
                                                        │
                                              retro (per epic) ──▶ LEARN.md
                                              outcome (weeks later) ──▶ keep/tune/restart/retire
```

Small work skips stages: the dispatcher (`05-dispatcher.md`) routes a bugfix
straight to Execute with a debug spec; a "just build X" with clear scope may
enter at Plan. Stage skipping is recorded in the workstream frontmatter
(`entered_at: plan`), never silent.

## 3. Workstream anatomy

A workstream extends the existing plan-spec convention. The plan spec file
(`plan/plan-<hash>-<ts>-<slug>.md`) remains the index node; its artifacts live
in a sibling directory:

```
_devx/workstreams/<slug>/
├── prd.md              # Gate 1 input
├── expectations.md     # Gate 1 input (the E-blocks)
├── design.md           # Gate 2 subject
├── plan.md             # Gate 3 subject; phase checklist = execution tracker
├── decisions/          # dated decision/critique/verify reports
├── checkpoints/        # per-phase verification reports
└── evals/              # RED-gate runnable artifacts + RED-report.md
```

(`_bmad-output/` is frozen history; `_devx/` already ships in the npm package
and is the natural home. `docs/` stays human-authored.)

### Workstream state lives in the plan spec's frontmatter

Extend (don't replace) the v1 spec frontmatter:

```yaml
hash: f3a9c1
type: plan
status: in-progress          # v1 field, unchanged
stage: design                # intake | prd | design | plan | red | executing | done | retired
entered_at: prd              # first stage this workstream actually ran
gate_status:
  prd_validated: false       # Gate 1
  design_verified: false     # Gate 2
  plan_verified: false       # Gate 3
  evals_red: false           # Gate 4
outcome:
  status: null               # null | pending | keep | tune | restart | retire
  measure_by: null
```

The append-only Status log stays the journal (this matches 8am-harness's
STATE.md Notes section almost exactly — convergent evolution; keep ours).

## 4. Stage specs

### 4.1 PRD stage (`/devx prd <slug|hash>`)
Interview-style authoring of `prd.md` + `expectations.md`. Incremental
per-section writes (interruption-survivable). Reads LEARN.md back first
("a prior workstream found X — budget for it").

`prd.md` shape (v1 shape upgraded with IDs):
- Problem / Goals (user goals + **numeric** business/project goals, `G-n`) /
  Non-goals / Users / Use cases (`UC-n`) / Capabilities (`CAP-n`) / Feature
  requirements (`FR-n`) / Evals seed / Open questions.
- **Every concrete item gets a stable ID; IDs are never renumbered.**

`expectations.md` — ≥3 blocks, each exactly:

```markdown
## E-1: <human-readable name>
- **Priority:** <P0 | P1 | P2 | P3>
- **Covers:** <PRD IDs, e.g. `G-2, UC-1, FR-3`>
- **Trigger:** <input shape>
- **Expectation (EARS):** When <trigger>, the system SHALL <behavior>.
- **Threshold:** <measurable>
- **Verified by:** <concrete runnable target — test path or evals/E-1_*.md>
```

### 4.2 Gate 1 — `devx gate prd <hash>` (CLI, mechanical)
Checks: sections non-placeholder; ≥3 E-blocks each with Priority/EARS
(regex: `When .+, the system SHALL .+`)/numeric Threshold/concrete
`Verified by:`; all `Covers:` IDs resolve; every `G-` covered by ≥1
expectation (bidirectional orphan check); INTERVIEW blockers empty.
On pass: flips `prd_validated`, `stage: design`. On fail: prints a specific
gap report, writes nothing. *The framework's value is in the refusal.*

An optional judgment-layer critique (`/devx prd --review`) fans out subagents
to cross-reference other active workstreams + LEARN.md and writes
`decisions/<date>-prd-critique.md`; non-gating, thoroughness-gated.

### 4.3 Design stage (`/devx design <hash>`)
Collaborative: **asks the user's design questions first**, grounds discussion
in real code (config: `engine.code_citation_hints` paths), then drafts
`design.md`: Overview / Constraints / Risks / Trade-offs / Out of scope /
Assumptions / Discarded considerations / **Wrap-don't-duplicate check** (v1's
working agreement, recast from harness's "Configuration, not Code") / Design
(architecture, interfaces, data) / Migration plan / Resolved + Unresolved
design questions. Hard rule: *no phases, no tasks — design is the approach,
not the sequence.* Stripped from the source template: Confluence sync,
Compliance Scope, Reviewers signoff matrix, Document Information tracker rows.

### 4.4 Gate 2 & 3 — `devx gate coverage <hash>` (CLI + one subagent)
State-aware two-mode gate, ported near-verbatim:
- **design mode** (design exists ∧ ¬design_verified): source = prd.md — one
  row per `G-/UC-/CAP-/FR-` ID: ✅ covered / ⚠️ partial / ❌ missing.
- **plan mode**: source = design.md — one row per `E-id` + design-decision →
  phase map. **P0 floor**: every P0 expectation `full` and naming a runnable
  artifact path.

Writes `decisions/<date>-<mode>-verify.md` opening with the deterministic
verdict block (steal verbatim):

```yaml
gate: PASS | CONCERNS | FAIL | WAIVED
status_reason: '<1–2 sentences>'
reviewer: 'devx gate coverage (<design|plan> mode)'
updated: YYYY-MM-DD
waiver: { active: false, approver: null, reason: null }
```

FAIL = any ❌ or unmet P0 floor. CONCERNS = only ⚠️ (gate advances, concern
recorded). WAIVED requires named approver + reason. An **"Extras requiring
product approval"** section flags scope creep neutrally. Mechanical parts
(ID extraction, table assembly, verdict computation) in the CLI; the
semantic covered/partial judgment is a single schema-constrained subagent.

### 4.5 Plan stage (`/devx plan <hash>`)
Asks the user for a rough phase breakdown first, explores code, drafts
`plan.md`: Current state / Desired state / What we're NOT doing / Expectation
Coverage table (`E-id | Priority | Verified in phase | Type | Artifact |
full/partial`) / Phase checklist / per-phase blocks (Overview, Files-with-why,
Context, Verification plan `tests-first|tests-after|human|none` + success
criteria, Tasks `T<n>.<m>`).

**Sizing rule (steal verbatim): a phase is one cohesive concern with a
verifiable exit, sized to land as a single reviewable PR. Default to more,
smaller phases.** A plan phase ≙ one dev spec ≙ one PR — this maps 1:1 onto
v1's story rhythm.

Includes the **critique step** (re-homed party-mode, `01-bmad-capture.md`
§2.4) before Gate 3, thoroughness-gated.

### 4.6 Gate 4 — RED (`/devx red <hash>` + `devx gate evals <hash>`)
For every expectation, author the runnable artifact at the exact
`Verified by:` target: a failing test at the named path, or an eval spec under
`evals/`. Then **run each and confirm RED for the right reason** — missing
feature, not an import/wiring error — capturing exact command + exit code +
failure quote into `evals/RED-report.md` (verdict block). Runner commands come
from `devx.config.yaml → projects:` (v1's existing per-project CI config — no
new `eval.command` concept needed). P0 gaps block; P1+ → CONCERNS.
PASS flips `evals_red`, `stage: executing`, and triggers dev-spec emission:
each plan phase becomes a `dev/dev-<hash>` spec + DEV.md entry via the
existing pln-primitives (`derive-branch`, `emit-retro-story`, `validate-emit`
all survive unchanged).

*Motto (keep): if you didn't watch it fail, you don't know if it tests the
right thing.*

### 4.7 Execute stage
**v1's `/devx` Phases 1–8 survive nearly intact** — claim → worktree →
implement → self-review → local CI → commit → push + PR (now with tour,
`03-review-tour.md`) → await remote CI → merge-gate → cleanup. Changes:
- Phase 2/3 (BMAD story) replaced by: work directly from spec ACs with the
  native execution discipline (`01-bmad-capture.md` §2.2); tests-first phases
  re-run the already-RED artifact and watch it fail *now* before coding.
- Phase 4 review re-homed natively (§2.1), same status-log pinning.
- New Phase 7.5: `devx tour build <hash>` attaches the review tour.
- Claim precondition gains: parent workstream `evals_red: true` (dispatcher
  enforces; standalone debug/chore specs exempt).

### 4.8 Verify phase (`/devx verify <hash>`)
Runs the phase's verification plan as the pass/fail of record (the same
artifact that was RED at Gate 4 must now pass), writes
`checkpoints/phase-N.md` (verdict block + per-expectation
command/exit/status table). Status ladder: `pending → in_progress → done →
verified`; **done ≠ verified**; the workstream can't close until every phase
is `verified`. In YOLO this folds into Execute's local-CI step (same session);
higher modes run it as a separate fresh-session pass.

### 4.9 Revise — backward path (`/devx revise <hash>`)
Delta validation, ported whole: pick the lowest artifact the change touches,
amend collaboratively, write `decisions/<date>-revision-<slug>.md`, apply the
cascade reset table:

| Changed | Resets | stage → |
|---|---|---|
| prd.md / expectations.md | all 4 gate flags | prd |
| design.md | design_verified, plan_verified, evals_red | design |
| plan.md | plan_verified, evals_red | plan |

Forward skills' refusals force the replay; `gate coverage` re-verification
forces actual absorption. Blast radius is ID-scoped via `Covers:` — only
affected phases get unchecked.

### 4.10 Retro + Outcome
Retro: per-epic, native (`01-bmad-capture.md` §2.3), same LEARN.md contract.
Outcome (`/devx outcome <hash>`): at PRD time capture numeric `G-` goals; at
close set `outcome: {status: pending, measure_by: <+4 weeks>}`; later score
each goal vs reality into `RESULTS.md` with verdict
`keep | tune (cascade-reopen keyed to missed E-ids) | restart (linked v2
workstream) | retire`. This closes a loop v1 never had.

*(Shipped-reality note, appended at v2o101 2026-07-05: tune's implemented
reopen is verification-scoped — `evals_red` clears and the stage rolls back
to `red`, replaying the missed expectations' RED artifacts via `devx gate
evals`; a revision of the expectation/design/plan artifact itself goes
through `devx revise` §4.9. The full §4.9 cascade is deliberately NOT
auto-applied by a tune verdict.)*

## 5. The next-command function — `devx next [<hash>]`

A pure function over frontmatter + backlogs → the single next command
(ported from harness `next_command()`, ~50 lines). No stored rollup — computed
fresh every call, so it can't go stale. This is the spine of the dispatcher
(`05-dispatcher.md`) and of `/devx status`. Full decision table lives there.

## 6. Token budget (the point of all this)

| Stage | v1 (BMAD) loads | v2 target |
|---|---|---|
| PRD | 139KB (create-prd) + ~186KB research | ≤ 8KB skill + templates |
| Design | 86KB (create-architecture, unused in practice) | ≤ 6KB |
| Plan + critique | ~34KB epics + ~48KB party-mode | ≤ 8KB + lens stanzas |
| Readiness/gates | 30KB | ~0 (CLI output only) |
| Execute per story | ~48KB (dev-story + code-review) | ≤ 10KB |
| Retro | 63KB | ≤ 5KB |
| **Full feature end-to-end** | **~550KB+** | **≤ 60KB** (S-1) |

Enforced culturally + by a `wc -c` canary test over the shipped skill bodies
and templates (fail CI if the engine's loadable prose regresses past budget).

## 7. Config: `engine:` block (replaces §15 `bmad:`)

```yaml
engine:
  workstreams_root: _devx/workstreams
  archive_root: _devx/archive
  code_citation_hints: []        # paths design-stage grounds discussion in
  expectations_min: 3
  prose_budget_kb: 60            # canary threshold for S-1
  critique:                      # re-homed party-mode
    lenses: [pm, architect, dev, qa]
    min_surfaces: 2              # thoroughness-gated as today
```

Runner commands, branch naming, modes, thoroughness: all reuse existing
config sections untouched.

## 8. CLI surface added (all pure-fn + passthrough + adversarial tests)

| Command | Kind |
|---|---|
| `devx gate prd <hash>` | mechanical validator |
| `devx gate coverage <hash>` | validator + one schema'd subagent |
| `devx gate evals <hash>` | runner + RED-report writer |
| `devx next [<hash>]` | pure decision function |
| `devx workstream new <slug>` | scaffolder (templates → `_devx/workstreams/`) |
| `devx revise <hash> --touched <file>` | cascade-reset applier |
| `devx tour build <hash>` | see `03-review-tour.md` |
| `devx loop …` | see `04-overnight-loop.md` |

Skill bodies added/rewritten: the `/devx` dispatcher + stage sections
(user-foreground PRs — see `01-bmad-capture.md` §4.6 constraint).
