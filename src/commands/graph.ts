// `devx graph` — render the board's dependency graph to GRAPH.md (sgr103 /
// plan Phase 3, T3.2–T3.4).
//
//   devx graph                        render + atomic-write <root>/GRAPH.md
//   devx graph --stdout               print the document instead of writing
//   devx graph --format json          print the GraphModel JSON (stdout only)
//   devx graph --check                byte-compare against the committed file
//   devx graph --epic X --workstream Y  scope what is PRINTED (never the write)
//
// A thin driver: gather + model live in `lib/graph/model.ts`, rendering in
// `lib/graph/render.ts`. This file owns exactly three decisions.
//
// 1. ROOT RESOLUTION IS WORKTREE-SAFE (design § Architecture 4). The root
//    comes from `resolveRepoRoot()` — git's common dir — not from the cwd
//    config-walk. A `devx graph` run (or a claim-triggered regen, Phase 4)
//    inside `.worktrees/dev-<hash>/` MUST write the main checkout's GRAPH.md;
//    `findProjectConfig()` would find the worktree's own devx.config.yaml and
//    fork a worktree-local copy that nobody ever commits. The config-walk
//    survives only as the fallback for a non-git cwd and as the tiebreak for
//    a legitimately nested project (the loop.ts precedent).
//
// 2. STDOUT CARRIES ONLY THE PAYLOAD. `--format json` writes JSON and nothing
//    else to stdout; warnings and summaries go to stderr, so `devx graph
//    --format json | jq` works (the `devx merge-gate --json` precedent).
//
// 3. NOTHING IS WRITTEN ON A NON-SUCCESS PATH. A cycle, a drifted `--check`,
//    a config failure — all leave GRAPH.md exactly as it was (E-3 asserts
//    this for cycles). Renders that are only being READ (`--stdout`,
//    `--format json`, `--check`) never write either.
//
// Exit codes (engine convention): 0 success · 1 check-drift, cycle, or flag
// validation · 2 config-load / root-resolution failure.
//
// Spec: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md
// Design: _devx/workstreams/story-graph/design.md §Architecture 4, §Interfaces

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";

import { epicSlugify } from "../lib/backlog/parse.js";
import { findProjectConfig } from "../lib/config-io.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  type EngineFs,
  realEngineFs,
} from "../lib/engine/workstream.js";
import {
  type GraphModel,
  buildGraphModel,
} from "../lib/graph/model.js";
import { GRAPH_FILENAME } from "../lib/graph/regen.js";
import { REGEN_COMMAND, renderStoryGraph } from "../lib/graph/render.js";
import { attachPhase } from "../lib/help.js";
import {
  type RepoRootInfo,
  resolveRepoRoot,
  tryRealpath,
} from "../lib/repo-root.js";
import { writeAtomic } from "../lib/supervisor-internal.js";

// Re-exported (not re-declared) so the CLI and the hook-side regen can never
// disagree about the board's filename. sgr104 moved the definition into
// lib/graph/regen.ts — the hosts import from lib/, and lib/ must not depend
// on commands/.
export { GRAPH_FILENAME } from "../lib/graph/regen.js";

export type GraphFormat = "mermaid" | "json";

export interface RunGraphOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skips the walk AND the
   *  canonical-root probe — the resolved config dir is the root). */
  projectPath?: string;
  /** Test seam: the directory resolution starts from. */
  cwd?: string;
  fs?: Partial<EngineFs>;
  /** Test seam for the GRAPH.md write (default: writeAtomic). */
  write?: (path: string, contents: string) => void;
  stdout?: boolean;
  check?: boolean;
  format?: GraphFormat;
  /** Repeatable `--epic <slug|plan-hash>`. */
  epic?: string[];
  /** Repeatable `--workstream <slug>`. */
  workstream?: string[];
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * Mask a model down to the scoped groups.
 *
 * Nodes outside the scope are dropped, and so is every edge with a dropped
 * endpoint — a half-dangling edge is worse than no edge, because Mermaid
 * silently MINTS a bare node for an id it has never seen, which is exactly
 * the phantom class this workstream exists to kill.
 *
 * Warnings are filtered to the surviving hashes, plus every warning that
 * names no hash at all (a `heading-fallback` is about a file, not a spec).
 */
export function scopeModel(model: GraphModel, keys: Set<string>): GraphModel {
  const groups = model.groups.filter((g) => keys.has(epicSlugify(g.id)));
  const groupIds = new Set(groups.map((g) => g.id));
  const nodes = model.nodes.filter(
    (n) => n.group !== null && groupIds.has(n.group),
  );
  const hashes = new Set(nodes.map((n) => n.hash));
  const edges = model.edges.filter(
    (e) => hashes.has(e.from) && hashes.has(e.to),
  );
  const warnings = model.warnings.filter(
    (w) => w.hash === undefined || hashes.has(w.hash),
  );
  return { nodes, edges, groups, warnings };
}

