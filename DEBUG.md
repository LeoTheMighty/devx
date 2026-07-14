# DEBUG — Bugs to fix

Backlog for `/devx` debug routing. Each entry points at a spec file under
`debug/`. Repro-first: no repro → no fix.

- [/] `debug/debug-9c4e21-2026-07-14T12:15-manual-append-read-check-write-race.md` — appendManualEntry read-check-write race can double-append or clobber concurrent MANUAL.md writes. Status: in-progress. (Pre-existing class from the /devx-init failure path; made hotter by pin102's installSkills — found in PR #70's 3-agent review.)
