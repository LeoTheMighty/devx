// `devx graph backfill` — mechanical, adds-only, idempotent completion of the
// durable edge set (sgr106 / plan Phase 6, FR-5).
//
// The board's edges live in two places that drifted apart for years: the
// `Blocked-by:` prose on a backlog row and the `blocked_by:` list in a spec's
// frontmatter. The graph model READS the union of both. This module WRITES the
// union back, so the encoding becomes truthful instead of the reader having to
// be clever forever.
//
// Three rules, and they are the whole contract:
//
//   1. ADDS ONLY. Every write appends. Nothing here removes an edge, ever —
//      not a stale one, not a redundant one, not one that looks wrong. The
//      only thing that disappears is the hyphenated `blocked-by:` SPELLING,
//      whose entries are carried into the canonical key in the same write.
//   2. NEVER GUESSES (D-9 spirit). A derived edge comes from durable state
//      the operator wrote — `phase:` frontmatter, a plan/agent.md `(dev spec: …)`
//      pointer, a todo.md phase pointer — or it does not exist. Whatever is
//      left over is REPORTED in pass 2 for a human, not inferred.
//   3. IDEMPOTENT. The second run writes zero files. That is the review
//      contract: an operator reads the pass-1 diff once, and re-running is
//      how they prove nothing else moved.
//
// This is the FR-5 exception to the render-time warn-only fence: everywhere
// else the graph observes drift and warns, because a map that edits the
// territory is a map you cannot trust. Backfill is the one deliberate,
// operator-invoked, reviewable write.
//
// Wrap-don't-duplicate ledger (CLAUDE.md working agreement):
//   - edge union + validation + drift  → graph/model.ts buildGraphModel
//   - hash normalization               → backlog/parse.ts splitHashes
//   - row annotation grammar           → backlog/parse.ts BLOCKED_BY_TEXT_RE
//   - frontmatter splice               → engine/frontmatter.ts applyEnginePatch
//   - workstream membership            → engine/workstream.ts resolveSpecWorkstream
//   - todo pointers                    → engine/todo.ts parseTodo
//   - cross-process safety             → backlog/mutate.ts withBacklogLock
//
// Spec: dev/dev-sgr106-2026-08-02T13:57-graph-backfill.md
// Design: _devx/workstreams/story-graph/plan/agent.md §Phase 6
// RED artifact: _devx/workstreams/story-graph/evals/E-6_backfill.ts

import { join } from "node:path";

import {
  BLOCKED_BY_TEXT_RE,
  type DevRow,
  parseDevMd,
  splitHashes,
} from "../backlog/parse.js";
import { type BacklogLockFn, withBacklogLock } from "../backlog/mutate.js";
import { type EngineConfig } from "../engine/config.js";
import { planAbs, todoAbs } from "../engine/artifacts.js";
import {
  SPEC_TYPE_DIRS,
  applyEnginePatch,
  frontmatterParseError,
  readEngineState,
} from "../engine/frontmatter.js";
import { type TodoItem, parseTodo } from "../engine/todo.js";
import {
  type EngineFs,
  type PlanSpecIndexCache,
  enumerateDocSets,
  realEngineFs,
  resolveSpecWorkstream,
} from "../engine/workstream.js";
import {
  BACKLOG_FILES,
  SETTLED_STATUSES,
  type GraphEdge,
  type GraphModel,
  buildGraphModel,
  findBlockingCycles,
  readSpecFrontmatterMap,
  specFilenameHash,
} from "./model.js";
import { REGEN_COMMAND } from "./render.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Read/write seam. `realEngineFs.writeFile` is tmp+rename (`writeAtomic`),
 *  which is how AC 1's "all writes writeAtomic" is satisfied without this
 *  module reaching past the seam its tests inject through. */
export type BackfillFs = Pick<
  EngineFs,
  "readFile" | "writeFile" | "exists" | "readdir"
>;

/** Which durable signal placed a derived edge. Reported per edge so the
 *  attended review can audit the inference without re-deriving it. */
export type DerivedVia = "phase" | "plan-pointer" | "todo-pointer";

export interface DerivedEdge {
  /** The blocked spec. */
  from: string;
  /** The blocker. */
  to: string;
  via: DerivedVia;
  /** Workstream slug the ordering was read within. */
  workstream: string;
}

export interface FrontmatterEdit {
  hash: string;
  /** Repo-relative spec path. */
  path: string;
  /** Hashes appended to the canonical `blocked_by` list, sorted. */
  added: string[];
  /** True when a hyphenated `blocked-by:` key was folded into the canonical
   *  one. An edit can be hyphen-only (nothing added, key re-spelled). */
  normalizedHyphenKey: boolean;
}

