// Story-graph read model (sgr102 / plan Phase 2).
//
// `buildGraphModel()` assembles the nodes/edges/groups/warnings the renderer
// (Phase 3) and the regen hooks (Phases 4–5) consume. It is the one genuinely
// new read-model in this workstream: a CROSS-DIR spec index unioned with the
// four backlog files, with every edge validated against the known-hash set.
//
// Wrap-don't-duplicate ledger (CLAUDE.md working agreement):
//   - backlog rows / epic headings → src/lib/backlog/parse.ts (mgr103+sgr101)
//   - hash normalization           → parse.ts splitHashes (sgr101 export;
//                                    the ONE normalizer — never forked here)
//   - engine frontmatter           → engine/frontmatter.ts readEngineState
//   - workstream membership        → engine/workstream.ts resolveSpecWorkstream
//   - INTERVIEW/MANUAL blockers    → parse.ts parseInterviewMd/parseManualMd
//
// What this module deliberately does NOT do:
//   - It is a map, not a dispatcher. It renders the validated edge union and
//     each node's effective status; it re-implements no resolver's "runnable"
//     verdict (that stays in next/decide.ts + manage/reconcile).
//   - It never reads todo.md pointers. Phase 6's backfill materializes
//     pointer-derived edges into frontmatter instead (recorded narrowing).
//   - It never invents an edge. An unknown token is dropped and warned, never
//     rendered as a phantom node.
//
// Spec: dev/dev-sgr102-2026-08-02T13:57-graph-model.md
// Design: _devx/workstreams/story-graph/design.md §Architecture 2, §Data

import { join } from "node:path";
import { parseDocument } from "yaml";

import {
  type DevRow,
  type SpecStatus,
  type SpecType,
  normalizeStatus,
  parseDevMd,
  parseEpicHeadings,
  parseInterviewMd,
  parseManualMd,
  splitHashes,
} from "../backlog/parse.js";
import { type EngineConfig } from "../engine/config.js";
import {
  SPEC_TYPE_DIRS,
  readEngineState,
  splitFrontmatter,
} from "../engine/frontmatter.js";
import {
  type EngineFs,
  type PlanSpecIndexCache,
  resolveSpecWorkstream,
} from "../engine/workstream.js";

// ---------------------------------------------------------------------------
// Types (the `--format json` contract — pinned in design.md § Data)
// ---------------------------------------------------------------------------

/** Read-only subset of the engine fs seam — the model never writes. */
export type GraphFs = Pick<EngineFs, "readFile" | "exists" | "readdir">;

export interface GraphNode {
  hash: string;
  type: SpecType;
  title: string;
  /** Effective status: spec frontmatter wins, backlog row is the fallback
   *  (the gather.ts:191 precedence — the dispatcher and the map must never
   *  disagree about the same item). */
  status: SpecStatus;
  /** Group id. Nullable in the pinned interface; in practice every node
   *  lands somewhere, ungrouped ones in the STANDALONE_GROUP bucket. */
  group: string | null;
  badges: string[];
}

export type EdgeKind = "blocks" | "parallel" | "lineage";

/** Where an edge was read from. `derived` is reserved for Phase 6 backfill's
 *  pointer-derived edges; nothing in this module emits it yet. */
export type EdgeSource = "row" | "frontmatter" | "derived";

export interface GraphEdge {
  /** For `blocks`: the BLOCKED spec (it depends on `to`). For `lineage`:
   *  the parent/predecessor. For `parallel`: the lexicographically smaller
   *  endpoint — parallel-safety is symmetric, so the pair is canonicalized
   *  to keep a mutual declaration from rendering as two arrows. */
  from: string;
  to: string;
  kind: EdgeKind;
  sources: EdgeSource[];
}

export type GroupKind = "workstream" | "epic" | "standalone";

