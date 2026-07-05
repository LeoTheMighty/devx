// CLI passthrough tests for `devx devx-helper await-remote-ci <branch>`
// (dvx105). Exercises the runAwaitRemoteCi function with seam-injected
// fs+exec+sleep so the CLI's exit-code + JSON-on-stdout contract is
// independently verified from the library tests.
//
// Mirrors devx-helper-cli.test.ts's seam-injection pattern.
//
// Spec: dev/dev-dvx105-2026-04-28T19:30-devx-await-remote-ci.md

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runAwaitRemoteCi } from "../src/commands/devx-helper.js";
import {
  type AwaitRemoteCiFs,
  type Exec,
  type ExecResult,
} from "../src/lib/devx/await-remote-ci.js";

const HEAD_SHA = "abcdef1234567890abcdef1234567890abcdef12";

interface CapturedIo {
  out: string;
  err: string;
}

function captureIo(): CapturedIo & {
  push: { out: (s: string) => void; err: (s: string) => void };
} {
  const buf: CapturedIo = { out: "", err: "" };
  return {
    get out() {
      return buf.out;
    },
    get err() {
      return buf.err;
    },
    push: {
      out: (s) => {
        buf.out += s;
      },
      err: (s) => {
        buf.err += s;
      },
    },
  };
}

const okExit = (stdout: string): ExecResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
});
const failExit = (stderr: string, exitCode = 1): ExecResult => ({
  stdout: "",
  stderr,
  exitCode,
});

function makeRun(
  overrides: Partial<{
    databaseId: number;
    status: string;
    conclusion: string | null;
    url: string;
    headSha: string;
    workflowName: string;
  }> = {},
): string {
  return JSON.stringify([
    {
      databaseId: overrides.databaseId ?? 7777,
      status: overrides.status ?? "completed",
      conclusion: overrides.conclusion ?? "success",
      url:
        overrides.url ?? "https://github.com/owner/repo/actions/runs/7777",
      headSha: overrides.headSha ?? HEAD_SHA,
      workflowName: overrides.workflowName ?? "devx-ci",
    },
  ]);
}

function fixtureFs(workflowsExist: boolean, repoRoot: string): AwaitRemoteCiFs {
  return {
    exists: (p) =>
      workflowsExist && p === join(repoRoot, ".github", "workflows"),
    readdir: () => (workflowsExist ? ["devx-ci.yml"] : []),
  };
}

function fakeExec(responses: Record<string, ExecResult | ExecResult[]>): Exec {
  const idx: Record<string, number> = {};
  return (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    const r = responses[key];
    if (Array.isArray(r)) {
      const i = idx[key] ?? 0;
      idx[key] = i + 1;
      if (!r[i]) {
        throw new Error(`fakeExec: out of responses for '${key}'`);
      }
      return r[i];
    }
    if (r) return r;
    throw new Error(`fakeExec: no response for '${key}'`);
  };
}

interface Fixture {
  dir: string;
}

let made: string[] = [];

function makeRepoFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-await-remote-ci-"));
  writeFileSync(join(dir, "devx.config.yaml"), "mode: YOLO\n");
  made.push(dir);
  return { dir };
}

afterEach(() => {
  for (const d of made) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
  made = [];
});

