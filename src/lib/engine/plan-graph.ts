// Execution graph — the plan's declared phase structure (harness-s5).
//
// A plan MAY carry an `## Execution graph` section holding one YAML block:
//
//   phases:
//     - { id: 1, depends_on: [] }
//     - { id: 2, depends_on: [1], touches: [src/x.ts], parallel_safe: true }
//   waivers:
//     - { phases: [2, 3], paths: [src/y.ts], approver: leo, reason: "…" }
//
// Without the section nothing changes: Gate 3 is coverage + P0 floor, RED
// emission orders dev specs the way the skill always has. With it, three
// things become mechanical instead of narrated in a "Dependencies:" paragraph:
//
//   - Gate 3 (`devx gate coverage`, plan mode) FAILs a cycle, a phase set
//     that differs from the Phase checklist, a `depends_on` naming no phase,
//     and an UNORDERED same-file overlap (two phases with no dependency path
//     between them both changing one file) that no waiver covers. A waived
//     overlap between two parallel-safe phases is a CONCERN — the waiver
//     says the merge is safe, the flags say both may run at once, and that
//     combination is exactly where two scoped loops collide.
//   - RED emission sets each dev spec's `blocked_by` from its phase's
//     `depends_on`, and marks `Parallel-safe with` the phases the graph
//     proves independent (no path, no overlap, both parallel-safe). The
//     story graph (`devx graph` → GRAPH.md) then renders the plan's shape
//     through the edges it already knows; nothing here invents a node.
//   - `devx plan-helper validate-emit` checks the emitted `blocked_by` back
//     against the graph (check 7 there).
//
// The overlap input is each phase's `Files:` list — the files a phase
// CHANGES. The entry path is what sits before the ` — ` annotation
// separator (every backticked token there); a path mentioned inside the
// annotation ("patterned on `a/b.ts`") is prose, not a declaration. That
// rule is what keeps a read-as-pattern mention from fabricating an overlap
// that cannot happen. `touches:` adds globs the Files list does not spell
// out (a directory, `dir/**`).
//
// Deliberately NOT ported from the upstream shape: `repo` (devx plans are
// single-repo), `task_edges`, `max_workers*`, `default_mode`. The wave
// executor is the loop that already exists — one `devx loop --items` per
// independent set (D-15: the loop is frozen; this changes what it is
// handed, never how it runs).
//
// Pure: no I/O, no clock. Callers read the plan and hand the text in.
//
// Design: v2/02-engine.md §4.5 (plan stage), §4.6 (emission).
// Analysis: docs/updates/8am-harness-gap-analysis.md rows C8 / A7 / A8 / B10.

import { parse as parseYaml } from "yaml";

import { phaseHeadingNumber, planPhaseMap } from "./plan-scope.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphPhase {
  id: number;
  dependsOn: number[];
  /** Extra paths/globs beyond the phase's `Files:` entries. */
  touches: string[];
  /** As declared (default true). `effectiveParallelSafe()` folds in the
   *  integration/production_touch overrides. */
  parallelSafe: boolean;
  integration: boolean;
  productionTouch: boolean;
}

export interface OverlapWaiver {
  phases: number[];
  /** Empty = covers every shared path of the named phases. */
  paths: string[];
  approver: string;
  reason: string;
}

export interface ExecutionGraph {
  phases: GraphPhase[];
  waivers: OverlapWaiver[];
}

export type GraphExtract =
  | { present: false }
  | { present: true; ok: false; error: string }
  | { present: true; ok: true; graph: ExecutionGraph };

export type GraphFindingCode =
  | "graph-invalid"
  | "graph-unknown-dep"
  | "graph-checklist-mismatch"
  | "graph-cycle"
  | "graph-waiver-invalid"
  | "graph-overlap"
  | "graph-parallel-collision"
  | "graph-parallel-flag";

export interface GraphFinding {
  /** `fail` → Gate 3 FAIL; `concern` → CONCERNS at most. */
  severity: "fail" | "concern";
  code: GraphFindingCode;
  message: string;
}

