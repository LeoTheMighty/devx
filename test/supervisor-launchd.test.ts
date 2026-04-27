// Launchd supervisor tests (sup402).
//
// Drives installLaunchd / uninstallLaunchd / renderLaunchdPlist with synthetic
// homeDir / unitDir / exec inputs so the suite runs identically on macOS,
// Ubuntu, and any developer's box without bootstrapping real launchd units.
//
// Spec: dev/dev-sup402-2026-04-26T19:35-supervisor-launchd.md

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
  installLaunchd,
  renderLaunchdPlist,
  uninstallLaunchd,
  type ExecResult,
  type LaunchctlExec,
} from "../src/lib/supervisor-launchd.js";
import {
  installSupervisor,
  uninstallSupervisor,
} from "../src/lib/supervisor.js";

const here = dirname(fileURLToPath(import.meta.url));

interface ExecCall {
  args: string[];
}

function makeRecordingExec(impl?: (args: string[]) => ExecResult): {
  exec: LaunchctlExec;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  const exec: LaunchctlExec = (args) => {
    calls.push({ args });
    return impl ? impl(args) : { status: 0 };
  };
  return { exec, calls };
}

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const REAL_TEMPLATE_DIR = resolve(here, "..", "_devx", "templates");
const REAL_PLIST_TEMPLATE_PATH = join(
  REAL_TEMPLATE_DIR,
  "launchd",
  "dev.devx.plist"
);

describe("sup402 — renderLaunchdPlist", () => {
  it("substitutes ${HOME} and __ROLE__ in the real shipped template", () => {
    const out = renderLaunchdPlist("manager", { homeDir: "/Users/leo" });

    // No remaining placeholders post-substitution.
    expect(out).not.toContain("__ROLE__");
    expect(out).not.toContain("${HOME}");

    // Required plist keys + values.
    expect(out).toContain("<string>dev.devx.manager</string>");
    expect(out).toContain(
      "<string>/Users/leo/.devx/bin/devx-supervisor-stub.sh</string>"
    );
    expect(out).toContain("<string>manager</string>");
    expect(out).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(out).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(out).toContain("<key>ProcessType</key>");
    expect(out).toContain("<string>Interactive</string>");
    expect(out).toContain("<key>ThrottleInterval</key>");
    expect(out).toContain("<integer>10</integer>");
    expect(out).toContain(
      "<string>/Users/leo/Library/Logs/devx/manager.out.log</string>"
    );
    expect(out).toContain(
      "<string>/Users/leo/Library/Logs/devx/manager.err.log</string>"
    );
  });

  it("differs between manager and concierge in the role-bearing fields only", () => {
    const m = renderLaunchdPlist("manager", { homeDir: "/Users/leo" });
    const c = renderLaunchdPlist("concierge", { homeDir: "/Users/leo" });
    expect(m).not.toBe(c);
    expect(c).toContain("<string>dev.devx.concierge</string>");
    expect(c).toContain(
      "<string>/Users/leo/Library/Logs/devx/concierge.out.log</string>"
    );
  });
});

