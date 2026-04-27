// /devx-init supervisor trigger + verify tests (ini505).
//
// Covers the per-AC paths for runInitSupervisor():
//   - macOS detection (auto → launchd) installs both roles
//   - Linux detection (auto → systemd) installs both roles
//   - WSL detection: routes through task-scheduler AND files MANUAL.md
//     when `npm config get prefix` lands on `/mnt/<letter>/`
//   - WSL with a Linux-side prefix: no MANUAL.md crossover entry
//   - Explicit `os_supervisor: none`: both roles report skipped, no MANUAL.md
//   - Verification failure: the verify step's MANUAL.md entry lands but the
//     overall init result still completes (does not throw / does not abort)
//
// Tests inject every side-effect surface — configPath, detectOs, exec,
// isWsl, npmPrefix, manualMdPath, devxHome, homeDir, unitDir, logDir, uid,
// user — so the suite is hermetic on any host.
//
// Spec: dev/dev-ini505-2026-04-26T19:35-init-supervisor-trigger.md

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runInitSupervisor } from "../src/lib/init-supervisor.js";
import { resetNoneWarnedForTests } from "../src/lib/supervisor.js";

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeProjectWithConfig(value: string): {
  dir: string;
  configPath: string;
} {
  const dir = mkTmp("devx-ini505-proj-");
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(
    configPath,
    `# tmp config\nmanager:\n  os_supervisor: ${value}\n`,
    "utf8",
  );
  return { dir, configPath };
}

interface PlatformPaths {
  devxHome: string;
  homeDir: string;
  unitDir: string;
  logDir: string;
}

function makePaths(): PlatformPaths {
  return {
    devxHome: mkTmp("devx-ini505-home-"),
    homeDir: mkTmp("devx-ini505-userhome-"),
    unitDir: mkTmp("devx-ini505-units-"),
    logDir: mkTmp("devx-ini505-logs-"),
  };
}

function cleanPaths(p: PlatformPaths, configDir: string): void {
  for (const d of [p.devxHome, p.homeDir, p.unitDir, p.logDir, configDir]) {
    rmSync(d, { recursive: true, force: true });
  }
}

describe("ini505 — runInitSupervisor (auto → launchd, macOS)", () => {
  let paths: PlatformPaths;
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    paths = makePaths();
    const made = makeProjectWithConfig("auto");
    configDir = made.dir;
    configPath = made.configPath;
  });

  afterEach(() => {
    cleanPaths(paths, configDir);
  });

  it("installs and verifies both manager + concierge via launchd", () => {
    // Single exec stub services both install (launchctl bootstrap) and
    // verify (launchctl print) per role. Verify must produce stdout that
    // verifyLaunchd recognises ("state = running").
    const calls: string[][] = [];
    const exec = (args: string[]) => {
      calls.push(args);
      if (args[0] === "print") {
        const target = args[1] ?? "";
        return {
          status: 0,
          stdout: [
            `${target} = {`,
            "    state = running",
            "    pid = 1234",
            "}",
          ].join("\n"),
        };
      }
      return { status: 0 };
    };

    const result = runInitSupervisor({
      configPath,
      detectOs: () => "launchd",
      isWsl: () => false,
      ...paths,
      uid: 501,
      exec,
    });

    expect(result.platform).toBe("launchd");
    expect(result.source).toBe("auto-detected");
    expect(result.roles).toHaveLength(2);

    for (const role of ["manager", "concierge"] as const) {
      const r = result.roles.find((x) => x.role === role);
      expect(r).toBeDefined();
      if (r?.status !== "ran") throw new Error("expected status=ran");
      expect(r.install).toBe("fresh");
      expect(r.verify.ok).toBe(true);
      expect(r.verify.platform).toBe("launchd");
      expect(existsSync(join(paths.unitDir, `dev.devx.${role}.plist`))).toBe(
        true,
      );
    }

    // Bootstrap call landed for both roles + at least one print call per role.
    const bootstraps = calls.filter((c) => c[0] === "bootstrap");
    const prints = calls.filter((c) => c[0] === "print");
    expect(bootstraps.length).toBe(2);
    expect(prints.length).toBe(2);
    expect(result.wslCrossover.detected).toBe(false);
    expect(result.wslCrossover.manualMdFiled).toBe(false);
  });
});

