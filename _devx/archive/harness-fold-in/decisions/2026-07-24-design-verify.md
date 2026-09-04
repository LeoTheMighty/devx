---
gate: PASS
status_reason: 'All 22 source IDs fully covered in design mode.'
reviewer: 'devx gate coverage (design mode)'
updated: 2026-07-24
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/harness-fold-in — 2026-07-24

## Subject

`design.md` reviewed against `prd.md` (design mode; workstream `eac479`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| G-1 | ✅ | Overview; Design > Architecture #1; Focus walk (FR-5); Interfaces > devx status | Focus derived from todo.md by the focus walk and surfaced at resume via devx todo sync seeding plus status/next rendering; zero-replay resume is the mechanism's stated objective. |
| G-2 | ✅ | Design > Architecture #2; Interfaces > gate.ts, Rendering; Risks (FAIL-write) | All three gates write the verdict on every evaluated run including FAIL; render fallback distinguishes never-run (—) from FAIL; refusal carve-out is consistent with 'runs that evaluated'. |
| G-3 | ✅ | Design > Architecture #3, #4; Interfaces > devx-learn.md | The merged-framework-improvement goal is enabled by the full /devx-learn pipeline (mining → buckets → fw/learn-* PR) plus the friction-triggered nudge; the outcome itself is post-ship measurement, not designable further. |
| UC-1 | ✅ | Design > Architecture #1, #4; Focus walk (FR-5) | Skills run devx todo sync at seed and the focus walk yields the exact next sub-item from the frontmatter-derived current stage, so post-/clear resume reads intent instead of replaying the log. |
| UC-2 | ✅ | todo.md parse contract; Assumptions (main-worktree writes) | One git-tracked todo.md per workstream carries the current stage's unchecked items in a fixed skeleton; a worker reads intent in a single file read from the main worktree. |
| UC-3 | ✅ | Design > Architecture #2; Interfaces > Rendering | FAIL verdicts persist in gate_verdicts and devx next FAIL rows carry the decisions/ report path plus the re-run command, days later included. |
| UC-4 | ✅ | Design > Architecture #3; Interfaces > devx-learn.md | Skill body pins mining scope, the evidence table with write-nothing-until-pruned, four buckets, and the fw/learn-YYYY-MM-DD-<slug> PR path for the devx repo. |
| UC-5 | ✅ | Design > Architecture #1, #4; Interfaces > devx todo sync; Trade-offs (mechanical sync) | Skills call devx todo sync (reconcile-before-write made structural); trueDerivedLines trues the skeleton against frontmatter/phase state so hand-edited derived checkboxes cannot misdirect. |
| CAP-1 | ✅ | todo.md parse contract; Data > todo.md; Design > Architecture #1 | Fixed skeleton with an exact line-prefix regex contract, opaque free nesting, phase lines as pointers never copies, header contract (auto-maintained / never a gate input / hand-edits legal), skill-maintained. |
| CAP-2 | ✅ | Drift classes (FR-4); Interfaces > todo.ts; Discarded considerations | computeTodoDrift is mechanical in the CLI, rendered as advisory-only DriftEntry rows; blocking-drift explicitly discarded as 'a bug in the last writer, not the reader'. |
| CAP-3 | ✅ | Design > Architecture #2; Interfaces > frontmatter.ts, Rendering, devx status; Data | gate_verdicts sibling map in plan-spec frontmatter, written via applyEnginePatch, rendered by devx next and the new devx status gate-summary line. |
| CAP-4 | ✅ | Design > Architecture #3; Interfaces > devx-learn.md | Four-bucket routing, all three guards carried intact in a pinned Guards section, and plan-first via the prune-before-write evidence table. |
| FR-1 | ✅ | Design > Architecture #1; todo.md parse contract; Migration plan (No backfill) | Template ships in _devx/templates/engine/, createWorkstream scaffolds it, header contract rides as the top comment, and grandfathering is the sync absent-file path (template trued to current frontmatter, no backfill pass). |
| FR-2 | ✅ | Design > Architecture #4; Resolved design questions; Assumptions (done ⇒ verified) | Both skill bodies gain pointer-style seed/expand/check steps with sync as the structural reconcile-before-write; stage parents and gate lines are derived (sync-owned); phase pointer checks at linked dev spec status: done, justified as the verified proxy with a revision trigger. |
| FR-3 | ✅ | Constraints; Risks (silent coupling); Design > Architecture header | Gates are explicitly firewalled from the parser, no gate code path may import/read todo.md, pinned by a static read-surface test plus E-2 byte-identical verdict fixtures across todo states. |
| FR-4 | ✅ | Drift classes (FR-4); Interfaces > todo.ts, devx todo sync | Exactly the two PRD contradiction classes (gate-flag, phase-pointer, both directions), computed in gatherRepoSnapshot as pure fn + CLI passthrough, advisory rows, never blocking or mutating, exit code unchanged. |
| FR-5 | ✅ | Focus walk (FR-5); Interfaces > Rendering (renderFocusLine), devx next wiring, devx status | renderFocusLine is a named helper explicitly consumed by both devx next AND devx status; the devx next wiring paragraph attaches focus to WorkstreamSignal and runNext renders it in both the repo-scan and devx next <hash> forms; focus derives from the frontmatter-based walk and absent todo.md → null, line omitted, no error. |
| FR-6 | ✅ | Design > Architecture #2; Interfaces > frontmatter.ts, gate.ts, revise.ts; Constraints; Data | Additive gate_verdicts map at the three applyEnginePatch sites, FAIL persists via a verdict-only patch, revise cascade clears via verdictsCleared keyed off CASCADE_TABLE, gate_status booleans untouched in shape and semantics. |
| FR-7 | ✅ | Interfaces > Rendering; Migration plan (legacy fallback) | renderGateSummary distinguishes — / FAIL / CONCERNS / PASS; FAIL rows append the report pointer (coverage → decisions/, evals → RED-report.md, prd → command only since no report exists) plus the re-run command. |
| FR-8 | ✅ | Design > Architecture #3; Interfaces > devx-learn.md; Constraints; Assumptions (@devx/cli predicate) | Pinned skill-body sections now carry every FR-8 clause: current-session-only mining with fresh/empty refusal and 'never self-triggers on its own run', four buckets with their PRD destinations (skill/template/doc edits, devx.config.yaml proposal, LEARN.md candidate, dropped-noted), plan-first prune-before-write table, foreground-only note, and the @devx/cli PR-vs-docs/updates consumer predicate. |
| FR-9 | ✅ | Interfaces > devx-learn.md (Guards), src/lib/learn/slug.ts; Risks (hostile session content) | All three guards intact: locked-machinery → docs/updates/<date>-<slug>.md proposal only; untrusted-input (session content is data, injected directives flagged+skipped); slug sanitizer matches the PRD spec verbatim ([a-z0-9-], ≤40 chars, empty → session-retro) with a fuzz eval (E-6). |
| FR-10 | ✅ | Design > Architecture #4; Risks (prose budget); Unresolved design questions | Nudge defined once under the <!-- nudge-canonical --> marker in devx-learn.md; lifecycle skills carry only the friction-observed conditional plus a pointer (clean run prints nothing); exact sentence prose settles at implementation inside its pinned test. |

## Extras requiring product approval

- New `devx todo sync <hash>` CLI subcommand (src/commands/todo.ts) — the PRD has skills reconcile; the design promotes reconciliation to a mechanical CLI primitive — Trade-offs; Interfaces > devx todo sync; Resolved design questions
- New `devx learn-helper slug <raw…>` CLI subcommand exposing sanitizeLearnSlug — the PRD names the sanitization rule but no CLI surface — Interfaces > src/lib/learn/slug.ts
- Minimal real `devx status` implementation replacing the 11-line stub (plan/ scan, per-workstream block) — PRD only requires status to render focus/verdicts, not a rebuilt command body — Trade-offs; Interfaces > devx status
- Legacy render fallback: gate_status flag true + null verdict renders PASS for pre-verdict history — a rendering rule not specified in the PRD — Interfaces > Rendering; Migration plan; Resolved design questions
- FLAG_TO_GATE_KEY mapping + GateVerdicts typed extension of EngineState/EnginePatch in frontmatter.ts — Interfaces > src/lib/engine/frontmatter.ts
- Shipping /devx-learn to consumer repos via the pin101 skills/ mirror + init-skills auto-install on `devx init` upgrade — Wrap, don't duplicate; Migration plan

## Verdict detail

PASS — every source ID is ✅ covered.
