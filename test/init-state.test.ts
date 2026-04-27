// init-state.ts tests (ini501).
//
// Strategy: hermetic tmp dirs as repo roots; injected GitExec stub that
// returns canned results per arg pattern; no real `git` invocation. Probes
// real filesystem reads for stack/personas/workflows since those are pure
// reads.
//
// Spec: dev/dev-ini501-2026-04-26T19:35-init-question-flow.md

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type GitExec,
  type GitResult,
  detectInitState,
} from "../src/lib/init-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(stdout = ""): GitResult {
  return { exitCode: 0, stdout, stderr: "" };
}
function fail(stderr = "fail"): GitResult {
  return { exitCode: 1, stdout: "", stderr };
}

interface GitStubBehavior {
  hasCommits?: boolean;
  uncommitted?: string;
  defaultBranch?: string | null; // via origin/HEAD; null = symref-fail
  defaultBranchConfig?: string; // via init.defaultBranch
  currentBranch?: string;
  remote?: string | null;
  developExists?: boolean;
  tags?: string;
  shortlog?: string;
}

function makeGitStub(b: GitStubBehavior = {}): GitExec {
  return (args) => {
    const [cmd, ...rest] = args;
    if (cmd === "rev-parse" && rest[0] === "--verify" && rest[1] === "HEAD") {
      return b.hasCommits === false ? fail("no head") : ok("abc123");
    }
    if (cmd === "status" && rest[0] === "--porcelain") {
      return ok(b.uncommitted ?? "");
    }
    if (cmd === "symbolic-ref" && rest[1] === "refs/remotes/origin/HEAD") {
      if (!b.defaultBranch) return fail("no symref");
      return ok(`origin/${b.defaultBranch}`);
    }
    if (cmd === "config" && rest[0] === "--get" && rest[1] === "init.defaultBranch") {
      return b.defaultBranchConfig ? ok(b.defaultBranchConfig) : fail();
    }
    if (cmd === "rev-parse" && rest[0] === "--abbrev-ref" && rest[1] === "HEAD") {
      return ok(b.currentBranch ?? "main");
    }
    if (cmd === "remote" && rest[0] === "get-url" && rest[1] === "origin") {
      return b.remote === undefined
        ? ok("git@github.com:foo/bar.git")
        : b.remote === null
          ? fail("no remote")
          : ok(b.remote);
    }
    if (cmd === "show-ref" && args.includes("refs/heads/develop")) {
      return b.developExists ? ok("refbb") : fail();
    }
    if (cmd === "tag") {
      return ok(b.tags ?? "");
    }
    if (cmd === "shortlog") {
      return ok(b.shortlog ?? "");
    }
    return fail(`unhandled git ${args.join(" ")}`);
  };
}

function mkRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ini501 — detectInitState — repo kind classification", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini501-state-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("empty repo → kind=empty + inferredShape=empty-dream", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ hasCommits: false, defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no-user-config"),
      ghProbe: () => false,
    });
    expect(state.kind).toBe("empty");
    expect(state.inferredShape).toBe("empty-dream");
    expect(state.hasCommits).toBe(false);
  });

  it("existing repo without devx.config.yaml → kind=existing", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no-user-config"),
      ghProbe: () => false,
    });
    expect(state.kind).toBe("existing");
    expect(state.devxVersion).toBeNull();
  });

  it("devx.config.yaml with devx_version → kind=already-on-devx", () => {
    writeFileSync(join(repo, "devx.config.yaml"), `devx_version: 0.2.1\nmode: YOLO\n`);
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no-user-config"),
      ghProbe: () => false,
    });
    expect(state.kind).toBe("already-on-devx");
    expect(state.devxVersion).toBe("0.2.1");
  });

  it("devx.config.yaml without devx_version → kind=corrupt-config + fatal halt", () => {
    writeFileSync(join(repo, "devx.config.yaml"), `mode: YOLO\nproject:\n  shape: empty-dream\n`);
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no-user-config"),
      ghProbe: () => false,
    });
    expect(state.kind).toBe("corrupt-config");
    expect(state.devxVersion).toBeNull();
    expect(state.halts).toHaveLength(1);
    const halt = state.halts[0];
    if (!halt) throw new Error("expected one halt");
    expect(halt.kind).toBe("corrupt-config");
    expect(halt.fatal).toBe(true);
  });
});

