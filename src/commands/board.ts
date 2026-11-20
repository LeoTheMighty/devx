// `devx board [--out <dir>]` — the static board (D1).
//
// docs/DESIGN.md §Observability names three lenses over one state: `devx ui`
// (TUI), `devx serve` (web), and the mobile Activity tab. Two are Phase-4
// stubs and the third was retired with the mobile companion (D-16), so the
// repo has shipped no visual surface at all — `devx status` and `devx next`
// are the whole of it.
//
// This is the cheap one: a static site with no server, no watch, no build
// step, written from the readers that already exist. It is not a replacement
// for `devx serve` — no diff viewer, no live tail, no SSE — it is the lens
// that can ship in a day and be rebuilt by one command.
//
// Exit codes:
//   0 — written (including the zero-workstream case: an honest empty board is
//       a correct answer, and failing would make `devx board` unusable in a
//       repo that has not started a workstream yet).
//   2 — error: config load failed, or the out dir could not be written.
//
// Read-only with respect to the repo: the only thing it writes is its own
// output directory. Nothing in `plan/`, no workstream artifact, no spec
// frontmatter — a surface that reported on state by changing it would be
// worse than no surface.
//
// Design: docs/DESIGN.md §Observability surfaces

import { join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { buildBoardModel } from "../lib/board/model.js";
import { pageNames, renderIndex, renderWorkstreamPage } from "../lib/board/render.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { GRAPH_FILENAME } from "../lib/graph/regen.js";
import { type EngineFs, realEngineFs } from "../lib/engine/workstream.js";

/** Default output dir — gitignored, like every other derived artifact devx
 *  writes outside the doc set. A board under `_devx/` would be committed
 *  HTML that `devx graph --check`'s sibling problem (drift against a
 *  generated file) applies to all over again. */
export const DEFAULT_BOARD_DIR = join(".devx-cache", "board");

export interface RunBoardOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  now?: () => Date;
}

export function runBoard(
  flags: { out?: string } = {},
  opts: RunBoardOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  const now = opts.now ?? (() => new Date());

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx board: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;

  // GRAPH.md is read, never regenerated: `devx graph --check` already gates
  // its freshness, so re-deriving the graph here would be a second graph
  // nobody checks, and a board built from a stale GRAPH.md is stale in a way
  // another gate reports.
  const graphAbs = join(repoRoot, GRAPH_FILENAME);
  let graphMd: string | null = null;
  if (fs.exists(graphAbs)) {
    try {
      graphMd = fs.readFile(graphAbs);
    } catch (e) {
      err(
        `devx board: ${GRAPH_FILENAME} unreadable (${message(e)}) — the graph panels are omitted\n`,
      );
    }
  }

  const model = buildBoardModel({ fs, repoRoot, engine, graphMd });
  for (const w of model.warnings) err(`devx board: ${w}\n`);

  const outRel = flags.out ?? DEFAULT_BOARD_DIR;
  const outAbs = join(repoRoot, ...outRel.split("/"));
  const generatedAt = now().toISOString().replace("T", " ").slice(0, 16);

  // Resolved ONCE and threaded through both sides, so a card's href and the
  // file it names can never disagree — which is what a second `pageName` call
  // in the renderer would allow the moment two slugs collide.
  const hrefs = pageNames(model.workstreams.map((ws) => ws.slug));
  const files: Array<{ name: string; body: string }> = [
    { name: "index.html", body: renderIndex(model, generatedAt, hrefs) },
    ...model.workstreams.map((ws, i) => ({
      name: hrefs[i],
      body: renderWorkstreamPage(ws, generatedAt),
    })),
  ];

  try {
    fs.mkdirRecursive(outAbs);
    for (const file of files) fs.writeFile(join(outAbs, file.name), file.body);
  } catch (e) {
    err(`devx board: write to ${outRel} failed: ${message(e)}\n`);
    return 2;
  }

  out(
    `${JSON.stringify({
      board: `${outRel}/index.html`,
      workstreams: model.workstreams.length,
      pages: files.length,
      graph: model.mermaid !== null,
      warnings: model.warnings,
    })}\n`,
  );
  return 0;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function register(program: Command): void {
  const sub = program
    .command("board")
    .description(
      "Write a static HTML board: one index plus one page per workstream (stage, gates with verdicts, focus, the health queue, the todo checklist, and its slice of GRAPH.md). No server, no build step; re-run to refresh. Read-only except for its own output dir.",
    )
    .option("--out <dir>", `output directory (default: ${DEFAULT_BOARD_DIR})`)
    .action((cmdOpts: { out?: string }) => {
      const code = runBoard({ out: cmdOpts.out });
      if (code !== 0) process.exit(code);
    });
  attachPhase(sub, 4);
}
