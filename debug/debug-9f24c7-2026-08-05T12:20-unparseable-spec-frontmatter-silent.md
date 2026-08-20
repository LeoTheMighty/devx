---
hash: 9f24c7
type: debug
created: 2026-08-05T12:20:00-06:00
title: "Unparseable spec frontmatter reads as an empty block everywhere — 5 shipped specs were invisible to the engine"
from: dev/dev-sgr106-2026-08-02T13:57-graph-backfill.md
status: blocked
owner: /devx-loop-2026-08-19T19-39-20-483-20983
---

## Goal

A spec whose frontmatter YAML does not parse should be reported, not
silently treated as a spec that records nothing.

`readEngineState` (`src/lib/engine/frontmatter.ts`) parses with
`parseDocument` and never inspects `doc.errors`. On a parse failure it
returns the all-defaults `EngineState`: `status: null`, `blockedBy: []`,
`phase: null`, `plan: null`, all gate flags `false`. That is the correct
posture for a READER that must not crash a gate — but it is indistinguishable
from a spec that genuinely records none of those things, and every consumer
inherits the confusion: `devx next`, `reconcile`, the loop's pick, the gate
CLIs, `resolveSpecWorkstream`, and the graph model all read the same
function.

Found by `devx graph backfill`'s first real run (sgr106): the completion pass
proposed writing `blocked_by: [mgr101]` onto `dev/dev-mgr102`, which already
had exactly that line. The edge was not missing; the file was unreadable.

**Five shipped specs were affected**, in two shapes, both an unquoted
`title:` scalar:

- `title: State persistence: schedule.json + …` — a bare `: ` inside a plain
  scalar (`dev-mgr102`, `dev-mgr103`).
- ``title: `devx --help` listing…`` — a leading backtick, a YAML reserved
  character (`dev-cfg204`, `dev-cli303`, `dev-cli304`).

sgr106 fixed those five data instances (quoted the titles) and added
`frontmatterParseError(content)` next to `readEngineState`, which backfill
uses to report the class instead of writing through it. **The class itself is
still open**: the next hand-authored spec with a colon or backtick in an
unquoted title goes invisible again, silently.

## Acceptance criteria

- [ ] AC 1: Repro — a fixture spec with an unquoted `title:` containing `: `
      is shown to read as an empty `EngineState`, with its real `status:`
      and `blocked_by:` lost. Committed as a failing/asserting test.
- [ ] AC 2: A mechanical guard so the class cannot recur silently. Preferred
      shape: a suite assertion that every spec under the type dirs parses
      (`frontmatterParseError` returns null) — it is one readdir and runs in
      CI on every PR. `devx doctor` (dev-db36af) is the natural second home
      for the `--fix` half.
- [ ] AC 3: Decide and record whether `readEngineState` should keep failing
      soft. Recommendation: yes, keep it soft — but every call site that can
      report (the gates, `devx next`'s drift rows, `devx status`) should
      consult `frontmatterParseError` and say "unreadable" rather than
      render a confident empty state. Do not change the reader's return
      shape without a survey of consumers.
- [ ] AC 4: Confirm no OTHER durable state was lost while these five were
      unreadable — in particular whether any gate verdict, `phase:`, or
      `blocked_by:` on the five was acted on as absent (all five are
      `status: done`, so the blast radius is expected to be nil; verify,
      don't assume).

## Technical notes

- `applyEnginePatch` already fails LOUD on the same input (it throws when
  `doc.errors.length > 0`), so reader and writer disagree about the same
  file. That asymmetry is the bug's fingerprint and a good place to start.
- Do NOT "fix" this by making `readEngineState` throw — a half-edited spec
  crashing a gate is the failure mode the soft posture was chosen to avoid.
- `frontmatterParseError` already exists (sgr106) and returns the first YAML
  error message; the guard in AC 2 should wrap it, not re-implement it.

## Status log

- 2026-08-05T12:20 — filed from sgr106 Phase 4/Phase 5 (the attended backfill
  run surfaced it; 5 data instances fixed there, class left open here).
- 2026-08-19T23:39:52-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-20T14:37:51.285Z — [FAIL] loop abandoned 9f24c7: push failed (commit preserved locally): ssh_dispatch_run_fatal: Connection to 140.82.114.3 port 22: Broken pipe; worktree preserved at .worktrees/debug-9f24c7
