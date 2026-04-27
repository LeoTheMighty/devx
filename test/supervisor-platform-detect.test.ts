// Platform auto-detect dispatch + post-install verification tests (sup405).
//
// Covers the new sup405 surface area on top of the existing sup402/3/4
// platform installers:
//   - resolveSupervisorPlatform (config + OS detection precedence)
//   - installSupervisor / uninstallSupervisor with no explicit platform
//   - `os_supervisor: none` short-circuit + warn-once
//   - verifySupervisor per platform — ok and fail paths
//   - MANUAL.md filing on fail (idempotent re-runs)
//
// Tests inject `detectOs`, `exec`, `warn`, `configPath`, and `manualMdPath`
// so the suite runs identically on every host without any real launchctl /
// systemctl / schtasks invocation.
//
// Spec: dev/dev-sup405-2026-04-26T19:35-supervisor-platform-detect.md

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defaultDetectOs,
  installSupervisor,
  resetNoneWarnedForTests,
  resolveSupervisorPlatform,
  uninstallSupervisor,
  verifySupervisor,
  type SupervisorPlatform,
} from "../src/lib/supervisor.js";

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Build a tmp project dir with a devx.config.yaml carrying the requested
 *  `manager.os_supervisor` value. */
function makeProjectWithConfig(value: string): { dir: string; configPath: string } {
  const dir = mkTmp("devx-sup405-proj-");
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(
    configPath,
    `# tmp config\nmanager:\n  os_supervisor: ${value}\n`,
    "utf8"
  );
  return { dir, configPath };
}

describe("sup405 — defaultDetectOs", () => {
  // We can't mock process.platform per-test cheaply (it's read-only on Node),
  // so we just sanity-check the current host returns one of the three known
  // platforms. Per-OS branches are covered by the tests that pass detectOs
  // directly.
  it("returns one of the three supported supervisor platforms on this host", () => {
    const got = defaultDetectOs();
    expect(["launchd", "systemd", "task-scheduler"]).toContain(got);
  });
});

