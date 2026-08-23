# PRD — Usage-window governor

<!-- Stage: PRD. Gate: `devx gate prd c8e2d4`. IDs are stable; traceability is
     by ID, not prose. Seed: owner-approved drift-audit plan
     (~/.claude/plans/sparkling-bubbling-pie.md § Track 2, approved
     2026-07-14) + plan/plan-c8e2d4-2026-07-14T10:41-usage-window-governor.md
     § Scope. Code map + decision history gathered 2026-07-15 (two Explore
     passes; anchors cited inline). -->

## Problem

An overnight `devx loop` on a Claude subscription will eventually hit the
usage-window limit. Today that limit message is not in
`PERMANENT_ERROR_MARKERS` (`src/lib/loop/ladder.ts:67-76` — deliberately
narrow: credit/auth exhaustion only), so a "usage limit reached" worker
failure rides the hard-error backoff ladder (1→2→4 min), bumps
`consecutiveFailures` and `consecutiveErrors`, abandons the item after 3
strikes, and kills the whole loop after 3 abandoned items — hours of
walltime lost to what is weather, not a defect. Meanwhile
`capacity.usage_cap_pct: 95` is read by **nothing** (grep-verified:
`src/lib/init-write.ts:338` writes it, no code path reads it), despite the
config comment calling it the "sole capacity gate" (INTERVIEW Q#6 made it
exactly that, in intent).

This is the enabler for "use all of my Claude usage overnight" (vision-gap
Track 2, owner-approved 2026-07-14): the loop must treat a usage-window hit
as a pause-and-resume event, repeatedly, all night — and the fleet layer
(Track 4, blocked on this) inherits the same governor.

## Goals

<!-- Business goals numeric + dated so /devx outcome can score them. -->

- **G-1**: By 2026-08-15, one real overnight `devx loop` run rides ≥ 1 real
  usage-window reset and merges ≥ 1 item on **each** side of the pause
  (also discharges MANUAL.md MV2.1's supervised first night).
- **G-2**: By ship, usage-window hits cause **0** failure-counter movement
  (`consecutiveFailures`, `consecutiveErrors`, `consecutiveAbandonedItems`)
  and **0** `maxIterationsPerItem` burn, verified across the full fake-seam
  suite and the G-1 live night's JSONL event log.
- **G-3**: By ship, 100% of pause segments appear in the morning report
  (count, start, duration, reset source) — no silent paused time.

## Non-goals

- **Proactive 95% cap enforcement.** v1 is reactive (hit the wall, pause,
  resume). No usage-probe API is known to exist; a timeboxed spike (FR-8)
  investigates. `probeUsage()` ships as an inert seam stubbed to null —
  honest comments/report lines say exactly what is and isn't enforced.
- **Priority tiers** (OPEN_QUESTIONS §3 lean (b), Triage headroom) — that
  was parallelism-era framing; single-loop v1 has no competing agents.
  Re-opens with the fleet layer.
- **External-scheduler resume** (`--resume <run-id>` after process exit) —
  explicit v2 follow-up per the plan spec; v1 pause is in-process.
- **Fleet-wide pause propagation** — Track 4's concern (one shared usage
  pool suspends the whole fleet); the governor just has to expose clean
  pause state for it to consume.
- **Dollar caps** — removed per INTERVIEW Q#6; capacity is gated on Claude
  limit %, not $.

## Users

- **Primary**: Leo (owner) running `devx loop --until 07:30` overnight on a
  Claude subscription with 5-hour usage windows.
- **Secondary**: the fleet layer (plan f1d6b2, blocked on this workstream)
  consuming pause state; `devx next`'s morning review reading the report.
- **Anti-persona**: pay-per-token API-key users — they have no usage
  windows; credit exhaustion is already the permanent-error rung's job.

## Use cases

- **UC-1**: Owner starts the loop at bedtime; the window exhausts at 1am
  with a parseable reset time; the loop pauses, auto-resumes at reset, and
  keeps merging until `--until`.
- **UC-2**: The limit message carries no parseable reset time; the loop
  probes on a fixed cadence and resumes when a probe succeeds — or aborts
  cleanly at the max-pause cap with an honest "weekly limit, not the 5-hour
  window" reason instead of holding the machine all weekend.
