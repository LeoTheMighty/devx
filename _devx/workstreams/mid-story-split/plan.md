# Plan — Mid Story Split

<!-- Stage: Plan. Gate: `devx gate coverage e0a67e` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. Default to
     more, smaller phases. One phase ≙ one dev spec ≙ one PR ≙ one tour. -->

## Current state

- Early halts hand off via conversation prose: `.claude/commands/devx.md`
  Phase 9 bridge line (~417) + `## Handoff Snippet` section (419–466),
  byte-mirrored in `skills/devx.md` (enforced by `test/skills-sync.test.ts`),
  validated by `src/lib/devx/handoff-snippet.ts` +
  `test/devx-handoff-snippet.test.ts` +
  `test/fixtures/handoff-snippet-realistic.md`. The human ferries the
  snippet between sessions.
- The loop abandons budget-exhausted items even with real progress
  (`abandonItem`, `src/lib/loop/driver.ts:1252`): worktree preserved, row
  flipped `ready`, morning report says "abandoned" — carried context dies
  with the run.
- No split primitive exists: remaining work has no first-class spec;
  `spawned:`/`from:` lineage exists in frontmatter but nothing composes a
  follow-up from a mid-flight parent.
- Spec locks post-mlc103 (PR #94): JSON v1 body, `acquireSpecLock` /
  `classifySpecLock` / `releaseSpecLockGuarded` / `specLockOwnedBy` in
  `src/lib/devx/spec-lock.ts`; `parseLockOwner` / `normalizeSessionToken`
  (`src/lib/devx/verify-claim.ts:141,126`) parse the JSON body.

## Desired state

- `src/lib/devx/split.ts` (SplitPayload + `composeSplit` +
  `writeSplitAtomically` + `performSplit`) and a top-level `devx split
  <hash> --payload <file> --session-token <tok> [--shape
  merge-first|branch-handoff]` CLI: atomic follow-up spec + backlog row +
  parent bookkeeping in both shapes, ownership-guarded, 0-byte residue on
  any mid-transaction failure.
- `claimSpec` honors a `branch:` frontmatter field — worktree attaches to
  the recorded branch instead of `-b`-creating a fresh one, so
  branch-handoff follow-ups are claimable cold by any session.
- The loop splits instead of abandoning: worker-requested merge-first
  splits at clean seams (`split_request` on `IterationReport`), budget-rail
  branch-handoff splits when real progress exists, `split` outcome through
  `afterItemCompleted` (streak untouched), fallback to today's
  `abandonItem` on any split failure.
- The Handoff Snippet contract is fully retired: prose section, parser,
  test, and fixture deleted; Phase 9 routes early halts to `devx split`;
  `test/devx-skill-phase9-split.test.ts` pins the replacement prose; the
  E-2 grep-zero eval stands as a permanent artifact.

## What we're NOT doing

(Scope fence — design § Out of scope; anything below appearing in a diff is
an extra requiring product approval.)

- No `done-pending-verification` state; no `stop_after` semantic changes.
- No healing of pre-existing `blocked`+dead-owner rows and no dead-owner
  spec-lock reaper beyond what mlc103 already ships (`db36af` / `devx
  doctor` owns diagnosis).
- No multi-way splits, no planning-stage splits, no split on
  `exitInProgress` (preserves same-claim resume by design — user decision
  2026-07-28).
- No new status token (reuse `superseded`); no `blocked-on-human` cleanup.
- No edits to shipped specs, LEARN.md history rewrites, or `_bmad-output/`
  (append-only amendments only).

## Expectation coverage

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 1 | tests-first | `_devx/workstreams/mid-story-split/evals/E-1_split-roundtrip.ts` | full |
| E-2 | P0 | 4 | tests-first | `_devx/workstreams/mid-story-split/evals/E-2_snippet-grep-zero.ts` | full |
| E-3 | P0 | 3 | tests-first | `_devx/workstreams/mid-story-split/evals/E-3_budget-rail-split.ts` | full |
| E-4 | P1 | 3 | tests-first | `_devx/workstreams/mid-story-split/evals/E-4_worker-requested-split.ts` | full |
| E-5 | P1 | 2 | tests-first | `_devx/workstreams/mid-story-split/evals/E-5_fresh-claim-viability.ts` | full |

RED-stage note (revised 2026-07-28 at RED, `devx revise --touched plan.md`
cascade): the original table pinned in-suite `test/*.test.ts` files as the
RED artifacts, which cannot satisfy the RED gate without breaking CI — a
failing vitest file inside the default `test/**/*.test.ts` glob reds `npm
test` on main and every phase PR from the RED commit until its phase ships
(phase 1's PR could never merge with the E-5 block red in its own suite).
Retargeted to standalone `evals/` wrapper scripts per the harness-fold-in
precedent: each wrapper runs under the `workstream-evals` tsx runner
(outside the default suite), probes the missing feature directly via
dynamic import + behavior assertions, and asserts the permanent in-suite
case group exists — failing NOW with named missing-feature reasons
(right-reason RED), exiting 0 only when the phase's feature and its
permanent tests are both in place. The permanent case groups still land in
`test/devx-split.test.ts` (E-1 phase 1, E-5 phase 2),
`test/loop-driver.test.ts` (E-3), and `test/loop-iteration.test.ts` (E-4)
— authored by their phases, discoverable by the wrappers via pinned
describe-title markers `"E-1:"`, `"E-3:"`, `"E-4:"`, `"E-5:"`. Each
phase's tests-first re-run is its eval wrapper: watch it fail, then drive
it green by shipping the feature + case group.

## Phase checklist

- [ ] Phase 1: Split primitive (lib + CLI)
- [ ] Phase 2: Claim branch inheritance
- [ ] Phase 3: Loop split integration
- [ ] Phase 4: Handoff Snippet retirement sweep

Dependency order: 1 → {2, 3} → 4. Phases 2 and 3 are parallel-safe with
each other (no shared files; both depend only on phase 1's exports).
Ordering constraint from design § Migration plan: the primitive lands
inert, loop integration second, deletions last — until phase 4 merges the
snippet contract remains live, and Phase 9 routes to exactly one contract
at any commit.

## Phases

### 1. Phase: Split primitive (lib + CLI)

**Overview**: The inert kernel — nothing calls it until phases 2–4. Pure
composer + atomic writer + orchestrator + CLI. Lands first so both
consumers (claim inheritance, loop) build against a merged, tested seam.

**Files**:
- `src/lib/devx/split.ts` (new) — `SplitPayload` + `validateSplitPayload`
  (title single-line, no `;`/`\n`; `remaining_acs` non-empty;
  `carried_forward.{state_to_trust,gotchas,do_not}`), `composeSplit`
  (pure; both shapes; follow-up frontmatter/body per design § Architecture
  1; parent `spawned:` append + status-log line; backlog row splice
  after-parent; branch-handoff strikes parent row `superseded by <hash>`),
  `writeSplitAtomically` (claim posture: tmp siblings, capture originals,
  fixed rename order follow-up → parent → backlog, restore-on-partial),
  `performSplit` (ownership guard → fresh hash → compose → locked atomic
  write).
- `src/commands/split.ts` (new) — `devx split <hash>` CLI; exit codes 0
  success / 1 backlog-lock contention / 2 other / 3 ownership mismatch /
  64 usage; `--shape branch-handoff` refuses unless `git ls-remote --heads
  origin <branch>` is non-empty.
- `src/cli.ts` — register the command.
- `src/lib/engine/workstream.ts` — export `generateHash`; widen collision
  scan from `plan/` to all `SPEC_TYPE_DIRS`
  (`src/lib/engine/frontmatter.ts:428-469`).
- `src/lib/plan/emit-retro-story.ts` — generalize `insertDevMdRow`
  (`type` param replacing the hardcoded `` `dev/ `` in `rowRe:504`) +
  insert-after-parent-row anchor; reuse `formatTimestamps` (:219).
- `test/devx-split.test.ts` — E-1 case group goes green.

**Context**:
- Rollback posture: `claimSpec`'s capture-originals / restore-on-partial
  (`src/lib/devx/claim.ts:632-691`); `withBacklogLock` body must stay
  synchronous (`src/lib/backlog/mutate.ts:82`).
- Ownership guard: `specLockOwnedBy` (`src/lib/devx/spec-lock.ts:462`) +
  `parseLockOwner`/`normalizeSessionToken` (`verify-claim.ts:141,126`);
  exit-code convention 3 = owned-by-other-session
  (`src/commands/devx-helper.ts`).
- `--session-token` is always explicit for split — no auto-derive
  (design § Interfaces: auto-derive would always mismatch; split must
  never guess).
- `superseded` vocabulary is parser-free reuse: `SpecStatus`
  (`src/lib/backlog/parse.ts:30-36`), struck-row path
  (`parse.ts:186-190`), settled-blocker allowlists
  (`src/lib/next/gather.ts:254-260`,
  `src/lib/manage/reconcile.ts:466-472`).
- Row shape: retro-row pattern (`emit-retro-story.ts:150`); follow-up
  branch field via `deriveBranch` (`src/lib/plan/derive-branch.ts:49`)
  in the merge-first shape.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-1 threshold met: ≥6 cases green, 0 failures — merge-first round-trip
    via `parseBacklog` (blocked-by wiring), branch-handoff round-trip
    (branch recorded, parent row struck + `status: superseded`), injected
    rename failure leaves DEV.md byte-identical (0 changed bytes),
    ownership-mismatch refusal exits 3, all carried-forward section
    headings present.
  - `evals/E-1_split-roundtrip.ts` exits 0 (feature probes + `"E-1:"` case
    group present in `test/devx-split.test.ts`).
  - `npm test` (typecheck included) green; the E-5 eval wrapper remains
    RED (feature lands in phase 2).

**Tasks**:
- [ ] T1.1 `SplitPayload` + `validateSplitPayload` — files: `src/lib/devx/split.ts`
- [ ] T1.2 `composeSplit`: follow-up spec compose + parent patch + backlog patch, both shapes — files: `src/lib/devx/split.ts`
- [ ] T1.3 `writeSplitAtomically` with claim rollback posture — files: `src/lib/devx/split.ts`
- [ ] T1.4 `performSplit`: ownership guard + `generateHash` export/widen — files: `src/lib/devx/split.ts`, `src/lib/engine/workstream.ts`
- [ ] T1.5 Generalize `insertDevMdRow` (type param + after-parent anchor) — files: `src/lib/plan/emit-retro-story.ts`
- [ ] T1.6 `devx split` CLI + registration + branch-handoff ls-remote refusal — files: `src/commands/split.ts`, `src/cli.ts`
- [ ] T1.7 Re-run `evals/E-1_split-roundtrip.ts`, watch it fail, drive green (author the `"E-1:"` case group) — files: `test/devx-split.test.ts`

### 2. Phase: Claim branch inheritance

**Overview**: `claimSpec` honors a `branch:` frontmatter field naming an
existing branch — worktree attaches without `-b`, base resolves to that
branch. This is the only general claim-path change; isolated in its own PR
so its blast radius (every future claim) gets its own tour. Specs without
`branch:` (all existing specs) take the derive path unchanged. Depends on
phase 1 (fixtures are built by `performSplit`); parallel-safe with phase 3.

**Files**:
- `src/lib/devx/claim.ts` — branch-inheritance arm around the
  derive/worktree-add sequence (worktree add at ~:907; `-b` only on the
  derive path).
- `test/devx-split.test.ts` — E-5 case group goes green (dispatch pick,
  claim inheritance, drift = 0 on both shapes' fixtures).

**Context**:
- `parseSpecClaimFields` (`verify-claim.ts:158`) is the existing
  frontmatter-field reader on the claim path — extend the same parse, do
  not add a second frontmatter parser.
- Dispatcher needs no change: follow-up rows are ordinary `[ ]` +
  `Status: ready` + `Blocked-by:` rows; `blockersResolved`
  (`src/lib/next/gather.ts:254`) already gates claimability — E-5 asserts
  this with zero `gather.ts` edits.
- Drift assertion: `devx next` gather must report 0 split-attributable
  drift entries on post-split fixtures.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-5 threshold met: dispatch + claim tests green on both merge-first
    and branch-handoff fixtures; recorded branch honored (attach, not
    `-b`); drift assertion count = 0.
  - `evals/E-5_fresh-claim-viability.ts` exits 0 (feature probes + `"E-5:"`
    case group present in `test/devx-split.test.ts`).
  - Existing claim tests untouched and green (derive path unchanged).

**Tasks**:
- [ ] T2.1 Read `branch:` via `parseSpecClaimFields` extension — files: `src/lib/devx/verify-claim.ts`, `src/lib/devx/claim.ts`
- [ ] T2.2 Worktree attach (no `-b`) + base resolution when `branch:` names an existing branch — files: `src/lib/devx/claim.ts`
- [ ] T2.3 Re-run `evals/E-5_fresh-claim-viability.ts`, watch it fail, drive green (author the `"E-5:"` case group incl. drift = 0 + row-8 dispatch assertions) — files: `test/devx-split.test.ts`

### 3. Phase: Loop split integration

**Overview**: The loop's two split paths — worker-requested merge-first at
a clean seam, budget-rail branch-handoff on real progress — plus `split`
as a first-class outcome. Any thrown split error falls back to today's
`abandonItem` verbatim (status-quo floor). Depends on phase 1;
parallel-safe with phase 2.

**Files**:
- `src/lib/loop/iteration.ts` — `IterationReport.split_request?`
  validation (own error path; never fails the whole report), explicit
  copy-through in `validateIterationReport` (:92 returns a fresh trimmed
  object — silent-drop hazard), `OUTPUT_FIELD_LINES` (:314) + prompt
  clean-seam instruction (request a split only when committed, coherent,
  green on the done portion).
- `src/lib/loop/report.ts` — `ItemOutcome` gains `"split"` (:27-34),
  `OUTCOME_LABEL` (:133), `counts` (:237), `nextSteps` ("split →
  follow-up ready: `/devx <hash>`"), `itemSection` renders follow-up
  path; `ItemResult.followUpSpecPath?`.
- `src/lib/loop/driver.ts` — `splitItem(reason, payload)` beside
  `abandonItem` (:1252): ownership guard → `pushCurrentBranch`
  (`git-tx.ts:187`) → `performSplit(shape: "branch-handoff")` →
  `releaseSpecLock` closure (:1042, wraps `releaseSpecLockGuarded`) →
  `commitOnMain` (:1013) with new `extraPaths` param → `pushMain`;
  budget-rail predicate at exhaustion (:1469): `good >= 1 &&
  !isBookkeepingOnlyWorktree` → `splitItem`, else `abandonItem` verbatim;
  worker-request path in the `completeItem` tail (:1817): valid
  `split_request` + `acs_met: false` → normal merge tail then
  `performSplit(shape: "merge-first")` before `finalizeMerged`
  bookkeeping (handed-off tail: follow-up still filed, outcome stays
  `handed-off`); rail wiring: `outcome === "split"` joins
  `afterItemCompleted` (:715).
- `src/lib/loop/ladder.ts` — verify-only: `afterItemCompleted` (:307)
  already resets the streak; no change expected.
- `test/loop-driver.test.ts` — E-3 case group + split-failure fallback
  test; `test/loop-iteration.test.ts` — E-4 case group.

**Context**:
- Workers never write specs/backlogs (`iteration.ts` design rule) — the
  driver performs every split.
- Malformed `split_request` → `iteration:split-request-invalid` event +
  WARN, request ignored, iteration loop continues (E-4).
- Budget rail always splits branch-handoff, never merge-first — at
  exhaustion the driver has no green signal (design § Trade-offs, UC-3
  resolution).
- New events (string literals at call sites, per convention):
  `item:split`, `item:split-fallback`, `iteration:split-request-invalid`.
- Progress oracles reused, none added: `iterationsGood` counters,
  `isBookkeepingOnlyWorktree` (`git-tx.ts:288`), `diffStat`
  (`git-tx.ts:317`).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-3 threshold met: ≥3 cases green — real progress → outcome `split`
    (follow-up spec + row committed on main, report names the path),
    bookkeeping-only worktree → abandon path byte-identical to today,
    abandonment streak remains 0 after a split.
  - E-4 threshold met: ≥3 cases green — well-formed request → exactly 1
    driver-side split; malformed → 1 validation error + 0 spec/backlog
    writes; iteration counter advances and item not terminated.
  - `evals/E-3_budget-rail-split.ts` + `evals/E-4_worker-requested-split.ts`
    exit 0 (feature probes + `"E-3:"` / `"E-4:"` case groups present in
    `test/loop-driver.test.ts` / `test/loop-iteration.test.ts`).
  - Dedicated fallback test: `performSplit` throws → item lands exactly
    where `abandonItem` puts it today.

**Tasks**:
- [ ] T3.1 `split_request` validation + explicit copy-through — files: `src/lib/loop/iteration.ts`
- [ ] T3.2 `OUTPUT_FIELD_LINES` + clean-seam prompt wording — files: `src/lib/loop/iteration.ts`
- [ ] T3.3 `split` outcome across report/label/counts/nextSteps/itemSection — files: `src/lib/loop/report.ts`
- [ ] T3.4 `splitItem` terminal helper + `commitOnMain` `extraPaths` + abandon fallback — files: `src/lib/loop/driver.ts`
- [ ] T3.5 Budget-rail predicate at exhaustion — files: `src/lib/loop/driver.ts`
- [ ] T3.6 Worker-request merge-first path in the merge tail — files: `src/lib/loop/driver.ts`
- [ ] T3.7 Events + rail wiring into `afterItemCompleted` — files: `src/lib/loop/driver.ts`
- [ ] T3.8 Re-run `evals/E-3_budget-rail-split.ts` + `evals/E-4_worker-requested-split.ts`, watch them fail, drive green (author the `"E-3:"` / `"E-4:"` case groups) + fallback test — files: `test/loop-driver.test.ts`, `test/loop-iteration.test.ts`

### 4. Phase: Handoff Snippet retirement sweep

**Overview**: Only after both consumers exist does the snippet die. From
this merge on, E-2's grep-zero invariant holds permanently. Depends on
phases 2 and 3.

**Files**:
- `.claude/commands/devx.md` + `skills/devx.md` (byte-identical pair —
  `test/skills-sync.test.ts`) — Phase 9 bridge line (~:417) rewritten to
  route early halts to `devx split <hash> --payload <file>
  --session-token <token>` (merge-first if coherent+green — land through
  Phases 5–8 first; branch-handoff otherwise — push WIP branch, split,
  release the spec lock); `## Handoff Snippet` section (419-466) deleted;
  `devx.md:110` token-source clause drops "or a Handoff Snippet that
  carries it".
- Delete `src/lib/devx/handoff-snippet.ts`,
  `test/devx-handoff-snippet.test.ts`,
  `test/fixtures/handoff-snippet-realistic.md`; fix the dangling
  reference in `test/devx-skill-phase1-resume.test.ts:22`.
- `test/devx-skill-phase9-split.test.ts` (new) — `phase9Body()` extractor
  moved verbatim (keep the load-bearing `^(### |## )` bound), pins the
  `devx split` invocation string verbatim (roc101 pattern), pins the
  merge-first/branch-handoff routing sentences, asserts zero `Handoff
  Snippet` tokens in the skill body.
- `_devx/workstreams/mid-story-split/evals/E-2_snippet-grep-zero.ts` —
  authored at RED; exits 0 only from this phase's merge on.
- Cross-refs: `v2/03-review-tour.md:90` exemplar → repoint at the new
  test; `v2/05-dispatcher.md` note that a follow-up is an ordinary ready
  row; `docs/HOW_TO_USE.md` loop prose gains the `split` outcome;
  CLAUDE.md dvx107 mention annotated "(retired by mid-story-split)";
  LEARN.md E12 + shape-(c) rows amended append-only with the successor
  exemplar pointer.

**Context**:
- E-2's historical-archive allowlist: LEARN.md entries, shipped spec
  files, `_bmad-output/` — the eval greps `.claude/commands/`, `src/`,
  `test/`, `docs/`, `v2/` only.
- `docs/ROADMAP.md:43`, `docs/DESIGN.md:324,918`, `README.md:38` become
  true as written — cite, don't edit.
- Eval runs under the `workstream-evals` project runner (`npx tsx`,
  `devx.config.yaml:364`) — outside default suite globs, CI stays green
  pre-phase-4.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-2 threshold met: eval exits 0 — zero non-historical `Handoff
    Snippet`/`parseHandoffSnippet` matches AND Phase 9 replacement prose
    present.
  - `test/devx-skill-phase9-split.test.ts` green;
    `test/skills-sync.test.ts` green; full suite green after the three
    deletions.

**Tasks**:
- [ ] T4.1 Phase 9 rewrite + snippet-section delete + token-clause fix, both mirror files — files: `.claude/commands/devx.md`, `skills/devx.md`
- [ ] T4.2 Delete parser/test/fixture + fix dangling comment — files: `src/lib/devx/handoff-snippet.ts`, `test/devx-handoff-snippet.test.ts`, `test/fixtures/handoff-snippet-realistic.md`, `test/devx-skill-phase1-resume.test.ts`
- [ ] T4.3 New `test/devx-skill-phase9-split.test.ts` (extractor + verbatim pins + zero-token assert) — files: `test/devx-skill-phase9-split.test.ts`
- [ ] T4.4 Cross-ref sweep (v2 docs, HOW_TO_USE, CLAUDE.md, LEARN.md amendments) — files: `v2/03-review-tour.md`, `v2/05-dispatcher.md`, `docs/HOW_TO_USE.md`, `CLAUDE.md`, `LEARN.md`
- [ ] T4.5 Re-run E-2 eval, watch it fail pre-sweep, drive to exit 0 — files: `_devx/workstreams/mid-story-split/evals/E-2_snippet-grep-zero.ts`
