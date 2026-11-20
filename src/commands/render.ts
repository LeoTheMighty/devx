// `devx render lint <hash> <stage> [--json] [--renumber]` — measure a stage's
// human digest against docs/RENDER-STYLE.md (harness-s4; gap analysis D6).
//
// Resolves the workstream and the stage's digest through the artifact map,
// so the same command works under either `engine.docs_layout`. The stage's
// agent.md, when there is one, is read only for the length-ratio metric.
//
// Exit codes (the engine convention — 0 pass · 1 check failed · 2 error):
//   0 — no HARD finding (advisories may stand)
//   1 — at least one HARD finding
//   2 — usage error, unresolvable workstream, no digest, config failure
// (Upstream's lint exits 2 on HARD; devx keeps 2 for "could not check", so
// a caller can tell "fix these findings" from "fix the invocation".)

import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { STAGE_DIRS, type StageDir, stageSubject } from "../lib/engine/artifacts.js";
import { formatLintReport, lintRender, renumberFootnotes } from "../lib/engine/render-lint.js";
import {
  type EngineFs,
  WorkstreamError,
  realEngineFs,
  resolveWorkstream,
} from "../lib/engine/workstream.js";

export interface RunRenderLintOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
}

const USAGE = `usage: devx render lint <hash> <${STAGE_DIRS.join("|")}> [--json] [--renumber]\n`;

export function runRenderLint(
  args: string[],
  flags: { json?: boolean; renumber?: boolean },
  opts: RunRenderLintOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  if (args.length !== 2 || !(STAGE_DIRS as readonly string[]).includes(args[1])) {
    err(USAGE);
    return 2;
  }
  const stage = args[1] as StageDir;
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx render lint: ${ctx.error}\n`);
    return 2;
  }
  let ws;
  try {
    ws = resolveWorkstream(ctx.ctx.repoRoot, args[0], ctx.ctx.engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      err(`devx render lint: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  const human = stageSubject(ws.layout, ws, { kind: "human", stage });
  if (!fs.exists(human.abs)) {
    err(`devx render lint: ${human.rel} does not exist — the ${stage} stage writes it before its gate\n`);
    return 2;
  }
  let md = fs.readFile(human.abs);
  if (flags.renumber) {
    const fixed = renumberFootnotes(md);
    if (fixed !== md) {
      fs.writeFile(human.abs, fixed);
      err(`devx render lint: renumbered footnotes in ${human.rel}\n`);
      md = fixed;
    }
  }
  const agent = stage === "evals" ? null : stageSubject(ws.layout, ws, { kind: "agent", stage });
  const agentMd = agent !== null && fs.exists(agent.abs) ? fs.readFile(agent.abs) : undefined;
  const report = lintRender(md, { agentMd });
  if (flags.json) {
    out(`${JSON.stringify({ path: human.rel, ...report })}\n`);
  } else {
    out(formatLintReport(report, human.rel));
  }
  return report.metrics.hardFindings > 0 ? 1 : 0;
}

export function register(program: Command): void {
  const sub = program
    .command("render")
    .description("Human-digest tooling (v2 engine). `lint` measures a stage's human.md against docs/RENDER-STYLE.md.");

  sub
    .command("lint")
    .description(
      "Measure a stage's human digest against docs/RENDER-STYLE.md: word budgets, table cells, footnotes + back-references, apparatus leaks, duplicated facts. Exit 1 on any HARD finding; advisories never fail.",
    )
    .argument("<hash>", "plan-spec hash")
    .argument("<stage>", `stage whose human.md to lint (${STAGE_DIRS.join("|")})`)
    .option("--json", "machine-readable report")
    .option("--renumber", "rewrite footnote numbers (first-appearance, one per target) before linting")
    .action((hash: string, stage: string, cmdOpts: { json?: boolean; renumber?: boolean }) => {
      const code = runRenderLint([hash, stage], cmdOpts);
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
