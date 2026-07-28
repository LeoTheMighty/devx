---
hash: 9b9be5
type: debug
created: 2026-07-26T15:41:23-06:00
title: devx gate evals lacks mid-flight state-awareness after revise cascade
from: DEBUG.md intake (rooted-light session 2026-07-25)
status: in-progress
owner: /devx-loop-2026-07-28T15-08-44-989-68192
branch: feat/debug-9b9be5
---

## Goal

After a `devx revise` cascade on a workstream with already-shipped phases, the
RED gate (`devx gate evals`) should not demand that evals whose phases already
merged be RED — they are green by definition. It should defer them (or offer a
first-class waiver) instead of failing the gate.

Expected behavior: replaying gates post-revise passes when the only non-RED
evals are ones whose "Verified in phase" points at a `done` dev spec; and an
operator can record a D-9 WAIVED verdict via the CLI instead of hand-editing
`RED-report.md`.

## Acceptance criteria

- [ ] Repro exists: a failing test (or runnable repro script) showing `devx
      gate evals` blocking on a shipped-green eval after a revise cascade.
- [ ] Root cause documented with evidence in the status log.
- [ ] Fix: evals whose "Verified in phase" resolves to a dev spec with
      `status: done` are deferred (not required RED) by the gate, with a
      regression test.
- [ ] Fix: `devx gate evals --waive <E-n> --reason <reason>` (flag shape at
      implementer's discretion) writes a valid D-9 WAIVED verdict into the RED
      report — no hand-edit route required.
- [ ] P0 evals: deferred/waived shipped-green evals no longer block.

## Technical notes

- Original repro (external repo): rooted-light @ workstream `cdea58`,
  2026-07-25 — `devx revise cdea58 --touched prd.md` after rlw102/rlw104
  merged, then replay gates: prd PASS, coverage(design) PASS, coverage(plan)
  PASS, evals FAIL on shipped-green E-1/E-5/E-6 while E-2/E-3/E-4/E-7 are
  correctly RED ("expected RED but exited 0").
- For this repo's regression test, reconstruct the shape with a fixture
  workstream: shipped phase (done dev spec) + pending phases, then run the
  gate.
- D-9 (decision ledger) already defines the WAIVED verdict; the gap is that no
  CLI path writes it.

## Status log

- 2026-07-26T15:41:23-06:00 — spec filed from DEBUG.md intake row (rooted-light session 2026-07-25); repro documented from the original session's gate replay output.
- 2026-07-28T09:08:44-06:00 — claimed by /devx in session /devx-loop-2026-07-28T15-08-44-989-68192

## Links

- DEBUG.md intake row (2026-07-25, rooted-light session)
- v2/07-decisions.md D-9 (WAIVED verdict)