export interface RowEdit {
  hash: string;
  /** Backlog filename (`DEV.md`, …). */
  backlog: string;
  /** 0-indexed line in that file. */
  lineIndex: number;
  /** Hashes spliced into the row's existing `Blocked-by:` annotation. */
  added: string[];
}

export interface UnderivableSpec {
  hash: string;
  workstream: string;
  reason: string;
}

/** An ordering the phase numbers implied and something durable refuted.
 *  Reported rather than dropped silently: a suppressed inference is the most
 *  interesting thing a completion pass learns. */
export interface SuppressedDerivation {
  from: string;
  /** The blocker that was not written; null when the whole spec was skipped. */
  to: string | null;
  reason: string;
}

/** A spec whose frontmatter YAML does not parse. Every engine reader treats
 *  it as an empty block, so its edges look missing when they are merely
 *  unreadable — and the writer cannot touch it without destroying it. */
export interface UnparseableSpec {
  hash: string;
  path: string;
  error: string;
}

export interface BackfillPlan {
  frontmatter: FrontmatterEdit[];
  rows: RowEdit[];
  derived: DerivedEdge[];
  suppressed: SuppressedDerivation[];
  underivable: UnderivableSpec[];
  unparseable: UnparseableSpec[];
}

export type BackfillResult =
  | {
      ok: true;
      plan: BackfillPlan;
      /** Repo-relative paths actually written (empty on `--dry-run`). */
      filesWritten: string[];
      /** Non-fatal notes (an unreadable spec, a skipped write). */
      warnings: string[];
    }
  | { ok: false; error: string; cycle?: string[] };

/** `planBackfill`'s return: the plan plus the reads it was computed from, so
 *  the apply half never re-reads (and so can never act on a different view of
 *  disk than the one it reported). */
export type PlanBackfillResult =
  | {
      ok: true;
      plan: BackfillPlan;
      model: GraphModel;
      warnings: string[];
      specs: Map<string, SpecInfo>;
      backlog: BacklogRowIndex;
    }
  | { ok: false; error: string; cycle?: string[] };

// ---------------------------------------------------------------------------
// Spec index (paths + the two durable ordering keys)
// ---------------------------------------------------------------------------

export interface SpecInfo {
  hash: string;
  /** Spec type == the dir it was found under (`dev`, `plan`, …). */
  type: string;
  /** Repo-relative (`dev/dev-aaa111-….md`). */
  path: string;
  content: string;
  /** `phase:` frontmatter, or null. */
  phase: number | null;
  /** Workstream slug, or null when the spec belongs to none. */
  workstream: string | null;
}

