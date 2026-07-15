# Expectations — Usage-window governor

<!-- Gate 1 input. Every G- covered; every Covers: ID resolves in prd.md.
     P0 Verified-by targets are runnable test paths (RED gate authors the
     failing tests at exactly these paths). -->

## E-1: Window hit pauses, same item resumes, counters untouched

- **Priority:** P0
- **Covers:** G-2, G-3, UC-1, CAP-3, CAP-4, FR-3, FR-4, FR-5
- **Trigger:** Fake worker emits `...usage limit reached|<epoch>` on the
  initial attempt AND on the retry; fake clock then passes the epoch.
- **Expectation (EARS):** When a worker iteration ends with a usage-limit
  marker carrying a parseable reset time, the system SHALL pause the loop,
  resume the same claimed item after the reset time passes, move zero
  failure/abandon counters, charge zero iterations against
  `maxIterationsPerItem`, append no `[FAIL]`/`[ERROR]` status-log lines,
  and record the pause segment in the run summary and morning report.
- **Threshold:** consecutiveFailures == consecutiveErrors ==
  consecutiveAbandonedItems == 0 after resume; resumed item hash ==
  paused item hash; windowPauses.length == 1 with durationMs > 0; morning
  report contains a "Usage-window pauses" section with that segment;
  loop exit code == 0.
- **Verified by:** test/loop-usage-window.test.ts

## E-2: Mid-transcript marker with valid report is not a pause

- **Priority:** P0
- **Covers:** UC-5, CAP-1, FR-1
- **Trigger:** Worker rawOutput contains a usage-limit marker string
  mid-transcript (outside the scan tail) and ends with a valid parseable
  report envelope, exit code 0.
- **Expectation (EARS):** When a usage-limit marker appears only outside
  the transcript tail and the iteration produces a valid trailing report,
  the system SHALL classify the iteration by its report (success) and
  SHALL NOT pause.
- **Threshold:** iteration classified success; windowPauses.length == 0;
  zero pause-related sleep calls recorded by the fake sleep seam.
- **Verified by:** test/loop-usage-window.test.ts

## E-3: Unknown reset degrades to probe cadence, bounded by max-pause

- **Priority:** P1
- **Covers:** G-2, UC-2, CAP-2, CAP-3, FR-2, FR-4
- **Trigger:** Usage-limit marker with no parseable reset time (or a
  past-dated timestamp); fake probe worker never succeeds.
- **Expectation (EARS):** When a usage-limit hit carries no usable reset
  time, the system SHALL probe on the configured
  `usage_probe_interval_ms` cadence and SHALL abort cleanly with the
  weekly-limit reason once cumulative pause exceeds `usage_max_pause_ms`.
- **Threshold:** recorded probe sleeps == usage_probe_interval_ms (default
  900000); abort reason names the weekly-limit explanation; abandoned-item
  and failure counters remain 0; abort is clean (summary + report written).
- **Verified by:** test/loop-usage-window.test.ts

## E-4: Paused loop reads as alive, never crashed

- **Priority:** P1
- **Covers:** UC-3, CAP-4, FR-5
- **Trigger:** Loop enters a usage-window pause; `devx next`'s loop-signal
  gather runs against the live heartbeat state while paused.
- **Expectation (EARS):** When the loop is paused on a usage window with a
  fresh heartbeat, the system SHALL report the loop as alive in `devx
  next`'s row-1 loop signal and SHALL record the pause in the JSONL event
  log.
- **Threshold:** gather returns live == true for a paused heartbeat aged
  < 3 × heartbeat interval (default 180 s) and live == false when aged
  > 3 × interval; exactly 1 `loop:usage-pause` (or equivalent) event in
  events.jsonl per pause segment.
- **Verified by:** test/loop-usage-window.test.ts

## E-5: Kill switch restores today's behavior

- **Priority:** P1
- **Covers:** UC-4, CAP-5, FR-6
- **Trigger:** `loop.resume_on_reset: false` in merged config; fake worker
  emits the same usage-limit output as E-1.
- **Expectation (EARS):** When `resume_on_reset` is false and a
  usage-limit hit occurs, the system SHALL classify and act exactly as it
  does today (hard-error backoff path), with no pause machinery invoked.
- **Threshold:** decision sequence identical to a pre-governor run on the
  same script (backoff sleeps from `loop.backoff_ms`, counters move as
  today); windowPauses.length == 0.
- **Verified by:** test/loop-usage-window.test.ts

## E-6: --until clamps a pause that outlives the deadline

- **Priority:** P1
- **Covers:** UC-1, CAP-3, FR-4
- **Trigger:** Usage-limit hit whose parsed reset time lands after the
  `--until` deadline.
- **Expectation (EARS):** When the parsed reset time is later than the
  `--until` deadline, the system SHALL exit via the normal
  deadline-reached path instead of holding the pause.
- **Threshold:** loop exits with the in-progress/deadline stop reason
  before the reset time; total pause hold < (reset − hit) on the fake
  clock; exit code 0.
- **Verified by:** test/loop-usage-window.test.ts

## E-7: Live overnight ride-through

- **Priority:** P1
- **Covers:** G-1, UC-1
- **Trigger:** A real overnight `devx loop` run on this repo spanning at
  least one real usage-window reset (supervised per MANUAL.md MV2.1).
- **Expectation (EARS):** When a real overnight run hits a real usage
  window, the system SHALL pause, auto-resume after the real reset, and
  merge at least one item on each side of the pause.
- **Threshold:** ≥ 1 real pause segment in the morning report; ≥ 1 PR
  merged before the pause and ≥ 1 after; zero loop aborts attributable to
  the usage limit; run completes by 2026-08-15 (G-1 date).
- **Verified by:** evals/E-7_live-night.md
