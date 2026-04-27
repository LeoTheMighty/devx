// macOS launchd supervisor — sup402.
//
// Renders a per-role plist from `_devx/templates/launchd/dev.devx.plist`,
// writes it atomically to `~/Library/LaunchAgents/dev.devx.<role>.plist`,
// and bootstraps it via `launchctl bootstrap gui/<uid>`. Idempotent:
// re-installs detect matching content via the SHA-256 sidecar in
// `~/.devx/state/supervisor.installed.json` and short-circuit. Hash drift
// triggers `bootout` + write + `bootstrap`.
//
// `launchctl` invocations are routed through an injectable `exec` so vitest
// can drive the install/uninstall paths on Linux CI runners (and on macOS
// without bootstrapping real units onto the developer's box). The on-host
// kill-and-watch-restart proof is a MANUAL.md item — see Phase 0 supervisor
// testing notes.
//
// Spec: dev/dev-sup402-2026-04-26T19:35-supervisor-launchd.md
// Epic: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
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
export type LaunchInstallResult = "fresh" | "kept" | "rewritten";
export type LaunchUninstallResult = "removed" | "absent";

export type ExecResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

export type LaunchctlExec = (args: string[]) => ExecResult;

export interface InstallLaunchdOpts {
  role: Role;
  devxHome?: string;
  templateDir?: string;
  /** ${HOME} substitution + log path parent. Defaults to `os.homedir()`. */
  homeDir?: string;
  /** ~/Library/LaunchAgents by default. */
  unitDir?: string;
  /** ~/Library/Logs/devx by default. */
  logDir?: string;
  exec?: LaunchctlExec;
  uid?: number;
}

export interface UninstallLaunchdOpts {
  role: Role;
  devxHome?: string;
  unitDir?: string;
  exec?: LaunchctlExec;
  uid?: number;
}

const TEMPLATE_FILENAME = "dev.devx.plist";

