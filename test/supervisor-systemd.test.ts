// Linux systemd-user supervisor tests (sup403).
//
// Drives installSystemd / uninstallSystemd / renderSystemdUnit with synthetic
// homeDir / unitDir / exec inputs so the suite runs identically on macOS,
// Ubuntu, and any developer's box without bootstrapping real systemd units.
//
// Spec: dev/dev-sup403-2026-04-26T19:35-supervisor-systemd.md

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installSystemd,
  renderSystemdUnit,
  uninstallSystemd,
  type ExecResult,
  type SystemdExec,
} from "../src/lib/supervisor-systemd.js";
import {
  installSupervisor,
  uninstallSupervisor,
} from "../src/lib/supervisor.js";

const here = dirname(fileURLToPath(import.meta.url));

interface ExecCall {
  binary: "systemctl" | "loginctl";
  args: string[];
}

function makeRecordingExec(
  impl?: (binary: "systemctl" | "loginctl", args: string[]) => ExecResult
): {
  exec: SystemdExec;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  const exec: SystemdExec = (binary, args) => {
    calls.push({ binary, args });
    return impl ? impl(binary, args) : { status: 0 };
  };
  return { exec, calls };
}

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const REAL_TEMPLATE_DIR = resolve(here, "..", "_devx", "templates");
const REAL_UNIT_TEMPLATE_PATH = join(
  REAL_TEMPLATE_DIR,
  "systemd",
  "devx.service"
);

describe("sup403 — renderSystemdUnit", () => {
  it("substitutes __ROLE__ but leaves %h and %S literals in the real shipped template", () => {
    const out = renderSystemdUnit("manager");

    // No remaining __ROLE__ tokens after substitution.
    expect(out).not.toContain("__ROLE__");

    // %h and %S stay literal — systemd expands them at unit-load time.
    expect(out).toContain("%h/.devx/bin/devx-supervisor-stub.sh");
    expect(out).toContain("%S/devx/manager.out.log");
    expect(out).toContain("%S/devx/manager.err.log");

    // Required service keys.
    expect(out).toMatch(/^Type=simple$/m);
    expect(out).toMatch(/^Restart=always$/m);
    expect(out).toMatch(/^RestartSec=10$/m);
    expect(out).toMatch(/^StartLimitIntervalSec=0$/m);
    expect(out).toMatch(/^WantedBy=default\.target$/m);
    expect(out).toMatch(/^ExecStart=%h\/.devx\/bin\/devx-supervisor-stub\.sh manager$/m);
    expect(out).toMatch(/^StandardOutput=append:%S\/devx\/manager\.out\.log$/m);
    expect(out).toMatch(/^StandardError=append:%S\/devx\/manager\.err\.log$/m);
  });

  it("differs between manager and concierge in the role-bearing fields only", async () => {
    const m = renderSystemdUnit("manager");
    const c = renderSystemdUnit("concierge");
    expect(m).not.toBe(c);
    expect(c).toContain("ExecStart=%h/.devx/bin/devx-supervisor-stub.sh concierge");
    expect(c).toContain("StandardOutput=append:%S/devx/concierge.out.log");

    // The whole idempotency story relies on differing rendered content
    // producing differing hashes. Pin that explicitly so a future renderer
    // bug that strips the role can't pass undetected.
    const { createHash } = await import("node:crypto");
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(h(m)).not.toBe(h(c));
  });
});

