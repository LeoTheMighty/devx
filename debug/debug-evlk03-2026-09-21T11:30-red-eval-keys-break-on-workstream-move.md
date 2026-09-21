---
hash: evlk03
type: debug
created: 2026-09-21T11:30:00-06:00
title: "red_eval_shas keys are repo-relative, so devx archive / layout migrate turn every stamped eval into `missing`"
from: debug/debug-75563d-2026-09-02T09:20-red-eval-sha-lock-unwired.md
spawned: []
status: ready
owner: null
branch: null
---

## Goal

`gate_status.red_eval_shas` is keyed by **repo-relative** artifact path — the
only form that works in general, since a phase verified by `test/foo.test.ts`
has no workstream-relative spelling. But `devx archive` and
`devx layout migrate` *move* a workstream, so any stamped eval under the
workstream directory (`_devx/workstreams/<slug>/evals/…`) is then read by
`--verify` at its old path and reported `missing` — exit 1, a hard stop.

75563d's status log recorded this as a known limitation and "a real
follow-up". **No follow-up was filed**; this spec is it.

The failure direction is safe — it reports rather than silently passing — but
a false hard stop on every moved workstream is the cry-wolf failure that gets a
lock switched off.

## Acceptance criteria

1. `devx archive` and `devx layout migrate` rewrite `red_eval_shas` keys for
   artifacts under the moved workstream directory, preserving each sha.
2. Artifacts outside the workstream (e.g. `test/…`) are untouched.
3. A test that stamps, moves the workstream, and asserts `--verify` still
   passes — FAILS on current `main`.

## Status log

- 2026-09-21T11:30-06:00 — filed from the retroactive review of #164. Makes
  true a follow-up that 75563d's status log claimed was already filed.
