// Windows/WSL Task Scheduler supervisor — sup404.
//
// Renders a per-role task XML from `_devx/templates/task-scheduler/devx.xml`,
// writes it atomically to `<devxHome>/state/task-scheduler/devx-<role>.xml`,
// then `schtasks /Create /XML <file> /TN devx-<role> /F`. Idempotent:
// re-installs detect matching content via the SHA-256 sidecar in
// `~/.devx/state/supervisor.installed.json` and short-circuit. Hash drift
// triggers a `/Create /F` overwrite (which Task Scheduler treats as
// register-or-replace) — no separate /Delete is required.
//
// `schtasks` invocations are routed through an injectable `exec` so vitest
// can drive install/uninstall paths on macOS/Linux runners (and on Windows
// without registering real tasks onto the developer's box).
//
// LogonTrigger limitation (per spec open question 2): the trigger only fires
// when a user logs on Windows. If the user is already logged on but the WSL
// distro isn't running, the task fires correctly because wsl.exe will start
// the distro on first invocation. The 5% gap is "Windows is up, no user is
// logged in" — the task doesn't fire, the supervisor doesn't run. Documented
// here and in the epic; a `learn/` follow-up will land if a real user trips on it.
//
// Spec: dev/dev-sup404-2026-04-26T19:35-supervisor-task-scheduler.md
// Epic: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { userInfo } from "node:os";
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
export type TaskSchedulerInstallResult = "fresh" | "kept" | "rewritten";
export type TaskSchedulerUninstallResult = "removed" | "absent";

export type ExecResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

/** Task Scheduler installer routes `schtasks ...` through this. */
export type SchtasksExec = (args: string[]) => ExecResult;

export interface InstallTaskSchedulerOpts {
  role: Role;
  devxHome?: string;
  templateDir?: string;
  /** Directory where the rendered XML is parked on disk. Defaults to
   *  `<devxHome>/state/task-scheduler/`. The XML must persist because
   *  `schtasks /Create /XML` reads from a path; the same file also serves
   *  as the audit record of what we last registered. */
  unitDir?: string;
  /** WSL distro name to invoke (`wsl.exe -d <distro>`). Default: `Ubuntu`. */
  distro?: string;
  /** WSL user (`wsl.exe -u <user>`). Default: `os.userInfo().username`. */
  user?: string;
  /** WSL home dir for the supervisor stub path. Default: `/home/<user>`.
   *  We resolve at install time because `wsl.exe --exec` does NOT spawn a
   *  shell — `${HOME}` would be a literal token, not an expansion, so we
   *  bake in the absolute path. */
  wslHome?: string;
  exec?: SchtasksExec;
}

export interface UninstallTaskSchedulerOpts {
  role: Role;
  devxHome?: string;
  unitDir?: string;
  exec?: SchtasksExec;
}

const TEMPLATE_FILENAME = "devx.xml";

