// Regression tests for debug-1dfbdd: merge-gate accepted ANY non-null string
// as a branch name.
//
// palateful's `lgort1` carried `branch: unassigned`. The gate queried
// `gh pr list --head unassigned`, got `[]`, and reported `{"merge":false,
// "reason":"no PR yet"}` — exit 2, forever — while PR #27 sat green and
// MERGEABLE on `feat/debug-lgort1`, the branch `deriveBranch` produces.
//
// That is debug-7b3e2a one sentinel later. The fix is NOT to add
// "unassigned" to NULLISH_SCALARS (see frontmatter-scalar.test.ts); it is to
// stop asking "is this null" and start asking "does this branch exist".
//
// What these tests pin is the DISCRIMINATION: `[]` used to mean three things
// and say one. Each state below must produce its own distinguishable answer,
// and "could not verify" must never masquerade as "absent".
//
// Spec: debug/debug-1dfbdd-2026-09-20T10:25-merge-gate-accepts-any-string-as-branch.md

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type ExecResult, runMergeGate } from "../src/commands/merge-gate.js";

function makeFixture(hash: string, branchLine: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "devx-mg-branch-validation-"));
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
      "  branch_prefix: feat/",
      "",
    ].join("\n"),
  );
  const specDir = join(dir, "debug");
  mkdirSync(specDir, { recursive: true });
  const fm = ["---", `hash: ${hash}`, "type: debug", "title: branch validation fixture"];
  if (branchLine !== null) fm.push(branchLine);
  fm.push("---", "", "## Goal", "", "fixture", "");
  writeFileSync(join(specDir, `debug-${hash}-2026-09-20T10:25-fixture.md`), fm.join("\n"));
  return { configPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

interface Opts {
  /** PRs the `gh pr list` stub returns. */
  prNumber: number | null;
  /** Branch names that "exist" remotely; `"FAIL"` makes ls-remote error. */
  remote: string[] | "FAIL";
  /** Branch names that exist locally. */
  local?: string[];
}

interface RunResult {
  code: number;
  decision: { merge: boolean; reason?: string } | null;
  headArg: string | undefined;
  /** Every git subcommand the gate shelled out to, in order. */
  gitCalls: string[];
}

function run(fx: { configPath: string }, hash: string, o: Opts): RunResult {
  let headArg: string | undefined;
  let stdout = "";
  const gitCalls: string[] = [];
  const exec = (cmd: string, args: string[]): ExecResult => {
    const joined = `${cmd} ${args.join(" ")}`;
    if (joined.includes("pr list")) {
      headArg = args[args.indexOf("--head") + 1];
      return {
        exitCode: 0,
        stdout: o.prNumber === null ? "[]" : JSON.stringify([{ number: o.prNumber, state: "OPEN" }]),
        stderr: "",
      };
    }
    if (joined.includes("pr view")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          statusCheckRollup: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" }],
          reviews: [],
        }),
        stderr: "",
      };
    }
    if (cmd === "git" && args[0] === "rev-parse") {
      gitCalls.push(joined);
      const ref = args[args.length - 1].replace("refs/heads/", "");
      const hit = (o.local ?? []).includes(ref);
      return { exitCode: hit ? 0 : 1, stdout: hit ? `${"a".repeat(40)}\n` : "", stderr: "" };
    }
    if (cmd === "git" && args[0] === "ls-remote") {
      gitCalls.push(joined);
      if (o.remote === "FAIL") {
        return { exitCode: 128, stdout: "", stderr: "fatal: 'origin' does not appear to be a git repository" };
      }
      const ref = args[args.length - 1];
      const hit = o.remote.includes(ref);
      return { exitCode: 0, stdout: hit ? `${"a".repeat(40)}\trefs/heads/${ref}\n` : "", stderr: "" };
    }
    if (cmd === "git" && args.includes("diff")) return { exitCode: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected exec call: ${joined}`);
  };
  const code = runMergeGate([hash], {}, {
    out: (s) => {
      stdout += s;
    },
    err: () => {},
    projectPath: fx.configPath,
    exec,
    retry: false,
  });
  let decision: RunResult["decision"] = null;
  try {
    decision = JSON.parse(stdout.trim());
  } catch {
    decision = null;
  }
  return { code, decision, headArg, gitCalls };
}

describe("the lgort1 shape: an unrecognized sentinel in branch:", () => {
  it("names the sentinel and the branch it should have been, not 'no PR yet'", () => {
    const fx = makeFixture("cc0001", "branch: unassigned");
    try {
      const r = run(fx, "cc0001", { prNumber: null, remote: ["feat/debug-cc0001"] });
      expect(r.code).toBe(2);
      expect(r.decision?.merge).toBe(false);
      // The whole point: this must NOT read as "no PR yet".
      expect(r.decision?.reason).not.toBe("no PR yet");
      expect(r.decision?.reason).toContain("unassigned");
      expect(r.decision?.reason).toContain("does not exist");
      expect(r.decision?.reason).toContain("feat/debug-cc0001");
    } finally {
      fx.cleanup();
    }
  });

  it("still queried the sentinel verbatim — validation explains the result, it does not gate the query", () => {
    // debug-1dfbdd: a precondition would break merged-and-deleted branches,
    // so the lookup must happen first and unchanged.
    const fx = makeFixture("cc0002", "branch: unassigned");
    try {
      const r = run(fx, "cc0002", { prNumber: null, remote: [] });
      expect(r.headArg).toBe("unassigned");
    } finally {
      fx.cleanup();
    }
  });
});

describe("a merged PR whose branch was deleted still gates (the precondition regression)", () => {
  it("returns the PR without ever asking whether the branch exists", () => {
    // `gh pr list --state all` matches merged PRs, and the documented flow
    // squash-merges with --delete-branch. If branch existence were a
    // PRECONDITION, this spec — which completed successfully — would be
    // accused of naming a dead branch. Query first; never ask on this path.
    const fx = makeFixture("cc0003", "branch: feat/debug-cc0003");
    try {
      const r = run(fx, "cc0003", { prNumber: 42, remote: [] });
      expect(r.code).toBe(0);
      expect(r.decision).toEqual({ merge: true });
      expect(r.gitCalls).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("could-not-verify is not evidence of absence", () => {
  it("routes a failed ls-remote to the safe default, never to a 'does not exist' verdict", () => {
    const fx = makeFixture("cc0004", "branch: unassigned");
    try {
      const r = run(fx, "cc0004", { prNumber: null, remote: "FAIL" });
      expect(r.code).toBe(2);
      expect(r.decision?.merge).toBe(false);
      expect(r.decision?.reason).toBe("gh signal collection failed");
      expect(r.decision?.reason).not.toContain("does not exist");
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC 3 — the reason always names the branch actually queried", () => {
  it("a real-but-PR-less branch reports 'no PR yet' WITH the branch", () => {
    const fx = makeFixture("cc0005", "branch: feat/real-branch");
    try {
      const r = run(fx, "cc0005", { prNumber: null, remote: ["feat/real-branch"] });
      expect(r.code).toBe(2);
      expect(r.decision?.reason).toBe("no PR yet (queried --head 'feat/real-branch')");
    } finally {
      fx.cleanup();
    }
  });

  it("a derived branch that does not exist yet is still plain 'no PR yet', not a defect", () => {
    // Pre-PR is the ordinary state for a derived name — the branch is created
    // when the work starts. Only an AUTHORED value that names nothing is the
    // debug-1dfbdd shape.
    const fx = makeFixture("cc0006", "branch: null");
    try {
      const r = run(fx, "cc0006", { prNumber: null, remote: [] });
      expect(r.code).toBe(2);
      expect(r.headArg).toBe("feat/debug-cc0006");
      expect(r.decision?.reason).toBe("no PR yet (queried --head 'feat/debug-cc0006')");
      expect(r.decision?.reason).not.toContain("does not exist");
    } finally {
      fx.cleanup();
    }
  });

  it("a local-only branch counts as existing without touching the network", () => {
    const fx = makeFixture("cc0007", "branch: feat/local-only");
    try {
      const r = run(fx, "cc0007", {
        prNumber: null,
        remote: "FAIL",
        local: ["feat/local-only"],
      });
      expect(r.decision?.reason).toBe("no PR yet (queried --head 'feat/local-only')");
      expect(r.gitCalls.some((c) => c.includes("ls-remote"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});
