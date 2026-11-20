# 8am-harness → devx: capability gap analysis

**Status:** research only, 2026-11-20. Nothing in devx changes with this
document. **Sides compared:** the 8am-harness reference snapshot at
`ed107661` (its `main`, 2026-11-20) and devx at `6d97fe4` (`main`).
**Audience:** the sessions that will be dispatched one-per-stream from
§"Proposed work streams". Every claim below cites a file on the side it
describes; a row with no citation did not survive the write-up.

Work-specific content from the reference (external wiki/tracker sync, the
company's ticket toolkit, the environment map, its live workstreams) is named
only to mark it SKIP. No text was copied from it; every row summarizes.

---

## Position

The two harnesses are not cousins, they are the same lineage one hop apart.
devx's engine design says so in its first line — `v2/02-engine.md §1` is
titled "Design tenets (stolen from 8am-harness, verbatim where possible)" —
and devx has been folding upstream deliberately: PR #146 (2026-09-01,
`feat: fold in the last 20 8am-harness PRs`) ported personalization, the
reading guide, the RED step-body lock and `/devx-walk`, after `harness-fold-in`
(July) had already ported `todo.md`, gate-verdict persistence and
`/devx-learn`. The four gates, the stage pipeline, the verdict vocabulary,
ID traceability, the cascade table, the outcome exits, the outline/critique
split and the preference bank are all present on both sides with the same
names. Of the 23 upstream skills, 10 have a working devx equivalent today
(4 of them in a stronger shape), 9 need adapting around a mechanism devx
already has, 1 is absent outright, and 3 should stay upstream.

Three facts frame the delta. First, upstream kept moving after 2026-09-01:
eight framework PRs landed since the last fold (RENDER-STYLE and its lint,
ToC chips, the annotated critique, the dashboard's live execution graph), so
part of this is simply catching the tail. Second, devx took the *mechanics*
of several upstream features without the *surface*: `devx revise` exists but
no skill arm amends-then-cascades; `devx outcome score` exists but takes the
measured number as a flag; `checkpoints/` is scaffolded and templated but
nothing writes it; `/devx verify` and `revise` are routing words with no
body. Third, devx is a strict superset on the execution side (dispatcher,
overnight loop, locks, doctor, split, outline protection, modes) and nothing
here should touch that — see §"What devx does better".

The three or four changes that carry most of the value, in order:

1. **A holistic review pass plus an auto-populated health queue** (upstream
   §25 + §23). devx detects gate failures and writes them into
   `decisions/<date>-*-verify.md` reports, then forgets them; nothing audits
   whether a workstream's frontmatter is telling the truth. This is the
   "surface what is wrong" half upstream built explicitly because the gates
   alone were "quietly bad at the second" job.
2. **Captured codebase research and a Gate-2 hygiene lens** (§21 + §18).
   devx's design gate is coverage-only; the design stage says "grep-verify"
   but keeps no research artifact for plan and execute to re-read, and
   nothing flags decision residue, duplicated facts, or an ungrounded
   load-bearing claim.
3. **An outcome gate that runs its measurement** (§16). devx armed the loop
   (`measure_by`, four exits, RESULTS.md) and left the number hand-typed. For
   personal projects the sources are scripts and counts, which is exactly the
   case where running them is cheap.
4. **The backward path's collaborative arms** (`/harness-revise`,
   `/harness-address-comments`). devx has the cascade applier and a
   five-line address stage; a late change today gets patched around the gate
   it should reopen.

The render bar (RENDER-STYLE + lint) and the execution graph are worth doing
but rank lower for a solo repo: the first exists because five reviewer roles
read one wiki page, the second because three ad-hoc parallel agents once
collided — devx already runs parallel work through dependency-ordered dev
specs and multiple scoped loops.

---

## Reading the table

Verdicts: **PORT** (absent in devx, bring it over), **ADAPT** (devx has part
of it or a different shape; extend rather than copy), **SKIP** (work-specific,
or devx chose otherwise on purpose), **ALREADY-HAVE** (present, same shape),
**DEVX-IS-BETTER** (present and the devx shape should not regress toward
upstream). Citations: upstream paths are relative to the 8am-harness repo
root; `§N` alone means `docs/harness/CONVENTIONS.md` §N. devx paths are
relative to this repo.

---

## Capability table

### A. Lifecycle commands (upstream `skills/harness-*/SKILL.md`)

