---
hash: sup401
type: dev
created: 2026-04-26T19:35:00-07:00
title: Supervisor stub script + idempotent install
from: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
blocked_by: [cli301]
branch: develop/dev-sup401
---

## Goal

Ship the placeholder `supervisor-stub.sh` script template + the idempotent installer that copies it to `~/.devx/bin/devx-supervisor-stub.sh`. State written at `~/.devx/state/supervisor.installed.json` so re-runs detect via hash.

## Acceptance criteria

- [ ] `_devx/templates/supervisor-stub.sh` ships with the npm package
- [ ] Stub body: prints `[devx-${role}] not yet wired ($(date -Iseconds))` then `exec sleep infinity`
- [ ] `installStub()` in `src/lib/supervisor.ts` copies template to `~/.devx/bin/devx-supervisor-stub.sh`, chmods +x, atomic (tmp + rename)
- [ ] `~/.devx/state/supervisor.installed.json` updated with stub-content hash
- [ ] Re-install with same hash → no-op + "kept" return value
- [ ] Re-install with different hash → rewrite + "rewritten" return value + bump state file
- [ ] Vitest covers fresh / no-op / rewrite paths
- [ ] Function `uninstallStub()` exported (used by Phase 10's eject)

## Technical notes

- `exec sleep infinity` is critical: exit-0 with KeepAlive=true on launchd hot-restart-loops.
- Cross-platform `~/.devx/` resolution: macOS `~/.devx/`; Linux/WSL `~/.devx/` (NOT XDG — keep all devx state under one user-visible dir).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
