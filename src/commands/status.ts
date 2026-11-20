// `devx status` — the minimal real workstream status renderer (hfi103,
// workstream harness-fold-in Phase 3; replaces the cli302 stub).
//
// Scans `plan/` for engine-managed specs (stage frontmatter present) whose
// `workstream:` chain resolves, and renders one block per active
// workstream — active = stage ∉ {done, retired}, plus done-with-outcome-
// pending (a closed workstream still owes its outcome score):
//
//   <slug> (<hash>)  stage: <stage>
//     gates: prd PASS · design FAIL · plan — · evals —
//       design FAIL → report: … · re-run: devx gate coverage <hash>
//     focus: <current focus from the todo walk>
//     health: 2 blocking · 1 concern   (the questions.md queue, B11)
//
// Workstream identity derives from the scanned FILE (frontmatter
// `workstream:` → filename-slug fallback) — the same derivation the `devx
// next` gatherer uses — never a hash round-trip through the by-filename
// resolver, so the two surfaces can't disagree about the same spec
// (adversarial-review EH#1/BH#3: a frontmatter hash that doesn't match the
// filename would silently vanish here while still surfacing in next).
//
// Deliberately a thin renderer over engine reads (renderGateSummary +
// renderFocusLine — the same helpers `devx next` consumes) so Concierge
// (roadmap Phase 2) extends rather than replaces it. Read-only; exit 0
// (2 only on config-load failure, matching every engine command) —
// unreadable dirs/specs degrade per-entry, never a crash.
//
// Spec: dev/dev-hfi103-2026-07-24T10:41-todo-sync-renderers-status.md
// Design: _devx/workstreams/harness-fold-in/design/agent.md §Interfaces

import { join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import * as artifacts from "../lib/engine/artifacts.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  renderFocusLine,
  renderGateSummary,
  renderHealthLine,
} from "../lib/engine/render.js";
import { healthCounts } from "../lib/engine/questions.js";
import { loadQuestions } from "../lib/engine/questions-io.js";
import { loadTodoDoc } from "../lib/engine/todo-truth.js";
import { heartbeatIntervalMsFrom } from "../lib/loop/config.js";
import { listLiveInstances } from "../lib/loop/instances.js";
import {
  type EngineFs,
  enumerateEngineWorkstreams,
  realEngineFs,
} from "../lib/engine/workstream.js";

export interface RunStatusOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  /** Clock seam (live-loop freshness). */
  now?: () => Date;
}

export function runStatus(opts: RunStatusOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx status: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;

  // One walk, shared with `devx board` (and the reason runStatus's header
  // warns about identity drift): the enumerator owns the plan/ scan, the
  // D-13 warnings, and the hash/slug/base derivation.
  const blocks: string[] = [];
  for (const ws of enumerateEngineWorkstreams(fs, repoRoot, engine, (m) =>
    err(`devx status: ${m}\n`),
  )) {
    const { state, base, hash, slug } = ws;
    const active = state.stage !== "done" && state.stage !== "retired";
    const outcomePending =
      state.stage === "done" && state.outcome.status === "pending";
    if (!active && !outcomePending) continue;

    const decisionsAbs = artifacts.decisionsDirAbs(base);
    let decisionNames: readonly string[] = [];
    if (fs.exists(decisionsAbs)) {
      try {
        decisionNames = fs.readdir(decisionsAbs);
      } catch {
        // degrade — FAIL rows fall back to re-run-only fix paths
      }
    }
    const summary = renderGateSummary(state, {
      hash,
      workstreamRel: base.workstreamRel,
      layout: base.layout,
      decisionNames,
      evalsReportExists: artifacts.artifactExists(fs, base, { kind: "red-report" }),
    });

    let focusLine: string | null = null;
    try {
      const loaded = loadTodoDoc(fs, base);
      focusLine = renderFocusLine(loaded?.doc ?? null, state.stage);
    } catch {
      // unreadable todo.md — the focus line is advisory; omit it
    }

    // B11: the health-queue line. `loadQuestions` never throws and reports a
    // malformed queue with its reason rather than zeroes, so there is no
    // try/catch here and no way for a bad entry to make this block render a
    // confident `0 blocking` over a file that may hold four.
    const questions = loadQuestions(fs, base);
    const healthLine =
      questions === null
        ? null
        : renderHealthLine(
            questions.error === null ? healthCounts(questions.entries) : null,
            questions.error,
          );

    const lines = [
      `${slug} (${hash})  stage: ${state.stage}${outcomePending ? " (outcome pending)" : ""}`,
      ...summary.split("\n").map((l) => `  ${l}`),
    ];
    if (focusLine !== null) lines.push(`  ${focusLine}`);
    if (healthLine !== null) lines.push(`  ${healthLine}`);
    blocks.push(lines.join("\n"));
  }

  // Live loops (mlc105) — the same registry `devx next` row 1 aggregates,
  // rendered here so `devx status` answers "is anything running right now"
  // without a second command. Read-only and fail-soft: a corrupt registry
  // degrades to no section, never a non-zero exit.
  const loopBlock = renderLiveLoops(repoRoot, ctx.ctx.merged, fs, opts.now);

  const body =
    blocks.length > 0 ? blocks.join("\n\n") : "no active workstreams";
  out(loopBlock !== null ? `${loopBlock}\n\n${body}\n` : `${body}\n`);
  return 0;
}

function renderLiveLoops(
  repoRoot: string,
  merged: unknown,
  fs: EngineFs,
  now: (() => Date) | undefined,
): string | null {
  const cacheDir = join(repoRoot, ".devx-cache");
  let live;
  try {
    live = listLiveInstances(cacheDir, {
      ...(now !== undefined ? { now } : {}),
      // Same window derivation as gather.ts / the driver's beat: 3 ×
      // manager.heartbeat_interval_s. Three surfaces, one knob.
      freshMs: heartbeatIntervalMsFrom(merged) * 3,
      readdir: (p) => [...fs.readdir(p)],
      readFile: (p) => fs.readFile(p),
    });
  } catch {
    return null;
  }
  if (live.length === 0) return null;
  const lines = [`live loops: ${live.length}`];
  for (const i of live) {
    const tsMs = Date.parse(i.ts);
    const age = Number.isFinite(tsMs)
      ? `${Math.round(((now ? now() : new Date()).getTime() - tsMs) / 1000)}s ago`
      : "unknown";
    lines.push(
      `  ${i.run_id} (pid ${i.pid})  scope: ${i.scope ?? "all"} · ` +
        `${i.current_item !== null ? `item ${i.current_item}, iteration ${i.iteration}` : "idle"} · ` +
        `heartbeat ${age}`,
    );
  }
  return lines.join("\n");
}

export function register(program: Command): void {
  const sub = program
    .command("status")
    .description(
      "Per-workstream status: stage, gate summary (verdicts + FAIL fix paths), the current todo focus, and the health-queue counts for every active workstream. Read-only.",
    )
    .action(() => {
      const code = runStatus();
      if (code !== 0) process.exit(code);
    });
  attachPhase(sub, 2);
}
