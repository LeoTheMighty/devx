// debug-6a913f — hash→spec resolution hardcodes dev/ across v2 CLIs.
//
// RED artifacts for the debug loop: pre-fix, `devx merge-gate` and `devx tour
// gather` cannot resolve `debug/` (or any non-dev) specs — merge-gate emits a
// false-negative gate decision (exit 1 + "manual merge required") and tour
// gather throws no-spec, so debug-loop PRs ship tour-less and Phase 8 files a
// spurious MANUAL.md row. Post-fix both CLIs resolve specs through one shared
// type-aware resolver, and a genuinely-missing hash is the exit-2
// investigation shape (like "no PR yet"), not a gate decision.
//
// Spec: debug/debug-6a913f-2026-07-15T08:27-tour-gather-no-debug-spec-support.md

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type ExecResult, runMergeGate } from "../src/commands/merge-gate.js";
import { GatherError, gatherTour } from "../src/lib/tour/gather.js";

// ---------------------------------------------------------------------------
// Shared tmp bookkeeping
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// merge-gate fixtures (exec seam — no real gh)
// ---------------------------------------------------------------------------

interface GateFixture {
  dir: string;
  configPath: string;
}

function makeGateFixture(opts: {
  hash: string;
  type: string;
  branchInFrontmatter?: string;
  prInFrontmatter?: number;
}): GateFixture {
  const dir = makeTmp("devx-any-type-gate-");
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(
    configPath,
    [
      "mode: YOLO",
      "promotion:",
      "  autonomy:",
      "    count: 0",
      "    initial_n: 0",
      "coverage:",
      "  enabled: false",
      "git:",
      "  default_branch: main",
      "  integration_branch: null",
      "  branch_prefix: feat/",
      "",
    ].join("\n"),
  );
  const specDir = join(dir, opts.type);
  mkdirSync(specDir, { recursive: true });
  const fmLines = [
    "---",
    `hash: ${opts.hash}`,
    `type: ${opts.type}`,
    "title: any-type resolution fixture",
    "status: in-progress",
  ];
  if (opts.branchInFrontmatter !== undefined) fmLines.push(`branch: ${opts.branchInFrontmatter}`);
  if (opts.prInFrontmatter !== undefined) fmLines.push(`pr: ${opts.prInFrontmatter}`);
  fmLines.push("---", "", "## Goal", "", "fixture", "");
  writeFileSync(
    join(specDir, `${opts.type}-${opts.hash}-2026-07-15T08:27-fixture.md`),
    fmLines.join("\n"),
  );
  return { dir, configPath };
}

function runGate(
  fx: GateFixture,
  hash: string,
  exec: (cmd: string, args: string[]) => ExecResult,
): { code: number; decision: { merge: boolean; reason?: string; advice?: string[] } | null; calls: string[] } {
  let stdout = "";
  const calls: string[] = [];
  const code = runMergeGate([hash], {}, {
    out: (s) => {
      stdout += s;
    },
    err: () => {},
    projectPath: fx.configPath,
    exec: (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      return exec(cmd, args);
    },
  });
  let decision = null;
  try {
    decision = JSON.parse(stdout);
  } catch {
    decision = null;
  }
  return { code, decision, calls };
}

const GREEN_PR_VIEW: ExecResult = {
  stdout: JSON.stringify({
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "devx-ci" }],
    reviews: [],
  }),
  stderr: "",
  exitCode: 0,
};

