// Canonical repo root resolution (mlc101 — src/lib/repo-root.ts).
// Fixture: a real tmpdir git repo + linked worktree, per the E-2 eval's
// permanent-suite pointer.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RepoRootError,
  interpretRevParse,
  resolveRepoRoot,
} from "../src/lib/repo-root.js";
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
let plainDir: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "repo-root-"));
  rootReal = realpathSync(root);
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "README.md"), "fixture\n");
  // The cacheDir-ensuring side effect is gated on the root being a devx
  // project — make the fixture one.
  writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n");
  mkdirSync(join(root, "dev"), { recursive: true });
  writeFileSync(join(root, "dev", ".keep"), "");
  git(root, "add", "-A");
  git(root, "commit", "-m", "init", "--no-gpg-sign");
  worktreeDir = join(root, ".worktrees", "dev-wt0001");
  mkdirSync(join(root, ".worktrees"), { recursive: true });
  git(root, "worktree", "add", worktreeDir, "-b", "feat/dev-wt0001", "main");
  plainDir = mkdtempSync(join(tmpdir(), "repo-root-plain-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(plainDir, { recursive: true, force: true });
});

describe("resolveRepoRoot", () => {
  it("resolves the main checkout from its own root", () => {
    const info = resolveRepoRoot(root);
    expect(info.root).toBe(rootReal);
    expect(info.cacheDir).toBe(join(rootReal, ".devx-cache"));
    expect(info.isLinkedWorktree).toBe(false);
  });

  it("resolves the same root from a subdirectory of the main checkout", () => {
    const info = resolveRepoRoot(join(root, "dev"));
    expect(info.root).toBe(rootReal);
    expect(info.cacheDir).toBe(join(rootReal, ".devx-cache"));
    expect(info.isLinkedWorktree).toBe(false);
  });

  it("reports isLinkedWorktree with the MAIN root from inside a linked worktree", () => {
    const info = resolveRepoRoot(worktreeDir);
    expect(info.isLinkedWorktree).toBe(true);
    expect(info.root).toBe(rootReal);
    expect(info.cacheDir).toBe(join(rootReal, ".devx-cache"));
  });

  it("reports isLinkedWorktree from a subdirectory of a linked worktree", () => {
    const sub = join(worktreeDir, "dev");
    const info = resolveRepoRoot(sub);
    expect(info.isLinkedWorktree).toBe(true);
    expect(info.root).toBe(rootReal);
  });

  it("ensures cacheDir exists as a post-condition (devx project at root)", () => {
    rmSync(join(root, ".devx-cache"), { recursive: true, force: true });
    const info = resolveRepoRoot(root);
    expect(existsSync(info.cacheDir)).toBe(true);
  });

  it("throws RepoRootError outside a git work tree", () => {
    expect(() => resolveRepoRoot(plainDir)).toThrow(RepoRootError);
  });

  it("separate-git-dir main checkout resolves as its own root (real git)", () => {
    const wt = mkdtempSync(join(tmpdir(), "repo-root-sgd-"));
    const gd = mkdtempSync(join(tmpdir(), "repo-root-sgd-git-"));
    try {
      git(wt, "init", "-b", "main", "--separate-git-dir", join(gd, "repo.git"));
      const info = resolveRepoRoot(wt);
      expect(info.isLinkedWorktree).toBe(false);
      expect(info.root).toBe(realpathSync(wt));
    } finally {
      rmSync(wt, { recursive: true, force: true });
      rmSync(gd, { recursive: true, force: true });
    }
  });

  it("does NOT create .devx-cache in a non-devx git repo (side-effect gate)", () => {
    const plain = mkdtempSync(join(tmpdir(), "repo-root-nondevx-"));
    try {
      git(plain, "init", "-b", "main");
      const info = resolveRepoRoot(plain);
      expect(existsSync(info.cacheDir)).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("interpretRevParse (pure)", () => {
  it("main checkout: git dir == common dir, root = toplevel", () => {
    const info = interpretRevParse(".git", ".git", "/fake/repo", "/fake/repo");
    expect(info.root).toBe("/fake/repo");
    expect(info.cacheDir).toBe("/fake/repo/.devx-cache");
    expect(info.isLinkedWorktree).toBe(false);
  });

  it("linked worktree: git dir is <commonDir>/worktrees/<name>, root = common dir's parent", () => {
    const info = interpretRevParse(
      "/fake/repo/.git/worktrees/dev-abc123",
      "/fake/repo/.git",
      "/fake/repo/.worktrees/dev-abc123",
      "/fake/repo/.worktrees/dev-abc123",
    );
    expect(info.root).toBe("/fake/repo");
    expect(info.isLinkedWorktree).toBe(true);
  });

  it("submodule MAIN checkout is NOT a linked worktree (review HIGH — common dir under .git/modules)", () => {
    const info = interpretRevParse(
      "/super/.git/modules/sub",
      "/super/.git/modules/sub",
      "/super/sub",
      "/super/sub",
    );
    expect(info.isLinkedWorktree).toBe(false);
    expect(info.root).toBe("/super/sub");
    expect(info.cacheDir).toBe("/super/sub/.devx-cache");
  });

  it("separate-git-dir MAIN checkout is NOT a linked worktree, root = toplevel", () => {
    const info = interpretRevParse(
      "/srv/repo.git",
      "/srv/repo.git",
      "/work/tree",
      "/work/tree",
    );
    expect(info.isLinkedWorktree).toBe(false);
    expect(info.root).toBe("/work/tree");
  });

  it("resolves relative rev-parse output against cwd", () => {
    const info = interpretRevParse(
      "../../.git/worktrees/dev-x",
      "../../.git",
      "/fake/repo/.worktrees/dev-x",
      "/fake/repo/.worktrees/dev-x",
    );
    expect(info.root).toBe("/fake/repo");
    expect(info.isLinkedWorktree).toBe(true);
  });
});