export interface GraphGroup {
  id: string;
  kind: GroupKind;
  title: string;
  /** True when every member is settled — the renderer draws one summary
   *  node instead of the members. */
  collapsed: boolean;
  stats: {
    done: number;
    total: number;
    /** ISO date (YYYY-MM-DD) of the latest `merged via PR` status-log line
     *  across the members; null when no member records one. */
    lastMerged: string | null;
  };
}

export type WarningCode =
  | "unknown-blocker"
  | "edge-drift"
  | "hyphen-key"
  | "heading-fallback";

export interface GraphWarning {
  code: WarningCode;
  /** The spec the warning is about, when it is about one. */
  hash?: string;
  /** Where the offending text lives (`DEV.md row 'tgt111'`, `DEV.md`). */
  source?: string;
  message: string;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
  warnings: GraphWarning[];
}

export type BuildGraphResult =
  | { ok: true; model: GraphModel; warnings: GraphWarning[] }
  /** Blocking edges contain at least one cycle. `cycle` lists EVERY hash
   *  participating in any cycle (all non-trivial SCC members plus every
   *  self-blocker), sorted. A cycle is a hard error: the CLI exits non-zero
   *  and writes no GRAPH.md (E-3). */
  | { ok: false; cycle: string[] };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The four backlog files the graph indexes. `readBacklogRows`
 *  (gather.ts:452) is private and reads only three of them — TEST.md
 *  indexing is new here, so the ~10-line loop is re-composed deliberately
 *  rather than exported (recorded in plan Phase 2 § Context). */
export const BACKLOG_FILES: ReadonlyArray<string> = [
  "DEV.md",
  "PLAN.md",
  "TEST.md",
  "DEBUG.md",
];

/** Bucket for specs that belong to no workstream and sit under no epic
 *  heading. A (pathological) epic heading that slugifies to this same id
 *  simply merges with the bucket and upgrades its kind to `epic`. */
export const STANDALONE_GROUP = "standalone";

/** Statuses that mean "this item needs no more attention" — the collapse
 *  rule's definition of settled. Exported for backfill (sgr106), which uses
 *  the SAME definition to decide a row is closed and must not grow new prose;
 *  two spellings of "settled" would let the map and the writer disagree. */
export const SETTLED_STATUSES: ReadonlySet<SpecStatus> = new Set<SpecStatus>([
  "done",
  "deleted",
  "superseded",
]);

/** Group render order: active work first, catch-all last. */
const GROUP_KIND_RANK: Record<GroupKind, number> = {
  workstream: 0,
  epic: 1,
  standalone: 2,
};

const SOURCE_ORDER: ReadonlyArray<EdgeSource> = ["row", "frontmatter", "derived"];

/**
 * A status-log merge line → its ISO date. Both shipped dialects match:
 *   `- 2026-07-15T12:22 — merged via PR #77 (squash → b0223bd)`   (/devx)
 *   `- 2026-07-30T16:58:47.217Z — merged via devx loop — PR <url>` (devx loop)
 *
 * `merged via …PR` is deliberately the anchor rather than a bare `merged`:
 * BMAD-era prose ("merged. mergeStateStatus was CLEAN … Squash-merged to
 * main as 70872e4") records the same event without the marker, and the
 * pinned contract is "derived from the `merged via PR` line; omitted when
 * absent" — those specs correctly report null rather than a guessed date.
 */
const MERGED_LINE_RE = /^-\s*(\d{4}-\d{2}-\d{2})\S*\s+.*\bmerged via\b[^\n]*\bPR\b/gim;

