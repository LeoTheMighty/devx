// Transient-gh-failure retry tests (debug-d7e8e5).
//
// The bug: GitHub's GraphQL endpoint served "HTTP 401: Requires
// authentication" for ~half of all calls over a ~15-minute window on
// 2026-08-05 while the token was valid. Every gh consumer in the merge tail
// treated the first non-zero exit as terminal, so `devx devx-helper
// check-hold` and `devx merge-gate` both exited 2 on a PR that was green and
// mergeable — attended, a human retry loop; unattended, a stranded PR.
//
// Three layers under test:
//   1. The classifier + idempotence guard (transient vs terminal; read vs
//      mutation) — the two independent predicates that gate a retry.
//   2. The `withGhRetry` wrapper itself (attempt count, backoff shape,
//      pass-through cases).
//   3. The consumers, end to end: the SAME flaky exec that makes
//      checkHold throw / runMergeGate exit 2 with `retry: false` (the
//      pre-fix behavior, AC 1) now succeeds through the shipped default.
//
// Spec: debug/debug-d7e8e5-2026-08-05T12:20-gh-transient-401-merge-tail.md

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../src/lib/exec.js";
import {
  DEFAULT_ATTEMPTS,
  classifyGhFailure,
  isRetryableGhInvocation,
  withGhRetry,
} from "../src/lib/gh-retry.js";
import { HoldCheckError, checkHold } from "../src/lib/devx/hold-check.js";
import { runMergeGate } from "../src/commands/merge-gate.js";

/** The exact stderr `gh` printed during the 2026-08-05 outage. */
const GRAPHQL_401 =
  "HTTP 401: Requires authentication (https://api.github.com/graphql)";

const res = (over: Partial<ExecResult> = {}): ExecResult => ({
  stdout: "",
  stderr: "",
  exitCode: 0,
  ...over,
});

/**
 * An exec that fails `failures` times with `stderr`, then succeeds with
 * `stdout`. Records every invocation so tests can assert the call count.
 */
function flakyExec(
  failures: number,
  stdout: string,
  stderr = GRAPHQL_401,
): { exec: Exec; calls: { cmd: string; args: string[] }[] } {
  const calls: { cmd: string; args: string[] }[] = [];
  let seen = 0;
  const exec: Exec = (cmd, args) => {
    calls.push({ cmd, args });
    seen++;
    return seen <= failures
      ? res({ exitCode: 1, stderr })
      : res({ stdout });
  };
  return { exec, calls };
}

const noSleep = () => {};

describe("classifyGhFailure", () => {
  it("treats the observed GraphQL 401 as transient", () => {
    expect(classifyGhFailure(res({ exitCode: 1, stderr: GRAPHQL_401 }))).toBe(
      "transient",
    );
  });

  it("treats 5xx, 429 and network/DNS/TLS errors as transient", () => {
    const transient = [
      "HTTP 502: Bad gateway",
      "HTTP 500: Internal Server Error",
      "HTTP 503",
      "HTTP 429: too many requests",
      "dial tcp: lookup api.github.com: EAI_AGAIN",
      "read tcp 10.0.0.1:443: ECONNRESET",
      "net/http: TLS handshake timeout",
      "Post https://api.github.com/graphql: i/o timeout",
      "error: connection reset by peer",
      "GraphQL: Something went wrong while executing your query. "
        + "This may be the result of a timeout, or it could be a GitHub bug.",
    ];
    for (const stderr of transient) {
      expect(classifyGhFailure(res({ exitCode: 1, stderr })), stderr).toBe(
        "transient",
      );
    }
  });

  it("classifies the API error when gh prints it on stdout", () => {
    expect(classifyGhFailure(res({ exitCode: 1, stdout: GRAPHQL_401 }))).toBe(
      "transient",
    );
  });

  it("treats real failures as terminal", () => {
    const terminal = [
      "HTTP 404: Not Found",
      "HTTP 403: Resource not accessible by integration",
      "GraphQL: Could not resolve to a PullRequest with the number of 999",
      "unknown flag: --jsonn",
      "no pull requests found for branch",
      "",
    ];
    for (const stderr of terminal) {
      expect(classifyGhFailure(res({ exitCode: 1, stderr })), stderr).toBe(
        "terminal",
      );
    }
  });

  it("never retries a spawn failure (exit 127 — gh not installed)", () => {
    // The message would otherwise be irrelevant; the exit code decides.
    expect(
      classifyGhFailure(
        res({ exitCode: 127, stderr: "spawnSync gh ENOENT HTTP 503" }),
      ),
    ).toBe("terminal");
  });

  it("reports success as ok", () => {
    expect(classifyGhFailure(res({ stdout: "{}" }))).toBe("ok");
  });
});

