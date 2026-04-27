---
hash: sup404
type: dev
created: 2026-04-26T19:35:00-07:00
title: Windows/WSL Task Scheduler XML generator
from: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx-2026-04-26T21:30-sup404
blocked_by: [sup401]
branch: feat/dev-sup404
---

## Goal

Implement the Windows/WSL supervisor installer: render Task Scheduler XML invoking `wsl.exe -d <distro> -u <user> --exec ...`, register via `schtasks /Create /XML`, verify via `schtasks /Query`.

## Acceptance criteria

- [ ] Template at `_devx/templates/task-scheduler/devx-<role>.xml`
- [ ] XML contents: `LogonTrigger`, `RestartOnFailure Interval=PT10S Count=999`, `ExecutionTimeLimit=PT0S`, `MultipleInstancesPolicy=IgnoreNew`, `DisallowStartIfOnBatteries=false`, `StopIfGoingOnBatteries=false`
- [ ] Action: `wsl.exe -d <distro> -u <user> --exec ${HOME}/.devx/bin/devx-supervisor-stub.sh <role>` (`<distro>` + `<user>` substituted at install)
- [ ] Registration via `schtasks /Create /XML <file> /TN devx-{manager,concierge} /F`
- [ ] `schtasks /Query /TN devx-manager /V /FO LIST` exit 0
- [ ] Idempotency: existing task + matching XML hash → no-op; differing → `/Create /F` overwrite
- [ ] `uninstallSupervisor('manager', 'task-scheduler')` exported (`schtasks /Delete /F`)
- [ ] Document the LogonTrigger limitation: doesn't fire until WSL distro starts; covers 95% of cases

## Technical notes

- `wsl.exe` exits when the last process in the distro exits — sleep-infinity in stub keeps it blocking.
- Task Scheduler runs from Windows host; the actual command is in WSL via `wsl.exe`.
- For headless boot: `wsl.exe -u <user>` under SYSTEM account works with WSL2's automatic distro lifecycle.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T21:30 — claimed by /devx in session 2026-04-26T21:30-sup404
- 2026-04-26T21:48 — implemented + self-reviewed; task-scheduler XML template + render/install/uninstall via injectable schtasks exec; supervisor.ts dispatch routes task-scheduler. Substitutes `__ROLE__/__DISTRO__/__USER__/__WSL_HOME__` at install (deviation from AC: `${HOME}` baked in too because `wsl.exe --exec` doesn't spawn a shell). 20 new tests (172 total green).
- 2026-04-26T21:55 — merged via PR #16 (squash → 1c260ad)