/** Every group-id spelling a scope flag may name, normalized. */
function groupKeys(model: GraphModel): Set<string> {
  return new Set(model.groups.map((g) => epicSlugify(g.id)));
}

// ---------------------------------------------------------------------------
// Root resolution
// ---------------------------------------------------------------------------

interface RootResolution {
  ok: boolean;
  root: string;
  error?: string;
}

/**
 * Resolve the root GRAPH.md belongs to.
 *
 * Precedence (the loop.ts precedent, with the worktree arm INVERTED — loop
 * refuses a linked-worktree start, graph must silently retarget the main
 * checkout, because a claim-triggered regen legitimately runs there):
 *   - explicit projectPath (test seam) → its directory;
 *   - non-git cwd → the legacy config-walk;
 *   - linked worktree → the canonical MAIN checkout (load-bearing);
 *   - devx.config.yaml below the git toplevel (nested project) → that dir;
 *   - otherwise → the canonical root.
 */
export function resolveGraphRoot(
  cwd: string,
  projectPath: string | undefined,
): RootResolution {
  if (projectPath !== undefined) return { ok: true, root: dirname(projectPath) };

  let info: RepoRootInfo | null;
  try {
    info = resolveRepoRoot(cwd);
  } catch {
    info = null;
  }
  const configPath = findProjectConfig(cwd);
  const configDir = configPath !== null ? dirname(configPath) : null;

  if (info === null) {
    if (configDir === null) {
      return {
        ok: false,
        root: "",
        error: `not a git repository and no devx.config.yaml found (walked up from ${cwd})`,
      };
    }
    return { ok: true, root: configDir };
  }
  if (info.isLinkedWorktree) return { ok: true, root: info.root };
  if (configDir !== null && tryRealpath(configDir) !== info.root) {
    return { ok: true, root: configDir };
  }
  return { ok: true, root: info.root };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export function runGraph(opts: RunGraphOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  const write = opts.write ?? ((p, c) => writeAtomic(p, c));
  const cwd = opts.cwd ?? process.cwd();
  const format: GraphFormat = opts.format ?? "mermaid";
  const epics = opts.epic ?? [];
  const workstreams = opts.workstream ?? [];
  const scoped = epics.length > 0 || workstreams.length > 0;

  if (format !== "mermaid" && format !== "json") {
    err(`devx graph: --format must be 'mermaid' or 'json' (got '${String(format)}')\n`);
    return 1;
  }
  // A scoped --check can never pass: the committed file is the FULL board, so
  // the byte-compare is guaranteed to differ. Refusing beats silently
  // ignoring the flag (the drift report would name a non-existent problem).
  if (opts.check === true && scoped) {
    err(
      `devx graph: --check compares the committed full-board ${GRAPH_FILENAME}; ` +
        `drop --epic/--workstream (scope applies to --stdout and --format json)\n`,
    );
    return 1;
  }

  // ── root + config ──────────────────────────────────────────────────────
  const resolution = resolveGraphRoot(cwd, opts.projectPath);
  if (!resolution.ok) {
    err(`devx graph: ${resolution.error}\n`);
    return 2;
  }
  const configPath = join(resolution.root, "devx.config.yaml");
  // Real fs, NOT the injectable seam: root resolution (`resolveRepoRoot`,
  // `findProjectConfig`) and `loadEngineContext` both read the real disk, so
  // probing this one path through a fake would let the seam disagree with the
  // loader that runs two lines later. The seam's job is the MODEL's reads.
  if (!existsSync(configPath)) {
    err(
      `devx graph: no devx.config.yaml at the resolved repo root (${resolution.root})\n`,
    );
    return 2;
  }
  const ctx = loadEngineContext(configPath);
  if (!ctx.ok) {
    err(`devx graph: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;

  // ── model ──────────────────────────────────────────────────────────────
  let result;
  try {
    result = buildGraphModel(fs, repoRoot, engine);
  } catch (e) {
    err(
      `devx graph: model build failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
  if (!result.ok) {
    // Hard error: enumerate EVERY participant so the operator can break the
    // loop without re-deriving it, and leave GRAPH.md untouched.
    err(
      `devx graph: blocking-edge cycle detected — ${GRAPH_FILENAME} not written.\n` +
        `Specs in a cycle (${result.cycle.length}): ${result.cycle.join(", ")}\n` +
        `Break the cycle by removing one \`Blocked-by:\`/\`blocked_by:\` edge, then re-run \`${REGEN_COMMAND}\`.\n`,
    );
    return 1;
  }
  const full = result.model;

  // ── scope validation ───────────────────────────────────────────────────
  const known = groupKeys(full);
  const wanted = new Set<string>();
  for (const [flag, raws] of [
    ["--epic", epics],
    ["--workstream", workstreams],
  ] as const) {
    for (const raw of raws) {
      const key = epicSlugify(raw);
      if (key === "") {
        err(`devx graph: ${flag} requires a non-empty slug (got '${raw}')\n`);
        return 1;
      }
      if (!known.has(key)) {
        err(
          `devx graph: ${flag} '${raw}' matches no group on the board` +
            (known.size > 0 ? ` (known: ${[...known].sort().join(", ")})` : "") +
            "\n",
        );
        return 1;
      }
      wanted.add(key);
    }
  }
  // Repeated flags union within a dimension and across them — a group named
  // by either flag is in scope (`devx loop`'s vocabulary; the loop's
  // cross-dimension INTERSECT has no meaning here, where both flags select
  // the same kind of object).
  const view = scoped ? scopeModel(full, wanted) : full;

  const counts = (m: GraphModel): string =>
    `${m.nodes.length} node(s), ${m.edges.length} edge(s), ${m.groups.length} group(s)`;
  const summary =
    counts(view) + (scoped ? ` [scoped: ${[...wanted].sort().join(", ")}]` : "");
  const emitWarnings = (m: GraphModel): void => {
    for (const w of m.warnings) err(`devx graph: ${w.code}: ${w.message}\n`);
  };

  // ── json: payload on stdout, never a write ─────────────────────────────
  if (format === "json") {
    out(`${JSON.stringify(view, null, 2)}\n`);
    emitWarnings(view);
    return 0;
  }

  const graphPath = join(repoRoot, GRAPH_FILENAME);

  // ── check: byte-compare, write nothing ─────────────────────────────────
  if (opts.check === true) {
    if (!fs.exists(graphPath)) {
      err(
        `devx graph: ${GRAPH_FILENAME} is missing (run \`${REGEN_COMMAND}\`)\n`,
      );
      return 1;
    }
    let committed: string;
    try {
      committed = fs.readFile(graphPath);
    } catch (e) {
      err(
        `devx graph: ${GRAPH_FILENAME} unreadable: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 2;
    }
    // Unscoped by construction (the scope+check combination was refused
    // above), so `view === full` here.
    if (committed !== renderStoryGraph(view)) {
      err(
        `devx graph: ${GRAPH_FILENAME} is out of date (run \`${REGEN_COMMAND}\`)\n`,
      );
      return 1;
    }
    err(`devx graph: ${GRAPH_FILENAME} is up to date — ${summary}\n`);
    return 0;
  }

  // ── stdout: document on stdout, never a write ──────────────────────────
  if (opts.stdout === true) {
    out(renderStoryGraph(view));
    emitWarnings(view);
    return 0;
  }

  // ── default: atomic write of the FULL board ────────────────────────────
  // Scope never narrows the FILE — GRAPH.md is the whole board or it is a lie
  // to everyone who reads it without knowing which flags produced it. So the
  // write path renders `full`, not `view`, even when scope flags were passed.
  try {
    write(graphPath, renderStoryGraph(full));
  } catch (e) {
    err(
      `devx graph: writing ${GRAPH_FILENAME} failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
  err(
    `devx graph: wrote ${GRAPH_FILENAME} — ${counts(full)}` +
      (scoped
        ? " (full board — scope flags apply to --stdout/--format json)"
        : "") +
      "\n",
  );
  emitWarnings(full);
  return 0;
}

export function register(program: Command): void {
  const sub = program
    .command("graph")
    .description(
      "Render the board's dependency graph to GRAPH.md (deterministic Mermaid). " +
        "--stdout prints instead of writing; --format json emits the GraphModel; " +
        "--check fails on drift; --epic/--workstream scope what is printed.",
    )
    .option("--stdout", "print the rendered document instead of writing GRAPH.md")
    .option("--check", "fail (exit 1) when the committed GRAPH.md is out of date")
    .option("--format <format>", "mermaid (default) | json", "mermaid")
    .option(
      "--epic <slug>",
      "scope printed output to an epic (repeatable)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option(
      "--workstream <slug>",
      "scope printed output to a workstream (repeatable)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .action((options: Record<string, unknown>) => {
      const code = runGraph({
        stdout: options.stdout === true,
        check: options.check === true,
        format: options.format as GraphFormat,
        epic: (options.epic as string[] | undefined) ?? [],
        workstream: (options.workstream as string[] | undefined) ?? [],
      });
      if (code !== 0) process.exit(code);
    });
  attachPhase(sub, 1);
}
