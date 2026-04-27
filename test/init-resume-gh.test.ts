// `devx init --resume-gh` command tests (ini506).
//
// The replay logic is exercised by init-failure.test.ts; this suite covers
// the command-shaped concerns:
//   - usage on no-args (exit 0; no throw)
//   - --resume-gh with empty queue → no-op message + clears stranded flag
//   - --resume-gh all-green → flag cleared, queue cleared
//   - --resume-gh partial-fail → flag KEPT, queue retains failures, throws
//   - --resume-gh corrupt JSON → PendingGhOpsCorruptError, flag untouched
//   - unknown subcommand or extra positional → throws

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

import { runInit } from "../src/commands/init.js";
import {
  PendingGhOpsCorruptError,
  readInitPartial,
  setInitPartial,
  type PendingGhOp,
  type PendingGhOpsFile,
} from "../src/lib/init-failure.js";
import type { GhExec, GhResult } from "../src/lib/init-gh.js";
import type { GitExec, GitResult } from "../src/lib/init-state.js";

interface Captured {
  out: string;
  err: string;
}

function capture(): { c: Captured; out: (s: string) => void; err: (s: string) => void } {
  const c: Captured = { out: "", err: "" };
  return { c, out: (s) => (c.out += s), err: (s) => (c.err += s) };
}

function writeMinimalConfig(repo: string): void {
  writeFileSync(
    join(repo, "devx.config.yaml"),
    [
      "devx_version: 0.1.0",
      "mode: YOLO",
      "project:",
      "  shape: empty-dream",
      "thoroughness: send-it",
      "promotion:",
      "  gate: fast-ship-always",
      "",
    ].join("\n"),
  );
}

function writeQueue(repo: string, ops: PendingGhOp[]): string {
  const path = join(repo, ".devx-cache", "pending-gh-ops.json");
  mkdirSync(join(repo, ".devx-cache"), { recursive: true });
  const file: PendingGhOpsFile = {
    version: 1,
    created: "2026-04-27T19:00:00.000Z",
    ops,
  };
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  return path;
}

const okGit: GitExec = (args) => {
  if (args[0] === "remote" && args[1] === "get-url") {
    return { exitCode: 0, stdout: "git@github.com:LeoTheMighty/devx.git\n", stderr: "" };
  }
  if (args[0] === "rev-parse" && args[1] === "HEAD") {
    return { exitCode: 0, stdout: "deadbeef00000000000000000000000000000000\n", stderr: "" };
  }
  if (args[0] === "symbolic-ref") {
    return { exitCode: 0, stdout: "origin/main\n", stderr: "" };
  }
  return { exitCode: 1, stdout: "", stderr: "no script for " + args.join(" ") };
};

function fixedGh(responses: GhResult[]): GhExec {
  let i = 0;
  return () => {
    const next = responses[i++];
    if (!next) throw new Error(`fixedGh: out of responses at call ${i}`);
    return next;
  };
}

describe("ini506 — devx init (no args)", () => {
  it("prints usage on no-args without throwing", () => {
    const { c, out, err } = capture();
    expect(() => runInit([], { out, err })).not.toThrow();
    expect(c.err).toContain("Usage: devx init --resume-gh");
    expect(c.out).toBe("");
  });

  it("rejects unknown subcommand with usage hint", () => {
    const { out, err } = capture();
    expect(() => runInit(["--frob"], { out, err })).toThrow(/unknown subcommand or flag/);
  });

  it("rejects positional after --resume-gh", () => {
    const { out, err } = capture();
    expect(() => runInit(["--resume-gh", "extra"], { out, err })).toThrow(/no positional arguments/);
  });
});

