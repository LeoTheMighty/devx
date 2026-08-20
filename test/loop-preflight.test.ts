// lpf101 — loop preflight main-health check.
//
// Unit tests for the probe (fake exec/fs seams) + driver integration on a
// real git fixture (bare origin + clone, same pattern as loop-driver.test.ts):
// red-main refusal, forced-start baseline threading into prompts and the
// morning report, probe-failure passthrough, and the `off` knob.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loopConfigFrom } from "../src/lib/loop/config.js";
import { runLoop } from "../src/lib/loop/driver.js";
import { realExec, type Exec } from "../src/lib/loop/git-tx.js";
import {
  baseBranchFrom,
  baselineLine,
  describeMainHealth,
  probeMainHealth,
  type MainHealth,
} from "../src/lib/loop/preflight.js";
import { readLoopState } from "../src/lib/loop/state.js";
import { type WorkerRunFn } from "../src/lib/loop/worker.js";
import { type TailFn } from "../src/lib/loop/tail.js";
import { GIT } from "./helpers/git-bin.js";

// ---------------------------------------------------------------------------
// Probe units
// ---------------------------------------------------------------------------

interface FakeRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  url: string;
  headSha: string;
  workflowName: string;
}

const sha = (c: string): string => c.repeat(40);

function run(partial: Partial<FakeRun>): FakeRun {
  return {
    databaseId: 1,
    status: "completed",
    conclusion: "success",
    url: "https://github.com/x/y/actions/runs/1",
    headSha: sha("a"),
    workflowName: "ci",
    ...partial,
  };
}

/** exec seam that answers `gh run list` with the given payload. */
function ghExec(payload: { exitCode?: number; stdout?: string; stderr?: string }): {
  exec: Exec;
  calls: string[][];
} {
  const calls: string[][] = [];
  const exec: Exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd !== "gh") throw new Error(`unexpected exec: ${cmd}`);
    return {
      exitCode: payload.exitCode ?? 0,
      stdout: payload.stdout ?? "[]",
      stderr: payload.stderr ?? "",
    };
  };
  return { exec, calls };
}

const WITH_WORKFLOWS = {
  exists: () => true,
  readdir: () => ["ci.yml"],
};

