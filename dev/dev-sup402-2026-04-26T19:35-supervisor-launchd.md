---
hash: sup402
type: dev
created: 2026-04-26T19:35:00-07:00
title: macOS launchd plist generator + bootstrap
from: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx-2026-04-26T20:40-sup402
blocked_by: [sup401]
branch: feat/dev-sup402
---

## Goal

Implement the macOS supervisor installer: render `dev.devx.{manager,concierge}.plist` from template, install at `~/Library/LaunchAgents/`, register via `launchctl bootstrap`, verify via `launchctl print`.

## Acceptance criteria

- [ ] Template at `_devx/templates/launchd/dev.devx.<role>.plist` with `${HOME}` placeholder
- [ ] Plist keys: `Label`, `ProgramArguments` (stub-path + role), `RunAtLoad=true`, `KeepAlive=true`, `ProcessType=Interactive`, `ThrottleInterval=10`, `StandardOutPath`, `StandardErrorPath`
- [ ] Render + write to `~/Library/LaunchAgents/dev.devx.{manager,concierge}.plist`
- [ ] `launchctl bootstrap gui/$(id -u) <plist>` succeeds for both
- [ ] `launchctl print gui/$(id -u)/dev.devx.manager` exit 0 with `state = running`
- [ ] Idempotency: existing unit + matching hash → no-op; differing → `bootout` + `bootstrap`
- [ ] Logs land at `~/Library/Logs/devx/{manager,concierge}.{out,err}.log`
- [ ] Manual test (mac host): `launchctl kickstart -k gui/$(id -u)/dev.devx.manager` → unit auto-restarts within 10s
- [ ] `uninstallSupervisor('manager', 'launchd')` exported (calls `bootout` + removes plist)

## Technical notes

- `KeepAlive=true` (boolean, not dict) for unconditional restart.
- Avoid `ProcessType=Background` — gets aggressively throttled.
- Phase 0 idempotency check via hash sidecar from sup401.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T20:40 — claimed by /devx in session 2026-04-26T20:40-sup402
- 2026-04-26T20:46 — implemented + self-reviewed; launchd plist template + render/install/uninstall via injectable launchctl exec; supervisor.ts refactored to share helpers via supervisor-internal.ts; installSupervisor/uninstallSupervisor dispatch added. MANUAL.md MS.1 added for on-host kill-and-watch-restart. 17 new tests (133 total green).
- 2026-04-26T20:48 — merged via PR #14 (squash → c2c7044)
