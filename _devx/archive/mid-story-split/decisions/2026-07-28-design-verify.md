---
gate: PASS
status_reason: 'All 20 source IDs fully covered in design mode.'
reviewer: 'devx gate coverage (design mode)'
updated: 2026-07-28
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/mid-story-split — 2026-07-28

## Subject

`design.md` reviewed against `prd.md` (design mode; workstream `e0a67e`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| G-1 | ✅ | design.md § Architecture #5 (Skill + docs sweep) + § Migration plan + § Risks (snippet resurrection) | Concrete deletion list (handoff-snippet.ts, test, fixture), Phase 9 rewired to `devx split`, replacement test named (test/devx-skill-phase9-split.test.ts), E-2 grep-zero kept as a standing eval; migration phase (3) is the point at which grep-zero holds. |
| G-2 | ✅ | design.md § Architecture #3 (Budget rail, driver.ts:1408-1417) + #4 (ItemOutcome 'split') | Predicate `good >= 1 && !isBookkeepingOnlyWorktree` → splitItem; `split` joins the afterItemCompleted arm; report.md gains a split outcome section, so G-2's measurement source is wired. |
| G-3 | ✅ | design.md § Architecture #1-3 + § Constraints (lock release) + § Risks (torn write, E-5) | Named mechanisms per residue class: releaseSpecLock on loop paths + interactive Phase 9 release instruction, owner cleared/retained per shape, commitOnMain extraPaths for the new spec, reuse of `superseded` (zero status-vocab drift), E-5 pins zero drift. |
| UC-1 | ✅ | design.md § Architecture #2 (devx split CLI) + #5 (Phase 9 bridge line) + § Interfaces (claimSpec branch inheritance) | Payload-file CLI, Phase 9 routing prose quoted, follow-up is an ordinary ready row for `devx next`; carried-forward contract removes snippet ferrying. |
| UC-2 | ✅ | design.md § Architecture #3 (Worker-request path) + #4 (split_request schema) | Driver runs the normal completeItem merge tail then performSplit(merge-first) before finalizeMerged; handed-off tail still files the follow-up; run continues via the normal completion path. |
| UC-3 | ✅ | design.md § Architecture #3 (Budget rail + splitItem) + § Trade-offs ('budget rail always splits branch-handoff') | The merge-if-green arm is now explicitly resolved: no green signal exists at rail time (no acs_met, no driver tests, CI only on open PRs), so the merge arm lives exclusively on the worker-attested request path; UC-3's 'or' is satisfied by branch-handoff. Coherent, concrete resolution. |
| UC-4 | ✅ | design.md § Architecture #1 (## Carried forward body) + § Interfaces (claimSpec branch: inheritance) + § Discarded (no session token) | Spec body carries state-to-trust/gotchas/do-NOT; branch pointer consumed at claim (worktree attaches without -b); token deliberately NOT carried — fresh claim, consistent with roc101. |
| CAP-1 | ✅ | design.md § Architecture #1 (src/lib/devx/split.ts) | composeSplit (pure) + writeSplitAtomically (claim rollback posture, capture-originals) + performSplit, one withBacklogLock hold, sync body per the mutate.ts:82 constraint. |
| CAP-2 | ✅ | design.md § Architecture #1 (follow-up body: ## Carried forward) | Exact section headings specified (State to trust / Gotchas / Do NOT), seeded status log, SplitPayload schema carries the fields. |
| CAP-3 | ✅ | design.md § Architecture #3-#4 | split_request on IterationReport (explicit copy-through per the fresh-object constraint), two driver paths (request + rail), `split` outcome routed to afterItemCompleted so the abandonment streak is untouched. |
| CAP-4 | ✅ | design.md § Architecture #5 + § Constraints (skills/devx.md mirror) | Itemized sweep: Phase 9 bridge, devx.md:110 token clause, dispatcher row, HOW_TO_USE, review-tour exemplar, LEARN.md append-only amendments, CLAUDE.md annotation; byte-identical skills-mirror constraint named. |
| CAP-5 | ✅ | design.md § Architecture #1-#3 + § Risks (ownership stomp) | verifyClaim-based guard first in performSplit (exit 3), lock release per shape, owner clearing on supersede, `git ls-remote` push verification before branch-handoff, commitOnMain extraPaths. |
| FR-1 | ✅ | design.md § Architecture #1-#2 + § Wrap (generateHash widened, insertDevMdRow generalized) | All of (a)-(e) have named mechanisms incl. exit code 3 and the fresh-hash collision scan across SPEC_TYPE_DIRS; parent type resolved via findSpecForHashAnyType (no --type flag). FR-1's 'status: ready or blocked per shape' resolves as always-`[ ]`+ready with Blocked-by (Trade-offs row explains why not `[-]`) — a justified deviation, worth acknowledging at gate. |
| FR-2 | ✅ | design.md § Architecture #1 (SplitPayload + body contract) + #3 (loop populates from failureNotes + key_learnings) | Composer emits the sections; driver assembles the payload from accumulated iteration state; E-5 pins fresh-claim-with-no-outside-data. |
| FR-3 | ✅ | design.md § Architecture #1 (merge-first frontmatter/row) + #3 (worker-request path) + #5 (Phase 9 routing) | Parent lands via the normal merge tail, status-log line appended by composeSplit, follow-up Blocked-by parent with a fresh deriveBranch branch (no inheritance), owner retained until merge. |
| FR-4 | ✅ | design.md § Architecture #1-#2 + § Resolved design questions (reuse `superseded`) + § Interfaces (claimSpec) | Branch pushed + verified via ls-remote, follow-up inherits `branch:` and claimSpec now consumes it (justified against E-5 'recorded branch inheritance honored' + FR-4 — recording is useless unless claim consumes it), parent `status: superseded` + `superseded_by:` + struck DEV.md row with zero parser changes; exactly one claimable continuation. |
| FR-5 | ✅ | design.md § Architecture #4 + § Interfaces (validateIterationReport) | Optional field with independent validation (bad request → WARN event, loop continues), driver-only writes preserved, OUTPUT_FIELD_LINES contract named; exact 'clean seam' prompt wording deferred to Plan/RED (flagged, non-blocking). |
| FR-6 | ✅ | design.md § Architecture #3 (Budget rail, Rail wiring 650-671) + #4 (report/events) | Iteration AND token exhaustion covered, afterItemAbandoned never fires for split (completion arm), item:split event, report renders the follow-up path, zero-progress branch abandons verbatim; thrown-error fallback to abandonItem is a status-quo floor. |
| FR-7 | ✅ | design.md § Architecture #5 | Every FR-7 cross-reference individually addressed incl. the dangling comment in devx-skill-phase1-resume.test.ts:22 and the phase9Body() extractor reuse with its `^(### \|## )` bound; LEARN rows amended append-only per constraint. |
| FR-8 | ✅ | design.md § Architecture #1-#3 + § Constraints (commitOnMain 2-file pathspec) + § Risks (E-5) | Lock release on both loop shapes + interactive instruction, owner per shape, ls-remote pointer guarantee, commitOnMain extraPaths extension named against its BH-MED-5 constraint, devx next row-8 eligibility via an ordinary ready row. Interactive lock release is skill-prose-instructed rather than structural — acceptable but weaker than the loop path. |

## Extras requiring product approval

- item:split-fallback event + splitItem's fall-back-to-abandonItem path — new failure semantics not named in the PRD (benign: a status-quo floor when the split itself throws mid-loop) — design.md § Architecture #3 (splitItem) + #4 (Events) + § Risks (split failure mid-loop)
- worker-request split on a handed-off merge tail (follow-up filed blocked, outcome stays `handed-off`) — a shape combination the PRD's UC-2/FR-5 do not enumerate — design.md § Architecture #3 (Worker-request path)

## Verdict detail

PASS — every source ID is ✅ covered.
