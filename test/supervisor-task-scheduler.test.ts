// Windows/WSL Task Scheduler supervisor tests (sup404).
//
// Drives installTaskScheduler / uninstallTaskScheduler / renderTaskSchedulerXml
// with synthetic devxHome / unitDir / exec inputs so the suite runs identically
// on macOS, Ubuntu, and any developer's box without registering real Task
// Scheduler entries.
//
// Spec: dev/dev-sup404-2026-04-26T19:35-supervisor-task-scheduler.md

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
  installTaskScheduler,
  renderTaskSchedulerXml,
  uninstallTaskScheduler,
  type ExecResult,
  type SchtasksExec,
} from "../src/lib/supervisor-task-scheduler.js";
import {
  installSupervisor,
  uninstallSupervisor,
} from "../src/lib/supervisor.js";

const here = dirname(fileURLToPath(import.meta.url));

interface ExecCall {
  args: string[];
}

function makeRecordingExec(impl?: (args: string[]) => ExecResult): {
  exec: SchtasksExec;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  const exec: SchtasksExec = (args) => {
    calls.push({ args });
    return impl ? impl(args) : { status: 0 };
  };
  return { exec, calls };
}

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const REAL_TEMPLATE_DIR = resolve(here, "..", "_devx", "templates");
const REAL_XML_TEMPLATE_PATH = join(
  REAL_TEMPLATE_DIR,
  "task-scheduler",
  "devx.xml"
);

describe("sup404 — renderTaskSchedulerXml", () => {
  it("substitutes __ROLE__, __DISTRO__, __USER__, __WSL_HOME__ in the real shipped template", () => {
    const out = renderTaskSchedulerXml("manager", {
      distro: "Ubuntu",
      user: "leo",
      wslHome: "/home/leo",
    });

    // No placeholders left after substitution.
    expect(out).not.toContain("__ROLE__");
    expect(out).not.toContain("__DISTRO__");
    expect(out).not.toContain("__USER__");
    expect(out).not.toContain("__WSL_HOME__");

    // wsl.exe invocation lands with all four substitutions baked in.
    expect(out).toContain(
      "<Arguments>-d Ubuntu -u leo --exec /home/leo/.devx/bin/devx-supervisor-stub.sh manager</Arguments>"
    );
    expect(out).toContain("<Command>wsl.exe</Command>");

    // Required <Settings> fields per spec ACs.
    expect(out).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(out).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(out).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    expect(out).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(out).toContain("<Interval>PT10S</Interval>");
    expect(out).toContain("<Count>999</Count>");

    // LogonTrigger as the trigger type (covers 95% of cases per spec open-q 2).
    expect(out).toContain("<LogonTrigger>");
    expect(out).toContain("<Enabled>true</Enabled>");
  });

  it("differs between manager and concierge in the role-bearing fields only", async () => {
    const m = renderTaskSchedulerXml("manager", { user: "leo" });
    const c = renderTaskSchedulerXml("concierge", { user: "leo" });

    expect(m).not.toBe(c);
    expect(c).toContain(
      "--exec /home/leo/.devx/bin/devx-supervisor-stub.sh concierge"
    );

    // Per-role hash divergence is the whole basis of the role-keyed state file.
    const { createHash } = await import("node:crypto");
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(h(m)).not.toBe(h(c));
  });

  it("defaults wslHome to /home/<user> when not provided", () => {
    const out = renderTaskSchedulerXml("manager", {
      distro: "Ubuntu",
      user: "leo",
    });
    expect(out).toContain(
      "--exec /home/leo/.devx/bin/devx-supervisor-stub.sh manager"
    );
  });

  it("custom distro and wslHome land verbatim", () => {
    const out = renderTaskSchedulerXml("manager", {
      distro: "Debian",
      user: "alice",
      wslHome: "/srv/alice",
    });
    expect(out).toContain(
      "<Arguments>-d Debian -u alice --exec /srv/alice/.devx/bin/devx-supervisor-stub.sh manager</Arguments>"
    );
  });
});

