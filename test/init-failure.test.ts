// init-failure.ts tests (ini506).
//
// Coverage targets — every AC scenario plus a few regression guards:
//   - setInitPartial / readInitPartial: round-trip preserves comments + key
//     order (cfg202 guarantees this; we re-verify here so a future cfg202
//     regression breaks BOTH suites instead of silently moving the failure).
//   - assertNotPartial: blocks in BETA/PROD/LOCKDOWN; passes in YOLO; passes
//     when flag absent; passes when config absent.
//   - handleBmadInstallFailure: r/s/a decisions, write of bmad.modules: [],
//     stderr capture + truncation, idempotent re-skip.
//   - handleGhNotAuth + handleNoRemote: MANUAL append (idempotent), flag
//     flip, promotion.gate forced to manual-only on no-remote.
//   - replayPendingGhOps: per-kind dispatch (create-develop, set-default,
//     apply-protection, push-workflows), corrupt JSON throws
//     PendingGhOpsCorruptError, missing slug per op, idempotent re-replay.
//
// Hermetic: every test uses a fresh tmp dir as repoRoot and injects scripted
// gh + git execs. Reads are direct file reads on the tmp dir.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  InitAbortedError,
  InitPartialError,
  PARTIAL_BLOCKING_MODES,
  PendingGhOpsCorruptError,
  assertNotPartial,
  handleBmadInstallFailure,
  handleGhNotAuth,
  handleNoRemote,
  readInitPartial,
  replayPendingGhOps,
  setInitPartial,
  writeRemainingPendingOps,
  type ManualEntry,
  type PendingGhOp,
  type PendingGhOpsFile,
} from "../src/lib/init-failure.js";
import type { GhExec, GhResult } from "../src/lib/init-gh.js";
import type { GitExec, GitResult } from "../src/lib/init-state.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mkRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const NOW = () => new Date("2026-04-27T20:00:00.000Z");

function writeMinimalConfig(repoRoot: string, overrides: string = ""): string {
  const path = join(repoRoot, "devx.config.yaml");
  writeFileSync(
    path,
    [
      "devx_version: 0.1.0",
      "mode: YOLO",
      "project:",
      "  shape: empty-dream",
      "thoroughness: send-it",
      "promotion:",
      "  gate: fast-ship-always",
      "  soak_hours: 0",
      "bmad:",
      "  modules: [core, bmm, tea]",
      "  output_root: _bmad-output",
      "",
      overrides,
    ].join("\n"),
  );
  return path;
}

interface ScriptedGh {
  exec: GhExec;
  calls: Array<{ args: readonly string[]; input?: string }>;
}

function scriptedGh(plan: Array<((args: readonly string[]) => GhResult) | GhResult>): ScriptedGh {
  const calls: Array<{ args: readonly string[]; input?: string }> = [];
  let i = 0;
  const exec: GhExec = (args, opts) => {
    calls.push({ args, input: opts?.input });
    const next = plan[i++];
    if (next === undefined) {
      throw new Error(`scriptedGh: ran out of canned responses at call ${i} for ${args.join(" ")}`);
    }
    if (typeof next === "function") return next(args);
    return next;
  };
  return { exec, calls };
}

interface ScriptedGit {
  exec: GitExec;
  calls: Array<readonly string[]>;
}

function scriptedGit(handler: (args: readonly string[]) => GitResult): ScriptedGit {
  const calls: Array<readonly string[]> = [];
  const exec: GitExec = (args) => {
    calls.push(args);
    return handler(args);
  };
  return { exec, calls };
}

const okGit: GitExec = (args) => {
  if (args[0] === "remote" && args[1] === "get-url") {
    return { exitCode: 0, stdout: "git@github.com:LeoTheMighty/devx.git\n", stderr: "" };
  }
  if (args[0] === "rev-parse" && args[1] === "HEAD") {
    return { exitCode: 0, stdout: "deadbeefcafebabedeadbeefcafebabe00000000\n", stderr: "" };
  }
  if (args[0] === "symbolic-ref") {
    return { exitCode: 0, stdout: "origin/main\n", stderr: "" };
  }
  return { exitCode: 1, stdout: "", stderr: "no script for " + args.join(" ") };
};

// ---------------------------------------------------------------------------
// Flag round-trip
// ---------------------------------------------------------------------------