export interface GraphCheck {
  present: boolean;
  /** Parsed graph, or null when absent / invalid. */
  graph: ExecutionGraph | null;
  /** Phase → entry paths from `Files:` plus `touches:`. */
  files: Map<number, string[]>;
  findings: GraphFinding[];
  /** True when any finding is `fail`. */
  failed: boolean;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const SECTION_RE = /^## (.+?)\s*$/;
const FENCE_RE = /^\s*(```+|~~~+)\s*(\w+)?\s*$/;

function sectionTitle(line: string): string | null {
  const m = SECTION_RE.exec(line);
  if (!m) return null;
  return m[1].replace(/[*_`]/g, "").trim().toLowerCase();
}

/** The YAML text of the first fenced block under `## Execution graph`, or
 *  null when the section is absent. Empty string when the section exists
 *  but holds no fence — reported as invalid by the caller. */
export function executionGraphYaml(planText: string): string | null {
  const lines = planText.split(/\r?\n/);
  let inSection = false;
  let fence: string | null = null;
  const body: string[] = [];
  for (const line of lines) {
    const title = fence === null ? sectionTitle(line) : null;
    if (title !== null) {
      if (inSection) break; // next section ends ours
      inSection = title.startsWith("execution graph");
      continue;
    }
    if (!inSection) continue;
    const f = FENCE_RE.exec(line);
    if (f && fence === null) {
      fence = f[1][0];
      continue;
    }
    if (f && fence !== null && f[1][0] === fence && f[2] === undefined) {
      return body.join("\n");
    }
    if (fence !== null) body.push(line);
  }
  if (!inSection) return null;
  return body.join("\n");
}

function asIntList(v: unknown, what: string): number[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: number[] = [];
  for (const x of arr) {
    if (typeof x !== "number" || !Number.isInteger(x) || x <= 0) {
      throw new Error(`${what} must list positive integer phase ids (got ${JSON.stringify(x)})`);
    }
    out.push(x);
  }
  return out;
}

function asStrList(v: unknown, what: string): string[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x !== "string" || x.trim() === "") {
      throw new Error(`${what} must list non-empty strings (got ${JSON.stringify(x)})`);
    }
    out.push(x.trim());
  }
  return out;
}

function asBool(v: unknown, what: string, dflt: boolean): boolean {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== "boolean") throw new Error(`${what} must be true or false`);
  return v;
}

export function parseExecutionGraph(yamlText: string): ExecutionGraph {
  let root: unknown;
  try {
    root = parseYaml(yamlText);
  } catch (e) {
    throw new Error(`YAML does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new Error("root must be a mapping with a `phases` list");
  }
  const r = root as Record<string, unknown>;
  if (!Array.isArray(r.phases) || r.phases.length === 0) {
    throw new Error("`phases` must be a non-empty list");
  }
  const phases: GraphPhase[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < r.phases.length; i++) {
    const raw = r.phases[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`phases[${i}] must be a mapping`);
    }
    const p = raw as Record<string, unknown>;
    const [id] = asIntList(p.id, `phases[${i}].id`);
    if (id === undefined) throw new Error(`phases[${i}] has no \`id\``);
    if (seen.has(id)) throw new Error(`phase id ${id} is declared twice`);
    seen.add(id);
    phases.push({
      id,
      dependsOn: asIntList(p.depends_on, `phase ${id} depends_on`),
      touches: asStrList(p.touches, `phase ${id} touches`),
      parallelSafe: asBool(p.parallel_safe, `phase ${id} parallel_safe`, true),
      integration: asBool(p.integration, `phase ${id} integration`, false),
      productionTouch: asBool(p.production_touch, `phase ${id} production_touch`, false),
    });
  }
  const waiversRaw = r.waivers ?? r.overlap_waivers;
  const waivers: OverlapWaiver[] = [];
  if (waiversRaw !== undefined && waiversRaw !== null) {
    if (!Array.isArray(waiversRaw)) throw new Error("`waivers` must be a list");
    for (let i = 0; i < waiversRaw.length; i++) {
      const raw = waiversRaw[i];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`waivers[${i}] must be a mapping`);
      }
      const w = raw as Record<string, unknown>;
      waivers.push({
        phases: asIntList(w.phases, `waivers[${i}].phases`),
        paths: asStrList(w.paths, `waivers[${i}].paths`),
        approver: typeof w.approver === "string" ? w.approver.trim() : "",
        reason: typeof w.reason === "string" ? w.reason.trim() : "",
      });
    }
  }
  return { phases, waivers };
}