describe("runAwaitRemoteCi (CLI passthrough)", () => {
  const branch = "feat/dev-dvx105";
  const ghKey = `gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`;

  it("usage: emits 64 + stderr when no branch", async () => {
    const io = captureIo();
    const code = await runAwaitRemoteCi([], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: "/repo",
    });
    expect(code).toBe(64);
    expect(io.err).toMatch(/usage: devx devx-helper await-remote-ci/);
  });

  it("usage: rejects unknown flags", async () => {
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch, "--bogus"], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: "/repo",
    });
    expect(code).toBe(64);
    expect(io.err).toMatch(/unknown flag '--bogus'/);
  });

  it("usage: rejects empty branch string", async () => {
    const io = captureIo();
    const code = await runAwaitRemoteCi(["   "], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: "/repo",
    });
    expect(code).toBe(64);
    expect(io.err).toMatch(/branch must be non-empty/);
  });

  it("multi-probe: emits AwaitState JSON on completed", async () => {
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(true, fix.dir),
        exec: fakeExec({
          [ghKey]: okExit(
            makeRun({ status: "completed", conclusion: "success" }),
          ),
        }),
        sleep: async () => {},
        headSha: HEAD_SHA,
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out);
    expect(parsed).toMatchObject({ state: "completed", conclusion: "success" });
  });

  it("multi-probe: emits no-workflow when workflows missing", async () => {
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(false, fix.dir),
        exec: fakeExec({}),
        sleep: async () => {},
        headSha: HEAD_SHA,
      },
    });
    expect(code).toBe(0);
    expect(JSON.parse(io.out)).toEqual({ state: "no-workflow" });
  });

  it("multi-probe: emits workflow-no-run on double-empty", async () => {
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(true, fix.dir),
        exec: fakeExec({
          [ghKey]: [okExit("[]"), okExit("[]")],
        }),
        sleep: async () => {},
        emptyRetryMs: 60_000,
        headSha: HEAD_SHA,
      },
    });
    expect(code).toBe(0);
    expect(JSON.parse(io.out)).toEqual({
      state: "workflow-no-run",
      reason: "no-runs",
    });
  });

  it("--once: emits ProbeState (in-progress passthrough)", async () => {
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch, "--once"], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(true, fix.dir),
        exec: fakeExec({
          [ghKey]: okExit(makeRun({ status: "in_progress" })),
        }),
        sleep: async () => {},
        headSha: HEAD_SHA,
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out);
    expect(parsed.state).toBe("in-progress");
    expect(parsed.runId).toBe(7777);
  });

  it("--once: accepts flag in either position", async () => {
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi(["--once", branch], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(true, fix.dir),
        exec: fakeExec({
          [ghKey]: okExit("[]"),
        }),
        sleep: async () => {},
        headSha: HEAD_SHA,
      },
    });
    expect(code).toBe(0);
    expect(JSON.parse(io.out)).toEqual({ state: "empty" });
  });

  it("gh failure: exits 2 with {error,stage} JSON + stderr detail", async () => {
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(true, fix.dir),
        exec: fakeExec({
          [ghKey]: failExit("gh: not authenticated", 4),
        }),
        sleep: async () => {},
        headSha: HEAD_SHA,
      },
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(io.out);
    expect(parsed).toEqual({ error: "probe-failed", stage: "gh-run-list" });
    expect(io.err).toMatch(/gh exited 4/);
  });

  it("git rev-parse failure: exits 2 with stage 'git-rev-parse'", async () => {
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(true, fix.dir),
        exec: fakeExec({
          [ghKey]: okExit(makeRun()),
          [`git rev-parse ${branch}`]: failExit(
            "fatal: not a git repository",
            128,
          ),
        }),
        sleep: async () => {},
        // headSha intentionally NOT supplied → driver invokes git
      },
    });
    expect(code).toBe(2);
    expect(JSON.parse(io.out)).toEqual({
      error: "probe-failed",
      stage: "git-rev-parse",
    });
  });

  it("non-GhProbeError throw: exits 2 with stage 'unknown'", async () => {
    // The catch-all branch in runAwaitRemoteCi handles non-GhProbeError
    // throws (e.g., a TypeError from a malformed seam, or the headSha
    // validation Error). It maps them to stage='unknown' — documented
    // both in devx-helper.ts header and .claude/commands/devx.md Phase 7.
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(true, fix.dir),
        exec: fakeExec({}),
        sleep: async () => {},
        // Non-40-hex headSha → driver throws plain Error (not GhProbeError) →
        // catch-all maps to stage='unknown'.
        headSha: "NOT-A-SHA",
      },
    });
    expect(code).toBe(2);
    expect(JSON.parse(io.out)).toEqual({
      error: "probe-failed",
      stage: "unknown",
    });
    expect(io.err).toMatch(/40-char lowercase hex/);
  });

  it("malformed gh JSON: exits 2 with stage 'gh-parse'", async () => {
    const fix = makeRepoFixture();
    const io = captureIo();
    const code = await runAwaitRemoteCi([branch], {
      out: io.push.out,
      err: io.push.err,
      repoRoot: fix.dir,
      awaitOpts: {
        fs: fixtureFs(true, fix.dir),
        exec: fakeExec({
          [ghKey]: okExit("not json{"),
        }),
        sleep: async () => {},
        headSha: HEAD_SHA,
      },
    });
    expect(code).toBe(2);
    expect(JSON.parse(io.out)).toEqual({
      error: "probe-failed",
      stage: "gh-parse",
    });
  });
});
