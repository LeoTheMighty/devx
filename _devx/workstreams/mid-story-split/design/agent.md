# Design — Mid Story Split

<!-- Stage: Design. Gate: `devx gate coverage e0a67e` (design mode — one
     tri-state row per G-/UC-/CAP-/FR- ID in prd.md). No phases, no tasks —
     design is the approach, not the sequence. -->

## Overview

- **Objective**: Replace the conversation-state Handoff Snippet contract with
  a filesystem-native split: when a `/devx` session or `devx loop` item must
  stop with remaining work, the remainder becomes a first-class follow-up dev
  spec wired into the dependency tree — claimable cold by any fresh session,
  with zero human ferrying and zero state residue.
- **Solution**: One new library module (`src/lib/devx/split.ts`: pure
  composer + atomic I/O driver, the `emit-retro-story.ts` shape with the
  stricter `claim.ts` rollback posture) exposed two ways — a top-level
  `devx split <hash>` CLI for the interactive skill, and a direct library
  call from the loop driver. Two split shapes: **merge-first** (parent lands
  via the normal merge tail at reduced scope; follow-up is
  `Blocked-by: <parent>`) and **branch-handoff** (WIP branch pushed; parent
  closed as `superseded`; follow-up starts `ready` and inherits the branch).
  The loop gains a `split_request` field on `IterationReport` and a budget
  rail that splits instead of abandoning when there is real progress. The
  Handoff Snippet section, `parseHandoffSnippet`, its test, and its fixture
  are deleted; `/devx` Phase 9 routes early halts to `devx split`, pinned by
  a replacement prose test.

## Constraints

- **`skills/devx.md` is a byte-identical mirror of
  `.claude/commands/devx.md`** enforced by `test/skills-sync.test.ts` — every
  Phase 9 / Handoff Snippet edit lands in both files or CI fails.
- **`withBacklogLock` bodies must be synchronous**
  (`src/lib/backlog/mutate.ts:82`; the lock releases when `fn` returns — a
  returned Promise escapes the critical section). The split write path is
  sync-only, like `claimSpec`'s interior.
- **`commitOnMain` pathspec is limited to exactly two files**
  (`src/lib/loop/driver.ts:973`, BH-MED-5) — the loop split path must extend
  it to include the new follow-up spec file (FR-8).
- **`setBacklogRowState` is typed `"ready" | "in-progress" | "blocked"`**
  (`src/lib/loop/spec-io.ts:215`) — the superseded parent row is written by
  the split module's own row rewriter, not by widening that union.
- **An unknown `Status:` token silently degrades to `ready`**
  (`normalizeStatus`, `src/lib/backlog/parse.ts:236` → checkbox fallback) —
  the design introduces **no new status token** for exactly this reason.
- **Workers never write specs or backlogs** (`src/lib/loop/iteration.ts`
  design rule) — a worker *requests* a split in its report; only the driver
  performs it.
- **`validateIterationReport` returns a fresh trimmed object**
  (`src/lib/loop/iteration.ts:92`) — `split_request` must be explicitly
  copied through or it is silently dropped.
- **Status logs and LEARN.md entries are append-only/historical** — LEARN
  rows citing dvx107 are amended with a retirement pointer, never rewritten;
  shipped specs and `_bmad-output/` are untouched (E-2's historical-archive
  allowlist).
- **On successful claim the spec lock stays held** (`claim.ts:872-876`); the
  only production release path is `releaseSpecLock`
  (`src/lib/loop/driver.ts:1002`) — split must release it on both shapes'
  loop paths and instruct release on the interactive path.

## Risks

- **Torn multi-file write** (spec + backlog + parent spec) → adopt
  `claimSpec`'s capture-originals / restore-on-partial-rename posture
  (`claim.ts:648-691`), all under `withBacklogLock` → proven by E-1
  (injected rename failure leaves DEV.md byte-identical).