describe("debug-6a913f — merge-gate resolves non-dev specs", () => {
  it("gates a debug/ spec end-to-end (YOLO + green checks → merge:true)", () => {
    const fx = makeGateFixture({
      hash: "abc901",
      type: "debug",
      branchInFrontmatter: "feat/debug-abc901",
      prInFrontmatter: 42,
    });
    const r = runGate(fx, "abc901", (cmd, args) => {
      if (cmd === "gh" && args[0] === "pr" && args[1] === "view") return GREEN_PR_VIEW;
      throw new Error(`unexpected exec: ${cmd} ${args.join(" ")}`);
    });
    expect(r.decision).toEqual({ merge: true });
    expect(r.code).toBe(0);
  });

  it("falls back to the derived per-type branch when frontmatter has none", () => {
    const fx = makeGateFixture({ hash: "abc902", type: "debug" });
    const r = runGate(fx, "abc902", (cmd, args) => {
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        return { stdout: JSON.stringify([{ number: 7, state: "OPEN" }]), stderr: "", exitCode: 0 };
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "view") return GREEN_PR_VIEW;
      throw new Error(`unexpected exec: ${cmd} ${args.join(" ")}`);
    });
    expect(r.code).toBe(0);
    const prList = r.calls.find((c) => c.includes("pr list"));
    // deriveBranch(config, "debug", hash) — NOT the dev-hardcoded fallback.
    expect(prList).toContain("feat/debug-abc902");
  });

  it("emits exit 2 'spec resolution failed' on a cross-dir hash collision", () => {
    const fx = makeGateFixture({ hash: "abc906", type: "debug" });
    // Same hash squatting in dev/ — resolution must refuse, not pick one.
    mkdirSync(join(fx.dir, "dev"), { recursive: true });
    writeFileSync(
      join(fx.dir, "dev", "dev-abc906-2026-07-15T08:27-dupe.md"),
      "---\nhash: abc906\ntype: dev\n---\n",
    );
    const r = runGate(fx, "abc906", () => {
      throw new Error("exec should not be called on ambiguous hash");
    });
    expect(r.code).toBe(2);
    expect(r.decision).toEqual({ merge: false, reason: "spec resolution failed" });
  });

  it("emits the exit-2 investigation shape (no advice) when no spec dir has the hash", () => {
    const fx = makeGateFixture({ hash: "abc903", type: "debug" });
    const r = runGate(fx, "beef99", () => {
      throw new Error("exec should not be called when spec missing");
    });
    expect(r.code).toBe(2);
    expect(r.decision?.merge).toBe(false);
    expect(r.decision?.reason).toContain("no spec file for hash 'beef99'");
    // Resolution failure is investigation, not a gate decision — no advice,
    // so Phase 8 never files a MANUAL.md row for it.
    expect(r.decision?.advice).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tour gather (real git fixture)
// ---------------------------------------------------------------------------

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeTourRepo(hash: string, type: string): string {
  const root = makeTmp("devx-any-type-tour-");
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);

  mkdirSync(join(repo, type), { recursive: true });
  writeFileSync(
    join(repo, type, `${type}-${hash}-2026-07-15T08:27-fixture.md`),
    [
      "---",
      `hash: ${hash}`,
      `type: ${type}`,
      "created: 2026-07-15T08:27:00-06:00",
      "title: Fixture debug item",
      "status: in-progress",
      `branch: feat/${type}-${hash}`,
      "---",
      "",
      "## Goal",
      "",
      "Fix the fixture bug.",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] Repro exists.",
      "",
      "## Status log",
      "",
      "- 2026-07-15T08:27 — filed.",
      "",
    ].join("\n"),
  );
  writeFileSync(join(repo, "app.ts"), "export const x = 1;\n");
  writeFileSync(
    join(repo, "devx.config.yaml"),
    "mode: YOLO\ngit:\n  default_branch: main\n  integration_branch: null\n  branch_prefix: feat/\n",
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "init"]);

  git(repo, ["checkout", "-b", `feat/${type}-${hash}`]);
  writeFileSync(join(repo, "app.ts"), "export const x = 2;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "fix: fixture"]);
  git(repo, ["checkout", "main"]);
  return repo;
}

describe("debug-6a913f — tour gather resolves non-dev specs", () => {
  it("gathers a debug/ spec's tour inputs", () => {
    const repo = makeTourRepo("abc904", "debug");
    const g = gatherTour("abc904", { repoRoot: repo });
    expect(g.meta.hash).toBe("abc904");
    expect(g.meta.branch).toBe("feat/debug-abc904");
    expect(g.meta.specPath).toContain("debug/debug-abc904");
  });

  it("still throws no-spec for a hash that matches no type dir", () => {
    const repo = makeTourRepo("abc905", "debug");
    try {
      gatherTour("nosuch", { repoRoot: repo });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatherError);
      expect((e as GatherError).stage).toBe("no-spec");
    }
  });
});

// ---------------------------------------------------------------------------
// the shared resolver itself (dynamic import — module ships with the fix)
// ---------------------------------------------------------------------------

describe("debug-6a913f — findSpecForHashAnyType", () => {
  async function loadResolver() {
    const mod = await import("../src/lib/engine/frontmatter.js");
    return mod as unknown as {
      findSpecForHashAnyType: (
        repoRoot: string,
        hash: string,
      ) => { path: string; type: string } | null;
      AmbiguousSpecHashError: new (...args: never[]) => Error;
    };
  }

  it("resolves hashes across type dirs and returns the type", async () => {
    const { findSpecForHashAnyType } = await loadResolver();
    const repo = makeTmp("devx-any-type-unit-");
    mkdirSync(join(repo, "dev"), { recursive: true });
    mkdirSync(join(repo, "debug"), { recursive: true });
    writeFileSync(join(repo, "dev", "dev-aaa111-2026-07-15T08:27-a.md"), "---\nhash: aaa111\n---\n");
    writeFileSync(join(repo, "debug", "debug-bbb222-2026-07-15T08:27-b.md"), "---\nhash: bbb222\n---\n");

    expect(findSpecForHashAnyType(repo, "aaa111")).toEqual({
      path: join(repo, "dev", "dev-aaa111-2026-07-15T08:27-a.md"),
      type: "dev",
    });
    expect(findSpecForHashAnyType(repo, "bbb222")).toEqual({
      path: join(repo, "debug", "debug-bbb222-2026-07-15T08:27-b.md"),
      type: "debug",
    });
    expect(findSpecForHashAnyType(repo, "ccc333")).toBeNull();
  });

  it("throws on a cross-dir hash collision instead of picking one silently", async () => {
    const { findSpecForHashAnyType, AmbiguousSpecHashError } = await loadResolver();
    const repo = makeTmp("devx-any-type-unit-");
    mkdirSync(join(repo, "dev"), { recursive: true });
    mkdirSync(join(repo, "debug"), { recursive: true });
    writeFileSync(join(repo, "dev", "dev-ddd444-2026-07-15T08:27-a.md"), "---\nhash: ddd444\n---\n");
    writeFileSync(join(repo, "debug", "debug-ddd444-2026-07-15T08:27-b.md"), "---\nhash: ddd444\n---\n");

    expect(() => findSpecForHashAnyType(repo, "ddd444")).toThrow(AmbiguousSpecHashError);
  });
});
