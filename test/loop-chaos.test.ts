// Chaos test (v2l101 spec AC): kill -9 mid-iteration ⇒ a fresh `devx loop`
// (or `devx next` row 1) sees CONSISTENT state; the worktree is either clean
// or preserved-with-commits, never half.
//
// Two faces of the same crash:
//   A. The ORCHESTRATOR dies (kill -9 of `devx loop`): state.json says
//      "running" with a dead PID, a state tmp is half-written, the JSONL has
//      a torn final line, the worktree has uncommitted worker output. A
//      fresh run must recover all of it without throwing.
//   B. The WORKER dies mid-iteration (child killed): the driver's
//      transactional handling (resetHard on hard-error) + the next
//      iteration's pre-flight guarantee the worktree never stays half.
//
// The atomicity that makes A recoverable is mgr102's tmp+rename pattern
// (writeAtomic) — state.json is always either the old state or the new one.

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runLoop } from "../src/lib/loop/driver.js";
import {
  eventsPath,
  loopStatePath,
  readEvents,
  readLoopState,
  recoverStaleLoopState,
} from "../src/lib/loop/state.js";
import { type WorkerRunFn } from "../src/lib/loop/worker.js";
import { type TailFn } from "../src/lib/loop/tail.js";

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

let base: string | null = null;
afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true });
  base = null;
});

function makeFixture(hash: string): { repoRoot: string; cacheDir: string; specRel: string } {
  base = mkdtempSync(join(tmpdir(), "devx-loop-chaos-"));
  const origin = join(base, "origin.git");
  const repoRoot = join(base, "repo");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repoRoot]);
  g(repoRoot, "config", "user.email", "loop@test");
  g(repoRoot, "config", "user.name", "loop");
  g(repoRoot, "config", "commit.gpgsign", "false");
  const specRel = `dev/dev-${hash}-2026-07-05T13:00-chaos.md`;
  execFileSync("mkdir", ["-p", join(repoRoot, "dev")]);
  writeFileSync(
    join(repoRoot, specRel),
    `---\nhash: ${hash}\ntype: dev\ncreated: 2026-07-05T13:00:00-06:00\ntitle: chaos item\nstatus: ready\n---\n\n## Goal\n\nchaos.\n\n## Acceptance criteria\n\n- [ ] survives\n\n## Status log\n\n- 2026-07-05T13:00 — created.\n`,
    "utf8",
  );
  writeFileSync(
    join(repoRoot, "DEV.md"),
    `# DEV\n\n- [ ] \`${specRel}\` — chaos item. Status: ready.\n`,
    "utf8",
  );
  writeFileSync(join(repoRoot, ".gitignore"), ".devx-cache/\n.worktrees/\n", "utf8");
  g(repoRoot, "add", "-A");
  g(repoRoot, "commit", "-q", "-m", "fixture");
  g(repoRoot, "push", "-q", "-u", "origin", "main");
  return { repoRoot, cacheDir: join(repoRoot, ".devx-cache"), specRel };
}

const MERGED = {
  mode: "YOLO",
  git: { default_branch: "main", integration_branch: null, branch_prefix: "feat/" },
  loop: { max_iterations_per_item: 4, backoff_ms: [1] },
};

const noopTail: TailFn = async () => ({
  outcome: "handed-off",
  kind: "handed-off-ok",
  prUrl: null,
  prNumber: null,
  detail: "chaos test tail",
});

