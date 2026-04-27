// Linux systemd-user supervisor — sup403.
//
// Renders a per-role unit from `_devx/templates/systemd/devx.service`,
// writes it atomically to `~/.config/systemd/user/devx-<role>.service`,
// then `systemctl --user daemon-reload` + `enable --now`. Idempotent:
// re-installs detect matching content via the SHA-256 sidecar in
// `~/.devx/state/supervisor.installed.json` and short-circuit. Hash drift
// triggers daemon-reload + restart.
//
// `systemctl` and `loginctl` invocations are routed through an injectable
// `exec` so vitest can drive the install/uninstall paths on macOS runners
// (and on Linux without bootstrapping real units onto the developer's box).
//
// `linger=true` invokes `loginctl enable-linger <user>` so the units keep
// running across logout. Default false; set via `manager.linger` config and
// asked at /devx-init time.
//
// Spec: dev/dev-sup403-2026-04-26T19:35-supervisor-systemd.md
// Epic: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir, userInfo } from "node:os";
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

export type Role = "manager" | "concierge";
export type SystemdInstallResult = "fresh" | "kept" | "rewritten";
export type SystemdUninstallResult = "removed" | "absent";

export type ExecResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

/** systemd installer routes both `systemctl --user ...` and `loginctl ...` through this. */
export type SystemdExec = (
  binary: "systemctl" | "loginctl",
  args: string[]
) => ExecResult;

export interface InstallSystemdOpts {
  role: Role;
  devxHome?: string;
  templateDir?: string;
  /** %h substitution context. systemd expands `%h` itself at runtime, but
   *  defaultUnitDir() needs it to compute `~/.config/systemd/user`. */
  homeDir?: string;
  /** ~/.config/systemd/user by default. */
  unitDir?: string;
  /** When true, also call `loginctl enable-linger <user>` so units survive logout. */
  linger?: boolean;
  /** Username for loginctl enable-linger. Defaults to os.userInfo().username. */
  user?: string;
  exec?: SystemdExec;
}

export interface UninstallSystemdOpts {
  role: Role;
  devxHome?: string;
  unitDir?: string;
  /** Override homeDir for unitDir resolution. Defaults to `os.homedir()`. */
  homeDir?: string;
  exec?: SystemdExec;
}

const TEMPLATE_FILENAME = "devx.service";

function defaultSystemdExec(
  binary: "systemctl" | "loginctl",
  args: string[]
): ExecResult {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

function defaultUnitDir(homeDir: string): string {
  return join(homeDir, ".config", "systemd", "user");
}

function defaultUser(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.LOGNAME ?? "";
  }
}

function unitFilename(role: Role): string {
  return `devx-${role}.service`;
}

/**
 * Render the .service unit for `role`.
 *
 * Only `__ROLE__` is substituted; `%h` (home) and `%S` (state dir) are left
 * as systemd specifiers and expanded by systemd at unit-load time. This
 * keeps the rendered content stable across machines for a given role —
 * users sharing a config file get bit-identical units on disk.
 */
export function renderSystemdUnit(
  role: Role,
  opts: { templateDir?: string } = {}
): string {
  const dir = opts.templateDir ?? defaultTemplateDir();
  const path = join(dir, "systemd", TEMPLATE_FILENAME);
  const raw = readFileSync(path, "utf8");
  return raw.replaceAll("__ROLE__", role);
}

/**
 * Install the systemd-user unit for `role`.
 *
 * Sequence:
 *   1. Render unit content and compute its SHA-256.
 *   2. Read state. If `state[role]` matches (platform=systemd, same hash,
 *      unit file present) → no-op, return "kept". Linger is still applied
 *      on no-op when requested (loginctl enable-linger is itself idempotent).
 *   3. Atomically write the unit to `<unitDir>/devx-<role>.service`.
 *   4. `systemctl --user daemon-reload` so systemd picks up new content.
 *   5. Fresh install → `systemctl --user enable --now devx-<role>.service`.
 *      Drift path → `systemctl --user restart devx-<role>.service`. (The
 *      unit is already enabled from a prior install; restart applies the
 *      new content without needing re-enable.)
 *   6. If `linger=true`, `loginctl enable-linger <user>`. Failure surfaces
 *      because opting in to linger and silently not-getting-it is worse
 *      than failing loud.
 *   7. Update state ONLY after the side-effects succeed — a daemon-reload
 *      or enable failure leaves the state file honest about what's loaded.
 */
