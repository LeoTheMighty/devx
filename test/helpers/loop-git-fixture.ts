// Shared loop-test git harness (extracted from test/loop-driver.test.ts at
// mss103 so test/loop-iteration.test.ts's E-4 driver scenarios reuse the
// same fixture instead of duplicating it).
//
// Real git fixture (bare origin + clone) so the claim (dvx101), the
// transactional commits/resets, the worktree lifecycle, and the abandon
// flips all run against actual repositories. The worker and the merge tail
// are scripted seams; everything else is production code.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type WorkerRunFn } from "../../src/lib/loop/worker.js";
import { type TailFn } from "../../src/lib/loop/tail.js";

export function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export interface SpecFixture {
  hash: string;
  type?: "dev" | "debug";
  title?: string;
  blockedBy?: string[];
  /** `branch:` frontmatter — a branch-handoff follow-up records its PARENT's
   *  WIP branch here, which switches the claim into mss102 attach mode
   *  (b41f7c). Omitted ⇒ no field, the ordinary derive path. */
  branch?: string;
}

export interface Fixture {
  base: string;
  origin: string;
  repoRoot: string;
  cacheDir: string;
  specRel: (s: SpecFixture) => string;
}

export function specFilename(s: SpecFixture): string {
  const type = s.type ?? "dev";
  return `${type}/${type}-${s.hash}-2026-07-05T13:00-item-${s.hash}.md`;
}

export function makeFixture(specs: SpecFixture[]): Fixture {
  const base = mkdtempSync(join(tmpdir(), "devx-loop-driver-"));
  const origin = join(base, "origin.git");
  const repoRoot = join(base, "repo");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin], { encoding: "utf8" });
  // Teardown race (CI red on PR #103, and a lost local red before it): a push
  // into a bare repo can fire `git gc --auto` in the BACKGROUND on the receive
  // side, which keeps creating objects/locks under origin.git after `git push`
  // has already returned. afterEach's rmSync then walks a directory that is
  // being written to and dies with ENOTEMPTY. Only the split/push-bearing
  // scenarios were affected, which is why it presented as a rare flake rather
  // than a consistent failure. Disable auto-gc on BOTH sides so nothing
  // outlives the command that triggered it.
  g(origin, "config", "gc.auto", "0");
  g(origin, "config", "receive.autogc", "false");
  g(origin, "config", "maintenance.auto", "false");
  execFileSync("git", ["clone", "-q", origin, repoRoot], { encoding: "utf8" });
  g(repoRoot, "config", "user.email", "loop@test");
  g(repoRoot, "config", "user.name", "loop");
  g(repoRoot, "config", "commit.gpgsign", "false");
  g(repoRoot, "config", "gc.auto", "0");
  g(repoRoot, "config", "maintenance.auto", "false");

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
      ...(s.branch !== undefined ? [`branch: ${s.branch}`] : []),
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

export const MERGED = {
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

export type Step =
  | { kind: "report"; report: Partial<IterationReportShape>; files?: Record<string, string> }
  | { kind: "raw"; raw: string; files?: Record<string, string> }
  | { kind: "throw"; message: string };

export interface IterationReportShape {
  success: boolean;
  summary: string;
  key_changes_made: string[];
  key_learnings: string[];
  acs_met: boolean;
  /** mss103: worker-requested mid-story split (any shape — tests send
   *  malformed ones on purpose). */
  split_request?: unknown;
}

export function scriptedWorker(steps: Step[]): { worker: WorkerRunFn; prompts: string[] } {
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
      tokens: { input: 100, output: 50, cacheCreation: 0, cacheRead: 0, estimated: true },
    };
  };
  return { worker, prompts };
}

export const mergedTail = (
  url = "https://github.com/x/y/pull/99",
): { tail: TailFn; calls: number[] } => {
  const calls: number[] = [];
  const tail: TailFn = async () => {
    calls.push(1);
    return { outcome: "merged", prUrl: url, prNumber: 99 };
  };
  return { tail, calls };
};

export const instantSleep = (): { sleep: (ms: number) => Promise<void>; slept: number[] } => {
  const slept: number[] = [];
  return {
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    slept,
  };
};
