// Postinstall tests (cli304).
//
// Postinstall is pure-JS (`scripts/postinstall.js`), runs after `npm i -g`,
// and is contract-bound to:
//   1. NEVER throw — always exit 0 (warn-only).
//   2. Skip when not a global install (npm_config_global !== "true").
//   3. On global install with `devx` missing from PATH: print platform-
//      specific PATH-fix advice to stderr.
//   4. On global install with `devx` on PATH: print nothing.
//
// Implementation: subprocess `node scripts/postinstall.js` with controlled
// env. Cross-platform: the script itself supports darwin/linux/wsl/win32,
// but these tests run only on POSIX (`describe.skipIf(isWindows)`) — Windows
// CI verification is a follow-up under cli305 (cross-platform install).
//
// Spec: dev/dev-cli304-2026-04-26T19:35-cli-version-postinstall.md

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postinstallEntry = resolve(repoRoot, "scripts", "postinstall.js");
const isWindows = process.platform === "win32";

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runPostinstall(env: NodeJS.ProcessEnv): RunResult {
  // Use process.execPath (absolute path to node) — tests override PATH to
  // simulate "devx not on PATH", and a bare "node" wouldn't resolve.
  const result = spawnSync(process.execPath, [postinstallEntry], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("cli304 — scripts/postinstall.js exists and is invokable", () => {
  it("file is present at scripts/postinstall.js", () => {
    expect(existsSync(postinstallEntry)).toBe(true);
  });
});

describe.skipIf(isWindows)("cli304 — postinstall behavior (POSIX)", () => {
  let tmpPathDir: string;

  beforeEach(() => {
    // Empty PATH dir → guarantees `devx` is NOT resolvable. We override sh's
    // PATH with this so `command -v devx` returns non-zero. We also need
    // `sh` itself reachable; spawnSync invokes `node`, then the script
    // spawns `sh` with whatever PATH we hand it. Including /bin keeps
    // `sh` and `command` resolvable on macOS + Linux.
    tmpPathDir = mkdtempSync(join(tmpdir(), "devx-cli304-path-"));
  });

  afterEach(() => {
    if (tmpPathDir) rmSync(tmpPathDir, { recursive: true, force: true });
  });

  it("local install (npm_config_global unset) → exits 0, no output", () => {
    const env = {
      ...process.env,
      npm_config_global: "",
    };
    const res = runPostinstall(env);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe("");
  });

  it('local install (npm_config_global="false") → exits 0, no output', () => {
    const env = {
      ...process.env,
      npm_config_global: "false",
    };
    const res = runPostinstall(env);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe("");
  });

  it("global install + devx NOT on PATH → exits 0 + prints advice", () => {
    const env = {
      ...process.env,
      npm_config_global: "true",
      // /bin alone keeps `sh` reachable for the `command -v devx` probe but
      // excludes any user-level dirs that might contain a real `devx`.
      PATH: `${tmpPathDir}:/bin`,
    };
    const res = runPostinstall(env);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("[devx] `devx` is not on PATH.");
    // Spot-check that the advice references a platform-specific anchor.
    // darwin → ~/.zshrc; linux → ~/.bashrc; wsl → "Windows host".
    expect(res.stderr).toMatch(/zshrc|bashrc|Windows host/);
  });

  it("global install + devx ON PATH → exits 0 + no output", () => {
    // Place a fake `devx` executable in our tmp PATH dir.
    const fakeDevx = join(tmpPathDir, "devx");
    writeFileSync(fakeDevx, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeDevx, 0o755);

    const env = {
      ...process.env,
      npm_config_global: "true",
      PATH: `${tmpPathDir}:/bin`,
    };
    const res = runPostinstall(env);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe("");
  });

  it("never throws — even with a hostile env, exits 0", () => {
    // Strip PATH entirely. The script's spawnSync may fail to even locate
    // `sh`, but the try/catch around main() must swallow it and exit 0.
    const env = {
      // Keep just what node itself needs. Drop PATH on purpose.
      HOME: process.env.HOME ?? "",
      npm_config_global: "true",
    };
    const res = runPostinstall(env);
    expect(res.status).toBe(0);
  });
});
