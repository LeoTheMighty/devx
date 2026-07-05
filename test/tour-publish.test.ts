// Tour publish + prune tests (v2t101) — fake-exec harness.
//
// The publish path is pure git plumbing over the injectable exec seam, so
// the tests script exact command sequences: orphan-branch create, no-op
// short-circuit, the non-fast-forward race (first push rejected → refetch →
// second push lands), hard push failures NOT retried, and the refusal cases
// (missing tour file, unrecognizable remote).
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../src/lib/tour/exec.js";
import {
  TourPublishError,
  parseGithubRemote,
  pruneTours,
  publishTour,
  tourUrls,
} from "../src/lib/tour/publish.js";

const HASH = "abc123";
const BLOB = "b".repeat(40);
const TREE = "c".repeat(40);
const COMMIT = "d".repeat(40);
const PARENT = "e".repeat(40);
const PARENT_TREE = "f".repeat(40);

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function makeRepoRoot(withTour = true): string {
  tmp = mkdtempSync(join(tmpdir(), "devx-tour-publish-"));
  if (withTour) {
    const dir = join(tmp, ".devx-cache", "tours", HASH);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tour.html"), "<!doctype html><html></html>");
  }
  return tmp;
}

const ok = (stdout = ""): ExecResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string, exitCode = 1): ExecResult => ({
  stdout: "",
  stderr,
  exitCode,
});

interface Call {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

/** Scripted exec: routes each git/gh invocation by its leading args. */
function makeExec(handlers: {
  remoteUrl?: string;
  /** Return per-attempt fetch results; null = branch absent. */
  fetch?: () => ExecResult | "absent";
  parent?: string | null;
  parentTree?: string;
  push?: () => ExecResult;
  lsTree?: string;
  ghMergedByBranch?: Record<string, boolean>;
  logCtByPath?: Record<string, string>;
}): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts?.env });
    if (cmd === "gh") {
      // gh pr list --head <branch> --state merged ...
      const head = args[args.indexOf("--head") + 1];
      const merged = handlers.ghMergedByBranch?.[head] ?? false;
      return ok(merged ? '[{"number": 7}]' : "[]");
    }
    const sub = args[0];
    switch (sub) {
      case "remote":
        return ok(`${handlers.remoteUrl ?? "git@github.com:leo/devx.git"}\n`);
      case "fetch": {
        const r = handlers.fetch?.() ?? "absent";
        if (r === "absent") {
          return fail("fatal: couldn't find remote ref refs/heads/devx-tours", 128);
        }
        return r;
      }
      case "rev-parse": {
        const ref = args[1];
        if (ref.endsWith("^{tree}")) return ok(`${handlers.parentTree ?? PARENT_TREE}\n`);
        if (ref.startsWith("refs/remotes/")) {
          if (handlers.parent === null || handlers.parent === undefined) {
            return fail("unknown revision", 128);
          }
          return ok(`${handlers.parent}\n`);
        }
        return ok(`${PARENT}\n`);
      }
      case "hash-object":
        return ok(`${BLOB}\n`);
      case "read-tree":
        return ok();
      case "update-index":
        return ok();
      case "write-tree":
        return ok(`${TREE}\n`);
      case "commit-tree":
        return ok(`${COMMIT}\n`);
      case "push":
        return handlers.push?.() ?? ok();
      case "ls-tree":
        // Production passes -z (NUL-separated, no C-quoting).
        expect(args).toContain("-z");
        return ok(handlers.lsTree ?? "");
      case "log": {
        const path = args[args.length - 1];
        return ok(`${handlers.logCtByPath?.[path] ?? "100"}\n`);
      }
      default:
        return fail(`unexpected git ${sub}`);
    }
  };
  return { exec, calls };
}

describe("parseGithubRemote", () => {
  it("parses ssh, ssh-url, and https forms", () => {
    expect(parseGithubRemote("git@github.com:leo/devx.git")).toEqual({
      owner: "leo",
      repo: "devx",
    });
    expect(parseGithubRemote("ssh://git@github.com/leo/devx.git")).toEqual({
      owner: "leo",
      repo: "devx",
    });
    expect(parseGithubRemote("https://github.com/leo/devx")).toEqual({
      owner: "leo",
      repo: "devx",
    });
    expect(parseGithubRemote("https://github.com/leo/devx.git")).toEqual({
      owner: "leo",
      repo: "devx",
    });
  });
  it("rejects non-GitHub remotes", () => {
    expect(parseGithubRemote("https://gitlab.com/leo/devx.git")).toBeNull();
  });
});

describe("tourUrls", () => {
  it("builds the htmlpreview wrapper around the raw URL", () => {
    const u = tourUrls("leo", "devx", "devx-tours", HASH);
    expect(u.rawUrl).toBe(
      `https://raw.githubusercontent.com/leo/devx/devx-tours/tours/${HASH}/tour.html`,
    );
    expect(u.htmlpreviewUrl).toBe(`https://htmlpreview.github.io/?${u.rawUrl}`);
  });
});

