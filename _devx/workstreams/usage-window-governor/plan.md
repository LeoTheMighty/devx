# Plan — Usage-window governor

<!-- Stage: Plan. Gate: `devx gate coverage c8e2d4` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. Default to
     more, smaller phases. One phase ≙ one dev spec ≙ one PR. -->

## Current state

- A usage-limit worker failure rides the hard-error backoff ladder
  (`ladder.ts:67-76` — `PERMANENT_ERROR_MARKERS` covers credit/auth
  exhaustion only), bumps `consecutiveFailures` and `consecutiveErrors`,
  abandons the item after 3 strikes and kills the run after 3 abandoned
  items. Hours of walltime lost to weather.
- `capacity.usage_cap_pct: 95` is written by `init-write.ts:338` and read by
  nothing (grep-verified), while the config comment calls it the sole
  capacity gate.
- `gather.ts:710` trusts only `status === "running"`, so anything else reads
  as not-live.
- The driver already injects `now` / `sleep` / `signal`
  (`driver.ts:150-179`, `:530`), which is the whole reason a pause can be
  tested without a clock.

## Desired state

A usage-window hit is intercepted **before** the ladder is consulted
(**D-UW1**), pauses the loop in a bounded, sleep-aware way, resumes the same
item, and leaves a visible trace in the heartbeat, the summary and the
morning report — with a kill switch that short-circuits all of it.

## Phases

### Phase 1 — `uwg101`: detection floor (pure, ships inert)

`src/lib/loop/usage-window.ts`: `USAGE_LIMIT_MARKERS`,
`firstUsageMarkerInTail`, `parseResetTime`, `detectUsageWindowHit`.

Nothing calls it. That is deliberate: the module is pure, so its whole
contract is testable at unit level, and shipping it inert means Phase 2's
review can be about the *driver seam* rather than about regex semantics.
Same shape mss101 used (inert kernel, wired later), which worked.

- **Exit:** E-1's detection half and **E-2's DETECTOR half** pass against the
  new module. E-2 is P0 and its detector half lands here because the
  false-positive guard must be proven before anything is wired to it — but
  E-2's thresholds also include `windowPauses.length == 0` and "zero
  pause-related sleep calls", which are driver-level and unreachable from an
  inert module. **E-2 is not discharged until uwg102**; saying "in full" here
  would have let a P0 read as closed on half its evidence.
- **Verification:** `tests-alongside`. Re-run the RED artifact
  (`test/loop-usage-window.test.ts`, E-2 cases) and watch it fail for the
  stated reason before writing the module.
- **Review shape:** marker-bearing regex surface → 3-agent parallel
  regardless of line count (the LEARN marker-discipline pattern).

### Phase 2 — `uwg102`: governor + driver seam

`src/lib/loop/usage-governor.ts` (`planPause` pure, `runPause` impure) plus
the single interception point in `driver.ts`'s `runItem`, guarded by the
kill switch checked first.

- **Exit:** E-1 (full), E-3, E-5, E-6 pass. `ladder.ts` has **zero** diff —
  that is an assertable property and the reviewer should check it.
- **Verification:** `tests-first` for E-1 (the P0), tests-alongside for the
  rest.
- **Risk note:** this is the phase that touches the driver, the file every
  loop test exercises. Expect the local gate to be the long pole; budget a
  whole iteration for it (`project_full_suite_exceeds_foreground_timeout`).

### Phase 3 — `uwg103`: state, heartbeat, summary, report, config

`LoopStatus "paused"`, `gather.ts` liveness widening, `windowPauses[]` on
`RunSummary`, the morning-report section + header total, the four `loop:`
knobs in **both** `config.ts` and `_devx/config-schema.json`, and the FR-7
honesty pass (`probeUsage()` inert + corrected `devx.config.yaml` comment,
`docs/CONFIG.md` §2 and §15b, report line).

- **Exit:** E-4 passes; `devx config` accepts the new knobs (the schema half
  is what makes that true); `docs/CONFIG.md` no longer documents the removed
  dollar-cap knobs.
- **Verification:** tests-alongside.
- **Sizing note:** grouped rather than split because these are one concern —
  "a pause is visible everywhere a run's state is visible" — and splitting
  them would ship a `LoopStatus` value that `gather` rejects.

### Phase 4 — `uwg104`: live overnight ride-through (**human-gated**)

E-7 / G-1. A real supervised overnight run spanning a real reset, which also
discharges `MANUAL.md` MV2.1.

**Scoped as its own phase precisely because it cannot be satisfied in a
session.** The pin105 shape, deliberately: a phase whose content is
half-scriptable and half-human ends up `[-] blocked` with the scriptable
part hostage. Here Phases 1–3 ship and go green on their own, and this phase
carries only the thing a human must do. Its spec files a `MANUAL.md` row and
records the night's evidence in its own status log.

### Phase 5 — `uwgspike`: usage-probe API investigation (timeboxed)

FR-8. Findings doc only; no production code beyond (if trivially proven) a
probe behind the existing `probeUsage` seam. Gates whether the proactive 95%
cap is plannable at all.

### Phase 6 — `uwgret`: retro

## Dependencies

`uwg101` → `uwg102` → `uwg103`. `uwg104` blocked-by `uwg103` (needs the
report section to have something to show). `uwgspike` is **parallel-safe
with all of them** — it touches no production code. `uwgret` blocked-by
uwg101–103 (not uwg104: a human-gated phase must not hold the retro
hostage, which is exactly what happened to pinret).

## Coverage table

| E-id | Phase | Validation | Artifact |
|---|---|---|---|
| E-1 | 2 (detection half in 1) | tests-first | `test/loop-usage-window.test.ts` |
| E-2 | 1 | tests-first | `test/loop-usage-window.test.ts` |
| E-3 | 2 | tests-alongside | `test/loop-usage-window.test.ts` |
| E-4 | 3 | tests-alongside | `test/loop-usage-window.test.ts` |
| E-5 | 2 | tests-alongside | `test/loop-usage-window.test.ts` |
| E-6 | 2 | tests-alongside | `test/loop-usage-window.test.ts` |
| E-7 | 4 | live (human-gated) | `_devx/workstreams/usage-window-governor/evals/E-7_live-night.md` |

## Out of scope (restated from the PRD, so a phase author does not drift in)

Proactive 95% cap enforcement · priority tiers · external-scheduler
`--resume <run-id>` · fleet-wide pause propagation · dollar caps.
