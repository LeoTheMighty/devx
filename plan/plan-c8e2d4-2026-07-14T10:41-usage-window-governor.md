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
- **New ladder rung `usage-window-exhausted`** (`ladder.ts`): classified
  *above* permanent-error; counts toward **nothing** (weather, not a defect);
  decision `pause-usage-window`. Driver semantics: decrement the iteration
  counter (a window hit must not burn `maxIterationsPerItem`); preserve
  `pendingRepair`; roll back a half-written tree otherwise; claim/lock/
  worktree untouched so the **same item resumes first**.
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

To be elicited by `/devx-plan`. Sketch: S1 detection + ladder rung (pure,
ships inert) → S2 driver pause/resume + state + report + knobs → S3 spike
(usage-probe API investigation; findings doc + `probeUsage` seam decision)
→ ret. The external-scheduler `--resume <run-id>` variant is an explicit
v2 follow-up, not scheduled.

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

## Links

- Approved drift-audit plan: `~/.claude/plans/sparkling-bubbling-pie.md`
- Prior design lean: `docs/OPEN_QUESTIONS.md` §3; provenance INTERVIEW Q#6
- Loop contract: `v2/04-overnight-loop.md` §3 (failure ladder)
- Code anchors: `src/lib/loop/{ladder,driver,worker,state,config,report}.ts`
- Re-homed from: `plan/plan-d01000-2026-04-26T19:30-parallelism.md`
  (epic-capacity-management slice)
