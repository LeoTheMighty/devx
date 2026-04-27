// Supervisor installer — Phase 0 (sup401 + sup402 + sup403 + sup404 + sup405).
//
// Public surface:
//   - installStub() / uninstallStub()        — sup401: ships ~/.devx/bin/devx-supervisor-stub.sh
//   - installSupervisor() / uninstallSupervisor() — sup402+: per-platform unit-file install
//   - verifySupervisor()                     — sup405: post-install status assertion
//   - resolveSupervisorPlatform()            — sup405: shared config + OS detection
//
// Idempotency state lives at `~/.devx/state/supervisor.installed.json`.
// Per-key namespace: `stub` (sup401), `manager` / `concierge` (sup402+ role units).
//
// Shared helpers (atomic write, hash, state-file IO) live in
// supervisor-internal.ts so the platform-specific modules
// (supervisor-launchd.ts, supervisor-systemd.ts, supervisor-task-scheduler.ts)
// can reuse them without duplicating logic.
//
// Spec: dev/dev-sup401-2026-04-26T19:35-supervisor-stub-script.md     (stub)
//       dev/dev-sup402-2026-04-26T19:35-supervisor-launchd.md         (launchd dispatch)
//       dev/dev-sup403-2026-04-26T19:35-supervisor-systemd.md         (systemd dispatch)
//       dev/dev-sup404-2026-04-26T19:35-supervisor-task-scheduler.md  (task-scheduler dispatch)
//       dev/dev-sup405-2026-04-26T19:35-supervisor-platform-detect.md (auto-detect + verify)
// Epic: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md

import { existsSync, readFileSync, rmSync } from "node:fs";
import { release } from "node:os";
import { dirname, join, resolve } from "node:path";

import { findProjectConfig, loadMerged } from "./config-io.js";
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
  verifyLaunchd,
} from "./supervisor-launchd.js";
import {
  type SystemdExec,
  installSystemd,
  uninstallSystemd,
  verifySystemd,
} from "./supervisor-systemd.js";
import {
  type SchtasksExec,
  installTaskScheduler,
  uninstallTaskScheduler,
  verifyTaskScheduler,
} from "./supervisor-task-scheduler.js";

export type InstallResult = "fresh" | "kept" | "rewritten" | "skipped";
export type UninstallResult = "removed" | "absent" | "skipped";
export type Role = "manager" | "concierge";
export type SupervisorPlatform = "launchd" | "systemd" | "task-scheduler";
/** What `manager.os_supervisor` may be set to in devx.config.yaml. */
export type ConfiguredPlatform = SupervisorPlatform | "auto" | "none";

export interface InstallStubOpts {
  /** Override `~/.devx/`. Defaults to `os.homedir() + "/.devx"`. Tests pass a tmpdir. */
  devxHome?: string;
  /** Override the source template directory. Defaults to the package's `_devx/templates/`. */
  templateDir?: string;
}

export interface InstallSupervisorOpts {
  /**
   * Resolved platform to install. When omitted, the dispatcher reads
   * `manager.os_supervisor` from devx.config.yaml. Pass `"auto"` to force the
   * read-and-detect path even when an explicit override might also be present
   * via tests; pass a literal platform (`"launchd"` etc.) to bypass config.
   */
  platform?: ConfiguredPlatform;
  /** Override the project config path (test injection). Defaults to walking
   *  up from `process.cwd()` for `devx.config.yaml`. */
  configPath?: string;
  /** Override OS detection used when the resolved config value is `"auto"`.
   *  Defaults to `defaultDetectOs()` (process.platform + os.release WSL test). */
  detectOs?: () => SupervisorPlatform;
  /** Override the stderr writer for the "supervisor disabled per config"
   *  warning. Defaults to `process.stderr.write`. Tests inject a recorder. */
  warn?: (msg: string) => void;