describe("isRetryableGhInvocation", () => {
  it("accepts read-only gh subcommands", () => {
    expect(isRetryableGhInvocation("gh", ["pr", "view", "117", "--json", "comments"])).toBe(true);
    expect(isRetryableGhInvocation("gh", ["pr", "list", "--head", "feat/x"])).toBe(true);
    expect(isRetryableGhInvocation("gh", ["run", "list", "--limit", "20"])).toBe(true);
    expect(isRetryableGhInvocation("gh", ["pr", "checks", "117"])).toBe(true);
  });

  it("skips flags when locating the subcommand", () => {
    expect(isRetryableGhInvocation("gh", ["--repo", "o/r", "pr", "view", "3"])).toBe(true);
  });

  it("refuses every mutation — a retry could double-fire it", () => {
    const mutations = [
      ["pr", "merge", "117", "--squash"],
      ["pr", "create", "--title", "x"],
      ["pr", "comment", "117", "--body", "hi"],
      ["pr", "close", "117"],
      ["pr", "edit", "117"],
      ["pr", "review", "117"],
      ["run", "rerun", "5"],
      ["issue", "create"],
    ];
    for (const args of mutations) {
      expect(isRetryableGhInvocation("gh", args), args.join(" ")).toBe(false);
    }
  });

  it("refuses gh api (one verb covers GET and POST) and non-gh commands", () => {
    expect(isRetryableGhInvocation("gh", ["api", "graphql", "-f", "query=x"])).toBe(false);
    expect(isRetryableGhInvocation("git", ["push"])).toBe(false);
    expect(isRetryableGhInvocation("git", ["pr", "view"])).toBe(false);
  });

  it("recognizes gh behind an absolute path or a .exe suffix", () => {
    expect(isRetryableGhInvocation("/opt/homebrew/bin/gh", ["pr", "view", "1"])).toBe(true);
    expect(
      isRetryableGhInvocation("C:\\hostedtoolcache\\gh\\gh.exe", ["pr", "view", "1"]),
    ).toBe(true);
    expect(isRetryableGhInvocation("/usr/bin/github", ["pr", "view", "1"])).toBe(false);
  });

  it("refuses an invocation with no subcommand", () => {
    expect(isRetryableGhInvocation("gh", ["pr"])).toBe(false);
    expect(isRetryableGhInvocation("gh", [])).toBe(false);
  });

  it("stops the scan at a `--` operand terminator", () => {
    expect(isRetryableGhInvocation("gh", ["--", "pr", "view"])).toBe(false);
  });
});