function indexSpecs(
  fs: BackfillFs,
  repoRoot: string,
  engine: EngineConfig,
  warnings: string[],
  planCache: PlanSpecIndexCache = {},
): Map<string, SpecInfo> {
  const out = new Map<string, SpecInfo>();
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
      // First dir in SPEC_TYPE_DIRS order wins — the same tiebreak the model
      // applies, so both sides agree about which file a hash names.
      if (out.has(hash)) continue;
      let content: string;
      try {
        content = fs.readFile(join(dir, name));
      } catch (e) {
        warnings.push(
          `${type}/${name} is unreadable (${message(e)}) — skipped; its edges stay incomplete`,
        );
        continue;
      }
      const membership = resolveSpecWorkstream(
        fs,
        repoRoot,
        engine,
        content,
        (c, key) => {
          const v = readSpecFrontmatterMap(c)[key];
          if (typeof v === "string") return v.trim() === "" ? null : v.trim();
          if (typeof v === "number") return String(v);
          return null;
        },
        planCache,
      );
      out.set(hash, {
        hash,
        type,
        path: `${type}/${name}`,
        content,
        phase: readEngineState(content).phase,
        workstream: membership.slug,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Durable ordering signals
// ---------------------------------------------------------------------------

/**
 * `- [x] Phase 1: the ejection PR (dev spec: v2x101)` — the plan/agent.md phase
 * CHECKLIST pointer.
 *
 * Anchored to the checklist-row shape, not to `Phase \d+` anywhere on a line.
 * Narrative prose in a plan discusses phases constantly ("Phase 4 vs 5 file
 * split was chosen so…"), and a loose match would read an ordinal out of a
 * sentence and hand it to the derivation as durable state. The checklist is
 * the durable artifact; the prose around it is not.
 */
const PLAN_PHASE_POINTER_RE =
  /^\s*-\s*\[[ x/-]\]\s*Phase\s+(\d+)\s*:[^\n]*?\(dev spec:\s*([A-Za-z0-9][^)\s]*)\s*\)/i;

interface OrderingSignal {
  phase: number;
  via: DerivedVia;
  /** Workstream the signal was read in (pointer signals carry membership for
   *  specs whose own frontmatter names no workstream). */
  workstream: string;
}

/**
 * Phase number per spec, from durable state only. Precedence: the spec's own
 * `phase:` frontmatter, then a plan/agent.md checklist pointer, then a todo.md
 * phase pointer — most-durable first, so a stale artifact can never override
 * what the spec itself records.
 *
 * Tolerates a workstreams root containing non-directory files and workstream
 * dirs with no plan/agent.md (E-6 trigger shapes): every artifact read is an
 * `exists` probe on the joined path, so a stray `notes.md` simply yields no
 * `notes.md/plan/agent.md` and contributes nothing.
 */
function readOrderingSignals(
  fs: BackfillFs,
  repoRoot: string,
  engine: EngineConfig,
  specs: Map<string, SpecInfo>,
  /** Shared with `indexSpecs`' membership resolution. Without it the flat
   *  arm of `enumerateDocSets` re-reads every plan spec — and, worse, gets a
   *  second chance to disagree with membership if `plan/` changes underfoot. */
  planCache: PlanSpecIndexCache = {},
): Map<string, OrderingSignal> {
  const out = new Map<string, OrderingSignal>();
  for (const spec of specs.values()) {
    if (spec.phase !== null && spec.workstream !== null) {
      out.set(spec.hash, {
        phase: spec.phase,
        via: "phase",
        workstream: spec.workstream,
      });
    }
  }

  // Layout-resolved ENUMERATION (dlr104). The `planAbs`/`todoAbs` calls below
  // were never the defect here — the readdir one level up was. Under
  // `project-level` `<workstreams_root>/` does not exist, so this returned an
  // empty list and every phase-ordering edge silently vanished: no error, no
  // warning, just a board missing its edges.
  const docSets = enumerateDocSets(fs, repoRoot, engine, planCache);

  const record = (
    hashRaw: string,
    phase: number,
    via: DerivedVia,
    slug: string,
  ): void => {
    const [hash] = splitHashes(hashRaw);
    if (hash === undefined) return;
    const spec = specs.get(hash);
    if (spec === undefined) return;
    if (out.has(hash)) return;
    // A pointer speaks only for its OWN workstream's members. A plan/agent.md that
    // name-drops a spec belonging to another workstream would otherwise
    // relabel that spec's membership and rank it against a phase numbering
    // from a different plan — two workstreams' orderings interleaved is worse
    // than no ordering at all.
    if (spec.workstream !== null && spec.workstream !== slug) return;
    // The spec's own `phase:` outranks the pointer's ordinal when it has one
    // — the pointer is contributing MEMBERSHIP here (the spec resolved to no
    // workstream), not overriding what the spec itself records.
    if (spec.phase !== null) {
      out.set(hash, { phase: spec.phase, via: "phase", workstream: slug });
      return;
    }
    if (!Number.isInteger(phase) || phase <= 0) return;
    out.set(hash, { phase, via, workstream: slug });
  };

  for (const { slug, base } of docSets) {
    const planMd = planAbs(base);
    if (fs.exists(planMd)) {
      let content = "";
      try {
        content = fs.readFile(planMd);
      } catch {
        content = "";
      }
      for (const line of content.split("\n")) {
        const m = PLAN_PHASE_POINTER_RE.exec(line);
        if (m) record(m[2], Number(m[1]), "plan-pointer", slug);
      }
    }
    const todoMd = todoAbs(base);
    if (fs.exists(todoMd)) {
      let content = "";
      try {
        content = fs.readFile(todoMd);
      } catch {
        content = "";
      }
      for (const item of flattenTodo(parseTodo(content).items)) {
        if (item.kind !== "phase" || item.pointer === null) continue;
        record(item.pointer, Number(item.label), "todo-pointer", slug);
      }
    }
  }
  return out;
}

/** Depth-first flatten of the todo forest — phase pointers nest one level
 *  under `Stage: Execute`, so the top-level list alone would miss them. */
function flattenTodo(items: TodoItem[]): TodoItem[] {
  const out: TodoItem[] = [];
  const walk = (list: TodoItem[]): void => {
    for (const item of list) {
      out.push(item);
      walk(item.children);
    }
  };
  walk(items);
  return out;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface BacklogRowIndex {
  /** hash → the first non-struck row across BACKLOG_FILES, in file order. */
  rows: Map<string, { row: DevRow; backlog: string }>;
  /** Backlog filename → its lines, for the splice. */
  lines: Map<string, string[]>;
}

function indexBacklogRows(fs: BackfillFs, repoRoot: string): BacklogRowIndex {
  const rows = new Map<string, { row: DevRow; backlog: string }>();
  const lines = new Map<string, string[]>();
  for (const backlog of BACKLOG_FILES) {
    const abs = join(repoRoot, backlog);
    if (!fs.exists(abs)) continue;
    let content: string;
    try {
      content = fs.readFile(abs);
    } catch {
      // buildGraphModel already threw on this exact condition before we got
      // here, so reaching it means the file vanished between the two reads.
      continue;
    }
    lines.set(backlog, content.split("\n"));
    for (const row of parseDevMd(content)) {
      if (row.struck) continue;
      if (!rows.has(row.hash)) rows.set(row.hash, { row, backlog });
    }
  }
  return { rows, lines };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Raw entries of a frontmatter list value, verbatim (never re-spelled). */
function rawList(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  const one = (x: unknown): string | null => {
    if (typeof x === "string" || typeof x === "number") {
      const s = String(x).trim();
      return s === "" ? null : s;
    }
    return null;
  };
  if (Array.isArray(v)) {
    return v.map(one).filter((s): s is string => s !== null);
  }
  const s = one(v);
  return s === null ? [] : [s];
}

/**
 * Compute every write the completion pass would make, without making any.
 *
 * Pass 1 is read straight off the model's edge union: an edge tagged
 * `sources: ["row"]` is missing from frontmatter, `["frontmatter"]` is missing
 * from the row. That is deliberate reuse rather than a second union — the
 * model already drops phantom tokens and stricken blockers, and a writer with
 * its own idea of which tokens are real would eventually materialize an edge
 * the reader refuses to render.
 */
export function planBackfill(
  fs: BackfillFs,
  repoRoot: string,
  engine: EngineConfig,
): PlanBackfillResult {
  const warnings: string[] = [];
  let built;
  try {
    built = buildGraphModel(fs, repoRoot, engine);
  } catch (e) {
    return { ok: false, error: `model build failed: ${message(e)}` };
  }
  if (!built.ok) {
    return {
      ok: false,
      error:
        `blocking-edge cycle among ${built.cycle.length} spec(s): ${built.cycle.join(", ")} — ` +
        "backfill refuses to complete edges on a cyclic board; remove one " +
        "`Blocked-by:`/`blocked_by:` edge first",
      cycle: built.cycle,
    };
  }
  const model = built.model;
  // ONE index of plan/ for the whole run: membership resolution and the doc-set
  // enumeration must not answer from two different reads of the same dir.
  const planCache: PlanSpecIndexCache = {};
  const specs = indexSpecs(fs, repoRoot, engine, warnings, planCache);
  const backlog = indexBacklogRows(fs, repoRoot);
  const statusOf = new Map(model.nodes.map((n) => [n.hash, n.status]));

  // Unreadable ≠ incomplete, and the distinction has to be made BEFORE any
  // other pass runs. Every engine reader sees an empty block here, so such a
  // spec looks edgeless, phase-less and workstream-less to all of them — it
  // would otherwise draw a derived edge it may already have, and land in the
  // pass-2 remainder as if a human had forgotten to order it. It gets exactly
  // one report: its own.
  const unparseable: UnparseableSpec[] = [];
  const unreadable = new Set<string>();
  for (const hash of [...specs.keys()].sort()) {
    const spec = specs.get(hash)!;
    const parseError = frontmatterParseError(spec.content);
    if (parseError === null) continue;
    unreadable.add(hash);
    if (statusOf.has(hash)) {
      unparseable.push({ hash, path: spec.path, error: parseError });
    }
  }

  // ── Pass 1: which side of each existing edge is missing ────────────────
  const fmMissing = new Map<string, Set<string>>();
  const rowMissing = new Map<string, Set<string>>();
  const hasBlocker = new Set<string>();
  const isBlocker = new Set<string>();
  const push = (m: Map<string, Set<string>>, k: string, v: string): void => {
    const hit = m.get(k);
    if (hit) hit.add(v);
    else m.set(k, new Set([v]));
  };
  for (const edge of model.edges) {
    if (edge.kind !== "blocks") continue;
    hasBlocker.add(edge.from);
    isBlocker.add(edge.to);
    if (!edge.sources.includes("frontmatter")) push(fmMissing, edge.from, edge.to);
    if (!edge.sources.includes("row")) push(rowMissing, edge.from, edge.to);
  }

  // ── Derived edges: durable ordering, and only where nothing is recorded ─
  // A spec that already declares ANY blocker has stated its ordering; adding
  // a phase-chain edge on top would manufacture dependencies the operator
  // deliberately did not write (this workstream's own sgr106 declares
  // `blocked_by: [sgr103]` precisely because it is NOT blocked by sgr105).
  // Derivation fills silence; it never argues.
  const signals = readOrderingSignals(fs, repoRoot, engine, specs, planCache);
  const workstreamOf = (hash: string): string | null =>
    specs.get(hash)?.workstream ?? signals.get(hash)?.workstream ?? null;
  // A workstream's PLAN spec is its container, not a phase within it: it
  // carries no `phase:` by construction and is nobody's predecessor. Counting
  // it as a member would rank it against the dev specs it owns, and — worse —
  // report every workstream's own plan spec as an underivable remainder.
  const members = new Map<string, string[]>();
  for (const spec of specs.values()) {
    if (spec.type === "plan") continue;
    if (unreadable.has(spec.hash)) continue;
    const ws = workstreamOf(spec.hash);
    if (ws === null) continue;
    const list = members.get(ws);
    if (list) list.push(spec.hash);
    else members.set(ws, [spec.hash]);
  }

  // Declared parallel-safety REFUTES a phase-order inference. A row saying
  // `Parallel-safe with rtl101` and a phase chain saying rtl102 depends on
  // rtl101 cannot both be true, and the row is the operator's own words while
  // the chain is this module's guess. (Three of the four inferences this
  // repo's first real run produced were refuted exactly this way — plan phase
  // ordinals are labels, not declared dependencies.)
  const parallelPairs = new Set<string>();
  const pairKey = (a: string, b: string): string =>
    a < b ? `${a}|${b}` : `${b}|${a}`;
  for (const edge of model.edges) {
    if (edge.kind === "parallel") parallelPairs.add(pairKey(edge.from, edge.to));
  }

  const derived: DerivedEdge[] = [];
  const suppressed: SuppressedDerivation[] = [];
  for (const [ws, memberHashes] of [...members].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const byPhase = new Map<number, string[]>();
    for (const hash of memberHashes) {
      const signal = signals.get(hash);
      if (signal === undefined) continue;
      const list = byPhase.get(signal.phase);
      if (list) list.push(hash);
      else byPhase.set(signal.phase, [hash]);
    }
    const phases = [...byPhase.keys()].sort((a, b) => a - b);
    for (const hash of [...memberHashes].sort()) {
      if (hasBlocker.has(hash)) continue;
      const signal = signals.get(hash);
      if (signal === undefined) continue;
      const prev = phases.filter((p) => p < signal.phase).pop();
      if (prev === undefined) continue;
      // Settled specs get no inference. On a live spec a derived edge is a
      // PROPOSAL — it lands in a PR diff, the operator corrects it, and it
      // changes what `devx next` will run. On a shipped one it changes
      // nothing anyone will act on (settled groups collapse in the render)
      // while writing an unreviewable guess into the permanent record. Infer
      // where it can still be corrected; stay quiet where it cannot.
      const status = statusOf.get(hash);
      if (status !== undefined && SETTLED_STATUSES.has(status)) {
        suppressed.push({
          from: hash,
          to: null,
          reason: `settled (${status}) — phase ordering is not inferred onto shipped work`,
        });
        continue;
      }
      for (const blocker of [...(byPhase.get(prev) ?? [])].sort()) {
        if (blocker === hash) continue;
        if (parallelPairs.has(pairKey(hash, blocker))) {
          suppressed.push({
            from: hash,
            to: blocker,
            reason: "declared `Parallel-safe with` — the row refutes the phase order",
          });
          continue;
        }
        derived.push({ from: hash, to: blocker, via: signal.via, workstream: ws });
      }
    }
  }

  // A derived chain must not close a loop the authored edges left open.
  // Refusing beats writing: a cyclic board renders nothing at all (E-3), so
  // a backfill that introduced one would take the map down.
  if (derived.length > 0) {
    const combined: GraphEdge[] = [
      ...model.edges,
      ...derived.map((d) => ({
        from: d.from,
        to: d.to,
        kind: "blocks" as const,
        sources: ["derived" as const],
      })),
    ];
    const cycle = findBlockingCycles(combined);
    if (cycle.length > 0) {
      return {
        ok: false,
        error:
          `derived phase ordering would create a blocking cycle among ${cycle.length} spec(s): ` +
          `${cycle.join(", ")} — no files written; fix the \`phase:\`/pointer ordering first`,
        cycle,
      };
    }
    for (const d of derived) push(fmMissing, d.from, d.to);
  }

  // ── Frontmatter edits ──────────────────────────────────────────────────
  const frontmatter: FrontmatterEdit[] = [];
  for (const hash of [...specs.keys()].sort()) {
    // Off the board (every backlog row for it is struck) — an abandoned spec
    // is not a completion target. Its edges render nowhere, so "completing"
    // them is churn in a file whose whole point is that it stopped moving.
    if (!statusOf.has(hash)) continue;
    // Already reported in its own class; `applyEnginePatch` would throw here
    // anyway, and a write built on a parse that dropped half the keys is the
    // one outcome worse than not writing.
    if (unreadable.has(hash)) continue;
    const spec = specs.get(hash)!;
    const fm = readSpecFrontmatterMap(spec.content);
    const hyphen = rawList(fm["blocked-by"]);
    const canonical = rawList(fm.blocked_by);
    const covered = new Set(canonical.flatMap((raw) => splitHashes(raw)));
    const wanted = [...(fmMissing.get(hash) ?? [])].sort();
    const added = wanted.filter((h) => !covered.has(h));
    const normalizedHyphenKey = fm["blocked-by"] !== undefined;
    if (added.length === 0 && !normalizedHyphenKey) continue;
    frontmatter.push({ hash, path: spec.path, added, normalizedHyphenKey });
  }

  // ── Row edits ──────────────────────────────────────────────────────────
  // Row prose grows ONLY where the operator already keeps it: a live row that
  // already bears a `Blocked-by:` annotation. A settled row (the ffm done-row
  // dialect) and a row that never carried the annotation get frontmatter
  // only — backfill completes the encoding, it does not impose a house style
  // on rows nobody is going to read again.
  const rows: RowEdit[] = [];
  for (const hash of [...rowMissing.keys()].sort()) {
    const entry = backlog.rows.get(hash);
    if (entry === undefined) continue;
    const status = statusOf.get(hash);
    if (status !== undefined && SETTLED_STATUSES.has(status)) continue;
    if (!BLOCKED_BY_TEXT_RE.test(entry.row.raw)) continue;
    const covered = new Set(entry.row.blocked_by);
    const added = [...rowMissing.get(hash)!].sort().filter((h) => !covered.has(h));
    if (added.length === 0) continue;
    rows.push({
      hash,
      backlog: entry.backlog,
      lineIndex: entry.row.lineIndex,
      added,
    });
  }

  // ── Pass 2: what could not be placed mechanically ──────────────────────
  // Scoped to workstream members with a peer, because that is the only place
  // an ordering is EXPECTED to exist. A standalone spec with no edges is not
  // drift; a spec sitting in a 7-phase workstream with no phase, no pointer
  // and no edge in either direction is exactly the remainder a human has to
  // resolve — and the one thing this CLI must never invent (D-9).
  const derivedFrom = new Set(derived.map((d) => d.from));
  const underivable: UnderivableSpec[] = [];
  for (const [ws, memberHashes] of [...members].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (memberHashes.length < 2) continue;
    for (const hash of [...memberHashes].sort()) {
      if (signals.has(hash)) continue;
      if (hasBlocker.has(hash) || isBlocker.has(hash)) continue;
      if (derivedFrom.has(hash)) continue;
      underivable.push({
        hash,
        workstream: ws,
        reason:
          "no `phase:` frontmatter, no plan/agent.md/todo.md pointer, and no recorded edge in either direction",
      });
    }
  }

  return {
    ok: true,
    plan: { frontmatter, rows, derived, suppressed, underivable, unparseable },
    model,
    warnings,
    specs,
    backlog,
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/** Splice missing hashes into a row's existing `Blocked-by:` annotation,
 *  landing them inside the span the parser reads (immediately before the
 *  sentence period), never appended at end-of-line where the annotation's
 *  own terminator would hide them. */
export function appendRowBlockers(line: string, added: string[]): string {
  if (added.length === 0) return line;
  // A CRLF file's line still carries its `\r` here (the row index splits raw
  // content, while parseDevMd strips it). `[^.\n]` happily eats that `\r`, so
  // an annotation running to end-of-line would otherwise splice AFTER the
  // carriage return and land the hashes on the wrong side of the terminator.
  const cr = line.endsWith("\r");
  const body = cr ? line.slice(0, -1) : line;
  const m = BLOCKED_BY_TEXT_RE.exec(body);
  if (m === null) return line;
  // m[1] is the annotation's tail; `.` and newline are excluded from it, so
  // the last occurrence inside the match is unambiguously the captured span.
  const end = m.index + m[0].lastIndexOf(m[1]) + m[1].length;
  // `Blocked-by: .` — an annotation with no blockers at all. The capture is
  // whitespace, and a leading comma would render `Blocked-by: , aaa222.`
  const sep = m[1].trim() === "" ? "" : ", ";
  const spliced = `${body.slice(0, end)}${sep}${added.join(", ")}${body.slice(end)}`;
  return cr ? `${spliced}\r` : spliced;
}

function applyPlan(
  fs: BackfillFs,
  repoRoot: string,
  plan: BackfillPlan,
  specs: Map<string, SpecInfo>,
  backlog: BacklogRowIndex,
  warnings: string[],
): string[] {
  const written: string[] = [];

  for (const edit of plan.frontmatter) {
    const spec = specs.get(edit.hash);
    if (spec === undefined) continue;
    const fm = readSpecFrontmatterMap(spec.content);
    const canonical = rawList(fm.blocked_by);
    const covered = new Set(canonical.flatMap((raw) => splitHashes(raw)));
    const list = [...canonical];
    // Hyphen entries are carried over VERBATIM unless the canonical key
    // already covers every hash they name — the key changes spelling, the
    // edge does not move. An entry that tokenizes to no hash at all is kept
    // too: unreadable text is not an edge to drop on the operator's behalf.
    for (const raw of rawList(fm["blocked-by"])) {
      const hashes = splitHashes(raw);
      if (hashes.length > 0 && hashes.every((h) => covered.has(h))) continue;
      list.push(raw);
      for (const h of hashes) covered.add(h);
    }
    for (const h of edit.added) {
      if (covered.has(h)) continue;
      list.push(h);
      covered.add(h);
    }
    let next: string;
    try {
      next = applyEnginePatch(spec.content, { blocked_by: list });
    } catch (e) {
      warnings.push(`${edit.path}: frontmatter patch failed (${message(e)}) — skipped`);
      continue;
    }
    if (next === spec.content) continue;
    try {
      fs.writeFile(join(repoRoot, edit.path), next);
    } catch (e) {
      warnings.push(`${edit.path}: write failed (${message(e)}) — skipped`);
      continue;
    }
    written.push(edit.path);
  }

  const touchedBacklogs = new Set(plan.rows.map((r) => r.backlog));
  for (const file of [...touchedBacklogs].sort()) {
    const lines = backlog.lines.get(file);
    if (lines === undefined) continue;
    const next = [...lines];
    let changed = false;
    for (const edit of plan.rows) {
      if (edit.backlog !== file) continue;
      const before = next[edit.lineIndex];
      if (before === undefined) {
        warnings.push(
          `${file}: row for ${edit.hash} moved between read and write (line ${edit.lineIndex + 1} gone) — skipped`,
        );
        continue;
      }
      const after = appendRowBlockers(before, edit.added);
      if (after === before) continue;
      next[edit.lineIndex] = after;
      changed = true;
    }
    if (!changed) continue;
    try {
      fs.writeFile(join(repoRoot, file), next.join("\n"));
    } catch (e) {
      warnings.push(`${file}: write failed (${message(e)}) — skipped`);
      continue;
    }
    written.push(file);
  }

  return written;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface RunBackfillOpts {
  fs?: BackfillFs;
  /** Compute + report, write zero files. */
  dryRun?: boolean;
  /** Test seam for the cross-process backlog lock (identity in fake-fs
   *  suites, where there is no `.devx-cache` to lock against). */
  lock?: BacklogLockFn;
}

/**
 * Plan and (unless `dryRun`) apply the completion pass.
 *
 * The write path computes INSIDE the backlog mutation lock (mlc102): the pass
 * is a read-modify-write over the same DEV.md and spec frontmatter a
 * concurrent claim splices, and planning outside the hold would let a peer's
 * claim land between the read and the write. `--dry-run` reads lock-free —
 * it changes nothing, and blocking a report behind a 30s lock on a busy repo
 * would make the safe mode the annoying one.
 */
export function runBackfill(
  repoRoot: string,
  engine: EngineConfig,
  opts: RunBackfillOpts = {},
): BackfillResult {
  const fs = opts.fs ?? realEngineFs;
  const dryRun = opts.dryRun === true;
  const lock: BacklogLockFn =
    opts.lock ??
    (<T>(label: string, fn: () => T): T =>
      withBacklogLock(join(repoRoot, ".devx-cache"), label, fn));

  if (dryRun) {
    const planned = planBackfill(fs, repoRoot, engine);
    if (!planned.ok) return planned;
    return {
      ok: true,
      plan: planned.plan,
      filesWritten: [],
      warnings: planned.warnings,
    };
  }

  return lock("graph-backfill", (): BackfillResult => {
    const planned = planBackfill(fs, repoRoot, engine);
    if (!planned.ok) return planned;
    const warnings = [...planned.warnings];
    const filesWritten = applyPlan(
      fs,
      repoRoot,
      planned.plan,
      planned.specs,
      planned.backlog,
      warnings,
    );
    return { ok: true, plan: planned.plan, filesWritten, warnings };
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * The operator-facing report. Pass 1 is a per-file ledger of what moved (or
 * would move); pass 2 is the remainder a human owns. Both passes print even
 * when empty — "0 underivable" is a result, and a report that silently omits
 * the section reads as "not checked".
 */
export function renderBackfillReport(
  plan: BackfillPlan,
  opts: { dryRun: boolean; filesWritten: string[]; warnings?: string[] },
): string {
  const lines: string[] = [];
  const head = opts.dryRun
    ? "devx graph backfill — dry run (no files written)"
    : "devx graph backfill";
  lines.push(head, "");

  lines.push(
    `Pass 1 — mechanical completion: ${plan.frontmatter.length} spec frontmatter, ${plan.rows.length} backlog row(s)`,
  );
  if (plan.frontmatter.length === 0 && plan.rows.length === 0) {
    lines.push("  (nothing missing — both sides already agree)");
  }
  for (const edit of plan.frontmatter) {
    const parts: string[] = [];
    if (edit.added.length > 0) parts.push(`blocked_by += ${edit.added.join(", ")}`);
    if (edit.normalizedHyphenKey) parts.push("normalized `blocked-by:` → `blocked_by:`");
    lines.push(`  ${edit.path} — ${parts.join("; ")}`);
  }
  for (const edit of plan.rows) {
    lines.push(
      `  ${edit.backlog}:${edit.lineIndex + 1} (${edit.hash}) — Blocked-by += ${edit.added.join(", ")}`,
    );
  }

  lines.push("", `Derived from durable state: ${plan.derived.length} edge(s)`);
  for (const d of plan.derived) {
    lines.push(`  ${d.from} → ${d.to}  (${d.via}, workstream ${d.workstream})`);
  }

  if (plan.suppressed.length > 0) {
    lines.push("", `Suppressed inferences: ${plan.suppressed.length}`);
    for (const s of plan.suppressed) {
      lines.push(`  ${s.from}${s.to === null ? "" : ` → ${s.to}`} — ${s.reason}`);
    }
  }

  lines.push(
    "",
    `Pass 2 — underivable ordering: ${plan.underivable.length} spec(s) (reported, never guessed)`,
  );
  for (const u of plan.underivable) {
    lines.push(`  ${u.hash}  (workstream ${u.workstream}) — ${u.reason}`);
  }

  if (plan.unparseable.length > 0) {
    lines.push(
      "",
      `Unreadable frontmatter: ${plan.unparseable.length} spec(s) — not completed, and every engine reader sees these as empty`,
    );
    for (const u of plan.unparseable) {
      lines.push(`  ${u.path} — ${u.error}`);
    }
  }

  for (const w of opts.warnings ?? []) lines.push("", `WARN: ${w}`);

  lines.push(
    "",
    opts.dryRun
      ? `Would write ${plan.frontmatter.length + new Set(plan.rows.map((r) => r.backlog)).size} file(s). Re-run without --dry-run to apply.`
      : `Wrote ${opts.filesWritten.length} file(s)${opts.filesWritten.length > 0 ? `: ${opts.filesWritten.join(", ")}` : ""}.`,
  );
  if (!opts.dryRun && opts.filesWritten.length > 0) {
    lines.push(
      `Review the diff edge by edge, then re-run to confirm a 0-file no-op (\`${REGEN_COMMAND}\` refreshes the board).`,
    );
  }
  return `${lines.join("\n")}\n`;
}
