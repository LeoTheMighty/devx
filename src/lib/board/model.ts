// `devx board`'s model — what one page knows about one workstream (D1).
//
// Pure except for the injected read seam, and deliberately thin: every cell
// on the board is produced by a helper some OTHER surface already consumes
// (`renderGateSummary`, `renderFocusLine`, `renderHealthLine`, `parseTodo`,
// `loadQuestions`, `enumerateEngineWorkstreams`). The whole point of a third
// lens is that it is a third VIEW of one state, not a third reading of it —
// the moment the board computes a verdict of its own, `devx status` and the
// board start disagreeing about the same workstream and the board becomes the
// thing nobody trusts.
//
// Design: docs/DESIGN.md §Observability surfaces (the static board is the
// first lens to actually ship; `devx ui` / `devx serve` stay Phase-4 stubs).

import {
  type ResolvedBase,
  artifactExists,
  decisionsDirAbs,
  stageSubject,
} from "../engine/artifacts.js";
import type { EngineConfig } from "../engine/config.js";
import type { EngineState } from "../engine/frontmatter.js";
import {
  type Question,
  type HealthCounts,
  healthCounts,
} from "../engine/questions.js";
import { loadQuestions } from "../engine/questions-io.js";
import {
  renderFocusLine,
  renderGateSummary,
  renderHealthLine,
} from "../engine/render.js";
import { type TodoItem, parseTodo } from "../engine/todo.js";
import { loadTodoDoc } from "../engine/todo-truth.js";
import {
  type EngineFs,
  enumerateEngineWorkstreams,
} from "../engine/workstream.js";

/** Read seam. `EngineFs` qualifies structurally. */
export type BoardFs = Pick<EngineFs, "exists" | "readFile" | "readdir">;

export interface BoardWorkstream {
  slug: string;
  hash: string;
  stage: string;
  /** True when the workstream is still moving (stage ∉ {done, retired}). */
  active: boolean;
  /** A closed workstream still owing its outcome score. */
  outcomePending: boolean;
  /** `renderGateSummary`'s block, newline-joined — the `gates:` line plus one
   *  fix-path line per FAILed gate. */
  gateSummary: string;
  /** `focus: <text>`, or null (absent todo.md / no section for the stage). */
  focus: string | null;
  /** `health: N blocking · M concern`, or null (clean or absent queue). */
  health: string | null;
  counts: HealthCounts;
  /**
   * Does the workstream HAVE a queue?
   *
   * Carried separately from `counts`, because `{blocking: 0, concern: 0}` is
   * what BOTH an absent queue and a verified-clean one produce — and on a
   * board those must not look the same. "clean" is a claim that a gate ran
   * and found nothing; a grandfathered workstream that no gate has
   * reconciled yet has made no such claim. `devx status` draws the
   * distinction by omitting the line entirely; a card has no "omit" option,
   * so it needs the fact.
   */
  hasQueue: boolean;
  /** Non-null when questions.md exists but does not parse. */
  healthError: string | null;
  /** Open entries first, resolved after — the worklist order a reader wants. */
  questions: Question[];
  /** Flattened todo checklist, depth preserved. Empty when absent. */
  todo: TodoItem[];
  /** Mermaid source for this workstream's slice of GRAPH.md, or null. */
  mermaid: string | null;
  /** D-13: the spec's frontmatter did not fully parse; the page says so. */
  frontmatterError: string | null;
}

export interface BoardModel {
  workstreams: BoardWorkstream[];
  /** The whole `GRAPH.md` board, for the index page. Null when absent. */
  mermaid: string | null;
  /** Degradations worth printing — never a reason to emit nothing. */
  warnings: string[];
}

/**
 * Pull the mermaid block out of `GRAPH.md`.
 *
 * Reads the GENERATED file rather than re-deriving the graph, and that is the
 * decision rather than a shortcut: `devx graph --check` already fails CI on
 * drift, so GRAPH.md is a gated artifact and re-rendering it here would be a
 * second graph nobody checks. A board built from a stale GRAPH.md is a board
 * whose staleness another gate reports.
 */
export function extractMermaid(graphMd: string): string | null {
  const m = /```mermaid\r?\n([\s\S]*?)```/.exec(graphMd);
  return m === null ? null : m[1].trimEnd();
}

/**
 * One workstream's slice of the board: its `subgraph` block, plus every
 * global `classDef` and the `class` lines naming nodes inside it.
 *
 * Matched on the subgraph's TITLE (`<slug> (workstream)`) and not on its
 * mermaid id: ids are slugified and collision-suffixed by the renderer
 * (`a-b` and `a.b` both become `a_b`, and the second claims `a_b_2`), so
 * deriving one from a slug here would silently pick the wrong subgraph on a
 * collision. The title is what the renderer built FROM the slug.
 *
 * Null when this workstream has no subgraph — a fully-settled group collapses
 * to a summary node, and a workstream with no specs has none at all. The page
 * then shows no graph panel rather than an empty mermaid block, which would
 * render as a broken diagram.
 */