describe("ini506 — setInitPartial / readInitPartial", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini506-flag-");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("readInitPartial returns false when config is absent", () => {
    expect(readInitPartial({ repoRoot: repo })).toBe(false);
  });

  it("readInitPartial returns false when key is absent", () => {
    writeMinimalConfig(repo);
    expect(readInitPartial({ repoRoot: repo })).toBe(false);
  });

  it("setInitPartial(true) writes the flag and readInitPartial sees it", () => {
    writeMinimalConfig(repo);
    setInitPartial({ repoRoot: repo, partial: true });
    expect(readInitPartial({ repoRoot: repo })).toBe(true);
  });

  it("setInitPartial(false) clears the flag", () => {
    writeMinimalConfig(repo);
    setInitPartial({ repoRoot: repo, partial: true });
    setInitPartial({ repoRoot: repo, partial: false });
    expect(readInitPartial({ repoRoot: repo })).toBe(false);
  });

  it("setInitPartial throws when config doesn't exist", () => {
    expect(() => setInitPartial({ repoRoot: repo, partial: true })).toThrow(
      /init-write must run before flag flips/,
    );
  });

  it("readInitPartial returns false on corrupt YAML (does not throw)", () => {
    writeFileSync(join(repo, "devx.config.yaml"), "not: : : yaml\n  -");
    expect(readInitPartial({ repoRoot: repo })).toBe(false);
  });
});

describe("ini506 — assertNotPartial", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini506-assert-");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("does not throw when config is absent", () => {
    expect(() => assertNotPartial({ repoRoot: repo })).not.toThrow();
  });

  it("does not throw when flag is false (mode YOLO)", () => {
    writeMinimalConfig(repo);
    expect(() => assertNotPartial({ repoRoot: repo })).not.toThrow();
  });

  it("does not throw in YOLO even when flag is true (YOLO eats partial state)", () => {
    writeMinimalConfig(repo);
    setInitPartial({ repoRoot: repo, partial: true });
    expect(() => assertNotPartial({ repoRoot: repo })).not.toThrow();
  });

  it("throws InitPartialError in BETA/PROD/LOCKDOWN when flag is true", () => {
    for (const mode of ["BETA", "PROD", "LOCKDOWN"]) {
      const r = mkRepo(`ini506-assert-${mode}-`);
      const path = join(r, "devx.config.yaml");
      writeFileSync(
        path,
        ["devx_version: 0.1.0", `mode: ${mode}`, "project:", "  shape: empty-dream", ""].join("\n"),
      );
      setInitPartial({ repoRoot: r, partial: true });
      expect(() => assertNotPartial({ repoRoot: r })).toThrow(InitPartialError);
      rmSync(r, { recursive: true, force: true });
    }
  });

  it("PARTIAL_BLOCKING_MODES is exactly {BETA, PROD, LOCKDOWN}", () => {
    expect([...PARTIAL_BLOCKING_MODES].sort()).toEqual(["BETA", "LOCKDOWN", "PROD"]);
  });
});

// ---------------------------------------------------------------------------
// BMAD-install failure
// ---------------------------------------------------------------------------