- **Ownership stomp** (the E13 resume-collision shape: a stale session splits
  a live peer's item) → `performSplit` runs the roc101 ownership guard first
  (`verifyClaim` decision table, `src/lib/devx/verify-claim.ts:198`;
  `ownsClaim` posture in the driver at `driver.ts:896-904`) and refuses with
  a distinct exit code → proven by E-1 (ownership-mismatch refusal).
- **New-vocabulary livelock** (dependents of a split parent stuck blocked, or
  a superseded row routed as ready) → reuse `superseded`, which already
  exists in `SpecStatus` (`parse.ts:30-36`), `normalizeStatus`, the
  struck-row parse path (`parse.ts:186-190`), and both settled-blocker
  allowlists (`src/lib/next/gather.ts:254-260`,
  `src/lib/manage/reconcile.ts:466-472`) — zero parser changes → proven by
  E-5 (fresh-claim + zero drift on both shapes).
- **`split` outcome feeding the abandonment ladder** → route it through the
  `afterItemCompleted` arm (`src/lib/loop/ladder.ts:307`) in the driver's
  rail at `driver.ts:650-671` → proven by E-3 (streak remains 0 after a
  split).
- **Snippet surface resurrection** (a doc or skill edit re-instructing the
  snippet) → grep-zero eval runs as a standing artifact, not a one-shot →
  proven by E-2.
- **Malformed worker split request wedging an item** → request validation is
  independent of report validation; a bad request degrades to a logged
  validation error and the iteration loop continues → proven by E-4.
- **Split failure mid-loop stranding an item in no-man's-land** → the loop's
  split path falls back to today's `abandonItem` on any thrown split error,
  so the worst case is exactly the status quo → covered by E-3's
  zero-progress branch plus a dedicated fallback test (plan stage).

## Trade-offs

- **Reuse `superseded` over a new `split`/`handed-off` status token**: a new
  token needs 13 coherent call sites (parse unions, spec-io regexes,
  claim/gather/reconcile allowlists) and silently degrades to `ready`
  anywhere missed; `superseded` costs zero parser changes. The follow-up's
  `from:` + the parent's `superseded by <hash>` strike text carry the
  lineage. [User decision, 2026-07-28]
- **Top-level `devx split` over `devx devx-helper split`**: it is a
  first-class lifecycle operation a user may run by hand (like `merge-gate`,
  `revise`, `outcome`), not claim-internal plumbing. [User decision,
  2026-07-28]
- **JSON payload file over CLI flags**: remaining ACs and carried-forward
  context are multi-line lists; flags can't carry them legibly. `--payload
  <path>` mirrors `devx gate coverage --table <path>` (subagent writes a
  file, CLI validates it).
- **Claim rollback posture over retro partial-commit posture**:
  `writeRetroAtomically` commits partial renames and warns
  (`emit-retro-story.ts:374-427`, locked decision #7); E-1 demands 0 changed
  bytes on failure, so split restores originals like `claim.ts:662-691`.
- **Driver calls the library, not the CLI**: the loop is already in-process
  with `withBacklogLock` re-entrancy and injected fs/exec seams; a subprocess
  would serialize JSON across a process boundary for nothing.
- **Follow-up rows are `[ ]` + `Status: ready` + `Blocked-by:` (retro-row
  pattern, `emit-retro-story.ts:150`) rather than `[-]` blocked**: the
  dispatcher's `blockersResolved` (`gather.ts:254`) already gates
  claimability on blocker state; a `[-]` row would need a manual flip after
  the parent merges.
- **The budget rail always splits branch-handoff, never merge-first**
  (resolving UC-3's "merges if green" arm): at exhaustion the driver has no
  green signal — the worker never reported `acs_met`, the driver runs no
  tests, and CI only runs on an open PR. Attempting the merge tail on
  work no agent has judged coherent would ship unreviewed partials on a
  guess. The merge-if-green arm therefore lives exclusively on the
  worker-requested path, where the worker has attested the committed
  portion is a clean seam. UC-3's "or" is satisfied by the branch-handoff
  arm; nothing green is ever left unmerged by this choice, because a green
  clean seam is exactly when workers are instructed to request a split.

## Out of scope

- Everything in PRD Non-goals: no `done-pending-verification` state, no
  healing of pre-existing `blocked`+dead-owner rows (`db36af` / `devx
  doctor` owns that), no multi-way splits, no planning-stage splits, no
  `stop_after` semantic changes.
- **No dead-owner spec-lock reaper.** Spec locks have no PID-liveness probe
  today (`gather.ts:416-432` treats a foreign lock as a warning, not drift);
  split doesn't add one — it only guarantees its own writes leave no
  orphaned lock.
- **No `blocked-on-human` cleanup.** `ItemOutcome` declares a never-produced
  member (`report.ts:27-34`); out of scope here.

## Assumptions

- This repo's single-branch posture (`git.integration_branch: null`) —
  branch names come from `deriveBranch`
  (`src/lib/plan/derive-branch.ts:49`), which already handles the split-user
  configs; revision trigger if the branching model changes.
- **mlc103 (spec-lock lifecycle) — re-checked at plan stage 2026-07-28,
  assumption resolved.** mlc103 merged (PR #94): the lock body is now JSON
  v1 (`composeSpecLockBody`, `src/lib/devx/spec-lock.ts:81`), release is
  `releaseSpecLockGuarded` (`spec-lock.ts:417`) with ownership probe
  `specLockOwnedBy` (`spec-lock.ts:462`), and the driver's
  `releaseSpecLock` closure (`driver.ts:1042`) wraps the guarded release.
  `parseLockOwner` / `normalizeSessionToken` (`verify-claim.ts:141,126`)
  survive and parse the JSON body — split's ownership guard and release
  paths target these mlc103 primitives, not a hand-parsed 3-line body.
- Old loop workers against a new driver are safe: `validateIterationReport`
  ignores extra keys by design (`iteration.ts:84-91`), and a worker that
  never emits `split_request` simply never triggers the request path.
- A follow-up spec is always the same type as its parent (`dev` → `dev`,
  `debug` → `debug`); `CLAIMABLE_TYPES = ["dev","debug"]` (`claim.ts:256`)
  bounds what can be split.

## Discarded considerations

- **Calling `devx split` as a subprocess from the driver** — pointless
  process boundary; the driver already holds the seams (see Trade-offs).
- **Carrying the session token in the follow-up spec** — the whole point of
  the split model is that a fresh session performs a *fresh claim* with its
  own token; persisting tokens re-creates the E13 copy-the-token hazard the
  roc101 check exists to kill. `devx.md:110`'s "or a Handoff Snippet that
  carries it" clause is deleted, not re-homed.
- **A new checkbox glyph for superseded** — the struck-row path
  (`parse.ts:167-168, 186-190`) already classifies `~~…~~` +
  `/superseded/i` without one.
- **Keeping a `parseHandoffSnippet`-style prose validator for the split
  payload** — the payload is JSON validated by the CLI itself; there is no
  conversation prose left to parse. The prose that *does* need pinning
  (Phase 9's routing) is pinned by the replacement skill-body test.
- **Encoding the ".5" identity in the hash** (e.g. `mlc103b`) — hashes stay
  strictly-legal 6-char `[a-z0-9]`; lineage lives in `from:` +
  `spawned:` + the slug convention (`…-continued` suffix). The
  `emitRetroStory` prefix-derivation trick (`<prefix>ret`) doesn't
  generalize to repeated splits.
- **Splitting on `exitInProgress`** (signal / `--until` / total-token
  stops) — those preserve claim+lock+worktree precisely so the next run
  resumes the same claim (`driver.ts:1356-1393`); a split there would
  create a ready row whose live worktree wedges the next claim's
  `git worktree add -b` (the EC-HIGH-2 shape at `driver.ts:1306-1311`).
  [User decision, 2026-07-28]

## Wrap, don't duplicate

- **Reuses:**
  - `insertDevMdRow` + `parseParentsFromDevMdRow`
    (`src/lib/plan/emit-retro-story.ts:449,528`) — generalized: `type`
    parameter (today hardcodes `` `dev/ `` in `rowRe`, line 504) and an
    insert-after-parent-row anchor (the parent row always exists for a
    split, unlike retro emission).
  - `formatTimestamps` (`emit-retro-story.ts:219`) — local-TZ iso +
    minute-precision filename stamp.
  - `withBacklogLock` (`src/lib/backlog/mutate.ts:82`) — one hold around
    the whole split transaction.
  - `verifyClaim` internals (`normalizeSessionToken`, `parseLockOwner`,
    `verify-claim.ts:125,139`) for the ownership guard; exit-code
    conventions from `src/commands/devx-helper.ts` (3 =
    owned-by-other-session).
  - `claimSpec`'s atomic-rename rollback pattern (`claim.ts:632-691`) —
    tmp tag shape, capture-originals, restore-on-partial.
  - `generateHash` (`src/lib/engine/workstream.ts:179`) — exported and
    generalized: collision scan widened from `plan/` to all
    `SPEC_TYPE_DIRS` (`src/lib/engine/frontmatter.ts:428-469`).
  - `deriveBranch` (`src/lib/plan/derive-branch.ts:49`) for the follow-up's
    own branch field in the merge-first shape.
  - Driver seams: `releaseSpecLock`, `commitOnMain`, `pushMain`,
    `appendMainEntry`, `setSpecStatus`, `backlogLockBestEffort`
    (`driver.ts:854-1052`); `pushCurrentBranch` (`git-tx.ts:187`) for the
    branch-handoff push.
  - Progress oracles: `iterationsGood` counters +
    `isBookkeepingOnlyWorktree` (`git-tx.ts:288`) + `diffStat`
    (`git-tx.ts:317`) — no new progress detection.
  - Ladder: `afterItemCompleted` (`ladder.ts:307`) — `split` joins the
    completion arm; no ladder changes.
  - Prose-pin pattern: the `phase9Body()` extractor
    (`test/devx-handoff-snippet.test.ts:91-98`, including its load-bearing
    `^(### |## )` bound) moves into the replacement test; verbatim-CLI-line
    pinning per `test/devx-skill-phase1-resume.test.ts` (roc101).
  - Workstream lineage vocabulary: `supersededBy`/`successor`
    (`frontmatter.ts:117-120`) — the same field names, applied at dev-spec
    level.
