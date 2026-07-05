// `devx next [<hash>]` v1 — workstream-scoped next-command CLI (v2e101).
//
// Resolves the workstream's frontmatter + artifact presence and prints the
// single next command per the dispatcher table's workstream-stage rows
// (v2/05-dispatcher.md §2 rows 9–12). The repo-level no-hash form (live
// loops, open PRs, backlog scans) lands in v2d101 — invoking it today
// exits 2 with a pointer rather than guessing.
//
// Exit codes:
//   0 — decision printed (JSON: { hash, stage, gate_status, next, reason }).
//   2 — error: no hash given (v2d101), unresolvable hash/workstream,
//       config load failure.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/05-dispatcher.md §2; v2/02-engine.md §5

import { join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { nextForWorkstream } from "../lib/engine/next.js";
import {
  type EngineFs,
  WorkstreamError,
  realEngineFs,
  resolveWorkstream,
} from "../lib/engine/workstream.js";

export interface RunNextOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
}

export function runNext(args: string[], opts: RunNextOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };

  if (args.length === 0) {
    err(
      "devx next: the repo-level (no-hash) decision table lands in v2d101 — pass a workstream hash for the v1 workstream-stage rows\n",
    );
    return 2;
  }
  if (args.length > 1) {
    err("usage: devx next [<hash>]\n");
    return 2;
  }

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx next: ${ctx.error}\n`);
    return 2;
  }

  let ws;
  try {
    ws = resolveWorkstream(ctx.ctx.repoRoot, args[0], ctx.ctx.engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      err(`devx next: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  // evals/ counts as "authored" when it holds anything besides the report
  // this same pipeline writes (RED-report.md is an output, not an input).
  const evalsAbs = join(ws.workstreamAbs, "evals");
  let evalsAuthored = false;
  if (fs.exists(evalsAbs)) {
    evalsAuthored = fs
      .readdir(evalsAbs)
      .some((name) => name !== "RED-report.md" && !name.startsWith("."));
  }

  const decision = nextForWorkstream(ws.hash, ws.state, {
    prd: fs.exists(join(ws.workstreamAbs, "prd.md")),
    expectations: fs.exists(join(ws.workstreamAbs, "expectations.md")),
    design: fs.exists(join(ws.workstreamAbs, "design.md")),
    plan: fs.exists(join(ws.workstreamAbs, "plan.md")),
    evalsAuthored,
  });

  out(
    `${JSON.stringify({
      hash: ws.hash,
      stage: ws.state.stage,
      gate_status: ws.state.gateStatus,
      row: decision.row,
      next: decision.command,
      reason: decision.reason,
    })}\n`,
  );
  return 0;
}

export function register(program: Command): void {
  const sub = program
    .command("next")
    .description(
      "Print the single next command for a workstream from its stage + gate_status (v1: workstream rows; repo-level rows land in v2d101).",
    )
    .argument("[hash]", "workstream (plan spec) hash")
    .action((hash: string | undefined) => {
      const code = runNext(hash === undefined ? [] : [hash]);
      if (code !== 0) process.exit(code);
    });
  attachPhase(sub, 1);
}
