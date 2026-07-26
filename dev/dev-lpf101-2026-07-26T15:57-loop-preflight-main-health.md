---
hash: lpf101
type: dev
created: 2026-07-26T15:57:00-06:00
title: Loop preflight main-health check
from: dev/dev-hfiret-2026-07-24T10:43-retro-harness-fold-in.md
status: ready
owner: null
branch: feat/dev-lpf101
---

## Goal

`devx loop` probes main's health at run start and refuses (or loudly flags)
starting a run when main is already red — a red main taxes every worker with
re-learning "that failure is baseline" and blurs the `acs_met` signal.

Evidence (hfiret retro, `LEARN.md § epic-harness-fold-in` E7): the
hfi101-induced discipline red sat on main ~a day during the epic's loop runs;
four separate hfi102 iterations re-derived the discount, and hfi104 fixed
main's red from inside an unrelated item because its own suite couldn't go
green otherwise.

## Acceptance criteria

- [ ] Loop entry runs a cheap main-health probe before claiming any item.
      Cheapest sufficient signal (implementer's choice, justify in status
      log): last remote-CI conclusion on `main` via `gh run list --branch
      main --limit 1` — do NOT run the full local suite (~7 min) as preflight.
- [ ] When main is red: default behavior is refuse-with-reason (report names
      the failing run/commit); a `--force` / config knob permits starting
      anyway, in which case the morning report and every iteration prompt
      carry a "main is red at <sha>: <failing check> — treat as baseline"
      line so workers don't re-derive it.
- [ ] When the probe itself fails (gh auth/network), the loop proceeds but
      records the unknown-health state in the report (uncertainty must not
      block an overnight run, per the failure-ladder philosophy).
- [ ] Tests: red-main refusal, forced-start baseline line threading,
      probe-failure passthrough.

## Technical notes

- Home: `src/lib/loop/` (entry/preflight), config under `loop:` in
  `devx.config.yaml` + `docs/CONFIG.md` row.
- Sibling of the dc7514 sleep-aware ceiling work — same "the loop must model
  its substrate honestly" class.

## Status log

- 2026-07-26T15:57:00-06:00 — filed by hfiret retro (E7, med/code).
