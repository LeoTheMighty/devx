// init-gh.ts tests (ini503).
//
// Strategy: hermetic tmp dirs as repo roots; templates root points at the
// real package _devx/templates/init/ so we exercise the shipped CI/PR
// template files; gh + git CLIs are scripted via injected execs.
//
// Spec: dev/dev-ini503-2026-04-26T19:35-init-github-scaffolding.md

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type GhExec,
  type GhResult,
  type ManualEntryKind,
  type PendingGhOp,
  parseRepoSlug,
  resolveRepoSlug,
  unionProtection,
  writeInitGh,
} from "../src/lib/init-gh.js";
import type { GitExec, GitResult, InitState } from "../src/lib/init-state.js";
import type { PartialConfig } from "../src/lib/init-questions.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = resolve(HERE, "..", "_devx", "templates", "init");

const NOW = () => new Date("2026-04-27T15:00:00.000Z");

function mkRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function fakeState(repoRoot: string, overrides: Partial<InitState> = {}): InitState {
  return {
    repoRoot,
    kind: "empty",
    hasCommits: false,
    hasUncommittedChanges: false,
    defaultBranch: "main",
    currentBranch: "main",
    isOnDefaultBranch: true,
    hasRemote: true,
    remoteUrl: "git@github.com:LeoTheMighty/devx.git",
    developBranchExists: false,
    mainProtected: false,
    hasTags: false,
    multipleAuthorsLast90d: false,
    devxVersion: null,
    hasUserConfig: false,
    userConfigPath: join(repoRoot, "no-user-config"),
    hasReadme: false,
    readmeFirstParagraph: null,
    personasPopulated: false,
    detectedStack: "typescript",
    detectedStackFile: "package.json",
    hasProdEnvVars: false,
    hasGithubWorkflows: false,
    hasTests: false,
    inferredShape: "empty-dream",
    halts: [],
    ...overrides,
  };
}

function fakeConfig(overrides: Partial<PartialConfig> = {}): PartialConfig {
  return {
    devx_version: "0.1.0",
    mode: "BETA",
    project: { shape: "empty-dream" },
    thoroughness: "balanced",
    git: {
      integration_branch: "develop",
      branch_prefix: "develop/",
      pr_strategy: "pr-to-develop",
      protect_main: true,
    },
    _meta: {
      plan_seed: "",
      first_slice: "",
      who_for: "",
      team_size: "solo",
      stack_description: "",
    },
    ...overrides,
  };
}

interface GhCall {
  args: readonly string[];
  input?: string;
}