describe("ini505 — runInitSupervisor (auto → systemd, Linux)", () => {
  let paths: PlatformPaths;
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    paths = makePaths();
    const made = makeProjectWithConfig("auto");
    configDir = made.dir;
    configPath = made.configPath;
  });

  afterEach(() => {
    cleanPaths(paths, configDir);
  });

  it("installs and verifies both manager + concierge via systemd", () => {
    const calls: { binary: string; args: string[] }[] = [];
    const exec = (binary: string, args: string[]) => {
      calls.push({ binary, args });
      // Verify path: `systemctl --user is-active devx-<role>.service` →
      // exit 0 + stdout 'active' is the success contract.
      if (
        binary === "systemctl" &&
        args[0] === "--user" &&
        args[1] === "is-active"
      ) {
        return { status: 0, stdout: "active\n" };
      }
      return { status: 0 };
    };

    const result = runInitSupervisor({
      configPath,
      detectOs: () => "systemd",
      isWsl: () => false,
      ...paths,
      user: "leo",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exec: exec as any,
    });

    expect(result.platform).toBe("systemd");
    for (const role of ["manager", "concierge"] as const) {
      const r = result.roles.find((x) => x.role === role);
      if (r?.status !== "ran") throw new Error("expected status=ran");
      expect(r.install).toBe("fresh");
      expect(r.verify.ok).toBe(true);
      expect(r.verify.platform).toBe("systemd");
      expect(existsSync(join(paths.unitDir, `devx-${role}.service`))).toBe(
        true,
      );
    }

    // daemon-reload fired (at least once across the two roles).
    const reloads = calls.filter(
      (c) =>
        c.binary === "systemctl" &&
        c.args[0] === "--user" &&
        c.args[1] === "daemon-reload",
    );
    expect(reloads.length).toBeGreaterThanOrEqual(2);
    expect(result.wslCrossover.detected).toBe(false);
  });
});

describe("ini505 — runInitSupervisor (auto → task-scheduler, WSL)", () => {
  let paths: PlatformPaths;
  let configDir: string;
  let configPath: string;
  let manualMdPath: string;

  beforeEach(() => {
    paths = makePaths();
    const made = makeProjectWithConfig("auto");
    configDir = made.dir;
    configPath = made.configPath;
    manualMdPath = join(configDir, "MANUAL.md");
  });

  afterEach(() => {
    cleanPaths(paths, configDir);
  });

  it("WSL host-crossover (npm prefix on /mnt/c/) files MANUAL.md, init still completes", () => {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
      calls.push(args);
      if (args[0] === "/Query") {
        return { status: 0, stdout: "Status:                               Ready" };
      }
      return { status: 0 };
    };

    const result = runInitSupervisor({
      configPath,
      manualMdPath,
      detectOs: () => "task-scheduler",
      isWsl: () => true,
      npmPrefix: () => "/mnt/c/Users/leo/AppData/Roaming/npm",
      ...paths,
      user: "leo",
      exec,
    });

    expect(result.platform).toBe("task-scheduler");
    for (const role of ["manager", "concierge"] as const) {
      const r = result.roles.find((x) => x.role === role);
      if (r?.status !== "ran") throw new Error("expected status=ran");
      expect(r.install).toBe("fresh");
      expect(r.verify.ok).toBe(true);
      expect(r.verify.platform).toBe("task-scheduler");
    }

    expect(result.wslCrossover.detected).toBe(true);
    expect(result.wslCrossover.prefix).toBe(
      "/mnt/c/Users/leo/AppData/Roaming/npm",
    );
    expect(result.wslCrossover.onWindowsHost).toBe(true);
    expect(result.wslCrossover.manualMdFiled).toBe(true);

    expect(existsSync(manualMdPath)).toBe(true);
    const md = readFileSync(manualMdPath, "utf8");
    expect(md).toContain("MS.init.wsl-host-crossover");
    expect(md).toContain("/mnt/c/Users/leo/AppData/Roaming/npm");
    expect(md).toContain("npm config set prefix ~/.npm-global");
  });

  it("WSL with a Linux-side prefix does NOT file MANUAL.md", () => {
    const result = runInitSupervisor({
      configPath,
      manualMdPath,
      detectOs: () => "task-scheduler",
      isWsl: () => true,
      npmPrefix: () => "/home/leo/.npm-global",
      ...paths,
      user: "leo",
      exec: ((args: string[]) => {
        if (args[0] === "/Query") {
          return { status: 0, stdout: "Status: Ready" };
        }
        return { status: 0 };
      }) as (args: string[]) => { status: number; stdout?: string },
    });

    expect(result.wslCrossover.detected).toBe(true);
    expect(result.wslCrossover.prefix).toBe("/home/leo/.npm-global");
    expect(result.wslCrossover.onWindowsHost).toBe(false);
    expect(result.wslCrossover.manualMdFiled).toBe(false);
    expect(existsSync(manualMdPath)).toBe(false);
  });

  it("WSL crossover MANUAL.md write is idempotent across re-runs", () => {
    const exec = (args: string[]) => {
      if (args[0] === "/Query") return { status: 0, stdout: "Status: Ready" };
      return { status: 0 };
    };

    runInitSupervisor({
      configPath,
      manualMdPath,
      detectOs: () => "task-scheduler",
      isWsl: () => true,
      npmPrefix: () => "/mnt/c/foo",
      ...paths,
      exec,
    });
    runInitSupervisor({
      configPath,
      manualMdPath,
      detectOs: () => "task-scheduler",
      isWsl: () => true,
      npmPrefix: () => "/mnt/c/foo",
      ...paths,
      exec,
    });

    const md = readFileSync(manualMdPath, "utf8");
    const occurrences = md.split("MS.init.wsl-host-crossover").length - 1;
    expect(occurrences).toBe(1);
  });

  it("preserves prior MANUAL.md content when filing the crossover entry", () => {
    const prior =
      "# MANUAL\n\n- [ ] **M0.0** — pre-existing user-typed entry, do not lose.\n";
    writeFileSync(manualMdPath, prior, "utf8");

    runInitSupervisor({
      configPath,
      manualMdPath,
      detectOs: () => "task-scheduler",
      isWsl: () => true,
      npmPrefix: () => "/mnt/d/path",
      ...paths,
      exec: ((args: string[]) => {
        if (args[0] === "/Query") return { status: 0, stdout: "Status: Ready" };
        return { status: 0 };
      }) as (args: string[]) => { status: number; stdout?: string },
    });

    const md = readFileSync(manualMdPath, "utf8");
    expect(md).toContain("M0.0");
    expect(md).toContain("MS.init.wsl-host-crossover");
    expect(md.indexOf("M0.0")).toBeLessThan(
      md.indexOf("MS.init.wsl-host-crossover"),
    );
  });
});