function defaultLaunchctlExec(args: string[]): ExecResult {
  const result = spawnSync("launchctl", args, {
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

function defaultUid(): number {
  // `process.getuid` exists on POSIX. On Windows it's undefined; launchd is
  // macOS-only so this branch shouldn't fire there in practice.
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

function defaultUnitDir(homeDir: string): string {
  return join(homeDir, "Library", "LaunchAgents");
}

function defaultLogDir(homeDir: string): string {
  return join(homeDir, "Library", "Logs", "devx");
}

function plistFilename(role: Role): string {
  return `dev.devx.${role}.plist`;
}

/**
 * Render the plist for a role with concrete paths substituted in.
 *
 * The template uses `__ROLE__` for the role token and the literal `${HOME}`
 * for the home dir. We substitute both at install time because launchd
 * treats `${HOME}` as a literal — not a shell expansion.
 */
export function renderLaunchdPlist(
  role: Role,
  vars: { homeDir: string; templateDir?: string }
): string {
  const dir = vars.templateDir ?? defaultTemplateDir();
  const path = join(dir, "launchd", TEMPLATE_FILENAME);
  const raw = readFileSync(path, "utf8");
  return raw.replaceAll("__ROLE__", role).replaceAll("${HOME}", vars.homeDir);
}

/**
 * Install the launchd unit for `role`.
 *
 * Sequence:
 *   1. Render plist content (substituted) and compute its SHA-256.
 *   2. Read the state file. If `state[role]` matches (platform=launchd,
 *      same hash, plist file present) → no-op, return "kept".
 *   3. Atomically write the plist to `<unitDir>/dev.devx.<role>.plist`.
 *   4. Make sure the log dir exists (launchd doesn't auto-create parents
 *      for StandardOutPath).
 *   5. If a prior launchd install was recorded, `bootout` it first so the
 *      bootstrap doesn't conflict with a stale loaded unit.
 *   6. `bootstrap` the new plist.
 *   7. Update the state file ONLY after bootstrap succeeds. State writes
 *      are gated on the side-effect so a bootstrap failure leaves the file
 *      intact but the state honest about what's actually loaded.
 */
export function installLaunchd(opts: InstallLaunchdOpts): LaunchInstallResult {
  const {
    role,
    devxHome = defaultDevxHome(),
    templateDir = defaultTemplateDir(),
    homeDir = homedir(),
    exec = defaultLaunchctlExec,
    uid = defaultUid(),
  } = opts;

  const unitDir = opts.unitDir ?? defaultUnitDir(homeDir);
  const logDir = opts.logDir ?? defaultLogDir(homeDir);

  const stateFile = join(devxHome, "state", STATE_FILENAME);
  const plistPath = join(unitDir, plistFilename(role));

  const rendered = renderLaunchdPlist(role, { homeDir, templateDir });
  const newHash = sha256(rendered);

  const state = readStateFile(stateFile);
  const prior = state[role] as
    | { platform?: string; hash?: string }
    | undefined;
  const wasLaunchdInstalled =
    prior?.platform === "launchd" && typeof prior.hash === "string";

  if (
    wasLaunchdInstalled &&
    prior?.hash === newHash &&
    existsSync(plistPath)
  ) {
    return "kept";
  }

  // Pre-stage the plist + log dir before touching launchctl. If we crash
  // partway through, the plist is at most updated to a newer-but-not-loaded
  // hash — the state file isn't updated, so the next install will retry.
  writeAtomic(plistPath, rendered);
  ensureDir(logDir);

  // bootout existing unit on hash drift so bootstrap doesn't see a duplicate
  // label. Errors here are best-effort: if the unit isn't actually loaded
  // (state-file drift), bootout will fail and we still want to bootstrap.
  if (wasLaunchdInstalled) {
    exec(["bootout", `gui/${uid}`, plistPath]);
  }

  const bootstrapResult = exec(["bootstrap", `gui/${uid}`, plistPath]);
  if (bootstrapResult.error || (bootstrapResult.status ?? 1) !== 0) {
    const detail = bootstrapResult.stderr?.trim() || bootstrapResult.error?.message || "non-zero exit";
    throw new Error(
      `launchctl bootstrap gui/${uid} ${plistPath} failed: ${detail}`
    );
  }

  const next: SupervisorStateFile = {
    ...state,
    [role]: {
      platform: "launchd",
      hash: newHash,
      version: readPackageVersion(),
      installed_at: nowIso(),
    },
  };
  writeStateFile(stateFile, next);

  if (!wasLaunchdInstalled) return "fresh";
  return "rewritten";
}

/**
 * Uninstall the launchd unit for `role`.
 *
 * Sequence:
 *   1. `bootout` (best-effort — fine if not loaded).
 *   2. Remove the plist file.
 *   3. Drop `state[role]` from the state file (or remove the file if empty).
 *
 * Phase 10's `devx eject` invokes this via uninstallSupervisor in supervisor.ts.
 */
export function uninstallLaunchd(opts: UninstallLaunchdOpts): LaunchUninstallResult {
  const {
    role,
    devxHome = defaultDevxHome(),
    exec = defaultLaunchctlExec,
    uid = defaultUid(),
  } = opts;

  const unitDir = opts.unitDir ?? defaultUnitDir(homedir());
  const stateFile = join(devxHome, "state", STATE_FILENAME);
  const plistPath = join(unitDir, plistFilename(role));

  const state = readStateFile(stateFile);
  const known = state[role] !== undefined;
  const fileExists = existsSync(plistPath);

  if (!known && !fileExists) return "absent";

  if (fileExists) {
    // bootout BEFORE removing the file — launchctl resolves the label from
    // the plist on disk.
    exec(["bootout", `gui/${uid}`, plistPath]);
    try {
      rmSync(plistPath, { force: true });
    } catch {
      // Best-effort, mirroring uninstallStub's warn-only stance.
    }
  }

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

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