describe("ini501 — detectInitState — halts", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini501-halts-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("uncommitted changes → halt with stash/commit-wip/abort options", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main", uncommitted: " M file.ts\n" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.hasUncommittedChanges).toBe(true);
    const halt = state.halts.find((h) => h.kind === "uncommitted-changes");
    expect(halt).toBeDefined();
    if (!halt) throw new Error("missing uncommitted halt");
    expect(halt.options.map((o) => o.label)).toEqual(["stash", "commit-wip", "abort"]);
    expect(halt.fatal).toBe(false);
  });

  it("HEAD on non-default branch → halt with switch/proceed/abort", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "feature-x" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.isOnDefaultBranch).toBe(false);
    const halt = state.halts.find((h) => h.kind === "non-default-branch");
    expect(halt).toBeDefined();
    if (!halt) throw new Error("missing non-default-branch halt");
    expect(halt.options.map((o) => o.label)).toEqual(["switch", "proceed-from-here", "abort"]);
    expect(halt.message).toContain("feature-x");
    expect(halt.message).toContain("main");
  });

  it("clean default-branch repo → no halts", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.halts).toHaveLength(0);
  });

  it("no remote → hasRemote=false, no halt for missing remote (not a halt condition)", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main", remote: null }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.hasRemote).toBe(false);
    expect(state.remoteUrl).toBeNull();
    expect(state.halts).toHaveLength(0);
  });
});

describe("ini501 — detectInitState — skip-table inputs", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini501-skip-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("README.md → hasReadme + first paragraph extracted, # heading skipped", () => {
    writeFileSync(
      join(repo, "README.md"),
      "# My Project\n\nThis is the first real paragraph.\nWith two lines.\n\nSecond paragraph here.\n",
    );
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.hasReadme).toBe(true);
    expect(state.readmeFirstParagraph).toBe("This is the first real paragraph.\nWith two lines.");
  });

  it("personas dir with .md files → personasPopulated", () => {
    mkdirSync(join(repo, "focus-group", "personas"), { recursive: true });
    writeFileSync(join(repo, "focus-group", "personas", "leonid.md"), "# Leonid\n");
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.personasPopulated).toBe(true);
  });

  it("empty personas dir → not populated", () => {
    mkdirSync(join(repo, "focus-group", "personas"), { recursive: true });
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.personasPopulated).toBe(false);
  });

  it("package.json → detectedStack=typescript", () => {
    writeFileSync(join(repo, "package.json"), `{"name":"x"}`);
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.detectedStack).toBe("typescript");
    expect(state.detectedStackFile).toBe("package.json");
  });

  it("multiple stack files → detectedStack=mixed", () => {
    writeFileSync(join(repo, "package.json"), `{"name":"x"}`);
    writeFileSync(join(repo, "Cargo.toml"), `[package]\nname="x"\n`);
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.detectedStack).toBe("mixed");
  });

  it("DATABASE_URL env var → hasProdEnvVars", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: (k) => (k === "DATABASE_URL" ? "postgres://x" : undefined),
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.hasProdEnvVars).toBe(true);
  });

  it(".github/workflows/*.yml → hasGithubWorkflows", () => {
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, ".github", "workflows", "ci.yml"), "name: ci\n");
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.hasGithubWorkflows).toBe(true);
  });

  it("multi-author git history → multipleAuthorsLast90d", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({
        defaultBranch: "main",
        currentBranch: "main",
        shortlog: "  10\tAlice\n   5\tBob\n",
      }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.multipleAuthorsLast90d).toBe(true);
  });

  it("single-author git history → not multi-author", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({
        defaultBranch: "main",
        currentBranch: "main",
        shortlog: "  10\tAlice\n",
      }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.multipleAuthorsLast90d).toBe(false);
  });

  it("commits + tests + tags → inferredShape=production-careful", () => {
    mkdirSync(join(repo, "test"));
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({
        defaultBranch: "main",
        currentBranch: "main",
        tags: "v1.0.0\nv1.1.0\n",
      }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.hasTests).toBe(true);
    expect(state.hasTags).toBe(true);
    expect(state.inferredShape).toBe("production-careful");
  });

  it("commits but no tests/tags → inferredShape=null (must ask)", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: join(repo, "no"),
      ghProbe: () => false,
    });
    expect(state.inferredShape).toBeNull();
  });
});

describe("ini501 — detectInitState — user config", () => {
  let repo: string;
  let userPath: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini501-user-");
    userPath = join(repo, "user-config.yaml");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("hasUserConfig false when path missing", () => {
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: userPath,
      ghProbe: () => false,
    });
    expect(state.hasUserConfig).toBe(false);
  });

  it("hasUserConfig true when path exists", () => {
    writeFileSync(userPath, "promotion:\n  autonomy:\n    initial_n: 0\n");
    const state = detectInitState({
      repoRoot: repo,
      git: makeGitStub({ defaultBranch: "main", currentBranch: "main" }),
      env: () => undefined,
      userConfigPath: userPath,
      ghProbe: () => false,
    });
    expect(state.hasUserConfig).toBe(true);
  });
});
