// Supervisor installer — Phase 0 (sup401 + sup402+).
//
// Public surface:
//   - installStub() / uninstallStub()        — sup401: ships ~/.devx/bin/devx-supervisor-stub.sh
//   - installSupervisor() / uninstallSupervisor() — sup402+: per-platform unit-file install
//
// Idempotency state lives at `~/.devx/state/supervisor.installed.json`.
// Per-key namespace: `stub` (sup401), `manager` / `concierge` (sup402+ role units).
//
// Shared helpers (atomic write, hash, state-file IO) live in
// supervisor-internal.ts so the platform-specific modules
// (supervisor-launchd.ts, future supervisor-systemd.ts, supervisor-task-scheduler.ts)
// can reuse them without duplicating logic.
//
// Spec: dev/dev-sup401-2026-04-26T19:35-supervisor-stub-script.md (stub)
//       dev/dev-sup402-2026-04-26T19:35-supervisor-launchd.md      (launchd dispatch)
// Epic: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  STATE_FILENAME,
  type SupervisorStateFile,
  defaultDevxHome,
  defaultTemplateDir,
  nowIso,
  readPackageVersion,
  readStateFile,
  sha256,
  writeAtomic,
  writeStateFile,
} from "./supervisor-internal.js";
import {
  type LaunchctlExec,
  installLaunchd,
  uninstallLaunchd,
} from "./supervisor-launchd.js";

export type InstallResult = "fresh" | "kept" | "rewritten";
export type UninstallResult = "removed" | "absent";
export type Role = "manager" | "concierge";
export type SupervisorPlatform = "launchd" | "systemd" | "task-scheduler";

export interface InstallStubOpts {
  /** Override `~/.devx/`. Defaults to `os.homedir() + "/.devx"`. Tests pass a tmpdir. */
  devxHome?: string;
  /** Override the source template directory. Defaults to the package's `_devx/templates/`. */
  templateDir?: string;
}

export interface InstallSupervisorOpts {
  devxHome?: string;
  templateDir?: string;
  /** ${HOME} substitution + log dir parent. Defaults to `os.homedir()`. */
  homeDir?: string;
  /** Dir where unit files are written (`~/Library/LaunchAgents` for launchd, etc). */
  unitDir?: string;
  /** Log dir (`~/Library/Logs/devx` for launchd). Tests override. */
  logDir?: string;
  /** Injected launchctl/systemctl/schtasks invoker for tests. */
  exec?: LaunchctlExec;
  /** Override `process.getuid()`. Tests pass a fixed uid. */
  uid?: number;
}

const STUB_FILENAME = "devx-supervisor-stub.sh";
const STUB_TEMPLATE_FILENAME = "supervisor-stub.sh";

/** Install the supervisor stub script and update the state file. Idempotent. */
export function installStub(opts: InstallStubOpts = {}): InstallResult {
  const devxHome = opts.devxHome ?? defaultDevxHome();
  const templateDir = opts.templateDir ?? defaultTemplateDir();

  const templatePath = join(templateDir, STUB_TEMPLATE_FILENAME);
  const targetPath = join(devxHome, "bin", STUB_FILENAME);
  const stateFile = join(devxHome, "state", STATE_FILENAME);

  const templateBytes = readFileSync(templatePath);
  const newHash = sha256(templateBytes);

  const state = readStateFile(stateFile);
  const prior = state.stub;

  // Same hash AND target file present → no-op. The state record alone isn't
  // enough; the binary may have been deleted out from under us.
  if (prior && prior.hash === newHash && existsSync(targetPath)) {
    return "kept";
  }

  // Atomic write of the script with executable mode.
  writeAtomic(targetPath, templateBytes, 0o755);

  const next: SupervisorStateFile = {
    ...state,
    stub: {
      hash: newHash,
      version: readPackageVersion(),
      installed_at: nowIso(),
    },
  };
  writeStateFile(stateFile, next);

  if (!prior) return "fresh";
  // prior.hash !== newHash OR prior.hash === newHash but target was missing —
  // both count as a rewrite.
  return "rewritten";
}

/** Remove the supervisor stub script and clear its state record. Phase 10 eject path. */
export function uninstallStub(opts: InstallStubOpts = {}): UninstallResult {
  const devxHome = opts.devxHome ?? defaultDevxHome();
  const targetPath = join(devxHome, "bin", STUB_FILENAME);
  const stateFile = join(devxHome, "state", STATE_FILENAME);

  const state = readStateFile(stateFile);
  const targetExists = existsSync(targetPath);
  const stubKnown = state.stub !== undefined;

  if (!targetExists && !stubKnown) return "absent";

  if (targetExists) {
    try {
      rmSync(targetPath, { force: true });
    } catch {
      // Same warn-only philosophy as the postinstall script: missing
      // permissions on uninstall shouldn't crash. The state-file rewrite
      // below still proceeds.
    }
  }

  if (stubKnown) {
    const next = { ...state };
    delete next.stub;
    if (Object.keys(next).length === 0) {
      // No other supervisor records → drop the state file entirely so
      // `~/.devx/` looks pristine post-eject.
      try {
        rmSync(stateFile, { force: true });
      } catch {
        // ignore
      }
    } else {
      writeStateFile(stateFile, next);
    }
  }

  return "removed";
}

/**
 * Install a supervisor unit (launchd / systemd / Task Scheduler).
 *
 * Phase 0 currently implements `launchd` only (sup402). `systemd` and
 * `task-scheduler` throw with a forward-pointer to their stories; sup405
 * adds the platform auto-detect dispatch on top of this entry point.
 */
export function installSupervisor(
  role: Role,
  platform: SupervisorPlatform,
  opts: InstallSupervisorOpts = {}
): InstallResult {
  switch (platform) {
    case "launchd":
      return installLaunchd({ role, ...opts });
    case "systemd":
      throw new Error("installSupervisor: systemd not yet implemented (sup403)");
    case "task-scheduler":
      throw new Error("installSupervisor: task-scheduler not yet implemented (sup404)");
  }
}

/** Uninstall a supervisor unit. Used by Phase 10 `devx eject`. */
export function uninstallSupervisor(
  role: Role,
  platform: SupervisorPlatform,
  opts: InstallSupervisorOpts = {}
): UninstallResult {
  switch (platform) {
    case "launchd":
      return uninstallLaunchd({ role, ...opts });
    case "systemd":
      throw new Error("uninstallSupervisor: systemd not yet implemented (sup403)");
    case "task-scheduler":
      throw new Error("uninstallSupervisor: task-scheduler not yet implemented (sup404)");
  }
}
