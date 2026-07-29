---
hash: 20eb6f
type: plan
created: 2026-07-28T08:34:00-06:00
title: "Multi-loop concurrency — N scoped `devx loop`s on one repo, error-proof by construction"
status: done
from: user request 2026-07-28 (interactive eval session); re-homes the locks/coordination slice of plan-d01000
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: send-it
stack_layers: [ backend ]
blocked_by: []
stage: done
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: true
  plan_verified: true
  evals_red: true
outcome:
  status: pending
  measure_by: 2026-08-31
workstream: _devx/workstreams/multi-loop-concurrency
gate_verdicts:
  prd: PASS
  design: PASS
  plan: CONCERNS
  evals: PASS
---

## Goal

Multiple `devx loop` processes run concurrently on one repo — each optionally
scoped to an epic/workstream, a specialty, or an explicit ticket list — and
the system is safe **even when scopes overlap or no scope is given**. Safety
must never depend on the human partitioning correctly: two loops pointed at
the same backlog degrade to polite claim-arbitration, never to corrupted
state, lost backlog updates, or spurious run aborts.

## Why now

The loop works (harness-fold-in shipped hfi101/hfi104 end-to-end overnight),
but it is serial by construction and singleton by lock. One machine, one
repo, one item in flight — while the backlog holds independent epics
(mobile, portability, loop-hardening) that could ship in parallel. Owner
request 2026-07-28. Re-homes deferred plan-d01000's locks/coordination
slice (its capacity slice already went to c8e2d4).

## Evaluation of current state (2026-07-28, three-agent code audit)

### What is already sound (keep, don't rebuild)

- **Per-spec O_EXCL claim lock** (`src/lib/devx/claim.ts:517`) — right
  primitive, cross-process; missing lifecycle only (see R7/R12).
- **mgr106 manager-lock classifier** (`src/lib/manage/lock.ts:259`) —
  dead-PID reap, PID-recycling cross-check w/ start-time grace, unparseable
  reap, conservative on empty body. Exactly the machinery spec locks lack.
- **`writeAtomic` tmp+rename** everywhere in loop/claim paths — torn-write
  safe (not lost-update safe).
- **Worktree-per-item + PR-per-item + merge-gate** — GitHub already
  serializes the only path to main for *code*; concurrency risk is confined
  to backlog/state files and the main-checkout git operations.
- **`acquirePathLockBlocking`** (`lock.ts:211`, 5s/20ms) — built for the
  INTERVIEW/MANUAL append paths, ready to serialize backlog writes; unused
  by claim/driver today.
- **Conservative blocker resolution** (unknown hash ⇒ unresolved) with a
  **global** status map across DEV/DEBUG/PLAN (`gather.ts:245-265`) —
  cross-epic `Blocked-by:` edges already behave correctly under
  partitioning, for free.
- **`--only`/excluded masking trick** (`driver.ts:325-332`) — out-of-scope
  rows are masked to `blocked`, not removed, so they still block dependents.
  This is the correct semantics for scope filters; reuse it.

### Race/gap inventory (two loops today; anchors verified)

- **R1 — the lock isn't repo-global.** `repoRoot` = nearest
  `devx.config.yaml` above cwd (`config-io.ts:43`); worktrees contain one,
  so a loop launched inside `.worktrees/…` takes a *different*
  `manager.lock`, state file, and spec-lock dir, then claims from the same
  DEV.md and pushes to the same origin/main. `devx manage` is worse:
  no-arg `acquireManagerLock()` resolves `".devx-cache"` against bare cwd
  (`manage.ts:100,126`, `lock.ts:67`).
- **R2 — claim-push race burns the failure budget.** `claim.ts:693` pushes
  the claim commit with no fetch/rebase/retry; loser rolls back, and
  `MAX_CONSECUTIVE_CLAIM_FAILURES = 3` (`driver.ts:523`) aborts the whole
  run after three lost races — contention misclassified as systemic failure.
- **R3 — lost updates on DEV.md/spec files.** All writers are unlocked
  read-modify-write; tmp+rename means last-rename-wins silently drops the
  peer's checkbox flip (`claim.ts:534→589`, `driver.ts:1037→1048`,
  `:1792→1796`).
- **R4 — git index.lock contention in the shared main checkout.** claim
  add/commit, `commitOnMain`, `pushMain`, `pull --ff-only`, `worktree
  add/remove` all run cwd=repoRoot with no serialization and no retry;
  failures are evented and swallowed (`driver.ts:932`, `:1762`).
