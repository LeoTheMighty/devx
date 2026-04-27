// Supervisor installer trigger + verify for `/devx-init` (ini505).
//
// Public surface:
//   - runInitSupervisor(opts) — composes installSupervisor() and
//       verifySupervisor() from the sup405 dispatchers across BOTH the
//       `manager` and `concierge` roles, then runs a WSL host-crossover
//       check (per cli305) that lands a MANUAL.md entry when `npm config
//       get prefix` resolves under `/mnt/<letter>/`.
//
// Behavior:
//   - `manager.os_supervisor` is read by sup405 internally; `none` resolves
//     both roles to "skipped" with a single stderr warn-once.
//   - `auto` resolves via `defaultDetectOs()` → launchd/systemd/task-scheduler.
//   - Verification failure is captured in the result but DOES NOT abort —
//     the underlying verifySupervisor files a MANUAL.md entry on failure
//     and `runInitSupervisor` keeps going so /devx-init still completes.
//   - WSL host-crossover is independent of install/verify outcome: even if
//     the supervisor unit installed fine, an npm prefix on `/mnt/<letter>/`
//     means future `npm i -g` runs from this shell land binaries on the
//     Windows host PATH, not WSL's. Surface as MANUAL.md, not init failure.
//
// Tests: see test/init-supervisor.test.ts. All side-effect surfaces are
// injectable (configPath, detectOs, exec, isWsl, npmPrefix, manualMdPath,
// devxHome, homeDir, unitDir, logDir, uid, user) so the suite runs on any
// host without touching the real launchd/systemd/schtasks/npm.
//
// Spec: dev/dev-ini505-2026-04-26T19:35-init-supervisor-trigger.md
// Builds on: sup405 (resolveSupervisorPlatform / installSupervisor /
//            verifySupervisor) + cli305 (isWslPrefixOnWindowsHost).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { release } from "node:os";
import { dirname, join, resolve } from "node:path";

import { findProjectConfig } from "./config-io.js";
import {
  type InstallResult,
  type Role,
  type SupervisorPlatform,
  type VerifyOutcome,
  installSupervisor,
  resolveSupervisorPlatform,
  verifySupervisor,
} from "./supervisor.js";
import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One role's outcome. `skipped` only when `os_supervisor: none`. */
export type InitSupervisorRoleResult =
  | {
      role: Role;
      status: "skipped";
      reason: "config-none";
    }
  | {
      role: Role;
      status: "ran";
      install: InstallResult;
      verify: VerifyOutcome;
    };

export interface WslCrossoverResult {
  /** True iff the host is WSL (Linux + microsoft kernel). */
  detected: boolean;
  /** The npm prefix observed (or `null` if `npm config get prefix` failed). */
  prefix: string | null;
  /** True iff prefix matched `/mnt/<letter>/...`. */
  onWindowsHost: boolean;
  /** True iff a MANUAL.md entry was filed (or already present, idempotent). */
  manualMdFiled: boolean;
}

export interface InitSupervisorResult {
  /** Resolved platform after config + auto-detect. `"none"` short-circuits both roles. */
  platform: SupervisorPlatform | "none";
  /** Where the platform decision came from. */
  source: "explicit" | "config" | "auto-detected";
  /** Per-role install + verify outcomes (always two entries: manager, concierge). */
  roles: ReadonlyArray<InitSupervisorRoleResult>;
  /** WSL host-crossover diagnostic. */
  wslCrossover: WslCrossoverResult;
}

export interface RunInitSupervisorOpts {
  /** Project config path. Defaults to walking up from `process.cwd()`. */
  configPath?: string;
  /** Override OS detection used when `os_supervisor: auto`. */
  detectOs?: () => SupervisorPlatform;
  /** Override the WSL detector. Defaults to linux + microsoft kernel test. */
  isWsl?: () => boolean;
  /** Override the npm-prefix probe. Defaults to `npm config get prefix`. */
  npmPrefix?: () => string | null;
  /** Override the MANUAL.md path used for the WSL crossover entry AND for
   *  verifySupervisor's failure entry. Defaults to the project root's
   *  MANUAL.md (resolved via configPath). */
  manualMdPath?: string;
  /** Stderr writer for the `os_supervisor: none` warn-once. */
  warn?: (msg: string) => void;

