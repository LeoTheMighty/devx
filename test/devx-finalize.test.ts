// Unit tests for src/lib/devx/finalize.ts + the `finalize` CLI (b931a1).
//
// finalize is the /devx Phase 8 after-merge tail as one primitive. The tests
// are organised around the two things that make it worth having, both of
// which are failure-shaped:
//
//   1. The WRITE BOUNDARY. Everything before mark-done aborts with nothing
//      written; everything after it reports and continues, because the merge
//      is already real and remote. Getting this backwards is how a failed
//      `git worktree remove` would strand a merged PR with an unflipped
//      backlog row.
//
//   2. The three defects mlcret found in the prose version
//      (LEARN.md § multi-loop-concurrency):
//        E1 — scoped staging. A peer's dirty file must never be staged.
//        E3 — the spec lock must be released, and must NOT be released when
//             a peer has re-claimed the hash.
//        E2 — the main worktree's dist/ must be refreshed after the merge.
//
// Layers: pure predicates → the finalize driver against a scripted exec →
// the runFinalize CLI exit-code contract.
//
// Spec: dev/dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md

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
import { afterEach, describe, expect, it, vi } from "vitest";

import { BacklogLockTimeoutError } from "../src/lib/backlog/mutate.js";
import type { Exec, ExecResult } from "../src/lib/devx/claim.js";
import {
  FinalizeAbort,
  type FinalizeOpts,
  finalize,
  expectedBranch,
  headSha,
  isBuildStale,
  isMainWorktree,
  isSelfHostedCheckout,
  stageablePaths,
  staleBuildWarning,
} from "../src/lib/devx/finalize.js";
import { composeSpecLockBody } from "../src/lib/devx/spec-lock.js";
import { runClaim, runFinalize } from "../src/commands/devx-helper.js";
import { warnIfBuildStale } from "../src/cli.js";

const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
afterEach(() => stderrSpy.mockClear());

const OK: ExecResult = { stdout: "", stderr: "", exitCode: 0 };
const fail = (stderr: string, exitCode = 1): ExecResult => ({
  stdout: "",
  stderr,
  exitCode,
});

interface Call {
  cmd: string;
  args: string[];
  cwd?: string;
}

/** A scripted exec: `script` maps a matcher to a result; everything
 *  unmatched succeeds. Records every call so the tests can assert on what
 *  was staged, in what order, and with what environment. */
function scriptedExec(
  script: Array<[(c: Call) => boolean, ExecResult | ExecResult[]]> = [],
): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const consumed = new Map<number, number>();
  const exec: Exec = (cmd, args, opts) => {
    const call: Call = { cmd, args, cwd: opts?.cwd };
    calls.push(call);
    for (let i = 0; i < script.length; i++) {
      const [match, result] = script[i];
      if (!match(call)) continue;
      if (Array.isArray(result)) {
        const n = consumed.get(i) ?? 0;
        consumed.set(i, n + 1);
        return result[Math.min(n, result.length - 1)];
      }
      return result;
    }
    return OK;
  };
  return { exec, calls };
}

const isGit = (sub: string) => (c: Call) => c.cmd === "git" && c.args[0] === sub;
const gitCalls = (calls: Call[], sub: string) =>
  calls.filter((c) => c.cmd === "git" && c.args[0] === sub);

/** A readFile stub covering the three probes finalize makes: `.git/HEAD`
 *  (which branch), `package.json` (is this the devx source checkout), and —
 *  via isBuildStale — `dist/build-info.json`. Everything else throws ENOENT,
 *  as the real fs would. */
function stubReadFile(
  over: Record<string, string> = {},
): (p: string) => string {
  const files: Record<string, string> = {
    HEAD: "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ scripts: { "build:swap": "tsc && swap" } }),
    ...over,
  };
  return (p: string) => {
    for (const [suffix, body] of Object.entries(files)) {
      if (p.endsWith(suffix)) return body;
    }
    const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
    e.code = "ENOENT";
    throw e;
  };
}

