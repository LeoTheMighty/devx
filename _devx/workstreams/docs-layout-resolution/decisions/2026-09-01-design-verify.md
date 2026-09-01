---
gate: PASS
status_reason: 'All 23 source IDs fully covered in design mode.'
reviewer: 'devx gate coverage (design mode)'
updated: 2026-09-01
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/docs-layout-resolution — 2026-09-01

## Subject

`design/agent.md` reviewed against `prd/agent.md` (design mode; workstream `a494be`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| G-1 | ✅ | Closing the remaining bypasses; The artifact map; Threading the layout through EngineConfig | All eight surfaces are now reached — the four gates via the blast-radius table (gate.ts/gate-prd.ts/gate-coverage.ts) plus 'the gate's subject resolution is the only thing that branches', `next` via the row-selection and row-reason bullets, `todo sync` via todo.ts:86 + todo-truth.ts:49, `revise` via the CASCADE_TABLE re-key, and `outcome` via a dedicated bullet naming outcome.ts:314/332 and the :492 `${ws.workstreamRel}/RESULTS.md` hand-join (all three verified verbatim in the real code). |
| G-2 | ✅ | Threading the layout through EngineConfig; Wrap, don't duplicate; PRD corrections routed through devx revise | Collapses to one reading function (`resolveDocsLayout`, with `docsLayoutFrom` demoted to a non-reading wrapper), deletes gather.ts:1160's `docsLayoutUnset` rather than fixing it, kills the duplicate `DocsLayout` type at init-questions.ts:58, and corrects the orphan baseline from 2 to 15 — independently verified: exactly 15 artifacts.ts exports have zero non-artifacts.ts src callers. |
| G-3 | ✅ | Migration plan; `devx layout migrate` | Gives the exact ClassyLights sequence (clean tree → --dry-run → real run → gate_status/gate_verdicts diff empty → `devx gate coverage b7e38f`), and explains the zero-lost-verdicts property structurally: only the plan spec's `workstream:` field is rewritten because gate state lives in the spec, not the tree. |
| G-4 | ✅ | Correcting the two false doc claims | Both surfaces named (docs/CONFIG.md §15 rule 5, _devx/config-schema.json:939) with the specific rewrite, plus E-8's three mechanical assertions so the claims stay test-asserted rather than prose-reviewed. |
| UC-1 | ✅ | Layout-aware scaffolding; Risks | Diagnoses the live blocker the PRD missed — createWorkstream's adoption throw when the workstream dir exists and no spec claims it (verified at workstream.ts:270-274), which under project-level is the always-existing repo root — and fixes it by changing the probe from 'directory exists' to 'doc set present', plus optional slug and the `workstream: .` spec field. |
| UC-2 | ✅ | Constraints; Risks; Layout-aware workstream resolution | Rule 5 is held by construction: only subject resolution branches, gate bodies receive an already-resolved path and cannot see the layout, and E-1 tests 8 layout×gate combinations for verdict identity on byte-identical content. |
| UC-3 | ✅ | Closing the remaining bypasses (devx next row selection / row reasons) | Round-2's gap is closed: row *selection* is now addressed at gather.ts:972-975 and next.ts:292-295 (both verified — `fs.exists(prdAbs(wsAbs))` etc.), with the concrete failure mode stated ('PRD not yet authored' forever), and the six reason strings at engine/next.ts:115-155 (verified) moved onto `subject.rel`. |
| UC-4 | ✅ | `devx layout migrate`; Trade-offs; Discarded considerations | Pure `planLayoutMigration()` producing a `MovePlan` that is either rendered or executed, so --dry-run is non-destructive by construction; three refusals computed before any move; `git mv --` with per-call exitCode checks; config written last with the rationale corrected (revertibility, not agreement). |
| UC-5 | ✅ | Closing the remaining bypasses; Layout-aware workstream resolution; Guard discrimination | todo sync (todo.ts:86 + todo-truth.ts:49), revise (CASCADE_TABLE re-key at revise.ts:37-64 + cascadeFor reverse lookup) and outcome (:314/:332/:492) are all now explicit; `devx status` is never named by name but is reached by the shared mechanism (planFilenameWorkstreamRel signature change + render.ts:119/124 onto subject.rel — its only artifact reads, decisionsDirAbs/redReportAbs, are layout-identical spellings). |
| UC-6 | ✅ | Correcting the two false doc claims | Both reader-facing surfaces rewritten, §15 gains the `devx layout migrate` answer to 'what does switching cost', and the table restructure is stated honestly rather than as a two-row addition. |
| CAP-1 | ✅ | The artifact map | `ArtifactKind` union + `stageSubject(layout, base, kind) -> {rel, abs}` with all 13 rows spelled out for both layouts, and the `evals` asymmetry disarmed by narrowing `agent` to `SubjectStage` so `{kind:'agent',stage:'evals'}` is unrepresentable. |
| CAP-2 | ✅ | Layout-aware workstream resolution | resolveWorkstream returns `.`/repoRoot under project-level; planFilenameWorkstreamRel changes signature to take EngineConfig (four call sites verified: workstream.ts:471,678, status.ts:117, gather.ts:858); resolveSpecWorkstream's now-dead path-in-from arm is named and reasoned rather than silently left. |
| CAP-3 | ✅ | Layout-aware scaffolding | Three named branches — the doc-set probe replacing the directory probe, the template list at workstream.ts:343-347 replaced by iteration over ArtifactKinds (verified), and the layout-conditional slug argument — plus the triple-coupling (created shape / template array / noop conjunction) it relieves. |
| CAP-4 | ✅ | `devx layout migrate`; Risks | Refusals are a pure predicate over repo state computed before any git mv, the dirty-tree check reuses outline.ts:435-464's porcelain parse with -uall and core.quotePath=false, and the interrupted-run residue is made detectable by a new `layout-tree-mismatch` doctor finding rather than assumed away. |
| CAP-5 | ✅ | Correcting the two false doc claims | Both wrong surfaces rewritten with a stated no-schema-version-bump rationale (the enum's value space is unchanged). |
| FR-1 | ✅ | The artifact map | Every artifact kind FR-1 enumerates has a row (three stage subjects, human digests, outline and outline-critique companions, expectations, todo, evals/, RED-report, decisions/, checkpoints/, RESULTS.md), both `rel` and `abs` are returned with the reason, and the orphaned project*Rel helpers are wrapped rather than replaced as FR-1 asks. |
| FR-2 | ✅ | Threading the layout through EngineConfig | Adds the field and catches a real ordering trap independently verified in config.ts:34-40 — engineConfigFrom early-returns on a missing `engine:` block before any read, so a legacy-only `personalization['docs.layout']` repo would silently lose its layout unless the assignment precedes both guards; the PRD's 'five callers' is also corrected to the real seven. |
| FR-3 | ✅ | Layout-aware workstream resolution | One branch in resolveWorkstream, `join(repoRoot, '.')` making the existence check pass without a special case, the filename fallback gated by signature change rather than by four remembered guards, and resolveSpecWorkstream given the same treatment with its dead membership arm reasoned. |
| FR-4 | ✅ | Layout-aware scaffolding | Template list, slug optionality and the doc-set probe all specified; SCAFFOLD_SUBDIRS land at the repo root per the recorded owner decision; the lay101 predicate consumption (or a local stand-in deleted on adoption) is stated in Out of scope. |
| FR-5 | ✅ | Closing the remaining bypasses; PRD corrections routed through devx revise | All four PRD sites answered plus two the PRD missed (todo-truth.ts:49, outcome.ts:492), backfill correctly recategorized from hand-join to broken enumeration at :312-318 (verified), the shadowing local `todoAbs` names called out, and todo.ts:94 correctly excluded as a false positive; the structural claim is honestly downgraded to compiler-primary with a documented accepted-fragile scan residue. |
| FR-6 | ✅ | Guard discrimination | All three sites discriminated on layout, with the revise.ts trap explained in full (swapping STAGE_SHORTHAND's target breaks cascadeFor outright because CASCADE_TABLE is keyed on the *_REL constants — verified at revise.ts:44-104), resolved one level up by re-keying the table on ArtifactKind; detect.ts's hardcoded root is fixed as a named scope widening. |
| FR-7 | ✅ | `devx layout migrate` | Command shape, exit codes, MovePlan type, the three refusals, git mv with `--` and argv-smuggling posture, spec-field-only frontmatter rewrite, and the setLeaf config step are all specified; the outline-moving decision is carried with its reasoning. |
| FR-8 | ✅ | Correcting the two false doc claims (The artifact table is restructured, not merely extended) | Round-2's mis-grounding is fully corrected: the design now states the real §15 table has 12 rows in a different shape (design's outline and critique share a row, plan's share another, no design-human/plan-human rows, no RED-report row) — independently verified against docs/CONFIG.md — and that the target is 13 rows one-per-ArtifactKind, explicitly noting that 'gains two rows' plus a set-equality test would have shipped an unpassable test. |

## Extras requiring product approval

- none

## Verdict detail

PASS — every source ID is ✅ covered.