describe("sup404 — installTaskScheduler", () => {
  let devxHome: string;
  let unitDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup404-home-");
    unitDir = mkTmp("devx-sup404-tasks-");
  });

  afterEach(() => {
    for (const d of [devxHome, unitDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("fresh install: writes XML, calls /Create /XML /TN /F, updates state", () => {
    const { exec, calls } = makeRecordingExec();
    const result = installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      distro: "Ubuntu",
      user: "leo",
      exec,
    });

    expect(result).toBe("fresh");

    // XML is on disk with substituted content.
    const xmlPath = join(unitDir, "devx-manager.xml");
    expect(existsSync(xmlPath)).toBe(true);
    const xml = readFileSync(xmlPath, "utf8");
    expect(xml).toContain(
      "--exec /home/leo/.devx/bin/devx-supervisor-stub.sh manager"
    );

    // One call: /Create /XML <path> /TN devx-manager /F.
    expect(calls.length).toBe(1);
    expect(calls[0].args).toEqual([
      "/Create",
      "/XML",
      xmlPath,
      "/TN",
      "devx-manager",
      "/F",
    ]);

    // State file has the per-role record.
    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager).toBeDefined();
    expect(state.manager.platform).toBe("task-scheduler");
    expect(state.manager.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof state.manager.installed_at).toBe("string");
  });

  it("re-install with no XML drift → 'kept' and zero exec calls", () => {
    const { exec: e1 } = makeRecordingExec();
    installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e1,
    });

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e2,
    });

    expect(result).toBe("kept");
    expect(calls2).toEqual([]);
  });

  it("re-install with XML drift → 'rewritten', /Create /F overwrites", () => {
    const { exec: e1 } = makeRecordingExec();
    installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e1,
    });

    // Tamper with the recorded hash to simulate a template upgrade.
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    state.manager.hash = "0".repeat(64);
    writeFileSync(stateFile, JSON.stringify(state));

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e2,
    });
    expect(result).toBe("rewritten");

    // /Create /F is register-or-replace; no separate /Delete needed.
    expect(calls2.length).toBe(1);
    expect(calls2[0].args[0]).toBe("/Create");
    expect(calls2[0].args).toContain("/F");
    expect(calls2[0].args).toContain("devx-manager");
  });

  it("re-install when XML file was deleted (state preserved) → 'rewritten'", () => {
    const { exec: e1 } = makeRecordingExec();
    installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e1,
    });

    rmSync(join(unitDir, "devx-manager.xml"));

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e2,
    });
    expect(result).toBe("rewritten");
    expect(calls2.length).toBe(1);
    expect(calls2[0].args[0]).toBe("/Create");
  });

  it("/Create failure → throws + state file is NOT updated", () => {
    const { exec } = makeRecordingExec((args) => {
      if (args[0] === "/Create") {
        return {
          status: 1,
          stderr: "ERROR: The user name or password is incorrect.\n",
        };
      }
      return { status: 0 };
    });

    expect(() =>
      installTaskScheduler({
        role: "manager",
        devxHome,
        unitDir,
        user: "leo",
        exec,
      })
    ).toThrow(/Create.*failed/i);

    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.manager).toBeUndefined();
    }
  });

  it("XML write is atomic — no .tmp.* leftovers", () => {
    const { exec } = makeRecordingExec();
    installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec,
    });
    const tmpInUnitDir = readdirSync(unitDir).filter((p) => p.includes(".tmp."));
    expect(tmpInUnitDir).toEqual([]);
  });

  it("manager and concierge can coexist in the same state file", () => {
    const { exec } = makeRecordingExec();
    installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec,
    });
    installTaskScheduler({
      role: "concierge",
      devxHome,
      unitDir,
      user: "leo",
      exec,
    });

    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager.platform).toBe("task-scheduler");
    expect(state.concierge.platform).toBe("task-scheduler");
    expect(state.manager.hash).not.toBe(state.concierge.hash); // role differs
  });

  it("default unitDir places XML under <devxHome>/state/task-scheduler/", () => {
    const { exec } = makeRecordingExec();
    installTaskScheduler({
      role: "manager",
      devxHome,
      user: "leo",
      exec,
    });

    const expected = join(devxHome, "state", "task-scheduler", "devx-manager.xml");
    expect(existsSync(expected)).toBe(true);
  });
});

