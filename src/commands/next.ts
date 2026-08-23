// `devx next [<hash>]` — the universal next-action CLI.
//
// Two forms:
//
//   devx next <hash>   — v1 workstream-scoped form (v2e101): resolves the
//                        workstream's frontmatter + artifact presence and
//                        prints the single next command per the dispatcher
//                        table's workstream-stage rows (§2 rows 9–12 of
//                        v2/05-dispatcher.md, expressed as the v1 12-row
//                        stage table in src/lib/engine/next.ts).
//
//   devx next          — v2 repo-level form (v2d101): the full 12-row
//                        first-match decision table over backlogs, spec
//                        frontmatter, open PRs + CI, .devx-cache state.
//                        Emits JSON {row, action, command, detail, drift,
//                        warnings} on stdout + one human line on stderr.
//                        Backlog↔frontmatter drift is REPORTED in `drift`,
//                        never silently fixed.
//
// Flags (repo-level form):
//   --prefer plan             — evaluate row 9 (workstream stages) before
//                               row 8 (DEV.md execution).
//   --session-token <token>   — enables the row-5 "claimed by me" check
//                               (same token shape as devx-helper verify-claim).
//   --no-gh                   — skip the gh PR probe (offline / hermetic runs).
//   --all-rows                — diagnostic. Emits {rows, warnings} INSTEAD of
//                               the decision: every parsed backlog row with
//                               its blocker-resolution verdict, from the same
//                               predicate the dispatcher uses. Implies
//                               --no-gh. Diff two runs across a change to
//                               src/lib/backlog/parse.ts to see exactly which
//                               rows the grammar change blocked or unblocked.
//
// Exit codes:
//   0 — decision printed.
//   2 — error: unresolvable hash/workstream, config load failure, bad flag.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md (v1 form)
// Spec: dev/dev-v2d101-2026-07-05T13:05-universal-dispatcher.md (repo form)
// Design: v2/05-dispatcher.md §2; v2/02-engine.md §5

import { join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import * as artifacts from "../lib/engine/artifacts.js";
import { type EngineContext, loadEngineContext } from "../lib/engine/context.js";
import { nextForWorkstream } from "../lib/engine/next.js";
import { renderFocusLine, renderGateSummary } from "../lib/engine/render.js";
import { type TodoDrift, computeTodoDrift } from "../lib/engine/todo.js";
import { loadTodoDoc, todoGroundTruth } from "../lib/engine/todo-truth.js";
import { formatDate } from "../lib/engine/verdict.js";
import {
  type EngineFs,
  WorkstreamError,
  realEngineFs,
  resolveWorkstream,
} from "../lib/engine/workstream.js";
import { decideRepoNext, renderHumanLine } from "../lib/next/decide.js";
import {
  type NextFs,
  gatherRepoSnapshot,
} from "../lib/next/gather.js";
import type { Exec } from "../lib/exec.js";

export interface RunNextOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  /** Repo-level form seams (v2d101). */
  nextFs?: Partial<NextFs>;
  exec?: Exec;
  now?: () => Date;
}

interface ParsedArgs {
  hash: string | null;
  preferPlan: boolean;
  sessionToken: string | undefined;
  skipGh: boolean;
  allRows: boolean;
  error: string | null;
}

function parseNextArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    hash: null,
    preferPlan: false,
    sessionToken: undefined,
    skipGh: false,
    allRows: false,
    error: null,
  };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--prefer") {
      const v = args[i + 1];
      if (v !== "plan") {
        parsed.error = `--prefer accepts only 'plan' (got '${v ?? ""}')`;
        return parsed;
      }
      parsed.preferPlan = true;
      i++;
    } else if (a === "--session-token") {
      const v = args[i + 1];
      // A flag-shaped "value" means the real value was omitted —
      // `--session-token --no-gh` must not swallow the next flag.
      if (v === undefined || v.trim() === "" || v.startsWith("--")) {
        parsed.error = "--session-token requires a non-empty value";
        return parsed;
      }
      parsed.sessionToken = v;
      i++;
    } else if (a === "--no-gh") {
      parsed.skipGh = true;
    } else if (a === "--all-rows") {
      parsed.allRows = true;
    } else if (a.startsWith("--")) {
      parsed.error = `unknown flag '${a}'`;
      return parsed;
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 1) {
    parsed.error =
      "usage: devx next [<hash>] [--prefer plan] [--session-token <token>] [--no-gh] [--all-rows]";
    return parsed;
  }
  parsed.hash = positional[0] ?? null;
  // The flags drive the repo-level table only. Silently ignoring them on
  // the workstream form would let a user believe `--prefer plan` took
  // effect — reject instead (adversarial-review EC#11).
  if (
    parsed.hash !== null &&
    (parsed.preferPlan ||
      parsed.sessionToken !== undefined ||
      parsed.skipGh ||
      parsed.allRows)
  ) {
    parsed.error =
      "--prefer/--session-token/--no-gh/--all-rows apply to the repo-level form only (drop the <hash> argument)";
    return parsed;
  }
  return parsed;
}

