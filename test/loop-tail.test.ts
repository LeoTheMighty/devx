// PR/CI/merge tail (v2l101 — src/lib/loop/tail.ts). Fully scripted exec —
// no network, no real gh. D-11: only a green gate merges.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultTail, type TailCtx, type TailItem } from "../src/lib/loop/tail.js";
import { type Exec } from "../src/lib/loop/git-tx.js";

interface Call {
  cmd: string;
  args: string[];
}

interface Script {
  /** Return a response for a matching call; undefined = default success. */
  respond: (cmd: string, args: string[]) => { stdout?: string; stderr?: string; exitCode?: number } | undefined;
}

function scriptedExec(script: Script): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    const r = script.respond(cmd, [...args]);
    return { stdout: "", stderr: "", exitCode: 0, ...(r ?? {}) };
  };
  return { exec, calls };
}

let repoRoot: string;
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "devx-loop-tail-"));
  mkdirSync(join(repoRoot, "dev"), { recursive: true });
  writeFileSync(
    join(repoRoot, "dev/dev-abc123-2026-07-05T13:00-thing.md"),
    "---\nhash: abc123\nstatus: in-progress\n---\n\n## Acceptance criteria\n\n- [ ] works\n\n## Status log\n",
    "utf8",
  );
});
afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

const ITEM: TailItem = {
  hash: "abc123",
  type: "dev",
  title: "The thing",
  specRelPath: "dev/dev-abc123-2026-07-05T13:00-thing.md",
  branch: "feat/dev-abc123",
  worktreePath: "/wt",
  changeSummaries: ["did x", "did y"],
};

function ctx(exec: Exec, overrides: Partial<TailCtx> = {}): TailCtx {
  return {
    repoRoot,
    mode: "YOLO",
    merged: { promotion: { autonomy: { count: 5, initial_n: 0 } } },
    exec,
    sleep: async () => {},
    ciPollMs: 1,
    ciTimeoutMs: 50,
    out: () => {},
    ...overrides,
  };
}

const PR_URL = "https://github.com/x/y/pull/42";

function ghHappyPath(overrides: {
  prList?: string;
  runList?: string;
  mergeExit?: number;
  viewState?: string;
  holdBody?: string;
} = {}): Script {
  return {
    respond: (cmd, args) => {
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        return { stdout: overrides.prList ?? "[]" };
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "create") {
        return { stdout: `${PR_URL}\n` };
      }
      if (cmd === "gh" && args[0] === "run" && args[1] === "list") {
        return {
          stdout:
            overrides.runList ??
            JSON.stringify([
              {
                databaseId: 1,
                status: "completed",
                conclusion: "success",
                url: "https://ci/1",
                headSha: "a".repeat(40),
                workflowName: "devx-ci",
              },
            ]),
        };
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return { stdout: "a".repeat(40) };
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "view" && args.includes("comments,reviews")) {
        return { stdout: overrides.holdBody ?? '{"comments":[],"reviews":[]}' };
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "merge") {
        return { exitCode: overrides.mergeExit ?? 0 };
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
        return { stdout: JSON.stringify({ state: overrides.viewState ?? "MERGED", mergeCommit: { oid: "m" } }) };
      }
      return undefined;
    },
  };
}

function withWorkflows(): void {
  mkdirSync(join(repoRoot, ".github", "workflows"), { recursive: true });
  writeFileSync(join(repoRoot, ".github", "workflows", "devx-ci.yml"), "name: ci\n", "utf8");
}

