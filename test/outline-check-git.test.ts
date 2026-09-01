// Outline protection L2/L3 against real git: `devx outline check` (the
// PR-diff scan CI + merge-gate consume) and `devx outline commit` (the
// human-side outline-only committer). Shells out to git → registered in
// SYNC_BLOCKING_TESTS (vitest.shared.ts).

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  contentSourceForRange,
  runOutlineCheck,
  runOutlineCommit,
} from "../src/commands/outline.js";
import { builtinSkeleton } from "../src/lib/engine/outline-scaffold.js";
import { captureIo } from "./fixtures/engine-repo.js";

const HUMAN_ENV = {} as Record<string, string | undefined>;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout;
}

interface Repo {
  root: string;
  configPath: string;
  write(rel: string, content: string): void;
}

const repos: string[] = [];
afterEach(() => {
  while (repos.length > 0) rmSync(repos.pop()!, { recursive: true, force: true });
});

/** A real git repo with devx.config.yaml committed on main, plus a bare
 *  "origin" remote so `origin/main...HEAD` ranges resolve. */
function makeGitRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), "devx-outline-git-"));
  repos.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  const configPath = join(root, "devx.config.yaml");
  writeFileSync(configPath, "mode: YOLO\n", "utf8");
  writeFileSync(join(root, "base.txt"), "base\n", "utf8");
  git(root, "add", "-A");
  git(root, "commit", "-m", "base");
  const originDir = mkdtempSync(join(tmpdir(), "devx-outline-origin-"));
  repos.push(originDir);
  git(originDir, "init", "--bare");
  git(root, "remote", "add", "origin", originDir);
  git(root, "push", "-u", "origin", "main");
  return {
    root,
    configPath,
    write(rel: string, content: string): void {
      const abs = join(root, ...rel.split("/"));
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    },
  };
}

describe("devx outline check", () => {
  it("exits 0 with clean:true when the branch touches no outline", () => {
    const repo = makeGitRepo();
    git(repo.root, "checkout", "-b", "feat/x");
    repo.write("src.txt", "code\n");
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "feat");
    const io = captureIo();
    const code = runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath });
    expect(code).toBe(0);
    expect(io.json()).toEqual({
      clean: true,
      touched: [],
      scaffolds: [],
      range: "origin/main...HEAD",
    });
  });

  it("exits 1 and names the outline paths when the branch carries one", () => {
    const repo = makeGitRepo();
    git(repo.root, "checkout", "-b", "feat/y");
    repo.write("_devx/workstreams/demo/prd/outline.md", "# smuggled\n");
    repo.write("OUTLINE.md", "# smuggled root\n");
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "smuggle outline");
    const io = captureIo();
    const code = runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath });
    expect(code).toBe(1);
    const j = io.json() as { clean: boolean; touched: string[] };
    expect(j.clean).toBe(false);
    expect(j.touched).toContain("_devx/workstreams/demo/prd/outline.md");
    expect(j.touched).toContain("OUTLINE.md");
  });

  it("ignores outline-critique.md riding in a PR (agent product)", () => {
    const repo = makeGitRepo();
    git(repo.root, "checkout", "-b", "feat/z");
    repo.write("_devx/workstreams/demo/prd/outline-critique.md", "# critique\n");
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "critique");
    const io = captureIo();
    expect(
      runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath }),
    ).toBe(0);
  });

  it("exits 2 (fail closed) when the range has no merge base", () => {
    const repo = makeGitRepo();
    const io = captureIo();
    const code = runOutlineCheck(
      { diff: "origin/nonexistent...HEAD" },
      { out: io.out, err: io.err, projectPath: repo.configPath },
    );
    expect(code).toBe(2);
    expect(io.stderr()).toContain("git diff failed");
  });
});

describe("devx outline check — hardened classification", () => {
  it("catches an outline under a non-ASCII workstream slug (quotePath)", () => {
    const repo = makeGitRepo();
    git(repo.root, "checkout", "-b", "feat/q");
    repo.write("_devx/workstreams/caf\u00e9/prd/outline.md", "# smuggled\n");
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "smuggle non-ascii");
    const io = captureIo();
    const code = runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath });
    expect(code).toBe(1);
    const j = io.json() as { touched: string[] };
    expect(j.touched).toContain("_devx/workstreams/caf\u00e9/prd/outline.md");
  });
});

