# Design — Usage-window governor

<!-- Stage: Design. Gate: `devx gate coverage c8e2d4` (design mode — one row
     per FR-/CAP-, every P0 expectation reachable). Decisions that close a
     PRD open question are recorded in `decisions/`. -->

## The decision the PRD deferred

The PRD's FR-3 note left one thing open: **is a usage-window hit a new
ladder rung, or a check that runs before the ladder is consulted at all?**

It is the second, and the reason is structural rather than aesthetic.

`IterationClass` and `LadderDecision` are **failure-shaped by
construction**. `nextLadderState` (`ladder.ts:246`) bumps
`consecutiveFailures` for every class except `success`, and
`ladderDecision` maps state → backoff / abandon / abort. A new rung would
therefore have to be a class that:

- does not bump `consecutiveFailures` (so `nextLadderState` needs a special
  case), and
- does not bump `consecutiveErrors` (another special case), and
- does not consume an iteration against `maxIterationsPerItem` (which the
  driver counts, not the ladder), and
- returns a decision kind the driver must special-case anyway (`pause`).

That is four exemptions to a reducer whose whole value is that it has none.
The ladder's clarity comes from "every non-success moves the state"; a rung
that moves nothing is not a rung, it is a **bypass wearing a rung's
costume**. And the risk is not hypothetical: a future edit to
`nextLadderState` that generalizes over classes would silently start
charging window hits as failures, which is exactly the bug this workstream
exists to fix.

**Decision D-UW1: the governor is a pre-ladder interception in the driver.**
The iteration result is inspected for a usage-window hit *before*
`classifyIteration` is called. On a hit the driver pauses, and on resume it
re-runs the same item's iteration without having touched ladder state,
iteration count, or the status log. `ladder.ts` is not modified at all.

Recorded as `decisions/D-UW1-pre-ladder-interception.md`.

## Architecture

### 1. Detection floor — `src/lib/loop/usage-window.ts` (pure, new)

Mirrors `ladder.ts`'s permanent-error marker discipline rather than
inventing a second posture, because that discipline is already
review-hardened:

```
USAGE_LIMIT_MARKERS: RegExp[]          // known message shapes
firstUsageMarkerInTail(raw, tailBytes) // scan the TAIL only
parseResetTime(raw, now)               // → Date | null
detectUsageWindowHit(input)            // → UsageWindowHit | null
```

`detectUsageWindowHit` requires **corroboration**, the same rule
`driver.ts:1168` applies to permanent errors: a marker in the tail is a hit
only when the iteration ALSO failed to produce a valid trailing report (or
exited non-zero). A transcript that merely *mentions* a usage-limit string —
which happens whenever someone edits this very module — and then ends with a
valid report is a **success**, not a pause. That is E-2, and it is the
false-positive guard that makes the marker set safe to widen later.

`parseResetTime` handles three observed shapes: a `|<unix-epoch>` suffix, a
wall-clock "resets 3am" next-occurrence form, and ISO-8601. **A parsed time
in the past returns null**, falling through to the probe path — a stale
timestamp must never produce a zero-length pause that spins.

### 2. Governor — `src/lib/loop/usage-governor.ts` (new)

The pause loop, injectable and clock-free:

```
planPause(hit, cfg, now, deadline)  → PausePlan   // PURE
runPause(plan, deps)                → PauseResult // sleeps, probes
```

`planPause` is where every bound lives, and it is pure so the bounds are
testable without a clock:

- parsed reset → wake at `reset + usage_reset_slack_ms`
- no parsed reset → probe cadence `usage_probe_interval_ms`
- cumulative pause > `usage_max_pause_ms` → `{kind: "abort", reason}` with
  the weekly-limit explanation, rather than holding the machine all weekend
- **`--until` clamps everything**: a reset landing after the deadline
  returns `{kind: "deadline"}` and the driver takes its ordinary
  deadline-reached exit. The loop must never hold a machine past the hour
  its operator said to stop.

`runPause` sleeps in **chunks**, re-checking wall-clock each time. This is
not a style choice: `project_devx_loop_sleep_kills_iterations` records that
machine sleep has killed whole loop runs here, and a single long `sleep(ms)`
cannot self-correct after a suspend. Chunked re-checks make the pause
sleep-aware for free, the same way the iteration ceiling was made
sleep-aware at dc7514.

### 3. Driver seam — `src/lib/loop/driver.ts`