describe("sup402 — installLaunchd", () => {
  let devxHome: string;
  let unitDir: string;
  let logDir: string;
  let homeDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup402-home-");
    homeDir = mkTmp("devx-sup402-userhome-");
    unitDir = mkTmp("devx-sup402-launchagents-");
    logDir = mkTmp("devx-sup402-logs-");
  });

  afterEach(() => {
    for (const d of [devxHome, homeDir, unitDir, logDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("fresh install: writes plist, creates log dir, calls bootstrap once, updates state", () => {
    const { exec, calls } = makeRecordingExec();
    const result = installLaunchd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      logDir,
      exec,
      uid: 501,
    });

    expect(result).toBe("fresh");

    // Plist is on disk with substituted content.
    const plistPath = join(unitDir, "dev.devx.manager.plist");
    expect(existsSync(plistPath)).toBe(true);
    const plist = readFileSync(plistPath, "utf8");
    expect(plist).toContain("<string>dev.devx.manager</string>");
    expect(plist).toContain(`${homeDir}/.devx/bin/devx-supervisor-stub.sh`);

    // Log dir was created so launchd's StandardOutPath has a parent.
    expect(existsSync(logDir)).toBe(true);

    // Only one launchctl call: bootstrap (no prior install → no bootout).
    expect(calls.length).toBe(1);
    expect(calls[0].args).toEqual(["bootstrap", "gui/501", plistPath]);

    // State file has the per-role record.
    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager).toBeDefined();
    expect(state.manager.platform).toBe("launchd");
    expect(state.manager.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof state.manager.installed_at).toBe("string");
  });

  it("re-install with no plist drift → 'kept' and zero exec calls", () => {
    const { exec: e1 } = makeRecordingExec();
    installLaunchd({ role: "manager", devxHome, homeDir, unitDir, logDir, exec: e1, uid: 501 });

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installLaunchd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      logDir,
      exec: e2,
      uid: 501,
    });

    expect(result).toBe("kept");
    expect(calls2).toEqual([]);
  });

  it("re-install with plist drift → 'rewritten', calls bootout then bootstrap", () => {
    const { exec: e1 } = makeRecordingExec();
    installLaunchd({ role: "manager", devxHome, homeDir, unitDir, logDir, exec: e1, uid: 501 });

    // Tamper with the state-file's recorded hash so the next install detects
    // a "rewrite". (Equivalent to the template upgrading in a published
    // package — bumping the rendered plist content.)
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    state.manager.hash = "0".repeat(64); // bogus hash
    writeFileSync(stateFile, JSON.stringify(state));

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installLaunchd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      logDir,
      exec: e2,
      uid: 501,
    });
    expect(result).toBe("rewritten");

    expect(calls2.length).toBe(2);
    expect(calls2[0].args[0]).toBe("bootout");
    expect(calls2[1].args[0]).toBe("bootstrap");
  });

  it("re-install when plist file was deleted (state preserved) → 'rewritten'", () => {
    const { exec: e1 } = makeRecordingExec();
    installLaunchd({ role: "manager", devxHome, homeDir, unitDir, logDir, exec: e1, uid: 501 });

    rmSync(join(unitDir, "dev.devx.manager.plist"));

    const { exec: e2, calls: calls2 } = makeRecordingExec();
    const result = installLaunchd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      logDir,
      exec: e2,
      uid: 501,
    });
    // No hash drift (template unchanged) but the plist file is missing → still
    // a rewrite (re-bootstrap from scratch).
    expect(result).toBe("rewritten");
    expect(calls2.length).toBe(2);
  });

  it("bootstrap failure → throws + state file is NOT updated", () => {
    const { exec } = makeRecordingExec((args) => {
      if (args[0] === "bootstrap") {
        return { status: 1, stderr: "Bootstrap failed: 5: Input/output error\n" };
      }
      return { status: 0 };
    });

    expect(() =>
      installLaunchd({
        role: "manager",
        devxHome,
        homeDir,
        unitDir,
        logDir,
        exec,
        uid: 501,
      })
    ).toThrow(/bootstrap.*failed/i);

    // State file should be missing OR empty — bootstrap failure must not
    // leave the state file claiming the unit is installed.
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.manager).toBeUndefined();
    }
  });

  it("plist write is atomic — no .tmp.* leftovers", () => {
    const { exec } = makeRecordingExec();
    installLaunchd({
      role: "manager",
      devxHome,
      homeDir,
      unitDir,
      logDir,
      exec,
      uid: 501,
    });
    const tmpInUnitDir = readdirSync(unitDir).filter((p) => p.includes(".tmp."));
    expect(tmpInUnitDir).toEqual([]);
  });

  it("manager and concierge can coexist in the same state file", () => {
    const { exec } = makeRecordingExec();
    installLaunchd({ role: "manager", devxHome, homeDir, unitDir, logDir, exec, uid: 501 });
    installLaunchd({ role: "concierge", devxHome, homeDir, unitDir, logDir, exec, uid: 501 });

    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager.platform).toBe("launchd");
    expect(state.concierge.platform).toBe("launchd");
    expect(state.manager.hash).not.toBe(state.concierge.hash); // role differs in plist
  });
});

