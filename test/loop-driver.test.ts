// Loop driver end-to-end scenarios (v2l101 — src/lib/loop/driver.ts).
//
// Real git fixture (bare origin + clone) so the claim (dvx101), the
// transactional commits/resets, the worktree lifecycle, and the abandon
// flips all run against actual repositories. The worker and the merge tail
// are scripted seams; everything else is production code.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultSleep, parseUntil, pickNextItem, runLoop } from "../src/lib/loop/driver.js";
import { readEvents, readLoopState } from "../src/lib/loop/state.js";
import { WorkerTimeoutError, type WorkerRunFn } from "../src/lib/loop/worker.js";
import { type HandOffKind, type TailFn } from "../src/lib/loop/tail.js";

// ---------------------------------------------------------------------------
// Fixture: bare origin + clone with DEV.md + specs
// ---------------------------------------------------------------------------

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

interface SpecFixture {
  hash: string;
  type?: "dev" | "debug";
  title?: string;
  blockedBy?: string[];
}

interface Fixture {
  base: string;
  origin: string;
  repoRoot: string;
  cacheDir: string;
  specRel: (s: SpecFixture) => string;
}

function specFilename(s: SpecFixture): string {
  const type = s.type ?? "dev";
  return `${type}/${type}-${s.hash}-2026-07-05T13:00-item-${s.hash}.md`;
}

function makeFixture(specs: SpecFixture[]): Fixture {
  const base = mkdtempSync(join(tmpdir(), "devx-loop-driver-"));
  const origin = join(base, "origin.git");
  const repoRoot = join(base, "repo");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin], { encoding: "utf8" });
  execFileSync("git", ["clone", "-q", origin, repoRoot], { encoding: "utf8" });
  g(repoRoot, "config", "user.email", "loop@test");
  g(repoRoot, "config", "user.name", "loop");
  g(repoRoot, "config", "commit.gpgsign", "false");

  const devRows: string[] = ["# DEV — backlog", ""];
  const debugRows: string[] = ["# DEBUG — backlog", ""];
  for (const s of specs) {
    const type = s.type ?? "dev";
    const rel = specFilename(s);
    const blocked = s.blockedBy?.length ? ` Blocked-by: ${s.blockedBy.join(", ")}.` : "";
    const row = `- [ ] \`${rel}\` — ${s.title ?? `Item ${s.hash}`}. Status: ready.${blocked}`;
    (type === "debug" ? debugRows : devRows).push(row);
    const spec = [
      "---",
      `hash: ${s.hash}`,
      `type: ${type}`,
      "created: 2026-07-05T13:00:00-06:00",
      `title: ${s.title ?? `Item ${s.hash}`}`,
      "status: ready",
      "---",
      "",
      "## Goal",
      "",
      `Do the ${s.hash} thing.`,
      "",
      "## Acceptance criteria",
      "",
      `- [ ] the ${s.hash} thing works`,
      "",
      "## Status log",
      "",
      "- 2026-07-05T13:00 — created.",
      "",
    ].join("\n");
    execFileSync("mkdir", ["-p", join(repoRoot, type)]);
    writeFileSync(join(repoRoot, rel), spec, "utf8");
  }
  writeFileSync(join(repoRoot, "DEV.md"), devRows.join("\n") + "\n", "utf8");
  writeFileSync(join(repoRoot, "DEBUG.md"), debugRows.join("\n") + "\n", "utf8");
  writeFileSync(join(repoRoot, ".gitignore"), ".devx-cache/\n.worktrees/\n", "utf8");
  g(repoRoot, "add", "-A");
  g(repoRoot, "commit", "-q", "-m", "fixture base");
  g(repoRoot, "push", "-q", "-u", "origin", "main");
  return { base, origin, repoRoot, cacheDir: join(repoRoot, ".devx-cache"), specRel: specFilename };
}

const MERGED = {
  mode: "YOLO",
  git: { default_branch: "main", integration_branch: null, branch_prefix: "feat/" },
  loop: {
    max_iterations_per_item: 4,
    max_tokens_per_item: 1_000_000,
    max_consecutive_failures: 3,
    max_items: 10,
    max_total_tokens: 1_000_000,
    backoff_ms: [1, 2, 3],
  },
};

// ---------------------------------------------------------------------------
// Scripted worker + tail
// ---------------------------------------------------------------------------

type Step =
  | { kind: "report"; report: Partial<IterationReportShape>; files?: Record<string, string> }
  | { kind: "raw"; raw: string; files?: Record<string, string> }
  | { kind: "throw"; message: string };

interface IterationReportShape {
  success: boolean;
  summary: string;
  key_changes_made: string[];
  key_learnings: string[];
  acs_met: boolean;
}

function scriptedWorker(steps: Step[]): { worker: WorkerRunFn; prompts: string[] } {
  const prompts: string[] = [];
  const worker: WorkerRunFn = async (prompt, opts) => {
    prompts.push(prompt);
    const step = steps[Math.min(prompts.length - 1, steps.length - 1)];
    if (step.kind !== "throw" && step.files) {
      for (const [rel, content] of Object.entries(step.files)) {
        writeFileSync(join(opts.cwd, rel), content, "utf8");
      }
    }
    if (step.kind === "throw") throw new Error(step.message);
    const raw =
      step.kind === "report"
        ? `did work\n\n\`\`\`json\n${JSON.stringify({
            success: true,
            summary: "s",
            key_changes_made: [],
            key_learnings: [],
            acs_met: false,
            ...step.report,
          })}\n\`\`\`\n`
        : step.raw;
    return {
      rawOutput: raw,
      exitCode: 0,
      graceKilled: false,
      tokens: { input: 100, output: 50, estimated: true },
    };
  };
  return { worker, prompts };
}

const mergedTail = (url = "https://github.com/x/y/pull/99"): { tail: TailFn; calls: number[] } => {
  const calls: number[] = [];
  const tail: TailFn = async () => {
    calls.push(1);
    return { outcome: "merged", prUrl: url, prNumber: 99 };
  };
  return { tail, calls };
};

