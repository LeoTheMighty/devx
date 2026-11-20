---
id: E-1
priority: P0
covers: [G-1]
expectation: '<verbatim from expectations.md>'
status: red      # red | green — last result of the non-deferred steps
last_run: null   # stamped on every Runs row
---

# E-1: <title>

<!-- One per expectation, at `evals/E-<n>_<slug>.md`, named by its
     `Verified by:`. Only for an eval that is NOT a test file: a production
     measurement, a judged output, a human procedure. A runnable test is a
     better eval — name it directly.

     `(measured at outcome)` marks a step DEFERRED: it cannot pass before the
     thing is live, so `devx gate evals` demands no RED from it (at any
     priority, when EVERY step is deferred) and `devx outcome score --run`
     runs it later to score the `G-` this expectation Covers. `Run:` prints
     the value as its LAST stdout line.

     Gate 4 hashes the step body — `Run:`, `Expected:`, `Threshold:`,
     `Window:`, tables outside `## Runs`. `Status:`/`last_run:`/`Verdict:`/
     `Result:` and the `## Runs` rows stay writable, so recording a run is
     never an edit. Fix the code, not the eval; a changed expectation is
     `devx revise`. -->

## Preconditions

<what must be running first, with the exact commands>

## Steps

### 1. script — <what this asserts>

- **Run:** `<command>`
- **Expected:** <exit code / output match>
- **RED today because:** <the missing behavior — or `(setup — expected green)`>

### 2. metric — <the number that scores a business goal> `(measured at outcome)`

- **Run:** `<command printing the value as its last stdout line>`
- **Window:** <fixed window, e.g. trailing 30d — so a re-run is comparable>
- **Expected:** <comparison to the goal's target, e.g. `>= 20`>
- **Result:** _(measured at outcome)_

## Runs

<!-- Appended on every result-of-record run (Gate 4, /devx Phase 5,
     `devx outcome score`), pass or fail. Debugging is not a run. -->

| Date | Run by | Result | Evidence |
|---|---|---|---|
| YYYY-MM-DD | devx gate evals | RED — right reason | <exit codes / quotes> |