describe("ini506 — devx init --resume-gh", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ini506-resume-"));
    writeMinimalConfig(repo);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("no queue file → no-op message, exits 0, does not touch flag", () => {
    const { c, out, err } = capture();
    expect(() => runInit(["--resume-gh"], { repoRoot: repo, out, err })).not.toThrow();
    expect(c.out).toContain("no pending ops to replay");
    expect(readInitPartial({ repoRoot: repo })).toBe(false);
  });

  it("no queue file but flag stranded → clears the flag", () => {
    setInitPartial({ repoRoot: repo, partial: true });
    const { c, out, err } = capture();
    expect(() => runInit(["--resume-gh"], { repoRoot: repo, out, err })).not.toThrow();
    expect(c.out).toContain("cleared init_partial");
    expect(readInitPartial({ repoRoot: repo })).toBe(false);
  });

  it("all-green replay → clears flag, drains queue, exits 0", () => {
    writeQueue(repo, [
      { kind: "create-develop-branch", payload: { from_sha: "a", repo: "o/r" } },
    ]);
    setInitPartial({ repoRoot: repo, partial: true });
    const { c, out, err } = capture();
    expect(() =>
      runInit(["--resume-gh"], {
        repoRoot: repo,
        out,
        err,
        gh: fixedGh([{ exitCode: 0, stdout: "{}", stderr: "" }]),
        git: okGit,
      }),
    ).not.toThrow();
    expect(c.out).toContain("[ok] create-develop-branch");
    expect(c.out).toMatch(/init_partial cleared/);
    expect(readInitPartial({ repoRoot: repo })).toBe(false);

    // Queue file should be present but emptied.
    const queue = JSON.parse(
      readFileSync(join(repo, ".devx-cache", "pending-gh-ops.json"), "utf8"),
    ) as PendingGhOpsFile;
    expect(queue.ops).toEqual([]);
  });

  it("partial-fail → keeps flag, retains failed op in queue, throws (non-zero exit)", () => {
    writeQueue(repo, [
      { kind: "create-develop-branch", payload: { from_sha: "a", repo: "o/r" } },
      { kind: "set-default-branch", payload: { to: "develop", repo: "o/r" } },
    ]);
    setInitPartial({ repoRoot: repo, partial: true });
    const { c, out, err } = capture();
    expect(() =>
      runInit(["--resume-gh"], {
        repoRoot: repo,
        out,
        err,
        gh: fixedGh([
          { exitCode: 0, stdout: "{}", stderr: "" }, // create-develop OK
          { exitCode: 1, stdout: "", stderr: "HTTP 500 boom" }, // set-default fails
        ]),
        git: okGit,
      }),
    ).toThrow(/1\/2 op\(s\) failed/);

    // Per-op log lines on stdout, summary on stderr.
    expect(c.out).toContain("[ok] create-develop-branch");
    expect(c.out).toContain("[fail] set-default-branch");
    expect(c.err).toContain("init_partial kept");

    // Flag retained.
    expect(readInitPartial({ repoRoot: repo })).toBe(true);

    // Queue retained the FAILED op only.
    const queue = JSON.parse(
      readFileSync(join(repo, ".devx-cache", "pending-gh-ops.json"), "utf8"),
    ) as PendingGhOpsFile;
    expect(queue.ops).toHaveLength(1);
    expect(queue.ops[0].kind).toBe("set-default-branch");
  });

  it("corrupt JSON → throws PendingGhOpsCorruptError, flag untouched", () => {
    mkdirSync(join(repo, ".devx-cache"), { recursive: true });
    writeFileSync(join(repo, ".devx-cache", "pending-gh-ops.json"), "{ broken");
    setInitPartial({ repoRoot: repo, partial: true });
    const { out, err } = capture();
    expect(() =>
      runInit(["--resume-gh"], {
        repoRoot: repo,
        out,
        err,
        gh: fixedGh([]),
        git: okGit,
      }),
    ).toThrow(PendingGhOpsCorruptError);
    expect(readInitPartial({ repoRoot: repo })).toBe(true);
  });

  it("re-running after a partial-fail picks up only the remaining failed op", () => {
    writeQueue(repo, [
      { kind: "create-develop-branch", payload: { from_sha: "a", repo: "o/r" } },
      { kind: "set-default-branch", payload: { to: "develop", repo: "o/r" } },
    ]);
    setInitPartial({ repoRoot: repo, partial: true });

    const c1 = capture();
    expect(() =>
      runInit(["--resume-gh"], {
        repoRoot: repo,
        out: c1.out,
        err: c1.err,
        gh: fixedGh([
          { exitCode: 0, stdout: "{}", stderr: "" },
          { exitCode: 1, stdout: "", stderr: "HTTP 500 transient" },
        ]),
        git: okGit,
      }),
    ).toThrow();

    // Second run only invokes the gh exec ONCE (the create-develop op is gone
    // because it succeeded in run 1; only set-default-branch remains).
    const c2 = capture();
    expect(() =>
      runInit(["--resume-gh"], {
        repoRoot: repo,
        out: c2.out,
        err: c2.err,
        gh: fixedGh([{ exitCode: 0, stdout: "{}", stderr: "" }]),
        git: okGit,
      }),
    ).not.toThrow();

    expect(c2.c.out).toContain("[ok] set-default-branch");
    expect(readInitPartial({ repoRoot: repo })).toBe(false);
  });

  it("commander wiring: buildProgram registers an `init` subcommand", async () => {
    const { buildProgram } = await import("../src/cli.js");
    const program = buildProgram();
    const names = program.commands.map((cmd) => cmd.name());
    expect(names).toContain("init");
  });
});
