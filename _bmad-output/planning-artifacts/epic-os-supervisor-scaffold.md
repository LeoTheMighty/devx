<!-- refined: party-mode 2026-04-26 -->

# Epic — OS supervisor unit-file scaffold

**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Slug:** `epic-os-supervisor-scaffold`
**Order:** 4 of 5 (Phase 0 — Foundation)
**User sees:** "After `/devx-init`, my OS confirms two devx units (`dev.devx.manager`, `dev.devx.concierge`) are loaded and would auto-restart — even though neither does anything yet."

## Overview

Cross-platform OS-level supervisor unit-file generators for the two long-running daemons `dev.devx.manager` and `dev.devx.concierge` — covering macOS (launchd), Linux (systemd-user), and Windows/WSL (Task Scheduler). Phase 0 ships only the unit-file generators + a placeholder script that the units exec. The actual daemon bodies arrive in Phase 1 (`/devx-manage`) and Phase 2 (`/devx-concierge`).

## Goal

Layer 1 of devx's three-layer staying-alive model (per `docs/DESIGN.md § Staying alive`). Once Phase 0 ships this epic, `launchctl` / `systemctl --user status` / `schtasks /Query` confirm devx is "running" — even though the unit body is currently `exec sleep infinity`. Phase 1 swaps the body without touching the unit files.

## End-user flow

1. Leonid runs `/devx-init`. Among the local-write steps, the supervisor installer fires for his platform (auto-detected from `uname`).
2. On macOS, two `.plist` files appear at `~/Library/LaunchAgents/dev.devx.{manager,concierge}.plist`. `launchctl bootstrap` registers both. Leonid runs `launchctl print gui/$(id -u)/dev.devx.manager` — returns 0; output shows the unit is loaded.
3. The unit's process is currently `~/.devx/bin/devx-supervisor-stub.sh manager` running `exec sleep infinity`. It logs one line on start (`[devx-manager] not yet wired (<ts>)`) to `~/Library/Logs/devx/manager.out.log` and stays blocked.
4. Leonid kills the process: `launchctl kickstart -k gui/$(id -u)/dev.devx.manager`. launchd auto-restarts it within 10s.
5. He logs out and back in. Both units are running again. Survives sleep, terminal close, SSH disconnect.
6. He re-runs `/devx-init`. Supervisor installer detects the existing units via the hash sidecar at `~/.devx/state/supervisor.installed.json`; no-op since hash matches; finishes in <1s.
7. (When Phase 1 lands, `~/.devx/bin/devx-supervisor-stub.sh` is replaced with the real binary launcher; the unit files stay byte-identical.)

## Frontend changes (CLI)

None directly — the supervisor installer is invoked from epic-init-skill, not exposed as a `devx <subcmd>`. (Phase 1+ may add `devx supervisor reinstall` or similar; not needed yet.)

## Backend changes

None.

## Infrastructure changes

- New shell script template `~/.devx/bin/devx-supervisor-stub.sh` (shipped with the npm package, copied to user home during install). Body:
  ```sh
  #!/usr/bin/env bash
  role="${1:-manager}"
  echo "[devx-${role}] not yet wired ($(date -Iseconds))"
  exec sleep infinity
  ```