describe("sup403 — installSystemd", () => {
  let devxHome: string;
  let unitDir: string;
  let homeDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup403-home-");
    homeDir = mkTmp("devx-sup403-userhome-");
    unitDir = mkTmp("devx-sup403-systemd-");
  });

  afterEach(() => {
    for (const d of [devxHome, homeDir, unitDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("fresh install: writes unit, calls daemon-reload + enable --now, updates state", () => {
    const { exec, calls } = makeRecordingExec();
    const result = installSystemd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      exec,
    });

    expect(result).toBe("fresh");

    // Unit file is on disk with substituted content.
    const unitPath = join(unitDir, "devx-manager.service");
    expect(existsSync(unitPath)).toBe(true);
    const unit = readFileSync(unitPath, "utf8");
    expect(unit).toContain("ExecStart=%h/.devx/bin/devx-supervisor-stub.sh manager");

    // Two calls: daemon-reload, enable --now (no prior install → no restart).
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual({
      binary: "systemctl",
      args: ["--user", "daemon-reload"],
    });
    expect(calls[1]).toEqual({
      binary: "systemctl",
      args: ["--user", "enable", "--now", "devx-manager.service"],
    });

    // State file has the per-role record.
    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager).toBeDefined();
    expect(state.manager.platform).toBe("systemd");
    expect(state.manager.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof state.manager.installed_at).toBe("string");
  });

  it("re-install with no unit drift → 'kept' and zero exec calls", () => {
    const { exec: e1 } = makeRecordingExec();
    installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec: e1 });

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installSystemd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      exec: e2,
    });

    expect(result).toBe("kept");
    expect(calls2).toEqual([]);
  });

  it("re-install with unit drift → 'rewritten', calls daemon-reload + restart (not enable)", () => {
    const { exec: e1 } = makeRecordingExec();
    installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec: e1 });

    // Tamper with the state-file's recorded hash so the next install detects
    // a "rewrite" — same as a template upgrade in a published package.
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    state.manager.hash = "0".repeat(64); // bogus hash
    writeFileSync(stateFile, JSON.stringify(state));

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installSystemd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      exec: e2,
    });
    expect(result).toBe("rewritten");

    // Drift path: daemon-reload + restart (NOT enable --now — already enabled).
    expect(calls2.length).toBe(2);
    expect(calls2[0].args).toEqual(["--user", "daemon-reload"]);
    expect(calls2[1].args).toEqual(["--user", "restart", "devx-manager.service"]);
  });

  it("re-install when unit file was deleted (state preserved) → 'rewritten'", () => {
    const { exec: e1 } = makeRecordingExec();
    installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec: e1 });

    rmSync(join(unitDir, "devx-manager.service"));

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installSystemd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      exec: e2,
    });
    expect(result).toBe("rewritten");
    expect(calls2.length).toBe(2);
    expect(calls2[1].args).toEqual(["--user", "restart", "devx-manager.service"]);
  });

  it("daemon-reload failure → throws + state file is NOT updated", () => {
    const { exec } = makeRecordingExec((binary, args) => {
      if (binary === "systemctl" && args[1] === "daemon-reload") {
        return { status: 1, stderr: "Failed to connect to bus\n" };
      }
      return { status: 0 };
    });

    expect(() =>
      installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec })
    ).toThrow(/daemon-reload.*failed/i);

    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.manager).toBeUndefined();
    }
  });

  it("enable --now failure → throws + state file is NOT updated", () => {
    const { exec } = makeRecordingExec((binary, args) => {
      if (binary === "systemctl" && args[1] === "enable") {
        return { status: 1, stderr: "Unit devx-manager.service does not exist\n" };
      }
      return { status: 0 };
    });

    expect(() =>
      installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec })
    ).toThrow(/enable.*failed/i);

    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.manager).toBeUndefined();
    }
  });

  it("unit write is atomic — no .tmp.* leftovers", () => {
    const { exec } = makeRecordingExec();
    installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec });
    const tmpInUnitDir = readdirSync(unitDir).filter((p) => p.includes(".tmp."));
    expect(tmpInUnitDir).toEqual([]);
  });

  it("manager and concierge can coexist in the same state file", () => {
    const { exec } = makeRecordingExec();
    installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec });
    installSystemd({ role: "concierge", devxHome, homeDir, unitDir, exec });

    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager.platform).toBe("systemd");
    expect(state.concierge.platform).toBe("systemd");
    expect(state.manager.hash).not.toBe(state.concierge.hash); // role differs
  });

  it("linger=true on fresh install → calls loginctl enable-linger after enable --now", () => {
    const { exec, calls } = makeRecordingExec();
    installSystemd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      linger: true,
      user: "leo",
      exec,
    });

    expect(calls.length).toBe(3);
    expect(calls[2]).toEqual({
      binary: "loginctl",
      args: ["enable-linger", "leo"],
    });
  });

  it("linger=false (default) → no loginctl call ever", () => {
    const { exec, calls } = makeRecordingExec();
    installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec });
    expect(calls.find((c) => c.binary === "loginctl")).toBeUndefined();
  });

  it("linger=true on no-op re-install → still calls loginctl (idempotent flip-on)", () => {
    const { exec: e1 } = makeRecordingExec();
    installSystemd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      exec: e1,
    });

    // Second pass: identical content, but linger=true now.
    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installSystemd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      linger: true,
      user: "leo",
      exec: e2,
    });

    expect(result).toBe("kept");
    expect(calls2).toEqual([
      { binary: "loginctl", args: ["enable-linger", "leo"] },
    ]);
  });

  it("loginctl failure surfaces as a thrown error AND state is recorded (unit IS installed)", () => {
    const { exec } = makeRecordingExec((binary) => {
      if (binary === "loginctl") {
        return { status: 1, stderr: "Failed to enable linger: Permission denied\n" };
      }
      return { status: 0 };
    });

    expect(() =>
      installSystemd({
        role: "manager",
        devxHome,
        homeDir,
        unitDir,
        linger: true,
        user: "leo",
        exec,
      })
    ).toThrow(/enable-linger.*failed/i);

    // Linger failed AFTER the unit was loaded + activated, so state must
    // reflect that: the unit IS installed. Otherwise a retry would compute
    // "fresh" instead of "kept", masking the original linger failure.
    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager).toBeDefined();
    expect(state.manager.platform).toBe("systemd");
  });
});

