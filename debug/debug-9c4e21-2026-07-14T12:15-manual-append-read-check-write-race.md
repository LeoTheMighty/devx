---
hash: 9c4e21
type: debug
created: 2026-07-14T12:15:00-06:00
title: appendManualEntry read-check-write race can double-append or clobber concurrent MANUAL.md writes
from: dev/dev-pin102-2026-07-14T12:01-skills-installer-library.md
status: ready
owner: null
branch: feat/debug-9c4e21
---

## Goal

`appendManualEntry` (src/lib/init-failure.ts) is safe under concurrent
callers: two processes filing MANUAL.md entries at the same time never
double-append the same anchor kind and never lose each other's bullet.

## Acceptance criteria

- [ ] Repro exists: a test (or runnable script) demonstrating the race —
      two concurrent appends where one bullet is lost or one kind is
      duplicated.
- [ ] Root cause documented with evidence in this status log.
- [ ] Fix + regression test (e.g. an O_EXCL lock around the
      read-check-write sequence, or append-with-retry keyed on file
      mtime/content — reuse existing lock primitives, wrap-don't-duplicate).

## Technical notes

- Found during pin102's 3-agent adversarial review (PR #70). The write
  itself is atomic (`writeAtomic` tmp+rename) but the sequence
  read → anchor-check → write is not; the anchor idempotency check can
  miss a concurrent writer's entry, and the rename can clobber a bullet
  appended between the read and the write.
- Pre-existing class (shipped with the /devx-init failure path); pin102
  made it hotter — every `installSkills` run with a user-owned skill file
  now goes through this path, and Phase 2+ parallel agents / `devx loop`
  workers can overlap.
- Existing lock primitives to consider wrapping: the O_EXCL manager lock
  (mgr106, src/lib/manage/) and the spec lock in .devx-cache/locks/.

## Status log

- 2026-07-14T12:15 — filed by /devx during pin102 cleanup (out-of-scope
  finding from the 3-agent review; see PR #70 notes + tour blast radius).
