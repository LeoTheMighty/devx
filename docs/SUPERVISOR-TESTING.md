# SUPERVISOR-TESTING.md

Manual test matrix for the OS supervisor scaffold (Phase 0 epic
`epic-os-supervisor-scaffold`). The unit tests under `test/supervisor-*.test.ts`
cover dispatch + idempotency + verify logic against injected exec mocks; this
file covers what those tests deliberately can't — driving real `launchctl` /
`systemctl` / `schtasks` against a real host and watching the unit auto-restart
after a kill.

> **When to run this.** After a meaningful change to any
> `_devx/templates/{launchd,systemd,task-scheduler}/*` file or to
> `src/lib/supervisor*.ts`. CI does not run any of the steps below — there is
> no remote host that has launchd or schtasks. The kill-and-watch-restart
> proof is the load-bearing claim, and it has to happen on a host with the
> real supervisor.

## Prerequisites

- The package built: `npm run build` (otherwise `_devx/templates/` is the
  source-of-truth, but the dispatchers under `dist/` won't reflect your
  changes).
- A test `devx.config.yaml` with `manager.os_supervisor: auto` in the cwd, or
  pass an explicit platform via `installSupervisor(role, { platform: ... })`
  from a Node REPL.
- `~/.devx/bin/devx-supervisor-stub.sh` installed (sup401 — `installStub()`).

The scriptlets below assume role `manager`; substitute `concierge` for the
second unit. Both should be installed and verified.

## macOS / launchd

### Install

```sh
node -e '
  import("./dist/lib/supervisor.js").then(m => {
    console.log(m.installSupervisor("manager"));
    console.log(m.installSupervisor("concierge"));
  });
'
```

Expected: prints `fresh` (or `kept`/`rewritten` on re-run). Two plist files at
`~/Library/LaunchAgents/dev.devx.{manager,concierge}.plist`. Two state-file
records at `~/.devx/state/supervisor.installed.json`.

### Verify (status)

```sh
launchctl print "gui/$(id -u)/dev.devx.manager"   | grep "state ="
launchctl print "gui/$(id -u)/dev.devx.concierge" | grep "state ="
```

Expected: `state = running` for both. The Phase 0 stub body is
`exec sleep infinity`, so the unit stays running indefinitely.

`verifySupervisor(role)` from `src/lib/supervisor.ts` runs the same `launchctl
print` and parses for `state = running`. Failure files a single MANUAL.md
entry; init never aborts on a bad verify.

### Kill-and-watch-restart proof

```sh
PID_BEFORE=$(launchctl print "gui/$(id -u)/dev.devx.manager" | awk '/^\tpid =/ {print $3}')
launchctl kickstart -k "gui/$(id -u)/dev.devx.manager"
sleep 12
PID_AFTER=$(launchctl print "gui/$(id -u)/dev.devx.manager" | awk '/^\tpid =/ {print $3}')

[[ "$PID_BEFORE" != "$PID_AFTER" ]] && echo "RESTARTED OK" || echo "FAILED"
```

Expected: `RESTARTED OK` within 12s of the kill. `KeepAlive=true` +
`ThrottleInterval=10` together guarantee the unit comes back. Repeat 3× to
confirm the throttle resets cleanly after each restart.

### Logout / login

Log out of the macOS user session (Apple → Log Out…) and log back in. Run the
verify step above; both units should be `state = running` again.

### Uninstall (Phase 10 dry-run)

```sh
node -e '
  import("./dist/lib/supervisor.js").then(m => {
    console.log(m.uninstallSupervisor("manager"));
    console.log(m.uninstallSupervisor("concierge"));
  });
'
launchctl print "gui/$(id -u)/dev.devx.manager"  # expect "Could not find service"
ls ~/Library/LaunchAgents | grep dev.devx        # expect empty
```

## Linux / systemd-user

### Install

```sh
node -e '
  import("./dist/lib/supervisor.js").then(m => {
    console.log(m.installSupervisor("manager"));
    console.log(m.installSupervisor("concierge"));
  });
'
```

Expected: two `.service` files at `~/.config/systemd/user/devx-{manager,concierge}.service`,
both enabled and started. State file mirrors as on macOS.

### Verify (status)

```sh
systemctl --user is-active devx-manager.service     # expect "active"
systemctl --user is-active devx-concierge.service   # expect "active"
systemctl --user status devx-manager.service        # full block — expect "Active: active (running)"
```

### Kill-and-watch-restart proof

```sh
PID_BEFORE=$(systemctl --user show -p MainPID --value devx-manager.service)
kill -TERM "$PID_BEFORE"
sleep 12
PID_AFTER=$(systemctl --user show -p MainPID --value devx-manager.service)

[[ "$PID_BEFORE" != "$PID_AFTER" && "$PID_AFTER" != "0" ]] && echo "RESTARTED OK" || echo "FAILED"
```

