# Retro — `epic-devx-manage-minimal` (Phase 1, plan-b01000)

**Date:** 2026-07-05
**Story:** `mgrret` (`dev/dev-mgrret-2026-04-28T19:30-retro-devx-manage-minimal.md`)
**Epic:** `_bmad-output/planning-artifacts/epic-devx-manage-minimal.md`
**Shipped stories:** mgr101 (PR #53) → mgr102 (PR #54) → mgr103 (PR #55) → mgr104 (PR #56) → mgr105 (PR #57) → mgr106 (PR #58). Six parent stories + this retro = 7/7. **Closes epic-devx-manage-minimal. Closes Phase 1 at 5/5 epics shipped + retroed.**
**Context:** This is the **final BMAD-era retrospective.** The project is migrating off BMAD per `v2/01-bmad-capture.md` (2026-07-05 inventory); the interim retro discipline this file implements is re-homed as a native v2 engine stage. Higher-blast findings below are marked `filed-as: v2 backlog` — the v2 migration absorbs follow-ups; no new spec files are created by this retro.

---

## 1. Outcome

epic-devx-manage-minimal delivers the v0 `/devx-manage` scheduler: a single-manager, hard-cap-1 tick loop that reads the backlog graph, spawns one `claude /devx <hash>` worker, survives worker crashes with backoff + max-restarts gating, and survives its own death via lock stale-PID reclaim + heartbeat. The load-bearing surface is `src/lib/manage/` (lock.ts 295 + loop.ts 704 + pid-uptime.ts 232 + reconcile.ts 478 + spawn.ts 433 + state.ts 598 LoC) + `src/lib/backlog/parse.ts` (418 LoC, the shared pure backlog parser locked by mgr103's Architect-lens party-mode decision):

- `mgr101` ships `runManagerOnce()` / `runManagerLoop()` + the real `devx manage --once` CLI with the PM-lens grep-able tick summary line (`TICK_SUMMARY_RE` exported to pin all three format branches for downstream stories).
- `mgr102` ships `state.ts` — `schedule.json` / `manager.json` / `heartbeat.json` schemas + atomic tmp+rename writes + crash-mid-write tmp recovery (both promote-and-ignore paths tested), extending the sup-epic `writeAtomic` primitive to mutating manager state.
- `mgr103` ships pure `reconcile(state, backlogSnapshot)` (no I/O; 8+ fixtures) + `HARD_CAP_PHASE_1 = 1` with the phase-reference comment block + the extracted backlog parser.
- `mgr104` ships `spawnWorker()` — detached `claude /devx <hash>` child, log piping with 1 MB rotation, atomic PID registration before return.
- `mgr105` ships crash detection + `worker_crash_backoff_s` backoff (pure `backoffDecision()` per the Murat-lens locked decision) + max-restarts gate (DEV.md `[/]`→`[-]` flip + INTERVIEW.md filing) + manager-restart PID-recovery on init (Dev-lens locked decision: dead roster PIDs synthesize exit events).
- `mgr106` ships `acquireManagerLock()` (O_EXCL create, stale-PID detection, Infra-lens PID-recycling cross-check via per-platform process-start-time probes in `pid-uptime.ts`) + per-tick heartbeat + SIGTERM-clean drain semantics.

**Test count growth:** 1046 baseline (post-dvxret merge, pre-mgr101) → 1309 final (post-mgr106). **+263 net tests across 6 stories — largest growth of any epic to date** (dvx +255, ini +225, pln +207). Per-story deltas: mgr101 +45, mgr102 +37, mgr103 +56, mgr104 +33, mgr105 +44, mgr106 +48 (incl. +4 review-fix tests + 2 CI-red grace-bound regression tests). Phase 1 total: **+863 net tests** across 5 epics (mrg ~92 + prt ~46 + pln ~207 + dvx ~255 + mgr ~263).

**Wall-clock:** mgr101 claimed 2026-05-07T09:15, mgr106 merged 2026-05-07T~17:00 local (PR #58 merged 22:57Z). **Six stories in one calendar day (~7h45m)** — the fastest multi-story epic to date by wall-clock, on the same day dvxret merged that morning (the epic was unblocked and fully shipped within hours). Includes two fix-forward CI-red cycles (mgr102 typecheck, mgr104 typecheck) and one platform-specific CI-red (mgr106 macOS `ps` etime resolution).

**Self-review pattern:** **3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) on 6/6 stories — the first epic where every story crossed the substantial-surface threshold** (locks, state machines, spawn plumbing, multi-regex parsers: ~430–560 LoC production surfaces each). ~97 unique actionable findings across the epic (mgr101: 14 in-scope — 3 HIGH/8 MED/3 LOW, +7 tagged out-of-scope to named sibling stories; mgr102: ~21 unique — 5 HIGH/8 MED/7 LOW, 3 deferred with rationale; mgr103: ~33 raw/~28 unique — 5 HIGH/11 MED/12 LOW, 9 fixes covering ~14, 12 deferred with rationale, AA 7/7 PASS; mgr104: 6 — 2 HIGH/3 MED/1 LOW; mgr105: 19 — 4 HIGH/6 MED/9 LOW, AA 7/7 SATISFIED; mgr106: ~9 actionable + 2 AA literal-wording NOTEs). ALL in-scope findings fixed in-place; every re-review clean. The most load-bearing fixes were concurrency/parsing semantics, not lint: loop.ts roster-overwrite race resurrecting a dead PID into the roster (mgr104); empty/whitespace lock content treated as conservatively held, closing the open→write race that could yield two managers (mgr106); fence-aware backlog parsing that fixed a real INTERVIEW.md misparse (mgr103); `appendInterviewRow` EACCES-wipe that would have clobbered INTERVIEW.md (mgr105).

**Sprint-status note:** this PR flips `mgrret` → `done` and `epic-devx-manage-minimal` → `done` in `_bmad-output/implementation-artifacts/sprint-status.yaml`. **This is the last time sprint-status.yaml is touched.** Per `v2/01-bmad-capture.md` the file is 409 lines maintained across every story with a recurring drift-bug class (MP0.1/MP0.2) and zero consumers; the v2 migration retires it.

---

## 2. What worked

### 2.1 Atomic state writes via tmp+rename — cross-epic promotion confirmed (spec AC)

The spec's explicit AC: re-evaluate "atomic state writes via tmp+rename" (sup × 4 + ini505 + mgr102) and promote if confirmed. **Verdict: confirmed at 4 epics — promoted to `LEARN.md § Cross-epic patterns` this PR.**

- **sup × 4:** `writeAtomic` in `supervisor-internal.ts` across all four install surfaces (stub + launchd + systemd + task-scheduler).
- **ini505:** consumes `installSupervisor()` → same primitive cross-epic.
- **pln102:** `writeRetroAtomically()` — the fixed-order multi-artifact variant (LEARN pln E9, previously pending-concordance at 1 epic).
- **mgr102:** `state.ts` extends the primitive to **mutating tick state** — every state write goes tmp+rename; crash-mid-write recovery (leftover tmp promoted when the parent is missing, ignored + `.corrupt`-quarantined when poisoned) is covered by tests in both directions.

The promotion carries an important **split surfaced by mgr102's Acceptance Auditor**: the sup-era pattern has two halves — tmp+rename atomicity (universal; the load-bearing half) and SHA-256 content-hash idempotency (install-only; meaningless for mutating state where every write changes content). mgr102's spec AC cited "the SHA-256-on-disk idempotency pattern"; the implementation correctly extracted only the applicable half, and the AC was annotated in-place with the caveat. The new cross-epic row promotes the atomicity half; the SHA-256 half stays in the existing iniret idempotency row.

### 2.2 3-agent parallel adversarial review at 6/6 — the pattern's strongest epic yet

Already promoted at plnret, reinforced at dvxret (3 epics). mgr is the **4th epic** and the first where **every** story warranted (and got) the 3-agent shape — no below-threshold stories existed in this epic; manager internals are uniformly race-prone. The orthogonal framings kept catching disjoint classes: Blind Hunter caught the roster-overwrite race (mgr104) and writeSync-failure orphan-lock cleanup (mgr101); Edge Case Hunter caught bad-shape state sanitization (mgr101), EXDEV rename fallback (mgr102), and PID-recycling generation guards (mgr102); Acceptance Auditor caught AC-wording drift (mgr102's decorative SHA-256 citation, mgr106's Promise-vs-sync + platformDetect-vs-defaultDetectOs literal mismatches — 2 NOTEs, not blocking).

Notable: for concurrency-heavy surfaces the review found **race classes that tests can't easily pin** — mgr105 accepted two mgr106-blocked race classes with explicit code comments rather than pretending to fix them in the wrong story. See §2.3.

### 2.3 Deferred-findings-with-forward-tagging as a scope-discipline mechanism

mgr101's review tagged 7 out-of-scope findings **routed by hash to named sibling stories** (atomic-write recovery semantics → mgr102; manager-crash restart → mgr105; stale-PID + PID-recycling robustness → mgr106). mgr102 deferred 3 with per-finding rationale; mgr103 deferred 12 (each with an explicit "real files don't exhibit this" or "Node 22+ guarantee" reason); mgr105 accepted 2 registerRosterEntry/crashes-clear race classes as "mgr106-blocked" with comments. The later stories **actually landed the deferred fixes** — mgr106's empty-lock-held + stale-PID reclaim covers exactly the classes mgr101 deferred. This is fix-forward discipline compatible with "don't expand the current item's scope": the deferral is explicit, hash-addressed, and auditable at retro time. 1 epic, 4 internal observations — pending-concordance, but the v2 review-tour design should adopt the shape natively.

### 2.4 Real-file smoke tests catch what fixtures don't (mgr103)

mgr103's parser ran against the repo's **real INTERVIEW.md** during review and surfaced a genuine bug: the example footer at line 193 (`- [x] Q#7 (from DevAgent on dev-a3f2b9)` inside a markdown code fence) parsed as a real answered Q#7 — doubling the question count and emitting spurious unblock directives on every tick. The fix (`blankFencedLines()`) took the real-file question count from 9 → 8. Fixture-only tests would never have carried the poisoned example. Pattern: parsers of living repo files need at least one test against the actual file. Pending-concordance: 1 epic.

### 2.5 Pure-fn decision cores continued (reconcile + backoffDecision)

The promoted pure-fn+CLI trio pattern holds without new CLI surfaces this epic (the consumer is the manager loop, not a skill body): `reconcile()` (pure, no I/O, fixture-tested including the pinned "Phase 1 hard cap" error string) and `backoffDecision()` (pure `{last_exit_at, crash_count, now}` → spawn/wait, per the Murat-lens locked decision separating decision-purity from loop-integration timing). Both are the "library + tests, no CLI" healthy variant identified at dvxret. The party-mode locked decisions (PM tick-summary line, Architect backlog-parser extraction, Dev PID-recovery, Infra PID-recycling cross-check, Murat × 2 test-shape decisions) all shipped verbatim — 4/4 stories that carried locked decisions delivered them.

### 2.6 Per-platform deviation with explicit rationale + dedicated test — 4th epic confirmation

mgr106's CI went red on macos-latest only: `ps -o etime=` has 1-second resolution, so the process-start-time probe returned `now()` for a <1s-old process and tripped the PID-recycling cross-check on every same-process re-acquire. Fix: a 2s grace window in `classifyExistingLock` (subsumes etime resolution + clock jitter; real PID recycling involves seconds-to-minutes deltas), plus 2 regression tests pinning the grace bounds. Exactly the promoted cross-epic shape (cli305 + sup404 + ini505): deviate where the platform demands, record the rationale, pin it in tests. mgr adds the 4th epic.

### 2.7 The dvxret §3.6 revisit: manager-side crash recovery shipped

dvxret flagged "claimed but Phase 2 never started needs to be a recoverable state when ManageAgent ships — revisit at mgrret." Manager-side recovery **shipped in this epic**: mgr105's PID-recovery on init synthesizes exit events for dead roster PIDs (lost exit events recovered, crash_count incremented), and mgr106's stale-PID + PID-recycling lock reclaim recovers the manager's own lock. The **spec-claim half remains open** — see §3.2.

---

## 3. What didn't (and how we'll respond)

### 3.1 Typecheck-only CI failure class hit twice in one epic (mgr102 + mgr104)

mgr102 PR #54's first CI run failed at the `npm run typecheck` step (`as Record<string, unknown>` overlap mismatch in a test file); mgr104 PR #56 failed the same step again (`Parameters<typeof runManagerOnce>[0]["spawnFn"]` indexing into a possibly-undefined type). Root cause both times: remote CI runs `tsc --noEmit` (tsconfig.json, includes test files) while local `npm test` only builds via tsconfig.build.json (excludes tests) — so test-file type errors surface only remotely. mgr103 and mgr106 ran `npm run typecheck` manually in-session, which masked rather than closed the gap. **Applied in this PR (low-blast, one line):** `package.json → scripts.test` now runs `npm run typecheck` before vitest, aligning the local gate with remote CI structurally. This retro PR is the first to run under the aligned gate.

### 3.2 roc101 (verify-claim) did not ship before mgr104 — the collision class dvxret named is live under parallelism

dvxret E13 filed `dev-roc101` (resume-detection / verify-claim) as "load-bearing for mgr104's worker-spawn discipline." mgr104 shipped without it: spawned workers run `claude /devx <hash>` with no structural ownership check, so the fresh-session-stomps-live-claim class remains open the moment more than one actor exists (hard cap = 1 bounds the exposure today — manager + at most one worker — but a human-invoked `/devx` alongside a manager-spawned worker reproduces dvxret's incident shape unattended). roc101 remains `[ ]` ready in DEV.md. **filed-as: v2 backlog** — the v2 universal dispatcher (`v2/05-dispatcher.md`) owns claim/ownership semantics; roc101 is carried forward as a v2 design input rather than claimed as a BMAD-era story. The CLAUDE.md "Verify claim ownership before resuming" stopgap remains the operative rule.

### 3.3 Phantom DEBUG filing — second instance of the cliret E3 class

mgr104's status log says the typecheck-gap pattern was "filed as DEBUG entry post-merge so /devx-learn can wire `npm run typecheck` into projects[*].pre_push" — **DEBUG.md is empty; no entry was ever filed.** Same class as cli301's phantom `debug-flow01` (cliret E3: "formal-pass retros should verify 'filed-as X' references resolve to a real X"). Reconciliation: marked **superseded** by §3.1's structural fix in this PR — the corrective shipped, so no retroactive filing is needed. The class now has 2 confirmed instances (cli301 + mgr104); the v2 engine's status-line discipline should validate filed-as references at write time. filed-as: v2 backlog (validation rule).

### 3.4 Status-log discipline: 5/6 rich, mgr105 partially terse

mgr101–mgr104 + mgr106 enumerate per-phase milestones, finding counts by severity, fix-forward outcomes, and merge SHAs. mgr105 has a rich phase-4 review line but omits the phase-5 (local CI) and phase-7 (PR-opened / CI-result) lines entirely, ending at "merged via PR #57 (squash → f64dddc)". The variance is now **intra-epic**, not just run-style-polarized as dvxret characterized it. MP1.1 (skill prompt-card line) stays open and is absorbed into the v2 Execute-stage status discipline (`v2/02-engine.md` pins the dvx103-style status-log line format natively). filed-as: v2 backlog (MP1.1 absorption).

### 3.5 Planner drift handled inline (mgr101) — right-sized vs prt E2's halt-and-amend

mgr101's spec said "Replace `src/commands/manage.ts` stub" and AC #5 required removing a help.ts annotation — but cli302 never created a `manage` stub and no annotation existed. `/devx` recorded an explicit "phase 2 drift note" in the status log and delivered the real intent (new command registered via `attachPhase(prog, 1)`) without halting. Compare prt101, which halted and amended the spec: there the drift was structural (two write sites targeting the same file); here it was a wrong premise with an unchanged deliverable. The two incidents bracket the judgment call well: **halt-and-amend when the drift changes what ships; drift-note-and-proceed when it only changes the description of what ships.** Recorded.

### 3.6 `bmad-create-story` skip count: 49/49 across 10 epics — final count, and the internal tallies drifted

mgr 6/6 skipped (mgr101–mgr103 logged "helper decision logged not honored" per the dvx102 canary contract; mgr104–mgr106 logged the skip directly). Cumulative: Phase 0 25/25 + mrg 3/3 + prt 2/2 + pln 6/6 + dvx 7/7 + mgr 6/6 = **49/49 across 10 epics**. Noted: the per-story running counts in mgr status logs drifted (mgr102 says "44/44", mgr103 "45/45", mgr105 "44/44" — approximate increments, not authoritative); the count that matters is the per-epic roll-up done at retro time. **This is the final count.** The dvx102 canary never flipped and never will — `v2/01-bmad-capture.md` verdicts the machinery as existing "solely to bury `bmad-create-story` gracefully"; the v2 native engine drops the step entirely. CLAUDE.md Phase 2 inline note bumped to 49/49 + marked final in this PR.

### 3.7 `bmad-retrospective` was never formally wired — and now never will be

Every prior retro carried "the formal `bmad-retrospective` skill exists but isn't invoked; Phase 5 `epic-retro-agent` will close this." **Resolution: superseded.** The v2 migration retires the 63KB skill along with the rest of the BMAD surface; the interim discipline (LEARN.md + per-epic `*ret` story + this house-shaped retro file) IS the retro contract that v2 re-homes natively. This file is the 10th and final artifact of the interim discipline. The recurring gap closes not by wiring the skill but by making the substitute the system.

### 3.8 Retro-row backfill — 10th and final confirmation

mgrret was emitted by `/devx-plan` on 2026-04-28, before pln102's `emitRetroStory()` shipped, so (as dvxret predicted) it is **the last retro requiring manual sprint-status backfill**. Applied in this PR: `mgrret` → `done`, `epic-devx-manage-minimal` → `done`. Cross-epic row bumped 9/9 → 10/10 retros + closed permanently (the file itself is retired — see §1 sprint-status note).

---

## 4. Findings (tagged for `LEARN.md`)

Fourteen findings appended to `LEARN.md § epic-devx-manage-minimal`. **One new Cross-epic-patterns promotion: "Atomic state writes via tmp+rename"** (sup + ini + pln + mgr = 4 epics; the spec's AC, confirmed). Reinforcements of four already-promoted rows (3-agent parallel review → 4 epics with mgr as first 6/6-coverage epic; self-review non-skippable → 10 epics; per-platform deviation → 4 epics; retro-row backfill → 10/10 final). Two low-blast findings applied in this PR (package.json typecheck gate; sprint-status final flips + CLAUDE.md count bumps). Higher-blast items marked `filed-as: v2 backlog` per the migration — zero new spec files, zero new MANUAL.md rows.

---

## 5. Phase 1 closure

After this PR merges, **Phase 1 is closed: 5/5 epics shipped + retroed** (mrg + prt + pln + dvx + mgr). Phase 1 totals: 24 parent stories + 5 retros, **+863 net tests** (mrg ~92 + prt ~46 + pln ~207 + dvx ~255 + mgr ~263; suite at 1309 post-mgr106), every PR since prt102 rendered via `devx pr-body` and gated via `devx merge-gate`, every claim since dvx101 via `devx devx-helper claim`.

This is also **the close of the BMAD era.** The next planning work happens under the v2 migration (`v2/README.md`): native engine, review tours, universal dispatcher, overnight loop. The Phase 2–9 roadmap as originally shaped (epic-events-stream, epic-controller-autoscaling, epic-retro-agent, …) is superseded by the v2 phase plan (`v2/06-phases.md`); LEARN.md's cross-epic patterns section is the primary capture artifact carried forward.

CLAUDE.md "Status: Phase 1" block updated this PR to reflect 5/5 closed.