describe("withGhRetry", () => {
  it("recovers from a single transient 401 and returns the success", () => {
    const { exec, calls } = flakyExec(1, '{"comments":[]}');
    const wrapped = withGhRetry(exec, { sleep: noSleep });
    const r = wrapped("gh", ["pr", "view", "117", "--json", "comments"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"comments":[]}');
    expect(calls).toHaveLength(2);
  });

  it("gives up after the attempt budget and returns the last failure", () => {
    const { exec, calls } = flakyExec(99, "never");
    const wrapped = withGhRetry(exec, { sleep: noSleep });
    const r = wrapped("gh", ["pr", "list", "--head", "feat/x"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe(GRAPHQL_401);
    expect(calls).toHaveLength(DEFAULT_ATTEMPTS);
  });

  it("backs off exponentially and reports each retry", () => {
    const slept: number[] = [];
    const retried: number[] = [];
    const { exec } = flakyExec(99, "never");
    const wrapped = withGhRetry(exec, {
      attempts: 4,
      baseDelayMs: 100,
      factor: 3,
      sleep: (ms) => slept.push(ms),
      onRetry: (info) => retried.push(info.attempt),
    });
    wrapped("gh", ["pr", "view", "117"]);
    expect(slept).toEqual([100, 300, 900]);
    expect(retried).toEqual([1, 2, 3]);
  });

  it("passes through successes, terminal failures, mutations and git", () => {
    for (const [cmd, args, result] of [
      ["gh", ["pr", "view", "1"], res({ stdout: "{}" })],
      ["gh", ["pr", "view", "1"], res({ exitCode: 1, stderr: "HTTP 404" })],
      ["gh", ["pr", "merge", "1"], res({ exitCode: 1, stderr: GRAPHQL_401 })],
      ["git", ["push"], res({ exitCode: 1, stderr: GRAPHQL_401 })],
    ] as [string, string[], ExecResult][]) {
      let n = 0;
      const wrapped = withGhRetry(
        () => {
          n++;
          return result;
        },
        { sleep: noSleep },
      );
      expect(wrapped(cmd, args), `${cmd} ${args.join(" ")}`).toEqual(result);
      expect(n, `${cmd} ${args.join(" ")}`).toBe(1);
    }
  });

  it("forwards cwd/env opts unchanged on every attempt", () => {
    const seen: (Record<string, unknown> | undefined)[] = [];
    const { exec } = flakyExec(1, "{}");
    const wrapped = withGhRetry(
      (cmd, args, o) => {
        seen.push(o);
        return exec(cmd, args, o);
      },
      { sleep: noSleep },
    );
    wrapped("gh", ["pr", "view", "1"], { cwd: "/tmp/repo" });
    expect(seen).toEqual([{ cwd: "/tmp/repo" }, { cwd: "/tmp/repo" }]);
  });

  it("attempts: 1 disables retry entirely", () => {
    const { exec, calls } = flakyExec(1, "{}");
    withGhRetry(exec, { attempts: 1, sleep: noSleep })("gh", ["pr", "view", "1"]);
    expect(calls).toHaveLength(1);
  });
});

describe("checkHold under a transient 401", () => {
  const REPO = "/tmp/fake-repo";
  const payload = JSON.stringify({ comments: [], reviews: [] });

  it("AC 1 repro: a single 401 is terminal without the retry layer", () => {
    const { exec, calls } = flakyExec(1, payload);
    expect(() => checkHold(117, { repoRoot: REPO, exec, retry: false })).toThrow(
      HoldCheckError,
    );
    expect(calls).toHaveLength(1);
  });

  it("rides out the flake with the shipped default", () => {
    const { exec, calls } = flakyExec(1, payload);
    const result = checkHold(117, {
      repoRoot: REPO,
      exec,
      retry: { sleep: noSleep },
    });
    expect(result).toEqual({ hold: false });
    expect(calls).toHaveLength(2);
  });

  it("still reports a sustained outage rather than looping forever", () => {
    const { exec, calls } = flakyExec(99, payload);
    expect(() =>
      checkHold(117, { repoRoot: REPO, exec, retry: { sleep: noSleep } }),
    ).toThrow(HoldCheckError);
    expect(calls).toHaveLength(DEFAULT_ATTEMPTS);
  });

  it("does not retry a terminal failure", () => {
    const { exec, calls } = flakyExec(1, payload, "HTTP 404: Not Found");
    expect(() =>
      checkHold(117, { repoRoot: REPO, exec, retry: { sleep: noSleep } }),
    ).toThrow(HoldCheckError);
    expect(calls).toHaveLength(1);
  });
});

describe("devx merge-gate under a transient 401", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  function fixture(): string {
    const dir = mkdtempSync(join(tmpdir(), "devx-gh-retry-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "devx.config.yaml"),
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
        "  branch_prefix: feat/",
        "",
      ].join("\n"),
    );
    mkdirSync(join(dir, "dev"), { recursive: true });
    writeFileSync(
      join(dir, "dev", "dev-flk101-2026-08-05T12:20-fixture.md"),
      [
        "---",
        "hash: flk101",
        "type: dev",
        "title: transient-401 fixture",
        "status: in-progress",
        "branch: feat/dev-flk101",
        "pr: 117",
        "---",
        "",
        "## Goal",
        "",
        "fixture",
        "",
      ].join("\n"),
    );
    return dir;
  }

  /** `gh pr view --json statusCheckRollup,reviews` on a green, unreviewed PR. */
  const GREEN = JSON.stringify({
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "devx-ci" }],
    reviews: [],
  });

  function run(dir: string, retry: false | { sleep: () => void }) {
    const { exec, calls } = flakyExec(1, GREEN);
    let stdout = "";
    const code = runMergeGate(
      ["flk101"],
      {},
      {
        projectPath: join(dir, "devx.config.yaml"),
        out: (s) => {
          stdout += s;
        },
        err: () => {},
        exec,
        retry,
      },
    );
    return { code, stdout, calls };
  }

  it("AC 1 repro: exits 2 'gh signal collection failed' without the retry layer", () => {
    const { code, stdout, calls } = run(fixture(), false);
    expect(code).toBe(2);
    expect(JSON.parse(stdout)).toEqual({
      merge: false,
      reason: "gh signal collection failed",
    });
    expect(calls).toHaveLength(1);
  });

  it("merges through the flake with the shipped default", () => {
    const { code, stdout, calls } = run(fixture(), { sleep: noSleep });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ merge: true });
    expect(calls).toHaveLength(2);
  });
});