const instantSleep = (): { sleep: (ms: number) => Promise<void>; slept: number[] } => {
  const slept: number[] = [];
  return {
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    slept,
  };
};

let fixture: Fixture | null = null;
afterEach(() => {
  if (fixture) rmSync(fixture.base, { recursive: true, force: true });
  fixture = null;
});

function baseOpts(fx: Fixture, extra: Partial<Parameters<typeof runLoop>[0]> = {}) {
  return {
    repoRoot: fx.repoRoot,
    merged: MERGED,
    out: () => {},
    heartbeatIntervalMs: 3_600_000,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// parseUntil + pickNextItem units
// ---------------------------------------------------------------------------

describe("parseUntil", () => {
  const now = new Date("2026-07-05T22:00:00");
  it("today when still ahead, tomorrow when passed", () => {
    expect(parseUntil("23:30", now)?.getDate()).toBe(now.getDate());
    const tomorrow = parseUntil("07:30", now)!;
    expect(tomorrow.getTime()).toBeGreaterThan(now.getTime());
    expect(tomorrow.getHours()).toBe(7);
  });
  it("rejects garbage", () => {
    for (const bad of ["7:99", "25:00", "bedtime", "07:30:00", ""]) {
      expect(parseUntil(bad, now)).toBeNull();
    }
  });
});

describe("pickNextItem", () => {
  it("debug rows outrank dev rows; --only and exclusions respected; blocked_by honored", () => {
    fixture = makeFixture([
      { hash: "dev001" },
      { hash: "dev002", blockedBy: ["dev001"] },
      { hash: "dbg001", type: "debug" },
    ]);
    const opts = { excluded: new Set<string>(), model: "m", now: () => new Date() };
    expect(pickNextItem(fixture.repoRoot, opts)?.hash).toBe("dbg001");
    expect(pickNextItem(fixture.repoRoot, { ...opts, only: "dev" })?.hash).toBe("dev001");
    expect(
      pickNextItem(fixture.repoRoot, { ...opts, excluded: new Set(["dbg001", "dev001"]) })?.hash,
    ).toBeUndefined();
    // dev002 is blocked by dev001 (not done) — masking dev001 must NOT
    // unblock dev002.
  });
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe("runLoop scenarios", () => {
  it("LOCKDOWN refuses entirely (D-6): exit 3, no lock, no state, no claim", async () => {
    fixture = makeFixture([{ hash: "aaa111" }]);
    const { worker } = scriptedWorker([]);
    const r = await runLoop(
      baseOpts(fixture, { merged: { ...MERGED, mode: "LOCKDOWN" }, worker }),
    );
    expect(r.exitCode).toBe(3);
    expect(r.refusedReason).toMatch(/LOCKDOWN/);
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);
    expect(readLoopState(fixture.cacheDir)).toBeNull();
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain("- [ ] `dev/dev-aaa111");
  });

  it("--dry-run prints the full plan without claiming or writing state", async () => {
    fixture = makeFixture([{ hash: "aaa111" }, { hash: "bbb222" }]);
    const lines: string[] = [];
    const r = await runLoop(
      baseOpts(fixture, {
        flags: { dryRun: true },
        out: (l) => lines.push(l),
      }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.plan?.items.map((i) => i.hash)).toEqual(["aaa111", "bbb222"]);
    expect(r.plan?.mode).toBe("YOLO");
    expect(r.plan?.budgets.maxItems).toBe(10);
    expect(lines.join("\n")).toContain("would claim, in order:");
    expect(readLoopState(fixture.cacheDir)).toBeNull();
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain("- [ ] `dev/dev-aaa111");
  });

  it("bad flags exit 4 before any side effect", async () => {
    fixture = makeFixture([{ hash: "aaa111" }]);
    for (const flags of [
      { until: "bedtime" },
      { maxItems: 0 },
      { maxTokens: -5 },
      { only: "plan" },
    ]) {
      const r = await runLoop(baseOpts(fixture, { flags }));
      expect(r.exitCode).toBe(4);
    }
    expect(readLoopState(fixture.cacheDir)).toBeNull();
  });

  it("happy path: success + acs_met → push → tail(merged) → full reconcile", async () => {
    fixture = makeFixture([{ hash: "aaa111", title: "Ship the widget" }]);
    const { worker, prompts } = scriptedWorker([
      {
        kind: "report",
        files: { "widget.txt": "widget v1\n" },
        report: {
          summary: "built the widget",
          key_changes_made: ["widget.txt created"],
          key_learnings: ["widgets are easy"],
          acs_met: true,
        },
      },
    ]);
    const { tail, calls } = mergedTail();
    const r = await runLoop(baseOpts(fixture, { worker, tail }));

    expect(r.exitCode).toBe(0);
    expect(r.summary?.items).toHaveLength(1);
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    expect(item.prUrl).toBe("https://github.com/x/y/pull/99");
    expect(item.iterationsGood).toBe(1);
    expect(calls).toHaveLength(1);

    // Prompt carried the contract.
    expect(prompts[0]).toContain("iteration 1 of at most 4 on spec `aaa111`");

    // Branch pushed to origin BEFORE the tail ran.
    const remoteRefs = execFileSync("git", ["ls-remote", "--heads", fixture.origin], {
      encoding: "utf8",
    });
    expect(remoteRefs).toContain("refs/heads/feat/dev-aaa111");

    // Reconcile: DEV.md [x] + PR link, spec done + status-log line, lock
    // released, worktree removed.
    const devMd = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(devMd).toMatch(/- \[x\] `dev\/dev-aaa111.*Status: done.*PR: https:\/\/github\.com\/x\/y\/pull\/99/);
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "aaa111" })), "utf8");
    expect(spec).toContain("status: done");
    expect(spec).toContain("merged via devx loop — PR https://github.com/x/y/pull/99");
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-aaa111.lock"))).toBe(false);
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-aaa111"))).toBe(false);
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);

    // Report written to both locations; state.json stopped.
    expect(r.reportPath).not.toBeNull();
    expect(readFileSync(r.reportPath!, "utf8")).toContain("1 merged");
    expect(readLoopState(fixture.cacheDir)?.status).toBe("stopped");

    // JSONL log has the lifecycle spine.
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    for (const expected of ["loop:start", "item:claimed", "iteration:start", "iteration:end", "item:pushed", "item:tail", "loop:end"]) {
      expect(events).toContain(expected);
    }
  });

  it("3 consecutive reported failures abandon the item: [-] blocked, lock released, worktree PRESERVED", async () => {
    fixture = makeFixture([{ hash: "bbb222", title: "Doomed thing" }]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "junk.txt": "x" }, report: { success: false, summary: "try 1 failed", key_learnings: ["it is hard"] } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
      { kind: "report", report: { success: false, summary: "try 3 failed" } },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));

    expect(r.exitCode).toBe(0); // one abandoned item is a stop, not an abort
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.iterationsFailed).toBe(3);
    expect(item.worktreePath).toBe(".worktrees/dev-bbb222");
    expect(item.lastFailure).toContain("try 3 failed");

    // Backlog + spec flipped to blocked; lock released.
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(/- \[-\] `dev\/dev-bbb222/);
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "bbb222" })), "utf8");
    expect(spec).toContain("status: blocked");
    expect(spec).toMatch(/\[FAIL\] loop abandoned bbb222/);
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-bbb222.lock"))).toBe(false);

    // Worktree preserved, tree CLEAN (junk was reset), with the on-branch
    // [FAIL] history committed.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-bbb222");
    expect(existsSync(wt)).toBe(true);
    expect(existsSync(join(wt, "junk.txt"))).toBe(false);
    expect(g(wt, "status", "--porcelain")).toBe("");
    const wtSpec = readFileSync(join(wt, fixture.specRel({ hash: "bbb222" })), "utf8");
    expect(wtSpec).toContain("[FAIL] loop iteration 1: try 1 failed");
    expect(wtSpec).toContain("Learning: it is hard");
    expect(wtSpec).toContain("[FAIL] loop iteration 3: try 3 failed");

    // The abandon landed as a commit on main AND was pushed to origin
    // (LOW-11: no loop-owned main commit may be left unpushed silently).
    expect(g(fixture.repoRoot, "log", "-1", "--format=%s")).toContain("abandon bbb222");
    expect(
      execFileSync("git", ["--git-dir", fixture.origin, "log", "-1", "--format=%s"], {
        encoding: "utf8",
      }),
    ).toContain("abandon bbb222");
  });

  it("hard errors ride the backoff ladder; permanent errors abort the loop NOW", async () => {
    fixture = makeFixture([{ hash: "ccc333" }, { hash: "ddd444" }]);
    const { worker } = scriptedWorker([
      { kind: "throw", message: "TypeError: fetch failed" }, // hard → backoff[0]
      { kind: "throw", message: "credit balance is too low" }, // permanent → abort
    ]);
    const { sleep, slept } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { worker, sleep, tail: mergedTail().tail }));

    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/permanent error/i);
    expect(slept).toContain(1); // backoff_ms[0] from MERGED.loop
    // Only the first item was touched; the loop never claimed ddd444.
    expect(r.summary?.items.map((i) => i.hash)).toEqual(["ccc333"]);
    expect(readLoopState(fixture.cacheDir)?.status).toBe("aborted");
    // Report still written (ALWAYS-on-exit).
    expect(readFileSync(r.reportPath!, "utf8")).toContain("ABORTED");
    // The item's claim + worktree are preserved for the morning.
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-ccc333"))).toBe(true);
  });

  it("no-op success (no files, no learnings) is a failure — three of them abandon", async () => {
    fixture = makeFixture([{ hash: "eee555" }]);
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: true, summary: "totally did it", key_learnings: [] } },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.iterationsFailed).toBe(3);
    const wtSpec = readFileSync(
      join(fixture.repoRoot, ".worktrees", "dev-eee555", fixture.specRel({ hash: "eee555" })),
      "utf8",
    );
    expect(wtSpec).toMatch(/\[FAIL\] loop iteration 1: no-op iteration/);
  });

  it("report retry protocol: garbage first output, valid JSON on the retry ask", async () => {
    fixture = makeFixture([{ hash: "fff666" }]);
    const { worker, prompts } = scriptedWorker([
      { kind: "raw", raw: "I did great work but forgot the JSON", files: { "w.txt": "w" } },
      {
        kind: "report",
        report: { summary: "recovered report", key_changes_made: ["w.txt"], acs_met: true },
      },
    ]);
    const { tail } = mergedTail();
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    expect(r.summary!.items[0].outcome).toBe("merged");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Do NOT do any new work");
    expect(prompts[1]).toContain("no JSON object found");
  });

  it("iteration budget exhaustion abandons with the budget reason", async () => {
    fixture = makeFixture([{ hash: "ggg777" }]);
    // Never acs_met, always success — burns the 4-iteration budget.
    const { worker } = scriptedWorker([
      { kind: "report", files: { "inc.txt": "1" }, report: { summary: "inch forward", key_changes_made: ["inc"] } },
      { kind: "report", files: { "inc2.txt": "2" }, report: { summary: "inch forward", key_changes_made: ["inc"] } },
      { kind: "report", files: { "inc3.txt": "3" }, report: { summary: "inch forward", key_changes_made: ["inc"] } },
      { kind: "report", files: { "inc4.txt": "4" }, report: { summary: "inch forward", key_changes_made: ["inc"] } },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.detail).toMatch(/iteration budget exhausted \(4 iterations/);
    expect(item.iterationsGood).toBe(4);
    // The good iterations' commits are preserved in the worktree.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-ggg777");
    expect(existsSync(join(wt, "inc4.txt"))).toBe(true);
  });

  it("--max-items overrides downward only and stops pre-claim", async () => {
    fixture = makeFixture([{ hash: "hhh888" }, { hash: "iii999" }]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "a.txt": "a" }, report: { summary: "done", acs_met: true, key_changes_made: ["a"] } },
    ]);
    const r = await runLoop(
      baseOpts(fixture, { worker, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );
    expect(r.summary?.items).toHaveLength(1);
    expect(r.summary?.stopReason).toMatch(/max items reached \(1\)/);
    // Second item untouched.
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain("- [ ] `dev/dev-iii999");
    // Downward-only: a flag larger than config clamps to config.
    const r2 = await runLoop(baseOpts(fixture, { flags: { dryRun: true, maxItems: 99 } }));
    expect(r2.plan?.budgets.maxItems).toBe(10);
  });

  it("--until stops the loop mid-run, preserving the in-flight item's claim + worktree", async () => {
    fixture = makeFixture([{ hash: "jjj000" }]);
    // Clock: claim + iteration 1 happen at 22:00; the worker flips the clock
    // past the deadline, so the NEXT pre-iteration check exits mid-item.
    let late = false;
    const clock = (): Date =>
      late ? new Date("2026-07-06T07:31:00") : new Date("2026-07-05T22:00:00");
    const { worker } = scriptedWorker([
      { kind: "report", files: { "w.txt": "w" }, report: { summary: "step 1", key_changes_made: ["w"] } },
    ]);
    const flippingWorker: WorkerRunFn = async (prompt, opts) => {
      const r = await worker(prompt, opts);
      late = true;
      return r;
    };
    const r = await runLoop(
      baseOpts(fixture, { worker: flippingWorker, tail: mergedTail().tail, now: clock, flags: { until: "07:30" } }),
    );
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("in-progress-at-exit");
    expect(r.exitCode).toBe(0);
    // Claim + lock + worktree stay for the morning.
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-jjj000.lock"))).toBe(true);
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-jjj000"))).toBe(true);
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(/- \[\/\] `dev\/dev-jjj000/);
    const report = readFileSync(r.reportPath!, "utf8");
    expect(report).toContain("in progress at loop exit");
    // LOW-11: the exit entry is COMMITTED on main (not left as dirt) and
    // pushed to origin.
    expect(g(fixture.repoRoot, "log", "-1", "--format=%s")).toContain(
      "jjj000 in progress at loop exit",
    );
    expect(g(fixture.repoRoot, "status", "--porcelain")).toBe("");
    expect(
      execFileSync("git", ["--git-dir", fixture.origin, "log", "-1", "--format=%s"], {
        encoding: "utf8",
      }),
    ).toContain("jjj000 in progress at loop exit");
  });

  it("push failure at acs_met = abort-item-after-preserving (abandon, commits intact)", async () => {
    fixture = makeFixture([{ hash: "kkk111" }]);
    // A pre-push hook that rejects feature branches but lets the claim's
    // main push through.
    const hooksDir = join(fixture.base, "hooks");
    execFileSync("mkdir", ["-p", hooksDir]);
    // NB: a HEAD push reports local_ref as literal "HEAD" — match on the
    // resolved remote_ref instead.
    writeFileSync(
      join(hooksDir, "pre-push"),
      `#!/bin/sh\nwhile read local_ref local_sha remote_ref remote_sha; do\n  case "$remote_ref" in refs/heads/feat/*) echo "feature pushes rejected" >&2; exit 1;; esac\ndone\nexit 0\n`,
      { mode: 0o755 },
    );
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    const { worker } = scriptedWorker([
      { kind: "report", files: { "k.txt": "k" }, report: { summary: "did it", acs_met: true, key_changes_made: ["k"] } },
    ]);
    const tailCalls: number[] = [];
    const tail: TailFn = async () => {
      tailCalls.push(1);
      return { outcome: "merged", prUrl: "x", prNumber: 1 };
    };
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.detail).toMatch(/push failed \(commit preserved locally\)/);
    expect(tailCalls).toHaveLength(0); // tail never ran
    // The commit is preserved in the worktree.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-kkk111");
    expect(existsSync(join(wt, "k.txt"))).toBe(true);
    expect(g(wt, "status", "--porcelain")).toBe("");
  });

  it("handed-off items keep claim + worktree and surface the tail detail", async () => {
    fixture = makeFixture([{ hash: "lll222" }]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "l.txt": "l" }, report: { summary: "done", acs_met: true, key_changes_made: ["l"] } },
    ]);
    const tail: TailFn = async () => ({
      outcome: "handed-off",
      kind: "handed-off-ok",
      prUrl: "https://github.com/x/y/pull/12",
      prNumber: 12,
      detail: "remote CI concluded 'failure' — not merging",
    });
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("handed-off");
    expect(item.detail).toContain("not merging");
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-lll222"))).toBe(true);
    expect(readFileSync(r.reportPath!, "utf8")).toContain("NOT merged");
  });

  it("lock held → exit 1 (a manager/loop is already running)", async () => {
    fixture = makeFixture([{ hash: "mmm333" }]);
    const { acquireManagerLock } = await import("../src/lib/manage/lock.js");
    const held = acquireManagerLock(fixture.cacheDir);
    try {
      const r = await runLoop(baseOpts(fixture));
      expect(r.exitCode).toBe(1);
      expect(r.refusedReason).toMatch(/manager lock already held/);
    } finally {
      held.release();
    }
  });

  it("abort signal stops cleanly: report written, lock released, state stopped", async () => {
    fixture = makeFixture([{ hash: "nnn444" }, { hash: "ooo555" }]);
    const ac = new AbortController();
    const { worker } = scriptedWorker([
      { kind: "report", files: { "n.txt": "n" }, report: { summary: "step", key_changes_made: ["n"] } },
    ]);
    // Abort after the first worker call returns.
    const abortingWorker: WorkerRunFn = async (prompt, opts) => {
      const r = await worker(prompt, opts);
      ac.abort();
      return r;
    };
    const r = await runLoop(
      baseOpts(fixture, { worker: abortingWorker, tail: mergedTail().tail, signal: ac.signal }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.summary?.stopReason).toMatch(/signal/);
    expect(r.reportPath).not.toBeNull();
    expect(readLoopState(fixture.cacheDir)?.status).toBe("stopped");
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review-fix regression scenarios (BH/EC/AA findings)
// ---------------------------------------------------------------------------

describe("runLoop review-fix scenarios", () => {
  it("permanent-error marker in the output TAIL + failed retry aborts the loop (BH/EC-HIGH, reshaped by MED-3)", async () => {
    fixture = makeFixture([{ hash: "ppp111" }, { hash: "qqq222" }]);
    const { worker, prompts } = scriptedWorker([
      { kind: "raw", raw: "API Error: Your credit balance is too low to access the Anthropic API.\n" },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/permanent error/i);
    // MED-3: the report retry ALWAYS runs first (a marker can be the
    // worked-on code); permanent classification lands only after the retry
    // also failed — exactly TWO worker calls, then abort.
    expect(prompts).toHaveLength(2);
    // The second item was never claimed.
    expect(r.summary?.items.map((i) => i.hash)).toEqual(["ppp111"]);
  });

  it("marker mid-transcript with a recoverable report is NORMAL handling, not permanent (MED-3)", async () => {
    fixture = makeFixture([{ hash: "mkr001" }]);
    // Iteration 1: the worker edited marker-bearing code (the marker text
    // appears mid-transcript, >2000 chars from the end) and forgot its
    // JSON; the retry recovers a valid report. Must NOT abort the loop.
    const { worker, prompts } = scriptedWorker([
      {
        kind: "raw",
        raw:
          "updated ladder.ts markers: credit balance is too low added\n" +
          "x".repeat(3000) +
          "\nran tests, all green — oops, forgot the JSON block",
        files: { "m.txt": "m" },
      },
      {
        kind: "report",
        report: { summary: "recovered", key_changes_made: ["m.txt"], acs_met: true },
      },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    expect(r.exitCode).toBe(0);
    expect(r.summary?.abortReason).toBeNull();
    expect(r.summary!.items[0].outcome).toBe("merged");
    expect(prompts).toHaveLength(2);
  });

  it("3 consecutive abandoned items stop the whole loop (AA-F3): exit 2, 4th item untouched", async () => {
    fixture = makeFixture([
      { hash: "abn001" },
      { hash: "abn002" },
      { hash: "abn003" },
      { hash: "abn004" },
    ]);
    // max_consecutive_failures 1 → every item abandons after one failure.
    const merged = {
      ...MERGED,
      loop: { ...MERGED.loop, max_consecutive_failures: 1 },
    };
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "doomed" } },
    ]);
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));
    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/3 consecutive items abandoned or handed off failing/);
    expect(r.summary?.items.map((i) => i.outcome)).toEqual([
      "abandoned",
      "abandoned",
      "abandoned",
    ]);
    // The 4th item stays [ ] ready — the loop stopped before churning it.
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain(
      "- [ ] `dev/dev-abn004",
    );
  });

  it("per-item token budget exhaustion abandons the item (AA-F4)", async () => {
    fixture = makeFixture([{ hash: "tok001" }]);
    // Worker reports 150 tokens/iteration; cap at 100 → abandon before iteration 2.
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_tokens_per_item: 100 } };
    const { worker } = scriptedWorker([
      { kind: "report", files: { "t.txt": "t" }, report: { summary: "step", key_changes_made: ["t"] } },
    ]);
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.detail).toMatch(/per-item token budget exhausted/);
  });

  it("--max-tokens (total) stops mid-item as in-progress-at-exit + clamps downward only (AA-F4)", async () => {
    fixture = makeFixture([{ hash: "tok002" }]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "t.txt": "t" }, report: { summary: "step", key_changes_made: ["t"] } },
    ]);
    const r = await runLoop(
      baseOpts(fixture, { worker, tail: mergedTail().tail, flags: { maxTokens: 100 } }),
    );
    expect(r.summary!.items[0].outcome).toBe("in-progress-at-exit");
    expect(r.summary?.stopReason).toMatch(/total token budget exhausted/);
    // Downward-only clamp visible in dry-run.
    const r2 = await runLoop(baseOpts(fixture, { flags: { dryRun: true, maxTokens: 10 ** 12 } }));
    expect(r2.plan?.budgets.maxTotalTokens).toBe(MERGED.loop.max_total_tokens);
  });

  it("commit-failure → ONE repair iteration; a failed repair clears pendingRepair (BH-HIGH-1)", async () => {
    fixture = makeFixture([{ hash: "rep001" }]);
    // pre-commit hook fails only inside worktrees while the flag exists.
    const hooksDir = join(fixture.base, "hooks");
    const flagPath = join(fixture.base, "commit-blocked");
    execFileSync("mkdir", ["-p", hooksDir]);
    writeFileSync(
      join(hooksDir, "pre-commit"),
      `#!/bin/sh\ncase "$PWD" in *".worktrees/"*) [ -f "${flagPath}" ] && { echo "hook says no" >&2; exit 1; } ;; esac\nexit 0\n`,
      { mode: 0o755 },
    );
    writeFileSync(flagPath, "1", "utf8");
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    const { worker, prompts } = scriptedWorker([
      // 1: success report + files → loop commit FAILS (hook) → repair pending.
      { kind: "report", files: { "r.txt": "r" }, report: { summary: "wrote r", key_changes_made: ["r"] } },
      // 2: repair iteration reports failure → rollback; pendingRepair must clear.
      { kind: "report", report: { success: false, summary: "could not repair" } },
      // 3: fresh (non-repair) iteration succeeds and finishes the item.
      { kind: "report", files: { "r2.txt": "r2" }, report: { summary: "did it cleanly", key_changes_made: ["r2"], acs_met: true } },
    ]);
    // Unblock commits once the repair iteration runs.
    const unblockingWorker: WorkerRunFn = async (prompt, opts) => {
      const res = await worker(prompt, opts);
      if (prompts.length === 2) rmSync(flagPath, { force: true });
      return res;
    };
    const { tail } = mergedTail();
    const r = await runLoop(baseOpts(fixture, { worker: unblockingWorker, tail }));

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).not.toContain("REPAIR-ONLY");
    expect(prompts[1]).toContain("REPAIR-ONLY ITERATION");
    expect(prompts[1]).toContain("hook says no");
    // BH-HIGH-1: after the failed repair rolled back, iteration 3 must be a
    // NORMAL prompt again — not a stale repair prompt against a clean tree.
    expect(prompts[2]).not.toContain("REPAIR-ONLY");
    expect(r.summary!.items[0].outcome).toBe("merged");
    expect(r.summary!.items[0].iterationsFailed).toBe(2);
  });

  it("repair-iteration failure salvages the preserved work via a commit re-attempt (MED-2)", async () => {
    fixture = makeFixture([{ hash: "sal001" }]);
    // pre-commit hook blocks worktree commits while the flag exists —
    // the "transiently failing" commit seam.
    const hooksDir = join(fixture.base, "hooks");
    const flagPath = join(fixture.base, "commit-blocked");
    execFileSync("mkdir", ["-p", hooksDir]);
    writeFileSync(
      join(hooksDir, "pre-commit"),
      `#!/bin/sh\ncase "$PWD" in *".worktrees/"*) [ -f "${flagPath}" ] && { echo "hook says no" >&2; exit 1; } ;; esac\nexit 0\n`,
      { mode: 0o755 },
    );
    writeFileSync(flagPath, "1", "utf8");
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    const { worker, prompts } = scriptedWorker([
      // 1: success + precious files → loop commit FAILS → preserved + repair pending.
      { kind: "report", files: { "precious.txt": "prior work\n" }, report: { summary: "wrote precious", key_changes_made: ["precious"] } },
      // 2: the repair iteration HARD-ERRORS. Pre-MED-2 this reset away the
      //    preserved work; now the loop re-attempts the commit first.
      { kind: "throw", message: "TypeError: boom mid-repair" },
      // 3: reported failure → 3rd consecutive failure → abandon (worktree preserved).
      { kind: "report", report: { success: false, summary: "still stuck" } },
    ]);
    // The transient unblock: the flag clears while iteration 2's worker
    // runs, so the salvage re-attempt after its hard error succeeds.
    const unblocking: WorkerRunFn = async (prompt, opts) => {
      if (prompts.length === 1) rmSync(flagPath, { force: true });
      return worker(prompt, opts);
    };
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { worker: unblocking, sleep, tail: mergedTail().tail }));

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    // The prior iteration's work is COMMITTED in the preserved worktree,
    // not discarded.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-sal001");
    expect(readFileSync(join(wt, "precious.txt"), "utf8")).toBe("prior work\n");
    expect(g(wt, "log", "--format=%s")).toContain("salvage work preserved across a commit failure");
    expect(g(wt, "status", "--porcelain")).toBe("");
    // The [ERROR] entry says the salvage happened.
    const wtSpec = readFileSync(join(wt, fixture.specRel({ hash: "sal001" })), "utf8");
    expect(wtSpec).toContain("preserved work committed via salvage re-attempt");
    // Iteration 3 was a NORMAL prompt (pendingRepair cleared by the salvage).
    expect(prompts[2]).not.toContain("REPAIR-ONLY");
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("iteration:repair-salvage-committed");
  });

  it("salvage re-attempt that ALSO fails resets and records the discarded-diff stat (MED-2)", async () => {
    fixture = makeFixture([{ hash: "sal002" }]);
    const hooksDir = join(fixture.base, "hooks");
    execFileSync("mkdir", ["-p", hooksDir]);
    // Commits in worktrees fail unconditionally — the failure is permanent.
    writeFileSync(
      join(hooksDir, "pre-commit"),
      `#!/bin/sh\ncase "$PWD" in *".worktrees/"*) echo "hook says no" >&2; exit 1;; esac\nexit 0\n`,
      { mode: 0o755 },
    );
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    // max_consecutive_failures 2 ⇒ the hard-erroring repair iteration is
    // the 2nd failure and abandons — leaving the worktree (and its spec's
    // uncommitted [ERROR] entry) for inspection.
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_consecutive_failures: 2 } };
    const { worker } = scriptedWorker([
      { kind: "report", files: { "doomed.txt": "will be discarded\n" }, report: { summary: "wrote doomed", key_changes_made: ["d"] } },
      { kind: "throw", message: "TypeError: boom mid-repair" },
    ]);
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { merged, worker, sleep, tail: mergedTail().tail }));

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    const wt = join(fixture.repoRoot, ".worktrees", "dev-sal002");
    // The preserved work WAS discarded (both commit attempts failed)…
    expect(existsSync(join(wt, "doomed.txt"))).toBe(false);
    // …and the [ERROR] entry says exactly what was lost.
    const wtSpec = readFileSync(join(wt, fixture.specRel({ hash: "sal002" })), "utf8");
    expect(wtSpec).toMatch(/salvage re-attempt also failed; discarded preserved work: \d+ tracked files/);
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("iteration:repair-salvage-failed");
  });

  it("abandoned items WITH committed progress don't trip the systemic 3-stop (MED-4)", async () => {
    fixture = makeFixture([
      { hash: "big001" },
      { hash: "big002" },
      { hash: "big003" },
      { hash: "big004" },
    ]);
    // 1 iteration/item: every item makes one good committed iteration and
    // then abandons on the iteration budget — big, not broken.
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 1 } };
    const { worker } = scriptedWorker([
      { kind: "report", files: { "inc.txt": "1" }, report: { summary: "inch", key_changes_made: ["inc"] } },
    ]);
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));
    // All FOUR items ran (no abort at 3) and the loop stopped normally.
    expect(r.exitCode).toBe(0);
    expect(r.summary?.abortReason).toBeNull();
    expect(r.summary?.items.map((i) => i.outcome)).toEqual([
      "abandoned",
      "abandoned",
      "abandoned",
      "abandoned",
    ]);
    expect(r.summary?.items.every((i) => i.iterationsGood === 1)).toBe(true);
  });

  it("3 consecutive handed-off-FAILURE tails trip the systemic stop; the next item is untouched (MED-6)", async () => {
    fixture = makeFixture([
      { hash: "out001" },
      { hash: "out002" },
      { hash: "out003" },
      { hash: "out004" },
    ]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "o.txt": "o" }, report: { summary: "done", key_changes_made: ["o"], acs_met: true } },
    ]);
    // gh outage shape: every tail fails to create the PR.
    const tail: TailFn = async () => ({
      outcome: "handed-off",
      kind: "handed-off-failure",
      prUrl: null,
      prNumber: null,
      detail: "gh pr create failed (exit 4): connection refused",
    });
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/3 consecutive items abandoned or handed off failing/);
    expect(r.summary?.items.map((i) => i.outcome)).toEqual([
      "handed-off",
      "handed-off",
      "handed-off",
    ]);
    // The 4th item was never claimed — no stranded claims during an outage.
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain(
      "- [ ] `dev/dev-out004",
    );
  });

  it("a handed-off-OK tail resets the failure-hand-off streak (MED-6)", async () => {
    fixture = makeFixture([
      { hash: "mix001" },
      { hash: "mix002" },
      { hash: "mix003" },
      { hash: "mix004" },
    ]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "m.txt": "m" }, report: { summary: "done", key_changes_made: ["m"], acs_met: true } },
    ]);
    const kinds: HandOffKind[] = [
      "handed-off-failure",
      "handed-off-failure",
      "handed-off-ok", // CI-red shape — the system worked; resets the rail
      "handed-off-failure",
    ];
    let call = 0;
    const tail: TailFn = async () => ({
      outcome: "handed-off",
      kind: kinds[Math.min(call++, kinds.length - 1)],
      prUrl: null,
      prNumber: null,
      detail: "scripted",
    });
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    // No systemic abort: fail, fail, ok(reset), fail never reaches 3.
    expect(r.exitCode).toBe(0);
    expect(r.summary?.abortReason).toBeNull();
    expect(r.summary?.items).toHaveLength(4);
  });

  it("3 consecutive claim failures stop the loop instead of walking the backlog (MED-7)", async () => {
    fixture = makeFixture([
      { hash: "clm001" },
      { hash: "clm002" },
      { hash: "clm003" },
      { hash: "clm004" },
      { hash: "clm005" },
    ]);
    const { worker } = scriptedWorker([]);
    const claim = async (): Promise<never> => {
      throw new Error("locks dir unwritable");
    };
    const r = await runLoop(baseOpts(fixture, { worker, claim, tail: mergedTail().tail }));
    expect(r.exitCode).toBe(0);
    expect(r.summary?.stopReason).toMatch(/3 consecutive claim failures/);
    expect(r.summary?.items.map((i) => i.outcome)).toEqual([
      "claim-failed",
      "claim-failed",
      "claim-failed",
    ]);
    // Rows 4+5 untouched — the loop did NOT churn the rest of the backlog.
    const devMd = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(devMd).toContain("- [ ] `dev/dev-clm004");
    expect(devMd).toContain("- [ ] `dev/dev-clm005");
  });

  it("a successful claim resets the claim-failure counter (MED-7)", async () => {
    fixture = makeFixture([
      { hash: "cnt001" },
      { hash: "cnt002" },
      { hash: "cnt003" },
      { hash: "cnt004" },
    ]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "c.txt": "c" }, report: { summary: "done", key_changes_made: ["c"], acs_met: true } },
    ]);
    // Fail, fail, succeed (reset), fail, fail — never 3 consecutive.
    const { claimSpec } = await import("../src/lib/devx/claim.js");
    let call = 0;
    const failing = new Set([1, 2, 4, 5]);
    const fx = fixture;
    const claim = async (hash: string, type: string) => {
      call++;
      if (failing.has(call)) throw new Error(`synthetic claim outage ${call}`);
      return claimSpec(hash, {
        sessionId: "cnt-test",
        repoRoot: fx.repoRoot,
        config: MERGED,
        type,
      });
    };
    const r = await runLoop(baseOpts(fixture, { worker, claim, tail: mergedTail().tail }));
    expect(r.summary?.stopReason).not.toMatch(/claim failures/);
    const outcomes = r.summary!.items.map((i) => i.outcome);
    expect(outcomes.filter((o) => o === "claim-failed")).toHaveLength(3);
    expect(outcomes.filter((o) => o === "merged")).toHaveLength(1);
  });

  it("a timed-out worker's estimated tokens still land in the budgets (MED-8)", async () => {
    fixture = makeFixture([{ hash: "tmo001" }]);
    const worker: WorkerRunFn = async () => {
      throw new WorkerTimeoutError("worker session exceeded the 60min iteration ceiling and was killed", {
        input: 500,
        output: 700,
        estimated: true,
      });
    };
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { worker, sleep, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned"); // 3 hard errors
    // 3 iterations × (500 in + 700 out), all accounted.
    expect(item.tokens.input).toBe(1500);
    expect(item.tokens.output).toBe(2100);
    expect(item.tokens.estimated).toBe(true);
    expect(r.summary!.totals.input).toBe(1500);
    expect(r.summary!.totals.output).toBe(2100);
  });

  it("abort before the report retry skips the second spawn (LOW-13)", async () => {
    fixture = makeFixture([{ hash: "abt001" }]);
    const ac = new AbortController();
    const prompts: string[] = [];
    const worker: WorkerRunFn = async (prompt) => {
      prompts.push(prompt);
      ac.abort(); // SIGTERM lands while the worker runs; output has no JSON
      return {
        rawOutput: "some progress but no report",
        exitCode: 0,
        graceKilled: false,
        tokens: { input: 10, output: 10, estimated: true },
      };
    };
    const r = await runLoop(
      baseOpts(fixture, { worker, tail: mergedTail().tail, signal: ac.signal }),
    );
    // No retry spawn against a draining run.
    expect(prompts).toHaveLength(1);
    expect(r.summary!.items[0].outcome).toBe("in-progress-at-exit");
  });

  it("lock-release failure is evented and WARNed in the morning report (LOW-10)", async () => {
    fixture = makeFixture([{ hash: "lck001" }]);
    const locksDir = join(fixture.cacheDir, "locks");
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "doomed" } },
    ]);
    // Make the locks dir read-only after the LAST iteration so ownsClaim
    // can still read the lock but the abandon's unlink fails.
    let calls = 0;
    const chmodWorker: WorkerRunFn = async (p, o) => {
      const res = await worker(p, o);
      calls++;
      if (calls === 3) chmodSync(locksDir, 0o555);
      return res;
    };
    try {
      const r = await runLoop(baseOpts(fixture, { worker: chmodWorker, tail: mergedTail().tail }));
      const item = r.summary!.items[0];
      expect(item.outcome).toBe("abandoned");
      expect(
        item.warnings?.some((w) => w.includes("spec lock could not be released")),
      ).toBe(true);
      expect(readFileSync(r.reportPath!, "utf8")).toContain(
        "WARN: spec lock could not be released",
      );
      const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
      expect(events).toContain("item:lock-release-failed");
    } finally {
      chmodSync(locksDir, 0o755);
    }
  });

  it("exitInProgress halts without touching main when claim ownership was lost (LOW-11 / roc101)", async () => {
    fixture = makeFixture([{ hash: "own001" }]);
    const fx = fixture;
    const { worker } = scriptedWorker([
      { kind: "report", files: { "w.txt": "w" }, report: { summary: "step", key_changes_made: ["w"] } },
    ]);
    // A peer "steals" the claim mid-run: the lock file vanishes after
    // iteration 1; the token-budget stop then exits mid-item.
    const stealingWorker: WorkerRunFn = async (prompt, opts) => {
      const res = await worker(prompt, opts);
      rmSync(join(fx.cacheDir, "locks", "spec-own001.lock"), { force: true });
      return res;
    };
    const r = await runLoop(
      baseOpts(fixture, { worker: stealingWorker, tail: mergedTail().tail, flags: { maxTokens: 100 } }),
    );
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("in-progress-at-exit");
    expect(item.detail).toContain("claim ownership lost");
    // Main spec untouched, no loop-owned exit commit on main.
    const spec = readFileSync(join(fx.repoRoot, fx.specRel({ hash: "own001" })), "utf8");
    expect(spec).not.toContain("loop stopped mid-item");
    expect(g(fx.repoRoot, "log", "-1", "--format=%s")).toContain("claim own001");
  });

  it("main-push failure after a loop-owned commit is tolerated with a report WARN (LOW-11)", async () => {
    fixture = makeFixture([{ hash: "psh001" }]);
    // pre-push hook: reject pushes once the flag exists (the claim's own
    // push happens before the flag is created).
    const hooksDir = join(fixture.base, "hooks");
    const flagPath = join(fixture.base, "push-blocked");
    execFileSync("mkdir", ["-p", hooksDir]);
    writeFileSync(
      join(hooksDir, "pre-push"),
      `#!/bin/sh\n[ -f "${flagPath}" ] && { echo "origin down" >&2; exit 1; }\nexit 0\n`,
      { mode: 0o755 },
    );
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "doomed" } },
    ]);
    const flaggingWorker: WorkerRunFn = async (p, o) => {
      const res = await worker(p, o);
      writeFileSync(flagPath, "1", "utf8");
      return res;
    };
    const r = await runLoop(baseOpts(fixture, { worker: flaggingWorker, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    // The abandon commit landed locally; the push failure became a WARN,
    // not a crash.
    expect(g(fixture.repoRoot, "log", "-1", "--format=%s")).toContain("abandon psh001");
    expect(item.warnings?.some((w) => w.includes("main is ahead of origin"))).toBe(true);
    expect(readFileSync(r.reportPath!, "utf8")).toContain("WARN: main is ahead of origin");
  });

  it("merged items carry real diff stats (BH-MED-6) and don't sweep user-staged work on main (BH-MED-5)", async () => {
    fixture = makeFixture([{ hash: "dif001" }]);
    // The user left something staged in the main worktree overnight.
    writeFileSync(join(fixture.repoRoot, "user-wip.txt"), "half-finished\n", "utf8");
    g(fixture.repoRoot, "add", "user-wip.txt");

    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "shipped.txt": "line1\nline2\nline3\n" },
        report: { summary: "shipped", key_changes_made: ["shipped.txt"], acs_met: true },
      },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    // Diff captured BEFORE the worktree was removed.
    expect(item.diff?.filesChanged).toBeGreaterThan(0);
    expect(item.diff?.linesAdded).toBeGreaterThan(0);
    // The mark-done commit on main did NOT include the user's staged file.
    const lastCommitFiles = g(fixture.repoRoot, "show", "--name-only", "--format=", "HEAD");
    expect(lastCommitFiles).not.toContain("user-wip.txt");
    // ...and the staged work is still staged, untouched.
    expect(g(fixture.repoRoot, "diff", "--cached", "--name-only")).toContain("user-wip.txt");
  });
});

// ---------------------------------------------------------------------------
// defaultSleep (LOW-9 — the backoff/CI-poll sleep must wake on abort)
// ---------------------------------------------------------------------------

describe("defaultSleep", () => {
  it("resolves immediately when the signal aborts mid-sleep (SIGTERM during backoff)", async () => {
    const ac = new AbortController();
    const started = Date.now();
    const p = defaultSleep(60_000, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await p;
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("resolves immediately on an already-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const started = Date.now();
    await defaultSleep(60_000, ac.signal);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("sleeps the full duration without a signal", async () => {
    const started = Date.now();
    await defaultSleep(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});