describe("devx outline commit", () => {
  it("refuses inside an agent session before touching git", () => {
    const repo = makeGitRepo();
    repo.write("OUTLINE.md", "# by human\n");
    const io = captureIo();
    const code = runOutlineCommit({}, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: { CHIRP_SESSION_ID: "s1" },
    });
    expect(code).toBe(1);
    expect(io.stderr()).toContain("refusing to run inside an agent session");
    expect(git(repo.root, "status", "--porcelain")).toContain("OUTLINE.md");
  });

  it("commits ONLY outline paths, leaving other dirty files behind", () => {
    const repo = makeGitRepo();
    repo.write("OUTLINE.md", "# project outline\n");
    repo.write("_devx/workstreams/demo/design/outline.md", "# design outline\n");
    repo.write("unrelated.txt", "dirty\n");
    const io = captureIo();
    const code = runOutlineCommit({}, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: HUMAN_ENV,
    });
    expect(code).toBe(0);
    const j = io.json() as { committed: string[] };
    expect(j.committed.sort()).toEqual([
      "OUTLINE.md",
      "_devx/workstreams/demo/design/outline.md",
    ].sort());
    // Outline paths committed…
    const show = git(repo.root, "show", "--name-only", "--format=%s", "HEAD");
    expect(show).toContain("outline:");
    expect(show).toContain("OUTLINE.md");
    expect(show).toContain("_devx/workstreams/demo/design/outline.md");
    expect(show).not.toContain("unrelated.txt");
    // …and the unrelated file is still dirty.
    expect(git(repo.root, "status", "--porcelain")).toContain("unrelated.txt");
  });

  it("refuses on a feature branch — outlines land on the base branch only", () => {
    const repo = makeGitRepo();
    git(repo.root, "checkout", "-b", "feat/somewhere");
    repo.write("OUTLINE.md", "# typed here by mistake\n");
    const io = captureIo();
    const code = runOutlineCommit({}, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: HUMAN_ENV,
    });
    expect(code).toBe(1);
    expect(io.stderr()).toContain("refusing on branch 'feat/somewhere'");
    expect(git(repo.root, "status", "--porcelain")).toContain("OUTLINE.md");
  });

  it("commits BOTH sides of a staged outline rename", () => {
    const repo = makeGitRepo();
    repo.write("_devx/workstreams/demo/prd/outline.md", "# v1\n");
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "outline v1 (fixture setup)");
    mkdirSync(join(repo.root, "_devx", "workstreams", "demo", "design"), {
      recursive: true,
    });
    git(
      repo.root,
      "mv",
      "_devx/workstreams/demo/prd/outline.md",
      "_devx/workstreams/demo/design/outline.md",
    );
    const io = captureIo();
    const code = runOutlineCommit({}, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: HUMAN_ENV,
    });
    expect(code).toBe(0);
    // Old path gone from HEAD, new path present, tree clean.
    const files = git(repo.root, "ls-tree", "-r", "--name-only", "HEAD");
    expect(files).toContain("_devx/workstreams/demo/design/outline.md");
    expect(files).not.toContain("_devx/workstreams/demo/prd/outline.md");
    expect(git(repo.root, "status", "--porcelain").trim()).toBe("");
  });

  it("exits 1 when the working tree has no outline changes", () => {
    const repo = makeGitRepo();
    repo.write("unrelated.txt", "dirty\n");
    const io = captureIo();
    const code = runOutlineCommit({}, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: HUMAN_ENV,
    });
    expect(code).toBe(1);
    expect(io.stderr()).toContain("no outline changes");
  });
});

// ---------------------------------------------------------------------------
// The scaffold exemption — `devx outline init` output may ride a PR
// ---------------------------------------------------------------------------