describe("ini506 — handleBmadInstallFailure", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini506-bmad-");
    writeMinimalConfig(repo);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("decision='retry' returns without writing skip state", async () => {
    const out = await handleBmadInstallFailure({
      repoRoot: repo,
      exitCode: 1,
      stderr: "transient network error",
      attempts: 1,
      prompt: () => "retry",
      now: NOW,
    });
    expect(out.decision).toBe("retry");
    expect(out.wroteSkipState).toBe(false);
    expect(readInitPartial({ repoRoot: repo })).toBe(false);
    expect(existsSync(join(repo, "MANUAL.md"))).toBe(false);
  });

  it("decision='abort' throws InitAbortedError with attempts in message", async () => {
    await expect(
      handleBmadInstallFailure({
        repoRoot: repo,
        exitCode: 127,
        stderr: "command not found",
        attempts: 3,
        prompt: () => "abort",
        now: NOW,
      }),
    ).rejects.toThrow(/aborted.*exit 127.*3 attempt/);
  });

  it("decision='skip' writes bmad.modules:[], flips flag, appends MANUAL", async () => {
    const out = await handleBmadInstallFailure({
      repoRoot: repo,
      exitCode: 1,
      stderr: "ENOTFOUND registry.npmjs.org",
      attempts: 1,
      prompt: () => "skip",
      now: NOW,
    });
    expect(out.decision).toBe("skip");
    expect(out.wroteSkipState).toBe(true);

    const cfg = parseYaml(readFileSync(join(repo, "devx.config.yaml"), "utf8")) as {
      bmad: { modules: string[] };
      init_partial: boolean;
    };
    expect(cfg.bmad.modules).toEqual([]);
    expect(cfg.init_partial).toBe(true);

    const manual = readFileSync(join(repo, "MANUAL.md"), "utf8");
    expect(manual).toContain("devx-init: bmad-install-failed");
    expect(manual).toContain("ENOTFOUND registry.npmjs.org");
    expect(manual).toContain("Filed: 2026-04-27T20:00:00.000Z");
  });

  it("decision='skip' picks a longer fence when stderr contains ``` so MANUAL renders cleanly", async () => {
    await handleBmadInstallFailure({
      repoRoot: repo,
      exitCode: 1,
      stderr: "```\nnested fence inside captured stderr\n```",
      attempts: 1,
      prompt: () => "skip",
      now: NOW,
    });
    const manual = readFileSync(join(repo, "MANUAL.md"), "utf8");
    // The fence around stderr must be at least 4 backticks since the body
    // contains 3. Otherwise the inner ``` would terminate the outer block
    // and orphan the trailing content into the rest of MANUAL.md.
    // Body lines are indented 2 spaces inside the bullet (see appendManualEntry).
    expect(manual).toMatch(/ {2}stderr:\n {2}````/);
  });

  it("decision='skip' truncates extremely long stderr", async () => {
    const longStderr = "x".repeat(2000);
    const out = await handleBmadInstallFailure({
      repoRoot: repo,
      exitCode: 1,
      stderr: longStderr,
      attempts: 1,
      prompt: () => "skip",
      now: NOW,
    });
    expect(out.recordedStderr.length).toBeLessThan(longStderr.length);
    expect(out.recordedStderr).toMatch(/truncated/);
  });

  it("re-skipping is idempotent on the MANUAL entry (anchor dedupes)", async () => {
    await handleBmadInstallFailure({
      repoRoot: repo,
      exitCode: 1,
      stderr: "first error",
      attempts: 1,
      prompt: () => "skip",
      now: NOW,
    });
    const manualBefore = readFileSync(join(repo, "MANUAL.md"), "utf8");
    await handleBmadInstallFailure({
      repoRoot: repo,
      exitCode: 1,
      stderr: "second error (different)",
      attempts: 2,
      prompt: () => "skip",
      now: NOW,
    });
    const manualAfter = readFileSync(join(repo, "MANUAL.md"), "utf8");
    // Same MANUAL content (the first entry is preserved, the second is skipped
    // by the anchor check). This matches the "don't pile up duplicates" rule.
    expect(manualAfter).toBe(manualBefore);
  });

  it("prompt is called with exit code, stderr, and attempt count", async () => {
    const seen: Array<{ exitCode: number; stderr: string; attempts: number }> = [];
    await handleBmadInstallFailure({
      repoRoot: repo,
      exitCode: 42,
      stderr: "boom",
      attempts: 7,
      prompt: (opts) => {
        seen.push(opts);
        return "retry";
      },
    });
    expect(seen).toEqual([{ exitCode: 42, stderr: "boom", attempts: 7 }]);
  });
});

// ---------------------------------------------------------------------------
// gh-not-auth
// ---------------------------------------------------------------------------

describe("ini506 — handleGhNotAuth", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini506-gh-noauth-");
    writeMinimalConfig(repo);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("appends MANUAL entry + flips flag", () => {
    const entry: ManualEntry = {
      kind: "gh-not-authenticated",
      body: "Run `gh auth login` then `devx init --resume-gh`.",
    };
    const out = handleGhNotAuth({
      repoRoot: repo,
      manualEntry: entry,
      now: NOW,
    });
    expect(out).toEqual({ manualAppended: true, flagFlipped: true });

    expect(readInitPartial({ repoRoot: repo })).toBe(true);
    const manual = readFileSync(join(repo, "MANUAL.md"), "utf8");
    expect(manual).toContain("devx-init: gh-not-authenticated");
    expect(manual).toContain("gh auth login");
  });

  it("re-running with the same kind does NOT duplicate the MANUAL bullet", () => {
    const entry: ManualEntry = {
      kind: "gh-not-authenticated",
      body: "first body",
    };
    handleGhNotAuth({ repoRoot: repo, manualEntry: entry, now: NOW });
    const before = readFileSync(join(repo, "MANUAL.md"), "utf8");
    const out2 = handleGhNotAuth({
      repoRoot: repo,
      manualEntry: { kind: "gh-not-authenticated", body: "second body" },
      now: NOW,
    });
    expect(out2.manualAppended).toBe(false);
    expect(readFileSync(join(repo, "MANUAL.md"), "utf8")).toBe(before);
  });

  it("MANUAL bullet shape includes an unchecked checkbox so the user can ack", () => {
    handleGhNotAuth({
      repoRoot: repo,
      manualEntry: { kind: "gh-not-authenticated", body: "do the thing" },
      now: NOW,
    });
    const manual = readFileSync(join(repo, "MANUAL.md"), "utf8");
    expect(manual).toMatch(/^- \[ \] \*\*devx-init: gh-not-authenticated\*\*/m);
  });
});