| # | Upstream | devx equivalent | Verdict | Reason |
|---|---|---|---|---|
| A1 | `harness-new` — scaffold + branch + draft PR at init (`COMMUNICATION.md` §3) | `devx workstream new` (`src/lib/engine/workstream.ts`, `v2/02-engine.md §3`) | ALREADY-HAVE | Scaffold is equivalent; the draft-PR-at-init half is the PM-never-touches-git model (§9), which single-branch YOLO devx (`CLAUDE.md` §Branching model) does not need. |
| A2 | `harness-draft-prd` — interview PRD, reads LESSONS back, seeds the health queue | `/devx-plan` Stage: PRD (`skills/devx-plan.md` §Stage: PRD steps 1–7; reads `LEARN.md` first) | ALREADY-HAVE | Same interview-and-write-per-section shape; the six-question `harness.md` half is the company's agent taxonomy (`_templates/harness.md`) — SKIP. |
| A3 | `harness-review-prd` — altitude critique (§2), risk register Risk→Mitigation→Proven-by E-id, inline PR comments (SKILL.md steps 6–8) | `/devx-plan` PRD step 5 `--review` critique → `decisions/<date>-prd-critique.md` | ADAPT | devx's critique cross-references workstreams + LEARN.md but has no altitude lens ("a mechanism-only item is a gap") and no risk register tying each risk to a proving expectation. Prose-only change. |
| A4 | `harness-gate-prd` — six-Q, EARS, Covers resolve, orphan goals, open blockers fail it (steps 2–5) | `devx gate prd` (`src/lib/engine/gate-prd.ts` checks 1–5, incl. `blocked_by` must be empty) | DEVX-IS-BETTER | Mechanical, pure, tested, exit-coded; upstream's is a skill reading a checklist. devx lacks only the six-Q check, which is SKIP. |
| A5 | `harness-design` — asks first, captured research (§21), outline critique, two renders, self-review against the Gate-2 lens | `/devx-plan` Stage: Design steps 1–6 (`skills/devx-plan.md`) | ADAPT | Shape matches (ask first, outline critique, agent/human renders, reading guide). Missing: the research artifacts (row B6) and the pre-gate self-review against hygiene/groundedness (row A6). |
| A6 | `harness-gate-design` — ID coverage **plus** design completeness, §21 groundedness/reuse-per-component/explanation depth/decisions weighed, §18 residue/conciseness/duplication, §28 render checks, §22 spikes (SKILL.md Step 2) | `devx gate coverage` design mode (`src/lib/engine/gate-coverage.ts`): ID table + extras + verdict; the judgment half is one subagent table | ADAPT | devx has the coverage half and the verdict math. None of the content checks exist; upstream makes them ⚠️ (CONCERNS, never FAIL), which fits devx's "mechanical in CLI, judgment in a schema'd subagent" split: add an advisory `hygiene` array to the table JSON. |
| A7 | `harness-plan` — coverage table, phase checklist, interrogation + Risks, optional Execution Graph (Step 5.5), ticket sync (Step 6.5) | `/devx-plan` Stage: Plan (`skills/devx-plan.md` steps 1–6; interrogation + Risks ported from upstream #59 in PR #146) | ADAPT | Everything except the Execution Graph is present. Graph: row C8. Ticket sync: SKIP (D-10, `v2/07-decisions.md`). |
| A8 | `harness-gate-plan` — coverage + P0 floor + Execution Graph G-checks (acyclic, bijective, overlaps ordered/waived) | `devx gate coverage` plan mode (P0 floor mechanical) | ADAPT | Graph checks only; everything else present. Same row as C8. |
| A9 | `harness-gate-evals` — author manifests, run, red-for-right-reason, stamp step-body shas, reconcile queue (steps 5–8) | `devx gate evals` (`src/lib/engine/gate-evals.ts`) + `evals-lock.ts` (`red_eval_shas`, `evals_locked`, `red_eval_ids`, `--verify`) | DEVX-IS-BETTER | devx runs the artifacts itself and its `--verify` also catches a re-pointed `Verified by:`, an eval added after the lock, and a reclassified eval — upstream's hash check catches only a moved body. Manifest *shape* is a separate row (B17). |
| A10 | `harness-execute` — one phase, human review before commit, as-built sync, wave mode | `/devx` execute arm Phases 1–9 (`skills/devx.md`), `plan-scope.ts` + `devx workstream scope-check` in CI | DEVX-IS-BETTER | Claim locks with owner verification, worktrees, PR + remote CI + merge-gate, `devx split` on early halt, overnight loop. Review-before-commit is replaced by `devx: hold` (D-5) and YOLO auto-merge. Wave mode: row C8. |
| A11 | `harness-verify-phase` — runs the phase's verification plan as the pass/fail of record, writes `checkpoints/phase-N.md`, reconciles queue + todo | `/devx verify` is a routing word (`skills/devx.md` §Routing 3) with no arm; `v2/02-engine.md §4.8` folds it into Phase 5 under YOLO; `_devx/templates/engine/checkpoint.md` exists; `grep checkpoints/ skills/` → 0 hits | ADAPT | The evidence record is designed, templated and never written. Writing it from Phase 5 (same session, same commands) costs one template fill and gives review (A16) something to reconcile against. |
| A12 | `harness-walk` — one queue entry per invocation, fixed pick rule, dig, plan-mode, route | `/devx-walk` (`skills/devx-walk.md`; `devx next` row 11) | ALREADY-HAVE | Ported from upstream #54 in PR #146; devx's queue is blocked specs + INTERVIEW + MANUAL (row B11). |
| A13 | `harness-address-comments` — gather all surfaces → triage every comment → research substantial ones → one plan-mode batch → act on approval → cascade-reset if a gated artifact moved → reply with a marker (Phases 1–5) | `/devx address <pr>` (`skills/devx.md` §Stage: Address, 5 steps: fetch, triage in/out/question, re-run CI, status-log, lift hold) | ADAPT | devx's arm never invokes `devx revise` when a comment amends a gated artifact, has no plan-level approval gate (so `autonomy.action_mode` has nothing to govern), and no "already addressed" detection. Keep devx's hold integration. |
| A14 | `harness-revise` — ask what changed, pick the lowest artifact, amend collaboratively, write `decisions/<date>-revision-<slug>.md`, reset, null verdicts, uncheck todo, reopen executed phases, print replay (steps 3–11) | `devx revise <hash> --touched <path>` (`src/lib/engine/revise.ts`, `v2/02-engine.md §4.9`) — the CLI only; §4.9 promises "the /devx revise skill's collaborative surface" and neither skill has a `Stage: Revise` body | ADAPT | The cascade applier is done and better-guarded (refuses unknown artifacts, stage only rolls back). The amend-record-reopen conversation is missing, and so is the mid-execution half: emitted dev specs for a reopened phase are not re-blocked or re-emitted. |
| A15 | `harness-status` — position, verdict-aware gates, next command, blockers from the queue, current focus, live board with health counts | `devx status` (`src/commands/status.ts`: stage, gates, focus) + `devx next` (12-row table) | ALREADY-HAVE | Same rollup; health counts per workstream arrive with row B11. |
| A16 | `harness-review` — holistic, read-mostly, advisory: conformance, STATE reconciliation (premature closure), bidirectional RTM, diff cleanliness; parallel finders → judge → receipts → confidence floor; writes `review.md`, posts to PR, runs in CI (§25) | none. `devx doctor` reconciles *mechanical* state (`src/lib/doctor/types.ts`), Phase 4 self-review is per-diff, gate reports are per-artifact | PORT | The one upstream surface with no devx analogue. The premature-closure lens (a gate flag `true` with no evidence artifact behind it) is exactly what a frontmatter-as-state design needs audited. |
| A17 | `harness-archive` — refuse unless all verified, merge `delta/`→`specs/`, process metrics, prepend LESSONS entry, arm outcome, move to archived | `devx archive` (`src/lib/archive/plan.ts`) + Retro arm (`skills/devx.md` §Stage: Retro, metrics step 1b) + `devx outcome arm` | ALREADY-HAVE | Metrics-at-retro was ported (#59 → `_devx/templates/engine/lessons-entry.md`). `delta/`→`specs/` is SKIP (row B16). |
| A18 | `harness-outcome` — **runs** each goal's measurement from the covering expectation's manifest, records query + value + window + timestamp, four exits, tune un-archives and cascades (steps 2–6) | `devx outcome arm\|score` (`src/lib/engine/outcome.ts`; `score --goal G-N=<actual> --source G-N=<where>`) | ADAPT | The exits, RESULTS.md and the tune-reopen are done. The measurement is supplied by hand; upstream's rule "a hand-typed figure is not a result" (§16) is the part worth having. |
| A19 | `harness-personalize` | `/devx-personalize` (`skills/devx-personalize.md`, `docs/PERSONALIZATION.md`, `src/lib/personalization/lint.ts`) | ALREADY-HAVE | Ported from upstream #58 in PR #146, with the askable-question test and the drift lint. |
| A20 | `harness-customize` + `docs/harness/EXTENSIONS.md` — team extension fragments on 12 seams, stricter-only | none; `devx.config.yaml` + `docs/PERSONALIZATION.md` + `CLAUDE.md` working agreements | SKIP | Seams exist so a *team* can tune a shared plugin without forking it. devx is one person's harness with the repo as the floor; the §19 principle it protects is already stated in `CLAUDE.md` ("void at runtime and reported verbatim") and enforced by `/devx-learn`'s locked-machinery guard. |
| A21 | `harness-learn` — mine the thread, six outlets, `fw/learn-*` PR, nudge wire protocol | `/devx-learn` (`skills/devx-learn.md` §Routing, §Unattended mode), `devx learn-helper listen`, `devx learn-watch` (`src/lib/learn/*`) | DEVX-IS-BETTER | devx added an unattended mode with a code-level apply-vs-propose predicate (`src/lib/learn/route.ts`), a serial retro queue and a watcher; upstream's listener is the same idea with a Python hook. |
| A22 | `harness-help` — explain, route intent, decide whether the harness applies | `docs/HOW_TO_USE.md`; `devx next`; dispatcher intent classification (`skills/devx.md` §Routing 4) | SKIP | The "does it apply" test is devx's bug/small/large routing; a help arm would restate HOW_TO_USE under a prose budget that is nearly full (see §Budget). |
| A23 | `harness-publish-confluence` | none | SKIP | External wiki surface; D-10 forbids any external-tracker surface in v2. |

### B. Workstream artifacts (upstream `docs/harness/_templates/` and `README.md` §Anatomy)

| # | Upstream | devx equivalent | Verdict | Reason |
|---|---|---|---|---|
| B1 | `README.md` — one-paragraph summary | plan spec `## Goal` (`plan/plan-<hash>-*.md`) | ALREADY-HAVE | The spec file is the index node (`docs/DESIGN.md` §Relationship to workstream artifacts). |
| B2 | `STATE.md` — frontmatter with phase, gate flags + verdicts, `red_manifest_shas`, `phase_progress` (+ wave `exec` blocks), blockers, PR history, render sha, outcome + baseline, lineage; Notes log (`_templates/STATE.md`) | plan-spec frontmatter (`src/lib/engine/frontmatter.ts`: `stage`, `gate_status`, `gate_verdicts`, `red_eval_shas`, `evals_locked`, `red_eval_ids`, `outcome`, `blocked_by`, `learns_from`/`superseded_by`) + append-only Status log | DEVX-IS-BETTER | One file, yaml round-trip with comment preservation, no separate board file to rot (upstream §11 agrees). Not carried: `phase_progress` (devx tracks phases as dev specs + `todo.md` pointers), PR history (status log), `design_human_source_sha` (optional, row B9). |
| B3 | `prd.md` with `## Item IDs`, user-altitude sections, Success signals | `prd/agent.md` + `prd/human.md` (`_devx/templates/engine/prd/`) | ALREADY-HAVE | Same IDs, same sections; upstream's "Success signals" is folded into devx's numeric `G-` rule. |
| B4 | `harness.md` — six-question filter, tiers | none | SKIP | Company agent-OS taxonomy (§1, §6). |
| B5 | `expectations.md` — `## E-N: Title` blocks, Priority/Covers/EARS/Threshold/Verified-by | `expectations.md` (`src/lib/engine/expectations.ts`, `E_HEADING_RE` enforces the `## E-N:` form §15 insists on) | ALREADY-HAVE | Identical contract. |
| B6 | `codebase-research-questions.md` + `codebase-research.md` — blind, citation-backed, re-read by plan and execute (§21; `harness-design` step 4) | none; Design step 2 reads `engine.code_citation_hints` paths and says "grep-verify before writing" | PORT | The research evaporates with the session. Upstream's design: factual questions framed without intent, answered blind, refreshed not redone on re-entry. devx has the subagent machinery (Explore) to do it. |
| B7 | `design.md` — Design (architecture, interactions, data model, services, infra, per-subsystem), Migration, Project (reuse & new code, compliance, security, risks, trade-offs…), Reviewers, **Decision Log** (links-only), Open Questions, Glossary | `design/agent.md` (`_devx/templates/engine/design/agent.md`): Overview, Constraints, Risks, Trade-offs, Out of scope, Assumptions, Discarded, Wrap-don't-duplicate, Design (architecture/interfaces/data), Migration, **Resolved + Unresolved design questions** | ADAPT | devx's `## Resolved design questions` is what upstream §18 calls decision residue (its Gate 2 flags that section by name); replace with a Decision Log index pointing at `decisions/`. Add Glossary and a failure-handling sub-part per mechanism. Keep Wrap-don't-duplicate (it *is* upstream's Reuse & New Code). |
| B8 | `design-outline.md` (engineer-only) + `design-outline-critique.md` (annotated reproduction, one `### Proposed structure` redraw, Gap/Content/Framing findings ≤3 sentences; §28, upstream #70/#75) | outline protection (`src/lib/engine/outline.ts`: hook + CI diff scan + commit refusal) + `*/outline-critique.md` regenerated whole, never referencing the prior pass (`v2/02-engine.md §3`) | ADAPT | Protection is stronger in devx (three layers, pristine-scaffold exemption) and must not move. The critique *form* from #70/#75 (labelled reproduction, one redraw, brevity bar) is compatible with devx's regenerate-whole rule and worth adopting in the template. |
| B9 | `design-human.md` — Table of Contents, reviewer-altitude render held to `RENDER-STYLE.md` budgets, `design_human_source_sha` staleness | `design/human.md` with the Reading Guide (`_devx/templates/engine/design/human.md`, `src/lib/engine/reading-guide.ts`) | ADAPT | Structure matches (upstream #62 ported). Missing: the word budgets, the footnote form, the lint (row D6), and the source-sha staleness check. |
| B10 | `plan.md` — coverage table, Phase Checklist, Risks, optional `## Execution Graph` (yaml + mermaid + wave table), per-phase Files/Context/Verification/Tasks with the `Files:` = *changes only* rule | `plan/agent.md` (`_devx/templates/engine/plan/agent.md`) — all but the graph | ADAPT | Graph: row C8. The `Files:` semantics note (changed files only; read-as-pattern goes in Context) is a one-line template fix that also sharpens `devx workstream scope-check`. |
| B11 | `questions.md` — per-workstream health queue: `Q-N` with Kind/Severity/Blocks/Origin/Options/Recommendation/Status/Answer/Answered-by/Channel/Resolution; **auto-populated by every gate and lifecycle skill, reconciled not appended** (§23) | repo-level `INTERVIEW.md` (decisions) + `MANUAL.md` (actions) + spec `blocked_by` + `/devx-walk`; gate findings live only in `decisions/<date>-<mode>-verify.md` | ADAPT | devx has the human-decision inbox and the resolver, but no durable, rendered record of *gate concerns*: a Gate-2 CONCERNS finding is a line in a report nobody re-reads. Add a per-workstream queue written by the gate CLIs (reconciled on every run) and read by `devx next` row 11, `devx status`, `/devx-walk`; keep INTERVIEW/MANUAL as the human inboxes an entry can point at. |
| B12 | `todo.md` — working memory, skeleton + free nesting, never a gate input (§27) | `todo.md` + `devx todo sync` (`src/lib/engine/todo.ts`, `todo-truth.ts`; `test/gate-todo-isolation.test.ts`) | ALREADY-HAVE | Ported in `harness-fold-in` with the isolation test. |
| B13 | `review.md` — living advisory report with `review: CLEAN\|CONCERNS\|BLOCKING`, tally, Position, Findings, RTM, Unmapped, Recommended queue entries, Next action (`_templates/review.md`) | none | PORT | Companion to A16. |
| B14 | `decisions/` — ADR template with Context/Decision/Consequences/Alternatives and a type taxonomy in the trailing comment (revision, expectation-change, pr-resolution, design-question, spike, arch-review) | `decisions/` + `_devx/templates/engine/decision.md`; gate reports land here | ALREADY-HAVE | Add the type taxonomy to the template comment (prose). |
| B15 | `checkpoints/phase-N.md` — verdict block, per-expectation command/exit/status, cross-cutting checks, drift noted | `_devx/templates/engine/checkpoint.md` (template only; dir scaffolded by `devx workstream new`; never written) | ADAPT | Same as A11. |
| B16 | `delta/` merged into `specs/` at archive (§8) | none | SKIP | `specs/` is the company's living product-spec library. devx's record is the archived doc set (`devx archive`) plus `LEARN.md`; `docs/` stays human-authored. |
| B17 | `intent-evals/eval-NN-<slug>.md` — one manifest per expectation with typed steps **script / ui / judge / metric**, PASS criterion + "RED today because" per step, `metric` deferred to outcome, `## Runs` table (`_templates/eval.md`, §5) | `evals/E-*.ts` runnable artifacts + ad-hoc `evals/E-*.md` whose lockable shape is defined only by `isResultOfRecordLine` in `src/lib/engine/evals-lock.ts` (`Run:`/`Expected:`/`Threshold:` locked, `Status`/`Result`/`Runs` writable); no eval template under `_devx/templates/engine/evals/` | ADAPT | devx runs code artifacts better; what it lacks is a *documented* manifest shape for the evals that are not a test file, and the `metric` step type that A18 needs. Drop `ui` (devx routes browser checks to `/devx-test` walkthroughs or a Playwright `script`). |
| B18 | `intent-evals/ui-map.md`, `seed.md`, `evidence/`, `eval-helper/` environment map, `agents/ui-runner.md` (§26) | `docs/QA.md` layers, `/devx-test` attended-only, `test/*-qa-walkthrough.md` | SKIP | Environment map and runner are built for the company's multi-repo app; devx's QA decision (hybrid driver, attended only — `skills/devx-test.md` §Attended only) stands. The FAIL/BLOCKED/SPLIT vocabulary is worth copying as prose (§Conventions). |
| B19 | `spikes/<KEY>/` + `_templates/spike.md` — when a question must be *tried*, scope a timeboxed spike and fold findings home as a `spike` decision (§22) | `/devx-walk` offers a spike when `walk.dig_depth: spike-offered` (`skills/devx-walk.md` Step 2); no record shape | ADAPT (small) | Ticket plumbing is SKIP; a `decisions/<date>-spike-<slug>.md` form with Goal/Questions/Criteria/Findings/Recommendation is a one-sitting template. |
| B20 | `RESULTS.md` — verdict frontmatter, per-goal table with Source = query · window · timestamp | `_devx/templates/engine/results.md` + `outcome.ts` | ALREADY-HAVE | Source cell becomes computed with A18. |
| B21 | `docs/harness/LESSONS.md` — shared, newest-first, tagged, read back by the PRD skills | `LEARN.md` (per-epic sections, `[confidence] [blast-radius]` rows, cross-epic promotion at ≥3 retros, process metrics) | DEVX-IS-BETTER | Richer entry contract and a promotion rule; devx's PRD stage reads it back the same way. |

### C. Conventions and mechanics (`docs/harness/CONVENTIONS.md`, `COMMUNICATION.md`, `FUTURE.md`)

| # | Upstream | devx equivalent | Verdict | Reason |
|---|---|---|---|---|
| C1 | §12 cascade incl. the eval step-body row; `red_manifest_shas` stamped at Gate 4, recomputed at verify; `hooks/red-manifest-guard.py` PreToolUse refusal | `src/lib/engine/revise.ts` (table), `evals-lock.ts` L2/L3 (`--verify`); **no L1 hook**: `_devx/templates/init/claude-settings-hooks.json` wires only `devx outline guard` + `devx learn-helper listen`, and `CLAUDE.md` states "the lock is detection, not enforcement" | ADAPT | Detection is wider in devx (`--verify` beats upstream's hash check) and stays. The only missing piece is the write-time hook: one sitting on the `devx outline guard` precedent, but it reverses a recorded stance, so it is the owner's call rather than a default port. |
| C2 | §13 deterministic verdicts, persisted per gate | `src/lib/engine/verdict.ts` (D-9), `gate_verdicts` map (`frontmatter.ts`), FAIL rendered distinct from never-run (`render.ts`) | ALREADY-HAVE | Identical vocabulary and persistence. |
| C3 | §14 verification before completion | tenet 7 (`v2/02-engine.md §1`), checkpoint template, Phase 5 gate function | ALREADY-HAVE | — |
| C4 | §15 ID traceability, `ID: Title` parsed heading | gate-prd bidirectional checks, `E_HEADING_RE` | ALREADY-HAVE | — |
| C5 | §16 measurement is run, not asked for | `outcome.ts` takes `--goal` | ADAPT | Row A18. |
| C6 | §18 current-state artifacts: decisions live in `decisions/`, decision residue is a finding, one home per fact, `N/A — why` not filler | partial: templates ask for `N/A` and cite decisions; no residue/duplication check anywhere (`grep residue src/lib/engine` → none) | ADAPT | Prose plus the Gate-2 advisory lens (A6). |
| C7 | §19 customizations tune seams; the constitution is not a seam | `CLAUDE.md` §Working agreements ("No preference can skip, weaken, auto-pass…"), `/devx-learn` §Locked machinery, `src/lib/learn/route.ts` | ALREADY-HAVE | Principle present; seam mechanics SKIP (A20). |
| C8 | §20 parallel execution: gated Execution Graph (`depends_on`, `touches`, `parallel_safe`, `integration`, `production_touch`, task edges, overlap waivers), single-writer orchestrator, review-at-PR, re-verify after rebase; `harness-execute --wave` | emitted dev specs carry `blocked_by` in dependency order (`skills/devx-plan.md` RED step 3); `devx loop` runs N instances on disjoint scopes (`--epic/--items`, mlc106) with worktrees, locks, merge-gate; `devx graph` renders the board (`GRAPH.md`) | ADAPT | devx already has the executor and the isolation. What is missing is the *declared, gate-validated* structure: a plan-level graph that Gate 3 checks (cycle, bijection with the checklist, same-file overlap ordered or waived) and that RED emission turns into `blocked_by`. Today ordering is implicit in emission order. |
| C9 | §21 design grounded in code truth | row B6 + A6 | PORT | — |
| C10 | §22 blocking unknowns escalate to spikes | row B19 | ADAPT (small) | — |
| C11 | §23 health is first-class state | row B11 | ADAPT | — |
| C12 | §24 the framework learns from every session; nudge as wire protocol; wording-equality lint | `/devx-learn`, `src/lib/learn/nudge.ts`, `test/learn-nudge-pin.test.ts` | ALREADY-HAVE | — |
| C13 | §25 holistic, read-mostly, advisory review | row A16 | PORT | — |
| C14 | §26 agent-executed ui steps: FAIL is evidence, BLOCKED is wiring, SPLIT is a flake, PASS needs N-run unanimity | `docs/QA.md` (no such vocabulary; `grep BLOCKED\|SPLIT docs/QA.md` → none) | SKIP (mechanics) | Runner SKIP per B18; the trichotomy is a §Conventions prose item for `docs/QA.md`. |
| C15 | §27 intent is first-class state | `todo.md` machinery | ALREADY-HAVE | — |
| C16 | §28 two audiences, one design; render bar in `RENDER-STYLE.md`; stale-render ⚠️ | agent.md/human.md/outline/critique quartet; no bar, no sha | ADAPT | Rows B9, D6. |
| C17 | §29 preferences are answered, not assumed | `docs/PERSONALIZATION.md` | ALREADY-HAVE | — |
| C18 | §30 two commit classes; plugin semver derived from conventional commits via release tooling; `bin/lint_commit_title.sh` | conventional commits everywhere (`CLAUDE.md`), npm package, `update_devx.sh` | SKIP | Solves a plugin-distribution problem (installed copies only move on a version bump) that an npm CLI with one consumer does not have. |
| C19 | §31 Table of Contents as audience map; upstream #68 moved it from a ●/○ matrix to a nested list with binary role chips | Reading Guide in matrix form (`reading-guide.ts`, `design/human.md` template) | SKIP (for now) | The list-with-chips revision was driven by five sign-off roles reading a wiki page; devx's four lenses and one reader keep the matrix legible. Revisit if human.md grows readers. |
| C20 | §10 many branches per workstream, one per stage; branch→workstream resolution must verify (upstream #46) | single branch, one PR per dev spec; resolution by hash (`workstream.ts` `findSpecForHashInFs`) | SKIP | devx never derives identity from a branch name, so the failure #46 fixes cannot occur. |
| C21 | §9 PM is a first-class user and never touches git; `COMMUNICATION.md` §7 PM cheat sheet | `role: pm` preference hides git mechanics (`docs/PERSONALIZATION.md` §4 key 1) | SKIP | Solo repo; the preference already covers the altitude. |
| C22 | §2 configuration not code; the PRD stays at the user's altitude | Wrap-don't-duplicate section (design template) covers the design half; nothing covers the PRD half | ADAPT (prose) | Row A3. |
| C23 | §3 gates gate passing and execution, not authoring | tenet 2 | ALREADY-HAVE | — |
| C24 | §4 design before plan; the plan is the state tracker; as-built sync in the same commit | tenets + `src/lib/engine/plan-scope.ts` + CI `scope-check` | DEVX-IS-BETTER | devx mechanically bounds the as-built edit to the story's own phase; upstream relies on the skill. |
| C25 | §11 state is self-updating; status is a read | tenet 4; `devx next` computed fresh (`src/lib/engine/next.ts`) | ALREADY-HAVE | — |
| C26 | §5 eval separation, §6 tiers, §7 labs cadence, §8 archive-on-merge into specs, §17 external surfaces | — | SKIP | Company-specific. |
| C27 | `COMMUNICATION.md` §5–§6 where conversations happen; when a PR comment is promoted to a decision record | nothing written; practice exists (gate reports, revision records) | ADAPT (prose) | §Conventions. |
| C28 | `FUTURE.md` §A autonomous driver (run-until-blocked, question surfacing, cloud loop, split/merge/nest) | `devx loop` + `devx next` + `devx split` shipped (`v2/04-overnight-loop.md`, `v2/05-dispatcher.md`, `src/lib/devx/split.ts`); loop frozen by D-15 | DEVX-IS-BETTER | Upstream's future is devx's present. Merge/nest of workstreams: neither side has it. |
| C29 | `FUTURE.md` §B harness self-evals: golden set (B.1), **mutation benchmarking of the gates** (B.2), process telemetry (B.4) | gate CLIs are pure functions with adversarial vitest suites (`v2/02-engine.md §8`); process metrics at retro | ADAPT (small) | B.2 is cheap in devx precisely because the gates are pure: a test that deletes a P0 row / drops a `Covers:` / greens a P0 eval and asserts FAIL. Likely partly covered already; the row exists so a stream claims it. |

### D. Tooling, hooks, CI, dashboard

| # | Upstream | devx equivalent | Verdict | Reason |
|---|---|---|---|---|
| D1 | `docs/harness/_site/` static dashboard — `harness_state.py` (parse STATE, gates, next command, questions, todo, timeline) + `build.py` (board, per-workstream page, "In this PR" diff section, live Execution Graph mermaid since #99) + `publish.sh` to a Pages branch with per-PR previews (`_site/README.md`) | `devx serve` / `devx ui` are Phase-4 stubs (`src/commands/serve.ts`, `ui.ts`; `docs/DESIGN.md` §Observability surfaces); `devx graph` writes `GRAPH.md` (mermaid board); `devx status`, `devx next --json` | ADAPT | The readers already exist in devx (`next/gather.ts`, `status.ts` renderers, `graph/model.ts`); a static `devx board` that emits one HTML page per workstream from them is a day, and `GRAPH.md`'s mermaid is the graph panel until C8 lands. PR previews on a Pages branch: optional. |
| D2 | `hooks/learn-listener.py` + `bin/harness-learn-watch` | `devx learn-helper listen`, `devx learn-watch` | ALREADY-HAVE | — |
| D3 | `bin/lint_nudge.py` (wording equality of the nudge across skills) | `test/learn-nudge-pin.test.ts`, `nudge-canonical` marker | ALREADY-HAVE | — |
| D4 | `bin/lint_personalization.py` | `src/lib/personalization/lint.ts` + test | ALREADY-HAVE | — |
| D5 | `bin/lint_commit_title.sh`, release tooling, `commit-lint.yml` | — | SKIP | Row C18. |
| D6 | `docs/harness/_render/design_human_lint.py` — offline, line-based; budgets, cells, footnotes + back-references, duplicate phrases, WHY-density, apparatus leak; HARD vs advisory; exit 2 on HARD; `--renumber` | none | ADAPT | Port the measurable rules (R1–R6, R9, R10, R13) as a pure TS module behind `devx render lint <hash> <stage>`; drop the wiki-specific nesting rule and company-language rules. Pairs with B9. |
| D7 | `_render/confluence_render.py`, `confluence_publish.py`, storage snapshots | — | SKIP | External wiki. |
| D8 | `.github/workflows/harness-review.yml` — review on every workstream PR; `consistency-lint.yml`; `render-tests.yml` | `devx-ci.yml` (typecheck, test, `outline check`, `workstream scope-check`) | ADAPT | Add an advisory review job once A16 exists; the lint suites are already vitest. |
| D9 | `skills/*/evals/evals.json` behavioral cases (no runner — `FUTURE.md` §B.1) | adversarial vitest per gate | DEVX-IS-BETTER | — |
| D10 | `update_harness.sh` | `update_devx.sh` (PR #148) | ALREADY-HAVE | — |
| D11 | `agents/ui-runner.md` | — | SKIP | Row B18. |

### E. Framework prose

| # | Upstream | devx equivalent | Verdict | Reason |
|---|---|---|---|---|
| E1 | `CONVENTIONS.md` (805 lines, 31 §s) — the constitution skills cite by number | `CLAUDE.md` §Working agreements, `v2/02-engine.md §1` tenets, `v2/07-decisions.md` ledger; no single numbered constitution | ADAPT | Not a port of the file (half of it is company- or wiki-specific, and devx's skill prose budget is nearly full). A compact `docs/CONVENTIONS.md` carrying the dozen rules in §Conventions, each with its devx enforcement pointer, outside the loadable-prose budget. |
| E2 | `COMMUNICATION.md` (366) — roles, branch-per-stage, commit table, where conversations happen, PM/engineer cheat sheets | `docs/HOW_TO_USE.md`, `CLAUDE.md` §How `/devx` runs | SKIP (mostly) | Branch-per-stage and the PM model do not apply; §5–§6 are prose rows (C27). |
| E3 | `RENDER-STYLE.md` (308) — R1–R13 with before/after pairs, budgets, the one footnote form, the mechanism shape | none | ADAPT | Row B9/D6; strip company-language and wiki-render rules. |
| E4 | `PERSONALIZATION.md` (211) | `docs/PERSONALIZATION.md` (362 lines) | ALREADY-HAVE | devx's is the port, with four rejected asks recorded. |
| E5 | `EXTENSIONS.md` (156) | — | SKIP | Row A20. |
| E6 | `LESSONS.md` (27, the format) | `LEARN.md` | DEVX-IS-BETTER | Row B21. |
| E7 | `FUTURE.md` (146) | `docs/ROADMAP.md`, `docs/OPEN_QUESTIONS.md`, `v2/06-phases.md` | ALREADY-HAVE | Rows C28–C29. |

---

## PORT and ADAPT rows: files, size, dependencies

Size: **one-sitting** < half a day; **a day** = one focused session with
tests; **a week** = several PRs. "Depends on" names rows, not streams.

| Row | devx files that change | Size | Depends on |
|---|---|---|---|
| A3 PRD critique lens | `skills/devx-plan.md` §Stage: PRD step 5 (prose; see §Budget); `_devx/templates/engine/prd/agent.md` (risk register seed) | one-sitting | — |
| A6 / C6 Gate-2 hygiene lens | `src/lib/engine/gate-coverage.ts` (accept an advisory `hygiene: [{kind, where, note}]` array in the table JSON; render a "Hygiene (advisory)" section in `decisions/<date>-design-verify.md`; never affects FAIL), `skills/devx-plan.md` §Stage: Design step 4 (subagent prompt gains the four §21 checks + residue/duplication), tests | a day | B6 (groundedness checks want research to point at); independent otherwise |
| A11 / B15 checkpoints | `skills/devx.md` Phase 5 (fill `checkpoints/phase-N.md` from the template after the gates run; one status-log line), `src/lib/engine/artifacts.ts` (`checkpointRel(n)`), test asserting shipped workstream specs have a checkpoint | one-sitting | — |
| A13 address arm | `skills/devx.md` §Stage: Address (triage buckets; research; one plan-mode batch; act on approval; `devx revise` when a gated artifact moves; reply marker) — prose, see §Budget | a day | A14 (the revise arm it routes to) |
| A14 revise arm | new `skills/devx-revise.md` + `.claude/commands/devx-revise.md` (outside the budgeted files), `skills/devx.md` §Routing 3 (one line), `src/lib/engine/revise.ts` (optional: list emitted dev specs for a reopened phase in the JSON), `src/commands/revise.ts`, tests | a day | — |
| A16 / B13 / C13 holistic review | new `skills/devx-review.md` + mirror, new `_devx/templates/engine/review.md`, `src/lib/engine/workstream.ts` (scaffold review.md), optional `devx workstream position <hash> --json` reusing `renderGateSummary` + `nextForWorkstream` (never fork them), `.github/workflows/devx-ci.yml` advisory job, `test/review-never-writes-gates.test.ts` (isolation pin like `gate-todo-isolation`) | a day–two | — (recommends INTERVIEW rows until B11 exists) |
| A18 / C5 / B20 outcome runs | `src/lib/engine/outcome.ts` + `src/commands/outcome.ts` (`score --run`: for each `G-`, find covering E-blocks' manifests, execute `metric`/`script` steps, capture value + window + timestamp into the Source cell; refuse a hand-typed value when a runnable measure exists), `_devx/templates/engine/results.md`, `skills/devx.md` §Stage: Outcome step 2 | a day | B17 (the `metric` step shape) |
| B6 / C9 research artifacts | new `_devx/templates/engine/design/research-questions.md` + `research.md`, `src/lib/engine/artifacts.ts` (kinds), `skills/devx-plan.md` §Stage: Design step 2 (frame → blind Explore → write → refresh-not-redo), `skills/devx.md` Phase 2 (read it when the spec belongs to a workstream) | a day | — |
| B7 design template | `_devx/templates/engine/design/agent.md` (Decision Log index replaces Resolved questions; Glossary; `#### Failure handling` guidance), `_devx/templates/engine/decision.md` (type taxonomy comment), `src/lib/engine/gate-coverage.ts` only if it keys on section names | one-sitting | — |
| B8 critique form | `_devx/templates/engine/*/outline-critique.md` (annotated reproduction with `[N]` labels, one `### Proposed structure` redraw, three finding kinds, ≤3 sentences), `skills/devx-plan.md` rule 8 (one sentence) | one-sitting | — |
| B9 / C16 / D6 / E3 render bar | new `docs/RENDER-STYLE.md` (adapted R1–R13), new `src/lib/engine/render-lint.ts` (pure) + `src/commands/render.ts` (`devx render lint <hash> <stage>`, exit 2 on HARD), `_devx/templates/engine/*/human.md` header, `skills/devx-plan.md` rule 9 (run the lint before the gate), optional `design_human_source_sha`-style field in `frontmatter.ts` | a day–two | — |
| B10 `Files:` semantics | `_devx/templates/engine/plan/agent.md` (one note) | one-sitting | — |
| B11 / C11 health queue | new `_devx/templates/engine/questions.md`, new `src/lib/engine/questions.ts` (parse `## Q-N:` blocks; reconcile a gate's current findings against its open entries — add, update, resolve), `src/commands/gate.ts` (post-verdict reconcile for prd/coverage/evals), `src/lib/engine/workstream.ts` (scaffold), `src/lib/next/gather.ts` + `decide.ts` row 11 + `src/commands/status.ts` (health counts), `skills/devx-walk.md` (queue source 0), `skills/devx-plan.md` Design step (park open questions as entries) | a day–two | — |
| B17 eval manifest | new `_devx/templates/engine/evals/eval.md` (frontmatter id/priority/covers/status/last_run; typed steps `script`/`judge`/`metric`/`human`; `## Runs`), `src/lib/engine/gate-evals.ts` (a `metric` step marked deferred-to-outcome counts as deferred at any priority; no FAIL on a P0 whose only unmet step is that), `src/lib/engine/evals-lock.ts` (confirm the template's lines classify as intended; add a fixture) | a day | — |
| B19 / C10 spike record | `_devx/templates/engine/decision.md` (spike variant) or new `spike.md`; `skills/devx-walk.md` Step 2 (one line naming the record) | one-sitting | — |
| C1 L1 eval hook (optional) | `src/commands/gate.ts` (`devx gate evals guard` endpoint over `evalsGuardDecision`), `_devx/templates/init/claude-settings-hooks.json`, `src/lib/init-write.ts`, `CLAUDE.md` (the "detection, not enforcement" sentence changes) | one-sitting | owner decision — it reverses a recorded stance |
| C8 / A7 / A8 execution graph | `_devx/templates/engine/plan/agent.md` (`## Execution graph` yaml: phases with `depends_on`, `touches`, `parallel_safe`, `integration`, `production_touch`; task edges; waivers), new `src/lib/engine/plan-graph.ts` (parse; acyclic; bijective with the checklist; same-file overlap from `Files:` entry paths — path before the ` — ` separator, per upstream `docs/updates/2026-08-04-g7-files-entry-definition.md`; waiver with approver), `src/lib/engine/gate-coverage.ts` plan mode (graph FAIL/CONCERNS), `skills/devx-plan.md` Plan step + RED emission (`blocked_by` from `depends_on`; independent pairs as `Parallel-safe with` rows), `src/commands/workstream.ts` (`devx workstream graph <hash>` reader), `src/lib/plan/validate-emit.ts` (check 7: emitted `blocked_by` ⇐ graph); no change to `src/lib/graph/model.ts` — emitted edges already render | a day–two | — |
| C29 gate mutation tests | `test/gate-mutations.test.ts` over the real-repo fixture helper `test/fixtures/engine-repo.ts` | one-sitting | — |
| D1 board | new `src/commands/board.ts` + `src/lib/board/*` (static HTML to `.devx-cache/board/` or `_devx/board/`; one index + one page per workstream: stage, gates with verdicts, focus, health, todo, graph via `GRAPH.md` mermaid), `docs/DESIGN.md` §Observability (note the static board as the first lens) | a day | B11 for the health column (renders blockers from `blocked_by` until then) |
| D8 review in CI | `.github/workflows/devx-ci.yml` (job runs `/devx-review` or its CLI position check only when a workstream dir changed; advisory) | one-sitting | A16 |
| E1 compact conventions | new `docs/CONVENTIONS.md` (not under the prose canary) | one-sitting | §Conventions below |
| A3 / C22 / C27 prose rows | folded into E1 | — | — |

### Budget constraint for every row that adds skill prose

`test/engine-prose-budget.test.ts` gates two sums: templates + `devx-plan.md`
at `engine.prose_budget_kb: 60` and that plus `devx.md` at
`full_run_prose_budget_kb: 128` (D-14). Measured at `6d97fe4`:

| Surface | Bytes | Headroom |
|---|---|---|
| templates (29,222) + `devx-plan.md` (27,381) | 56,603 | 4,837 |
| + `devx.md` (72,013) | 128,616 | 2,456 |

So the address rewrite (A13) and any Design/PRD-stage prose (A3, A6, B6)
compete for about 2.4KB in total. Options, in preference order: new skill
files for new arms (`devx-revise.md`, `devx-review.md` — `devx-walk.md` set
the precedent and is not counted); move the Stage: Address body out of
`devx.md` into its own skill; cut prose elsewhere in the same PR; or a
budget bump with a D-14-style decision entry. Templates count too, so the
new `questions.md`, `eval.md`, `review.md`, research templates must be
terse or come with cuts.

---

## Proposed work streams

Six streams. Each is dispatchable to one session; "Files owned" is the
conflict map. Two files are hot across streams — `src/lib/engine/gate-coverage.ts`
(streams 4 and 5) and `src/commands/gate.ts` (streams 1 and 6) — so the
sequence below keeps those pairs out of the same wave.

### Stream 1 — Health queue, checkpoints, board

- **Rows:** B11/C11, A11/B15, A15 (health column), D1.
- **Files owned:** `_devx/templates/engine/questions.md`, `src/lib/engine/questions.ts`,
  `src/commands/gate.ts` (post-verdict reconcile only), `src/lib/engine/workstream.ts`
  (scaffold), `src/lib/next/gather.ts`, `src/lib/next/decide.ts` (row 11 text),
  `src/commands/status.ts`, `skills/devx-walk.md`, `skills/devx.md` Phase 5
  (checkpoint write — small), `src/commands/board.ts`, `src/lib/board/*`.
- **Done means:** a Gate-2 or Gate-3 FAIL/CONCERNS run leaves `Q-N` entries
  with Kind/Severity/Blocks/Recommendation/Status in the workstream's
  `questions.md`, and a re-run that passes resolves them; `devx next` row 11
  and `devx status` show per-workstream blocking/concern counts; `/devx`
  Phase 5 writes `checkpoints/phase-<n>.md` with a verdict block on every
  workstream story; `devx board` writes a static site with one page per
  workstream (stage, gates+verdicts, focus, health, todo, the `GRAPH.md`
  mermaid). INTERVIEW.md and MANUAL.md are unchanged.
- **Size:** a week. **Depends on:** nothing.

### Stream 2 — Holistic review

- **Rows:** A16/B13/C13, D8, C29.
- **Files owned:** `skills/devx-review.md` + `.claude/commands/devx-review.md`,
  `_devx/templates/engine/review.md`, `src/commands/workstream.ts` (optional
  `position --json`), `.github/workflows/devx-ci.yml` (one advisory job),
  `test/review-never-writes-gates.test.ts`, `test/gate-mutations.test.ts`.
- **Done means:** `/devx-review <hash>` writes `review.md` leading with
  Position (stage, verdict-aware gates, next command, blockers), then a
  deterministic `review: CLEAN|CONCERNS|BLOCKING` + tally, Findings with a
  receipt column (file:line, command, or grep — never inference), a
  bidirectional RTM (`G-/UC-/CAP-/FR-` → E → phase → eval), Unmapped work,
  Recommended queue entries (INTERVIEW rows until Stream 1 lands), Next
  action; it reads `gate_status` and never writes it (pinned by test);
  premature closure (flag true, evidence artifact missing or stale) is its
  top severity; the mutation tests prove each gate FAILs on a deleted P0 row,
  a dropped `Covers:`, and a green P0 eval.
- **Size:** a day–two. **Depends on:** nothing.

### Stream 3 — Backward path

- **Rows:** A14, A13, B14 taxonomy, C27 prose.
- **Files owned:** `skills/devx-revise.md` + mirror, `skills/devx.md` §Routing 3
  and §Stage: Address, `src/lib/engine/revise.ts` (report emitted dev specs
  per reopened phase), `src/commands/revise.ts`, `_devx/templates/engine/decision.md`.
- **Done means:** `/devx-revise <hash>` asks what changed, names the lowest
  artifact, amends it in present tense, writes `decisions/<date>-revision-<slug>.md`,
  runs `devx revise`, lists emitted dev specs for reopened phases and flips
  ready ones to blocked (or re-emits), reconciles `todo.md`, prints the
  replay path; `/devx address <pr>` triages every comment before acting,
  researches substantial ones against code, presents one plan-mode batch,
  acts only on approval, routes any gated-artifact amendment through
  `/devx-revise`, and marks its replies so a later run recognizes them;
  `autonomy.action_mode` now governs something.
- **Size:** a day. **Depends on:** nothing. Watch the budget: Address prose
  likely moves to its own skill file.

### Stream 4 — Planning-stage quality

- **Rows:** A3/C22, B6/C9, A6/C6, B7, B8, B19/C10, B9/C16/D6/E3.
- **Files owned:** `skills/devx-plan.md` (PRD step 5, Design steps 2–4,
  rules 8–9), `_devx/templates/engine/prd/agent.md`, `design/agent.md`,
  `design/human.md`, `*/outline-critique.md`, new `design/research*.md`,
  `src/lib/engine/gate-coverage.ts` **design-mode report only** (advisory
  hygiene section), `src/lib/engine/artifacts.ts`, `docs/RENDER-STYLE.md`,
  `src/lib/engine/render-lint.ts`, `src/commands/render.ts`, `skills/devx.md`
  Phase 2 (one sentence: read research when present).
- **Done means:** the Design stage writes `research-questions.md` then a
  blind `research.md` with citations before drafting, and refreshes it on
  re-entry; the coverage subagent returns advisory hygiene findings
  (decision residue, duplicated fact, ungrounded load-bearing claim, bare
  decision with no alternative) that the CLI renders and that hold
  CONCERNS, never FAIL; the design template has a links-only Decision Log
  and a Glossary and no Resolved-questions section; the critique template
  uses the annotated-reproduction + one-redraw form while staying a pure
  function of the current outline; `devx render lint <hash> design` measures
  budgets, cells, footnotes, apparatus leaks and exits 2 on HARD; rule 9 runs
  it before the gate; the PRD critique flags mechanism-only items and emits
  a Risk→Mitigation→Proven-by table.
- **Size:** a week. **Depends on:** nothing; coordinate with Stream 5 on
  `gate-coverage.ts` (design-mode vs plan-mode sections — run sequentially).

### Stream 5 — Execution graph

- **Rows:** C8/A7/A8, B10.
- **Files owned:** `_devx/templates/engine/plan/agent.md`, `src/lib/engine/plan-graph.ts`,
  `src/lib/engine/gate-coverage.ts` **plan-mode only**, a few lines of
  `src/commands/gate.ts` (plan-mode read + JSON field), `src/commands/workstream.ts`
  (`graph` subcommand), `src/lib/plan/validate-emit.ts` (check 7),
  `skills/devx-plan.md` Plan steps 3/5 + RED step 3 (emission), docs note in
  `v2/02-engine.md §4.5`. *(Amended 2026-11-20 once the stream was in code:
  `src/lib/graph/model.ts` needed no change — emitted `blocked_by` edges and
  `Parallel-safe with` rows already render, and the model never invents a
  node.)*
- **Done means:** a plan may declare `## Execution graph`; Gate 3 FAILs a
  cycle, a phase missing from the checklist (or vice versa), and an
  unordered same-file overlap without a named waiver, and warns on
  `parallel_safe` phases whose `Files:` collide; RED emission sets each dev
  spec's `blocked_by` from `depends_on`; `GRAPH.md` shows the phases; the
  recipe "two `devx loop --items` instances on the independent phases" is
  documented as the wave executor (no new executor — `devx loop` is frozen
  by D-15, this only changes what it is handed).
- **Size:** a day–two. **Depends on:** nothing.

### Stream 6 — Measurable goals and eval manifests

- **Rows:** A18/C5/B20, B17, `FUTURE.md` §C.1 measurability floor, C1 hook
  (optional, owner's call).
- **Files owned:** `_devx/templates/engine/evals/eval.md`, `_devx/templates/engine/expectations.md`
  (a `Measure:` line or manifest pointer on goal-covering E-blocks),
  `src/lib/engine/gate-evals.ts`, `src/lib/engine/evals-lock.ts` (fixture),
  `src/lib/engine/outcome.ts`, `src/commands/outcome.ts`, `src/lib/engine/gate-prd.ts`
  (advisory: a numeric `G-` with no runnable measure → CONCERNS),
  `_devx/templates/engine/results.md`, `skills/devx.md` §Stage: Outcome,
  optionally `src/commands/gate.ts` (`evals guard`) + the hooks template.
- **Done means:** a manifest template exists with typed steps and a `## Runs`
  table whose classification matches `isResultOfRecordLine`; `devx gate evals`
  treats a `metric` step marked deferred-to-outcome as deferred at any
  priority; `devx outcome score <hash> --run` executes each goal's measure,
  writes value + window + timestamp into the Source cell, and refuses a
  hand-typed `--goal` when a runnable measure exists; Gate 1 warns when a
  numeric goal has no runnable measure; `devx next` row 5.5 still fires.
- **Size:** a week. **Depends on:** nothing.

### Sequence

| Wave | Streams | Why together |
|---|---|---|
| 1 | 2 (review), 3 (backward path), 6 (measurement) | Disjoint files; 2 is read-only, 3 is skill prose + `revise.ts`, 6 owns `gate-prd`/`gate-evals`/`outcome`. Highest value per byte. |
| 2 | 1 (health queue + board), 5 (execution graph) | 1 owns `gate.ts` post-verdict path; 5 owns plan-mode `gate-coverage.ts` and the plan template. Low overlap; both benefit from Wave 1's review being able to audit them. |
| 3 | 4 (planning-stage quality) | Largest, touches `devx-plan.md` and design-mode `gate-coverage.ts`; lands last so the budget cuts it needs are made against the final shape of the others. |

Stream 2 before Stream 1 is deliberate: the review recommends queue entries
and works without the queue; building the queue first would have nothing
auditing whether its entries match reality.

---

## What devx does better (do not flatten)

- **Mechanical gates as CLI primitives.** `devx gate prd|coverage|evals`
  are pure, exit-coded, fixture-tested; upstream's gates are skills reading a
  checklist. The judgment half is one schema-constrained subagent table. Keep
  every new check mechanical-first (`v2/02-engine.md §1`, §8).
- **The RED lock is wider than upstream's.** `--verify` catches re-pointing,
  additions and reclassification, not only a moved body (`src/lib/engine/evals-lock.ts`;
  `CLAUDE.md` §Fix the code, not the eval). Upstream's extra is only the
  write-time hook, which devx declined on purpose.
- **Execution.** Atomic claim with rollback and owner verification
  (`src/lib/devx/claim.ts`, `verify-claim.ts`), worktrees, PR + remote CI +
  mode-derived merge gate, `devx split` for early halts, `devx doctor` for
  mechanical repair with a judgment boundary drawn from real incidents
  (`src/lib/doctor/types.ts`), as-built edits bounded to the story's own phase
  in CI (`plan-scope.ts`). Upstream's execute is one phase, human review
  before commit, serial.
- **The dispatcher and the loop.** `devx next` is a 12-row pure decision
  table; `devx loop` is a transactional-git, failure-ladder, reconstruct-
  don't-recall overnight driver with usage-window pausing (`v2/04-overnight-loop.md`
  §1, `src/lib/loop/`). Upstream's `FUTURE.md` §A describes this as the
  thing to build next.
- **Outline protection** is three-layered and byte-exact with a pristine-
  scaffold exemption (`src/lib/engine/outline.ts`); upstream's is a skill
  instruction plus a template.
- **Modes, shapes, thoroughness** cascade to every gate (`docs/MODES.md`);
  upstream has one posture.
- **Layout migration and archive** (`devx layout migrate`, `devx archive`)
  move a doc set without touching gate state, by construction.
- **Two human inboxes** (`INTERVIEW.md` decisions, `MANUAL.md` actions) are
  repo-level and cross-workstream; upstream's queue is per-workstream only.
  Stream 1 adds the per-workstream queue beside them, not instead.
- **Self-healing and learn** run unattended with a code-level apply-vs-propose
  predicate (`src/lib/learn/route.ts`); upstream's is foreground.
- **Prose budget.** The engine's loadable prose is CI-gated at 60KB/128KB
  (`test/engine-prose-budget.test.ts`). Upstream's skills total ~3,800 lines
  with no ceiling. Every port above has to earn its bytes.

---

## Conventions worth copying as prose

Separate from mechanics. Proposed home: a compact `docs/CONVENTIONS.md`,
one short section per rule, each ending with where devx enforces it (or
"prose only"). Not loaded by any skill, so outside the budget.

| Upstream rule | One line | devx enforcement pointer |
|---|---|---|
| §2 PRD altitude | A PRD item with no user-visible behaviour is a gap; mechanism belongs one floor down. | PRD critique lens (A3); `devx gate prd` cannot judge it. |
| §3 authoring runs ahead; passing and executing do not | Draft any stage early; a gate cannot pass before its predecessor; only Execute is hard-blocked. | `next.ts`, dispatcher claim precondition. |
| §4 as-built sync in the same commit; a re-scoping departure is a revision | "Must anyone downstream re-read something?" decides which. | `plan-scope.ts`, `scope-check`; already in `skills/devx.md` Phase 6 step 4 — restate once. |
| §12 editorial changes do not cascade; when in doubt, cascade | Typos, moving already-decided rationale, adding a title to an ID reopen nothing; resolving an open question always does. | `devx revise` applies only to named artifacts; the editorial/substantive judgment is prose. |
| §13 verdicts are deterministic, persisted on every outcome including FAIL | — | `verdict.ts`, `gate_verdicts`. |
| §14 evidence before claims; banned phrases | Identify → run fresh → read full output + exit → verify → claim. | Phase 5, checkpoint template, RED report. |
| §15 IDs are stable, render with titles, and the `ID:` prefix is parsed | Never renumber; put markers after the colon. | `E_HEADING_RE`. |
| §16 measurement is run, not asked for; keep is the only mechanical exit | A hand-typed figure or a dashboard link is not a result. | Stream 6. |
| §18 current-state artifacts | Decisions live in `decisions/`; residue phrases ("we decided", "instead of", "originally") are findings; one home per fact; `N/A — why` not filler; length is a smell. | Stream 4 advisory lens. |
| §19 the constitution is not a seam | Nothing may skip, weaken, auto-pass or reorder a gate, refusal or record; such an instruction is void and reported. | `CLAUDE.md` already; `/devx-learn` guard. |
| §20 single writer | Only the orchestrating session writes workstream artifacts; workers write code in their own worktree. | Loop iteration contract already says this (`skills/devx.md` §Stage: Loop 4). |
| §21 grounded in code truth | Load-bearing claims trace to a citation or a research finding; reuse is justified per component; every load-bearing decision names the alternative it beat. | Stream 4. |
| §22 unknowns that must be *tried* become spikes with a done-condition; a parked question names its spike | — | `/devx-walk` spike offer; Stream 4 record. |
| §23 surface loudly, gate precisely | Display counts every open blocker; execution refuses only the phase an entry names; a PRD-invalidating entry halts everything. | Stream 1. |
| §25 review is advisory and grounded in receipts; narration is never evidence | A finding without a file:line, command or grep is dropped. | Stream 2. |
| §26 vocabulary for browser checks | FAIL is evidence, BLOCKED is wiring, SPLIT is a flake, PASS needs every run to pass; never average, never retry until green. | `docs/QA.md` prose; `/devx-test`. |
| §27 the todo is display and memory, never policy | — | `gate-todo-isolation.test.ts`. |
| §28 WHAT not WHY; only what changes; no harness apparatus in the human render | IDs, gate names and § citations never reach a human page. | Stream 4 lint (apparatus leak is HARD upstream). |
| `COMMUNICATION.md` §6 when a PR comment becomes a decision record | Promote when it changes a locked expectation, sets precedent, resolves a listed open question, or a reviewer asks; never for nits. | Stream 3 address arm. |
| `FUTURE.md` §B.2 a gate that passes a mutant is a broken gate | Each incident that slipped a gate becomes a mutation case in the fix PR. | Stream 2 tests; `/devx-learn` outlet 1. |

Not worth copying: §5–§9, §10, §17, §30, §31's chip revision, the PM cheat
sheet, the seam registry — each solves a team, wiki or plugin-distribution
problem devx does not have.

---

## What this analysis did not cover

- **Upstream's live workstreams** under `docs/harness/active/` were not read
  beyond directory listings; their content is work-specific. Artifact shapes
  were taken from `_templates/` and the skills.
- **`_site/` and `_render/` were read, not run.** Sizes for D1 and D6 assume
  a TypeScript rewrite over existing devx readers, not a Python port.
- **Drift inside already-ported pieces.** Upstream edited `harness-walk`,
  `harness-revise`, `harness-review` and `harness-address-comments` around
  devx's 2026-09-01 fold: #40 and #46 landed days before it and are not in
  PR #146's port list, #68 and #75 landed after. Those edits are
  wording-level and were not diffed line by line; Streams 2 and 3 should
  skim the current upstream bodies before writing.
- **Sizes are estimates** from file counts and the shape of comparable
  devx PRs (`harness-fold-in` was five phases; PR #146 was +3,817 lines in
  one day). The prose budget is the likelier blocker than the code.
- **`FUTURE.md` §A.5 split/merge/nest** of workstreams: neither side has
  merge or nest; devx has `devx split` at the story level. Left out as a
  future item on both sides rather than a gap.