describe("publishTour", () => {
  it("creates the orphan branch on first publish (no parent, no -p)", () => {
    const repoRoot = makeRepoRoot();
    const { exec, calls } = makeExec({ fetch: () => "absent" });
    const r = publishTour(HASH, { repoRoot, exec });
    expect(r.createdBranch).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.commitSha).toBe(COMMIT);
    expect(r.htmlpreviewUrl).toContain("htmlpreview.github.io/?");
    expect(r.rawUrl).toContain(`/devx-tours/tours/${HASH}/tour.html`);
    // Orphan root: read-tree --empty, commit-tree without -p.
    const readTree = calls.find((c) => c.args[0] === "read-tree");
    expect(readTree?.args).toContain("--empty");
    const commitTree = calls.find((c) => c.args[0] === "commit-tree");
    expect(commitTree?.args).not.toContain("-p");
    // Plumbing ran against a temp index — never the real one.
    expect(readTree?.env?.GIT_INDEX_FILE).toBeTruthy();
    // Push targeted the branch ref without touching local HEAD.
    const push = calls.find((c) => c.args[0] === "push");
    expect(push?.args).toContain(`${COMMIT}:refs/heads/devx-tours`);
    expect(calls.some((c) => c.args[0] === "checkout")).toBe(false);
  });

  it("builds on the existing branch tip when present (-p parent)", () => {
    const repoRoot = makeRepoRoot();
    const { exec, calls } = makeExec({
      fetch: () => ok(),
      parent: PARENT,
    });
    const r = publishTour(HASH, { repoRoot, exec });
    expect(r.createdBranch).toBe(false);
    const commitTree = calls.find((c) => c.args[0] === "commit-tree");
    expect(commitTree?.args).toContain("-p");
    expect(commitTree?.args).toContain(PARENT);
  });

  it("short-circuits as a no-op when the tree is unchanged (deterministic re-render)", () => {
    const repoRoot = makeRepoRoot();
    const { exec, calls } = makeExec({
      fetch: () => ok(),
      parent: PARENT,
      parentTree: TREE, // parent's tree equals the freshly written tree
    });
    const r = publishTour(HASH, { repoRoot, exec });
    expect(r.commitSha).toBe(PARENT);
    expect(calls.some((c) => c.args[0] === "commit-tree")).toBe(false);
    expect(calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  it("retries on non-fast-forward rejection and lands on the second attempt", () => {
    const repoRoot = makeRepoRoot();
    let pushes = 0;
    let fetches = 0;
    const { exec, calls } = makeExec({
      fetch: () => {
        fetches += 1;
        return ok();
      },
      parent: PARENT,
      push: () => {
        pushes += 1;
        return pushes === 1
          ? fail(
              " ! [rejected]  d..d -> devx-tours (non-fast-forward)\nerror: failed to push some refs",
            )
          : ok();
      },
    });
    const r = publishTour(HASH, { repoRoot, exec });
    expect(r.attempts).toBe(2);
    expect(pushes).toBe(2);
    // The retry re-fetched the winner's tip before rebuilding the tree.
    expect(fetches).toBe(2);
    // Fresh temp index per attempt (stale-index safety).
    const readTrees = calls.filter((c) => c.args[0] === "read-tree");
    expect(readTrees).toHaveLength(2);
    expect(readTrees[0].env?.GIT_INDEX_FILE).not.toBe(
      readTrees[1].env?.GIT_INDEX_FILE,
    );
  });

  it("gives up with race-exhausted after maxAttempts lost races", () => {
    const repoRoot = makeRepoRoot();
    const { exec } = makeExec({
      fetch: () => ok(),
      parent: PARENT,
      push: () => fail("! [rejected] (non-fast-forward)"),
    });
    try {
      publishTour(HASH, { repoRoot, exec, maxAttempts: 3 });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TourPublishError);
      expect((e as TourPublishError).stage).toBe("race-exhausted");
    }
  });

  it("does NOT retry a hard push failure (auth/hook) — surfaces stage:push", () => {
    const repoRoot = makeRepoRoot();
    let pushes = 0;
    const { exec } = makeExec({
      fetch: () => ok(),
      parent: PARENT,
      push: () => {
        pushes += 1;
        return fail("remote: Permission to leo/devx.git denied", 128);
      },
    });
    try {
      publishTour(HASH, { repoRoot, exec });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as TourPublishError).stage).toBe("push");
    }
    expect(pushes).toBe(1);
  });

  it("refuses when the built tour.html is missing (build must run first)", () => {
    const repoRoot = makeRepoRoot(false);
    const { exec, calls } = makeExec({});
    try {
      publishTour(HASH, { repoRoot, exec });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as TourPublishError).stage).toBe("no-tour-file");
    }
    // Refused BEFORE any git mutation.
    expect(calls).toHaveLength(0);
  });

  it("refuses on an unrecognizable remote before mutating anything", () => {
    const repoRoot = makeRepoRoot();
    const { exec, calls } = makeExec({
      remoteUrl: "https://gitlab.com/leo/devx.git",
    });
    try {
      publishTour(HASH, { repoRoot, exec });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as TourPublishError).stage).toBe("remote-url");
    }
    expect(calls.some((c) => c.args[0] === "push")).toBe(false);
    expect(calls.some((c) => c.args[0] === "hash-object")).toBe(false);
  });

  it("propagates real fetch failures (network/auth) as stage:fetch", () => {
    const repoRoot = makeRepoRoot();
    const { exec } = makeExec({
      fetch: () => fail("fatal: unable to access: could not resolve host", 128),
    });
    try {
      publishTour(HASH, { repoRoot, exec });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as TourPublishError).stage).toBe("fetch");
    }
  });

  it("successful fetch + failed rev-parse is a HARD error, never an orphan-root rebuild (Blind Hunter #4)", () => {
    // Returning null there would build a parent-less commit that, if
    // pushed, discards every previously published tour.
    const repoRoot = makeRepoRoot();
    const { exec, calls } = makeExec({
      fetch: () => ok(),
      parent: null, // rev-parse of the tracking ref fails
    });
    try {
      publishTour(HASH, { repoRoot, exec });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TourPublishError);
      expect((e as TourPublishError).stage).toBe("fetch");
    }
    expect(calls.some((c) => c.args[0] === "commit-tree")).toBe(false);
    expect(calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  it("runs the fetch under LC_ALL=C so the branch-absent stderr match survives localized git (Edge Case Hunter #3)", () => {
    const repoRoot = makeRepoRoot();
    const { exec, calls } = makeExec({ fetch: () => "absent" });
    publishTour(HASH, { repoRoot, exec });
    const fetchCall = calls.find((c) => c.args[0] === "fetch");
    expect(fetchCall?.env?.LC_ALL).toBe("C");
  });
});