export function extractExecutionGraph(planText: string): GraphExtract {
  const yamlText = executionGraphYaml(planText);
  if (yamlText === null) return { present: false };
  if (yamlText.trim() === "") {
    return { present: true, ok: false, error: "section has no fenced YAML block" };
  }
  try {
    return { present: true, ok: true, graph: parseExecutionGraph(yamlText) };
  } catch (e) {
    return { present: true, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Plan text: checklist phases + Files entries
// ---------------------------------------------------------------------------

/** Phase numbers the plan declares: `## Phase checklist` rows first; the
 *  `### N. Phase` headings when the plan has no checklist. */
export function planPhaseIds(planText: string): number[] {
  const lines = planText.split(/\r?\n/);
  const fromChecklist: number[] = [];
  const fromHeadings: number[] = [];
  let region: "checklist" | "phases" | null = null;
  let fence: string | null = null;
  for (const line of lines) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const title = sectionTitle(line);
    if (title !== null) {
      region = title.startsWith("phase checklist")
        ? "checklist"
        : /^phases\b/.test(title)
          ? "phases"
          : null;
      continue;
    }
    if (region === "checklist") {
      const m = /^- \[.\] Phase (\d+)\b/.exec(line);
      if (m) fromChecklist.push(Number(m[1]));
    } else if (region === "phases" && /^### /.test(line)) {
      const n = phaseHeadingNumber(line);
      if (n !== null) fromHeadings.push(n);
    }
  }
  const pick = fromChecklist.length > 0 ? fromChecklist : fromHeadings;
  return [...new Set(pick)].sort((a, b) => a - b);
}

const LABEL_RE = /^\s*(?:[-*]\s+)?\*{0,2}([A-Za-z][A-Za-z /-]*?)\*{0,2}\s*:\*{0,2}\s*$/;
const ENTRY_SEP_RE = /\s+(?:—|–|-{1,2})\s+/;
const TICK_RE = /`([^`]+)`/g;

/** Entry paths of one `Files:` bullet: every backticked token before the
 *  annotation separator; the bare text before it when nothing is ticked. */
export function filesEntryPaths(bullet: string): string[] {
  const text = bullet.replace(/^\s*[-*]\s+/, "");
  const head = text.split(ENTRY_SEP_RE)[0] ?? text;
  const ticked = [...head.matchAll(TICK_RE)].map((m) => m[1].trim()).filter(Boolean);
  if (ticked.length > 0) return ticked;
  const bare = head.trim().replace(/[.,;:]+$/, "");
  return bare === "" ? [] : [bare];
}

/** Phase → entry paths read off each phase's `Files:` list. */
export function planPhaseFiles(planText: string): Map<number, string[]> {
  const lines = planText.split(/\r?\n/);
  const phaseOf = planPhaseMap(planText);
  const out = new Map<number, string[]>();
  let inFiles = false;
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const phase = phaseOf[i];
    if (phase === null || /^#{2,3} /.test(line)) {
      inFiles = false;
      continue;
    }
    const label = LABEL_RE.exec(line);
    if (label) {
      inFiles = label[1].trim().toLowerCase() === "files";
      continue;
    }
    if (!inFiles) continue;
    if (!/^\s*[-*]\s+/.test(line)) continue; // continuation / prose line
    const list = out.get(phase) ?? [];
    for (const p of filesEntryPaths(line)) if (!list.includes(p)) list.push(p);
    out.set(phase, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Path overlap
// ---------------------------------------------------------------------------

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** True when two declared paths can touch the same file: equal, or one is
 *  a directory / `dir/**` / `dir/*` prefix of the other. */
