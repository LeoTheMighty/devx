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
// Design: _devx/workstreams/story-graph/design/agent.md §Architecture 4, §Interfaces

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";

import { epicSlugify } from "../lib/backlog/parse.js";
import { findProjectConfig } from "../lib/config-io.js";
import { type EngineConfig } from "../lib/engine/config.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  type EngineFs,
  realEngineFs,
} from "../lib/engine/workstream.js";
import {
  type GraphModel,
  buildGraphModel,
} from "../lib/graph/model.js";
import {
  type BackfillFs,
  renderBackfillReport,
  runBackfill,
} from "../lib/graph/backfill.js";
import { GRAPH_FILENAME, regenerateGraph } from "../lib/graph/regen.js";
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

type ContextResolution =
  | { ok: true; repoRoot: string; engine: EngineConfig }
  | { ok: false; code: number; message: string };

/** Root + engine config, resolved once for every `devx graph …` entry point.
 *  Shared so `backfill` writes into the SAME canonical checkout `graph`
 *  renders from — a second resolution here is how a worktree-run backfill
 *  would splice the worktree's copy of DEV.md instead of main's. */
function resolveContext(
  cwd: string,
  projectPath: string | undefined,
): ContextResolution {
  const resolution = resolveGraphRoot(cwd, projectPath);
  if (!resolution.ok) {
    return { ok: false, code: 2, message: resolution.error ?? "root resolution failed" };
  }
  const configPath = join(resolution.root, "devx.config.yaml");
  // Real fs, NOT the injectable seam: root resolution (`resolveRepoRoot`,
  // `findProjectConfig`) and `loadEngineContext` both read the real disk, so
  // probing this one path through a fake would let the seam disagree with the
  // loader that runs two lines later. The seam's job is the MODEL's reads.
  if (!existsSync(configPath)) {
    return {
      ok: false,
      code: 2,
      message: `no devx.config.yaml at the resolved repo root (${resolution.root})`,
    };
  }
  const ctx = loadEngineContext(configPath);
  if (!ctx.ok) return { ok: false, code: 2, message: ctx.error };
  return { ok: true, repoRoot: ctx.ctx.repoRoot, engine: ctx.ctx.engine };
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
  const ctx = resolveContext(cwd, opts.projectPath);
  if (!ctx.ok) {
    err(`devx graph: ${ctx.message}\n`);
    return ctx.code;
  }
  const { repoRoot, engine } = ctx;

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

// ---------------------------------------------------------------------------
// backfill (sgr106 / plan Phase 6)
// ---------------------------------------------------------------------------

export interface RunBackfillCliOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  projectPath?: string;
  cwd?: string;
  fs?: BackfillFs;
  dryRun?: boolean;
}

/**
 * `devx graph backfill [--dry-run]` — complete the durable edge set.
 *
 * Exit codes match the rest of `devx graph`: 0 success (an underivable
 * remainder is a REPORT, not a failure — the operator resolves it, and
 * failing here would make the honest answer look like a broken command),
 * 1 refusal (cycle), 2 root/config resolution failure.
 */
export function runGraphBackfill(opts: RunBackfillCliOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const cwd = opts.cwd ?? process.cwd();
  const dryRun = opts.dryRun === true;

  const ctx = resolveContext(cwd, opts.projectPath);
  if (!ctx.ok) {
    err(`devx graph backfill: ${ctx.message}\n`);
    return ctx.code;
  }

  // Backfill inherits `devx graph`'s canonical-root resolution: specs and
  // backlogs live in the main checkout, and that is where the completion
  // lands. From inside a worktree that is a genuine surprise — the writes
  // appear outside the branch you are on — so say so rather than let the
  // operator discover it in `git status`.
  if (opts.projectPath === undefined) {
    let linked = false;
    try {
      linked = resolveRepoRoot(cwd).isLinkedWorktree;
    } catch {
      linked = false;
    }
    if (linked) {
      err(
        `devx graph backfill: NOTE — writing to the main checkout (${ctx.repoRoot}), ` +
          `not this worktree; specs and backlogs live there. Its diff will NOT be part of this branch.\n`,
      );
    }
  }

  let result;
  try {
    result = runBackfill(ctx.repoRoot, ctx.engine, { fs: opts.fs, dryRun });
  } catch (e) {
    // Chiefly BacklogLockTimeoutError: a peer claim or loop is mid-mutation.
    // That is contention, not a defect in the board — an uncaught stack trace
    // here would read as "backfill is broken" when the answer is "try again".
    err(
      `devx graph backfill: ${e instanceof Error ? e.message : String(e)}\n` +
        "Nothing was written. Retry once the holder finishes.\n",
    );
    return 2;
  }
  if (!result.ok) {
    err(`devx graph backfill: ${result.error}\n`);
    // Same split `devx graph` uses: a cycle is a REFUSAL the operator fixes
    // by editing an edge (1); anything else is the board failing to load at
    // all (2), which is an investigation, not a backlog edit.
    return result.cycle !== undefined ? 1 : 2;
  }

  out(
    renderBackfillReport(result.plan, {
      dryRun,
      filesWritten: result.filesWritten,
      warnings: result.warnings,
    }),
  );

  // A completion pass that moved edges has invalidated the committed board.
  // Regen is warn-and-continue (the sgr104 posture): the spec/backlog writes
  // already landed and are the operator's real deliverable — a render failure
  // must not report them as a failed run.
  if (!dryRun && result.filesWritten.length > 0) {
    const regen = regenerateGraph(opts.fs ?? realEngineFs, ctx.repoRoot, ctx.engine);
    if (!regen.ok) err(`devx graph backfill: ${regen.warning}\n`);
  }
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
  sub
    .command("backfill")
    .description(
      "Complete the durable edge set: write each blocking edge to whichever side " +
        "(spec frontmatter / backlog row) is missing it, derive ordering from " +
        "durable state only, and report what cannot be derived. Adds only; never " +
        "deletes an edge; a second run writes nothing.",
    )
    .option("--dry-run", "compute and report without writing any file")
    .action((options: Record<string, unknown>) => {
      const code = runGraphBackfill({ dryRun: options.dryRun === true });
      if (code !== 0) process.exit(code);
    });
  attachPhase(sub, 1);
}
