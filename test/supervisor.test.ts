// Supervisor installer tests (sup401).
//
// Covers the three idempotency paths from the spec ACs:
//   - fresh install (no prior state)
//   - re-install with same template hash → "kept"
//   - re-install with different template hash → "rewritten" + state bump
// Plus the uninstall path used by Phase 10's eject.
//
// Tests use a tmp `devxHome` instead of `~/.devx/` so they're hermetic — no
// touching the real user environment.
//
// Spec: dev/dev-sup401-2026-04-26T19:35-supervisor-stub-script.md

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installStub, uninstallStub } from "../src/lib/supervisor.js";

const isWindows = process.platform === "win32";

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeTemplateDir(contents: string): string {
  const dir = mkTmp("devx-sup401-tpl-");
  writeFileSync(join(dir, "supervisor-stub.sh"), contents);
  return dir;
}

const STUB_BODY_V1 = [
  "#!/usr/bin/env bash",
  'role="${1:-manager}"',
  'echo "[devx-${role}] not yet wired ($(date -Iseconds))"',
  "exec sleep infinity",
  "",
].join("\n");

const STUB_BODY_V2 = STUB_BODY_V1.replace("not yet wired", "still not yet wired");

describe("sup401 — installStub", () => {
  let devxHome: string;
  let templateDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup401-home-");
    templateDir = makeTemplateDir(STUB_BODY_V1);
  });

  afterEach(() => {
    rmSync(devxHome, { recursive: true, force: true });
    rmSync(templateDir, { recursive: true, force: true });
  });

  it("fresh install copies the stub, sets +x, writes the state file", () => {
    const result = installStub({ devxHome, templateDir });
    expect(result).toBe("fresh");

    const stubPath = join(devxHome, "bin", "devx-supervisor-stub.sh");
    expect(existsSync(stubPath)).toBe(true);
    expect(readFileSync(stubPath, "utf8")).toBe(STUB_BODY_V1);

    if (!isWindows) {
      const mode = statSync(stubPath).mode & 0o777;
      // Owner must have execute bit; we set 0o755 so all rx bits should be set.
      expect(mode & 0o100).toBe(0o100); // user-execute
      expect(mode & 0o010).toBe(0o010); // group-execute
      expect(mode & 0o001).toBe(0o001); // other-execute
    }

    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(state.stub).toBeDefined();
    expect(state.stub.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof state.stub.version).toBe("string");
    expect(typeof state.stub.installed_at).toBe("string");
  });

  it("re-install with same template hash → no-op (kept), state unchanged", () => {
    installStub({ devxHome, templateDir });

    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    const stateBefore = readFileSync(stateFile, "utf8");

    const result = installStub({ devxHome, templateDir });
    expect(result).toBe("kept");

    const stateAfter = readFileSync(stateFile, "utf8");
    expect(stateAfter).toBe(stateBefore); // installed_at not bumped on no-op
  });

  it("re-install with different template hash → rewritten + state bumped", async () => {
    const first = installStub({ devxHome, templateDir });
    expect(first).toBe("fresh");

    const stubPath = join(devxHome, "bin", "devx-supervisor-stub.sh");
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    const stateBefore = JSON.parse(readFileSync(stateFile, "utf8"));

    // Sleep 5ms to guarantee installed_at differs at ms precision.
    await new Promise((r) => setTimeout(r, 5));

    // Mutate the template — simulates a published-package upgrade.
    writeFileSync(join(templateDir, "supervisor-stub.sh"), STUB_BODY_V2);

    const result = installStub({ devxHome, templateDir });
    expect(result).toBe("rewritten");

    expect(readFileSync(stubPath, "utf8")).toBe(STUB_BODY_V2);

    const stateAfter = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(stateAfter.stub.hash).not.toBe(stateBefore.stub.hash);
    expect(stateAfter.stub.installed_at).not.toBe(stateBefore.stub.installed_at);
  });

  it("re-install when target binary was deleted (state preserved) → rewritten", () => {
    installStub({ devxHome, templateDir });

    // User accidentally rm'd ~/.devx/bin/devx-supervisor-stub.sh
    const stubPath = join(devxHome, "bin", "devx-supervisor-stub.sh");
    rmSync(stubPath);

    const result = installStub({ devxHome, templateDir });
    expect(result).toBe("rewritten");
    expect(existsSync(stubPath)).toBe(true);
  });

  it("corrupt state file → treats as fresh install (recovers gracefully)", () => {
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    mkdirSync(join(devxHome, "state"), { recursive: true });
    writeFileSync(stateFile, "{ this is not valid JSON ");

    const result = installStub({ devxHome, templateDir });
    expect(result).toBe("fresh");

    // State file should now be valid JSON with a stub record.
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(state.stub).toBeDefined();
  });

  it("stub write is atomic — no .tmp.* lingers after success", () => {
    installStub({ devxHome, templateDir });

    // Any file matching *.tmp.* in bin/ would indicate a leak from the
    // tmp-write + rename path.
    const binDir = join(devxHome, "bin");
    const stateDir = join(devxHome, "state");
    const tmpInBin = readdirSync(binDir).filter((p) => p.includes(".tmp."));
    const tmpInState = readdirSync(stateDir).filter((p) => p.includes(".tmp."));
    expect(tmpInBin).toEqual([]);
    expect(tmpInState).toEqual([]);
  });

  it("preserves other unrelated state-file keys across re-install", () => {
    // Simulate sup402+ having written its own keys to the state file.
    mkdirSync(join(devxHome, "state"), { recursive: true });
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    writeFileSync(
      stateFile,
      JSON.stringify({ manager: { hash: "deadbeef", platform: "darwin" } })
    );

    installStub({ devxHome, templateDir });

    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(state.stub).toBeDefined();
    expect(state.manager).toEqual({ hash: "deadbeef", platform: "darwin" });
  });
});

describe("sup401 — uninstallStub", () => {
  let devxHome: string;
  let templateDir: string;

  beforeEach(() => {
    devxHome = mkTmp("devx-sup401-home-");
    templateDir = makeTemplateDir(STUB_BODY_V1);
  });

  afterEach(() => {
    rmSync(devxHome, { recursive: true, force: true });
    rmSync(templateDir, { recursive: true, force: true });
  });

  it("after install → uninstall removes binary + state record, returns 'removed'", () => {
    installStub({ devxHome, templateDir });

    const result = uninstallStub({ devxHome });
    expect(result).toBe("removed");

    const stubPath = join(devxHome, "bin", "devx-supervisor-stub.sh");
    expect(existsSync(stubPath)).toBe(false);

    // State file is fully removed when the stub was its only key.
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    expect(existsSync(stateFile)).toBe(false);
  });

  it("with no install ever → returns 'absent', no errors", () => {
    const result = uninstallStub({ devxHome });
    expect(result).toBe("absent");
  });

  it("preserves unrelated state-file keys (only drops `stub`)", () => {
    installStub({ devxHome, templateDir });

    // Simulate sup402+ having added its own key alongside `stub`.
    const stateFile = join(devxHome, "state", "supervisor.installed.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    state.manager = { hash: "deadbeef" };
    writeFileSync(stateFile, JSON.stringify(state));

    const result = uninstallStub({ devxHome });
    expect(result).toBe("removed");

    // State file remains because `manager` is still there; only `stub` is gone.
    expect(existsSync(stateFile)).toBe(true);
    const after = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(after.stub).toBeUndefined();
    expect(after.manager).toEqual({ hash: "deadbeef" });
  });
});