  // ---- Pass-through to installSupervisor/verifySupervisor ----
  devxHome?: string;
  templateDir?: string;
  homeDir?: string;
  unitDir?: string;
  logDir?: string;
  // exec is shared across both role calls; the dispatcher narrows the type
  // per-platform internally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any;
  uid?: number;
  linger?: boolean;
  user?: string;
  distro?: string;
  wslHome?: string;
}

// ---------------------------------------------------------------------------
// Default detectors
// ---------------------------------------------------------------------------

/** Default WSL detector — Linux kernel string contains `microsoft`. Mirrors
 *  scripts/postinstall-lib.mjs's `isWSL()`. Kept inline (instead of imported)
 *  because postinstall-lib is a `.mjs` shipped under scripts/, not part of
 *  the TypeScript src graph. */
function defaultIsWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const r = release();
    return /microsoft|wsl/i.test(r);
  } catch {
    return false;
  }
}

/** Default `npm config get prefix` probe. Returns `null` on any spawn error
 *  or non-zero exit — the WSL warning is informational and must never abort
 *  init. */
function defaultNpmPrefix(): string | null {
  try {
    const r = spawnSync("npm", ["config", "get", "prefix"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.error) return null;
    if (r.status !== 0) return null;
    const out = (r.stdout ?? "").trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Match any Windows-mounted drive under `/mnt/<letter>/`, not just C:. The
 *  same regex cli305 uses; kept inline for the same reason as defaultIsWsl. */
function isPrefixOnWindowsHost(prefix: string | null): boolean {
  return typeof prefix === "string" && /^\/mnt\/[a-z]\//i.test(prefix);
}

// ---------------------------------------------------------------------------
// MANUAL.md helpers
// ---------------------------------------------------------------------------

/** Resolve where MANUAL.md lives. Match the convention used by
 *  supervisor.ts's `defaultManualMdPath` so verify failures and WSL crossover
 *  entries land in the same file. */
function defaultManualMdPath(configPath: string | undefined): string {
  const resolved = configPath ?? findProjectConfig();
  if (resolved) return join(dirname(resolve(resolved)), "MANUAL.md");
  return join(process.cwd(), "MANUAL.md");
}

const WSL_MANUAL_HEADER = "**MS.init.wsl-host-crossover — npm global prefix is on the Windows host.**";

function fileWslCrossoverEntry(path: string, prefix: string): boolean {
  let existing = "";
  if (existsSync(path)) {
    existing = readFileSync(path, "utf8");
    if (existing.includes(WSL_MANUAL_HEADER)) {
      // Already filed — re-runs of /devx-init must not duplicate.
      return true;
    }
  }

  // Strip backticks from the user-controlled prefix before splicing into a
  // backtick-delimited markdown span. We don't expect them, but a defensive
  // replacement keeps the rendered MANUAL.md well-formed regardless.
  const safePrefix = prefix.replace(/`/g, "'");

  const block = [
    "",
    `- [ ] ${WSL_MANUAL_HEADER}`,
    `  - Why: \`/devx-init\` ran under WSL and observed \`npm config get prefix\` returning \`${safePrefix}\`. \`npm i -g\` from this shell installs binaries onto the Windows PATH, not WSL's — slow over the 9P mount, breaks on file-permission boundaries, and silently desyncs from any \`npm i -g\` runs done inside a Linux-side prefix.`,
    `  - How: switch to a Linux-side global prefix:`,
    "    ```sh",
    "    npm config set prefix ~/.npm-global",
    '    export PATH="$HOME/.npm-global/bin:$PATH"',
    "    # then re-run any earlier `npm i -g` invocations",
    "    ```",
    `    Append the export to your shell rc (\`~/.bashrc\` or \`~/.zshrc\`).`,
    `  - Blocks: nothing (init still completed; this is informational).`,
    `  - Spec: \`dev/dev-ini505-2026-04-26T19:35-init-supervisor-trigger.md\`.`,
    "",
  ].join("\n");

  const content =
    existing.length > 0
      ? (existing.endsWith("\n") ? existing : existing + "\n") + block
      : `# MANUAL — Actions only the user can do\n\nItems here block \`/devx\` when the user's action is required. Check off when done.\n${block}`;

  writeAtomic(path, content);
  return true;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

const ROLES: ReadonlyArray<Role> = ["manager", "concierge"];

export function runInitSupervisor(
  opts: RunInitSupervisorOpts = {},
): InitSupervisorResult {
  // Resolve the platform once up front — both roles share the same answer,
  // and pinning it lets installSupervisor/verifySupervisor skip the YAML
  // re-read inside resolveSupervisorPlatform on each call (4× per run
  // otherwise, 0× now).
  const resolved = resolveSupervisorPlatform({
    configPath: opts.configPath,
    detectOs: opts.detectOs,
  });

  const manualMdPath =
    opts.manualMdPath ?? defaultManualMdPath(opts.configPath);

  // Shared option block for both install + verify per role. `platform` is
  // pinned to the resolved value so the dispatcher takes the "explicit"
  // branch and skips re-resolution.
  const sharedOpts = {
    platform: resolved.platform,
    warn: opts.warn,
    devxHome: opts.devxHome,
    templateDir: opts.templateDir,
    homeDir: opts.homeDir,
    unitDir: opts.unitDir,
    logDir: opts.logDir,
    exec: opts.exec,
    uid: opts.uid,
    linger: opts.linger,
    user: opts.user,
    distro: opts.distro,
    wslHome: opts.wslHome,
  };

  // ---- Per-role install + verify -----------------------------------------

  const roles: InitSupervisorRoleResult[] = [];

  if (resolved.platform === "none") {
    // installSupervisor still warns-once; we let it run for the side effect.
    for (const role of ROLES) {
      // `install` will always be "skipped" here per sup405's contract; we
      // discard it rather than surface it on the role result so the
      // orchestrator's "skipped" UI doesn't have to know the dispatcher's
      // internal vocabulary.
      installSupervisor(role, sharedOpts);
      roles.push({ role, status: "skipped", reason: "config-none" });
    }
  } else {
    for (const role of ROLES) {
      const install = installSupervisor(role, sharedOpts);
      const verify = verifySupervisor(role, { ...sharedOpts, manualMdPath });
      roles.push({ role, status: "ran", install, verify });
    }
  }

  // ---- WSL host-crossover check ------------------------------------------
  //
  // Independent of install/verify outcome — the warning is about the npm
  // prefix landing on the Windows host filesystem, which only matters in
  // WSL. Native Windows (process.platform === "win32") never has /mnt/<x>/
  // in `npm config get prefix`, so the WSL gate is the right guard.

  const isWsl = (opts.isWsl ?? defaultIsWsl)();
  let prefix: string | null = null;
  let onWindowsHost = false;
  let manualMdFiled = false;

  if (isWsl) {
    prefix = (opts.npmPrefix ?? defaultNpmPrefix)();
    onWindowsHost = isPrefixOnWindowsHost(prefix);
    if (onWindowsHost && prefix !== null) {
      manualMdFiled = fileWslCrossoverEntry(manualMdPath, prefix);
    }
  }

  return {
    platform: resolved.platform,
    source: resolved.source,
    roles,
    wslCrossover: {
      detected: isWsl,
      prefix,
      onWindowsHost,
      manualMdFiled,
    },
  };
}