describe("defaultTail", () => {
  it("green CI + YOLO gate ⇒ creates the PR and merges (squash + delete-branch)", async () => {
    withWorkflows();
    const { exec, calls } = scriptedExec(ghHappyPath());
    const r = await defaultTail(ITEM, ctx(exec));
    expect(r.outcome).toBe("merged");
    if (r.outcome === "merged") expect(r.prUrl).toBe(PR_URL);
    const create = calls.find((c) => c.cmd === "gh" && c.args[1] === "create")!;
    expect(create.args).toContain("--head");
    expect(create.args).toContain("feat/dev-abc123");
    // The rendered body carries the spec path + AC checklist + mode stamp.
    const body = create.args[create.args.indexOf("--body") + 1];
    expect(body).toContain("dev/dev-abc123-2026-07-05T13:00-thing.md");
    expect(body).toContain("- [ ] works");
    expect(body).toContain("YOLO");
    const merge = calls.find((c) => c.cmd === "gh" && c.args[1] === "merge")!;
    expect(merge.args).toEqual(["pr", "merge", "42", "--squash", "--delete-branch"]);
  });

  it("no remote workflows ⇒ local CI was authoritative; YOLO merges", async () => {
    const { exec } = scriptedExec(ghHappyPath());
    const r = await defaultTail(ITEM, ctx(exec));
    expect(r.outcome).toBe("merged");
  });

  it("reuses an existing open PR instead of creating a second one", async () => {
    const { exec, calls } = scriptedExec(
      ghHappyPath({ prList: JSON.stringify([{ number: 42, url: PR_URL }]) }),
    );
    const r = await defaultTail(ITEM, ctx(exec));
    expect(r.outcome).toBe("merged");
    expect(calls.some((c) => c.cmd === "gh" && c.args[1] === "create")).toBe(false);
  });

  it("CI red ⇒ handed-off, never merged (no unattended fix-forward)", async () => {
    withWorkflows();
    const { exec, calls } = scriptedExec(
      ghHappyPath({
        runList: JSON.stringify([
          { databaseId: 1, status: "completed", conclusion: "failure", url: "u", headSha: "a".repeat(40), workflowName: "ci" },
        ]),
      }),
    );
    const r = await defaultTail(ITEM, ctx(exec));
    expect(r.outcome).toBe("handed-off");
    if (r.outcome === "handed-off") expect(r.detail).toContain("'failure'");
    expect(calls.some((c) => c.cmd === "gh" && c.args[1] === "merge")).toBe(false);
  });

  it("CI that never completes hands off at the poll ceiling", async () => {
    withWorkflows();
    const { exec } = scriptedExec(
      ghHappyPath({
        runList: JSON.stringify([
          { databaseId: 1, status: "in_progress", conclusion: "", url: "u", headSha: "a".repeat(40), workflowName: "ci" },
        ]),
      }),
    );
    const r = await defaultTail(ITEM, ctx(exec, { ciTimeoutMs: 5, ciPollMs: 1 }));
    expect(r.outcome).toBe("handed-off");
    if (r.outcome === "handed-off") expect(r.detail).toMatch(/did not complete/);
  });

  it("a `devx: hold` comment blocks the merge (D-5)", async () => {
    withWorkflows();
    const { exec, calls } = scriptedExec(
      ghHappyPath({ holdBody: '{"comments":[{"body":"devx: hold — want to look"}],"reviews":[]}' }),
    );
    const r = await defaultTail(ITEM, ctx(exec));
    expect(r.outcome).toBe("handed-off");
    if (r.outcome === "handed-off") expect(r.detail).toMatch(/hold/i);
    expect(calls.some((c) => c.cmd === "gh" && c.args[1] === "merge")).toBe(false);
  });

  it("LOCKDOWN mode never merges even on green (merge-gate refuses)", async () => {
    withWorkflows();
    const { exec, calls } = scriptedExec(ghHappyPath());
    const r = await defaultTail(ITEM, ctx(exec, { mode: "LOCKDOWN" }));
    expect(r.outcome).toBe("handed-off");
    if (r.outcome === "handed-off") expect(r.detail).toMatch(/merge-gate refused/);
    expect(calls.some((c) => c.cmd === "gh" && c.args[1] === "merge")).toBe(false);
  });

  it("trust-gradient below initial_n hands off with the INTERVIEW advice", async () => {
    const { exec } = scriptedExec(ghHappyPath());
    const r = await defaultTail(
      ITEM,
      ctx(exec, { merged: { promotion: { autonomy: { count: 0, initial_n: 3 } } } }),
    );
    expect(r.outcome).toBe("handed-off");
    if (r.outcome === "handed-off") expect(r.detail).toContain("INTERVIEW");
  });

  it("gh pr merge non-zero exit but PR actually MERGED counts as merged (worktree-merge quirk)", async () => {
    const { exec } = scriptedExec(ghHappyPath({ mergeExit: 1, viewState: "MERGED" }));
    const r = await defaultTail(ITEM, ctx(exec));
    expect(r.outcome).toBe("merged");
  });

  it("gh pr merge non-zero and PR still open ⇒ handed-off with the error", async () => {
    const { exec } = scriptedExec(ghHappyPath({ mergeExit: 1, viewState: "OPEN" }));
    const r = await defaultTail(ITEM, ctx(exec));
    expect(r.outcome).toBe("handed-off");
    if (r.outcome === "handed-off") expect(r.detail).toMatch(/not merged/);
  });

  it("gh pr create failure hands off with the stderr detail", async () => {
    const { exec } = scriptedExec({
      respond: (cmd, args) => {
        if (cmd === "gh" && args[1] === "list") return { stdout: "[]" };
        if (cmd === "gh" && args[1] === "create") return { exitCode: 1, stderr: "gh: not logged in" };
        return undefined;
      },
    });
    const r = await defaultTail(ITEM, ctx(exec));
    expect(r.outcome).toBe("handed-off");
    if (r.outcome === "handed-off") expect(r.detail).toContain("not logged in");
  });
});
