# PRD — Mid Story Split

<!-- Stage: PRD. Gate: `devx gate prd <hash>`. Every concrete item gets a
     stable ID (G-/UC-/CAP-/FR-). IDs are never renumbered. Traceability is
     by ID, not by prose. -->

## Problem

When a `/devx` session must stop before its work completes — context budget,
quality risk, blocker, usage pressure — the current contract (`devx.md` Phase
9 + the Handoff Snippet section, dvx107) has the agent emit a prose snippet
into the *conversation* and stop. The snippet is conversation-only state: it
is lost on `/clear` unless the user manually copies it, it carries facts the
filesystem should own (branch state, gotchas, even the claim session token per
`devx.md:110` — which the current template doesn't actually have a field for),
and it requires a human to ferry it into the next session. This contradicts
the system's own design docs: `docs/ROADMAP.md:43` and `docs/DESIGN.md:324`
both state that context rot triggers a fresh invocation against the spec file
— "no continuation snippet." The snippet is attended-era glue (LEARN.md
cross-epic: "attended-era contracts break on first unattended contact").

The loop side has the same hole in a different shape: when `devx loop`
exhausts an item's iteration budget it abandons the item (`blocked` +
preserved worktree), even when the item is effectively done — hfi102 was
abandoned "8 iterations without acs_met" with all 5 ACs implemented, costing
an interactive revival. There is no mechanism, in either the interactive skill
or the loop, to convert "remaining work" into a first-class backlog artifact:
a follow-up dev spec wired into the dependency tree that any fresh session —
interactive `/devx` or the overnight loop — can claim cold, with no
rediscovery and no human ferrying state.

The fix: replace the emit-a-snippet contract with **split-the-story** — file
the remainder as a follow-up spec (a ".5 story": fresh 6-char hash, `from:`
the original, `Blocked-by:` wiring in DEV.md) via a CLI primitive, leaving
every piece of resume state on the filesystem where the engine already keeps
ground truth.

## Goals

<!-- User goals in prose; business/project goals MUST be numeric + dated so
     /devx outcome can score them later. -->

- **G-1**: Zero Handoff Snippet surface by 2026-08-15 — `grep -ri "handoff snippet" .claude/commands/ src/ test/` returns 0 matches (the section, the `parseHandoffSnippet` module, its 21-test pin, and the fixture are all gone or replaced by split-contract equivalents).
- **G-2**: By 2026-09-01, the next loop item that exhausts its iteration budget with ≥1 good iteration and real file changes ends as outcome `split` (follow-up spec + DEV.md row on main), not `abandoned`+`blocked` — measured from `.devx-cache/loop/*/report.md`: 0 abandoned-with-progress items after ship.
- **G-3**: Splits leave zero state residue by 2026-09-01 — every split performed (interactive or loop) is followed by a `devx next` run reporting 0 new drift entries attributable to the split (no dead owners, no orphaned locks, no status-vocab mismatch on the parent or the follow-up row).

## Non-goals

- **A `done-pending-verification` terminal state** (LEARN.md § harness-fold-in E4) — the split mechanism subsumes the hfi102 case; we don't also build a second terminal state for it.
- **Healing historical abandoned items** — `db36af` (`devx doctor`) owns residue reconciliation for pre-existing `blocked`+dead-owner rows; this workstream only guarantees new splits are clean.
- **Multi-way splits** — one follow-up spec per split event. A follow-up can itself split later (chain, not fan-out).
- **Planning-stage context management** — `/devx-plan` already has per-stage artifacts + `/clear`-between-stages; its recommendation prose stays. This workstream is about dev/debug story execution.
- **Changing `stop_after` semantics** — stopping between items (clean boundary, nothing in flight) still just stops; a split only exists when there is an in-flight item with remaining work.

## Users

- **Primary**: `/devx` execute-arm sessions (interactive) and the `devx loop` driver — the two writers of split state; plus the fresh session (either kind) that later claims the follow-up cold.
- **Secondary**: the user reading morning reports / `devx next` output, who should see "split → follow-up ready" instead of "abandoned → blocked, go dig through a preserved worktree".
- **Anti-persona**: planning-stage workstreams (plan specs advance by stage gates, not splits); items with zero real progress (those still abandon — a split of nothing is noise in the dep tree).

## Use cases