export function runNext(args: string[], opts: RunNextOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  const parsed = parseNextArgs(args);
  if (parsed.error !== null) {
    err(`devx next: ${parsed.error}\n`);
    return 2;
  }

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx next: ${ctx.error}\n`);
    return 2;
  }

  if (parsed.hash === null) {
    return runRepoNext(parsed, ctx.ctx, out, err, opts);
  }
  return runWorkstreamNext(parsed.hash, ctx.ctx, out, err, opts);
}

// ---------------------------------------------------------------------------
// Repo-level form (v2d101)
// ---------------------------------------------------------------------------

function runRepoNext(
  parsed: ParsedArgs,
  ctx: EngineContext,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: RunNextOpts,
): number {
  const snapshot = gatherRepoSnapshot({
    repoRoot: ctx.repoRoot,
    merged: ctx.merged,
    engine: ctx.engine,
    fs: opts.nextFs,
    exec: opts.exec,
    now: opts.now,
    sessionToken: parsed.sessionToken,
    // --all-rows reports blocker verdicts, which are derived from backlog
    // rows + spec frontmatter alone. The PR/CI probe would add seconds and
    // a network dependency to a diagnostic whose output it cannot change.
    skipGh: parsed.skipGh || parsed.allRows,
  });
  // Diagnostic view: every parsed row with the SAME blocker verdict the
  // dispatcher computes. Emitted INSTEAD of the decision so the decision's
  // JSON contract (consumed by the /devx skill body) never grows a field,
  // and so a before/after diff over a grammar change is a clean two-file
  // comparison. `gh` is not consulted — the verdict is backlog + spec
  // frontmatter only, so this stays fast and offline-safe.
  if (parsed.allRows) {
    out(`${JSON.stringify({ rows: snapshot.allRows, warnings: snapshot.warnings })}\n`);
    return 0;
  }
  const decision = decideRepoNext(snapshot, { preferPlan: parsed.preferPlan });
  out(
    `${JSON.stringify({
      row: decision.row,
      action: decision.action,
      command: decision.command,
      detail: decision.detail,
      drift: decision.drift,
      warnings: decision.warnings,
      overnight_report: decision.overnightReport,
      loops: decision.loops,
      gate_summary: decision.gateSummary,
      focus: decision.focus,
      todo_drift: decision.todoDrift,
    })}\n`,
  );
  err(`${renderHumanLine(decision)}\n`);
  // Row 9 carries the workstream's gate-summary block (hfi102) plus the
  // focus line (hfi103) — rendered indented under the decision line so
  // they're visible at the dispatcher surface, not just in the JSON.
  // Focus is omitted (not empty) when todo.md is absent. Advisory
  // todo-drift rows render on EVERY decision (they may belong to a
  // workstream the fired row isn't about — e.g. an executing-stage one);
  // drift never changes the exit code (CAP-2).
  if (decision.gateSummary !== null) {
    for (const line of decision.gateSummary.split("\n")) {
      err(`  ${line}\n`);
    }
  }
  if (decision.focus !== null) {
    err(`  ${decision.focus}\n`);
  }
  // Live loops render on EVERY row (mlc105), not only row 1: once N loops
  // are allowed, a run can be live while a more specific row fires, and
  // "what are the other loops on right now" is exactly what stops the
  // human from claiming an item out from under one.
  for (const l of decision.loops) {
    err(
      `  live loop ${l.run_id} (pid ${l.pid}) scope: ${l.scope ?? "all"} · ` +
        `${l.current_item !== null ? `item ${l.current_item}, iteration ${l.iteration}` : "idle"} · ` +
        `heartbeat ${l.age_seconds}s ago\n`,
    );
  }
  for (const d of decision.todoDrift) {
    err(`  todo-drift (${d.class}) ${d.slug}: ${d.message}\n`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Workstream-scoped form (v2e101, unchanged behavior)
// ---------------------------------------------------------------------------

function runWorkstreamNext(
  hash: string,
  ctx: EngineContext,
  out: (s: string) => void,
  err: (s: string) => void,
  opts: RunNextOpts,
): number {
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };

  let ws;
  try {
    ws = resolveWorkstream(ctx.repoRoot, hash, ctx.engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      err(`devx next: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  // evals/ counts as "authored" when it holds anything besides the report
  // this same pipeline writes (RED-report.md is an output, not an input).
  const evalsAbs = artifacts.evalsDirAbs(ws.workstreamAbs);
  let evalsAuthored = false;
  if (fs.exists(evalsAbs)) {
    evalsAuthored = fs.readdir(evalsAbs).some(artifacts.isAuthoredEvalEntry);
  }

  const decision = nextForWorkstream(
    ws.hash,
    ws.state,
    {
      prd: fs.exists(artifacts.prdAbs(ws.workstreamAbs)),
      expectations: fs.exists(artifacts.expectationsAbs(ws.workstreamAbs)),
      design: fs.exists(artifacts.designAbs(ws.workstreamAbs)),
      plan: fs.exists(artifacts.planAbs(ws.workstreamAbs)),
      evalsAuthored,
    },
    // Row 2's pending-outcome branch is measure_by-gated (v2o101).
    formatDate((opts.now ?? (() => new Date()))()),
  );

  // hfi102: the decisions/ listing feeds the FAIL fix-path pointers. An
  // unreadable decisions/ (e.g. a file squatting on the name) degrades to
  // re-run-only pointers rather than crashing the dispatcher.
  const decisionsAbs = artifacts.decisionsDirAbs(ws.workstreamAbs);
  let decisionNames: readonly string[] = [];
  if (fs.exists(decisionsAbs)) {
    try {
      decisionNames = fs.readdir(decisionsAbs);
    } catch {
      // degrade — the summary falls back to re-run-only fix paths
    }
  }

  // hfi103: focus line + advisory todo-drift rows, same degradation posture
  // as the repo-level gatherer — absent todo.md (FR-1 grandfathering) or an
  // unreadable one reads as silence (focus null, drift empty), never a
  // crash and never an exit-code change. Load is the only throw surface
  // (drift's dev-spec probes fail-closed internally), so focus and drift
  // are always set together — no partial state.
  let focus: string | null = null;
  let todoDrift: TodoDrift[] = [];
  let loaded: ReturnType<typeof loadTodoDoc> = null;
  try {
    loaded = loadTodoDoc(fs, ws.workstreamAbs);
  } catch {
    // unreadable todo.md — degrade to silence (advisory-only surface)
  }
  if (loaded !== null) {
    focus = renderFocusLine(loaded.doc, ws.state.stage);
    todoDrift = computeTodoDrift(
      loaded.doc,
      todoGroundTruth(fs, ctx.repoRoot, ws.state, loaded.doc),
    );
  }

  out(
    `${JSON.stringify({
      hash: ws.hash,
      stage: ws.state.stage,
      gate_status: ws.state.gateStatus,
      gate_verdicts: ws.state.gateVerdicts,
      gate_summary: renderGateSummary(ws.state, {
        hash: ws.hash,
        workstreamRel: ws.workstreamRel,
        decisionNames,
        evalsReportExists: fs.exists(artifacts.redReportAbs(ws.workstreamAbs)),
      }),
      focus,
      todo_drift: todoDrift,
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
      "Print the single next action. With <hash>: the workstream-stage rows (v1). Without: the full repo-level 12-row dispatcher table over backlogs, PRs + CI, and .devx-cache state (v2d101).",
    )
    .argument("[hash]", "workstream (plan spec) hash")
    .option("--prefer <what>", "prefer 'plan' — evaluate workstream stages (row 9) before DEV.md execution (row 8)")
    .option("--session-token <token>", "current session's token for the row-5 claimed-by-me check")
    .option("--no-gh", "skip the gh PR probe (offline / hermetic runs)")
    .option(
      "--all-rows",
      "diagnostic: emit every backlog row with its blocker-resolution verdict instead of the decision (no gh probe). Diff before/after a change to the row grammar.",
    )
    .action(
      (
        hash: string | undefined,
        options: {
          prefer?: string;
          sessionToken?: string;
          gh?: boolean;
          allRows?: boolean;
        },
      ) => {
        const args: string[] = [];
        if (hash !== undefined) args.push(hash);
        if (options.prefer !== undefined) args.push("--prefer", options.prefer);
        if (options.sessionToken !== undefined) {
          args.push("--session-token", options.sessionToken);
        }
        // commander's --no-gh sets options.gh === false.
        if (options.gh === false) args.push("--no-gh");
        if (options.allRows === true) args.push("--all-rows");
        const code = runNext(args);
        if (code !== 0) process.exit(code);
      },
    );
  attachPhase(sub, 1);
}