describe("sup403 — uninstallSystemd", () => {
  let devxHome: string;
  let unitDir: string;
  let homeDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup403-home-");
    homeDir = mkTmp("devx-sup403-userhome-");
    unitDir = mkTmp("devx-sup403-systemd-");
  });

  afterEach(() => {
    for (const d of [devxHome, homeDir, unitDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("after install → uninstall calls disable --now, removes unit, daemon-reloads, drops state", () => {
    const { exec: e1 } = makeRecordingExec();
    installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec: e1 });

    const { exec: e2, calls } = makeRecordingExec();
    const result = uninstallSystemd({
      role: "manager",
      devxHome,
      unitDir,
      exec: e2,
    });

    expect(result).toBe("removed");
    expect(existsSync(join(unitDir, "devx-manager.service"))).toBe(false);

    // disable --now → daemon-reload, in that order.
    expect(calls.length).toBe(2);
    expect(calls[0].args).toEqual([
      "--user",
      "disable",
      "--now",
      "devx-manager.service",
    ]);
    expect(calls[1].args).toEqual(["--user", "daemon-reload"]);

    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.manager).toBeUndefined();
    }
  });

  it("with no install ever → returns 'absent', no exec calls", () => {
    const { exec, calls } = makeRecordingExec();
    const result = uninstallSystemd({
      role: "manager",
      devxHome,
      unitDir,
      exec,
    });
    expect(result).toBe("absent");
    expect(calls).toEqual([]);
  });

  it("preserves other role records when uninstalling one", () => {
    const { exec: e1 } = makeRecordingExec();
    installSystemd({ role: "manager", devxHome, homeDir, unitDir, exec: e1 });
    installSystemd({ role: "concierge", devxHome, homeDir, unitDir, exec: e1 });

    const { exec: e2 } = makeRecordingExec();
    uninstallSystemd({ role: "manager", devxHome, unitDir, exec: e2 });

    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager).toBeUndefined();
    expect(state.concierge).toBeDefined();
  });
});

describe("sup403 — installSupervisor / uninstallSupervisor dispatch", () => {
  let devxHome: string;
  let unitDir: string;
  let homeDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup403-disp-");
    homeDir = mkTmp("devx-sup403-disp-home-");
    unitDir = mkTmp("devx-sup403-disp-systemd-");
  });

  afterEach(() => {
    for (const d of [devxHome, homeDir, unitDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("platform=systemd routes through installSystemd", () => {
    const { exec, calls } = makeRecordingExec();
    const result = installSupervisor("manager", "systemd", {
      devxHome,
      homeDir,
      unitDir,
      exec,
    });
    expect(result).toBe("fresh");
    // First call is daemon-reload, second is enable --now.
    expect(calls[0].args).toEqual(["--user", "daemon-reload"]);
    expect(calls[1].args).toEqual([
      "--user",
      "enable",
      "--now",
      "devx-manager.service",
    ]);
  });

  it("dispatch passes linger + user through to installSystemd", () => {
    const { exec, calls } = makeRecordingExec();
    installSupervisor("manager", "systemd", {
      devxHome,
      homeDir,
      unitDir,
      linger: true,
      user: "leo",
      exec,
    });
    const lingerCall = calls.find((c) => c.binary === "loginctl");
    expect(lingerCall).toEqual({
      binary: "loginctl",
      args: ["enable-linger", "leo"],
    });
  });

  it("uninstallSupervisor(systemd) routes through uninstallSystemd", () => {
    const { exec: e1 } = makeRecordingExec();
    installSupervisor("manager", "systemd", {
      devxHome,
      homeDir,
      unitDir,
      exec: e1,
    });

    const { exec: e2 } = makeRecordingExec();
    const result = uninstallSupervisor("manager", "systemd", {
      devxHome,
      homeDir,
      unitDir,
      exec: e2,
    });
    expect(result).toBe("removed");
  });
});

describe("sup403 — shipped unit template (compile-time check)", () => {
  it("template file is at _devx/templates/systemd/devx.service", () => {
    expect(existsSync(REAL_UNIT_TEMPLATE_PATH)).toBe(true);
  });
});
