---
hash: c8e2d4
type: plan
created: 2026-07-14T10:41:00-07:00
title: "Vision-gap Track 2 — Usage-window governor: `devx loop` pauses on subscription limit, resumes on window reset"
status: ready
from: PLAN.md#vision-gap-tracks (drift audit 2026-07-14; re-homes the capacity slice of plan-d01000 / OPEN_QUESTIONS §3)
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: send-it
stack_layers: [backend]
blocked_by: []
stage: executing
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: true
  plan_verified: true
  evals_red: true
outcome:
  status: null
  measure_by: null
workstream: _devx/workstreams/usage-window-governor
gate_verdicts:
  design: CONCERNS
  plan: CONCERNS
  evals: CONCERNS
---

## Goal

An overnight `devx loop` that hits the Claude subscription usage limit
**pauses gracefully and auto-resumes when the window resets** — repeatedly,
all night — instead of misclassifying the limit as a hard error, burning the
failure/abandon counters, and dying.

## Why now

Drift audit 2026-07-14: subscription limit messages are not in
`PERMANENT_ERROR_MARKERS` (`src/lib/loop/ladder.ts:68` — only credit/auth
exhaustion). A "usage limit reached" tonight rides the hard-error backoff,
counts toward consecutive-failures → abandoned items → loop abort.
`capacity.usage_cap_pct: 95` is read by nothing (INTERVIEW Q#6 made it the
sole capacity gate). This is the enabler for "use all of my Claude usage
overnight." Re-homes the `epic-capacity-management` slice of deferred
plan-d01000 and resolves the design lean in `docs/OPEN_QUESTIONS.md` §3.

## Scope (seeded design — validated against loop code 2026-07-14)

- **Detection floor** — new `src/lib/loop/usage-window.ts` (pure, mirrors
  ladder.ts marker discipline): `USAGE_LIMIT_MARKERS` regexes
  (`claude (ai|code)? usage limit reached`, `N-hour limit reached`, etc.) +
  tail-bounded matcher (same false-positive posture as
  `firstPermanentErrorMatchInTail`) + `parseResetTime()` — unix-epoch
  `|<ts>` form, "resets 3am" next-occurrence form, ISO form; past timestamp
  → null (fall to probe path).
- ~~**New ladder rung `usage-window-exhausted`** (`ladder.ts`)~~ →
  **superseded by D-UW1 (design stage, 2026-08-21): a PRE-LADDER
  interception in the driver; `ladder.ts` gets zero diff.** The seeded scope
  above was written before the code map; `IterationClass`/`LadderDecision`
  are failure-shaped by construction (`nextLadderState` bumps
  `consecutiveFailures` for every non-success), so a rung would need four
  exemptions to a reducer whose whole value is having none — and a later
  refactor generalizing over classes would silently start charging window
  hits as failures again. See
  `_devx/workstreams/usage-window-governor/decisions/D-UW1-pre-ladder-interception.md`.
  **The accounting semantics below are unchanged** — only the seam moved:
  counts toward nothing (weather, not a defect); a window hit must not burn
  `maxIterationsPerItem`; preserve `pendingRepair`; roll back a half-written
  tree otherwise; claim/lock/worktree untouched so the **same item resumes
  first**.
- **Pause = in-process chunked sleep** inside `runLoop` (driver already
  injects `now`/`sleep`/`signal`; `caffeinate -i -w` holds the machine awake;
  chunked wall-clock re-checks self-correct after machine sleep). Unknown
  reset time → 15-min probe-worker cadence. > `usage_max_pause_ms` (default
  6h) paused → clean abort ("weekly limit, not the 5-hour window"). `--until`
  clamps everything (reset after deadline → exit in-progress, don't hold the
  machine). Kill switch `loop.resume_on_reset: false` → today's behavior.
- **State/report**: `LoopStatus` gains `"paused"` (heartbeat reflects it so
  `devx next` doesn't read a paused loop as crashed; check
  `src/lib/next/gather.ts` row-1 handling); `windowPauses[]` on `RunSummary`;
  morning report gains a "Usage-window pauses" section + paused-time in the
  header.
- **Honest 95% cap**: v1 is *reactive* — hitting the wall mid-iteration is
  already safe under git-tx rollback. `usage_cap_pct` is threaded through a
  `probeUsage()` seam **stubbed to null** (check inert until a probe exists);
  config comment + report line say exactly what is and isn't enforced.
- **Spike story (timeboxed, separate)**: (a) inspect
  `claude -p --output-format json` result envelope for usage/limit/reset
  fields; (b) find whether any `claude usage` CLI / OAuth endpoint exposes
  window % + reset time. Only after the spike does "proactive 95% cap +
  triage headroom" become plannable.
- **Config knobs** (`loop:` block): `resume_on_reset: true`,
  `usage_probe_interval_ms: 900000`, `usage_max_pause_ms: 21600000`,
  `usage_reset_slack_ms: 60000`.
