# E-7 — Live overnight ride-through (human-gated)

**Priority:** P1 · **Covers:** G-1, UC-1 · **Phase:** 4 (`uwg104`)

This is not a test. It is the record of a supervised overnight run, and it
is the only artifact in this workstream that a session cannot produce.

## Why it is a document and not a test

Every other expectation is reachable with the driver's fake `now` / `sleep` /
`worker` seams, which is the whole reason the governor is designed around a
pure `planPause`. E-7 is different in kind: it asserts that the **real**
message shapes emitted by a **real** usage limit are matched by
`USAGE_LIMIT_MARKERS`, and that a **real** reset actually wakes the loop.

`USAGE_LIMIT_MARKERS` is seeded from known message shapes, not from captured
transcripts (design.md § Risks). A fixture can only prove the detector
matches what we *think* the message says. That gap is exactly what this
eval closes, and nothing else can.

## Procedure

1. Start a supervised run: `caffeinate -dimsu devx loop --until 07:30`
   (per `project_devx_loop_sleep_kills_iterations` — machine sleep has
   killed whole runs here).
2. Let it run through at least one real usage-window reset.
3. In the morning, capture into this file:
   - the morning report's **Usage-window pauses** section, verbatim;
   - the `loop:usage-pause` events from `events.jsonl`, verbatim — these
     carry the raw marker text, which is the corpus evidence;
   - the PRs merged **before** and **after** the pause.

## Pass criteria (from expectations.md E-7)

- ≥ 1 real pause segment in the morning report
- ≥ 1 PR merged before the pause AND ≥ 1 after
- zero loop aborts attributable to the usage limit
- the raw marker text captured above is matched by the shipped
  `USAGE_LIMIT_MARKERS` (paste it into a unit case afterwards — the corpus
  is the deliverable)

## Failure is informative, not just a red

If the loop rode the ladder instead of pausing, the captured raw text tells
us which marker shape we missed, and the fix is a widened regex plus a unit
case built from the real string. That is a **better** outcome than a green
night with no evidence, and it is why step 3 captures the events verbatim
whether the run passed or failed.

## Also discharges

`MANUAL.md` MV2.1 — the S-3 supervised first night of `devx loop`.

## Record

_(unrun — awaiting a supervised night)_