- **Adds (genuinely new):**
  - `src/lib/devx/split.ts` — `SplitPayload` schema + `composeSplit` (pure)
    + `writeSplitAtomically` + `performSplit`.
  - `src/commands/split.ts` — the `devx split` CLI.
  - `split_request` on `IterationReport` + its `OUTPUT_FIELD_LINES` /
    prompt contract lines.
  - Driver `splitItem()` terminal helper + budget-rail predicate + `split`
    member across `ItemOutcome`/report/events.
  - Claim-side branch inheritance (honor a `branch:` frontmatter field on
    claim; worktree attaches to the existing branch instead of `-b`).
  - `test/devx-split.test.ts`, `test/devx-skill-phase9-split.test.ts`,
    eval `evals/E-2_snippet-grep-zero.ts`.

## Design

### Architecture

Five components, one direction of data flow (payload → composer → atomic
writer → bookkeeping):

1. **`src/lib/devx/split.ts`** (library, no I/O in the composer):
   - `SplitPayload` — validated JSON: `title` (single-line, non-empty, no
     `;` or `\n` — the Next-command block title rules), `goal?`,
     `remaining_acs: string[]` (non-empty), `carried_forward:
     { state_to_trust: string[], gotchas: string[], do_not: string[] }`,
     `learnings?: string[]`.
   - `composeSplit(opts)` — pure. Inputs: parent spec
     `{path, content}`, backlog content, payload, `shape:
     "merge-first" | "branch-handoff"`, fresh hash, `now`, branch fields.
     Outputs: follow-up spec path + body, patched parent spec content,
     patched backlog content. Follow-up frontmatter: `hash`, `type` (=
     parent's), `created`, `title`, `from: <parent spec path>`, `status:
     ready`, then per shape — merge-first: `blocked_by: [<parent>]` +
     `branch: <deriveBranch(type, hash)>`; branch-handoff: `branch:
     <parent's WIP branch>` (inherited, no `blocked_by`). Body: `## Goal`,
     `## Acceptance criteria` (the remaining ACs), `## Carried forward`
     with `### State to trust` / `### Gotchas (save time — don't
     rediscover)` / `### Do NOT` (FR-2 — the snippet's sections re-homed),
     `## Status log` seeded `— created by devx split from <parent>`.
     Parent patches: append follow-up hash to `spawned:`, append status-log
     line; merge-first additionally nothing else (parent stays
     `in-progress`, `owner:` retained until merge); branch-handoff: `status:
     superseded`, `superseded_by: <hash>`, `owner:` cleared. Backlog
     patches: new row spliced directly after the parent's row; merge-first
     row `- [ ] `<path>` — <TITLE>. Status: ready. Blocked-by: <parent>.`;
     branch-handoff additionally rewrites the parent row struck:
     `~~…~~ superseded by <hash>`.
   - `writeSplitAtomically` — claim posture: write `.tmp.<tag>` siblings,
     capture originals, rename in fixed order (follow-up spec → parent
     spec → backlog), restore all landed renames on any failure, unlink
     tmps. Runs inside the caller's `withBacklogLock` hold (sync body).
   - `performSplit` — orchestration: ownership guard (lock exists + token
     matches, via the `verifyClaim` primitives) → fresh hash
     (`generateHash` widened) → compose → locked atomic write → result
     `{followUpHash, followUpSpecPath, devMdRow, shape}`.
2. **`src/commands/split.ts`** — `devx split <hash> --payload <file>
   --session-token <tok> [--shape merge-first|branch-handoff]`. Default
   shape: `merge-first`. No `--type` flag: the parent's type is resolved
   from where the spec file lives (`findSpecForHashAnyType`,
   `src/lib/engine/frontmatter.ts:428-469`), and the follow-up always
   inherits it — one less flag to get wrong. Branch-handoff requires the
   WIP branch to be pushed first (the skill instructs it; the CLI verifies
   `git ls-remote --heads origin <branch>` is non-empty and refuses
   otherwise — FR-4/FR-8 "no worktree preserved without a recorded
   pointer"). Exit codes (devx-helper conventions): 0 success (JSON result
   on stdout), 3 ownership mismatch, 1 backlog-lock contention, 2 any other
   failure, 64 usage. The interactive skill releases the parent's spec lock
   itself in the branch-handoff shape (Phase 9 instruction); merge-first
   keeps the lock until normal Phase 8 cleanup.
3. **Loop driver** (`src/lib/loop/driver.ts`):
   - `splitItem(reason, payload)` — new terminal helper beside
     `abandonItem` (1191): ownership guard → `pushCurrentBranch` →
     `performSplit(shape: "branch-handoff")` with the payload assembled
     from `failureNotes` + accumulated `key_learnings` + worktree status
     log → `releaseSpecLock` → `commitOnMain` with pathspec extended to
     `[parent spec, backlog, follow-up spec]` (the FR-8 extension:
     `commitOnMain` gains an `extraPaths` parameter) → `pushMain`. Any
     thrown error → fall back to `abandonItem(reason)` (status-quo floor).
     Result `{outcome: "split", followUpSpecPath, leftState: "ready"}`.
   - **Budget rail** (1408-1417): at iteration/token exhaustion, predicate
     `good >= 1 && !isBookkeepingOnlyWorktree(exec, worktree, baseSha)` →
     `splitItem`; else today's `abandonItem` verbatim (E-3's zero-progress
     branch).
   - **Worker-request path**: after a good iteration whose report carries a
     valid `split_request` (and `acs_met: false`), the driver treats the
     committed portion as complete-at-reduced-scope: runs the normal
     `completeItem()` merge tail, and on the merged branch performs
     `performSplit(shape: "merge-first")` (follow-up `Blocked-by:` parent
     is immediately satisfied by the merge) before `finalizeMerged`'s
     bookkeeping; on a handed-off tail the follow-up is still filed
     (blocked until the PR lands) and the outcome remains `handed-off`.
     Malformed `split_request` → `iteration:split-request-invalid` event +
     WARN, request ignored, loop continues (E-4).
   - **Rail wiring** (650-671): `outcome === "split"` joins the
     `afterItemCompleted` arm.
4. **`src/lib/loop/iteration.ts` + report/events**:
   - `IterationReport.split_request?: { title: string, remaining_acs:
     string[], learnings?: string[] }` — optional; validated only when
     present (own error path, never fails the whole report); explicitly
     copied in `validateIterationReport`'s return.
   - `OUTPUT_FIELD_LINES` (+ prompt instruction): request a split only at a
     clean seam — committed, coherent, tests green on the done portion —
     when remaining ACs need more room than the budget allows.
   - `ItemOutcome` gains `"split"` (`report.ts:27-34`) + `OUTCOME_LABEL`,
     `counts`, `nextSteps` ("split → follow-up ready: `/devx <hash>`"),
     `itemSection` renders the follow-up spec path. `ItemResult` gains
     `followUpSpecPath?`.
   - Events: `item:split`, `item:split-fallback` (split failed → abandoned),
     `iteration:split-request-invalid`.
5. **Skill + docs sweep** (FR-7, both `.claude/commands/devx.md` and
   `skills/devx.md`):
   - Phase 9 bridge line (417) → "If you halt early for any reason …: run
     `devx split <hash> --payload <file> --session-token <token>`
     (merge-first if your work is coherent+green — land it through Phases
     5–8 first; branch-handoff otherwise — push the WIP branch, split, then
     release the spec lock), say one sentence on why you stopped, and
     stop." `## Handoff Snippet` section (419-466) deleted.
   - `devx.md:110`: drop the snippet clause — token sources become "the
     claim performed earlier in this same session" only.
   - Delete `src/lib/devx/handoff-snippet.ts`,
     `test/devx-handoff-snippet.test.ts`,
     `test/fixtures/handoff-snippet-realistic.md`; fix the dangling comment
     in `test/devx-skill-phase1-resume.test.ts:22`.
   - New `test/devx-skill-phase9-split.test.ts`: `phase9Body()` extractor
     reused verbatim (with its `^(### |## )` bound — Phase 9 remains the
     last `###`), pins the `devx split` invocation string verbatim (roc101
     pattern), pins the merge-first/branch-handoff routing sentences, and
     asserts zero `Handoff Snippet` tokens in the skill body.
   - Cross-refs: `v2/03-review-tour.md:90` exemplar → repoint at the new
     test; `v2/05-dispatcher.md` row set gains the follow-up-claim row (or
     an explicit note that a follow-up is an ordinary ready row — it is);
     `docs/HOW_TO_USE.md` loop prose ("abandoned…wreckage") gains the split
     outcome; CLAUDE.md dvx107 mention annotated "(retired by
     mid-story-split)"; LEARN.md E12 + shape-(c) rows amended with a
     pointer to `test/devx-skill-phase9-split.test.ts` as the successor
     exemplar (append-only amendment).
   - `docs/ROADMAP.md:43`, `docs/DESIGN.md:324,918`, `README.md:38` become
     *true* — cited as prior art, not edited.