describe("chaos A — orchestrator killed mid-iteration", () => {
  it("a fresh run recovers the residue: stale state → aborted, torn JSONL tolerated, no throw", async () => {
    const fx = makeFixture("cha001");

    // First run: one committed iteration, then the loop "is killed" —
    // simulated by stopping via signal and then rewriting the residue the
    // way a kill -9 would have left it.
    const ac = new AbortController();
    const worker1: WorkerRunFn = async (_prompt, opts) => {
      writeFileSync(join(opts.cwd, "progress.txt"), "iteration 1\n", "utf8");
      queueMicrotask(() => ac.abort()); // die right after this iteration
      return {
        rawOutput:
          '```json\n{"success":true,"summary":"step 1","key_changes_made":["progress"],"key_learnings":[],"acs_met":false}\n```',
        exitCode: 0,
        graceKilled: false,
        tokens: { input: 10, output: 5, estimated: true },
      };
    };
    const r1 = await runLoop({
      repoRoot: fx.repoRoot,
      merged: MERGED,
      worker: worker1,
      tail: noopTail,
      signal: ac.signal,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
    });
    const runId = r1.summary!.runId;
    const worktree = join(fx.repoRoot, ".worktrees", "dev-cha001");
    expect(existsSync(worktree)).toBe(true);

    // ── Forge the kill -9 residue ────────────────────────────────────────
    // 1. state.json claims "running" under a dead PID (the killed loop).
    writeFileSync(
      loopStatePath(fx.cacheDir),
      JSON.stringify({
        status: "running",
        pid: 999_999_999,
        ts: new Date(Date.now() - 3_600_000).toISOString(),
        run_id: runId,
        started_at: new Date(Date.now() - 7_200_000).toISOString(),
      }),
      "utf8",
    );
    // 2. A half-written state tmp (the atomic writer died pre-rename).
    writeFileSync(loopStatePath(fx.cacheDir) + ".tmp.999.dead", '{"status":"runn', "utf8");
    // 3. A torn final JSONL line (killed mid-append).
    appendFileSync(eventsPath(fx.cacheDir, runId), '{"ts":"2026-07-06T03:00:00Z","event":"iter', "utf8");
    // 4. Uncommitted worker output in the worktree (killed mid-iteration).
    writeFileSync(join(worktree, "half-written.txt"), "half", "utf8");

    // ── Fresh run: the spec is [/] in-progress, so there's nothing to
    // claim — the run must come up, recover, report, and stop cleanly. ────
    const r2 = await runLoop({
      repoRoot: fx.repoRoot,
      merged: MERGED,
      worker: worker1,
      tail: noopTail,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      pidAlive: (pid) => pid === process.pid,
    });
    expect(r2.exitCode).toBe(0);
    expect(r2.summary?.stopReason).toMatch(/no eligible backlog items/);

    // State is consistent: the fresh run's own final state parses and is
    // NOT "running" — `devx next` row 1 can never wedge on the ghost.
    const state = readLoopState(fx.cacheDir);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("stopped");
    // The torn JSONL never poisoned the old run's log.
    const oldEvents = readEvents(fx.cacheDir, runId);
    expect(oldEvents.length).toBeGreaterThan(0);

    // The worktree is preserved-WITH-commits: iteration 1's commit is
    // intact and untouched by the fresh run.
    expect(readFileSync(join(worktree, "progress.txt"), "utf8")).toBe("iteration 1\n");
    expect(g(worktree, "log", "--oneline").split("\n").length).toBeGreaterThanOrEqual(2);
    // (The uncommitted half-file is exactly what a resumed item's
    // pre-flight resets — chaos B pins that.)
    expect(r2.reportPath).not.toBeNull();
  });

  it("recoverStaleLoopState flips the ghost to aborted even standalone", () => {
    const fx = makeFixture("cha002");
    mkdirSync(join(fx.cacheDir, "loop"), { recursive: true });
    writeFileSync(
      loopStatePath(fx.cacheDir),
      JSON.stringify({
        status: "running",
        pid: 999_999_999,
        ts: new Date().toISOString(),
        run_id: "loop-ghost",
        started_at: new Date().toISOString(),
      }),
      "utf8",
    );
    const recovered = recoverStaleLoopState(fx.cacheDir, () => false);
    expect(recovered?.status).toBe("aborted");
  });
});

describe("chaos B — worker killed mid-iteration", () => {
  it("hard-error rollback + pre-flight ⇒ the worktree is never half", async () => {
    const fx = makeFixture("cha003");
    let call = 0;
    const worker: WorkerRunFn = async (_prompt, opts) => {
      call++;
      if (call === 1) {
        // The worker writes half its output, then the process is killed —
        // surfaced to the driver as a thrown error with no report.
        writeFileSync(join(opts.cwd, "half.txt"), "half-written", "utf8");
        throw new Error("worker process killed (SIGKILL)");
      }
      writeFileSync(join(opts.cwd, "whole.txt"), "complete", "utf8");
      return {
        rawOutput:
          '```json\n{"success":true,"summary":"finished cleanly","key_changes_made":["whole.txt"],"key_learnings":[],"acs_met":true}\n```',
        exitCode: 0,
        graceKilled: false,
        tokens: { input: 10, output: 5, estimated: true },
      };
    };
    const tail: TailFn = async () => ({ outcome: "merged", prUrl: "https://pr/1", prNumber: 1 });
    const r = await runLoop({
      repoRoot: fx.repoRoot,
      merged: MERGED,
      worker,
      tail,
      sleep: async () => {},
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
    });

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    expect(item.iterationsFailed).toBe(1);
    expect(item.iterationsGood).toBe(1);

    // The killed iteration's half-file was rolled back — it exists NOWHERE:
    // not on main, and it never reached a commit on the branch.
    const branchFiles = g(fx.repoRoot, "ls-tree", "-r", "--name-only", "feat/dev-cha003");
    expect(branchFiles).not.toContain("half.txt");
    expect(branchFiles).toContain("whole.txt");
    // The [ERROR] entry made it into the on-branch status log (the durable
    // memory a fresh session reads).
    const show = g(fx.repoRoot, "show", `feat/dev-cha003:${fx.specRel}`);
    expect(show).toContain("[ERROR] loop iteration 1: worker process killed (SIGKILL)");
  });
});
