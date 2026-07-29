// Worktree-launch refusal (mlc101 AC 2 — src/commands/loop.ts +
// src/commands/manage.ts). `devx loop` and `devx manage` started with cwd
// inside a linked worktree must refuse with exit != 0 and an error naming
// the main checkout; `--allow-worktree-root` overrides. E-2's permanent
// suite for the command-entry half.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { runLoopCommand } from "../src/commands/loop.js";
import { runManageCommand } from "../src/commands/manage.js";
import type { runLoop } from "../src/lib/loop/driver.js";

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "ignore" });
}

let root: string;
let rootReal: string;
let worktreeDir: string;
const origCwd = process.cwd();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "wt-refusal-"));
  rootReal = realpathSync(root);
  git(root, "init", "-b", "main");
  git(root, "commit", "--allow-empty", "-m", "init", "--no-gpg-sign");
  worktreeDir = join(root, ".worktrees", "dev-wt0001");
  mkdirSync(join(root, ".worktrees"), { recursive: true });
  git(root, "worktree", "add", worktreeDir, "-b", "feat/dev-wt0001", "main");
});

afterEach(() => {
  process.chdir(origCwd);
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("devx loop worktree refusal", () => {
  it("refuses from a linked worktree with exit 4, naming the main checkout, without starting the driver", async () => {
    process.chdir(worktreeDir);
    let driverCalled = false;
    const fake: typeof runLoop = async () => {
      driverCalled = true;
      return { exitCode: 0, summary: null, reportPath: null };
    };
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const code = await runLoopCommand({ dryRun: true }, { runLoop: fake });
    expect(code).toBe(4);
    expect(driverCalled).toBe(false);
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain(rootReal);
    expect(written).toMatch(/linked worktree/);
  });

  it("--allow-worktree-root overrides the refusal", async () => {
    process.chdir(worktreeDir);
    let received: string | undefined;
    const fake: typeof runLoop = async (opts) => {
      received = opts.repoRoot;
      return { exitCode: 0, summary: null, reportPath: null };
    };
    const code = await runLoopCommand(
      { dryRun: true, allowWorktreeRoot: true },
      { runLoop: fake },
    );
    expect(code).toBe(0);
    // Override keeps the legacy cwd-based resolution — the worktree is
    // deliberately its own universe (test fixtures rely on this).
    expect(received).toBeDefined();
    expect(received).not.toBe(rootReal);
  });

  it("runs the driver with the canonical root from the main checkout", async () => {
    process.chdir(root);
    let received: string | undefined;
    const fake: typeof runLoop = async (opts) => {
      received = opts.repoRoot;
      return { exitCode: 0, summary: null, reportPath: null };
    };
    const code = await runLoopCommand({ dryRun: true }, { runLoop: fake });
    expect(code).toBe(0);
    expect(received).toBe(rootReal);
  });
});

describe("devx manage worktree refusal", () => {
  it("refuses from a linked worktree with exit 1, naming the main checkout, without taking the lock", async () => {
    process.chdir(worktreeDir);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runManageCommand({ once: true });
    expect(code).toBe(1);
    const written = errSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain(rootReal);
    expect(written).toMatch(/linked worktree/);
    // Refusal fires before lock acquisition — no manager.lock anywhere.
    expect(
      existsSync(join(rootReal, ".devx-cache", "locks", "manager.lock")),
    ).toBe(false);
    expect(
      existsSync(join(worktreeDir, ".devx-cache", "locks", "manager.lock")),
    ).toBe(false);
  });
});