### Interfaces

- `devx split <hash>` — flags `--payload <file>` (required), `--session-token
  <tok>` (required; same omission-auto-derive semantics as `verify-claim` do
  NOT apply — split always requires the explicit token, because auto-derive
  would always mismatch and split must never guess), `--shape
  merge-first|branch-handoff` (default merge-first). Stdout: one-line JSON
  `{followUpHash, followUpSpecPath, devMdRow, shape}`. Exit 0/1/2/3/64 as
  above.
- `performSplit(opts: PerformSplitOpts): PerformSplitResult` — the seam the
  driver calls; fs/exec injectable like `claimSpec`.
- `composeSplit`, `SplitPayload`, `validateSplitPayload` — exported for the
  driver and tests.
- `validateIterationReport` — unchanged signature; `split_request` passes
  through when valid, is stripped with a validation error surfaced when not.
- `claimSpec` — behavior extension: when the spec's frontmatter carries
  `branch:` naming an existing remote/local branch, the claim uses it
  (worktree attaches without `-b`; base = that branch) instead of deriving a
  fresh one. This is a general claim-path change, but it is demanded by the
  PRD surface: expectations E-5 requires "claim … with the recorded branch
  inheritance honored", and FR-4 requires the follow-up to record the WIP
  branch — recording it is useless unless claim consumes it. Specs without
  `branch:` (all existing specs) take the derive path unchanged.