describe("pruneTours", () => {
  const lsTree = ["tours/aaa111", "tours/bbb222", "tours/ccc333"].join("\0");

  it("keeps unmerged tours always; prunes merged beyond --keep by recency", () => {
    const repoRoot = makeRepoRoot();
    const { exec, calls } = makeExec({
      fetch: () => ok(),
      parent: PARENT,
      lsTree,
      ghMergedByBranch: {
        "feat/dev-aaa111": true,
        "feat/dev-bbb222": true,
        "feat/dev-ccc333": false, // unmerged — always kept
      },
      logCtByPath: {
        "tours/aaa111": "200", // newer merged → kept with keep=1
        "tours/bbb222": "100", // older merged → pruned
      },
    });
    const r = pruneTours({ repoRoot, exec, keep: 1 });
    expect(r.pruned).toEqual(["bbb222"]);
    expect(r.kept.sort()).toEqual(["aaa111", "ccc333"]);
    expect(r.commitSha).toBe(COMMIT);
    const rm = calls.find((c) => c.args[0] === "update-index");
    expect(rm?.args).toContain("--force-remove");
    expect(rm?.args).toContain("tours/bbb222/tour.html");
  });

  it("no-ops when nothing exceeds retention", () => {
    const repoRoot = makeRepoRoot();
    const { exec, calls } = makeExec({
      fetch: () => ok(),
      parent: PARENT,
      lsTree,
      ghMergedByBranch: { "feat/dev-aaa111": true },
    });
    const r = pruneTours({ repoRoot, exec, keep: 10 });
    expect(r.pruned).toEqual([]);
    expect(r.commitSha).toBeNull();
    expect(calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  it("no-ops when the tours branch doesn't exist yet", () => {
    const repoRoot = makeRepoRoot();
    const { exec } = makeExec({ fetch: () => "absent" });
    const r = pruneTours({ repoRoot, exec });
    expect(r).toEqual({ pruned: [], kept: [], commitSha: null });
  });

  it("a gh failure keeps the tour (never prune on unknown PR state)", () => {
    const repoRoot = makeRepoRoot();
    const { exec } = makeExec({
      fetch: () => ok(),
      parent: PARENT,
      lsTree: "tours/aaa111",
      // no ghMergedByBranch entry → handler returns [] (treated unmerged);
      // simulate harder failure by overriding gh entirely below.
    });
    const failingGh: Exec = (cmd, args, opts) =>
      cmd === "gh" ? fail("gh: api error", 1) : exec(cmd, args, opts);
    const r = pruneTours({ repoRoot, exec: failingGh, keep: 0 });
    expect(r.pruned).toEqual([]);
    expect(r.kept).toEqual(["aaa111"]);
  });

  it("rejects a negative keep", () => {
    const repoRoot = makeRepoRoot();
    const { exec } = makeExec({ fetch: () => ok(), parent: PARENT });
    expect(() => pruneTours({ repoRoot, exec, keep: -1 })).toThrowError(
      TourPublishError,
    );
  });
});