function defaultSchtasksExec(args: string[]): ExecResult {
  const result = spawnSync("schtasks", args, {
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

function defaultUser(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? process.env.LOGNAME ?? "";
  }
}

function defaultUnitDir(devxHome: string): string {
  return join(devxHome, "state", "task-scheduler");
}

function xmlFilename(role: Role): string {
  return `devx-${role}.xml`;
}

function taskName(role: Role): string {
  return `devx-${role}`;
}

/**
 * Render the Task Scheduler XML for `role`.
 *
 * Substitutes `__ROLE__`, `__DISTRO__`, `__USER__`, and `__WSL_HOME__`. All
 * four land at install time — unlike systemd's `%h`/`%S` (which systemd
 * expands at unit-load time), Task Scheduler's `<Arguments>` is a literal
 * string passed to `wsl.exe`, and `wsl.exe --exec` does not spawn a shell.
 *
 * Two roles → two distinct rendered XMLs → two distinct hashes. The whole
 * idempotency story relies on this; the per-role test pins it.
 */
export function renderTaskSchedulerXml(
  role: Role,
  opts: {
    distro?: string;
    user?: string;
    wslHome?: string;
    templateDir?: string;
  } = {}
): string {
  const dir = opts.templateDir ?? defaultTemplateDir();
  const path = join(dir, "task-scheduler", TEMPLATE_FILENAME);
  const raw = readFileSync(path, "utf8");
  const user = opts.user ?? defaultUser();
  const distro = opts.distro ?? "Ubuntu";
  const wslHome = opts.wslHome ?? `/home/${user}`;
  return raw
    .replaceAll("__ROLE__", role)
    .replaceAll("__DISTRO__", distro)
    .replaceAll("__USER__", user)
    .replaceAll("__WSL_HOME__", wslHome);
}

/**
 * Install the Task Scheduler task for `role`.
 *
 * Sequence:
 *   1. Render XML content and compute its SHA-256.
 *   2. Read state. If `state[role]` matches (platform=task-scheduler, same
 *      hash, XML file present) → no-op, return "kept".
 *   3. Atomically write the XML to `<unitDir>/devx-<role>.xml`.
 *   4. `schtasks /Create /XML <file> /TN devx-<role> /F` (the `/F` makes
 *      this register-or-replace — no separate /Delete on drift).
 *   5. Update state ONLY after /Create succeeds — a /Create failure leaves
 *      the state file honest about what's actually registered with
 *      Task Scheduler.
 */
export function installTaskScheduler(
  opts: InstallTaskSchedulerOpts
): TaskSchedulerInstallResult {
  const {
    role,
    devxHome = defaultDevxHome(),
    templateDir = defaultTemplateDir(),
    distro = "Ubuntu",
    user = defaultUser(),
    exec = defaultSchtasksExec,
  } = opts;

  const wslHome = opts.wslHome ?? `/home/${user}`;
  const unitDir = opts.unitDir ?? defaultUnitDir(devxHome);
  const stateFile = join(devxHome, "state", STATE_FILENAME);
  const xmlPath = join(unitDir, xmlFilename(role));
  const tn = taskName(role);

  const rendered = renderTaskSchedulerXml(role, {
    distro,
    user,
    wslHome,
    templateDir,
  });
  const newHash = sha256(rendered);

  const state = readStateFile(stateFile);
  const prior = state[role] as
    | { platform?: string; hash?: string }
    | undefined;
  const wasInstalled =
    prior?.platform === "task-scheduler" && typeof prior?.hash === "string";

  if (wasInstalled && prior?.hash === newHash && existsSync(xmlPath)) {
    return "kept";
  }

  // Pre-stage the XML before invoking schtasks. /Create reads from a path,
  // so the file must land on disk first. If /Create then fails, the file
  // is at most newer-but-not-registered — state isn't updated, so the next
  // install retries.
  writeAtomic(xmlPath, rendered);

  runOrThrow(exec, ["/Create", "/XML", xmlPath, "/TN", tn, "/F"]);

  const next: SupervisorStateFile = {
    ...state,
    [role]: {
      platform: "task-scheduler",
      hash: newHash,
      version: readPackageVersion(),
      installed_at: nowIso(),
    },
  };
  writeStateFile(stateFile, next);

  if (!wasInstalled) return "fresh";
  return "rewritten";
}

/**
 * Uninstall the Task Scheduler task for `role`.
 *
 * Sequence:
 *   1. `schtasks /Delete /TN devx-<role> /F` (best-effort — fine if not registered).
 *   2. Remove the XML file.
 *   3. Drop `state[role]` from the state file (or remove the file if empty).
 *
 * Phase 10's `devx eject` invokes this via uninstallSupervisor in supervisor.ts.
 */
export function uninstallTaskScheduler(
  opts: UninstallTaskSchedulerOpts
): TaskSchedulerUninstallResult {
  const {
    role,
    devxHome = defaultDevxHome(),
    exec = defaultSchtasksExec,
  } = opts;

  const unitDir = opts.unitDir ?? defaultUnitDir(devxHome);
  const stateFile = join(devxHome, "state", STATE_FILENAME);
  const xmlPath = join(unitDir, xmlFilename(role));
  const tn = taskName(role);

  const state = readStateFile(stateFile);
  const known = state[role] !== undefined;
  const fileExists = existsSync(xmlPath);

  if (!known && !fileExists) return "absent";

  // Delete BEFORE removing the file; mirrors launchd's bootout-first ordering.
  // Best-effort — schtasks reports an error if the task isn't registered, but
  // we still want the file + state cleanup to proceed.
  exec(["/Delete", "/TN", tn, "/F"]);

  if (fileExists) {
    try {
      rmSync(xmlPath, { force: true });
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

function runOrThrow(exec: SchtasksExec, args: string[]): void {
  const result = exec(args);
  if (result.error || (result.status ?? 1) !== 0) {
    const detail =
      result.stderr?.trim() || result.error?.message || "non-zero exit";
    throw new Error(`schtasks ${args.join(" ")} failed: ${detail}`);
  }
}

export interface VerifyTaskSchedulerOpts {
  role: Role;
  exec?: SchtasksExec;
}

/**
 * Verify the Task Scheduler task for `role` is registered and ready. sup405 entry.
 *
 * `schtasks /Query /TN devx-<role> /V /FO LIST` lists the task's verbose
 * record; we look for a `Status:` line whose value is `Ready` (waiting for
 * trigger — Phase 0 baseline) or `Running`. Anything else (`Disabled`,
 * `Could not start`, etc.) is a fail. Exit status 0 alone isn't enough —
 * schtasks /Query returns 0 for disabled tasks too.
 *
 * The Status field's exact label varies by Windows locale. We match
 * case-insensitively against English values; a non-English Windows install
 * trips the fall-through and gets a MANUAL.md entry. Documented as a known
 * limitation for now (a `learn/` follow-up will wire localized matching).
 */
export function verifyTaskScheduler(
  opts: VerifyTaskSchedulerOpts
): { ok: boolean; detail: string } {
  const exec = opts.exec ?? defaultSchtasksExec;
  const tn = taskName(opts.role);

  const result = exec(["/Query", "/TN", tn, "/V", "/FO", "LIST"]);
  if (result.error || (result.status ?? 1) !== 0) {
    const detail =
      result.stderr?.trim() ||
      result.error?.message ||
      `schtasks /Query /TN ${tn} exited ${result.status}`;
    return { ok: false, detail };
  }

  const stdout = result.stdout ?? "";
  // Status line in /FO LIST format: `Status:                               Ready`
  const statusMatch = stdout.match(/^\s*Status:\s*(.+?)\s*$/m);
  const status = statusMatch?.[1] ?? "";

  if (/^(ready|running)$/i.test(status)) {
    return { ok: true, detail: `Status: ${status} (${tn})` };
  }

  return {
    ok: false,
    detail: status
      ? `unexpected Status: ${status} for ${tn}`
      : `Status line missing from schtasks /Query /TN ${tn} output`,
  };
}