- **UC-3**: Owner (or `devx next`) checks on a paused loop mid-night: it
  reads as **alive/paused**, not crashed; the morning report shows every
  pause segment and total paused time.
- **UC-4**: Owner sets `loop.resume_on_reset: false` and gets today's
  behavior back (kill switch — no new machinery on the failure path).
- **UC-5**: A worker's transcript merely *mentions* a usage-limit string
  (e.g. while editing the governor's own code) but ends with a valid
  report: the iteration classifies as success; no pause (false-positive
  guard, same posture as `firstPermanentErrorMatchInTail`).

## Capabilities

- **CAP-1**: Detect a usage-window exhaustion from worker output —
  tail-bounded, corroborated, false-positive-guarded (mirrors the
  permanent-error marker discipline in `ladder.ts:104-122`).
- **CAP-2**: Parse the window reset time from the observed message formats;
  degrade to probe cadence when unparseable.
- **CAP-3**: Pause and resume the running loop in-process — neutral to all
  failure/abandon/iteration accounting, same item resumes first, bounded by
  a max-pause cap and clamped by `--until`.
- **CAP-4**: Surface pause state live (heartbeat readable by `devx next` as
  alive) and historically (`windowPauses[]` in the run summary; morning
  report section).
- **CAP-5**: Config-govern the behavior (`loop:` knobs incl. kill switch),
  schema-validated (`_devx/config-schema.json` loop block is
  `additionalProperties: false` — knobs must land there too).
- **CAP-6**: Expose an inert `probeUsage()` seam for the future proactive
  cap, plus spike findings that decide whether it's implementable.

## Feature requirements

### FR-1: Usage-limit detection floor

New pure module `src/lib/loop/usage-window.ts`: `USAGE_LIMIT_MARKERS`
regexes covering the known message shapes (`claude (ai|code)? usage limit
reached`, `N-hour limit reached`, reset-suffixed variants) + a tail-bounded
matcher with the same false-positive posture as
`firstPermanentErrorMatchInTail` (`ladder.ts:116-122`): scan only the
transcript tail; a marker mid-transcript with a valid trailing report
classifies as success. Classification requires corroboration (non-zero
exit OR no parseable report), mirroring the permanent-error rule
(`driver.ts:1168-1185`).

### FR-2: Reset-time parsing

`parseResetTime()` handles: (a) unix-epoch `|<ts>` suffix form, (b)
"resets 3am"-style next-occurrence wall-clock form, (c) ISO-8601 form. A
parsed timestamp in the past returns null (fall through to the probe
path). Unparseable → null.

### FR-3: Neutral classification — weather, not a defect

A usage-window hit counts toward **nothing**: no `consecutiveFailures` /
`consecutiveErrors` / `consecutiveAbandonedItems` movement, no
`maxIterationsPerItem` burn (the interrupted iteration is not charged),
`pendingRepair` preserved, half-written tree rolled back via the existing
git-tx path otherwise, claim/lock/worktree untouched so the **same item
resumes first**. No `[FAIL]`/`[ERROR]` status-log lines are appended for a
window hit.

<!-- Placement note (design-stage decision; the behavior above is what's
     locked): the approved plan sketches this as a new ladder rung
     "usage-window-exhausted" above permanent-error; the 2026-07-15 code
     map shows LadderDecision/IterationClass are failure-shaped
     (nextLadderState bumps consecutiveFailures for any non-success,
     ladder.ts:184-205), so the seam may land in the driver's stop/wait
     checks (driver.ts:514, :1074-1092) instead. Design stage decides;
     either way FR-3's accounting semantics hold. -->

### FR-4: Pause/resume machinery

Pause is an in-process **chunked** sleep inside `runLoop` (the driver
already injects `now`/`sleep`/`signal` — `driver.ts:150-179`; chunked
wall-clock re-checks self-correct after machine sleep; `caffeinate -i -w`
already holds the machine awake via the supervisor entrypoint). Wake at
parsed reset + `usage_reset_slack_ms`. Unknown reset time → probe-worker
cadence every `usage_probe_interval_ms`. Cumulative pause >
`usage_max_pause_ms` → clean abort with the weekly-limit reason. `--until`
clamps everything: reset lands after the deadline → exit in-progress with
the normal deadline path, don't hold the machine.

### FR-5: Pause-aware state, heartbeat, and report

While paused, the loop's heartbeat keeps `devx next` reporting it as
**alive** (today `gather.ts:710` trusts only `status === "running"`;
whether that means a new `"paused"` `LoopStatus` + widened gather/state
parse guards, or continuing to heartbeat `"running"` and recording the
pause in events, is a design-stage decision — the requirement is: a paused
loop is never reported crashed, and the pause is visible in the JSONL
event log). `RunSummary` (`report.ts:68-88`) gains `windowPauses[]`
(start, end, resetSource: parsed|probe, durationMs). The morning report
gains a "Usage-window pauses" section plus total paused time in the
header block.

### FR-6: Config knobs + kill switch

`loop:` block gains `resume_on_reset: true` (kill switch — `false`
reproduces today's behavior exactly), `usage_probe_interval_ms: 900000`,
`usage_max_pause_ms: 21600000`, `usage_reset_slack_ms: 60000`. Added to
`LoopConfig`/`LOOP_DEFAULTS`/`loopConfigFrom` (`config.ts:20-84`) AND to
the `loop` block of `_devx/config-schema.json` (currently
`additionalProperties: false` at :1004 — omission means config load
rejects the knobs). `docs/CONFIG.md` §15b updated.

### FR-7: Honest capacity accounting

`usage_cap_pct` is threaded through a `probeUsage()` seam **stubbed to
null** — the check is inert until a real probe exists. The
`devx.config.yaml` comment ("sole capacity gate") and `docs/CONFIG.md` §2
rows are corrected to say what is and isn't enforced today; the morning
report states the same. (Also reconciles the Q#6 doc drift: CONFIG.md §2
still documents the removed dollar-cap knobs.)

### FR-8: Usage-probe spike (timeboxed, separate story)

Investigate (a) the `claude -p --output-format json` result envelope for
usage/limit/reset fields, (b) any `claude usage` CLI / OAuth endpoint
exposing window % + reset time. Deliverable: findings doc + go/no-go
decision on implementing `probeUsage()` — only after which the proactive
95% cap + Triage-headroom slice becomes plannable. Timebox: one story, no
production code beyond the findings doc and (if trivially proven) a probe
behind the existing seam.

## Evals seed

- Fake worker emits `...usage limit reached|<epoch>` on initial AND retry →
  pause, same-item resume after fake clock passes reset, zero counter
  movement, no FAIL/ERROR status-log lines, pause segment in report, exit 0.
- Marker text mid-transcript + valid trailing report → success, no pause.
- Unknown reset time → probe cadence at `usage_probe_interval_ms`;
  probes-never-succeed → clean abort at `usage_max_pause_ms` with
  weekly-limit reason.
- Paused loop heartbeat → `devx next` row-1 reports alive, not crashed.
- `resume_on_reset: false` → byte-identical to today's ladder behavior.
- Reset time after `--until` deadline → exit in-progress, no pause hold.
- Live: one real overnight run rides ≥ 1 real reset, merges on both sides.

## Open questions

- Exact classification seam (ladder rung vs driver stop/wait check) —
  owner: design stage (FR-3 note; not gate-blocking, behavior is pinned).
- Real usage-probe API existence/shape — owner: research (FR-8 spike
  story; explicitly parked, does not block the reactive v1).
- Real-world `USAGE_LIMIT_MARKERS` corpus: the regex set is seeded from
  known message shapes but should be hardened against captured real
  transcripts during implementation — owner: research (S1 implementation
  + 3-agent review per LEARN.md marker-discipline pattern).

## Reference links

- Spec: `plan/plan-c8e2d4-2026-07-14T10:41-usage-window-governor.md`
- Owner-approved plan: `~/.claude/plans/sparkling-bubbling-pie.md` § Track 2
- Prior lean: `docs/OPEN_QUESTIONS.md` §3; INTERVIEW Q#6 (capacity gating)
- Loop contract: `v2/04-overnight-loop.md` §3; decisions O-6 (token
  accounting), `v2/07-decisions.md`
- Code anchors: `src/lib/loop/{ladder,driver,worker,state,config,report}.ts`,
  `src/lib/next/gather.ts:667-760`, `_devx/config-schema.json:973-1005`
- Re-homed from: `plan/plan-d01000-2026-04-26T19:30-parallelism.md`
  (epic-capacity-management slice)
- Discharges: `MANUAL.md` MV2.1 (via G-1 live night)