// ---------------------------------------------------------------------------
// No-remote
// ---------------------------------------------------------------------------

describe("ini506 — handleNoRemote", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini506-noremote-");
    writeMinimalConfig(repo);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("forces promotion.gate=manual-only + flips flag + appends MANUAL", () => {
    const out = handleNoRemote({
      repoRoot: repo,
      manualEntry: { kind: "no-remote", body: "add origin then resume" },
      now: NOW,
    });
    expect(out).toEqual({
      manualAppended: true,
      flagFlipped: true,
      promotionGateForced: true,
    });

    const cfg = parseYaml(readFileSync(join(repo, "devx.config.yaml"), "utf8")) as {
      promotion: { gate: string };
      init_partial: boolean;
    };
    expect(cfg.promotion.gate).toBe("manual-only");
    expect(cfg.init_partial).toBe(true);

    const manual = readFileSync(join(repo, "MANUAL.md"), "utf8");
    expect(manual).toContain("devx-init: no-remote");
  });
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

describe("ini506 — replayPendingGhOps", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini506-replay-");
    writeMinimalConfig(repo);
    mkdirSync(join(repo, ".devx-cache"), { recursive: true });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  function writeQueue(ops: PendingGhOp[]): string {
    const path = join(repo, ".devx-cache", "pending-gh-ops.json");
    const file: PendingGhOpsFile = {
      version: 1,
      created: "2026-04-27T19:00:00.000Z",
      ops,
    };
    writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    return path;
  }

  it("returns empty result when queue file is absent", () => {
    const r = replayPendingGhOps({ repoRoot: repo, gh: scriptedGh([]).exec, git: okGit });
    expect(r).toEqual({ attempted: 0, results: [], allSucceeded: true, remaining: [] });
  });

  it("throws PendingGhOpsCorruptError on malformed JSON", () => {
    const path = join(repo, ".devx-cache", "pending-gh-ops.json");
    writeFileSync(path, "{ this is not valid");
    expect(() =>
      replayPendingGhOps({ repoRoot: repo, gh: scriptedGh([]).exec, git: okGit }),
    ).toThrow(PendingGhOpsCorruptError);
  });

  it("throws PendingGhOpsCorruptError on wrong-shape JSON (missing ops)", () => {
    const path = join(repo, ".devx-cache", "pending-gh-ops.json");
    writeFileSync(path, JSON.stringify({ version: 1, created: "x" }));
    expect(() =>
      replayPendingGhOps({ repoRoot: repo, gh: scriptedGh([]).exec, git: okGit }),
    ).toThrow(PendingGhOpsCorruptError);
  });

  it("create-develop-branch: gh 0 → success", () => {
    writeQueue([
      {
        kind: "create-develop-branch",
        payload: { from_sha: "abc123def456", branch: "develop", repo: "owner/repo" },
      },
    ]);
    const gh = scriptedGh([{ exitCode: 0, stdout: "{}", stderr: "" }]);
    const r = replayPendingGhOps({ repoRoot: repo, gh: gh.exec, git: okGit });
    expect(r.allSucceeded).toBe(true);
    expect(r.results[0].success).toBe(true);
    expect(gh.calls[0].args).toEqual([
      "api",
      "-X",
      "POST",
      "repos/owner/repo/git/refs",
      "-f",
      "ref=refs/heads/develop",
      "-f",
      "sha=abc123def456",
    ]);
  });

  it("create-develop-branch: HTTP 422 (already exists) → success", () => {
    writeQueue([{ kind: "create-develop-branch", payload: { from_sha: "abc123", repo: "o/r" } }]);
    const gh = scriptedGh([
      { exitCode: 1, stdout: "", stderr: "HTTP 422: Reference already exists" },
    ]);
    const r = replayPendingGhOps({ repoRoot: repo, gh: gh.exec, git: okGit });
    expect(r.allSucceeded).toBe(true);
    expect(r.results[0].note).toMatch(/already exists/);
  });

  it("create-develop-branch: missing slug + no remote → failure with hint", () => {
    writeQueue([{ kind: "create-develop-branch", payload: { from_sha: "abc123" } }]);
    const noRemoteGit: GitExec = (args) => {
      if (args[0] === "remote") return { exitCode: 1, stdout: "", stderr: "no remote" };
      return okGit(args, "");
    };
    const r = replayPendingGhOps({ repoRoot: repo, gh: scriptedGh([]).exec, git: noRemoteGit });
    expect(r.allSucceeded).toBe(false);
    expect(r.results[0].note).toMatch(/no GitHub remote/);
    expect(r.results[0].note).toMatch(/git remote add origin/);
  });

  it("set-default-branch + apply-protection + push-workflows in one queue, all green", () => {
    writeQueue([
      { kind: "create-develop-branch", payload: { from_sha: "abc", repo: "o/r" } },
      { kind: "set-default-branch", payload: { to: "develop", repo: "o/r" } },
      {
        kind: "apply-branch-protection",
        payload: {
          branch: "main",
          protection: { required_status_checks: { contexts: ["lint"] } },
          repo: "o/r",
        },
      },
      {
        kind: "push-workflows",
        payload: { paths: [".github/workflows/devx-ci.yml"] },
      },
    ]);
    const gh = scriptedGh([
      { exitCode: 0, stdout: "{}", stderr: "" }, // create-develop
      { exitCode: 0, stdout: "{}", stderr: "" }, // set-default
      { exitCode: 0, stdout: "{}", stderr: "" }, // protection PUT
      { exitCode: 0, stdout: "{}", stderr: "" }, // workflow contents probe
    ]);
    const r = replayPendingGhOps({ repoRoot: repo, gh: gh.exec, git: okGit });
    expect(r.allSucceeded).toBe(true);
    expect(r.results.map((x) => x.kind)).toEqual([
      "create-develop-branch",
      "set-default-branch",
      "apply-branch-protection",
      "push-workflows",
    ]);
  });

  it("apply-branch-protection: HTTP 403 → failure with scopes hint", () => {
    writeQueue([
      {
        kind: "apply-branch-protection",
        payload: {
          branch: "main",
          protection: { required_status_checks: { contexts: ["lint"] } },
          repo: "o/r",
        },
      },
    ]);
    const gh = scriptedGh([{ exitCode: 1, stdout: "", stderr: "HTTP 403: missing scope" }]);
    const r = replayPendingGhOps({ repoRoot: repo, gh: gh.exec, git: okGit });
    expect(r.allSucceeded).toBe(false);
    expect(r.results[0].note).toMatch(/missing scopes/);
    expect(r.results[0].note).toMatch(/gh auth refresh/);
  });

  it("push-workflows: per-segment path encoding preserves slashes (not %2F)", () => {
    writeQueue([
      {
        kind: "push-workflows",
        payload: { paths: [".github/workflows/devx-ci.yml"] },
      },
    ]);
    const gh = scriptedGh([{ exitCode: 0, stdout: "{}", stderr: "" }]);
    replayPendingGhOps({
      repoRoot: repo,
      gh: gh.exec,
      git: okGit,
      defaultBranch: "main",
    });
    // Slashes survive the encode; only the special chars in segments would be
    // %-encoded. None present here, so the URL is byte-equal to the raw path.
    const url = gh.calls[0].args[1];
    expect(url).toContain("/contents/.github/workflows/devx-ci.yml?ref=main");
    expect(url).not.toContain("%2F");
  });

  it("push-workflows: 404 on remote contents → failure with paths listed", () => {
    writeQueue([
      {
        kind: "push-workflows",
        payload: { paths: [".github/workflows/devx-ci.yml", ".github/workflows/devx-promotion.yml"] },
      },
    ]);
    const gh = scriptedGh([
      { exitCode: 1, stdout: "", stderr: "HTTP 404" }, // first missing
      { exitCode: 0, stdout: "{}", stderr: "" }, // second present
    ]);
    const r = replayPendingGhOps({
      repoRoot: repo,
      gh: gh.exec,
      git: okGit,
      defaultBranch: "main",
    });
    expect(r.allSucceeded).toBe(false);
    expect(r.results[0].note).toMatch(/devx-ci\.yml/);
    expect(r.results[0].note).not.toMatch(/devx-promotion\.yml.*missing/);
  });

  it("partial replay (one fail, one ok) returns remaining=[failed only]", () => {
    writeQueue([
      { kind: "create-develop-branch", payload: { from_sha: "a", repo: "o/r" } },
      { kind: "set-default-branch", payload: { to: "develop", repo: "o/r" } },
    ]);
    const gh = scriptedGh([
      { exitCode: 0, stdout: "{}", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "HTTP 500: server boom" },
    ]);
    const r = replayPendingGhOps({ repoRoot: repo, gh: gh.exec, git: okGit });
    expect(r.allSucceeded).toBe(false);
    expect(r.results.filter((x) => x.success).length).toBe(1);
    expect(r.remaining).toHaveLength(1);
    expect(r.remaining[0].kind).toBe("set-default-branch");
  });

  it("malformed op entry is dropped, not retried forever", () => {
    writeQueue([{ kind: "create-develop-branch", payload: { from_sha: "a", repo: "o/r" } }]);
    // Inject a garbage entry by hand-writing the file.
    const path = join(repo, ".devx-cache", "pending-gh-ops.json");
    const garbage: PendingGhOpsFile = {
      version: 1,
      created: "2026-04-27T19:00:00.000Z",
      ops: [
        // @ts-expect-error — intentional malformed shape for the test
        { kind: "create-develop-branch" }, // missing payload
        { kind: "create-develop-branch", payload: { from_sha: "b", repo: "o/r" } },
      ],
    };
    writeFileSync(path, JSON.stringify(garbage));
    const gh = scriptedGh([{ exitCode: 0, stdout: "{}", stderr: "" }]);
    const r = replayPendingGhOps({ repoRoot: repo, gh: gh.exec, git: okGit });
    // The valid op succeeded; the malformed one was logged but not retained.
    expect(r.results).toHaveLength(2);
    expect(r.results[0].success).toBe(false);
    expect(r.results[0].note).toMatch(/malformed/);
    expect(r.results[1].success).toBe(true);
    expect(r.remaining).toHaveLength(0);
  });
});