export function pathsOverlap(a: string, b: string): boolean {
  const na = normPath(a);
  const nb = normPath(b);
  if (na === nb) return true;
  const prefixOf = (x: string): string | null => {
    const m = /^(.*?)\/\*{1,2}$/.exec(x);
    if (m) return m[1];
    return null;
  };
  const pa = prefixOf(na);
  const pb = prefixOf(nb);
  if (pa !== null && (nb === pa || nb.startsWith(`${pa}/`))) return true;
  if (pb !== null && (na === pb || na.startsWith(`${pb}/`))) return true;
  // A bare path with no extension and no glob reads as a directory too.
  const dirLike = (x: string): boolean => !/\.[A-Za-z0-9]+$/.test(x.split("/").pop() ?? "");
  if (dirLike(na) && nb.startsWith(`${na}/`)) return true;
  if (dirLike(nb) && na.startsWith(`${nb}/`)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export function effectiveParallelSafe(p: GraphPhase): boolean {
  return p.parallelSafe && !p.integration && !p.productionTouch;
}

/** id → set of every ancestor reachable through `depends_on`. */
export function ancestors(graph: ExecutionGraph): Map<number, Set<number>> {
  const deps = new Map(graph.phases.map((p) => [p.id, p.dependsOn]));
  const memo = new Map<number, Set<number>>();
  const visit = (id: number, stack: Set<number>): Set<number> => {
    const done = memo.get(id);
    if (done) return done;
    const acc = new Set<number>();
    if (stack.has(id)) return acc; // cycle — reported separately
    stack.add(id);
    for (const d of deps.get(id) ?? []) {
      acc.add(d);
      for (const a of visit(d, stack)) acc.add(a);
    }
    stack.delete(id);
    memo.set(id, acc);
    return acc;
  };
  for (const p of graph.phases) visit(p.id, new Set());
  return memo;
}

/** Kahn's algorithm. Returns the ids left unordered when a cycle exists
 *  (empty = acyclic). */
export function cycleMembers(graph: ExecutionGraph): number[] {
  const ids = graph.phases.map((p) => p.id);
  const known = new Set(ids);
  const indeg = new Map<number, number>(ids.map((id) => [id, 0]));
  const dependents = new Map<number, number[]>(ids.map((id) => [id, []]));
  for (const p of graph.phases) {
    for (const d of p.dependsOn) {
      if (!known.has(d)) continue;
      indeg.set(p.id, (indeg.get(p.id) ?? 0) + 1);
      dependents.get(d)!.push(p.id);
    }
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const seen = new Set<number>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    seen.add(id);
    for (const n of dependents.get(id) ?? []) {
      indeg.set(n, (indeg.get(n) ?? 0) - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  return ids.filter((id) => !seen.has(id)).sort((a, b) => a - b);
}

/** Dependency-respecting phase order (ids ascending within a layer). */
export function topoOrder(graph: ExecutionGraph): number[] {
  const anc = ancestors(graph);
  const ids = [...graph.phases.map((p) => p.id)].sort((a, b) => a - b);
  const placed = new Set<number>();
  const out: number[] = [];
  while (out.length < ids.length) {
    const layer = ids.filter(
      (id) => !placed.has(id) && [...(anc.get(id) ?? [])].every((a) => placed.has(a)),
    );
    if (layer.length === 0) break; // cycle
    for (const id of layer) {
      placed.add(id);
      out.push(id);
    }
  }
  return out;
}

interface Overlap {
  a: number;
  b: number;
  paths: string[];
}

function sharedPaths(filesA: string[], filesB: string[]): string[] {
  const out: string[] = [];
  for (const x of filesA) {
    for (const y of filesB) {
      if (pathsOverlap(x, y)) {
        const key = x === y ? x : `${x} ~ ${y}`;
        if (!out.includes(key)) out.push(key);
      }
    }
  }
  return out;
}

function waiverCovers(w: OverlapWaiver, o: Overlap): boolean {
  if (!w.phases.includes(o.a) || !w.phases.includes(o.b)) return false;
  if (w.paths.length === 0) return true;
  return o.paths.every((shared) =>
    shared.split(" ~ ").some((p) => w.paths.some((wp) => pathsOverlap(wp, p))),
  );
}

/**
 * Pairs of phases with no dependency path between them in either direction.
 * These are the only pairs a file overlap can bite — an ordered pair
 * serializes by construction.
 */
export function unorderedPairs(graph: ExecutionGraph): Array<[number, number]> {
  const anc = ancestors(graph);
  const ids = [...graph.phases.map((p) => p.id)].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      if (anc.get(a)?.has(b) || anc.get(b)?.has(a)) continue;
      out.push([a, b]);
    }
  }
  return out;
}

export function checkExecutionGraph(planText: string): GraphCheck {
  const files = planPhaseFiles(planText);
  const extracted = extractExecutionGraph(planText);
  if (!extracted.present) {
    return { present: false, graph: null, files, findings: [], failed: false };
  }
  const findings: GraphFinding[] = [];
  if (!extracted.ok) {
    findings.push({
      severity: "fail",
      code: "graph-invalid",
      message: `Execution graph does not parse: ${extracted.error}`,
    });
    return { present: true, graph: null, files, findings, failed: true };
  }
  const graph = extracted.graph;
  const ids = new Set(graph.phases.map((p) => p.id));

  // Unknown / self dependencies.
  for (const p of graph.phases) {
    for (const d of p.dependsOn) {
      if (d === p.id) {
        findings.push({
          severity: "fail",
          code: "graph-unknown-dep",
          message: `phase ${p.id} depends on itself`,
        });
      } else if (!ids.has(d)) {
        findings.push({
          severity: "fail",
          code: "graph-unknown-dep",
          message: `phase ${p.id} depends on phase ${d}, which the graph does not declare`,
        });
      }
    }
  }

  // Bijection with the plan's phases.
  const planIds = planPhaseIds(planText);
  const planSet = new Set(planIds);
  const onlyGraph = [...ids].filter((id) => !planSet.has(id)).sort((a, b) => a - b);
  const onlyPlan = planIds.filter((id) => !ids.has(id));
  if (planIds.length === 0) {
    findings.push({
      severity: "fail",
      code: "graph-checklist-mismatch",
      message: "plan declares an Execution graph but no Phase checklist rows or `### N. Phase` headings to key it to",
    });
  } else if (onlyGraph.length > 0 || onlyPlan.length > 0) {
    const parts: string[] = [];
    if (onlyGraph.length > 0) parts.push(`in graph but not in the plan: ${onlyGraph.join(", ")}`);
    if (onlyPlan.length > 0) parts.push(`in the plan but not in the graph: ${onlyPlan.join(", ")}`);
    findings.push({
      severity: "fail",
      code: "graph-checklist-mismatch",
      message: `Execution graph phases ≠ plan phases — ${parts.join("; ")}`,
    });
  }

  // Cycle.
  const cyc = cycleMembers(graph);
  if (cyc.length > 0) {
    findings.push({
      severity: "fail",
      code: "graph-cycle",
      message: `Execution graph has a cycle through phases ${cyc.join(", ")}`,
    });
  }

  // Waiver shape.
  for (const [i, w] of graph.waivers.entries()) {
    if (w.phases.length < 2 || w.approver === "" || w.reason === "") {
      findings.push({
        severity: "fail",
        code: "graph-waiver-invalid",
        message: `waivers[${i}] needs ≥2 phases, a named approver and a reason`,
      });
    }
  }

  // Flags.
  for (const p of graph.phases) {
    if (p.parallelSafe && (p.integration || p.productionTouch)) {
      findings.push({
        severity: "concern",
        code: "graph-parallel-flag",
        message: `phase ${p.id} is marked parallel_safe but is ${p.integration ? "an integration" : "a production-touch"} phase — treated as parallel_safe: false`,
      });
    }
  }

  // Unordered overlaps (only when the graph is otherwise sound enough to
  // compute reachability — a cycle makes "unordered" meaningless).
  if (cyc.length === 0) {
    const touched = (id: number): string[] => {
      const p = graph.phases.find((x) => x.id === id);
      return [...(files.get(id) ?? []), ...(p?.touches ?? [])];
    };
    for (const [a, b] of unorderedPairs(graph)) {
      const shared = sharedPaths(touched(a), touched(b));
      if (shared.length === 0) continue;
      const o: Overlap = { a, b, paths: shared };
      const waiver = graph.waivers.find((w) => waiverCovers(w, o) && w.approver !== "" && w.reason !== "");
      if (!waiver) {
        findings.push({
          severity: "fail",
          code: "graph-overlap",
          message: `phases ${a} and ${b} both change ${shared.join(", ")} with no dependency between them — add a depends_on edge or a waiver with approver + reason`,
        });
        continue;
      }
      const pa = graph.phases.find((x) => x.id === a)!;
      const pb = graph.phases.find((x) => x.id === b)!;
      if (effectiveParallelSafe(pa) && effectiveParallelSafe(pb)) {
        findings.push({
          severity: "concern",
          code: "graph-parallel-collision",
          message: `phases ${a} and ${b} share ${shared.join(", ")} under waiver by ${waiver.approver} yet both are parallel_safe — run them in one loop, or set parallel_safe: false on one`,
        });
      }
    }
  }

  return {
    present: true,
    graph,
    files,
    findings,
    failed: findings.some((f) => f.severity === "fail"),
  };
}

// ---------------------------------------------------------------------------
// Emission support
// ---------------------------------------------------------------------------

export interface EmissionPhase {
  id: number;
  dependsOn: number[];
  /** `effectiveParallelSafe` */
  parallelSafe: boolean;
  /** Phases provably independent of this one: no path either way, no
   *  shared file, both parallel-safe. Symmetric. */
  independentWith: number[];
  files: string[];
}

export interface EmissionPlan {
  present: boolean;
  /** Dependency-respecting order; the Phase checklist order when no graph. */
  order: number[];
  phases: EmissionPhase[];
  findings: GraphFinding[];
}

/** What RED emission needs from the plan, graph or not. */
export function emissionPlan(planText: string): EmissionPlan {
  const check = checkExecutionGraph(planText);
  const planIds = planPhaseIds(planText);
  if (!check.present || check.graph === null) {
    return {
      present: check.present,
      order: planIds,
      phases: planIds.map((id) => ({
        id,
        dependsOn: [],
        parallelSafe: false,
        independentWith: [],
        files: check.files.get(id) ?? [],
      })),
      findings: check.findings,
    };
  }
  const g = check.graph;
  const touched = (id: number): string[] => {
    const p = g.phases.find((x) => x.id === id);
    return [...(check.files.get(id) ?? []), ...(p?.touches ?? [])];
  };
  const independent = new Map<number, number[]>(g.phases.map((p) => [p.id, []]));
  if (!check.failed) {
    for (const [a, b] of unorderedPairs(g)) {
      const pa = g.phases.find((x) => x.id === a)!;
      const pb = g.phases.find((x) => x.id === b)!;
      if (!effectiveParallelSafe(pa) || !effectiveParallelSafe(pb)) continue;
      if (sharedPaths(touched(a), touched(b)).length > 0) continue;
      independent.get(a)!.push(b);
      independent.get(b)!.push(a);
    }
  }
  const order = check.failed ? g.phases.map((p) => p.id).sort((a, b) => a - b) : topoOrder(g);
  return {
    present: true,
    order,
    phases: [...g.phases]
      .sort((a, b) => a.id - b.id)
      .map((p) => ({
        id: p.id,
        dependsOn: [...p.dependsOn].sort((a, b) => a - b),
        parallelSafe: effectiveParallelSafe(p),
        independentWith: (independent.get(p.id) ?? []).sort((a, b) => a - b),
        files: touched(p.id),
      })),
    findings: check.findings,
  };
}

/** Phase → dev hashes its `blocked_by` must carry, for the phases whose
 *  hash and whose dependencies' hashes are all known. */
export function blockedByFromGraph(
  graph: ExecutionGraph,
  phaseToHash: Map<number, string>,
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const p of graph.phases) {
    if (!phaseToHash.has(p.id)) continue;
    const hashes: string[] = [];
    for (const d of p.dependsOn) {
      const h = phaseToHash.get(d);
      if (h !== undefined) hashes.push(h);
    }
    out.set(p.id, hashes);
  }
  return out;
}
