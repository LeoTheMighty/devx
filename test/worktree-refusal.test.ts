// Worktree-launch refusal (mlc101 AC 2 — src/commands/loop.ts +
// src/commands/manage.ts; extended by 7e2b56 for
// `devx plan-helper emit-retro-story`). Entry points started with cwd inside
// a linked worktree must refuse with exit != 0 and an error naming the main
// checkout; `--allow-worktree-root` overrides where it exists. E-2's
// permanent suite for the command-entry half.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { runLoopCommand } from "../src/commands/loop.js";
import { runManageCommand } from "../src/commands/manage.js";
import { runEmitRetroStory } from "../src/commands/plan-helper.js";
import type { runLoop } from "../src/lib/loop/driver.js";
import { GIT } from "./helpers/git-bin.js";

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): void {
  execFileSync(GIT, args, { cwd, env: GIT_ENV, stdio: "ignore" });
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

// ---------------------------------------------------------------------------
// emit-retro-story worktree refusal (7e2b56)
//
// `runEmitRetroStory` resolved its repoRoot from `findProjectConfig()`, which
// walks up from cwd — so a run inside `.worktrees/<type>-<hash>/` found the
// WORKTREE's devx.config.yaml and forked the spec + DEV.md + GRAPH.md onto a
// feature branch. Posture is claim's (refuse), not graph's (retarget); see
// the header of src/commands/plan-helper.ts for why.
// ---------------------------------------------------------------------------

const EMIT_CONFIG = [
  "mode: YOLO",
  "project:",
  "  shape: empty-dream",
  "thoroughness: send-it",
  "git:",
  "  default_branch: main",
  "  integration_branch: null",
  "  branch_prefix: feat/",
  "",
].join("\n");

const EMIT_DEV_MD = `# DEV — Features to build

## Phase 1 — Single-agent core loop

### Epic 1 — Mode-derived merge gate
- [x] \`dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md\` — Pure fn. Status: done.
- [x] \`dev/dev-mrg102-2026-04-28T19:30-merge-gate-cli.md\` — CLI. Status: done.
`;

const EMIT_ARGS = [
  "--epic-slug",
  "merge-gate-modes",
  "--parents",
  "mrg101,mrg102",
  "--plan",
  "plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md",
];

describe("devx plan-helper emit-retro-story worktree refusal", () => {
  let emitRoot: string;
  let emitRootReal: string;
  let emitWorktree: string;

  beforeAll(() => {
    emitRoot = mkdtempSync(join(tmpdir(), "wt-emit-retro-"));
    emitRootReal = realpathSync(emitRoot);
    git(emitRoot, "init", "-b", "main");
    writeFileSync(join(emitRoot, "devx.config.yaml"), EMIT_CONFIG);
    writeFileSync(join(emitRoot, "DEV.md"), EMIT_DEV_MD);
    git(emitRoot, "add", "-A");
    git(emitRoot, "commit", "-m", "init", "--no-gpg-sign");
    emitWorktree = join(emitRoot, ".worktrees", "dev-em0001");
    mkdirSync(join(emitRoot, ".worktrees"), { recursive: true });
    git(emitRoot, "worktree", "add", emitWorktree, "-b", "feat/dev-em0001", "main");
  });

  afterAll(() => {
    rmSync(emitRoot, { recursive: true, force: true });
  });

  function capture(): { io: { stdout: string; stderr: string }; out: (s: string) => void; err: (s: string) => void } {
    const io = { stdout: "", stderr: "" };
    return {
      io,
      out: (s: string) => {
        io.stdout += s;
      },
      err: (s: string) => {
        io.stderr += s;
      },
    };
  }

  it("refuses a cwd inside a linked worktree, naming the main checkout, writing nothing", () => {
    process.chdir(emitWorktree);
    // Snapshot rather than compare against the fixture constant: the
    // main-checkout leg below legitimately mutates these, and this
    // assertion must not depend on declaration order to stay honest.
    const mainDevBefore = readFileSync(join(emitRootReal, "DEV.md"), "utf8");
    const mainGraphBefore = existsSync(join(emitRootReal, "GRAPH.md"));
    const cap = capture();
    const code = runEmitRetroStory(EMIT_ARGS, { out: cap.out, err: cap.err });

    expect(code).toBe(1);
    expect(cap.io.stdout).toBe("");
    expect(cap.io.stderr).toMatch(/linked worktree/);
    expect(cap.io.stderr).toContain(emitRootReal);

    // Nothing forked onto the feature branch: no spec, no DEV.md splice, no
    // GRAPH.md — the three files the bug reported wrote into the worktree.
    expect(existsSync(join(emitWorktree, "dev"))).toBe(false);
    expect(existsSync(join(emitWorktree, "GRAPH.md"))).toBe(false);
    expect(readFileSync(join(emitWorktree, "DEV.md"), "utf8")).toBe(EMIT_DEV_MD);
    // …and nothing snuck into the main checkout either (refuse ≠ retarget).
    expect(existsSync(join(emitRootReal, "GRAPH.md"))).toBe(mainGraphBefore);
    expect(readFileSync(join(emitRootReal, "DEV.md"), "utf8")).toBe(mainDevBefore);
  });

  it("refuses an explicit worktree repoRoot seam too (claim's defense in depth)", () => {
    process.chdir(emitRootReal);
    const cap = capture();
    const code = runEmitRetroStory(EMIT_ARGS, {
      out: cap.out,
      err: cap.err,
      projectPath: join(emitWorktree, "devx.config.yaml"),
      repoRoot: emitWorktree,
    });

    expect(code).toBe(1);
    expect(cap.io.stderr).toMatch(/linked worktree/);
    expect(existsSync(join(emitWorktree, "dev"))).toBe(false);
  });

  it("emits normally from the main checkout (the non-worktree path is unchanged)", () => {
    process.chdir(emitRootReal);
    const cap = capture();
    const code = runEmitRetroStory(EMIT_ARGS, {
      out: cap.out,
      err: cap.err,
      now: () => new Date(2026, 4, 3, 14, 23, 0),
    });

    expect(cap.io.stderr).toBe("");
    expect(code).toBe(0);
    expect(cap.io.stdout).toMatch(
      /^spec=dev\/dev-mrgret-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}-retro-merge-gate-modes\.md dev_md=DEV\.md graph=GRAPH\.md\n$/,
    );
    const specRel = cap.io.stdout.split(" ")[0].replace("spec=", "");
    expect(existsSync(join(emitRootReal, specRel))).toBe(true);
    expect(readFileSync(join(emitRootReal, "DEV.md"), "utf8")).toContain("dev-mrgret-");
    // Landed on main, not on the feature branch.
    expect(existsSync(join(emitWorktree, specRel))).toBe(false);
  });
});