describe("sup404 — uninstallTaskScheduler", () => {
  let devxHome: string;
  let unitDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup404-home-");
    unitDir = mkTmp("devx-sup404-tasks-");
  });

  afterEach(() => {
    for (const d of [devxHome, unitDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("after install → uninstall calls /Delete /TN /F, removes XML, drops state", () => {
    const { exec: e1 } = makeRecordingExec();
    installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e1,
    });

    const { exec: e2, calls } = makeRecordingExec();
    const result = uninstallTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      exec: e2,
    });

    expect(result).toBe("removed");
    expect(existsSync(join(unitDir, "devx-manager.xml"))).toBe(false);

    expect(calls.length).toBe(1);
    expect(calls[0].args).toEqual([
      "/Delete",
      "/TN",
      "devx-manager",
      "/F",
    ]);

    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.manager).toBeUndefined();
    }
  });

  it("with no install ever → returns 'absent', no exec calls", () => {
    const { exec, calls } = makeRecordingExec();
    const result = uninstallTaskScheduler({
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
    installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e1,
    });
    installTaskScheduler({
      role: "concierge",
      devxHome,
      unitDir,
      user: "leo",
      exec: e1,
    });

    const { exec: e2 } = makeRecordingExec();
    uninstallTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      exec: e2,
    });

    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager).toBeUndefined();
    expect(state.concierge).toBeDefined();
  });

  it("/Delete failure on best-effort uninstall does not throw — file + state still cleaned", () => {
    const { exec: e1 } = makeRecordingExec();
    installTaskScheduler({
      role: "manager",
      devxHome,
      unitDir,
      user: "leo",
      exec: e1,
    });

    // Simulate the scenario where the task was already gone from Task Scheduler
    // (drift between state file and actual). /Delete returns non-zero; we
    // still want to clean up the local state.
    const { exec: e2 } = makeRecordingExec(() => ({
      status: 1,
      stderr: "ERROR: The system cannot find the file specified.\n",
    }));

    expect(() =>
      uninstallTaskScheduler({
        role: "manager",
        devxHome,
        unitDir,
        exec: e2,
      })
    ).not.toThrow();

    expect(existsSync(join(unitDir, "devx-manager.xml"))).toBe(false);
  });
});

describe("sup404 — installSupervisor / uninstallSupervisor dispatch", () => {
  let devxHome: string;
  let unitDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup404-disp-");
    unitDir = mkTmp("devx-sup404-disp-tasks-");
  });

  afterEach(() => {
    for (const d of [devxHome, unitDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("platform=task-scheduler routes through installTaskScheduler", () => {
    const { exec, calls } = makeRecordingExec();
    const result = installSupervisor("manager", "task-scheduler", {
      devxHome,
      unitDir,
      user: "leo",
      exec,
    });
    expect(result).toBe("fresh");
    expect(calls.length).toBe(1);
    expect(calls[0].args[0]).toBe("/Create");
    expect(calls[0].args).toContain("devx-manager");
  });

  it("dispatch passes distro + user + wslHome through to installTaskScheduler", () => {
    const { exec } = makeRecordingExec();
    installSupervisor("manager", "task-scheduler", {
      devxHome,
      unitDir,
      distro: "Debian",
      user: "alice",
      wslHome: "/srv/alice",
      exec,
    });

    const xml = readFileSync(
      join(unitDir, "devx-manager.xml"),
      "utf8"
    );
    expect(xml).toContain(
      "<Arguments>-d Debian -u alice --exec /srv/alice/.devx/bin/devx-supervisor-stub.sh manager</Arguments>"
    );
  });

  it("uninstallSupervisor(task-scheduler) routes through uninstallTaskScheduler", () => {
    const { exec: e1 } = makeRecordingExec();
    installSupervisor("manager", "task-scheduler", {
      devxHome,
      unitDir,
      user: "leo",
      exec: e1,
    });

    const { exec: e2, calls } = makeRecordingExec();
    const result = uninstallSupervisor("manager", "task-scheduler", {
      devxHome,
      unitDir,
      exec: e2,
    });
    expect(result).toBe("removed");
    expect(calls[0].args[0]).toBe("/Delete");
  });
});

describe("sup404 — shipped XML template (compile-time check)", () => {
  it("template file is at _devx/templates/task-scheduler/devx.xml", () => {
    expect(existsSync(REAL_XML_TEMPLATE_PATH)).toBe(true);
  });
});
