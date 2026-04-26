---
hash: sup403
type: dev
created: 2026-04-26T19:35:00-07:00
title: Linux systemd-user .service generator + enable
from: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
blocked_by: [sup401]
branch: develop/dev-sup403
---

## Goal

Implement the Linux supervisor installer: render `devx-{manager,concierge}.service`, install at `~/.config/systemd/user/`, enable + start via `systemctl --user`, verify with `is-active`.

## Acceptance criteria

- [ ] Template at `_devx/templates/systemd/devx-<role>.service` using `%h` (home) + `%S` (state dir)
- [ ] Service keys: `Type=simple`, `ExecStart=%h/.devx/bin/devx-supervisor-stub.sh <role>`, `Restart=always`, `RestartSec=10`, `StartLimitIntervalSec=0`, `StandardOutput=append:%S/devx/<role>.out.log`, `StandardError=append:%S/devx/<role>.err.log`, `WantedBy=default.target`
- [ ] Render + write to `~/.config/systemd/user/devx-{manager,concierge}.service`
- [ ] `systemctl --user daemon-reload && systemctl --user enable --now devx-{manager,concierge}.service` succeeds
- [ ] `systemctl --user is-active devx-manager` returns `active`
- [ ] `manager.linger: true` config → invoke `loginctl enable-linger $USER`; default false (asked at init)
- [ ] Idempotency: identical .service file → no-op; differing → rewrite + `daemon-reload` + `restart`
- [ ] `uninstallSupervisor('manager', 'systemd')` exported (disables + stops + removes file)

## Technical notes

- `Restart=always`, NOT `Restart=on-failure` — we want restart on clean exit too.
- `StartLimitIntervalSec=0` prevents the unit from getting locked out after rapid restarts.
- Without `enable-linger`, units die at logout — opt-in.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