- New macOS plist template at `_devx/templates/launchd/dev.devx.<role>.plist` (parameterized by `${HOME}`, `${role}`).
- New Linux service template at `_devx/templates/systemd/devx-<role>.service` (uses systemd's `%h` for home, `%S` for state dir).
- New Windows Task Scheduler XML template at `_devx/templates/task-scheduler/devx-<role>.xml`.
- New TypeScript module `src/lib/supervisor.ts` exporting `installSupervisor(role, platform)` + `verifySupervisor(role, platform)` + `uninstallSupervisor(role, platform)` (the last for Phase 10's `devx eject`).
- New idempotency state file at `~/.devx/state/supervisor.installed.json` carrying `{platform, role, hash, version}` per unit. Re-install rewrites only on hash change.
- Log dirs: `~/Library/Logs/devx/` (mac), `$XDG_STATE_HOME/devx/` or `~/.local/state/devx/` (linux), WSL `~/.local/state/devx/`. Created at install if absent.

## Design principles (from research)

- **`exec sleep infinity` is critical.** Exiting 0 with `KeepAlive=true` (mac) or `Restart=always` (linux) hot-restart-loops. Sleep-infinity makes the unit "running" without restart churn.
- **`Restart=always` on systemd, not `Restart=on-failure`.** We want restart on clean exit too (rot recovery in Phase 2).
- **`StartLimitIntervalSec=0` on systemd.** Otherwise the unit gets locked out after a few rapid restarts.
- **`KeepAlive=true` on launchd, not `RunAtLoad=true` alone.** RunAtLoad just starts at login; KeepAlive restarts on any exit.
- **Idempotent rewrite via hash sidecar.** Re-running `/devx-init` on an already-installed system is a sub-second no-op.
- **Same placeholder script for both roles.** Arg-dispatched (`manager` vs. `concierge`). One template, two units.
- **`loginctl enable-linger` on Linux is opt-in.** Default systemd-user units die at logout. We ask once during init; user opts in to "run when logged out."

## File structure

```
@devx/cli/                                                  ← npm package additions
├── _devx/templates/
│   ├── supervisor-stub.sh                                  ← shared placeholder script
│   ├── launchd/dev.devx.<role>.plist                       ← mac unit template
│   ├── systemd/devx-<role>.service                         ← linux unit template
│   └── task-scheduler/devx-<role>.xml                      ← windows unit template
├── src/
│   └── lib/
│       └── supervisor.ts                                   ← installer / verifier / uninstaller

# User-side outputs (after install):
~/.devx/
├── bin/
│   └── devx-supervisor-stub.sh                             ← copied from template
└── state/
    └── supervisor.installed.json                           ← {platform, role, hash, version}

# Mac:
~/Library/LaunchAgents/dev.devx.manager.plist
~/Library/LaunchAgents/dev.devx.concierge.plist
~/Library/Logs/devx/{manager,concierge}.{out,err}.log

# Linux:
~/.config/systemd/user/devx-manager.service
~/.config/systemd/user/devx-concierge.service
~/.local/state/devx/{manager,concierge}.{out,err}.log

# WSL:
(Task Scheduler entry registered via schtasks; logs in WSL ~/.local/state/devx/)
```

## Story list with ACs

### sup401 — Supervisor stub script + idempotent install
- [ ] `_devx/templates/supervisor-stub.sh` template ships with the package
- [ ] `installStub()` copies template to `~/.devx/bin/devx-supervisor-stub.sh`, chmods +x, idempotent
- [ ] `~/.devx/state/supervisor.installed.json` written with hash of stub content
- [ ] Re-install with same hash is a no-op (returns "kept" status)
- [ ] Re-install with different hash rewrites + bumps state file
- [ ] Vitest covers all three paths (fresh, no-op, rewrite)

### sup402 — macOS launchd plist generator + bootstrap
- [ ] `dev.devx.manager.plist` and `dev.devx.concierge.plist` rendered from template with the right `${HOME}` substitution
- [ ] `KeepAlive=true`, `RunAtLoad=true`, `ProcessType=Interactive`, `ThrottleInterval=10`
- [ ] `launchctl bootstrap gui/$(id -u) <plist>` succeeds for both
- [ ] `launchctl print gui/$(id -u)/dev.devx.manager` exits 0; verifies "running"
- [ ] Idempotency: existing unit + matching hash → no-op; differing hash → `bootout` + `bootstrap`
- [ ] Logs land at `~/Library/Logs/devx/{manager,concierge}.{out,err}.log`

### sup403 — Linux systemd-user .service generator + enable
- [ ] `devx-manager.service` and `devx-concierge.service` rendered with `%h` (`$HOME`) and `%S` (`$XDG_STATE_HOME`) specifiers
- [ ] `Restart=always`, `RestartSec=10`, `StartLimitIntervalSec=0`, `Type=simple`, `WantedBy=default.target`
- [ ] `systemctl --user daemon-reload && systemctl --user enable --now devx-{manager,concierge}.service` succeeds
- [ ] `systemctl --user is-active devx-manager` returns `active`
- [ ] Optional `loginctl enable-linger $USER` invoked iff config `manager.linger: true` (asked at init)
- [ ] Idempotency: identical service file → no-op; differing → rewrite + restart

### sup404 — Windows/WSL Task Scheduler XML generator
- [ ] `devx-manager.xml` and `devx-concierge.xml` rendered with the right WSL invocation: `wsl.exe -d <distro> -u <user> --exec ${HOME}/.devx/bin/devx-supervisor-stub.sh <role>`
- [ ] LogonTrigger set; `RestartOnFailure Interval=PT10S Count=999`; `ExecutionTimeLimit=PT0S`; `MultipleInstancesPolicy=IgnoreNew`
- [ ] Registration via `schtasks /Create /XML <file> /TN devx-manager /F`
- [ ] `schtasks /Query /TN devx-manager /V /FO LIST` exits 0
- [ ] Idempotency: existing task + matching XML hash → no-op; differing → `/Create /F` overwrite

### sup405 — Platform auto-detect dispatch + post-install verification
- [ ] `installSupervisor(role)` reads `manager.os_supervisor` from devx.config.yaml; `auto` resolves via `uname` → `launchd | systemd | task-scheduler`
- [ ] Explicit `os_supervisor: none` short-circuits all install steps and warns once via stderr
- [ ] Post-install verification calls the platform's status command and asserts "running" / "active" / "Ready"
- [ ] Verification failure surfaces as a single MANUAL.md entry (not an init abort)
- [ ] Cross-platform CI manual-test matrix documented at `docs/SUPERVISOR-TESTING.md`: install, verify, kill-and-watch-restart, uninstall (Phase 10)

## Dependencies

- **Blocks-on:** `epic-cli-skeleton` — supervisor units invoke `~/.devx/bin/devx-supervisor-stub.sh`, which in Phase 1 will be replaced by `devx --internal manage` or similar; the binary must exist on PATH for Phase 1 to drop in cleanly.
- **External:** macOS `launchctl` (built-in), Linux `systemd` (most distros), Windows `schtasks` (built-in).
- **Repo prerequisites:** None.

## Open questions

1. **`loginctl enable-linger` opt-in.** Default user units die at logout. Ask in `/devx-init` Q-extra ("run devx when logged out?"). **Lean: ask, default no.** Captured under epic-init-skill ini401.
2. **WSL boot trigger.** Without `wsl.exe` running, the Task Scheduler trigger doesn't actually exec inside WSL until something starts the distro. **Lean: document the limitation; LogonTrigger covers 95% of cases.** A `learn/` follow-up if real users hit this.
3. **`devx eject` uninstall path.** Phase 10's eject must `launchctl bootout` / `systemctl --user disable --now` / `schtasks /Delete`. Spec the function now (`uninstallSupervisor`); wire it Phase 10. **Captured: function exported in sup401, called by Phase 10.**

## Party-mode critique (team lenses)

- **PM**: Layer 1 of staying-alive shipped without daemon bodies. Approve. Worry: a user who runs `/devx-init` then `launchctl list` and sees "running" might think devx is actually doing something. Add to the "setting up now…" checkmark line for supervisor: "supervisor units installed (idle until Phase 1)".
- **UX**: N/A — no end-user CLI surface in this epic (init triggers it; user doesn't directly invoke).
- **Frontend (CLI)**: N/A this epic.
- **Backend**: N/A this epic.
- **Infrastructure**: Three concerns to capture as known limitations / docs:
  - **macOS Sonoma+** may show a notification on first launch-agent install ("background item added"). Document in `docs/SUPERVISOR-TESTING.md`. Doesn't block.
  - **systemd-user `enable-linger`** is opt-in (asked at /devx-init). Without it, units die at logout — a real footgun. ini501 must explicitly ask.
  - **WSL Task Scheduler trigger** doesn't fire when the WSL distro isn't running. Known limitation; LogonTrigger covers 95% of cases. Documented; first real-user encounter becomes a `learn/` follow-up.
- **QA**: sup405's verification step is good but missing the "kill-and-watch-restart" loop test that proves auto-restart works. Add to sup405 ACs: kill the supervisor process (SIGTERM), assert it restarts within 15s, repeat 3 times. Run on host platform during the integration test (mac/linux/WSL each).
- **Locked decisions fed forward**:
  - Single placeholder script `~/.devx/bin/devx-supervisor-stub.sh` arg-dispatched (`manager` vs. `concierge`).
  - `exec sleep infinity` in Phase 0 to prevent hot-restart loops; Phase 1 swaps the body without touching unit files.
  - launchd: `KeepAlive=true` (not `RunAtLoad` alone); `ProcessType=Interactive` (not `Background`); `ThrottleInterval=10`.
  - systemd: `Restart=always` (not `on-failure`); `StartLimitIntervalSec=0`; `WantedBy=default.target`.
  - Task Scheduler: LogonTrigger with `RestartOnFailure Interval=PT10S Count=999`; `wsl.exe -d <distro> -u <user> --exec ...`.
  - Idempotency via hash sidecar at `~/.devx/state/supervisor.installed.json`.
  - All devx state under `~/.devx/` (NOT XDG-split; one user-visible dir).
  - `uninstallSupervisor()` exported now, called from Phase 10's eject.
  - Verification failure files MANUAL.md but never aborts /devx-init.
  - "kill-and-watch-restart" test is part of sup405's ACs and runs in CI (per platform).

## Focus-group reactions

Skipped — YOLO mode.