describe("sup402 — uninstallLaunchd", () => {
  let devxHome: string;
  let unitDir: string;
  let logDir: string;
  let homeDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup402-home-");
    homeDir = mkTmp("devx-sup402-userhome-");
    unitDir = mkTmp("devx-sup402-launchagents-");
    logDir = mkTmp("devx-sup402-logs-");
  });

  afterEach(() => {
    for (const d of [devxHome, homeDir, unitDir, logDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("after install → uninstall calls bootout, removes plist, drops state record", () => {
    const { exec: e1 } = makeRecordingExec();
    installLaunchd({ role: "manager", devxHome, homeDir, unitDir, logDir, exec: e1, uid: 501 });

    const { exec: e2, calls } = makeRecordingExec();
    const result = uninstallLaunchd({
      role: "manager",
      devxHome,
      unitDir,
      exec: e2,
      uid: 501,
    });

    expect(result).toBe("removed");
    expect(existsSync(join(unitDir, "dev.devx.manager.plist"))).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0].args[0]).toBe("bootout");

    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(state.manager).toBeUndefined();
    }
  });

  it("with no install ever → returns 'absent', no exec calls", () => {
    const { exec, calls } = makeRecordingExec();
    const result = uninstallLaunchd({
      role: "manager",
      devxHome,
      unitDir,
      exec,
      uid: 501,
    });
    expect(result).toBe("absent");
    expect(calls).toEqual([]);
  });

  it("preserves other role records when uninstalling one", () => {
    const { exec: e1 } = makeRecordingExec();
    installLaunchd({ role: "manager", devxHome, homeDir, unitDir, logDir, exec: e1, uid: 501 });
    installLaunchd({ role: "concierge", devxHome, homeDir, unitDir, logDir, exec: e1, uid: 501 });

    const { exec: e2 } = makeRecordingExec();
    uninstallLaunchd({ role: "manager", devxHome, unitDir, exec: e2, uid: 501 });

    const state = JSON.parse(
      readFileSync(join(devxHome, "state", "supervisor.installed.json"), "utf8")
    );
    expect(state.manager).toBeUndefined();
    expect(state.concierge).toBeDefined();
  });
});

describe("sup402 — installSupervisor / uninstallSupervisor dispatch", () => {
  let devxHome: string;
  let unitDir: string;
  let homeDir: string;
  let logDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup402-disp-");
    homeDir = mkTmp("devx-sup402-disp-home-");
    unitDir = mkTmp("devx-sup402-disp-la-");
    logDir = mkTmp("devx-sup402-disp-logs-");
  });

  afterEach(() => {
    for (const d of [devxHome, homeDir, unitDir, logDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("platform=launchd routes through installLaunchd", () => {
    const { exec, calls } = makeRecordingExec();
    const result = installSupervisor("manager", "launchd", {
      devxHome,
      homeDir,
      unitDir,
      logDir,
      exec,
      uid: 501,
    });
    expect(result).toBe("fresh");
    expect(calls[0].args[0]).toBe("bootstrap");
  });

  it("uninstallSupervisor(launchd) routes through uninstallLaunchd", () => {
    const { exec: e1 } = makeRecordingExec();
    installSupervisor("manager", "launchd", {
      devxHome,
      homeDir,
      unitDir,
      logDir,
      exec: e1,
      uid: 501,
    });

    const { exec: e2 } = makeRecordingExec();
    const result = uninstallSupervisor("manager", "launchd", {
      devxHome,
      unitDir,
      exec: e2,
      uid: 501,
    });
    expect(result).toBe("removed");
  });
});

describe("sup402 — shipped plist template (compile-time check)", () => {
  it("template file is at _devx/templates/launchd/dev.devx.plist", () => {
    expect(existsSync(REAL_PLIST_TEMPLATE_PATH)).toBe(true);
  });
});