/** Latest merge date recorded in a spec's status log, or null. */
function latestMergedDate(content: string): string | null {
  let latest: string | null = null;
  // A fix-forward story can carry more than one merge line; take the max
  // rather than the first (`exec` would stop at the earliest). `matchAll`
  // is also the only safe reader for a module-level `/g` regex — `.exec`
  // or `.test` on a shared one advances `lastIndex` between specs and would
  // make the result depend on iteration order.
  for (const m of content.matchAll(MERGED_LINE_RE)) {
    if (latest === null || m[1] > latest) latest = m[1];
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Frontmatter reads (YAML-aware, memoized)
// ---------------------------------------------------------------------------

/**
 * `readEngineState` carries the engine keys and `blocked_by`, but not
 * `from:` / `spawned:` / `title:` / `superseded_by:` / the hyphenated
 * `blocked-by:` drift key. Those are read here through the same
 * `parseDocument` approach `readEngineState` uses internally — NOT
 * `parseFrontmatterValue`, which is a single-line scalar reader and cannot
 * see a `spawned:` block-list or an inline array (spec AC 1).
 *
 * Exported un-memoized for backfill (sgr106), which needs the same raw view
 * — both `blocked_by` spellings plus `phase:` — while it decides what to
 * write. One parser, two readers: a second hand-rolled frontmatter reader is
 * exactly how the hyphen key got lost in the first place.
 */
export function readSpecFrontmatterMap(
  content: string,
): Record<string, unknown> {
  const split = splitFrontmatter(content);
  if (!split) return {};
  try {
    const parsed = parseDocument(split.fmText).toJS() as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed frontmatter degrades to "no keys" — same defensive posture
    // as readEngineState. A half-edited spec must never crash a board render
    // (nor abort a backfill pass that has other specs to complete).
  }
  return {};
}

/**
 * Memoized by content string: `resolveSpecWorkstream` calls the injected
 * scalar reader twice per spec on top of this module's own reads, and a
 * 200-spec repo would otherwise re-parse the same YAML ~1,000 times.
 */
function makeFrontmatterReader(): {
  map(content: string): Record<string, unknown>;
  scalar(content: string, key: string): string | null;
} {
  const memo = new Map<string, Record<string, unknown>>();
  const map = (content: string): Record<string, unknown> => {
    const hit = memo.get(content);
    if (hit !== undefined) return hit;
    const out = readSpecFrontmatterMap(content);
    memo.set(content, out);
    return out;
  };
  return {
    map,
    scalar: (content, key) => {
      const v = map(content)[key];
      if (typeof v === "string") return v.trim() === "" ? null : v.trim();
      if (typeof v === "number") return String(v);
      return null;
    },
  };
}

/** Coerce a frontmatter value to a list of raw strings. Handles the bare
 *  scalar (`spawned: bbb333`), the inline array (`blocked_by: [a, b]`) and
 *  the block list — all three occur in the wild (palateful audit). */
function toStringList(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
      .map((x) => String(x).trim())
      .filter((x) => x !== "");
  }
  if (typeof v === "string" || typeof v === "number") {
    const s = String(v).trim();
    return s === "" ? [] : [s];
  }
  return [];
}

/** Every hash named by a frontmatter list value, normalized through the ONE
 *  normalizer. Frontmatter values bypass `splitHashes` everywhere else in
 *  the codebase (frontmatter.ts:248-255) — that divergence is exactly what
 *  loses spec-path-shaped blockers, so the graph routes them through it. */
function hashesFromValue(v: unknown): string[] {
  const out: string[] = [];
  for (const raw of toStringList(v)) {
    for (const h of splitHashes(raw)) if (!out.includes(h)) out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spec index
// ---------------------------------------------------------------------------

interface SpecEntry {
  hash: string;
  type: SpecType;
  /** Repo-relative path (`dev/dev-sgr102-….md`). */
  path: string;
  content: string;
  title: string | null;
  status: SpecStatus | null;
  /** Union of `blocked_by:` and the hyphenated `blocked-by:` drift key. */
  blockedBy: string[];
  /** True when the hyphenated key was present — the normalization warning. */
  hyphenKey: boolean;
  from: string[];
  spawned: string[];
  supersededBy: string[];
  /** ISO date of the latest `merged via PR` status-log line, or null. */
  mergedDate: string | null;
}

/** `dev-sgr102-2026-08-02T13:57-graph-model.md` → `sgr102`, under `dev/`.
 *  Compiled once per type rather than once per file — a 200-spec repo would
 *  otherwise build 200 identical RegExps per render. */
const SPEC_FILENAME_RES = new Map<string, RegExp>(
  SPEC_TYPE_DIRS.map((t) => [t, new RegExp(`^${t}-([a-z0-9]{3,12})-.+\\.md$`, "i")]),
);

/** The hash a spec FILENAME encodes, or null when the name isn't a spec of
 *  that type. Exported for backfill (sgr106), which walks the same dirs to
 *  find each node's file — a second filename regex would drift from this
 *  one the first time the convention moves. */
export function specFilenameHash(type: string, name: string): string | null {
  const m = SPEC_FILENAME_RES.get(type)?.exec(name);
  return m ? m[1].toLowerCase() : null;
}

function buildSpecIndex(
  fs: GraphFs,
  repoRoot: string,
  fm: ReturnType<typeof makeFrontmatterReader>,
): Map<string, SpecEntry> {
  const index = new Map<string, SpecEntry>();
  for (const type of SPEC_TYPE_DIRS) {
    const dir = join(repoRoot, type);
    if (!fs.exists(dir)) continue;
    let names: string[];
    try {
      names = [...fs.readdir(dir)].sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const hash = specFilenameHash(type, name);
      if (hash === null) continue;
      // First dir in SPEC_TYPE_DIRS order wins a cross-dir hash collision.
      // Deterministic rather than silently arbitrary; the collision itself
      // is already an error surface elsewhere (AmbiguousSpecHashError, which
      // `devx next` and every gate raise on the same input).
      if (index.has(hash)) continue;
      // Unlike a backlog file (see readBacklogs), one unreadable SPEC
      // degrades gracefully rather than failing the render: its backlog row
      // still puts the node on the board with a row-derived status and
      // title, so the loss is the spec's frontmatter edges, not the item.
      let content: string;
      try {
        content = fs.readFile(join(dir, name));
      } catch {
        continue;
      }
      const raw = fm.map(content);
      const state = readEngineState(content);
      const hyphenKey = raw["blocked-by"] !== undefined;
      const blockedBy = [...state.blockedBy.flatMap((v) => splitHashes(v))];
      for (const h of hashesFromValue(raw["blocked-by"])) {
        if (!blockedBy.includes(h)) blockedBy.push(h);
      }
      const titleRaw = raw.title;
      index.set(hash, {
        hash,
        type: type as SpecType,
        path: `${type}/${name}`,
        content,
        title:
          typeof titleRaw === "string" && titleRaw.trim() !== ""
            ? titleRaw.trim()
            : null,
        status: state.status !== null ? normalizeStatus(state.status) : null,
        blockedBy,
        hyphenKey,
        from: hashesFromValue(raw.from),
        spawned: hashesFromValue(raw.spawned),
        supersededBy: hashesFromValue(raw.superseded_by),
        mergedDate: latestMergedDate(content),
      });
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Backlog rows
// ---------------------------------------------------------------------------

interface RowEntry {
  row: DevRow;
  backlog: string;
}

/** An epic heading that declared a section but named no linkage hash. */
interface UnlinkedHeading {
  backlog: string;
  slug: string;
}

interface BacklogIndex {
  /** First non-struck row per hash, in BACKLOG_FILES order. */
  rows: Map<string, RowEntry>;
  /** Hashes whose every row is struck — excluded from the board entirely. */
  stricken: Set<string>;
  unlinkedHeadings: UnlinkedHeading[];
}

function readBacklogs(fs: GraphFs, repoRoot: string): BacklogIndex {
  const rows = new Map<string, RowEntry>();
  const strickenCandidates = new Set<string>();
  const unlinkedHeadings: UnlinkedHeading[] = [];
  for (const backlog of BACKLOG_FILES) {
    const abs = join(repoRoot, backlog);
    if (!fs.exists(abs)) continue;
    // Deliberately NOT swallowed. The backlogs are the primary input: an
    // unreadable DEV.md that degraded to "contributes nothing" would render
    // a clean, plausible, EMPTY board — the same failure mode gather.ts had
    // to fix ("a chmod-000 DEV.md produced row 12 with zero signal"). The
    // gatherer answers it with a warning; the graph has no warning code for
    // it (the four are pinned), so the honest option is to fail loudly and
    // let the CLI exit 2. Existence was already checked above, so this only
    // fires on a real read error.
    let content: string;
    try {
      content = fs.readFile(abs);
    } catch (e) {
      throw new Error(
        `buildGraphModel: ${backlog} exists but is unreadable (${e instanceof Error ? e.message : String(e)}) — refusing to render a graph that would silently omit it`,
      );
    }
    for (const row of parseDevMd(content)) {
      if (row.struck) {
        strickenCandidates.add(row.hash);
        continue;
      }
      if (!rows.has(row.hash)) rows.set(row.hash, { row, backlog });
    }
    // A heading that declares an epic but names no linkage hash partitions
    // the board on its slug alone — `--epic <slug>` still works, but nothing
    // ties the section to a plan spec. Collected here, warned later: the
    // warning is suppressed once the group settles (see below).
    for (const heading of parseEpicHeadings(content)) {
      if (heading.planHash === null) {
        unlinkedHeadings.push({ backlog, slug: heading.slug });
      }
    }
  }
  // A hash struck in one file but live in another is live — the strike is
  // only authoritative when nothing contradicts it.
  const stricken = new Set<string>();
  for (const h of strickenCandidates) if (!rows.has(h)) stricken.add(h);
  return { rows, stricken, unlinkedHeadings };
}

// ---------------------------------------------------------------------------
// Edge accumulation
// ---------------------------------------------------------------------------

class EdgeSet {
  private readonly map = new Map<string, GraphEdge>();

  add(from: string, to: string, kind: EdgeKind, source: EdgeSource): void {
    const key = `${kind}|${from}|${to}`;
    const hit = this.map.get(key);
    if (hit) {
      if (!hit.sources.includes(source)) {
        hit.sources = SOURCE_ORDER.filter(
          (s) => s === source || hit.sources.includes(s),
        );
      }
      return;
    }
    this.map.set(key, { from, to, kind, sources: [source] });
  }

  list(): GraphEdge[] {
    return [...this.map.values()].sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        a.kind.localeCompare(b.kind),
    );
  }
}

// ---------------------------------------------------------------------------
// Cycle detection (Tarjan SCC over blocking edges only)
// ---------------------------------------------------------------------------

/**
 * Every hash that participates in a blocking cycle, sorted. Lineage and
 * parallel edges are exempt: lineage is legitimately bidirectional-looking
 * across a `from:`/`spawned:` pair, and parallel edges are symmetric by
 * construction.
 *
 * SCC rather than "first cycle found" so the error enumerates EVERY member
 * of EVERY cycle (spec AC 6) — an operator fixing one arm of a two-cycle
 * tangle should not have to re-run to discover the second.
 */
export function findBlockingCycles(edges: GraphEdge[]): string[] {
  const adj = new Map<string, string[]>();
  const selfBlockers = new Set<string>();
  for (const e of edges) {
    if (e.kind !== "blocks") continue;
    if (e.from === e.to) {
      selfBlockers.add(e.from);
      continue;
    }
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const members = new Set<string>(selfBlockers);
  let counter = 0;

  // Iterative Tarjan — a deep dependency chain must not blow the JS stack.
  const roots = [...new Set([...adj.keys(), ...[...adj.values()].flat()])].sort();
  for (const root of roots) {
    if (index.has(root)) continue;
    const work: Array<{ node: string; next: number }> = [
      { node: root, next: 0 },
    ];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbors = adj.get(frame.node) ?? [];
      if (frame.next < neighbors.length) {
        const w = neighbors[frame.next++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
          if (w === frame.node) break;
        }
        if (component.length > 1) for (const h of component) members.add(h);
      }
    }
  }
  return [...members].sort();
}

// ---------------------------------------------------------------------------
// buildGraphModel
// ---------------------------------------------------------------------------

export function buildGraphModel(
  fs: GraphFs,
  repoRoot: string,
  engine: EngineConfig,
): BuildGraphResult {
  const fm = makeFrontmatterReader();
  const specs = buildSpecIndex(fs, repoRoot, fm);
  const backlog = readBacklogs(fs, repoRoot);
  const warnings: GraphWarning[] = [];

  // ── Node universe ──────────────────────────────────────────────────────
  // Union of the spec index and the backlog rows, minus stricken hashes. A
  // stricken hash stays KNOWN (so edges pointing at it read as deliberately
  // abandoned rather than as phantoms) but renders nothing.
  const hashes = new Set<string>();
  for (const h of specs.keys()) if (!backlog.stricken.has(h)) hashes.add(h);
  for (const h of backlog.rows.keys()) if (!backlog.stricken.has(h)) hashes.add(h);
  const known = new Set<string>([...hashes, ...backlog.stricken]);

  // ── Group membership ───────────────────────────────────────────────────
  const planCache: PlanSpecIndexCache = {};
  const groupKinds = new Map<string, GroupKind>();
  const groupOf = new Map<string, string>();
  const claimGroup = (id: string, kind: GroupKind): void => {
    const prior = groupKinds.get(id);
    if (prior === undefined || GROUP_KIND_RANK[kind] < GROUP_KIND_RANK[prior]) {
      groupKinds.set(id, kind);
    }
  };
  for (const hash of hashes) {
    const spec = specs.get(hash);
    let id: string | null = null;
    let kind: GroupKind = "standalone";
    if (spec) {
      const membership = resolveSpecWorkstream(
        fs,
        repoRoot,
        engine,
        spec.content,
        fm.scalar,
        planCache,
      );
      if (membership.slug !== null) {
        id = membership.slug;
        kind = "workstream";
      }
    }
    if (id === null) {
      // Backlog heading is the fallback partition — the ffm dialect (specs
      // with no workstream pointer under a `### <slug> (workstream <hash>)`
      // heading) resolves here.
      const epicSlug = backlog.rows.get(hash)?.row.epicSlug ?? null;
      if (epicSlug !== null && epicSlug !== "") {
        id = epicSlug;
        kind = "epic";
      }
    }
    if (id === null) {
      id = STANDALONE_GROUP;
      kind = "standalone";
    }
    groupOf.set(hash, id);
    claimGroup(id, kind);
  }

  // ── Badges (INTERVIEW/MANUAL reverse `Blocks:` edges) ──────────────────
  const badges = new Map<string, string[]>();
  const addBadge = (hash: string, badge: string): void => {
    if (!hashes.has(hash)) return;
    const list = badges.get(hash);
    if (list) {
      if (!list.includes(badge)) list.push(badge);
    } else {
      badges.set(hash, [badge]);
    }
  };
  const interviewAbs = join(repoRoot, "INTERVIEW.md");
  if (fs.exists(interviewAbs)) {
    try {
      for (const q of parseInterviewMd(fs.readFile(interviewAbs))) {
        // An answered question no longer blocks anything — badging it would
        // report resolved decisions as live gates.
        if (q.answered) continue;
        for (const h of q.blocks) addBadge(h, `INTERVIEW Q#${q.qNum}`);
      }
    } catch {
      // unreadable INTERVIEW.md contributes no badges
    }
  }
  const manualAbs = join(repoRoot, "MANUAL.md");
  if (fs.exists(manualAbs)) {
    try {
      for (const item of parseManualMd(fs.readFile(manualAbs))) {
        if (item.checked) continue;
        for (const h of item.blocks) addBadge(h, `MANUAL ${item.id}`);
      }
    } catch {
      // unreadable MANUAL.md contributes no badges
    }
  }

  // ── Nodes ──────────────────────────────────────────────────────────────
  const nodes: GraphNode[] = [];
  for (const hash of [...hashes].sort()) {
    const spec = specs.get(hash);
    const entry = backlog.rows.get(hash);
    const row = entry?.row;
    const status: SpecStatus = spec?.status ?? row?.status ?? "ready";
    // Frontmatter title wins, row title is the fallback (the same precedence
    // as status — the spec is the source of truth, the row mirrors it). A
    // row whose title never parsed is an empty string, not a title.
    const rowTitle = row?.title !== undefined && row.title !== "" ? row.title : null;
    const title = spec?.title ?? rowTitle ?? "";
    nodes.push({
      hash,
      type: spec?.type ?? row?.type ?? "dev",
      title,
      status,
      group: groupOf.get(hash) ?? STANDALONE_GROUP,
      badges: (badges.get(hash) ?? []).sort(),
    });
  }

  // ── Edges ──────────────────────────────────────────────────────────────
  const edges = new EdgeSet();
  const dropUnknown = (
    hash: string,
    token: string,
    annotation: string,
    where: string,
  ): void => {
    warnings.push({
      code: "unknown-blocker",
      hash,
      source: where,
      message: `${where}: ${annotation} names '${token}', which matches no known spec — dropped (no phantom node rendered)`,
    });
  };

  for (const hash of [...hashes].sort()) {
    const spec = specs.get(hash);
    const entry = backlog.rows.get(hash);
    const rowTokens = entry?.row.blocked_by ?? [];
    const fmTokens = spec?.blockedBy ?? [];
    const rowWhere = entry ? `${entry.backlog} row '${hash}'` : `spec '${hash}'`;
    const fmWhere = spec ? `${spec.path} frontmatter` : `spec '${hash}'`;

    if (spec?.hyphenKey) {
      warnings.push({
        code: "hyphen-key",
        hash,
        source: spec.path,
        message: `${spec.path}: frontmatter uses the hyphenated \`blocked-by:\` key — read and normalized to \`blocked_by:\` here; rewrite the key (\`devx graph backfill\` writes the canonical form)`,
      });
    }

    // Validated sets, per source. Validation drops before drift comparison
    // so a phantom token (already warned on its own) can never manufacture
    // a spurious drift warning between two sets that actually agree.
    const keep = (
      tokens: string[],
      annotation: string,
      where: string,
    ): string[] => {
      const out: string[] = [];
      for (const token of tokens) {
        if (!known.has(token)) {
          dropUnknown(hash, token, annotation, where);
          continue;
        }
        // Stricken blockers drop SILENTLY: an abandoned blocker unblocks its
        // dependents (the same posture mgr103 reconcile and gather.ts take),
        // and warning about it would report a resolved state as a defect.
        if (backlog.stricken.has(token)) continue;
        if (!out.includes(token)) out.push(token);
      }
      return out;
    };
    const rowKept = keep(rowTokens, "`Blocked-by:`", rowWhere);
    const fmKept = keep(fmTokens, "`blocked_by:`", fmWhere);

    for (const to of rowKept) edges.add(hash, to, "blocks", "row");
    for (const to of fmKept) edges.add(hash, to, "blocks", "frontmatter");

    // Drift needs BOTH sides to have said something. An edge recorded on
    // only one side is incompleteness (Phase 6 backfill's job), not
    // disagreement — warning on it would fire on most of a real backlog and
    // bury the real conflicts.
    if (rowKept.length > 0 && fmKept.length > 0) {
      const a = [...rowKept].sort().join(",");
      const b = [...fmKept].sort().join(",");
      if (a !== b) {
        warnings.push({
          code: "edge-drift",
          hash,
          source: entry?.backlog,
          message: `'${hash}': row blockers [${a}] disagree with frontmatter blockers [${b}] — both are rendered; reconcile the spec (fix is \`devx doctor\`'s, dev-db36af)`,
        });
      }
    }

    // Parallel-safe peers (row annotation only — there is no frontmatter
    // spelling). Canonicalized to one undirected pair.
    for (const token of entry?.row.parallel_with ?? []) {
      if (!known.has(token)) {
        dropUnknown(hash, token, "`Parallel-safe with`", rowWhere);
        continue;
      }
      if (backlog.stricken.has(token) || token === hash) continue;
      const [a, b] = hash < token ? [hash, token] : [token, hash];
      edges.add(a, b, "parallel", "row");
    }

    // Lineage. Unknown targets drop SILENTLY: `from:` legitimately names
    // non-spec documents (a frozen `_bmad-output/` epic, a workstream dir),
    // and warning on those would drown the real signal.
    if (spec) {
      for (const parent of spec.from) {
        if (parent === hash || !hashes.has(parent)) continue;
        edges.add(parent, hash, "lineage", "frontmatter");
      }
      for (const child of spec.spawned) {
        if (child === hash || !hashes.has(child)) continue;
        edges.add(hash, child, "lineage", "frontmatter");
      }
      for (const successor of spec.supersededBy) {
        if (successor === hash || !hashes.has(successor)) continue;
        edges.add(hash, successor, "lineage", "frontmatter");
      }
    }
  }

  const edgeList = edges.list();

  // ── Cycle check (hard error — no model, no GRAPH.md) ───────────────────
  const cycle = findBlockingCycles(edgeList);
  if (cycle.length > 0) return { ok: false, cycle };

  // ── Groups ─────────────────────────────────────────────────────────────
  const groups: GraphGroup[] = [];
  for (const [id, kind] of groupKinds) {
    const members = nodes.filter((n) => n.group === id);
    const done = members.filter((n) => SETTLED_STATUSES.has(n.status)).length;
    let lastMerged: string | null = null;
    for (const m of members) {
      const d = specs.get(m.hash)?.mergedDate ?? null;
      if (d !== null && (lastMerged === null || d > lastMerged)) lastMerged = d;
    }
    groups.push({
      id,
      kind,
      title: id,
      collapsed: members.length > 0 && done === members.length,
      stats: { done, total: members.length, lastMerged },
    });
  }
  groups.sort(
    (a, b) =>
      GROUP_KIND_RANK[a.kind] - GROUP_KIND_RANK[b.kind] ||
      a.id.localeCompare(b.id),
  );

  // ── heading-fallback (deferred until groups are known) ─────────────────
  // Warn only where the missing linkage is still actionable: a heading whose
  // group is COLLAPSED (every member settled) or whose rows never landed on
  // the board is nobody's next move, and nagging about it buries the live
  // drift. On this repo that is the difference between 14 warnings — 10 of
  // them about closed Phase-0/1 epics nobody will ever re-link — and 4.
  const groupById = new Map(groups.map((g) => [g.id, g]));
  for (const heading of backlog.unlinkedHeadings) {
    const group = groupById.get(heading.slug);
    if (group === undefined || group.collapsed) continue;
    warnings.push({
      code: "heading-fallback",
      source: heading.backlog,
      message: `${heading.backlog}: epic heading '${heading.slug}' names no plan hash — grouped by slug alone; add \`(plan: <hash>)\` or \`(workstream <hash>)\` to link it to its plan spec`,
    });
  }

  warnings.sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      (a.hash ?? "").localeCompare(b.hash ?? "") ||
      (a.source ?? "").localeCompare(b.source ?? "") ||
      a.message.localeCompare(b.message),
  );

  // `model.warnings` and the top-level `warnings` are the SAME array: the
  // `--format json` payload carries them (E-3/E-4 read `model.warnings`)
  // while the library surface in design.md hands callers `{model, warnings}`.
  const model: GraphModel = { nodes, edges: edgeList, groups, warnings };
  return { ok: true, model, warnings };
}