describe("sup405 — resolveSupervisorPlatform", () => {
  it("explicit platform beats config + detection", () => {
    const { configPath, dir } = makeProjectWithConfig("auto");
    try {
      const r = resolveSupervisorPlatform({
        platform: "launchd",
        configPath,
        detectOs: () => "systemd",
      });
      expect(r).toEqual({ platform: "launchd", source: "explicit" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each<["launchd" | "systemd" | "task-scheduler", SupervisorPlatform]>([
    ["launchd", "launchd"],
    ["systemd", "systemd"],
    ["task-scheduler", "task-scheduler"],
  ])("config=%s resolves to %s with source=config", (configValue, expected) => {
    const { configPath, dir } = makeProjectWithConfig(configValue);
    try {
      const r = resolveSupervisorPlatform({ configPath });
      expect(r).toEqual({ platform: expected, source: "config" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each<[SupervisorPlatform]>([["launchd"], ["systemd"], ["task-scheduler"]])(
    "config=auto + injected detectOs returns %s with source=auto-detected",
    (detected) => {
      const { configPath, dir } = makeProjectWithConfig("auto");
      try {
        const r = resolveSupervisorPlatform({
          configPath,
          detectOs: () => detected,
        });
        expect(r).toEqual({ platform: detected, source: "auto-detected" });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  it("config=none resolves to platform=none with source=config", () => {
    const { configPath, dir } = makeProjectWithConfig("none");
    try {
      const r = resolveSupervisorPlatform({ configPath });
      expect(r).toEqual({ platform: "none", source: "config" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing config file falls back to auto-detect", () => {
    const r = resolveSupervisorPlatform({
      configPath: join(tmpdir(), "definitely-not-a-real-devx.config.yaml"),
      detectOs: () => "launchd",
    });
    expect(r).toEqual({ platform: "launchd", source: "auto-detected" });
  });
});

describe("sup405 — installSupervisor without explicit platform", () => {
  let devxHome: string;
  let homeDir: string;
  let unitDir: string;
  let logDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup405-home-");
    homeDir = mkTmp("devx-sup405-userhome-");
    unitDir = mkTmp("devx-sup405-units-");
    logDir = mkTmp("devx-sup405-logs-");
  });

  afterEach(() => {
    for (const d of [devxHome, homeDir, unitDir, logDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("config=auto + detectOs=launchd routes through installLaunchd", () => {
    const { configPath, dir } = makeProjectWithConfig("auto");
    const calls: string[][] = [];
    try {
      const result = installSupervisor("manager", {
        configPath,
        detectOs: () => "launchd",
        devxHome,
        homeDir,
        unitDir,
        logDir,
        uid: 501,
        exec: (args: string[]) => {
          calls.push(args);
          return { status: 0 };
        },
      });
      expect(result).toBe("fresh");
      expect(calls[0][0]).toBe("bootstrap");
      expect(existsSync(join(unitDir, "dev.devx.manager.plist"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config=auto + detectOs=systemd routes through installSystemd", () => {
    const { configPath, dir } = makeProjectWithConfig("auto");
    const calls: { binary: string; args: string[] }[] = [];
    try {
      const result = installSupervisor("manager", {
        configPath,
        detectOs: () => "systemd",
        devxHome,
        homeDir,
        unitDir,
        exec: ((binary: "systemctl" | "loginctl", args: string[]) => {
          calls.push({ binary, args });
          return { status: 0 };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      });
      expect(result).toBe("fresh");
      expect(calls[0]).toEqual({
        binary: "systemctl",
        args: ["--user", "daemon-reload"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config=auto + detectOs=task-scheduler routes through installTaskScheduler", () => {
    const { configPath, dir } = makeProjectWithConfig("auto");
    const calls: string[][] = [];
    try {
      const result = installSupervisor("manager", {
        configPath,
        detectOs: () => "task-scheduler",
        devxHome,
        unitDir,
        user: "leo",
        exec: (args: string[]) => {
          calls.push(args);
          return { status: 0 };
        },
      });
      expect(result).toBe("fresh");
      expect(calls[0][0]).toBe("/Create");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sup405 — os_supervisor: none short-circuit", () => {
  beforeEach(() => {
    resetNoneWarnedForTests();
  });

  it("install returns 'skipped' and warns once on stderr", () => {
    const { configPath, dir } = makeProjectWithConfig("none");
    const warnings: string[] = [];
    try {
      const r1 = installSupervisor("manager", {
        configPath,
        warn: (m) => warnings.push(m),
      });
      const r2 = installSupervisor("concierge", {
        configPath,
        warn: (m) => warnings.push(m),
      });
      expect(r1).toBe("skipped");
      expect(r2).toBe("skipped");
      // Warn fires exactly once across both calls (both processes lifetimes,
      // both roles).
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toMatch(/disabled per config/i);
      expect(warnings[0]).toMatch(/manager\.os_supervisor: none/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uninstall returns 'skipped' and shares the warn-once flag", () => {
    const { configPath, dir } = makeProjectWithConfig("none");
    const warnings: string[] = [];
    try {
      // Pre-warn from an install, then assert uninstall doesn't warn again.
      installSupervisor("manager", {
        configPath,
        warn: (m) => warnings.push(m),
      });
      expect(warnings.length).toBe(1);

      const r = uninstallSupervisor("manager", {
        configPath,
        warn: (m) => warnings.push(m),
      });
      expect(r).toBe("skipped");
      expect(warnings.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("verify returns ok with platform 'none' and does not file MANUAL.md", () => {
    const { configPath, dir } = makeProjectWithConfig("none");
    const manualMdPath = join(dir, "MANUAL.md");
    try {
      const r = verifySupervisor("manager", {
        configPath,
        manualMdPath,
      });
      expect(r.ok).toBe(true);
      expect(r.platform).toBe("none");
      expect(existsSync(manualMdPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sup405 — verifySupervisor (per platform)", () => {
  let projectDir: string;
  let manualMdPath: string;

  beforeEach(() => {
    projectDir = mkTmp("devx-sup405-verify-proj-");
    manualMdPath = join(projectDir, "MANUAL.md");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  // -- launchd --

  it("launchd ok: launchctl print exits 0 and stdout has 'state = running'", () => {
    const r = verifySupervisor("manager", {
      platform: "launchd",
      manualMdPath,
      uid: 501,
      exec: () => ({
        status: 0,
        stdout: [
          "gui/501/dev.devx.manager = {",
          "    state = running",
          "    pid = 12345",
          "}",
        ].join("\n"),
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.platform).toBe("launchd");
    expect(r.detail).toMatch(/running/);
    expect(existsSync(manualMdPath)).toBe(false);
  });

  it("launchd fail (exit non-zero): files MANUAL.md entry, returns ok=false", () => {
    const r = verifySupervisor("manager", {
      platform: "launchd",
      manualMdPath,
      uid: 501,
      exec: () => ({
        status: 113,
        stderr: "Could not find service \"dev.devx.manager\" in domain for: gui/501\n",
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.platform).toBe("launchd");
    expect(existsSync(manualMdPath)).toBe(true);
    const md = readFileSync(manualMdPath, "utf8");
    expect(md).toContain("MS.launchd.manager");
    expect(md).toContain("supervisor unit failed verification");
    expect(md).toContain("launchctl print");
  });

  it("launchd fail (loaded but state != running) surfaces the actual state line", () => {
    const r = verifySupervisor("concierge", {
      platform: "launchd",
      manualMdPath,
      uid: 501,
      exec: () => ({
        status: 0,
        stdout: ["gui/501/dev.devx.concierge = {", "    state = waiting", "}"].join("\n"),
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/state = waiting/);
    const md = readFileSync(manualMdPath, "utf8");
    expect(md).toContain("MS.launchd.concierge");
    expect(md).toContain("Detail at verify time");
    expect(md).toContain("waiting");
  });

  // -- systemd --

  it("systemd ok: is-active exits 0 with stdout 'active'", () => {
    const r = verifySupervisor("manager", {
      platform: "systemd",
      manualMdPath,
      exec: ((binary: string, args: string[]) => {
        expect(binary).toBe("systemctl");
        expect(args).toEqual(["--user", "is-active", "devx-manager.service"]);
        return { status: 0, stdout: "active\n" };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    });
    expect(r.ok).toBe(true);
    expect(r.platform).toBe("systemd");
    expect(existsSync(manualMdPath)).toBe(false);
  });

  it("systemd fail: is-active says 'inactive' (exit 3)", () => {
    const r = verifySupervisor("manager", {
      platform: "systemd",
      manualMdPath,
      exec: ((_binary: string, _args: string[]) => ({
        status: 3,
        stdout: "inactive\n",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/inactive/);
    expect(existsSync(manualMdPath)).toBe(true);
    const md = readFileSync(manualMdPath, "utf8");
    expect(md).toContain("MS.systemd.manager");
    expect(md).toContain("systemctl --user status");
  });

  // -- task-scheduler --

  it("task-scheduler ok: /Query reports Status: Ready", () => {
    const r = verifySupervisor("manager", {
      platform: "task-scheduler",
      manualMdPath,
      exec: (() => ({
        status: 0,
        stdout: [
          "Folder: \\",
          "HostName:                              MYPC",
          "TaskName:                             \\devx-manager",
          "Status:                               Ready",
          "Logon Mode:                           Interactive only",
        ].join("\r\n"),
      })) as () => { status: number; stdout: string },
    });
    expect(r.ok).toBe(true);
    expect(r.platform).toBe("task-scheduler");
    expect(existsSync(manualMdPath)).toBe(false);
  });

  it("task-scheduler ok: Status: Running counts too", () => {
    const r = verifySupervisor("manager", {
      platform: "task-scheduler",
      manualMdPath,
      exec: () => ({
        status: 0,
        stdout: "Status: Running",
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("task-scheduler fail: /Query exits non-zero", () => {
    const r = verifySupervisor("manager", {
      platform: "task-scheduler",
      manualMdPath,
      exec: () => ({
        status: 1,
        stderr: "ERROR: The system cannot find the file specified.\r\n",
      }),
    });
    expect(r.ok).toBe(false);
    expect(existsSync(manualMdPath)).toBe(true);
    const md = readFileSync(manualMdPath, "utf8");
    expect(md).toContain("MS.task-scheduler.manager");
    expect(md).toContain("schtasks /Query");
  });

  it("task-scheduler fail: Status: Disabled gets surfaced verbatim", () => {
    const r = verifySupervisor("concierge", {
      platform: "task-scheduler",
      manualMdPath,
      exec: () => ({
        status: 0,
        stdout: "Status:                               Disabled",
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Disabled/);
  });
});

describe("sup405 — MANUAL.md filing is idempotent", () => {
  it("a second failed verify with the same role+platform doesn't duplicate the entry", () => {
    const projectDir = mkTmp("devx-sup405-idem-");
    const manualMdPath = join(projectDir, "MANUAL.md");
    try {
      const failExec = () => ({ status: 113, stderr: "missing\n" });

      verifySupervisor("manager", {
        platform: "launchd",
        manualMdPath,
        uid: 501,
        exec: failExec,
      });
      verifySupervisor("manager", {
        platform: "launchd",
        manualMdPath,
        uid: 501,
        exec: failExec,
      });

      const md = readFileSync(manualMdPath, "utf8");
      const occurrences = md.split("MS.launchd.manager").length - 1;
      expect(occurrences).toBe(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("preserves prior MANUAL.md content when appending a new entry", () => {
    const projectDir = mkTmp("devx-sup405-preserve-");
    const manualMdPath = join(projectDir, "MANUAL.md");
    const prior = "# MANUAL\n\n- [ ] **M0.0** — pre-existing user-typed entry, do not lose.\n";
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(manualMdPath, prior, "utf8");
    try {
      verifySupervisor("manager", {
        platform: "systemd",
        manualMdPath,
        exec: ((_b: string, _a: string[]) => ({ status: 3, stdout: "inactive\n" })) as unknown as
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          any,
      });

      const md = readFileSync(manualMdPath, "utf8");
      expect(md).toContain("M0.0");
      expect(md).toContain("MS.systemd.manager");
      // Original line ordering preserved (prior content first).
      expect(md.indexOf("M0.0")).toBeLessThan(md.indexOf("MS.systemd.manager"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
