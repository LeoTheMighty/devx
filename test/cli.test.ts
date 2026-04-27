// Smoke tests for the cli301 scaffold.
//
// Two probes:
//   1. In-process: buildProgram() returns a commander Command and `--help`
//      writes non-empty output and exits 0 (commander's exitOverride lets us
//      capture the would-be exit instead of killing the test process).
//   2. Subprocess: `node dist/cli.js --help` (the AC's exact wording) exits 0
//      with non-empty stdout. Skipped if dist hasn't been built — Phase 5
//      runs `npm run build` before this test in CI.
//
// Spec: dev/dev-cli301-2026-04-26T19:35-cli-package-scaffold.md

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = resolve(repoRoot, "dist", "cli.js");

describe("cli301 — buildProgram (in-process)", () => {
  it("returns a commander Command named 'devx'", () => {
    const program = buildProgram();
    expect(program.name()).toBe("devx");
  });

  it("--help prints non-empty output and triggers exitOverride", async () => {
    const program = buildProgram();
    program.exitOverride();

    let stdout = "";
    let stderr = "";
    program.configureOutput({
      writeOut: (s) => {
        stdout += s;
      },
      writeErr: (s) => {
        stderr += s;
      },
    });

    let helpDisplayed = false;
    try {
      await program.parseAsync(["node", "devx", "--help"]);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "commander.helpDisplayed" || code === "commander.help") {
        helpDisplayed = true;
      } else {
        throw err;
      }
    }
    expect(helpDisplayed).toBe(true);
    expect(stdout.length + stderr.length).toBeGreaterThan(0);
    expect(`${stdout}${stderr}`).toContain("devx");
  });

  it("--version prints the package.json version", async () => {
    const program = buildProgram();
    program.exitOverride();

    let stdout = "";
    program.configureOutput({
      writeOut: (s) => {
        stdout += s;
      },
      writeErr: () => {},
    });

    try {
      await program.parseAsync(["node", "devx", "--version"]);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "commander.version") throw err;
    }
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("cli301 — node dist/cli.js --help (subprocess)", () => {
  it.skipIf(!existsSync(distEntry))(
    "exits 0 with non-empty stdout",
    () => {
      const stdout = execFileSync("node", [distEntry, "--help"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(stdout.length).toBeGreaterThan(0);
      expect(stdout).toContain("devx");
    },
  );
});

describe("cli301 — symlinked bin entry (regression for argv[1]/import.meta.url mismatch)", () => {
  // npm i -g symlinks the bin into the user's PATH dir. Node sets argv[1] to
  // the symlink path while import.meta.url resolves to the real file — naive
  // equality of the two would skip the main-entry guard and silently exit
  // with no output. realpathSync on both sides closes the gap; this test
  // asserts the gap stays closed.
  let tmpDir: string | null = null;
  let symlink: string | null = null;

  beforeAll(() => {
    if (!existsSync(distEntry)) return;
    tmpDir = mkdtempSync(join(tmpdir(), "devx-cli301-"));
    symlink = join(tmpDir, "devx");
    symlinkSync(distEntry, symlink);
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(!existsSync(distEntry))(
    "running via symlink still produces --help output",
    () => {
      if (!symlink) throw new Error("symlink not set up");
      const stdout = execFileSync("node", [symlink, "--help"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(stdout.length).toBeGreaterThan(0);
      expect(stdout).toContain("devx");
    },
  );
});