  devxHome?: string;
  templateDir?: string;
  /** ${HOME} substitution (launchd) + log dir parent + unitDir resolution.
   *  Defaults to `os.homedir()`. */
  homeDir?: string;
  /** Dir where unit files are written (`~/Library/LaunchAgents` for launchd,
   *  `~/.config/systemd/user` for systemd). */
  unitDir?: string;
  /** Log dir (`~/Library/Logs/devx` for launchd). Tests override.
   *  Unused for systemd — `%S/devx` is expanded by systemd at runtime. */
  logDir?: string;
  /** Injected launchctl/systemctl/loginctl/schtasks invoker for tests.
   *  Each platform narrows this to its own type at the dispatch boundary. */
  exec?: LaunchctlExec | SystemdExec | SchtasksExec;
  /** Override `process.getuid()`. Tests pass a fixed uid. (launchd-only) */
  uid?: number;
  /** systemd-only: invoke `loginctl enable-linger <user>` so units survive logout. */
  linger?: boolean;
  /** Username for loginctl (systemd) / `wsl.exe -u <user>` (task-scheduler).
   *  Defaults to `os.userInfo().username`. */
  user?: string;
  /** task-scheduler-only: WSL distro name for `wsl.exe -d <distro>`. Default: `Ubuntu`. */
  distro?: string;
  /** task-scheduler-only: absolute WSL home dir, e.g. `/home/leo`. Default: `/home/<user>`. */
  wslHome?: string;
}

export interface VerifySupervisorOpts extends InstallSupervisorOpts {
  /** Override the MANUAL.md path on verification failure. Defaults to
   *  `<projectRoot>/MANUAL.md` resolved from configPath / cwd. */
  manualMdPath?: string;
  /** Override the log path mentioned in the MANUAL.md entry on failure.
   *  Defaults to a platform-derived guess (`~/Library/Logs/devx/<role>.err.log`
   *  on macOS, etc.). Used only as a hint to the human reading MANUAL.md. */
  logPath?: string;
}

/** Outcome of `verifySupervisor`. `ok: true` with platform `"none"` means
 *  the supervisor is intentionally disabled per config. */
export type VerifyOutcome =
  | { ok: true; platform: SupervisorPlatform; detail: string }
  | { ok: false; platform: SupervisorPlatform; detail: string }
  | { ok: true; platform: "none"; detail: string };

const STUB_FILENAME = "devx-supervisor-stub.sh";
const STUB_TEMPLATE_FILENAME = "supervisor-stub.sh";

