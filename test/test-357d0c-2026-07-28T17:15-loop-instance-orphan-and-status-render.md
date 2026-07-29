---
hash: 357d0c
type: test
created: 2026-07-28T17:15:00-06:00
title: "Loop instance registry: crash-orphan-through-admission + devx status live-loops render"
from: dev/dev-mlc105-2026-07-28T09:02-instance-registry-admission.md
status: ready
owner: null
branch: null
---
## Goal

Close the two coverage gaps mlc105's review tour named explicitly (PR #98,
tour Stop 7 and the coverage rows). Both are real paths that ship today on
observation rather than on a test.

## Acceptance criteria

- [ ] AC 1: An end-to-end test drives a REAL crash-orphaned loop instance
      through admission: register an instance under a PID that is then
      killed (or a spawned-and-exited pid), and assert that (a) a fresh
      `runLoop` is ADMITTED rather than refused, (b) the orphan is not
      counted in `admitLoop`'s live set, and (c) the orphan file survives
      the reap while it is still fresh (evidence for the morning report)
      and is reaped once past `STOPPED_INSTANCE_TTL_MS`. Today this path is
      covered only by unit-level dead-PID fixtures plus one manual
      observation on the live repo during mlc105's first-real-run.
- [ ] AC 2: A test asserts `devx status`'s live-loops block — the
      `live loops: N` header, one line per run carrying scope / item +
      iteration / heartbeat age, and its fail-soft posture (a corrupt or
      unreadable `loop/instances/` omits the section and still exits 0).
      Today the block is verified only by the mlc105 real-run observation.
- [ ] AC 3: Both land in the existing suites (`test/loop-instances.test.ts`
      / `test/loop-driver.test.ts` / a status test) rather than a new
      parallel harness; `npm test` green.

## Technical notes

The registry, its seams and the probe overrides are
`src/lib/loop/instances.ts` (mlc105). `runStatus` already takes an
`fs` seam and, as of mlc105, a `now` seam — AC 2 needs no new production
surface. For AC 1, `runLoop`'s `pidAlive` seam plus `spawnSync("true").pid`
(the pattern `test/spec-lock.test.ts` and `test/loop-instances.test.ts`
already use for a provably-dead PID) should be enough without actually
killing a child mid-run.

## Status log

- 2026-07-28T17:15 — filed by mlc105 Phase 8 (gap-filing) from that PR's
  own review tour, which flagged both gaps rather than leaving them
  implicit. Out of mlc105's scope: neither is a defect in the shipped
  code, both are missing coverage of paths that shipped correct.

## Links

- Parent: `dev/dev-mlc105-2026-07-28T09:02-instance-registry-admission.md`
- PR: https://github.com/LeoTheMighty/devx/pull/98
- Tour: https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/mlc105/tour.html