function recordingGh(
  responses: ReadonlyArray<(call: GhCall) => GhResult | null>,
): { gh: GhExec; calls: GhCall[] } {
  const calls: GhCall[] = [];
  const gh: GhExec = (args, opts) => {
    const call: GhCall = { args, input: opts?.input };
    calls.push(call);
    for (const responder of responses) {
      const r = responder(call);
      if (r !== null) return r;
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { gh, calls };
}

function ok(stdout = ""): GhResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string, exitCode = 1, stdout = ""): GhResult {
  return { exitCode, stdout, stderr };
}

function fakeGit(map: Record<string, GitResult>): GitExec {
  return (args) => {
    const key = args.join(" ");
    return (
      map[key] ??
      ({ exitCode: 1, stdout: "", stderr: `unknown git args: ${key}` } as GitResult)
    );
  };
}

function defaultGit(): GitExec {
  return fakeGit({
    "rev-parse HEAD": { exitCode: 0, stdout: "abc1234deadbeef\n", stderr: "" },
    "remote get-url origin": {
      exitCode: 0,
      stdout: "git@github.com:LeoTheMighty/devx.git\n",
      stderr: "",
    },
  });
}

// Track tmp dirs across tests so we don't leak them.
const tmps: string[] = [];

afterEach(() => {
  while (tmps.length) {
    const p = tmps.pop()!;
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function repo(prefix: string): string {
  const r = mkRepo(prefix);
  tmps.push(r);
  return r;
}

// ---------------------------------------------------------------------------
// Workflows + PR template
// ---------------------------------------------------------------------------

describe("workflow + PR template writes", () => {
  it("writes the typescript devx-ci + promotion + deploy workflows on a fresh repo", () => {
    const root = repo("init-gh-greenpath-");
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null), // gh auth status
      (c) =>
        c.args[0] === "api" && /branches\/main\/protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });

    expect(result.workflows.map((w) => w.outcome)).toEqual(["wrote", "wrote", "wrote"]);
    expect(existsSync(join(root, ".github", "workflows", "devx-ci.yml"))).toBe(true);
    expect(existsSync(join(root, ".github", "workflows", "devx-promotion.yml"))).toBe(
      true,
    );
    expect(existsSync(join(root, ".github", "workflows", "devx-deploy.yml"))).toBe(true);

    const ci = readFileSync(join(root, ".github", "workflows", "devx-ci.yml"), "utf8");
    expect(ci).toContain("setup-node");
    expect(ci).toContain("name: lint");
    expect(ci).toContain("name: test");
    expect(ci).toContain("name: coverage");
  });

  it("writes the python workflow when the detected stack is python", () => {
    const root = repo("init-gh-py-");
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { detectedStack: "python" }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    const ci = readFileSync(join(root, ".github", "workflows", "devx-ci.yml"), "utf8");
    expect(ci).toContain("setup-python");
    expect(ci).toContain("ruff check");
    expect(ci).toContain("pytest");
  });

  for (const stack of ["rust", "go", "flutter", "empty"] as const) {
    it(`writes the ${stack} workflow when stack is ${stack}`, () => {
      const root = repo(`init-gh-${stack}-`);
      const { gh } = recordingGh([
        (c) => (c.args[0] === "auth" ? ok() : null),
        (c) =>
          c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
            ? fail("gh: HTTP 404: Branch not protected", 1)
            : null,
        (c) =>
          c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
            ? ok('{"private":false,"plan":"unknown"}')
            : null,
      ]);
      writeInitGh({
        repoRoot: root,
        config: fakeConfig(),
        state: fakeState(root, { detectedStack: stack }),
        templatesRoot: TEMPLATES_ROOT,
        gh,
        git: defaultGit(),
        now: NOW,
      });
      const ci = readFileSync(
        join(root, ".github", "workflows", "devx-ci.yml"),
        "utf8",
      );
      // Each stack template has a distinctive marker.
      const marker: Record<typeof stack, string> = {
        rust: "rust-toolchain",
        go: "setup-go",
        flutter: "flutter-action",
        empty: "empty-stack",
      };
      expect(ci).toContain(marker[stack]);
    });
  }

  // PR-template assertions removed — the .github/pull_request_template.md
  // write site moved out of init-gh.ts (Phase 0 surface) into init-write.ts
  // (Phase 1 surface, prt101). See test/init-pr-template-*.test.ts for the
  // canonical coverage of the new shape + idempotency branches.
});

// ---------------------------------------------------------------------------
// Develop branch + default flip
// ---------------------------------------------------------------------------

describe("develop branch + default-branch flip", () => {
  it("creates develop, flips default to develop on the green path", () => {
    const root = repo("init-gh-develop-");
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "") && c.args[2] !== "-X"
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });

    expect(result.develop.kind).toBe("created");
    expect(result.develop.sha).toBe("abc1234deadbeef");
    expect(result.defaultBranch.kind).toBe("changed");
    expect(result.defaultBranch.from).toBe("main");
    expect(result.defaultBranch.to).toBe("develop");

    // Verify the right gh API calls were made.
    const apiCalls = calls.filter((c) => c.args[0] === "api");
    const createDev = apiCalls.find((c) =>
      c.args.includes("repos/LeoTheMighty/devx/git/refs"),
    );
    expect(createDev).toBeDefined();
    expect(createDev?.args).toContain("ref=refs/heads/develop");
    expect(createDev?.args).toContain("sha=abc1234deadbeef");

    const flipDefault = apiCalls.find(
      (c) => c.args.includes("PATCH") && c.args.includes("default_branch=develop"),
    );
    expect(flipDefault).toBeDefined();
  });

  it("skips develop+default flip when integration_branch is null (single-branch)", () => {
    const root = repo("init-gh-singlebranch-");
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "") && c.args[2] !== "-X"
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig({
        git: {
          integration_branch: null,
          branch_prefix: "feat/",
          pr_strategy: "pr-to-main",
          protect_main: false,
        },
      }),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.develop.kind).toBe("skipped-single-branch");
    expect(result.defaultBranch.kind).toBe("skipped-single-branch");
    expect(result.protection.kind).toBe("skipped-config-opted-out");

    // Workflows still written, no develop API call.
    const apiCalls = calls.filter((c) => c.args[0] === "api");
    const developCall = apiCalls.find((c) =>
      c.args.some((a) => a.includes("git/refs")),
    );
    expect(developCall).toBeUndefined();
  });

  it("keeps an existing develop branch and still tries to flip default", () => {
    const root = repo("init-gh-existing-develop-");
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { developBranchExists: true }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.develop.kind).toBe("skipped-already-exists");
    expect(result.defaultBranch.kind).toBe("changed");
  });

  it("never overwrites a non-main default branch (e.g. master)", () => {
    const root = repo("init-gh-non-main-default-");
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { defaultBranch: "master" }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    // Develop is still created (off the master HEAD) but default isn't flipped.
    expect(result.develop.kind).toBe("created");
    expect(result.defaultBranch.kind).toBe("skipped-non-main-default");
    expect(result.defaultBranch.existing).toBe("master");
  });

  it("recognizes 422 already-exists from gh and reports skipped-already-exists", () => {
    const root = repo("init-gh-422-");
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && c.args.some((a) => a.includes("git/refs"))
          ? fail("gh: HTTP 422: Reference already exists", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.develop.kind).toBe("skipped-already-exists");
  });
});