describe("probeMainHealth", () => {
  it("no workflow files → no-workflow, gh never called", () => {
    const { exec, calls } = ghExec({});
    const h = probeMainHealth(
      { exec, repoRoot: "/r", exists: () => false, readdir: () => [] },
      "main",
    );
    expect(h.state).toBe("no-workflow");
    expect(calls).toHaveLength(0);
  });

  it("gh failure → unknown with stderr detail (uncertainty never blocks)", () => {
    const { exec } = ghExec({ exitCode: 4, stderr: "HTTP 502\n" });
    const h = probeMainHealth({ exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main");
    expect(h.state).toBe("unknown");
    expect(h.detail).toContain("HTTP 502");
  });

  it("malformed gh JSON → unknown", () => {
    const { exec } = ghExec({ stdout: "not json" });
    const h = probeMainHealth({ exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main");
    expect(h.state).toBe("unknown");
  });

  it("empty run list → unknown", () => {
    const { exec } = ghExec({ stdout: "[]" });
    const h = probeMainHealth({ exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main");
    expect(h.state).toBe("unknown");
    expect(h.detail).toContain("no workflow runs");
  });

  it("newest run red → red with the failing run's identity", () => {
    const { exec } = ghExec({
      stdout: JSON.stringify([
        run({ databaseId: 9, conclusion: "failure", workflowName: "CI & Deploy", headSha: sha("b") }),
      ]),
    });
    const h = probeMainHealth({ exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main");
    expect(h.state).toBe("red");
    expect(h.failing?.workflowName).toBe("CI & Deploy");
    expect(h.failing?.headSha).toBe(sha("b"));
  });

  it("green sibling workflow does NOT shadow a red one (the arci1 blind spot)", () => {
    const { exec } = ghExec({
      stdout: JSON.stringify([
        run({ databaseId: 2, conclusion: "success", workflowName: "lint" }),
        run({ databaseId: 1, conclusion: "failure", workflowName: "test" }),
      ]),
    });
    const h = probeMainHealth({ exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main");
    expect(h.state).toBe("red");
    expect(h.failing?.workflowName).toBe("test");
  });

  it("a workflow's own newer green forgives its older red", () => {
    const { exec } = ghExec({
      stdout: JSON.stringify([
        run({ databaseId: 2, conclusion: "success", workflowName: "ci" }),
        run({ databaseId: 1, conclusion: "failure", workflowName: "ci" }),
      ]),
    });
    const h = probeMainHealth({ exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main");
    expect(h.state).toBe("green");
  });

  it("everything in flight → unknown; cancelled proves nothing", () => {
    const inFlight = ghExec({
      stdout: JSON.stringify([run({ status: "in_progress", conclusion: null })]),
    });
    expect(
      probeMainHealth({ exec: inFlight.exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main").state,
    ).toBe("unknown");

    const cancelled = ghExec({
      stdout: JSON.stringify([
        run({ conclusion: "cancelled", workflowName: "ci" }),
        run({ conclusion: "success", workflowName: "lint" }),
      ]),
    });
    expect(
      probeMainHealth({ exec: cancelled.exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main").state,
    ).toBe("green");
  });

  it("timed_out / startup_failure / action_required all count as red", () => {
    for (const conclusion of ["timed_out", "startup_failure", "action_required"]) {
      const { exec } = ghExec({ stdout: JSON.stringify([run({ conclusion })]) });
      expect(probeMainHealth({ exec, repoRoot: "/r", ...WITH_WORKFLOWS }, "main").state).toBe("red");
    }
  });
});

describe("baseBranchFrom / baselineLine / describeMainHealth", () => {
  it("integration_branch wins over default_branch; fallback main", () => {
    expect(baseBranchFrom({ git: { integration_branch: "develop", default_branch: "main" } })).toBe(
      "develop",
    );
    expect(baseBranchFrom({ git: { integration_branch: null, default_branch: "trunk" } })).toBe(
      "trunk",
    );
    expect(baseBranchFrom({})).toBe("main");
    expect(baseBranchFrom(null)).toBe("main");
  });

  it("baselineLine renders sha7 + workflow for red, null otherwise", () => {
    const red: MainHealth = {
      state: "red",
      branch: "main",
      failing: {
        workflowName: "test",
        conclusion: "failure",
        headSha: sha("c"),
        url: "u",
        databaseId: 1,
      },
    };
    const line = baselineLine(red);
    expect(line).toContain(sha("c").slice(0, 7));
    expect(line).toContain("treat this failure as baseline");
    expect(baselineLine({ state: "green", branch: "main" })).toBeNull();
    expect(baselineLine({ state: "unknown", branch: "main" })).toBeNull();
  });

  it("describeMainHealth covers all states", () => {
    expect(
      describeMainHealth({
        state: "red",
        branch: "main",
        failing: { workflowName: "t", conclusion: "failure", headSha: sha("d"), url: "u", databaseId: 1 },
      }),
    ).toContain("RED");
    expect(describeMainHealth({ state: "green", branch: "main" })).toBe("green");
    expect(describeMainHealth({ state: "unknown", branch: "main", detail: "d" })).toContain("d");
    expect(describeMainHealth({ state: "no-workflow", branch: "main", detail: "n" })).toContain("n");
  });
});

describe("loopConfigFrom preflight knob", () => {
  it("defaults to refuse; accepts refuse|warn|off; garbage falls back", () => {
    expect(loopConfigFrom({}).preflightMainHealth).toBe("refuse");
    expect(loopConfigFrom({ loop: { preflight_main_health: "warn" } }).preflightMainHealth).toBe(
      "warn",
    );
    expect(loopConfigFrom({ loop: { preflight_main_health: "OFF" } }).preflightMainHealth).toBe(
      "off",
    );
    expect(loopConfigFrom({ loop: { preflight_main_health: "yolo" } }).preflightMainHealth).toBe(
      "refuse",
    );
    expect(loopConfigFrom({ loop: { preflight_main_health: 7 } }).preflightMainHealth).toBe(
      "refuse",
    );
  });
});

// ---------------------------------------------------------------------------
// Driver integration (real git fixture)
// ---------------------------------------------------------------------------

function g(cwd: string, ...args: string[]): string {
  return execFileSync(GIT, args, { cwd, encoding: "utf8" }).trim();
}

interface Fixture {
  base: string;
  repoRoot: string;
  cacheDir: string;
}

function makeFixture(hash: string): Fixture {
  const base = mkdtempSync(join(tmpdir(), "devx-loop-preflight-"));
  const origin = join(base, "origin.git");
  const repoRoot = join(base, "repo");
  execFileSync(GIT, ["init", "--bare", "-q", "-b", "main", origin], { encoding: "utf8" });
  execFileSync(GIT, ["clone", "-q", origin, repoRoot], { encoding: "utf8" });
  g(repoRoot, "config", "user.email", "loop@test");
  g(repoRoot, "config", "user.name", "loop");
  g(repoRoot, "config", "commit.gpgsign", "false");
  const rel = `dev/dev-${hash}-2026-07-26T15:00-item-${hash}.md`;
  mkdirSync(join(repoRoot, "dev"), { recursive: true });
  writeFileSync(
    join(repoRoot, rel),
    [
      "---",
      `hash: ${hash}`,
      "type: dev",
      "created: 2026-07-26T15:00:00-06:00",
      `title: Item ${hash}`,
      "status: ready",
      "---",
      "",
      "## Goal",
      "",
      "Do the thing.",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] the thing works",
      "",
      "## Status log",
      "",
      "- 2026-07-26T15:00 — created.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(repoRoot, "DEV.md"),
    `# DEV — backlog\n\n- [ ] \`${rel}\` — Item ${hash}. Status: ready.\n`,
    "utf8",
  );
  writeFileSync(join(repoRoot, ".gitignore"), ".devx-cache/\n.worktrees/\n", "utf8");
  g(repoRoot, "add", "-A");
  g(repoRoot, "commit", "-q", "-m", "fixture base");
  g(repoRoot, "push", "-q", "-u", "origin", "main");
  // Workflow file on disk (untracked is fine — the probe reads the fs) so
  // the preflight engages.
  mkdirSync(join(repoRoot, ".github", "workflows"), { recursive: true });
  writeFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "name: ci\n", "utf8");
  return { base, repoRoot, cacheDir: join(repoRoot, ".devx-cache") };
}

const MERGED = {
  mode: "YOLO",
  git: { default_branch: "main", integration_branch: null, branch_prefix: "feat/" },
  loop: {
    max_iterations_per_item: 2,
    max_tokens_per_item: 1_000_000,
    max_consecutive_failures: 3,
    max_items: 2,
    max_total_tokens: 1_000_000,
    backoff_ms: [1],
  },
};

/** exec that answers `gh run list` from a script and delegates git to the
 *  real exec (the claim + worktree machinery needs real git). */
function splitExec(gh: (args: string[]) => { exitCode: number; stdout: string; stderr: string }): {
  exec: Exec;
  ghCalls: string[][];
} {
  const ghCalls: string[][] = [];
  const exec: Exec = (cmd, args, o) => {
    if (cmd === "gh") {
      ghCalls.push(args);
      return gh(args);
    }
    return realExec(cmd, args, o);
  };
  return { exec, ghCalls };
}

function acsMetWorker(): { worker: WorkerRunFn; prompts: string[] } {
  const prompts: string[] = [];
  const worker: WorkerRunFn = async (prompt, opts) => {
    prompts.push(prompt);
    writeFileSync(join(opts.cwd, "out.txt"), "done\n", "utf8");
    const report = {
      success: true,
      summary: "did the thing",
      key_changes_made: ["out.txt"],
      key_learnings: [],
      acs_met: true,
    };
    return {
      rawOutput: `ok\n\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n`,
      exitCode: 0,
      graceKilled: false,
      tokens: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0, estimated: true },
    };
  };
  return { worker, prompts };
}

const mergedTail: TailFn = async () => ({
  outcome: "merged",
  prUrl: "https://github.com/x/y/pull/7",
  prNumber: 7,
});

const RED_PAYLOAD = JSON.stringify([
  {
    databaseId: 42,
    status: "completed",
    conclusion: "failure",
    url: "https://github.com/x/y/actions/runs/42",
    headSha: sha("e"),
    workflowName: "CI & Deploy",
  },
]);

let fixture: Fixture | null = null;
afterEach(() => {
  if (fixture) rmSync(fixture.base, {
      recursive: true,
      force: true,
      // Belt-and-braces against the ENOTEMPTY teardown race; makeFixture
      // disables the auto-gc that caused it, this survives anything else
      // that writes into the fixture as it is being torn down.
      maxRetries: 10,
      retryDelay: 50,
    });
  fixture = null;
});

describe("runLoop preflight (lpf101)", () => {
  it("red main + default posture → exit 5, nothing claimed, no state", async () => {
    fixture = makeFixture("aaa111");
    const { exec, ghCalls } = splitExec(() => ({ exitCode: 0, stdout: RED_PAYLOAD, stderr: "" }));
    const lines: string[] = [];
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      exec,
      out: (l) => lines.push(l),
      heartbeatIntervalMs: 3_600_000,
    });
    expect(r.exitCode).toBe(5);
    expect(r.refusedReason).toContain("CI & Deploy");
    expect(r.refusedReason).toContain(sha("e").slice(0, 7));
    expect(ghCalls).toHaveLength(1);
    expect(readLoopState(fixture.cacheDir)).toBeNull();
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain("- [ ] `dev/dev-aaa111");
  });

  it("red main + --force → runs; baseline threaded into every prompt and the report", async () => {
    fixture = makeFixture("bbb222");
    const { exec } = splitExec(() => ({ exitCode: 0, stdout: RED_PAYLOAD, stderr: "" }));
    const { worker, prompts } = acsMetWorker();
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      exec,
      worker,
      tail: mergedTail,
      flags: { force: true },
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
    });
    expect(r.exitCode).toBe(0);
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p).toContain("## Baseline warning");
      expect(p).toContain("CI & Deploy");
      expect(p).toContain("treat this failure as baseline");
    }
    expect(r.summary?.mainHealth?.state).toBe("red");
    expect(r.summary?.mainHealth?.forced).toBe(true);
    expect(r.reportPath).not.toBeNull();
    const report = readFileSync(r.reportPath!, "utf8");
    expect(report).toContain("RED at loop start");
    expect(report).toContain("CI & Deploy");
  });

  it("config posture 'warn' behaves like --force without the flag", async () => {
    fixture = makeFixture("ccc333");
    const { exec } = splitExec(() => ({ exitCode: 0, stdout: RED_PAYLOAD, stderr: "" }));
    const { worker, prompts } = acsMetWorker();
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: { ...MERGED, loop: { ...MERGED.loop, preflight_main_health: "warn" } },
      exec,
      worker,
      tail: mergedTail,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
    });
    expect(r.exitCode).toBe(0);
    expect(prompts[0]).toContain("## Baseline warning");
  });

  it("probe failure → run proceeds and the report records the unknown state", async () => {
    fixture = makeFixture("ddd444");
    const { exec } = splitExec(() => ({ exitCode: 4, stdout: "", stderr: "api.github.com down" }));
    const { worker, prompts } = acsMetWorker();
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      exec,
      worker,
      tail: mergedTail,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
    });
    expect(r.exitCode).toBe(0);
    expect(prompts[0]).not.toContain("## Baseline warning");
    expect(r.summary?.mainHealth?.state).toBe("unknown");
    const report = readFileSync(r.reportPath!, "utf8");
    expect(report).toContain("Main-health probe inconclusive");
  });

  it("preflight_main_health: off → gh probe never runs", async () => {
    fixture = makeFixture("eee555");
    const { exec, ghCalls } = splitExec(() => {
      throw new Error("gh must not be called");
    });
    const { worker } = acsMetWorker();
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: { ...MERGED, loop: { ...MERGED.loop, preflight_main_health: "off" } },
      exec,
      worker,
      tail: mergedTail,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
    });
    expect(r.exitCode).toBe(0);
    expect(ghCalls).toHaveLength(0);
    expect(r.summary?.mainHealth).toBeUndefined();
  });

  it("--dry-run with red main prints the would-refuse note and exits 0", async () => {
    fixture = makeFixture("fff666");
    const { exec } = splitExec(() => ({ exitCode: 0, stdout: RED_PAYLOAD, stderr: "" }));
    const lines: string[] = [];
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      exec,
      flags: { dryRun: true },
      out: (l) => lines.push(l),
      heartbeatIntervalMs: 3_600_000,
    });
    expect(r.exitCode).toBe(0);
    const outText = lines.join("\n");
    expect(outText).toContain("main health ('main'): RED");
    expect(outText).toContain("a real run would REFUSE");
    expect(readLoopState(fixture.cacheDir)).toBeNull();
  });
});