function baseOpts(over: Partial<FinalizeOpts> = {}): FinalizeOpts {
  return {
    repoRoot: "/repo",
    type: "dev",
    config: {},
    pr: 42,
    mergeSha: "abc1234",
    sessionToken: "/devx-session-A",
    readFile: stubReadFile(),
    markDone: () => ({ paths: ["DEV.md", "dev/dev-b931a1-x.md"], todoSynced: false }),
    // Default the environment probes so no test touches the real filesystem
    // unless it means to.
    exists: () => true,
    lock: (<T,>(_l: string, fn: () => T): T => fn()) as FinalizeOpts["lock"],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Layer 1 — pure predicates
// ---------------------------------------------------------------------------

describe("stageablePaths (E1 — the never-`git add -A` rule as a return value)", () => {
  it("keeps the repo-relative pathspecs mark-done reports", () => {
    expect(stageablePaths(["DEV.md", "dev/dev-x.md", "GRAPH.md"])).toEqual([
      "DEV.md",
      "dev/dev-x.md",
      "GRAPH.md",
    ]);
  });

  it("drops absolute and escaping paths — a widened pathspec IS the E1 class", () => {
    expect(
      stageablePaths(["DEV.md", "/etc/passwd", "../peer/DEV.md", "a/../../b", "..", ""]),
    ).toEqual(["DEV.md"]);
  });
});

describe("isBuildStale (E2 — sha vs sha, and never a false alarm)", () => {
  /** A fake `.git` + `dist/build-info.json`. `head` is the full sha the ref
   *  resolves to; `built` is the abbreviated sha tsc's build embedded. */
  function repo(
    built: string | null,
    head: string | null,
    opts: { packed?: boolean; detached?: boolean } = {},
  ): (p: string) => string {
    return (p: string) => {
      if (p.endsWith("build-info.json")) {
        if (built === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return JSON.stringify({ sha: built, builtAt: "2026-08-21T00:00:00Z" });
      }
      if (p.endsWith(join(".git", "HEAD"))) {
        if (opts.detached) return `${head}\n`;
        return "ref: refs/heads/main\n";
      }
      if (p.endsWith(join(".git", "refs", "heads", "main"))) {
        if (head === null || opts.packed) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return `${head}\n`;
      }
      if (p.endsWith("packed-refs")) {
        if (head === null || !opts.packed) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return `# pack-refs with: peeled\n${head} refs/heads/main\n`;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
  }

  const HEAD_SHA = "cb543a5f1e2d3c4b5a69788899aabbccddeeff00";

  it("is fresh when the build's embedded sha prefixes HEAD", () => {
    expect(isBuildStale("/repo", { readFile: repo("cb543a5", HEAD_SHA) })).toBe(false);
  });

  it("is stale when HEAD has moved to a different commit", () => {
    expect(isBuildStale("/repo", { readFile: repo("9f24c7a", HEAD_SHA) })).toBe(true);
  });

  it("does NOT fire merely because a commit happened — the whole point of the sha compare", () => {
    // The first cut compared `dist/build-info.json`'s mtime against
    // `.git/logs/HEAD`'s. Every /devx claim commits DEV.md + a spec on main,
    // which appends to that reflog and cannot make the compiled CLI stale —
    // so the banner printed on every devx call from claim through merge.
    // Here the ONLY thing that makes it fire is HEAD actually differing.
    const sameCommit = repo("cb543a5", HEAD_SHA);
    expect(isBuildStale("/repo", { readFile: sameCommit })).toBe(false);
    expect(isBuildStale("/repo", { readFile: sameCommit })).toBe(false);
  });

  it("resolves a packed ref as well as a loose one", () => {
    expect(
      isBuildStale("/repo", { readFile: repo("cb543a5", HEAD_SHA, { packed: true }) }),
    ).toBe(false);
  });

  it("resolves a detached HEAD", () => {
    expect(
      isBuildStale("/repo", { readFile: repo("cb543a5", HEAD_SHA, { detached: true }) }),
    ).toBe(false);
  });

  it("answers null — never 'stale' — when there is no build provenance", () => {
    expect(isBuildStale("/repo", { readFile: repo(null, HEAD_SHA) })).toBeNull();
  });

  it("answers null when the ref cannot be resolved (bare repo, linked worktree)", () => {
    expect(isBuildStale("/repo", { readFile: repo("cb543a5", null) })).toBeNull();
  });

  it("answers null on unparseable or non-sha provenance rather than warning forever", () => {
    expect(isBuildStale("/repo", { readFile: () => "not json" })).toBeNull();
    expect(
      isBuildStale("/repo", { readFile: repo("not-a-sha", HEAD_SHA) }),
    ).toBeNull();
  });

  it("names the repo in the warning so a multi-checkout box knows which to build", () => {
    expect(staleBuildWarning("/repo")).toContain("/repo");
    expect(staleBuildWarning("/repo")).toContain("npm run build");
  });
});

describe("headSha", () => {
  it("reads a loose ref, a packed ref, and a detached HEAD; null otherwise", () => {
    const root = mkdtempSync(join(tmpdir(), "devx-headsha-"));
    try {
      const read = (p: string) => readFileSync(p, "utf8");
      const git = join(root, ".git");
      mkdirSync(join(git, "refs", "heads"), { recursive: true });
      writeFileSync(join(git, "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(git, "refs", "heads", "main"), `${"a".repeat(40)}\n`);
      expect(headSha(root, read)).toBe("a".repeat(40));

      rmSync(join(git, "refs", "heads", "main"));
      writeFileSync(join(git, "packed-refs"), `${"b".repeat(40)} refs/heads/main\n`);
      expect(headSha(root, read)).toBe("b".repeat(40));

      writeFileSync(join(git, "HEAD"), `${"c".repeat(40)}\n`);
      expect(headSha(root, read)).toBe("c".repeat(40));

      rmSync(join(git, "HEAD"));
      expect(headSha(root, read)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("expectedBranch / isSelfHostedCheckout", () => {
  it("prefers the integration branch, then default_branch, then main", () => {
    expect(expectedBranch({ git: { integration_branch: "develop" } })).toBe("develop");
    expect(expectedBranch({ git: { default_branch: "trunk" } })).toBe("trunk");
    expect(expectedBranch({ git: { integration_branch: null } })).toBe("main");
    expect(expectedBranch({})).toBe("main");
  });

  it("recognises the devx source checkout by its own build:swap script", () => {
    const yes = () => JSON.stringify({ scripts: { "build:swap": "tsc" } });
    const no = () => JSON.stringify({ scripts: { build: "tsc" } });
    expect(isSelfHostedCheckout("/repo", yes)).toBe(true);
    expect(isSelfHostedCheckout("/repo", no)).toBe(false);
    expect(
      isSelfHostedCheckout("/repo", () => {
        throw new Error("ENOENT");
      }),
    ).toBe(false);
  });
});

describe("isMainWorktree", () => {
  it("is true when .git is a directory and false when it is a gitdir pointer file", () => {
    expect(isMainWorktree("/repo", { isDirectory: () => true })).toBe(true);
    expect(isMainWorktree("/wt", { isDirectory: () => false })).toBe(false);
    expect(isMainWorktree("/nope", { isDirectory: () => null })).toBeNull();
  });

  it("agrees with a real checkout and a real linked worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "devx-finalize-wt-"));
    try {
      mkdirSync(join(root, "main", ".git"), { recursive: true });
      mkdirSync(join(root, "linked"), { recursive: true });
      writeFileSync(join(root, "linked", ".git"), "gitdir: /elsewhere\n");
      expect(isMainWorktree(join(root, "main"))).toBe(true);
      expect(isMainWorktree(join(root, "linked"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — the finalize driver
// ---------------------------------------------------------------------------

describe("finalize — stage order and the write boundary", () => {
  it("pulls BEFORE mark-done, then stages exactly the paths mark-done returned", () => {
    const { exec, calls } = scriptedExec();
    let markDoneAt = -1;
    const res = finalize("b931a1", baseOpts({
      exec,
      markDone: () => {
        markDoneAt = calls.length;
        return { paths: ["DEV.md", "dev/dev-b931a1-x.md", "GRAPH.md"], todoSynced: true };
      },
    }));

    // Only the read-only verification calls happen before mark-done writes.
    expect(calls.slice(0, markDoneAt).map((c) => c.args.slice(0, 2))).toEqual([
      ["pull", "--ff-only"],
      ["merge-base", "--is-ancestor"],
    ]);
    expect(res.paths).toEqual(["DEV.md", "dev/dev-b931a1-x.md", "GRAPH.md"]);
    expect(res.ok).toBe(true);
    expect(res.steps.map((s) => s.stage)).toEqual([
      "verify-checkout",
      "pull",
      "verify-merge",
      "mark-done",
      "commit",
      "push",
      // worktree BEFORE release-lock: releasing first would leave a `done`,
      // unlocked, re-claimable spec whose worktree still holds unmerged work.
      "worktree",
      "release-lock",
      "rebuild",
    ]);
  });

  it("E1: names the returned pathspecs explicitly and never a blanket stage", () => {
    const { exec, calls } = scriptedExec();
    finalize("b931a1", baseOpts({
      exec,
      markDone: () => ({ paths: ["DEV.md", "dev/dev-b931a1-x.md"], todoSynced: false }),
    }));

    const add = gitCalls(calls, "add");
    expect(add).toHaveLength(1);
    expect(add[0].args).toEqual(["add", "--", "DEV.md", "dev/dev-b931a1-x.md"]);
    // The prose version's actual failure was `git add -A` (mlc106's ac0ccf2,
    // which swept two files owned by the concurrently-live mss104 session).
    // Nothing this primitive runs may name a blanket pathspec. This is the
    // argv half; the AC's literal obligation — a real peer's dirty file in a
    // real repo staying out of a real commit — is proven further down, in
    // "finalize — E1 against a REAL git repo".
    for (const c of calls) {
      expect(c.args).not.toContain("-A");
      expect(c.args).not.toContain("--all");
      if (c.args[0] === "add") expect(c.args).not.toContain(".");
    }
    // And the commit itself re-names the same pathspecs, so an interleaved
    // `git add` from a peer between our add and our commit cannot widen it.
    const commit = gitCalls(calls, "commit")[0] ?? gitCalls(calls, "-c")[0];
    expect(commit.args.slice(commit.args.indexOf("--"))).toEqual([
      "--",
      "DEV.md",
      "dev/dev-b931a1-x.md",
    ]);
  });

  it("aborts with NOTHING written when the pull still fails after one fetch retry", () => {
    const { exec, calls } = scriptedExec([
      [isGit("pull"), fail("fatal: Not possible to fast-forward, aborting.")],
      [isGit("fetch"), fail("ssh: connect to host github.com port 22: Broken pipe")],
    ]);
    let markDoneRan = false;
    expect(() =>
      finalize("b931a1", baseOpts({
        exec,
        markDone: () => {
          markDoneRan = true;
          return { paths: [], todoSynced: false };
        },
      })),
    ).toThrow(FinalizeAbort);

    expect(markDoneRan).toBe(false);
    expect(gitCalls(calls, "add")).toHaveLength(0);
    expect(gitCalls(calls, "commit")).toHaveLength(0);
    // Exactly one retry: pull, fetch, pull. Not an unbounded loop.
    expect(gitCalls(calls, "pull")).toHaveLength(2);
    expect(gitCalls(calls, "fetch")).toHaveLength(1);
  });

  it("recovers when the FIRST pull fails and the fetch retry succeeds", () => {
    const { exec } = scriptedExec([
      [isGit("pull"), [fail("error: could not lock config file"), OK]],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(res.ok).toBe(true);
    expect(res.steps.find((s) => s.stage === "pull")).toMatchObject({ ok: true });
  });

  it("refuses to run from a linked worktree — every write it makes belongs to main", () => {
    const { exec, calls } = scriptedExec();
    const wt = mkdtempSync(join(tmpdir(), "devx-finalize-linked-"));
    // A linked worktree's `.git` is a gitdir POINTER FILE, not a directory.
    writeFileSync(join(wt, ".git"), "gitdir: /elsewhere/.git/worktrees/dev-b931a1\n");
    try {
      expect(() =>
        finalize("b931a1", baseOpts({
          exec,
          repoRoot: wt,
          markDone: () => ({ paths: [], todoSynced: false }),
        })),
      ).toThrow(/linked worktree|main checkout/);
      // Not even the pull ran.
      expect(calls).toHaveLength(0);
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("proceeds when the main-checkout question is UNANSWERABLE (no .git at all)", () => {
    // A repo with no `.git` is not a linked worktree — it is a directory the
    // pull will fail on a moment later, with a far better error than a
    // guess. Refusing here on `null` would break every fixture-backed
    // caller for no safety gain.
    const bare = mkdtempSync(join(tmpdir(), "devx-finalize-nogit-"));
    try {
      const { exec } = scriptedExec();
      const res = finalize("b931a1", baseOpts({ exec, repoRoot: bare }));
      expect(res.ok).toBe(true);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("NEVER aborts after the flips land — a broken tail is reported, not thrown", () => {
    const { exec } = scriptedExec([
      [isGit("push"), fail("fatal: unable to access: Could not resolve host")],
      [isGit("worktree"), fail("fatal: '.worktrees/dev-b931a1' contains modified files")],
      [(c) => c.cmd === "npm", fail("tsc: error TS2307")],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(res.ok).toBe(false);
    const byStage = Object.fromEntries(res.steps.map((s) => [s.stage, s]));
    // The flips and the commit still happened.
    expect(byStage["mark-done"].ok).toBe(true);
    expect(byStage.commit.ok).toBe(true);
    // Three independent failures, all surfaced, none swallowing the others.
    expect(byStage.push.ok).toBe(false);
    expect(byStage.worktree.ok).toBe(false);
    expect(byStage.rebuild.ok).toBe(false);
    expect(byStage.rebuild.detail).toMatch(/still runs the PRE-merge build/);
  });
});

describe("finalize — push (the 9f24c7 class: commits that never reach origin)", () => {
  it("rebase-retries a race-shaped rejection, bounded", () => {
    const { exec, calls } = scriptedExec([
      [isGit("push"), [fail("! [rejected] main -> main (fetch first)"), OK]],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    const push = res.steps.find((s) => s.stage === "push");
    expect(push).toMatchObject({ ok: true });
    expect(push?.detail).toMatch(/after 1 rebase-retry/);
    expect(gitCalls(calls, "pull").filter((c) => c.args.includes("--rebase"))).toHaveLength(1);
  });

  it("gives up after FINALIZE_PUSH_MAX_RETRIES rather than looping forever", () => {
    const { exec, calls } = scriptedExec([
      [isGit("push"), fail("! [rejected] main -> main (non-fast-forward)")],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(res.steps.find((s) => s.stage === "push")?.ok).toBe(false);
    expect(gitCalls(calls, "push")).toHaveLength(3); // initial + 2 retries
  });

  it("does NOT rebase-retry a hook/policy refusal — those are not races", () => {
    const { exec, calls } = scriptedExec([
      [isGit("push"), fail("! [remote rejected] main -> main (pre-receive hook declined)")],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(res.steps.find((s) => s.stage === "push")?.ok).toBe(false);
    expect(gitCalls(calls, "push")).toHaveLength(1);
    expect(gitCalls(calls, "pull").filter((c) => c.args.includes("--rebase"))).toHaveLength(0);
  });

  it("aborts a conflicted rebase-retry instead of leaving the tree mid-operation", () => {
    const { exec, calls } = scriptedExec([
      [isGit("push"), fail("! [rejected] main -> main (fetch first)")],
      [(c) => c.cmd === "git" && c.args[0] === "pull" && c.args.includes("--rebase"),
       fail("CONFLICT (content): Merge conflict in GRAPH.md")],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(res.steps.find((s) => s.stage === "push")).toMatchObject({ ok: false });
    expect(gitCalls(calls, "rebase").map((c) => c.args)).toEqual([["rebase", "--abort"]]);
  });

  it("treats an already-committed tree as success rather than a failure to push", () => {
    const { exec, calls } = scriptedExec([
      [isGit("-c"), { stdout: "nothing to commit, working tree clean", stderr: "", exitCode: 1 }],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(res.ok).toBe(true);
    expect(res.steps.find((s) => s.stage === "commit")).toMatchObject({
      ok: true,
      skipped: true,
    });
    // It still pushes — the commit may exist locally but not on origin,
    // which is exactly the 9f24c7 shape.
    expect(gitCalls(calls, "push").length).toBeGreaterThan(0);
  });

  it("skips the push when there was genuinely nothing to stage", () => {
    const { exec, calls } = scriptedExec();
    const res = finalize("b931a1", baseOpts({
      exec,
      markDone: () => ({ paths: [], todoSynced: false }),
    }));
    expect(res.ok).toBe(true);
    expect(res.steps.find((s) => s.stage === "push")).toMatchObject({ skipped: true });
    expect(gitCalls(calls, "push")).toHaveLength(0);
  });
});

describe("finalize — E3: the spec-lock release nothing owned", () => {
  /** A real lock file on disk, so the release goes through the real
   *  releaseSpecLockGuarded rather than a stub of it. The guard is the whole
   *  point of the stage; stubbing it would test nothing. */
  function repoWithLock(owner: string): { root: string; lockPath: string } {
    const root = mkdtempSync(join(tmpdir(), "devx-finalize-lock-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".devx-cache", "locks"), { recursive: true });
    const lockPath = join(root, ".devx-cache", "locks", "spec-b931a1.lock");
    // Composed by the real writer, not hand-rolled JSON: the release goes
    // through the real parser, so a body format drift must fail this test
    // rather than silently make the guard untestable.
    writeFileSync(
      lockPath,
      composeSpecLockBody({ session: owner, claimedAt: "2026-08-21T11:00:00-06:00" }),
    );
    return { root, lockPath };
  }

  it("releases the lock this session owns — the leak was live on every clean run", () => {
    const { root, lockPath } = repoWithLock("/devx-session-A");
    try {
      const { exec } = scriptedExec();
      const res = finalize("b931a1", baseOpts({
        exec,
        repoRoot: root,
        sessionToken: "/devx-session-A",
      }));
      const step = res.steps.find((s) => s.stage === "release-lock");
      expect(step?.ok).toBe(true);
      // Genuinely released, NOT skipped — the two are different outcomes and
      // the leak this closes looked exactly like the skipped one.
      expect(step?.skipped).toBeUndefined();
      expect(step?.detail).toContain("released");
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT unlink a lock a peer has since re-claimed", () => {
    const { root, lockPath } = repoWithLock("/devx-session-PEER");
    try {
      const { exec } = scriptedExec();
      const res = finalize("b931a1", baseOpts({
        exec,
        repoRoot: root,
        sessionToken: "/devx-session-A",
      }));
      const step = res.steps.find((s) => s.stage === "release-lock");
      // Not a failure — this is the system working. Exit code stays 0.
      expect(step).toMatchObject({ ok: true, skipped: true });
      expect(step?.detail).toMatch(/session-PEER/);
      expect(existsSync(lockPath)).toBe(true);
      expect(res.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is a no-op, not an error, when there is no lock on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "devx-finalize-nolock-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    try {
      const { exec } = scriptedExec();
      const res = finalize("b931a1", baseOpts({ exec, repoRoot: root }));
      expect(res.steps.find((s) => s.stage === "release-lock")).toMatchObject({
        ok: true,
        skipped: true,
      });
      expect(res.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports (and does not throw) when the backlog lock is held by a peer", () => {
    const { exec } = scriptedExec();
    const res = finalize("b931a1", baseOpts({
      exec,
      lock: (() => {
        throw new BacklogLockTimeoutError(
          "/repo/.devx-cache/locks/backlog.lock",
          "finalize-release-spec-lock",
          4321,
        );
      }) as FinalizeOpts["lock"],
    }));
    const step = res.steps.find((s) => s.stage === "release-lock");
    expect(step?.ok).toBe(false);
    expect(step?.detail).toMatch(/4321/);
    // The stages AFTER it still ran — a held backlog lock must not strand
    // the worktree or the rebuild.
    expect(res.steps.map((s) => s.stage)).toContain("rebuild");
  });

  it("releases under the backlog lock — read/compare/unlink is a TOCTOU without it", () => {
    const { root } = repoWithLock("/devx-session-A");
    try {
      const labels: string[] = [];
      const { exec } = scriptedExec();
      finalize("b931a1", baseOpts({
        exec,
        repoRoot: root,
        lock: (<T,>(label: string, fn: () => T): T => {
          labels.push(label);
          return fn();
        }) as FinalizeOpts["lock"],
      }));
      expect(labels).toEqual(["finalize-release-spec-lock"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("finalize — worktree + branch removal", () => {
  it("removes the worktree WITHOUT --force, then deletes the branch", () => {
    const { exec, calls } = scriptedExec();
    const res = finalize("b931a1", baseOpts({ exec }));
    const wt = gitCalls(calls, "worktree")[0];
    expect(wt.args).toEqual(["worktree", "remove", join("/repo", ".worktrees", "dev-b931a1")]);
    // --force would destroy uncommitted work that is NOT in the merged PR.
    // db36af's field data has the case: two dead-owner claims needing
    // opposite actions, discriminated by worktree contents.
    expect(wt.args).not.toContain("--force");
    expect(gitCalls(calls, "branch")[0].args).toEqual(["branch", "-D", "feat/dev-b931a1"]);
    expect(res.steps.find((s) => s.stage === "worktree")?.ok).toBe(true);
  });

  it("honours an explicit --branch and the debug type's worktree stem", () => {
    const { exec, calls } = scriptedExec();
    finalize("9f24c7", baseOpts({ exec, type: "debug", branch: "handoff/rescue" }));
    expect(gitCalls(calls, "worktree")[0].args[2]).toBe(
      join("/repo", ".worktrees", "debug-9f24c7"),
    );
    expect(gitCalls(calls, "branch")[0].args[2]).toBe("handoff/rescue");
  });

  it("does not try to delete a branch whose worktree removal failed", () => {
    // git refuses to delete a branch a worktree has checked out, so a
    // second failure here would double-count one cause.
    const { exec, calls } = scriptedExec([
      [isGit("worktree"), fail("fatal: contains modified or untracked files")],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(gitCalls(calls, "branch")).toHaveLength(0);
    expect(res.steps.find((s) => s.stage === "worktree")?.detail).toMatch(
      /NOT in PR #42/,
    );
  });

  it("prunes (not removes) a worktree whose directory is already gone, and still deletes the branch", () => {
    // A hand `rm -rf` of `.worktrees/<hash>` leaves git's admin entry under
    // `.git/worktrees/` behind. Skipping straight to `branch -D` then fails
    // with "used by worktree at …" — which the already-gone matcher does NOT
    // catch — so the operator got exit 3 and a recovery list containing only
    // commands that fail the same way. `prune` is the one that works.
    const { exec, calls } = scriptedExec();
    const res = finalize("b931a1", baseOpts({ exec, exists: () => false }));
    expect(gitCalls(calls, "worktree").map((c) => c.args)).toEqual([
      ["worktree", "prune"],
    ]);
    expect(gitCalls(calls, "branch")).toHaveLength(1);
    expect(res.steps.find((s) => s.stage === "worktree")).toMatchObject({ ok: true });
    expect(res.steps.find((s) => s.stage === "worktree")?.detail).toMatch(/prune/);
  });

  it("treats an already-deleted branch as success", () => {
    const { exec } = scriptedExec([
      [isGit("branch"), fail("error: branch 'feat/dev-b931a1' not found.")],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(res.steps.find((s) => s.stage === "worktree")).toMatchObject({ ok: true });
  });
});

describe("finalize — E2: the self-hosted build is refreshed after the merge", () => {
  it("runs the swap-in build in the MAIN worktree, after the push", () => {
    const { exec, calls } = scriptedExec();
    const res = finalize("b931a1", baseOpts({ exec }));
    const npm = calls.filter((c) => c.cmd === "npm");
    expect(npm).toHaveLength(1);
    // build:swap, not build: the rebuild happens on the one tree every
    // concurrent session reads `devx` from, so it compiles into dist.next
    // and swaps rather than emitting over a live dist/.
    expect(npm[0].args).toEqual(["run", "build:swap"]);
    expect(npm[0].cwd).toBe("/repo");
    // Last stage — a merged PR must be pushed before we spend a tsc run.
    expect(calls.indexOf(npm[0])).toBe(calls.length - 1);
    expect(res.steps.at(-1)).toMatchObject({ stage: "rebuild", ok: true });
  });

  it("is skippable, because it is the only stage that mutates a tree peers read", () => {
    const { exec, calls } = scriptedExec();
    const res = finalize("b931a1", baseOpts({ exec, rebuild: false }));
    expect(calls.filter((c) => c.cmd === "npm")).toHaveLength(0);
    expect(res.steps.at(-1)).toMatchObject({ stage: "rebuild", ok: true, skipped: true });
    expect(res.ok).toBe(true);
  });

  it("warns ACTIONABLY on a failed build instead of unwinding a landed merge", () => {
    const { exec } = scriptedExec([
      [(c) => c.cmd === "npm", fail("src/x.ts(1,1): error TS2307: Cannot find module")],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    const step = res.steps.find((s) => s.stage === "rebuild");
    expect(step?.ok).toBe(false);
    expect(step?.detail).toContain("npm run build");
    expect(step?.detail).toContain("/repo");
    // The merge bookkeeping still stands.
    expect(res.steps.find((s) => s.stage === "push")?.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — the runFinalize CLI
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) {
    rmSync(tmpRoots.pop() as string, { recursive: true, force: true });
  }
});

const SAMPLE_DEV_MD = `# DEV

- [ ] \`dev/dev-other-2026-07-29T10:15-decoy.md\` — Decoy. Status: ready.
- [/] \`dev/dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md\` — finalize primitive. Status: in-progress.
`;
const SAMPLE_SPEC =
  "---\nhash: b931a1\ntype: dev\nstatus: in-progress\n---\n\n## Status log\n\n- claimed.\n";

/** A real-enough repo: devx.config.yaml, a `[/]` backlog row and an
 *  `in-progress` spec, so the REAL markDone runs against it. Only the shell
 *  and the board regen are stubbed. */
function makeTmpRepo(
  devMd = SAMPLE_DEV_MD,
  spec = SAMPLE_SPEC,
): string {
  const root = mkdtempSync(join(tmpdir(), "b931a1-cli-"));
  tmpRoots.push(root);
  mkdirSync(join(root, "dev"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n", "utf8");
  writeFileSync(join(root, "DEV.md"), devMd, "utf8");
  writeFileSync(
    join(root, "dev", "dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md"),
    spec,
    "utf8",
  );
  return root;
}

/** mark-done's own git probes (`remote get-url`, `check-ignore`,
 *  `rev-parse`) plus finalize's git/npm calls, all on one seam. */
function repoExec(over: Array<[(c: Call) => boolean, ExecResult]> = []): {
  exec: Exec;
  calls: Call[];
} {
  return scriptedExec([
    ...over,
    [(c) => c.args[0] === "check-ignore", fail("", 1)],
    [
      (c) => c.args[0] === "rev-parse",
      { stdout: "/repo/.git\n/repo/.git\n/repo\n", stderr: "", exitCode: 0 },
    ],
    [
      (c) => c.args[0] === "remote",
      { stdout: "git@github.com:LeoTheMighty/devx.git\n", stderr: "", exitCode: 0 },
    ],
  ]);
}

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(
  root: string,
  args: string[],
  over: Partial<FinalizeOpts> = {},
  execOver: Array<[(c: Call) => boolean, ExecResult]> = [],
): CliRun & { calls: Call[] } {
  let stdout = "";
  let stderr = "";
  const { exec, calls } = repoExec(execOver);
  const code = runFinalize(args, {
    out: (s) => {
      stdout += s;
    },
    err: (s) => {
      stderr += s;
    },
    projectPath: join(root, "devx.config.yaml"),
    repoRoot: root,
    markDoneOpts: {
      exec,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      regen: () => ({ ok: true, path: join(root, "GRAPH.md") }),
    },
    finalizeOpts: {
      exec,
      exists: () => false,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      ...over,
    },
  });
  return { code, stdout, stderr, calls };
}

describe("runFinalize — exit-code contract", () => {
  it("exit 0 and one JSON object carrying the per-stage record", () => {
    const root = makeTmpRepo();
    const r = runCli(root, ["b931a1", "--pr", "42", "--merge-sha", "abc1234def"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.hash).toBe("b931a1");
    expect(parsed.ok).toBe(true);
    expect(parsed.steps.map((s: { stage: string }) => s.stage)).toEqual([
      "verify-checkout",
      "pull",
      "verify-merge",
      "mark-done",
      "commit",
      "push",
      "worktree",
      "release-lock",
      "rebuild",
    ]);
    // The real markDone ran: the row and the frontmatter both flipped.
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toContain("- [x] `dev/dev-b931a1");
    expect(
      readFileSync(
        join(root, "dev", "dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md"),
        "utf8",
      ),
    ).toContain("status: done");
  });

  it("exit 1, nothing written, when the row was never claimed", () => {
    const root = makeTmpRepo(
      SAMPLE_DEV_MD.replace("- [/] `dev/dev-b931a1", "- [ ] `dev/dev-b931a1"),
      SAMPLE_SPEC.replace("status: in-progress", "status: ready"),
    );
    const before = readFileSync(join(root, "DEV.md"), "utf8");
    const r = runCli(root, ["b931a1", "--pr", "42", "--merge-sha", "abc1234"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ error: "mark-done-failed", stage: "state" });
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toBe(before);
    // And the tail stages never ran.
    expect(r.calls.filter((c) => c.cmd === "npm")).toHaveLength(0);
  });

  it("exit 2, nothing written, when the pull cannot fast-forward", () => {
    const root = makeTmpRepo();
    const before = readFileSync(join(root, "DEV.md"), "utf8");
    const r = runCli(root, ["b931a1", "--pr", "42", "--merge-sha", "abc1234"], {}, [
      [isGit("pull"), fail("fatal: Not possible to fast-forward, aborting.")],
    ]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({ error: "finalize-aborted", stage: "pull" });
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toBe(before);
  });

  it("exit 3 — the flips landed but a tail stage did not", () => {
    const root = makeTmpRepo();
    const r = runCli(root, ["b931a1", "--pr", "42", "--merge-sha", "abc1234"], {}, [
      [isGit("push"), fail("fatal: unable to access: Could not resolve host")],
    ]);
    // 3, not 1 or 2: re-running finalize would now fail at mark-done (the
    // row is already `[x]`), so the operator's move is to finish the named
    // stage by hand — a different response from "retry" and from "nothing
    // happened".
    expect(r.code).toBe(3);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(false);
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toContain("- [x] `dev/dev-b931a1");
    expect(r.stderr).toContain("[FAIL] push");
  });

  it("does NOT run (or fail on) build:swap in a repo that is not the devx checkout", () => {
    // `skills/devx.md` ships in the npm tarball and `devx init` installs this
    // Phase 8 prose into consumer repos. Running `npm run build:swap` there
    // gets `Missing script` and would have made EVERY merge in EVERY other
    // project exit 3, sending that project's agent off to hand-finish a stage
    // that never applied to it.
    const root = makeTmpRepo(); // fixture package.json: absent entirely
    const r = runCli(root, ["b931a1", "--pr", "42", "--merge-sha", "abc1234"]);
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => c.cmd === "npm")).toHaveLength(0);
    expect(JSON.parse(r.stdout).steps.at(-1)).toMatchObject({
      stage: "rebuild",
      ok: true,
      skipped: true,
    });
    expect(r.stderr).toMatch(/not the devx source checkout/);
  });

  it("DOES run build:swap when the checkout declares the script", () => {
    const root = makeTmpRepo();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "devx", scripts: { "build:swap": "tsc && node scripts/swap-dist.mjs" } }),
    );
    const r = runCli(root, ["b931a1", "--pr", "42", "--merge-sha", "abc1234"]);
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => c.cmd === "npm").map((c) => c.args)).toEqual([
      ["run", "build:swap"],
    ]);
  });

  it("rejects usage errors with 64 before touching the repo", () => {
    const root = makeTmpRepo();
    const before = readFileSync(join(root, "DEV.md"), "utf8");
    for (const args of [
      ["b931a1"],
      ["b931a1", "--pr", "42"],
      ["b931a1", "--pr", "not-a-number", "--merge-sha", "abc1234"],
      ["b931a1", "--pr", "42", "--merge-sha", "feat/dev-b931a1"],
      ["b931a1", "--pr", "42", "--merge-sha", "abc1234", "--type", "plan"],
      ["b931a1", "--pr", "42", "--merge-sha", "abc1234", "--nope"],
      ["b931a1", "--pr", "42", "--merge-sha"],
      ["not a hash!", "--pr", "42", "--merge-sha", "abc1234"],
      [],
    ]) {
      expect(runCli(root, args).code).toBe(64);
    }
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toBe(before);
  });

  it("does not swallow the next flag as a missing value", () => {
    const root = makeTmpRepo();
    const r = runCli(root, ["b931a1", "--pr", "--merge-sha", "abc1234"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("--pr requires a value");
  });

  it("honours --no-rebuild", () => {
    const root = makeTmpRepo();
    const r = runCli(root, [
      "b931a1", "--pr", "42", "--merge-sha", "abc1234", "--no-rebuild",
    ]);
    expect(r.code).toBe(0);
    expect(r.calls.filter((c) => c.cmd === "npm")).toHaveLength(0);
    expect(JSON.parse(r.stdout).steps.at(-1)).toMatchObject({
      stage: "rebuild",
      skipped: true,
    });
  });

  it("guards the lock release on the SUPPLIED token, not on the lock's own owner", () => {
    // CLAUDE.md: never pass a token copied from the spec's `owner:` or the
    // lock file — that trivially always matches and defeats the check. The
    // CLI must therefore pass --session-token straight through.
    const root = makeTmpRepo();
    mkdirSync(join(root, ".devx-cache", "locks"), { recursive: true });
    const lockPath = join(root, ".devx-cache", "locks", "spec-b931a1.lock");
    writeFileSync(
      lockPath,
      composeSpecLockBody({ session: "/devx-PEER", claimedAt: "2026-08-21T11:00:00-06:00" }),
    );
    const r = runCli(root, [
      "b931a1", "--pr", "42", "--merge-sha", "abc1234",
      "--session-token", "/devx-ME",
    ]);
    expect(r.code).toBe(0);
    expect(existsSync(lockPath)).toBe(true);
    expect(r.stderr).toMatch(/devx-PEER/);
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for the 2026-08-21 3-agent adversarial review
// ---------------------------------------------------------------------------

describe("finalize — the session-token guard (all three reviewers, HIGH)", () => {
  function repoWithRealLock(owner: string): { root: string; lockPath: string } {
    const root = mkdtempSync(join(tmpdir(), "devx-finalize-token-"));
    tmpRoots.push(root);
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".devx-cache", "locks"), { recursive: true });
    const lockPath = join(root, ".devx-cache", "locks", "spec-b931a1.lock");
    writeFileSync(
      lockPath,
      composeSpecLockBody({ session: owner, claimedAt: "2026-08-21T11:00:00-06:00" }),
    );
    return { root, lockPath };
  }

  it("FAILS LOUDLY when no token was supplied and a lock is on disk", () => {
    // The defect: finalize used to re-derive a token from its own process id,
    // which can never equal the one the CLAIM process wrote. The guarded
    // release therefore always returned `not-owner`, which was reported as
    // "a peer re-claimed the hash" — a peer that did not exist — with exit 0
    // while the lock leaked forever. That is E3, the defect stage 6 exists to
    // close, reported green.
    const { root, lockPath } = repoWithRealLock("/devx-2026-08-21T1015-54321");
    const { exec } = scriptedExec();
    const res = finalize("b931a1", baseOpts({
      exec,
      repoRoot: root,
      sessionToken: null,
      readFile: stubReadFile(),
      exists: (p: string) => existsSync(p),
    }));
    const step = res.steps.find((s) => s.stage === "release-lock");
    expect(step?.ok).toBe(false);
    expect(res.ok).toBe(false);
    // Names the real cause, and does NOT blame a phantom peer.
    expect(step?.detail).toMatch(/no --session-token was passed/);
    expect(step?.detail).not.toMatch(/re-claimed/);
    expect(step?.detail).toContain(lockPath);
    expect(existsSync(lockPath)).toBe(true);
  });

  it("is a clean skip when no token was supplied and no lock exists", () => {
    const root = mkdtempSync(join(tmpdir(), "devx-finalize-notoken-"));
    tmpRoots.push(root);
    mkdirSync(join(root, ".git"), { recursive: true });
    const { exec } = scriptedExec();
    const res = finalize("b931a1", baseOpts({
      exec,
      repoRoot: root,
      sessionToken: null,
      exists: (p: string) => existsSync(p),
    }));
    expect(res.steps.find((s) => s.stage === "release-lock")).toMatchObject({
      ok: true,
      skipped: true,
    });
    expect(res.ok).toBe(true);
  });

  it("`devx devx-helper claim` returns the token finalize needs", async () => {
    // The other half of the fix: without this field there is no legitimate
    // source for the token at all — the spec's `owner:` and the lock body are
    // both forbidden (a token read from the thing it guards always matches).
    const root = mkdtempSync(join(tmpdir(), "devx-claim-token-"));
    tmpRoots.push(root);
    mkdirSync(join(root, "dev"), { recursive: true });
    writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n");
    writeFileSync(join(root, "DEV.md"), SAMPLE_DEV_MD.replace("- [/] ", "- [ ] ").replace("in-progress", "ready"));
    writeFileSync(
      join(root, "dev", "dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md"),
      SAMPLE_SPEC.replace("status: in-progress", "status: ready"),
    );
    let stdout = "";
    const code = await runClaim(["b931a1"], {
      out: (s) => {
        stdout += s;
      },
      err: () => {},
      projectPath: join(root, "devx.config.yaml"),
      repoRoot: root,
      claimOpts: {
        // Stub every impure leg; this test is about the JSON contract.
        exec: () => ({ stdout: "", stderr: "", exitCode: 0 }),
        lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
        regen: () => ({ ok: true, path: join(root, "GRAPH.md") }),
      } as never,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { sessionToken?: string };
    expect(typeof parsed.sessionToken).toBe("string");
    expect(parsed.sessionToken).toMatch(/^\/devx-/);
    // And it is the token that actually went into the lock file.
    const lockBody = readFileSync(
      join(root, ".devx-cache", "locks", "spec-b931a1.lock"),
      "utf8",
    );
    expect(lockBody).toContain((parsed.sessionToken as string).replace(/^\/devx-/, ""));
  });
});

describe("finalize — verify stages (pre-write aborts with honest stage names)", () => {
  it("aborts under `verify-merge`, not `pull`, when the merge never landed", () => {
    // `--merge-sha` was only shape-checked. Stage 5 runs `git branch -D`,
    // a FORCE delete: if the merge did not land (gh pr merge from a worktree
    // exits non-zero often enough that the skill body warns about it), the
    // pull is a no-op and the branch holding the only copy of the work is
    // destroyed — remote copy gone too if --delete-branch ran.
    const { exec, calls } = scriptedExec([
      [isGit("merge-base"), fail("", 1)],
    ]);
    let markDoneRan = false;
    try {
      finalize("b931a1", baseOpts({
        exec,
        markDone: () => {
          markDoneRan = true;
          return { paths: [], todoSynced: false };
        },
      }));
      throw new Error("expected an abort");
    } catch (e) {
      expect(e).toBeInstanceOf(FinalizeAbort);
      expect((e as FinalizeAbort).stage).toBe("verify-merge");
    }
    expect(markDoneRan).toBe(false);
    expect(gitCalls(calls, "branch")).toHaveLength(0);
    expect(gitCalls(calls, "add")).toHaveLength(0);
  });

  it("continues but SUPPRESSES the branch delete when ancestry is unknowable", () => {
    // exit >1 = git could not answer (shallow clone, unknown object). That
    // must not block a merge that really happened — but it must not
    // force-delete a branch on a guess either.
    const { exec, calls } = scriptedExec([
      [isGit("merge-base"), fail("fatal: Not a valid object name", 128)],
    ]);
    const res = finalize("b931a1", baseOpts({ exec }));
    expect(res.ok).toBe(true);
    expect(gitCalls(calls, "branch")).toHaveLength(0);
    expect(res.steps.find((s) => s.stage === "worktree")?.detail).toMatch(
      /could not be verified/,
    );
  });

  it("aborts under `verify-checkout` when the main worktree is on the wrong branch", () => {
    // The prose always promised "one commit on `main`" and nothing checked.
    // A main worktree parked elsewhere takes the pull AND the bookkeeping
    // commit onto that branch, silently.
    const { exec, calls } = scriptedExec();
    try {
      finalize("b931a1", baseOpts({
        exec,
        readFile: stubReadFile({ HEAD: "ref: refs/heads/some-other-branch\n" }),
      }));
      throw new Error("expected an abort");
    } catch (e) {
      expect(e).toBeInstanceOf(FinalizeAbort);
      expect((e as FinalizeAbort).stage).toBe("verify-checkout");
      expect((e as Error).message).toMatch(/some-other-branch/);
    }
    expect(calls).toHaveLength(0);
  });

  it("reports the linked-worktree refusal as `verify-checkout`, not `pull`", () => {
    // It used to throw stage "pull", and the skill body documents that JSON
    // as "local main diverged or the remote is unreachable" — sending an
    // agent to debug the network when the fix is `cd` to the main worktree.
    const wt = mkdtempSync(join(tmpdir(), "devx-finalize-linked2-"));
    tmpRoots.push(wt);
    writeFileSync(join(wt, ".git"), "gitdir: /elsewhere\n");
    const { exec } = scriptedExec();
    try {
      finalize("b931a1", baseOpts({ exec, repoRoot: wt }));
      throw new Error("expected an abort");
    } catch (e) {
      expect((e as FinalizeAbort).stage).toBe("verify-checkout");
    }
  });

  it("honours a non-default integration branch instead of assuming `main`", () => {
    const { exec } = scriptedExec();
    const res = finalize("b931a1", baseOpts({
      exec,
      config: { git: { integration_branch: "develop" } },
      readFile: stubReadFile({ HEAD: "ref: refs/heads/develop\n" }),
    }));
    expect(res.steps[0]).toMatchObject({ stage: "verify-checkout", ok: true });
  });
});

describe("finalize — branch derivation (pln101, not a hardcoded prefix)", () => {
  it("derives the split-branch name from config rather than assuming feat/", () => {
    // Hardcoding `feat/<type>-<hash>` made `git branch -D` fail with "not
    // found" on a split-branch project — which the already-gone matcher
    // reported as a clean success while the real branch survived. That is
    // exactly the cross-epic regression class deriveBranch exists to kill.
    const { exec, calls } = scriptedExec();
    finalize("b931a1", baseOpts({
      exec,
      config: { git: { integration_branch: "develop" } },
      readFile: stubReadFile({ HEAD: "ref: refs/heads/develop\n" }),
    }));
    // deriveBranch's split-branch default prefix is `<integration>/`.
    expect(gitCalls(calls, "branch")[0].args).toEqual([
      "branch",
      "-D",
      "develop/dev-b931a1",
    ]);
    expect(gitCalls(calls, "branch")[0].args[2]).not.toBe("feat/dev-b931a1");
  });

  it("an explicit --branch still wins (mss102 attach mode records its own)", () => {
    const { exec, calls } = scriptedExec();
    finalize("b931a1", baseOpts({ exec, branch: "handoff/rescue" }));
    expect(gitCalls(calls, "branch")[0].args[2]).toBe("handoff/rescue");
  });
});

describe("warnIfBuildStale — the wiring, not just the predicate", () => {
  const DIST = "/somewhere/dist";

  it("prints the warning when the executing build is stale", () => {
    let out = "";
    warnIfBuildStale({
      moduleDir: DIST,
      env: {},
      stale: () => true,
      write: (s) => {
        out += s;
      },
    });
    expect(out).toContain("running a build older than");
  });

  it("says nothing when the build matches HEAD", () => {
    let out = "";
    warnIfBuildStale({ moduleDir: DIST, env: {}, stale: () => false, write: (s) => (out += s) });
    expect(out).toBe("");
  });

  it("says nothing when staleness is unanswerable — a false alarm is worse than a miss", () => {
    let out = "";
    warnIfBuildStale({ moduleDir: DIST, env: {}, stale: () => null, write: (s) => (out += s) });
    expect(out).toBe("");
  });

  it("honours DEVX_NO_STALE_WARN and suppresses itself under vitest", () => {
    for (const env of [{ DEVX_NO_STALE_WARN: "1" }, { VITEST: "true" }]) {
      let out = "";
      warnIfBuildStale({ moduleDir: DIST, env, stale: () => true, write: (s) => (out += s) });
      expect(out).toBe("");
    }
  });

  it("never fires from a src/ (tsx) run — that is not a build at all", () => {
    let out = "";
    warnIfBuildStale({
      moduleDir: "/somewhere/src",
      env: {},
      stale: () => true,
      write: (s) => (out += s),
    });
    expect(out).toBe("");
  });

  it("never throws, whatever the predicate does", () => {
    expect(() =>
      warnIfBuildStale({
        moduleDir: DIST,
        env: {},
        stale: () => {
          throw new Error("boom");
        },
        write: () => {},
      }),
    ).not.toThrow();
  });
});
