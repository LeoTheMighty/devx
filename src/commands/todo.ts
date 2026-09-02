// `devx todo sync <hash>` — the mechanical todo.md truing primitive
// (hfi103, workstream harness-fold-in Phase 3).
//
// FR-2's "reconcile before writing" made structural: lifecycle skills call
// this instead of hand-truing derived lines. Two paths:
//
//   absent todo.md  — FR-1 grandfathering: instantiate the shipped
//                     template (same file + title substitution as the
//                     scaffold) already trued to current ground truth, so
//                     a mid-pipeline workstream's skeleton is born
//                     consistent with its frontmatter.
//   present todo.md — trueDerivedLines: derived checkboxes (Stage / Gate /
//                     phase pointers) mirror spec frontmatter + linked
//                     dev-spec state; free-nested items byte-preserved.
//
// Stdout JSON: {hash, created, trued: [...]}. Exit codes:
//   0 — success, including the no-op (nothing to true).
//   2 — resolution/parse errors (unknown hash, config load failure,
//       missing template, unreadable todo.md).
//
// NEVER called from gate code — E-2's static scan
// (test/gate-todo-isolation.test.ts) keeps gate modules todo-free.
//
// Spec: dev/dev-hfi103-2026-07-24T10:41-todo-sync-renderers-status.md
// Design: _devx/workstreams/harness-fold-in/design/agent.md §Interfaces

import { basename, join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { parseTodo, trueDerivedLines } from "../lib/engine/todo.js";
import {
  TODO_FILENAME,
  loadTodoDoc,
  todoGroundTruth,
} from "../lib/engine/todo-truth.js";
import {
  type EngineFs,
  TEMPLATES_DIR,
  WorkstreamError,
  realEngineFs,
  resolveWorkstream,
  titleFromSlug,
  workstreamSlugFor,
} from "../lib/engine/workstream.js";

export interface RunTodoSyncOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
}

export function runTodoSync(
  args: string[],
  opts: RunTodoSyncOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };

  if (args.length !== 1) {
    err("usage: devx todo sync <hash>\n");
    return 2;
  }

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx todo sync: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;

  let ws;
  try {
    ws = resolveWorkstream(repoRoot, args[0], engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      err(`devx todo sync: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const todoAbs = join(ws.workstreamAbs, TODO_FILENAME);
  let created = false;
  let content: string;
  try {
    const loaded = loadTodoDoc(fs, ws.workstreamAbs);
    if (loaded !== null) {
      content = loaded.content;
    } else {
      const templateAbs = join(repoRoot, TEMPLATES_DIR, TODO_FILENAME);
      if (!fs.exists(templateAbs)) {
        err(
          `devx todo sync: engine template missing at ${TEMPLATES_DIR}/${TODO_FILENAME} — run \`devx init\` (v2 scaffold) first\n`,
        );
        return 2;
      }
      // Through the shared helper (dlr103): under `project-level` the
      // workstream dir is `.`, whose tail titles the scaffolded todo.md
      // "." — the slug lives in the plan spec's filename there. The function
      // replacement below keeps `$`-patterns in a weird dir name from
      // expanding as replacement syntax.
      const slug =
        workstreamSlugFor(basename(ws.specAbs), ws.workstreamRel, engine) ??
        ws.workstreamRel;
      const title = titleFromSlug(slug);
      content = fs
        .readFile(templateAbs)
        .replace(/<workstream title>/g, () => title);
      created = true;
    }

    // True against ground truth in both paths — the grandfathering skeleton
    // is born consistent, an existing file is reconciled.
    const doc = parseTodo(content);
    const truth = todoGroundTruth(fs, repoRoot, ws.state, doc);
    const trued = trueDerivedLines(content, truth);
    if (created || trued.trued.length > 0) {
      fs.writeFile(todoAbs, trued.content);
    }
    out(
      `${JSON.stringify({ hash: ws.hash, created, trued: trued.trued })}\n`,
    );
    return 0;
  } catch (e) {
    err(
      `devx todo sync: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
}

export function register(program: Command): void {
  const sub = program
    .command("todo")
    .description(
      "Per-workstream todo.md working memory (harness-fold-in). Subcommand-driven.",
    );

  sub
    .command("sync")
    .description(
      "True todo.md's derived lines (Stage/Gate/phase-pointer checkboxes) against spec frontmatter + linked dev-spec state. Absent todo.md → create from the shipped template, born consistent (FR-1 grandfathering). Free-nested items are never touched. Emits {hash, created, trued} JSON.",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .action((hash: string) => {
      const code = runTodoSync([hash]);
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
