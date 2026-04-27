---
hash: sup405
type: dev
created: 2026-04-26T19:35:00-07:00
title: Platform auto-detect dispatch + post-install verification
from: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: in-progress
owner: /devx
blocked_by: [sup402, sup403, sup404]
branch: feat/dev-sup405
---

## Goal

Implement the top-level `installSupervisor(role)` and `verifySupervisor(role)` dispatchers that read `manager.os_supervisor` config (`auto | launchd | systemd | task-scheduler | none`) and route to the right platform installer.

## Acceptance criteria

- [ ] `installSupervisor(role)` reads `manager.os_supervisor` from `devx.config.yaml`
- [ ] `auto` resolves: macOS → `launchd`; Linux → `systemd`; WSL/Windows → `task-scheduler`
- [ ] Explicit `os_supervisor: none` short-circuits all install steps; warns once via stderr "supervisor disabled per config"
- [ ] `verifySupervisor(role)` calls platform's status command + asserts running/active/Ready
- [ ] Verification failure → file 1 MANUAL.md entry "supervisor unit failed verification: see <log path>"; do NOT abort init
- [ ] Cross-platform manual test docs at `docs/SUPERVISOR-TESTING.md`: install + verify + kill-and-watch-restart + uninstall (Phase 10)
- [ ] Vitest covers dispatch logic (mocked exec for each platform)

## Technical notes

- Platform detection: prefer `process.platform === 'darwin' | 'linux' | 'win32'` + WSL detection (`uname -r` contains `microsoft`).
- Verification failure ≠ install failure — units may be installed but not yet started; init should still complete.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T20:30 — claimed by /devx; branch feat/dev-sup405 (single-branch YOLO; develop/dev-sup405 in frontmatter was stale plan-time default)