One interception point, in `runItem`'s post-iteration path, before
`classifyIteration`:

```
const hit = cfg.resumeOnReset ? detectUsageWindowHit({...}) : null;
if (hit !== null) {
  event("loop:usage-pause", {...});
  const result = await runPause(planPause(hit, cfg, now(), untilDeadline), deps);
  // → "resumed": re-run the SAME iteration; ladder state untouched
  // → "deadline" | "abort": exit through the existing paths
}
```

The kill switch is checked **first**, so `resume_on_reset: false`
short-circuits before any governor code runs — E-5's "byte-identical to
today" is then true by construction rather than by careful matching.

Claim, lock and worktree are untouched across a pause, so the same item
resumes first with no re-claim. `pendingRepair` is preserved. A half-written
tree is rolled back through the existing git-tx path exactly as it is today.

### 4. State, heartbeat, report

- `LoopStatus` gains `"paused"`. `gather.ts` currently trusts only
  `status === "running"` (`:710`), so its liveness predicate widens to
  `running | paused` — **a paused loop is alive**, and reporting it crashed
  is E-4's failure.
- The heartbeat keeps beating while paused (the chunked sleep is the natural
  beat point), so freshness still decides liveness. Age-based staleness is
  unchanged: paused-and-stale still reads dead.
- `RunSummary` gains `windowPauses: PauseSegment[]`
  (`{startedAt, endedAt, resetSource: "parsed"|"probe", durationMs}`).
- The morning report gains a **"Usage-window pauses"** section plus total
  paused time in the header — G-3 says no silent paused time, and a pause
  that leaves no trace is indistinguishable from a hang.

### 5. Config — `src/lib/loop/config.ts` + `_devx/config-schema.json`

Four knobs on the `loop:` block: `resume_on_reset: true`,
`usage_probe_interval_ms: 900000`, `usage_max_pause_ms: 21600000`,
`usage_reset_slack_ms: 60000`.

**The schema edit is not optional.** `_devx/config-schema.json`'s `loop`
block is `additionalProperties: false`, so a knob added to `LoopConfig` but
not to the schema makes config load *reject* the very setting it added.
Called out here because it is a two-file change that looks like one.

### 6. Honest capacity accounting — FR-7

`probeUsage()` ships as an inert seam returning `null`. Everything that
reads it is written to treat `null` as "unknown", and the config comment,
`docs/CONFIG.md` §2 and the morning report all say plainly that
`usage_cap_pct` is **not enforced today**.

This is the part most likely to rot into a lie. The rule: no code path may
branch on `usage_cap_pct` in a way that would silently start enforcing it if
`probeUsage` were implemented — the spike (FR-8) decides that, deliberately.

## Coverage — every FR/CAP to its home

| ID | Where it lands | Verified by |
|---|---|---|
| FR-1 / CAP-1 | `usage-window.ts` markers + tail matcher + corroboration | E-1, E-2 |
| FR-2 / CAP-2 | `usage-window.ts` `parseResetTime` (3 shapes, past→null) | E-1, E-3 |
| FR-3 | driver pre-ladder interception; `ladder.ts` untouched | E-1, E-5 |
| FR-4 / CAP-3 | `usage-governor.ts` `planPause` + chunked `runPause` | E-1, E-3, E-6 |
| FR-5 / CAP-4 | `LoopStatus "paused"`, gather widening, `windowPauses[]`, report section | E-1, E-4 |
| FR-6 / CAP-5 | `config.ts` + `_devx/config-schema.json` + `docs/CONFIG.md` | E-5 |
| FR-7 / CAP-6 | inert `probeUsage()` + corrected docs/report prose | (prose; no runtime behavior to assert) |
| FR-8 | separate spike story — findings doc, no production code | E-7's sibling; parked |

## Risks

- **The marker set is seeded, not observed.** `USAGE_LIMIT_MARKERS` comes
  from known message shapes, not from captured real transcripts. The
  corroboration rule (FR-1) is what makes a too-narrow set fail safe: a
  missed marker degrades to today's behavior, which is the pre-governor
  status quo, not a regression. A too-WIDE set is the dangerous direction,
  and is why E-2 is P0.
- **G-1/E-7 cannot be satisfied in a normal session.** It needs a real
  overnight run riding a real reset. Treated as human-gated from the start
  and scoped into its own phase, so the reactive machinery can ship and be
  green without it — the pin105 shape, deliberately, rather than a phase
  that sits blocked with mixed content.