/** Install the supervisor stub script and update the state file. Idempotent. */
export function installStub(opts: InstallStubOpts = {}): "fresh" | "kept" | "rewritten" {
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
export function uninstallStub(opts: InstallStubOpts = {}): "removed" | "absent" {
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
 * Detect the supervisor platform from the running OS.
 *
 *   darwin                                        → launchd
 *   linux + os.release() includes "microsoft"     → task-scheduler (WSL)
 *   linux                                         → systemd
 *   win32                                         → task-scheduler
 *   anything else                                 → systemd (safe fallback)
 *
 * `os.release()` mirrors `uname -r` per the Node docs; on WSL kernels it
 * carries the literal string `microsoft` (e.g. `5.15.167.4-microsoft-standard-WSL2`).
 */
export function defaultDetectOs(): SupervisorPlatform {
  if (process.platform === "darwin") return "launchd";
  if (process.platform === "win32") return "task-scheduler";
  if (process.platform === "linux") {
    if (release().toLowerCase().includes("microsoft")) return "task-scheduler";
    return "systemd";
  }
  // freebsd/openbsd/sunos/aix → systemd is the closest fit; verifySupervisor
  // surfaces the failure to MANUAL.md if the unit doesn't actually load.
  return "systemd";
}

interface ResolvedPlatform {
  /** "none" means the user explicitly disabled the supervisor; callers
   *  short-circuit and warn once per process. */
  platform: SupervisorPlatform | "none";
  /** Where the resolution came from — surfaced in test assertions and
   *  potentially in CLI verbose output. */
  source: "explicit" | "config" | "auto-detected";
}

/**
 * Resolve the install target from (in order):
 *   1. `opts.platform` if given as a literal platform.
 *   2. `manager.os_supervisor` from devx.config.yaml.
 *   3. `defaultDetectOs()` if (1) or (2) said `"auto"`.
 *
 * Returns `"none"` only when the user explicitly set `os_supervisor: none`;
 * `"auto"` is never returned (it's always resolved to a concrete platform).
 */
export function resolveSupervisorPlatform(
  opts: Pick<InstallSupervisorOpts, "platform" | "configPath" | "detectOs"> = {}
): ResolvedPlatform {
  const detect = opts.detectOs ?? defaultDetectOs;

  // Explicit literal override beats config — used by both /devx tests and the
  // uninstall path (which always knows the platform from the prior install
  // record).
  if (
    opts.platform === "launchd" ||
    opts.platform === "systemd" ||
    opts.platform === "task-scheduler"
  ) {
    return { platform: opts.platform, source: "explicit" };
  }

  // Either no explicit platform or an explicit "auto" / "none" → consult config.
  let configured: ConfiguredPlatform = opts.platform ?? "auto";
  if (opts.platform === undefined) {
    try {
      const merged = loadMerged({ projectPath: opts.configPath }) as
        | { manager?: { os_supervisor?: ConfiguredPlatform } }
        | undefined;
      const fromConfig = merged?.manager?.os_supervisor;
      if (
        fromConfig === "auto" ||
        fromConfig === "none" ||
        fromConfig === "launchd" ||
        fromConfig === "systemd" ||
        fromConfig === "task-scheduler"
      ) {
        configured = fromConfig;
      }
    } catch {
      // No project config / unreadable / not in a devx project — treat as
      // "auto" so the dispatcher still works in adhoc test invocations.
    }
  }

  if (configured === "none") {
    return { platform: "none", source: "config" };
  }
  if (configured === "auto") {
    return { platform: detect(), source: "auto-detected" };
  }
  // Concrete platform from config (rare — most users leave it on `auto`).
  return { platform: configured, source: "config" };
}

// Module-local "warned this process" flag for `os_supervisor: none`. Reset by
// resetNoneWarnedForTests for vitest's parallel-suite isolation.
let _noneWarned = false;

/** Test-only: reset the once-per-process warn flag for `os_supervisor: none`. */
export function resetNoneWarnedForTests(): void {
  _noneWarned = false;
}

function warnSupervisorDisabled(write: (msg: string) => void): void {
  if (_noneWarned) return;
  _noneWarned = true;
  write("supervisor disabled per config (manager.os_supervisor: none)\n");
}

/**
 * Install a supervisor unit (launchd / systemd / Task Scheduler).
 *
 * Resolution order: `opts.platform` → `manager.os_supervisor` from config →
 * OS auto-detect. `os_supervisor: none` short-circuits with a single stderr
 * warning per process and returns `"skipped"`.
 *
 * Phase 0 implements `launchd` (sup402), `systemd` (sup403), and
 * `task-scheduler` (sup404). sup405 adds the platform auto-detect dispatch
 * on top of those entry points.
 */
export function installSupervisor(
  role: Role,
  opts: InstallSupervisorOpts = {}
): InstallResult {
  const resolved = resolveSupervisorPlatform(opts);

  if (resolved.platform === "none") {
    const write = opts.warn ?? ((m: string) => process.stderr.write(m));
    warnSupervisorDisabled(write);
    return "skipped";
  }

  switch (resolved.platform) {
    case "launchd":
      return installLaunchd({
        role,
        devxHome: opts.devxHome,
        templateDir: opts.templateDir,
        homeDir: opts.homeDir,
        unitDir: opts.unitDir,
        logDir: opts.logDir,
        exec: opts.exec as LaunchctlExec | undefined,
        uid: opts.uid,
      });
    case "systemd":
      return installSystemd({
        role,
        devxHome: opts.devxHome,
        templateDir: opts.templateDir,
        homeDir: opts.homeDir,
        unitDir: opts.unitDir,
        linger: opts.linger,
        user: opts.user,
        exec: opts.exec as SystemdExec | undefined,
      });
    case "task-scheduler":
      return installTaskScheduler({
        role,
        devxHome: opts.devxHome,
        templateDir: opts.templateDir,
        unitDir: opts.unitDir,
        distro: opts.distro,
        user: opts.user,
        wslHome: opts.wslHome,
        exec: opts.exec as SchtasksExec | undefined,
      });
  }
}

/** Uninstall a supervisor unit. Used by Phase 10 `devx eject`. */
export function uninstallSupervisor(
  role: Role,
  opts: InstallSupervisorOpts = {}
): UninstallResult {
  const resolved = resolveSupervisorPlatform(opts);

  if (resolved.platform === "none") {
    const write = opts.warn ?? ((m: string) => process.stderr.write(m));
    warnSupervisorDisabled(write);
    return "skipped";
  }

  switch (resolved.platform) {
    case "launchd":
      return uninstallLaunchd({
        role,
        devxHome: opts.devxHome,
        unitDir: opts.unitDir,
        exec: opts.exec as LaunchctlExec | undefined,
        uid: opts.uid,
      });
    case "systemd":
      return uninstallSystemd({
        role,
        devxHome: opts.devxHome,
        homeDir: opts.homeDir,
        unitDir: opts.unitDir,
        exec: opts.exec as SystemdExec | undefined,
      });
    case "task-scheduler":
      return uninstallTaskScheduler({
        role,
        devxHome: opts.devxHome,
        unitDir: opts.unitDir,
        exec: opts.exec as SchtasksExec | undefined,
      });
  }
}

/**
 * Verify the platform's supervisor unit for `role` is loaded + active.
 *
 *   launchd        → `launchctl print gui/<uid>/dev.devx.<role>` exit 0 AND
 *                    stdout contains `state = running`.
 *   systemd        → `systemctl --user is-active devx-<role>.service` exit 0
 *                    AND stdout starts with `active`.
 *   task-scheduler → `schtasks /Query /TN devx-<role> /V /FO LIST` exit 0 AND
 *                    stdout contains `Status:   Ready` (or `Running`).
 *
 * Verification failure files ONE MANUAL.md entry (idempotently — a second
 * failed verify with the same role+platform won't duplicate the entry) and
 * returns `{ ok: false }`. Callers MUST NOT abort on a false outcome — the
 * unit may simply not have started yet at the moment we polled. The whole
 * point of this surface is that init still completes; the human gets a
 * MANUAL.md item to look into when convenient.
 */
export function verifySupervisor(
  role: Role,
  opts: VerifySupervisorOpts = {}
): VerifyOutcome {
  const resolved = resolveSupervisorPlatform(opts);

  if (resolved.platform === "none") {
    return {
      ok: true,
      platform: "none",
      detail: "supervisor disabled per config",
    };
  }

  let outcome: { ok: boolean; detail: string };
  switch (resolved.platform) {
    case "launchd":
      outcome = verifyLaunchd({
        role,
        exec: opts.exec as LaunchctlExec | undefined,
        uid: opts.uid,
      });
      break;
    case "systemd":
      outcome = verifySystemd({
        role,
        exec: opts.exec as SystemdExec | undefined,
      });
      break;
    case "task-scheduler":
      outcome = verifyTaskScheduler({
        role,
        exec: opts.exec as SchtasksExec | undefined,
      });
      break;
  }

  if (!outcome.ok) {
    fileManualMdEntry(role, resolved.platform, outcome.detail, opts);
  }

  return {
    ok: outcome.ok,
    platform: resolved.platform,
    detail: outcome.detail,
  };
}

function defaultManualMdPath(configPath: string | undefined): string {
  // Prefer the project root that owns devx.config.yaml — that's where MANUAL.md
  // lives by convention. Fallback to cwd keeps adhoc invocations from leaking
  // into a parent project's MANUAL.md.
  const resolved = configPath ?? findProjectConfig();
  if (resolved) return join(dirname(resolve(resolved)), "MANUAL.md");
  return join(process.cwd(), "MANUAL.md");
}

function manualMdEntryHeader(
  role: Role,
  platform: SupervisorPlatform
): string {
  // Stable headline so re-running verify is idempotent (we look for this
  // exact substring before appending).
  return `**MS.${platform}.${role} — supervisor unit failed verification (${platform}/${role}).**`;
}

function defaultLogPath(
  platform: SupervisorPlatform,
  role: Role,
  homeDir: string | undefined
): string {
  const home = homeDir ?? process.env.HOME ?? "~";
  switch (platform) {
    case "launchd":
      return `${home}/Library/Logs/devx/${role}.err.log`;
    case "systemd":
      // %S/devx/<role>.err.log expands to ~/.local/state/devx/<role>.err.log
      // on most distros. Hardcode that path for the MANUAL.md hint; the real
      // resolution happens in systemd at unit-load.
      return `${home}/.local/state/devx/${role}.err.log`;
    case "task-scheduler":
      // WSL writes inside its own filesystem; under \\wsl$\<distro>\... from
      // Windows. The hint here is the WSL-side path.
      return `${home}/.local/state/devx/${role}.err.log`;
  }
}

function fileManualMdEntry(
  role: Role,
  platform: SupervisorPlatform,
  detail: string,
  opts: VerifySupervisorOpts
): void {
  const path = opts.manualMdPath ?? defaultManualMdPath(opts.configPath);
  const logPath = opts.logPath ?? defaultLogPath(platform, role, opts.homeDir);

  const header = manualMdEntryHeader(role, platform);

  let existing = "";
  if (existsSync(path)) {
    existing = readFileSync(path, "utf8");
    if (existing.includes(header)) {
      // Already filed — verifySupervisor is called more than once across an
      // init session (per role; potentially per init re-run), and we never
      // want to duplicate.
      return;
    }
  }

  const block = [
    "",
    `- [ ] ${header}`,
    `  - Why: \`/devx-init\` ran the ${platform} install for the \`${role}\` unit, but the post-install verification step did not see it active. The unit may simply not have started yet, or the install itself failed silently.`,
    `  - How: inspect the unit and its logs:`,
    "    ```sh",
    ...verifyHowSnippet(platform, role),
    "    ```",
    `  - Detail at verify time: \`${detail.replace(/`/g, "'").trim()}\``,
    `  - Suggested log path: \`${logPath}\``,
    `  - Blocks: nothing (init still completed; this is informational).`,
    `  - Spec: \`dev/dev-sup405-2026-04-26T19:35-supervisor-platform-detect.md\`.`,
    "",
  ].join("\n");

  // Atomic append: read + concat + write via the existing atomic helper. If
  // MANUAL.md doesn't exist yet, seed it with the canonical heading so we
  // don't leave an unrooted bullet list.
  const content = existing.length > 0
    ? (existing.endsWith("\n") ? existing : existing + "\n") + block
    : `# MANUAL — Actions only the user can do\n\nItems here block \`/devx\` when the user's action is required. Check off when done.\n${block}`;

  writeAtomic(path, content);
}

function verifyHowSnippet(platform: SupervisorPlatform, role: Role): string[] {
  switch (platform) {
    case "launchd":
      return [
        `    launchctl print "gui/$(id -u)/dev.devx.${role}"   # expect "state = running"`,
        `    tail -n 50 ~/Library/Logs/devx/${role}.err.log`,
      ];
    case "systemd":
      return [
        `    systemctl --user status devx-${role}.service     # expect "active (running)"`,
        `    journalctl --user -u devx-${role}.service -n 100`,
      ];
    case "task-scheduler":
      return [
        `    schtasks /Query /TN devx-${role} /V /FO LIST   # expect "Status: Ready" or "Running"`,
        `    # WSL-side log: ~/.local/state/devx/${role}.err.log`,
      ];
  }
}