- **R5 — `pull --ff-only` fails after a peer pushes**; only a report WARN.
- **R6 — `loop/state.json` is a single slot** (`state.ts:48`): two co-rooted
  loops ping-pong pid/run_id every heartbeat; first to exit stamps
  `stopped` over the survivor; `devx next` row 1 reports garbage.
- **R7 — release TOCTOU.** `ownsClaim()` (`driver.ts:833`) checks then
  mutates+unlinks with nothing held across the gap; `releaseSpecLock` is an
  unconditional unlink and can delete a peer's re-claimed lock.
- **R8 — the picker never consults spec locks** (`driver.ts:298-348`,
  roster always empty): N loops all converge on the same top item and
  resolve it the expensive way (claim failures).
- **R10 — non-atomic writers still exist**: `manage/loop.ts:536,598,644`
  and `commands/gate.ts` write spec/DEV.md/INTERVIEW.md via bare
  `writeFileSync`.
- **R11 — fixed-name scratch files** (`.devx-cache/pr-body.stderr`,
  `tour-gather.json` — `skills/devx.md:281,287`) collide across sessions.
- **R12 — spec locks are never reaped.** No PID probe, no TTL (DESIGN.md's
  "2 hour timeout" was never implemented). Live proof on disk:
  `spec-494590.lock` survives its own merged PR.
- **No partition key**: `DevRow` has no epic/workstream field; DEV.md
  `### Epic` headings are discarded by the parser; the only scope flag in
  existence is `--only dev|debug`.
- **No conflict metadata**: "Parallel-safe with…" prose and plan.md
  `**Files:**` bullets are parsed by nothing; two scoped loops can still
  collide on shared source files (surfaces as a PR merge conflict — CI-safe
  but wasteful).
- **Singleton assumptions documented-not-built**: `intents/`,
  `ci-wait-<branch>.lock`, `concierge.lock`; `capacity.max_concurrent: 5`
  is written by init and read by nothing (`HARD_CAP_PHASE_1 = 1` is the
  real cap).

## Recommended design (seeded; design stage refines)

Principle: markdown+git stay ground truth (D-2); O_EXCL path locks stay the
primitive; every cross-process interaction becomes either idempotent-retry
or a short critical section under an existing-style path lock. Two layers:
**Layer 1 makes N loops safe with zero flags; Layer 2 adds scoping so N
loops are *useful*.** Scoping is an optimization for contention, never a
safety requirement.

### Layer 1 — correctness

1. **Root canonicalization (kills R1).** Resolve repoRoot once via
   `git rev-parse --git-common-dir` → main worktree; `devx loop`/`manage`/
   claim refuse to start from a linked worktree (actionable error, override
   flag for tests). `manage.ts` passes an explicit cacheDir. One
   `.devx-cache` universe per repo, unconditionally.
2. **Backlog mutation lock (kills R3/R4/R10).** One `withBacklogLock()`
   helper wrapping `locks/backlog.lock` via the existing
   `acquirePathLockBlocking`, held across {read → edit → writeAtomic → git
   add/commit → push} for every DEV.md/DEBUG.md/PLAN.md/spec-frontmatter
   mutation on main, in claim.ts, driver.ts, manage/loop.ts, gate.ts.
   Convert the manage/gate plain `writeFileSync` writers to `writeAtomic`
   while touching them. Critical sections are milliseconds-to-seconds; the
   5s blocking acquire is adequate (raise to ~30s for the push-bearing
   claim section).
3. **Claim contention ≠ claim failure (kills R2/R5).** Under the backlog
   lock, on push rejection: `git pull --rebase` (claim commit only) and
   retry, bounded; classify a lost race as `claim-contended` — pick the
   next item, do **not** increment `consecutiveClaimFailures`. `pull
   --ff-only` failures in finalize get one fetch+retry under the same lock.
   (Keeps the push-claim-before-PR memory rule intact.)
4. **Spec-lock lifecycle (kills R7/R12).** Reuse the mgr106 classifier for
   `spec-<hash>.lock` (write `{pid, started_at, session, claimed_at}`
   JSON): dead-owner locks are reaped at claim time; add the long-promised
   TTL as belt-and-braces. Release becomes guarded: re-verify token under
   the backlog lock before unlink. Coordinates with dev-db36af (`devx
   doctor` reaps debris; this story makes claim/release safe live).
5. **Loop instance registry (kills R6).** Replace singleton state:
   `locks/loop-<run-id>.lock` (O_EXCL, classifier-backed) +
   `loop/instances/<run-id>.json` heartbeats; admission check counts fresh
   instances against `capacity.max_concurrent` (finally honoring the
   declared knob; default stays 5, configurable). `devx next` row 1 and
   `devx status` aggregate all fresh instances (id, scope, current item,
   iteration). Manager daemon keeps `manager.lock`; loops no longer take it
   (a manager and N loops, or N loops alone, coexist; manage-spawned
   workers and loops share the same spec-lock arbitration).