export function installSystemd(
  opts: InstallSystemdOpts
): SystemdInstallResult {
  const {
    role,
    devxHome = defaultDevxHome(),
    templateDir = defaultTemplateDir(),
    homeDir = homedir(),
    linger = false,
    user = defaultUser(),
    exec = defaultSystemdExec,
  } = opts;

  const unitDir = opts.unitDir ?? defaultUnitDir(homeDir);
  const stateFile = join(devxHome, "state", STATE_FILENAME);
  const unitName = unitFilename(role);
  const unitPath = join(unitDir, unitName);

  const rendered = renderSystemdUnit(role, { templateDir });
  const newHash = sha256(rendered);

  const state = readStateFile(stateFile);
  const prior = state[role] as
    | { platform?: string; hash?: string }
    | undefined;
  const wasSystemdInstalled =
    prior?.platform === "systemd" && typeof prior.hash === "string";

  if (
    wasSystemdInstalled &&
    prior?.hash === newHash &&
    existsSync(unitPath)
  ) {
    if (linger) {
      // loginctl enable-linger is idempotent at the systemd level; we still
      // call it so a `linger=false` → `linger=true` config flip lands even
      // when the unit content didn't change.
      runOrThrow(exec, "loginctl", ["enable-linger", user]);
    }
    return "kept";
  }

  // Pre-stage the unit before touching systemctl. If we crash partway
  // through, the file is at most updated to a newer-but-not-loaded hash —
  // state isn't updated, so the next install will retry.
  writeAtomic(unitPath, rendered);

  runOrThrow(exec, "systemctl", ["--user", "daemon-reload"]);

  if (wasSystemdInstalled) {
    runOrThrow(exec, "systemctl", ["--user", "restart", unitName]);
  } else {
    runOrThrow(exec, "systemctl", ["--user", "enable", "--now", unitName]);
  }

  // Write state BEFORE linger. The unit is now loaded + active per systemd;
  // that's what state[role] records. Linger is an orthogonal user-session
  // lifecycle setting — its failure must not erase the truth that the unit
  // is installed (otherwise a retry would think nothing is installed and the
  // re-run produces a misleading "fresh" instead of "kept").
  const next: SupervisorStateFile = {
    ...state,
    [role]: {
      platform: "systemd",
      hash: newHash,
      version: readPackageVersion(),
      installed_at: nowIso(),
    },
  };
  writeStateFile(stateFile, next);

  if (linger) {
    runOrThrow(exec, "loginctl", ["enable-linger", user]);
  }

  if (!wasSystemdInstalled) return "fresh";
  return "rewritten";
}

/**
 * Uninstall the systemd-user unit for `role`.
 *
 * Sequence:
 *   1. `systemctl --user disable --now <unit>` (best-effort — fine if not loaded).
 *   2. Remove the unit file.
 *   3. `systemctl --user daemon-reload` so systemd forgets the unit.
 *   4. Drop `state[role]` from the state file (or remove the file if empty).
 *
 * Phase 10's `devx eject` invokes this via uninstallSupervisor in supervisor.ts.
 */
export function uninstallSystemd(
  opts: UninstallSystemdOpts
): SystemdUninstallResult {
  const {
    role,
    devxHome = defaultDevxHome(),
    homeDir = homedir(),
    exec = defaultSystemdExec,
  } = opts;

  const unitDir = opts.unitDir ?? defaultUnitDir(homeDir);
  const stateFile = join(devxHome, "state", STATE_FILENAME);
  const unitName = unitFilename(role);
  const unitPath = join(unitDir, unitName);

  const state = readStateFile(stateFile);
  const known = state[role] !== undefined;
  const fileExists = existsSync(unitPath);

  if (!known && !fileExists) return "absent";

  // disable+stop BEFORE removing the file so systemctl still resolves the
  // unit by name. Errors are best-effort, mirroring launchd's bootout-first.
  exec("systemctl", ["--user", "disable", "--now", unitName]);

  if (fileExists) {
    try {
      rmSync(unitPath, { force: true });
    } catch {
      // Best-effort, mirroring uninstallStub's warn-only stance.
    }
  }

  // Reload so systemd's in-memory unit registry forgets the now-removed file.
  exec("systemctl", ["--user", "daemon-reload"]);

  if (known) {
    const next = { ...state };
    delete next[role];
    if (Object.keys(next).length === 0) {
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

function runOrThrow(
  exec: SystemdExec,
  binary: "systemctl" | "loginctl",
  args: string[]
): void {
  const result = exec(binary, args);
  if (result.error || (result.status ?? 1) !== 0) {
    const detail =
      result.stderr?.trim() || result.error?.message || "non-zero exit";
    throw new Error(`${binary} ${args.join(" ")} failed: ${detail}`);
  }
}