- Fully testable with the fake `now`/`sleep`/`worker` seams loop-driver tests
  already use (`RunLoopOpts`, driver.ts).

## Sub-specs to spawn

~~Sketch: S1 detection + ladder rung → S2 driver pause/resume → S3 spike
→ ret.~~ **Superseded 2026-08-21 by the Plan stage.** The seeded 3-phase
sketch carried the rejected ladder rung (D-UW1) and under-counted the work.
Actual phases, emitted and `validate-emit`-clean:

- **uwg101** — detection floor (pure, ships inert)
- **uwg102** — governor + driver seam (pre-ladder interception, D-UW1)
- **uwg103** — state, heartbeat, summary, report, config knobs
- **uwg104** — live overnight ride-through (**human-gated**, own phase)
- **uwgspk** — usage-probe spike (parallel-safe; findings doc only)
- **uwgret** — retro (blocked-by uwg101-103, deliberately NOT uwg104: a
  human-gated phase must not hold the retro hostage, which is exactly what
  happened to `pinret`)

The external-scheduler `--resume <run-id>` variant remains an explicit v2
follow-up, not scheduled.

## Acceptance criteria

- [ ] Fake worker emitting `...usage limit reached|<epoch>` (initial + retry):
      loop pauses, resumes the **same item** after the fake clock passes
      reset, zero failure-counter movement, no `[FAIL]`/`[ERROR]` status-log
      lines, pause segment in the morning report, exit 0.
- [ ] Unknown reset time → 15-min probe cadence; probes-never-succeed →
      clean abort at the max-pause cap with the weekly-limit reason.
- [ ] Marker text mid-transcript with a valid trailing report → classified
      success (no pause) — false-positive guard.
- [ ] A paused loop heartbeats `"paused"` and `devx next` reports it as
      alive, not crashed.
- [ ] `loop.resume_on_reset: false` reproduces today's hard-error behavior.
- [ ] Live: one real overnight run rides ≥1 real window reset and merges work
      on both sides of it (also discharges MANUAL.md MV2.1's supervised
      first night).

## Status log

- 2026-07-14T10:41 — filed from the vision-gap drift audit (plan
  sparkling-bubbling-pie, approved 2026-07-14). Track 2 of 4. Full design
  detail lives in the approved plan + this spec's Scope.
- 2026-07-15T12:55 — PRD stage (/devx-plan): workstream usage-window-governor scaffolded (bound via --hash); 2 Explore passes (loop code map + decision history); prd.md (G-1..3, UC-1..5, CAP-1..6, FR-1..8) + expectations.md (E-1..E-7, 2×P0) written; `devx gate prd c8e2d4` PASS (1 fix: E-4 threshold made numeric) → prd_validated, stage: design. Key research findings recorded in prd.md: ladder is failure-shaped (seam choice → design stage); usage_cap_pct confirmed unwired; gather.ts trusts only status==running.
- 2026-08-21T14:35 — Design + Plan + RED stages (/devx-plan). design.md + D-UW1 written; `devx gate coverage c8e2d4` (design) CONCERNS → design_verified; plan.md with 6 phases + coverage table; `devx gate coverage` (plan) CONCERNS → plan_verified (P0 floor met: E-1 and E-2 both covered with a runnable artifact); RED artifact `test/loop-usage-window.test.ts` authored and confirmed failing FOR THE STATED REASON (it names the missing `usage-window.js`, not a broken harness) + `evals/E-7_live-night.md`; `devx gate evals c8e2d4` CONCERNS → evals_red, stage: executing. Emitted uwg101-104 + uwgspk + uwgret; `validate-emit` clean. **Scope § above corrected in the same edit** per the source-of-truth precedence rule: the seeded "new ladder rung" is struck and points at D-UW1, with the accounting semantics preserved verbatim because only the seam moved.
- 2026-08-21T15:05 — erratum: the 14:35 entry above was first inserted INTO the middle of the 2026-07-14 entry, splitting it across the log and leaving its tail dangling below a later line. Caught by the uwg101 acceptance audit. Repaired by restoring the 2026-07-14 entry verbatim and re-appending the new line at the end — append-only means append, and an insertion that mutates an existing entry is the thing the rule forbids.

## Links

- Approved drift-audit plan: `~/.claude/plans/sparkling-bubbling-pie.md`
- Prior design lean: `docs/OPEN_QUESTIONS.md` §3; provenance INTERVIEW Q#6
- Loop contract: `v2/04-overnight-loop.md` §3 (failure ladder)
- Code anchors: `src/lib/loop/{ladder,driver,worker,state,config,report}.ts`
- Re-homed from: `plan/plan-d01000-2026-04-26T19:30-parallelism.md`
  (epic-capacity-management slice)