6. **Picker consults locks (kills R8).** `pickNextItem` skips rows whose
   spec lock is held by a live owner (mask-to-blocked), so overlapping
   loops interleave down the backlog instead of colliding at claim.
7. **Scratch namespacing (kills R11).** `.devx-cache/scratch/<session>/`
   for pr-body/tour-gather temp files; skill bodies updated (mirror pair).

### Layer 2 — scoping & specialties

8. **Epic-aware row model.** `parseDevMd` tracks `### Epic — <name> (plan:
   <hash>)` headings and stamps each row with `{epicSlug, planHash}`;
   workstream membership stays derivable via the existing frontmatter walk.
   (Additive fields; no format change to DEV.md.)
9. **Scope flags on `devx loop`** (all compose with `--only`):
   - `--epic <slug>` / `--workstream <slug>` (repeatable) — partition by
     epic section or workstream;
   - `--items <hash,hash,…>` — explicit ordered ticket list;
   - `--exclude <hash|epic-slug>` (repeatable);
   - `--focus "<free text>"` — specialty line appended to the iteration
     prompt frame (e.g. "prefer test-coverage work; do not touch mobile/").
   Implementation = the existing masking trick; global blocker resolution
   already makes cross-scope `Blocked-by:` edges hold. Scope is recorded in
   the instance registry, morning report, and `devx next` output. `--items`
   with a hash whose blockers are outside the list: mask-blocked and say so
   in the report (no silent skip).
10. **Conflict advisory (follow-up, explicitly out of v1).** Parse plan.md
    `**Files:**` bullets into a claim-time warning when overlapping an
    in-flight item. Merge conflicts already surface safely at PR level;
    ship only if overnight runs show real waste.

### Interplay

- **c8e2d4 (usage-window governor)**: token/usage budgets stay per-process
  in v1; a cross-loop shared budget file is a named follow-up, not in
  scope. A paused loop still heartbeats its instance file.
- **f1d6b2 (fleet layer)**: orthogonal — fleet = many repos × one loop;
  this = one repo × many loops. Fleet composes on top unchanged.
- **lpf101 (preflight main-health)**: runs per-loop at start; unchanged.

## Sub-specs to spawn

To be elicited by `/devx-plan`. Sketch (one phase ≙ one spec ≙ one PR,
D-12): S1 root canonicalization → S2 backlog mutation lock + atomic-write
conversion → S3 claim-contention retry/reclassify → S4 spec-lock lifecycle
+ guarded release → S5 instance registry + capacity admission + next/status
aggregation + scratch namespacing → S6 epic-aware rows + scope flags +
report/registry scope surfacing → ret. S1–S4 are sequential-ish
(shared files: claim.ts/driver.ts); S5 ∥ S6 after S4. Live AC last: two
scoped loops, one night, real backlog.

## Acceptance criteria (plan-level)

- [ ] Two loops, disjoint epics (fake workers): both complete; every
      claim/merge/flip lands; zero lost DEV.md updates; zero contention
      aborts.
- [ ] Two loops, **identical** scope: no corruption; claim losers move to
      the next item without burning failure budget; the union of merged
      items equals a serial run's.
- [ ] `devx loop` from inside `.worktrees/…` refuses with an actionable
      error (R1 dead).
- [ ] Stale spec lock (dead PID) is reaped at claim time; `spec-494590`-
      class debris cannot recur.
- [ ] `kill -9` one of two loops mid-item: peer unaffected; the dead loop's
      claim is recoverable (doctor/TTL); `devx next` reports the survivor
      accurately.
- [ ] `--items a,b,c` executes exactly those, in order, honoring
      `Blocked-by:`; out-of-list blockers are reported, not silently
      skipped.
- [ ] `devx next` + `devx status` render every live loop instance with its
      scope and current item.
- [ ] All existing single-loop tests pass unchanged (N=1 is the degenerate
      case, not a special case).

## Open questions (for PRD interview / INTERVIEW.md)

- Default `capacity.max_concurrent` for loop admission — keep the declared
  5, or start at 2–3 while trust builds? (Recommend: honor 5, it's
  admission-checked anyway.)
- Should `--epic` accept the DEV.md heading slug, the plan hash, or both?
  (Recommend: both, normalized.)
- Cross-loop shared token budget — v1 follow-up or fold into S5?
  (Recommend: follow-up; per-process budgets are safe, just uncoordinated.)

## Status log