### Data

No new stores. New/changed file shapes:

- Follow-up spec file (`dev/…` or `debug/…`) — frontmatter + `## Carried
  forward` contract above.
- Parent spec — `spawned:` append; branch-handoff adds `superseded_by:` and
  `status: superseded`.
- `DEV.md`/`DEBUG.md` — one new row per split; branch-handoff strikes the
  parent row with `superseded by <hash>`.
- `.devx-cache/loop/<run>/events.jsonl` — three new event names (string
  literals at call sites, per existing convention).
- `.devx-cache/loop/<run>/report.md` — `split` outcome section.

## Migration plan

No flag day. Ordering constraint only (phases cut at Plan stage): (1) the
primitive (library + CLI + tests) lands first and is inert — nothing calls
it; (2) loop integration lands second — old workers keep working (extra
report keys ignored; absent `split_request` just never triggers); (3) the
skill/docs sweep + deletions land last, and only then does E-2's grep-zero
hold. Until (3) merges, the snippet contract remains live and valid — the
two contracts never overlap ambiguously because Phase 9 routes to exactly
one of them at any commit. Rollback at any boundary is a revert of that
phase's PR.

## Resolved design questions

- CLI surface → **top-level `devx split <hash>`** [user, 2026-07-28].
- Parent terminal vocabulary (branch-handoff) → **reuse `superseded`**
  (struck row + `status: superseded` + `superseded_by:`; zero parser
  changes) [user, 2026-07-28].
- Should `exitInProgress` split? → **No** — it preserves claim+worktree for
  same-claim resume by design; splitting there wedges the next claim
  [user, 2026-07-28].
- LEARN.md exemplar replacement for the dvx107 test-only-lock rows →
  **`test/devx-skill-phase9-split.test.ts`** becomes the pattern's second
  instance (satisfying E12's pending-concordance); rows amended
  append-only.
- Payload channel → JSON file via `--payload` (multi-line ACs; mirrors
  `gate coverage --table`).
- Fresh-hash strategy → export + widen `generateHash` (collision scan
  across all `SPEC_TYPE_DIRS`, not just `plan/`).

## Unresolved design questions

- Exact prompt wording for the worker's "clean seam" heuristic (when to
  request a split vs. keep iterating) — Plan/RED stage detail; does not
  block Gate 2 (no P0 depends on the wording, E-4 pins the mechanics).
- Whether `devx doctor` (db36af) should learn to detect a
  `superseded`-parent whose follow-up spec is missing (crash between phases
  of a *manual* split attempt outside the primitive) — file as an
  INTERVIEW/backlog note for db36af; the primitive itself is atomic so this
  can only arise from hand-editing.
