// finalize's E1 obligation, proven against a REAL git repo (b931a1).
//
// Lives in its own file because it drives `git` through `spawnSync` — the
// repo partitions synchronous child-process tests into the blocking vitest
// pass (`SYNC_BLOCKING_TESTS`, debug-7c1e93) so they cannot CPU-starve the
// async tests in pass 1. Keeping it beside the 69 fake-exec unit tests in
// `test/devx-finalize.test.ts` would have dragged all of them into the
// serial pass for one test's sake.
//
// What it proves, and why the fake-exec version could not: the AC says "a
// test proves that an unrelated dirty file belonging to a simulated peer
// session is NOT staged or committed." Asserting on the argv finalize builds
// shows it never *says* `git add -A`; only a real repo with a real dirty
// file shows what git actually put in the commit.
//
// Spec: dev/dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { realExec } from "../src/lib/devx/claim.js";
import { type FinalizeOpts, finalize } from "../src/lib/devx/finalize.js";

const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
const tmpRoots: string[] = [];
afterEach(() => {
  stderrSpy.mockClear();
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
const SPEC_REL =
  "dev/dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md";

describe("finalize — E1 against a REAL git repo (the AC's literal obligation)", () => {
  /** A real git repo with a real remote, a real `[/]` backlog row, a real
   *  in-progress spec — and a real dirty file belonging to a simulated peer
   *  session. The scripted-exec tests above assert on argv; this one asserts
   *  on what git actually committed, which is what the AC asks for. */
  function realRepo(): { root: string; peerFile: string } {
    const root = mkdtempSync(join(tmpdir(), "devx-finalize-real-"));
    tmpRoots.push(root);
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    const git = (cwd: string, ...args: string[]) =>
      spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

    mkdirSync(origin, { recursive: true });
    git(origin, "init", "--bare", "-b", "main");
    // Background auto-gc writing into the bare origin outlives `git push` and
    // races teardown's rmSync — the debug-74632d ENOTEMPTY flake. Off.
    git(origin, "config", "gc.auto", "0");
    git(origin, "config", "receive.autogc", "false");
    git(origin, "config", "maintenance.auto", "false");

    git(root, "clone", origin, "work");
    git(work, "config", "user.email", "test@devx.local");
    git(work, "config", "user.name", "devx test");
    git(work, "config", "gc.auto", "0");
    git(work, "config", "maintenance.auto", "false");
    git(work, "config", "commit.gpgsign", "false");

    mkdirSync(join(work, "dev"), { recursive: true });
    writeFileSync(join(work, "devx.config.yaml"), "mode: yolo\n");
    writeFileSync(join(work, "DEV.md"), SAMPLE_DEV_MD);
    writeFileSync(
      join(work, "dev", "dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md"),
      SAMPLE_SPEC,
    );
    // The peer's file: tracked, committed, and then modified — exactly the
    // shape `git add -A` swept into mlc106's cleanup commit (erratum ba3c65b).
    const peerFile = join(work, "dev", "dev-peer-2026-07-29T10:15-live-elsewhere.md");
    writeFileSync(peerFile, "---\nhash: peer\n---\n\noriginal\n");
    git(work, "add", "-A");
    git(work, "commit", "-m", "seed");
    git(work, "push", "-u", "origin", "main");
    writeFileSync(peerFile, "---\nhash: peer\n---\n\nPEER EDIT IN FLIGHT\n");
    // And an untracked one, the other half of what `git add -A` sweeps.
    writeFileSync(join(work, "dev", "dev-peer-untracked.md"), "peer scratch\n");
    return { root: work, peerFile };
  }

  it("commits ONLY mark-done's pathspecs, leaving a peer's dirty + untracked files alone", () => {
    const { root, peerFile } = realRepo();
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })
      .stdout.trim();

    const res = finalize("b931a1", {
      type: "dev",
      config: {},
      pr: 42,
      repoRoot: root,
      exec: realExec,
      readFile: (p: string) => readFileSync(p, "utf8"),
      exists: (p: string) => existsSync(p),
      // The real merge sha: HEAD is trivially its own ancestor, which is the
      // true post-merge shape (the squash commit IS on main by then).
      mergeSha: head,
      sessionToken: null,
      rebuild: false,
      markDone: () => {
        // Stand in for the real markDone: write the two files it owns and
        // return their pathspecs, exactly as it does.
        writeFileSync(join(root, "DEV.md"), SAMPLE_DEV_MD.replace("- [/] ", "- [x] "));
        const spec = join(root, SPEC_REL);
        writeFileSync(spec, SAMPLE_SPEC.replace("status: in-progress", "status: done"));
        return { paths: ["DEV.md", SPEC_REL], todoSynced: false };
      },
    } satisfies FinalizeOpts);

    expect(res.steps.find((s) => s.stage === "commit")?.ok).toBe(true);
    expect(res.steps.find((s) => s.stage === "push")?.ok).toBe(true);

    // THE assertion: what did the commit actually contain?
    const committed = spawnSync(
      "git",
      ["show", "--name-only", "--format=", "HEAD"],
      { cwd: root, encoding: "utf8" },
    ).stdout.trim().split("\n").filter(Boolean).sort();
    expect(committed).toEqual(["DEV.md", SPEC_REL]);

    // The peer's edits survive, uncommitted and unstaged.
    expect(readFileSync(peerFile, "utf8")).toContain("PEER EDIT IN FLIGHT");
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
    expect(status).toMatch(/^ M dev\/dev-peer-2026/m);
    expect(status).toMatch(/^\?\? dev\/dev-peer-untracked\.md/m);

    // And it really reached origin — the 9f24c7 half of the contract.
    const remote = spawnSync("git", ["ls-remote", "origin", "main"], { cwd: root, encoding: "utf8" }).stdout.trim();
    const local = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
    expect(remote.startsWith(local)).toBe(true);
  });
});