- **UC-1**: An interactive `/devx` session nearing its context budget mid-implementation runs the split primitive: remaining ACs + carried-forward context land in a follow-up spec wired into DEV.md, the session stops clean, the user `/clear`s and `/devx next` picks up the follow-up with zero rediscovery and no snippet ferrying.
- **UC-2**: A loop worker reaches a clean seam mid-budget and requests a split in its iteration report; the driver lands the completed portion through the normal merge tail, files the follow-up spec, and the run continues to the next item.
- **UC-3**: The loop's iteration budget exhausts on an item with ≥1 good iteration and real changes (the hfi102 shape): the driver splits instead of abandoning — completed work merges if green (merge-first) or the WIP branch is pushed and recorded (branch-handoff), and the remainder becomes a ready/blocked follow-up row instead of a wedged `blocked` item.
- **UC-4**: A fresh session claims a follow-up spec cold: the spec body carries everything the old snippet carried (state to trust, gotchas, do-NOT list), plus the branch/worktree pointer when work was handed off unmerged — no conversation-history dependency.

## Capabilities

- **CAP-1**: A split CLI primitive (pure composer + atomic I/O driver, `emit-retro-story.ts` shape) that writes the follow-up spec + splices the DEV.md row + updates the parent's frontmatter/status log in one backlog-locked transaction.
- **CAP-2**: A carried-forward-context contract in the follow-up spec body — the Handoff Snippet's sections re-homed to the filesystem.
- **CAP-3**: Loop integration — iteration-report schema extension (worker requests a split) + driver split paths (worker-requested and budget-rail) + a `split` item outcome that does not feed the systemic-abandonment streak.
- **CAP-4**: Skill-body + docs sweep — `/devx` Phase 9 rewired to the split primitive, the Handoff Snippet section deleted, resume-branch/session-token prose reconciled, dispatcher/HOW_TO_USE/LEARN.md-exemplar references updated so no surface instructs emitting a snippet again.
- **CAP-5**: State-hygiene invariants — claim-ownership guard before any split write, lock release + owner clearing on the parent, branch push on handoff, main-commit pathspec that includes the new spec file.

## Feature requirements

### FR-1: Split primitive

A `devx` CLI subcommand (exact name settled at design) that, given the in-flight spec's hash and the remaining-work payload, atomically: (a) creates `dev/dev-<fresh-hash>-<ts>-<slug>.md` with `from:` pointing at the parent spec, `status: ready` or `blocked` per shape, and a Carried-forward section (FR-2); (b) splices a DEV.md row into the parent's epic section with correct `Status:`/`Blocked-by:` text; (c) appends the split entry to the parent's status log and updates parent frontmatter per shape (FR-3/FR-4); (d) runs entirely under `withBacklogLock` with tmp+rename writes; (e) refuses with a distinct exit code when the caller does not own the parent's claim (roc101 posture). A follow-up hash is a fresh legal 6-char hash — the ".5" identity is carried by `from:` + slug convention, never by the hash itself.

### FR-2: Carried-forward context contract

The follow-up spec body contains, in addition to Goal/ACs (the remaining work), a structured section carrying: state to trust (branch, worktree, pushed/unpushed, mode), gotchas/learnings from the parent session (loop: `key_learnings` accumulated across iterations), and a do-NOT list. Testable: the composer emits these sections; the loop driver populates them from iteration reports; a fresh `devx next` → claim of the follow-up requires no data outside the repo.

### FR-3: Merge-first shape

When the completed portion is coherent and green, the parent lands through the normal PR/CI/merge tail with a status-log line recording the reduced scope; parent goes `done`; the follow-up is `Blocked-by: <parent>` (immediately ready once the parent merges). The follow-up starts from `main` with no branch inheritance.

### FR-4: Branch-handoff shape

When the in-flight work is not mergeable, the WIP branch is committed + pushed, the follow-up spec records `branch: feat/dev-<parent-hash>` (or the worktree pointer) and starts `ready`; the parent spec is closed out as superseded-by-follow-up (exact terminal vocabulary settled at design) so exactly one claimable continuation exists and the parent can never be independently re-claimed.

### FR-5: Loop worker split request

`IterationReport` gains an optional split-request field (remaining-work title + ACs + learnings). Workers still never write specs or backlogs — the driver validates the request and performs the split. Prompt contract (`OUTPUT_FIELD_LINES`) documents when to request one.