- 2026-07-28T08:34 — filed from interactive deep-eval session (3-agent
  audit of locking/state/dependency machinery; race inventory R1–R12
  recorded above with code anchors). Ready for `/devx-plan 20eb6f`.
- 2026-07-28T08:55 — PRD stage (/devx-plan): workstream
  multi-loop-concurrency scaffolded (bound via --hash); research = the
  pre-stage 3-agent audit (locks/state, loop internals, dispatcher/deps);
  prd.md (G-1..3, UC-1..6, CAP-1..7, FR-1..8) + expectations.md (E-1..E-8,
  3×P0 runnable evals targets) written; INTERVIEW Q#13 filed (13a
  admission cap / 13b --epic key form / 13c cross-loop token budget — all
  non-blocking, recommendations applied as defaults). `devx gate prd
  20eb6f` PASS after 2 FAIL rounds (fixes: CAP ID shape to template form,
  angle-bracket placeholder tokens in FRs, numeric thresholds on E-6/E-8,
  bare Verified-by paths on E-7/E-8) → prd_validated, stage: design.
- 2026-07-28T09:20 — Design stage (/devx-plan): design.md authored (6-component
  architecture: canonical root / backlog mutation lock / claim contention /
  spec-lock lifecycle / instance registry / scope model; single-blocking-lock
  deadlock argument; G-1 in-process harness via RunLoopOpts seams; 4 resolved
  design questions incl. legacy state.json read-fallback + TTL demoted to
  WARN+doctor). Coverage judge: 22 covered / 2 partial (G-1 harness
  undesigned, FR-4 TTL deviation) → both fixed (harness section added;
  FR-4 prd text aligned per override flow, `devx gate prd` re-verified PASS)
  → re-judged covered. `devx gate coverage 20eb6f --table …` PASS (design
  mode, 24/24 rows, 3 extras flagged for product awareness) →
  design_verified, stage: plan. Report:
  `_devx/workstreams/multi-loop-concurrency/decisions/2026-07-28-design-verify.md`.
- 2026-07-28T09:45 — Plan stage (/devx-plan): plan.md authored — 6 phases
  (root canonicalization → backlog lock → spec-lock lifecycle → contention +
  overlap harness → instance registry → scope model), one phase ≙ one PR
  (D-12); expectation coverage table maps E-1..E-8 with P0 runnable
  artifacts. Critique step SKIPPED per config (send-it thoroughness,
  single stack layer [backend] < engine.critique.min_surfaces=2) — sizing
  call recorded. Coverage judge: 7 covered / 1 partial (E-7 by design);
  2 nits fixed (E-3 pick-time masking moved into phase 3; E-8 PR-body
  clause added) and re-judged covered. `devx gate coverage 20eb6f --table …`
  CONCERNS (plan mode; sole reason = E-7 partial-by-design) →
  plan_verified, stage: red. Report:
  `_devx/workstreams/multi-loop-concurrency/decisions/2026-07-28-plan-verify.md`.
- 2026-07-28T09:10 — RED stage (/devx-plan): 6 runnable evals authored
  (E-1..E-6 + shared _fixture.ts; E-7/E-8 deferred .md checklists —
  human/tests-after, legal for P2/P1). Each eval hand-run before the gate:
  all RED for the right reason (missing feature — singleton refusal,
  no repo-root module, LockHeldError on dead owner, no rebase-retry, no
  instances aggregation, no epic fields/flags), zero wiring failures;
  E-3's live-owner conservative clause and E-6's parse probe verified
  against today's behavior. `devx gate evals 20eb6f --dry-run` resolved
  6 planned + 2 deferred; real run PASS (all six right-reason) →
  evals_red, stage: executing. Report: `evals/RED-report.md`. Emitted:
  dev specs mlc101–mlc106 (serial chain, branches via derive-branch) +
  mlcret (emit-retro-story) + DEV.md § Epic — multi-loop-concurrency;
  `validate-emit multi-loop-concurrency` ok; todo.md Phase pointer lines
  written; PLAN.md checkbox flipped [x].

## Links

- Loop contract: `v2/04-overnight-loop.md`; dispatcher: `v2/05-dispatcher.md`
- Code anchors: `src/lib/devx/claim.ts`, `src/lib/loop/{driver,state,worker,ladder,tail}.ts`,
  `src/lib/manage/{lock,reconcile,loop}.ts`, `src/lib/backlog/parse.ts`,
  `src/lib/next/{gather,decide}.ts`
- Re-homed from: `plan/plan-d01000-2026-04-26T19:30-parallelism.md`
  (locks/intents/coordination slice; capacity slice already at c8e2d4)
- Related ready items: `dev-db36af` (devx doctor — stale-state reaper),
  `dev-lpf101` (loop preflight main-health)