describe("ini506 — writeRemainingPendingOps", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini506-write-remaining-");
    mkdirSync(join(repo, ".devx-cache"), { recursive: true });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("clears the file (empty ops) when remaining is empty", () => {
    const path = join(repo, ".devx-cache", "pending-gh-ops.json");
    writeFileSync(
      path,
      JSON.stringify({ version: 1, created: "x", ops: [{ kind: "set-default-branch", payload: {} }] }),
    );
    writeRemainingPendingOps({ repoRoot: repo, remaining: [], now: NOW });
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.ops).toEqual([]);
  });

  it("writes only failed ops back to disk", () => {
    writeRemainingPendingOps({
      repoRoot: repo,
      remaining: [{ kind: "create-develop-branch", payload: { from_sha: "a" } }],
      now: NOW,
    });
    const path = join(repo, ".devx-cache", "pending-gh-ops.json");
    const after = JSON.parse(readFileSync(path, "utf8")) as PendingGhOpsFile;
    expect(after.ops).toHaveLength(1);
    expect(after.ops[0].kind).toBe("create-develop-branch");
    expect(after.created).toBe("2026-04-27T20:00:00.000Z");
  });

  it("preserves the original `created` timestamp across rewrites", () => {
    const path = join(repo, ".devx-cache", "pending-gh-ops.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        created: "2026-04-26T19:00:00.000Z",
        ops: [{ kind: "set-default-branch", payload: { to: "develop" } }],
      }),
    );
    writeRemainingPendingOps({
      repoRoot: repo,
      remaining: [{ kind: "set-default-branch", payload: { to: "develop" } }],
      now: NOW, // would write 2026-04-27 if we didn't preserve
    });
    const after = JSON.parse(readFileSync(path, "utf8")) as PendingGhOpsFile;
    expect(after.created).toBe("2026-04-26T19:00:00.000Z");
  });
});