Expected: `RESTARTED OK`. `Restart=always` + `RestartSec=10` +
`StartLimitIntervalSec=0` guarantee unbounded restart attempts.

### Logout / login (linger opt-in)

Default systemd-user units die at logout. Re-install with linger to survive:

```sh
node -e 'import("./dist/lib/supervisor.js").then(m => m.installSupervisor("manager", { linger: true }))'
loginctl show-user "$USER" | grep Linger   # expect "Linger=yes"
```

Then log out, log back in, and re-run the verify step.

### Uninstall (Phase 10 dry-run)

```sh
node -e '
  import("./dist/lib/supervisor.js").then(m => {
    console.log(m.uninstallSupervisor("manager"));
    console.log(m.uninstallSupervisor("concierge"));
  });
'
systemctl --user list-unit-files | grep devx-   # expect empty
```

## Windows / WSL — Task Scheduler

Run from a Windows Command Prompt or PowerShell, with WSL installed and the
target distro available.

### Install

```sh
node -e "import('./dist/lib/supervisor.js').then(m => { console.log(m.installSupervisor('manager')); console.log(m.installSupervisor('concierge')); })"
```

Expected: two XML files at `<devxHome>\state\task-scheduler\devx-{manager,concierge}.xml`,
both registered with Task Scheduler.

### Verify (status)

```cmd
schtasks /Query /TN devx-manager /V /FO LIST
schtasks /Query /TN devx-concierge /V /FO LIST
```

Expected: `Status: Ready` (waiting for next logon) or `Status: Running` (the
LogonTrigger has fired since boot). `verifySupervisor()` accepts either.

### Manual run + kill-and-watch-restart proof

LogonTrigger only fires on logon, so to exercise the restart logic we kick
the task by hand.

```cmd
schtasks /Run /TN devx-manager
:: wait a few seconds, then find the wsl.exe pid
tasklist | findstr wsl.exe
:: kill it
taskkill /PID <pid> /F
:: wait for RestartOnFailure to fire
timeout /T 12
schtasks /Query /TN devx-manager /V /FO LIST | findstr Status
```

Expected: `Status: Running` again within 12 seconds of the kill.
`RestartOnFailure Interval=PT10S Count=999` guarantees up to 999 restart
attempts.

### Logout / login

Log out of the Windows user, log back in. The LogonTrigger fires; verify with
the status command above.

> **Known limitation (epic open question 2):** when no user is logged in,
> the LogonTrigger does not fire. This covers the "phone left at home" case
> at the cost of "headless server boots without a user logon" — which is the
> 5% gap documented in `_bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md`.
> A `learn/` follow-up will land if a real user trips on it.

### Uninstall (Phase 10 dry-run)

```cmd
node -e "import('./dist/lib/supervisor.js').then(m => { console.log(m.uninstallSupervisor('manager')); console.log(m.uninstallSupervisor('concierge')); })"
schtasks /Query /TN devx-manager
:: expect: ERROR: The system cannot find the file specified.
```

## `os_supervisor: none` short-circuit

Set `manager.os_supervisor: none` in `devx.config.yaml`, then:

```sh
node -e '
  import("./dist/lib/supervisor.js").then(m => {
    console.log(m.installSupervisor("manager"));
    console.log(m.installSupervisor("concierge"));
    console.log(m.verifySupervisor("manager"));
  });
'
```

Expected:
- both installs return `"skipped"`.
- exactly one stderr line: `supervisor disabled per config (manager.os_supervisor: none)`.
- verify returns `{ ok: true, platform: "none", detail: "supervisor disabled per config" }`.
- no plist / unit / task-scheduler artifacts written.
- no MANUAL.md entries filed.

## What CI doesn't cover (and why)

| Check | Reason CI can't run it |
|---|---|
| `launchctl bootstrap` against real launchd | macOS-only; CI runs on Ubuntu |
| `systemctl --user enable --now` | needs a real systemd-user session (CI runs as root in containers without a user bus) |
| `schtasks /Create` | Windows-only; the toolchain isn't installed on Linux runners |
| Kill-and-watch-restart timing | needs the supervisor process to actually exec; the stub `exec sleep infinity` requires a real shell + a real PID-reaping init |
| `loginctl enable-linger` follow-up after real logout/login | requires a real login session |

Everything above is exercised against injected `exec` mocks in
`test/supervisor-{launchd,systemd,task-scheduler,platform-detect}.test.ts`,
which proves the dispatchers and the idempotency state machine. The host-side
proofs above close the remaining gap.