export function extractWorkstreamSubgraph(
  graphMd: string,
  slug: string,
): string | null {
  const full = extractMermaid(graphMd);
  if (full === null) return null;
  const lines = full.split("\n");
  const titleRe = new RegExp(
    `^\\s*subgraph\\s+\\S+\\["${escapeRe(slug)} \\((?:workstream|epic)\\)"\\]`,
  );
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (titleRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  // Nested subgraphs are not emitted today, but counting depth costs one
  // integer and makes the extraction correct if they ever are — a slice that
  // ended at the FIRST `end` would truncate the block and emit mermaid that
  // does not parse.
  let depth = 0;
  let endIdx = -1;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*subgraph\b/.test(lines[i])) depth++;
    else if (/^\s*end\s*$/.test(lines[i])) {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) return null;
  const block = lines.slice(start, endIdx + 1);

  // Node ids declared inside the block, so the `class` lines that colour them
  // come along. Without them every node renders in the default fill and the
  // status colouring — the one thing the graph panel is FOR — is gone.
  const ids = new Set<string>();
  for (const line of block) {
    const m = /^\s*([A-Za-z0-9_]+)[["]/.exec(line);
    if (m !== null) ids.add(m[1]);
  }
  const classDefs = lines.filter((l) => /^\s*classDef\b/.test(l));
  const classLines = lines.filter((l) => {
    const m = /^\s*class\s+([A-Za-z0-9_,\s]+)\s+\S+\s*$/.exec(l);
    if (m === null) return false;
    return m[1]
      .split(",")
      .map((n) => n.trim())
      .some((n) => ids.has(n));
  });

  return ["flowchart TD", ...block, ...classDefs, ...classLines].join("\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Flatten a todo forest depth-first, preserving document order. */
function flattenTodo(items: readonly TodoItem[]): TodoItem[] {
  const out: TodoItem[] = [];
  const visit = (list: readonly TodoItem[]): void => {
    for (const item of list) {
      out.push(item);
      visit(item.children);
    }
  };
  visit(items);
  return out;
}

/** Open entries first (the worklist), resolved after (the record). Stable
 *  within each half, so a page's order does not churn between builds. */
function orderQuestions(entries: readonly Question[]): Question[] {
  const open = entries.filter((q) => q.status !== "resolved");
  const closed = entries.filter((q) => q.status === "resolved");
  // Blocking first inside the open half — the board leads with what blocks.
  const byBlocking = (a: Question, b: Question): number =>
    Number(b.severity === "blocking") - Number(a.severity === "blocking");
  return [...[...open].sort(byBlocking), ...closed];
}

export interface BuildBoardOpts {
  fs: BoardFs;
  repoRoot: string;
  engine: EngineConfig;
  /** `GRAPH.md` contents, or null when it is absent/unreadable. */
  graphMd: string | null;
}

/**
 * Build the whole board model. Every per-workstream read degrades to null or
 * empty rather than throwing: the board is an observability surface, and a
 * page that renders four of five panels is worth more than a command that
 * exits 2 because one todo.md was unreadable.
 */
export function buildBoardModel(opts: BuildBoardOpts): BoardModel {
  const { fs, repoRoot, engine, graphMd } = opts;
  const warnings: string[] = [];
  const workstreams: BoardWorkstream[] = [];

  for (const ws of enumerateEngineWorkstreams(fs, repoRoot, engine, (m) =>
    warnings.push(m),
  )) {
    const { state, base, hash, slug } = ws;
    workstreams.push({
      slug,
      hash,
      stage: state.stage ?? "?",
      active: state.stage !== "done" && state.stage !== "retired",
      outcomePending:
        state.stage === "done" && state.outcome.status === "pending",
      gateSummary: renderGateSummary(state, {
        hash,
        workstreamRel: base.workstreamRel,
        layout: base.layout,
        decisionNames: listDecisions(fs, base, warnings),
        evalsReportExists: artifactExists(fs, base, { kind: "red-report" }),
      }),
      ...healthAndTodo(fs, base, state, warnings),
      mermaid: graphMd === null ? null : extractWorkstreamSubgraph(graphMd, slug),
      frontmatterError: ws.frontmatterError,
    });
  }

  return {
    workstreams,
    mermaid: graphMd === null ? null : extractMermaid(graphMd),
    warnings,
  };
}

function listDecisions(
  fs: BoardFs,
  base: ResolvedBase,
  warnings: string[],
): readonly string[] {
  const abs = decisionsDirAbs(base);
  if (!fs.exists(abs)) return [];
  try {
    return fs.readdir(abs);
  } catch (e) {
    warnings.push(
      `${stageSubject(base.layout, base, { kind: "decisions-dir" }).rel} unreadable (${msg(e)}) — FAIL rows fall back to re-run-only fix paths`,
    );
    return [];
  }
}

function healthAndTodo(
  fs: BoardFs,
  base: ResolvedBase,
  state: EngineState,
  warnings: string[],
): Pick<
  BoardWorkstream,
  | "focus"
  | "health"
  | "counts"
  | "hasQueue"
  | "healthError"
  | "questions"
  | "todo"
> {
  let focus: string | null = null;
  let todo: TodoItem[] = [];
  try {
    const loaded = loadTodoDoc(fs, base);
    if (loaded !== null) {
      focus = renderFocusLine(loaded.doc, state.stage);
      todo = flattenTodo(parseTodo(loaded.content).items);
    }
  } catch (e) {
    warnings.push(
      `${stageSubject(base.layout, base, { kind: "todo" }).rel} unreadable (${msg(e)}) — the focus line and checklist are omitted`,
    );
  }

  const q = loadQuestions(fs, base);
  const counts = q === null ? { blocking: 0, concern: 0 } : healthCounts(q.entries);
  return {
    focus,
    health:
      q === null
        ? null
        : renderHealthLine(q.error === null ? counts : null, q.error),
    counts,
    hasQueue: q !== null,
    healthError: q?.error ?? null,
    questions: q === null ? [] : orderQuestions(q.entries),
    todo,
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