describe("devx outline check — pristine scaffolds", () => {
  /** Scaffold an outline the way `devx outline init` does, then commit it on
   *  a feature branch — the exact shape an agent-bootstrapped outline takes
   *  when it reaches a PR. */
  function branchWithScaffold(
    repo: Repo,
    rel: string,
    kind: Parameters<typeof builtinSkeleton>[0],
    branch: string,
  ): void {
    git(repo.root, "checkout", "-b", branch);
    repo.write(rel, builtinSkeleton(kind));
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "scaffold outline");
  }

  it("lets an untouched scaffold through, and names it", () => {
    const repo = makeGitRepo();
    branchWithScaffold(
      repo,
      "_devx/workstreams/demo/prd/outline.md",
      { kind: "stage", stage: "prd" },
      "feat/scaffold",
    );
    const io = captureIo();
    const code = runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath });
    expect(code).toBe(0);
    const j = io.json() as { clean: boolean; touched: string[]; scaffolds: string[] };
    expect(j.clean).toBe(true);
    expect(j.touched).toEqual([]);
    expect(j.scaffolds).toEqual(["_devx/workstreams/demo/prd/outline.md"]);
  });

  it("blocks the moment a human types into it", () => {
    const repo = makeGitRepo();
    branchWithScaffold(
      repo,
      "_devx/workstreams/demo/prd/outline.md",
      { kind: "stage", stage: "prd" },
      "feat/typed",
    );
    repo.write(
      "_devx/workstreams/demo/prd/outline.md",
      `${builtinSkeleton({ kind: "stage", stage: "prd" })}* my own bullet\n`,
    );
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "human types a bullet");
    const io = captureIo();
    const code = runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath });
    expect(code).toBe(1);
    const j = io.json() as { touched: string[]; scaffolds: string[] };
    expect(j.touched).toEqual(["_devx/workstreams/demo/prd/outline.md"]);
    expect(j.scaffolds).toEqual([]);
  });

  it("exempts project-level root scaffolds too (layout-independent)", () => {
    const repo = makeGitRepo();
    branchWithScaffold(
      repo,
      "design-outline.md",
      { kind: "stage", stage: "design" },
      "feat/project-level",
    );
    const io = captureIo();
    expect(
      runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath }),
    ).toBe(0);
    expect((io.json() as { scaffolds: string[] }).scaffolds).toEqual(["design-outline.md"]);
  });

  it("blocks a DELETED outline — losing one is as bad as editing one", () => {
    const repo = makeGitRepo();
    repo.write("OUTLINE.md", "# typed by the human\n");
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "human outline on main");
    git(repo.root, "push", "origin", "main");
    git(repo.root, "checkout", "-b", "feat/delete");
    git(repo.root, "rm", "OUTLINE.md");
    git(repo.root, "commit", "-m", "drop the outline");
    const io = captureIo();
    const code = runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath });
    expect(code).toBe(1);
    expect((io.json() as { touched: string[] }).touched).toEqual(["OUTLINE.md"]);
  });

  it("blocks a protected path with no knowable scaffold (fail closed)", () => {
    const repo = makeGitRepo();
    git(repo.root, "checkout", "-b", "feat/unknown");
    // Under a workstreams segment but not in a stage folder: protected by
    // name, unclassifiable by origin.
    repo.write("_devx/workstreams/demo/outline.md", "whatever\n");
    git(repo.root, "add", "-A");
    git(repo.root, "commit", "-m", "odd outline");
    const io = captureIo();
    expect(
      runOutlineCheck({}, { out: io.out, err: io.err, projectPath: repo.configPath }),
    ).toBe(1);
  });
});

describe("contentSourceForRange", () => {
  it("takes the right-hand side of a range, defaulting to HEAD", () => {
    expect(contentSourceForRange("origin/main...HEAD")).toEqual({ at: "rev", rev: "HEAD" });
    expect(contentSourceForRange("origin/main...feat/x")).toEqual({ at: "rev", rev: "feat/x" });
    expect(contentSourceForRange("main..feat/y")).toEqual({ at: "rev", rev: "feat/y" });
    expect(contentSourceForRange("origin/main...")).toEqual({ at: "rev", rev: "HEAD" });
  });

  it("reads the WORKING TREE for git's two-arg form", () => {
    // `git diff --name-only HEAD~1` compares the working tree against HEAD~1;
    // the content under judgement is on disk, not at the named rev.
    expect(contentSourceForRange("HEAD~1")).toEqual({ at: "worktree" });
    expect(contentSourceForRange("main")).toEqual({ at: "worktree" });
  });
});
