# DEBUG — Bugs to fix

Backlog for `/devx` debug routing. Each entry points at a spec file under
`debug/`. Repro-first: no repro → no fix.

- [x] `debug/debug-9c4e21-2026-07-14T12:15-manual-append-read-check-write-race.md` — appendManualEntry read-check-write race can double-append or clobber concurrent MANUAL.md writes. Status: done. PR: https://github.com/LeoTheMighty/devx/pull/71 (merged 25cf144). (Pre-existing class from the /devx-init failure path; made hotter by pin102's installSkills — found in PR #70's 3-agent review.)
- [x] `debug/debug-6a913f-2026-07-15T08:27-tour-gather-no-debug-spec-support.md` — devx tour gather AND devx merge-gate cannot resolve debug/ specs (findSpecForHash-style dev/ hardcoding duplicated per command), so debug-loop PRs ship without tours and the Phase 8 gate false-negatives with "manual merge required". (Found during debug-9c4e21 Phase 7.5 + Phase 8; claim already has --type debug — audit every hash-resolving CLI and centralize per-type spec resolution.) Status: done. PR: https://github.com/LeoTheMighty/devx/pull/72 (merged 1284e01).
- [/] `debug/debug-e3f1c2-2026-07-15T13:05-install-global-exec-bit.md` — install:global produces non-executable devx (dist/cli.js missing +x). Status: in-progress. From: user report 2026-07-15.