// ---------------------------------------------------------------------------
// Branch protection
// ---------------------------------------------------------------------------

describe("branch protection", () => {
  it("PUTs the protection payload with required contexts and tightening defaults", () => {
    const root = repo("init-gh-protection-");
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" &&
        /protection$/.test(c.args[1] ?? "") &&
        !c.args.includes("PUT")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.protection.kind).toBe("applied");
    expect(result.protection.merged).toBe(false);

    const putCall = calls.find(
      (c) => c.args.includes("PUT") && /protection$/.test(c.args[3] ?? ""),
    );
    expect(putCall).toBeDefined();
    expect(putCall?.input).toBeDefined();
    const payload = JSON.parse(putCall!.input!);
    expect(payload.required_status_checks.contexts).toEqual([
      "lint",
      "test",
      "coverage",
    ]);
    expect(payload.enforce_admins).toBe(true);
    expect(payload.required_pull_request_reviews.required_approving_review_count).toBe(
      0,
    );
    expect(payload.required_linear_history).toBe(true);
    expect(payload.allow_force_pushes).toBe(false);
    expect(payload.allow_deletions).toBe(false);
  });

  it("unions with existing protection rather than replacing", () => {
    const root = repo("init-gh-union-");
    const existingProtection = {
      required_status_checks: { strict: false, contexts: ["build", "lint"] },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: {
        required_approving_review_count: 2,
        dismiss_stale_reviews: true,
        require_code_owner_reviews: false,
      },
      required_linear_history: { enabled: false },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    };
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" &&
        /protection$/.test(c.args[1] ?? "") &&
        !c.args.includes("PUT")
          ? ok(JSON.stringify(existingProtection))
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { developBranchExists: true }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.protection.kind).toBe("applied");
    expect(result.protection.merged).toBe(true);
    const putCall = calls.find(
      (c) => c.args.includes("PUT") && /protection$/.test(c.args[3] ?? ""),
    );
    const payload = JSON.parse(putCall!.input!);
    // Union of contexts: existing ["build","lint"] + ours ["lint","test","coverage"]
    expect(new Set(payload.required_status_checks.contexts)).toEqual(
      new Set(["build", "lint", "test", "coverage"]),
    );
    // Strict tightens to true (ours wins over false existing).
    expect(payload.required_status_checks.strict).toBe(true);
    // Reviewer count keeps the higher (existing 2 > ours 0).
    expect(payload.required_pull_request_reviews.required_approving_review_count).toBe(2);
    // Tighten review toggles forward.
    expect(payload.required_pull_request_reviews.dismiss_stale_reviews).toBe(true);
    expect(payload.required_linear_history).toBe(true);
  });

  it("skips protection entirely when config.git.protect_main is false", () => {
    const root = repo("init-gh-no-protect-");
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig({
        git: {
          integration_branch: null,
          branch_prefix: "feat/",
          pr_strategy: "pr-to-main",
          protect_main: false,
        },
      }),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.protection.kind).toBe("skipped-config-opted-out");
    // No PUT against /protection should have been made.
    const putCall = calls.find(
      (c) => c.args.includes("PUT") && /protection$/.test(c.args[3] ?? ""),
    );
    expect(putCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

describe("failure modes", () => {
  it("queues every gh op and writes 1 MANUAL entry when the repo has no remote", () => {
    const root = repo("init-gh-noremote-");
    const { gh, calls } = recordingGh([]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { hasRemote: false, remoteUrl: null }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });

    expect(calls.length).toBe(0); // never invoked gh
    expect(result.develop.kind).toBe("skipped-no-remote");
    expect(result.protection.kind).toBe("skipped-no-remote");
    expect(result.manualEntries.length).toBe(1);
    expect(result.manualEntries[0]?.kind).toBe<ManualEntryKind>("no-remote");

    // Queue file should exist with all 4 op kinds.
    const queue = JSON.parse(readFileSync(result.pendingGhOpsPath, "utf8"));
    const kinds = (queue.ops as PendingGhOp[]).map((o) => o.kind).sort();
    expect(kinds).toEqual(
      [
        "apply-branch-protection",
        "create-develop-branch",
        "push-workflows",
        "set-default-branch",
      ].sort(),
    );

    // Workflows still got written locally.
    expect(existsSync(join(root, ".github", "workflows", "devx-ci.yml"))).toBe(true);
  });

  it("queues all gh ops + writes a MANUAL entry when gh is not authenticated", () => {
    const root = repo("init-gh-unauth-");
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? fail("not authenticated", 1) : null),
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.ghAuthOk).toBe(false);
    expect(result.develop.kind).toBe("skipped-gh-unauth");
    expect(result.protection.kind).toBe("skipped-gh-unauth");
    expect(result.manualEntries.length).toBe(1);
    expect(result.manualEntries[0]?.kind).toBe<ManualEntryKind>("gh-not-authenticated");

    // Only the auth probe was called.
    expect(calls.filter((c) => c.args[0] === "api").length).toBe(0);

    const queue = JSON.parse(readFileSync(result.pendingGhOpsPath, "utf8"));
    expect(queue.ops.length).toBe(4);
  });

  it("detects free-tier private repos, installs pre-push hook, writes MANUAL", () => {
    const root = repo("init-gh-private-");
    // Pre-create .git/hooks so writeAtomic has somewhere to land.
    mkdirSync(join(root, ".git", "hooks"), { recursive: true });
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":true,"plan":"free"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.protection.kind).toBe("skipped-private-free-tier");
    expect(result.protection.prePushHookInstalled).toBe(true);
    expect(result.manualEntries.length).toBe(1);
    expect(result.manualEntries[0]?.kind).toBe<ManualEntryKind>("private-free-tier");

    const hookPath = join(root, ".git", "hooks", "pre-push");
    expect(existsSync(hookPath)).toBe(true);
    const stat = statSync(hookPath);
    // Executable bit set (at least for owner).
    expect(stat.mode & 0o100).toBeTruthy();
    const body = readFileSync(hookPath, "utf8");
    expect(body).toContain("[devx pre-push]");
    expect(body).toContain("npm test");

    // No PUT against /protection should have been made.
    const putCall = calls.find(
      (c) => c.args.includes("PUT") && /protection$/.test(c.args[3] ?? ""),
    );
    expect(putCall).toBeUndefined();
  });

  it("queues protection PUT when 403 is returned on the up-front scope probe", () => {
    const root = repo("init-gh-403-");
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 403: missing required scopes", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.protection.kind).toBe("skipped-missing-scopes");
    expect(result.manualEntries.length).toBe(1);
    expect(result.manualEntries[0]?.kind).toBe<ManualEntryKind>("gh-missing-scopes");
    expect(
      result.pendingGhOps.some((op) => op.kind === "apply-branch-protection"),
    ).toBe(true);
    // No PUT happened (we deferred).
    const putCall = calls.find(
      (c) => c.args.includes("PUT") && /protection$/.test(c.args[3] ?? ""),
    );
    expect(putCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("idempotent re-run", () => {
  it("workflow files: writes once, second run reports skipped-identical", () => {
    const root = repo("init-gh-idem-");
    const greenGh = (): GhExec => {
      const { gh } = recordingGh([
        (c) => (c.args[0] === "auth" ? ok() : null),
        (c) =>
          c.args[0] === "api" &&
          /protection$/.test(c.args[1] ?? "") &&
          !c.args.includes("PUT")
            ? fail("gh: HTTP 404: Branch not protected", 1)
            : null,
        (c) =>
          c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
            ? ok('{"private":false,"plan":"unknown"}')
            : null,
      ]);
      return gh;
    };
    const args = {
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      git: defaultGit(),
      now: NOW,
    };
    const first = writeInitGh({ ...args, gh: greenGh() });
    const second = writeInitGh({ ...args, gh: greenGh() });
    expect(first.workflows.every((w) => w.outcome === "wrote")).toBe(true);
    expect(second.workflows.every((w) => w.outcome === "skipped-identical")).toBe(true);
  });

  it("workflow files: leaves user-customized workflow alone (kept-existing-different)", () => {
    const root = repo("init-gh-keep-");
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    const handEdited = "name: my-custom-ci\non: push\njobs:\n  custom: { runs-on: ubuntu-latest, steps: [{ run: 'echo hi' }] }\n";
    writeFileSync(join(root, ".github", "workflows", "devx-ci.yml"), handEdited);
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && /protection$/.test(c.args[1] ?? "")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.workflows[0]?.outcome).toBe("kept-existing-different");
    // File on disk unchanged.
    const after = readFileSync(
      join(root, ".github", "workflows", "devx-ci.yml"),
      "utf8",
    );
    expect(after).toBe(handEdited);
  });

  it("pending-gh-ops queue: re-run dedupes by op kind (last-write-wins on payload)", () => {
    const root = repo("init-gh-queue-dedup-");
    const args = {
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { hasRemote: false, remoteUrl: null }),
      templatesRoot: TEMPLATES_ROOT,
      gh: recordingGh([]).gh,
      git: defaultGit(),
      now: NOW,
    };
    writeInitGh(args);
    const second = writeInitGh(args);
    const queue = JSON.parse(readFileSync(second.pendingGhOpsPath, "utf8"));
    const kinds = (queue.ops as PendingGhOp[]).map((o) => o.kind);
    // Each kind appears exactly once.
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Helpers — exported pure functions
// ---------------------------------------------------------------------------

describe("parseRepoSlug + resolveRepoSlug", () => {
  it("parses ssh, https, with and without .git suffix", () => {
    expect(parseRepoSlug("git@github.com:LeoTheMighty/devx.git")).toBe(
      "LeoTheMighty/devx",
    );
    expect(parseRepoSlug("git@github.com:LeoTheMighty/devx")).toBe(
      "LeoTheMighty/devx",
    );
    expect(parseRepoSlug("https://github.com/LeoTheMighty/devx.git")).toBe(
      "LeoTheMighty/devx",
    );
    expect(parseRepoSlug("https://github.com/LeoTheMighty/devx")).toBe(
      "LeoTheMighty/devx",
    );
    expect(parseRepoSlug("git+https://github.com/LeoTheMighty/devx.git")).toBe(
      "LeoTheMighty/devx",
    );
    expect(parseRepoSlug("ssh://git@github.com/LeoTheMighty/devx.git")).toBe(
      "LeoTheMighty/devx",
    );
    expect(parseRepoSlug("https://gitlab.com/x/y.git")).toBe(null);
    expect(parseRepoSlug("")).toBe(null);
  });

  it("rejects look-alike URLs that embed github.com in the path", () => {
    // Anchored to URL start — path-embedded "github.com" must not parse.
    expect(parseRepoSlug("https://malicious.com/github.com/evil/repo")).toBe(null);
    expect(parseRepoSlug("https://example.com/github.com/x/y.git")).toBe(null);
    // Subdomains must not parse.
    expect(parseRepoSlug("https://api.github.com/x/y")).toBe(null);
  });

  it("returns null when git remote get-url fails", () => {
    const git: GitExec = () => ({ exitCode: 1, stdout: "", stderr: "no remote" });
    expect(resolveRepoSlug(git, "/tmp")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Gaps surfaced by self-review
// ---------------------------------------------------------------------------

describe("self-review gap fills", () => {
  function greenProbeResponders(
    repoMeta: string = '{"private":false,"plan":"unknown"}',
  ) {
    return [
      (c: GhCall) => (c.args[0] === "auth" ? ok() : null),
      (c: GhCall) =>
        c.args[0] === "api" &&
        /protection$/.test(c.args[1] ?? "") &&
        !c.args.includes("PUT")
          ? fail("gh: HTTP 404: Branch not protected", 1)
          : null,
      (c: GhCall) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok(repoMeta)
          : null,
    ];
  }

  it("surfaces protection PUT failure (post-probe) as kind=failed with stderr", () => {
    const root = repo("init-gh-put-fail-");
    const { gh } = recordingGh([
      ...greenProbeResponders(),
      (c) =>
        c.args[0] === "api" && c.args.includes("PUT") && /protection$/.test(c.args[3] ?? "")
          ? fail("gh: HTTP 502: Bad gateway from upstream", 1)
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.protection.kind).toBe("failed");
    expect(result.protection.error).toContain("HTTP 502");
  });

  it("surfaces a non-422 develop-create failure as kind=failed (no silent skip)", () => {
    const root = repo("init-gh-dev-fail-");
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" && c.args.some((a) => a.includes("git/refs"))
          ? fail("gh: HTTP 500: server error", 1)
          : null,
      ...greenProbeResponders(),
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.develop.kind).toBe("failed");
    expect(result.develop.error).toContain("HTTP 500");
  });

  it("surfaces default-branch PATCH failure as kind=failed (no silent skip)", () => {
    const root = repo("init-gh-patch-fail-");
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" &&
        c.args.includes("PATCH") &&
        c.args.includes("default_branch=develop")
          ? fail("gh: HTTP 500: server error", 1)
          : null,
      ...greenProbeResponders(),
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.develop.kind).toBe("created");
    expect(result.defaultBranch.kind).toBe("failed");
    expect(result.defaultBranch.error).toContain("HTTP 500");
  });

  it("mixed stack falls back to the typescript template", () => {
    const root = repo("init-gh-mixed-");
    const { gh } = recordingGh(greenProbeResponders());
    writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { detectedStack: "mixed" }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    const ci = readFileSync(join(root, ".github", "workflows", "devx-ci.yml"), "utf8");
    expect(ci).toContain("setup-node");
  });

  // PR template idempotency moved to test/init-pr-template-with-marker.test.ts
  // when the writer migrated from init-gh.ts → init-write.ts (prt101).

  it("preserves existing branch-protection restrictions in the union", () => {
    const root = repo("init-gh-restrictions-");
    const existingProtection = {
      required_status_checks: { strict: false, contexts: [] },
      enforce_admins: { enabled: false },
      required_pull_request_reviews: {
        required_approving_review_count: 0,
        dismiss_stale_reviews: false,
        require_code_owner_reviews: false,
      },
      restrictions: {
        users: [{ login: "alice" }, { login: "bob" }],
        teams: [{ slug: "core" }],
        apps: [{ slug: "merge-bot" }],
      },
      required_linear_history: { enabled: false },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    };
    const { gh, calls } = recordingGh([
      (c) => (c.args[0] === "auth" ? ok() : null),
      (c) =>
        c.args[0] === "api" &&
        /protection$/.test(c.args[1] ?? "") &&
        !c.args.includes("PUT")
          ? ok(JSON.stringify(existingProtection))
          : null,
      (c) =>
        c.args[0] === "api" && /^repos\/LeoTheMighty\/devx$/.test(c.args[1] ?? "")
          ? ok('{"private":false,"plan":"unknown"}')
          : null,
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { developBranchExists: true }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.protection.kind).toBe("applied");
    const putCall = calls.find(
      (c) => c.args.includes("PUT") && /protection$/.test(c.args[3] ?? ""),
    );
    const payload = JSON.parse(putCall!.input!);
    expect(payload.restrictions).not.toBeNull();
    expect(payload.restrictions.users.sort()).toEqual(["alice", "bob"]);
    expect(payload.restrictions.teams).toEqual(["core"]);
    expect(payload.restrictions.apps).toEqual(["merge-bot"]);
  });

  it("no-remote queue respects single-branch + no-protect config (only queues push-workflows)", () => {
    const root = repo("init-gh-noremote-singlebranch-");
    const { gh } = recordingGh([]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig({
        git: {
          integration_branch: null,
          branch_prefix: "feat/",
          pr_strategy: "pr-to-main",
          protect_main: false,
        },
      }),
      state: fakeState(root, { hasRemote: false, remoteUrl: null }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.develop.kind).toBe("skipped-single-branch");
    expect(result.protection.kind).toBe("skipped-config-opted-out");
    const queue = JSON.parse(readFileSync(result.pendingGhOpsPath, "utf8"));
    const kinds = (queue.ops as PendingGhOp[]).map((o) => o.kind).sort();
    // Only push-workflows should be queued — develop + protection are
    // off per the config, so the resume flow shouldn't reapply them.
    expect(kinds).toEqual(["push-workflows"]);
  });

  it("gh-unauth queue respects single-branch + no-protect config", () => {
    const root = repo("init-gh-unauth-singlebranch-");
    const { gh } = recordingGh([
      (c) => (c.args[0] === "auth" ? fail("not authenticated", 1) : null),
    ]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig({
        git: {
          integration_branch: null,
          branch_prefix: "feat/",
          pr_strategy: "pr-to-main",
          protect_main: false,
        },
      }),
      state: fakeState(root),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    expect(result.develop.kind).toBe("skipped-single-branch");
    expect(result.protection.kind).toBe("skipped-config-opted-out");
    const queue = JSON.parse(readFileSync(result.pendingGhOpsPath, "utf8"));
    const kinds = (queue.ops as PendingGhOp[]).map((o) => o.kind).sort();
    expect(kinds).toEqual(["push-workflows"]);
  });

  it("queues push-workflows with REPO-RELATIVE paths (survives repo move)", () => {
    const root = repo("init-gh-relpaths-");
    const { gh } = recordingGh([]);
    const result = writeInitGh({
      repoRoot: root,
      config: fakeConfig(),
      state: fakeState(root, { hasRemote: false, remoteUrl: null }),
      templatesRoot: TEMPLATES_ROOT,
      gh,
      git: defaultGit(),
      now: NOW,
    });
    const queue = JSON.parse(readFileSync(result.pendingGhOpsPath, "utf8"));
    const pushOp = (queue.ops as PendingGhOp[]).find(
      (o) => o.kind === "push-workflows",
    );
    expect(pushOp).toBeDefined();
    const paths = pushOp!.payload.paths as string[];
    expect(paths.every((p) => !p.startsWith("/"))).toBe(true);
    expect(paths).toContain(".github/workflows/devx-ci.yml");
    expect(paths).toContain(".github/workflows/devx-promotion.yml");
    expect(paths).toContain(".github/workflows/devx-deploy.yml");
  });
});

describe("unionProtection (restrictions translation)", () => {
  it("preserves existing restrictions when ours is null", () => {
    const merged = unionProtection(
      {
        restrictions: {
          users: ["alice"],
          teams: ["core"],
          apps: ["merge-bot"],
        },
      },
      {
        required_status_checks: { strict: true, contexts: ["lint"] },
        enforce_admins: true,
        required_pull_request_reviews: {
          required_approving_review_count: 0,
          dismiss_stale_reviews: false,
          require_code_owner_reviews: false,
        },
        restrictions: null,
        required_linear_history: true,
        allow_force_pushes: false,
        allow_deletions: false,
      },
    );
    expect(merged.restrictions).not.toBeNull();
    expect(merged.restrictions!.users).toEqual(["alice"]);
    expect(merged.restrictions!.teams).toEqual(["core"]);
    expect(merged.restrictions!.apps).toEqual(["merge-bot"]);
  });

  it("returns null restrictions when both sides are null", () => {
    const merged = unionProtection(
      { restrictions: null },
      {
        required_status_checks: { strict: true, contexts: [] },
        enforce_admins: true,
        required_pull_request_reviews: {
          required_approving_review_count: 0,
          dismiss_stale_reviews: false,
          require_code_owner_reviews: false,
        },
        restrictions: null,
        required_linear_history: true,
        allow_force_pushes: false,
        allow_deletions: false,
      },
    );
    expect(merged.restrictions).toBeNull();
  });
});

describe("unionProtection", () => {
  it("never weakens any field", () => {
    const existing = {
      required_status_checks: { strict: false, contexts: ["build"] },
      enforce_admins: false,
      required_pull_request_reviews: {
        required_approving_review_count: 3,
        dismiss_stale_reviews: false,
        require_code_owner_reviews: true,
      },
      required_linear_history: false,
      allow_force_pushes: true,
      allow_deletions: true,
    };
    const ours = {
      required_status_checks: { strict: true, contexts: ["lint", "test", "coverage"] },
      enforce_admins: true,
      required_pull_request_reviews: {
        required_approving_review_count: 0,
        dismiss_stale_reviews: false,
        require_code_owner_reviews: false,
      },
      restrictions: null,
      required_linear_history: true,
      allow_force_pushes: false,
      allow_deletions: false,
    };
    const merged = unionProtection(existing, ours);
    expect(merged.required_status_checks.strict).toBe(true);
    expect(new Set(merged.required_status_checks.contexts)).toEqual(
      new Set(["build", "lint", "test", "coverage"]),
    );
    expect(merged.enforce_admins).toBe(true);
    expect(
      merged.required_pull_request_reviews.required_approving_review_count,
    ).toBe(3);
    expect(merged.required_pull_request_reviews.require_code_owner_reviews).toBe(true);
    expect(merged.required_linear_history).toBe(true);
    // allow-flags: false wins from either side
    expect(merged.allow_force_pushes).toBe(false);
    expect(merged.allow_deletions).toBe(false);
  });
});