### FR-6: Loop budget rail

At `maxIterationsPerItem` exhaustion (and per-item token exhaustion) with ≥1 good iteration and real file changes, the driver splits instead of abandoning. Outcome `split` is a completion for the abandonment ladder (`afterItemAbandoned` never fires for it), appears in the morning report with the follow-up spec path, and emits its own lifecycle event. Zero-progress exhaustion still abandons exactly as today.

### FR-7: Handoff Snippet retirement

The `## Handoff Snippet` section and the Phase 9 bridge line are removed from `.claude/commands/devx.md`; Phase 9 routes early halts to the split primitive (+ a one-line stop message). `src/lib/devx/handoff-snippet.ts`, `test/devx-handoff-snippet.test.ts`, and the fixture are deleted; a replacement test pins the new Phase 9 split contract (the dvx107 test-only-lock pattern applied to the new prose). All cross-references reconciled: `devx.md:110` session-token prose, `v2/05-dispatcher.md` row 5, `docs/HOW_TO_USE.md` resume/abandon prose, `v2/03-review-tour.md:90` exemplar, LEARN.md shape-(c) exemplar rows (amended, not rewritten — status logs and LEARN entries are append-only/historical), CLAUDE.md historical mentions annotated.

### FR-8: State hygiene

After any split: the parent's spec lock is released, `owner:` handled per shape (cleared on supersede; retained-until-merge on merge-first), no worktree is preserved without a recorded pointer, the main-worktree commit includes the new spec + DEV.md + parent spec in its pathspec, and `devx next` immediately reflects the follow-up (row 8 eligible when ready) with zero new drift entries.

## Evals seed

<!-- Raw material for expectations.md — behaviors worth pinning, thresholds
     worth measuring. Promoted into E-blocks before Gate 1. -->

- Split primitive round-trip: run split on a fixture repo → follow-up spec exists at the composed path, DEV.md row parses (`parseBacklog`) with correct blocked_by, parent bookkeeping correct, all-or-nothing on injected rename failure → threshold: dedicated test file green.
- Grep-zero snippet: no `Handoff Snippet` / `parseHandoffSnippet` tokens outside historical archives (LEARN.md/specs/_bmad-output) → threshold: 0 matches.
- Loop budget rail: driver test — budget exhaustion with good iterations → outcome `split`, streak untouched, report names follow-up → threshold: test green; the old abandon test now asserts the zero-progress branch only.
- Fresh-claim viability: `devx next` on a post-split fixture picks the follow-up; claim succeeds; no drift entries → threshold: test green.
- Worker request path: iteration report with split-request validates; malformed request rejected without wedging the item → threshold: test green.

## Open questions

- Parent terminal vocabulary in the branch-handoff shape (`superseded` strike vs a new status token — affects `parse.ts` status precedence) — owner: design stage.
- Should `exitInProgress` (signal / `--until` / total-token stops) also split? Leaning no — those preserve claim+worktree for the next run's resume path by design — owner: design stage.
- Replacement exemplar for LEARN.md's promoted "test-only-lock (dvx107)" cross-epic rows once `parseHandoffSnippet` is deleted — owner: design stage.

## Reference links

- Spec: `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md`
- Prior art (aligned direction): `docs/ROADMAP.md:43`, `docs/DESIGN.md:324` — "no continuation snippet"
- Surfaces being replaced: `.claude/commands/devx.md` Phase 9 + `## Handoff Snippet` (419–466); `src/lib/devx/handoff-snippet.ts`; `test/devx-handoff-snippet.test.ts`; `test/fixtures/handoff-snippet-realistic.md`
- Motivating incident: `dev/dev-hfi102-2026-07-24T10:41-gate-verdict-persistence.md` status log + `_devx/workstreams/harness-fold-in/RETRO-2026-07-26.md` findings 2/4/5; LEARN.md § harness-fold-in E2/E4
- Reusable kernel: `src/lib/plan/emit-retro-story.ts` (composer + `writeRetroAtomically` + `insertDevMdRow`); `src/lib/backlog/mutate.ts` (mlc102 lock); `src/lib/loop/driver.ts` terminal paths (1191–1414); `src/lib/loop/iteration.ts` report schema
- Adjacent in-flight: mlc103 (spec-lock lifecycle), mlc106 (loop scoping flags), lpf101 (loop preflight), db36af (`devx doctor`)