describe("ini505 — runInitSupervisor (os_supervisor: none)", () => {
  let configDir: string;
  let configPath: string;
  let manualMdPath: string;

  beforeEach(() => {
    resetNoneWarnedForTests();
    const made = makeProjectWithConfig("none");
    configDir = made.dir;
    configPath = made.configPath;
    manualMdPath = join(configDir, "MANUAL.md");
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("both roles report skipped; no MANUAL.md filed; warns once", () => {
    const warnings: string[] = [];
    const result = runInitSupervisor({
      configPath,
      manualMdPath,
      isWsl: () => false,
      warn: (m) => warnings.push(m),
    });

    expect(result.platform).toBe("none");
    expect(result.source).toBe("config");
    expect(result.roles).toHaveLength(2);
    for (const r of result.roles) {
      expect(r.status).toBe("skipped");
      if (r.status === "skipped") expect(r.reason).toBe("config-none");
    }
    expect(existsSync(manualMdPath)).toBe(false);
    // Warn fires once across both role install attempts.
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/disabled per config/i);
  });
});

describe("ini505 — runInitSupervisor (verify failure)", () => {
  let paths: PlatformPaths;
  let configDir: string;
  let configPath: string;
  let manualMdPath: string;

  beforeEach(() => {
    paths = makePaths();
    const made = makeProjectWithConfig("auto");
    configDir = made.dir;
    configPath = made.configPath;
    manualMdPath = join(configDir, "MANUAL.md");
  });

  afterEach(() => {
    cleanPaths(paths, configDir);
  });

  it("verify failure files MANUAL.md but does NOT abort init", () => {
    // Install path (launchctl bootstrap) succeeds; verify path
    // (launchctl print) fails with non-zero status. verifySupervisor files
    // its own MANUAL.md entry; runInitSupervisor returns normally with
    // verify.ok=false captured per role.
    const exec = (args: string[]) => {
      if (args[0] === "print") {
        return {
          status: 113,
          stderr: 'Could not find service "dev.devx.<role>" in domain\n',
        };
      }
      return { status: 0 };
    };

    const result = runInitSupervisor({
      configPath,
      manualMdPath,
      detectOs: () => "launchd",
      isWsl: () => false,
      ...paths,
      uid: 501,
      exec,
    });

    expect(result.platform).toBe("launchd");
    for (const role of ["manager", "concierge"] as const) {
      const r = result.roles.find((x) => x.role === role);
      if (r?.status !== "ran") throw new Error("expected status=ran");
      // Install succeeded — the unit file landed.
      expect(r.install).toBe("fresh");
      // Verify failed — but init didn't abort.
      expect(r.verify.ok).toBe(false);
      expect(r.verify.platform).toBe("launchd");
    }

    expect(existsSync(manualMdPath)).toBe(true);
    const md = readFileSync(manualMdPath, "utf8");
    expect(md).toContain("MS.launchd.manager");
    expect(md).toContain("MS.launchd.concierge");
  });
});
