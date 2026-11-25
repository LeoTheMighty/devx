// `devx workstream split` / `devx workstream combine` — the IO half (D-18).
//
// All judgment lives in `src/lib/engine/lifecycle.ts`, which is pure. This
// file gathers the facts it needs (spec state, artifacts, emitted dev specs,
// dependents from the story graph), mints hashes, and executes a plan with no
// refusals. Execution happens in TWO steps, and the order is the guarantee:
//
//   1. Every write — the child scaffolds (through `createWorkstream` itself,
//      not a copy of it), the carried expectations, the records, both spec
//      patches — lands in an in-memory overlay. Anything that throws here has
//      touched nothing on disk.
//   2. Only then is the overlay flushed, file by file, through the engine's
//      atomic writer. GRAPH.md is regenerated after, warn-and-continue.
//
// So a refusal, a `--dry-run`, and a failure while planning are all "the tree
// is byte-identical", which is what `test/workstream-lifecycle.test.ts`
// asserts for every one of them.
//
// Exit codes (house convention):
//   0 — done (or `--dry-run` printed the plan). JSON on stdout.
//   1 — refusal: JSON `{ refused: true, refusals, template? }`, nothing written.
//   2 — usage / unresolvable hash / config / a failure AFTER files began to
//       land (the message lists what was written).
//
// Spec: v2/07-decisions.md D-18

import { basename, dirname, join, relative, sep } from "node:path";

import { buildGraphModel, BACKLOG_FILES } from "../lib/graph/model.js";
import { type RegenFn, regenerateGraph } from "../lib/graph/regen.js";
import { parseDevMd } from "../lib/backlog/parse.js";
import { appendStatusLogLine } from "../lib/devx/status-log.js";
import { stageSubject, planAbs, type ArtifactKind } from "../lib/engine/artifacts.js";
import type { EngineConfig } from "../lib/engine/config.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  type EnginePatch,
  applyEnginePatch,
  readBlockedByAllSpellings,
} from "../lib/engine/frontmatter.js";
import {
  type CombinePlan,
  type LifecycleRefusal,
  type SplitPlan,
  type WorkstreamFacts,
  SETTLED_STATUSES,
  intoError,
  planCombine,
  planSplit,
} from "../lib/engine/lifecycle.js";
import { emittedSpecsFor } from "../lib/engine/revise.js";
import {
  type EngineFs,
  type ResolvedWorkstream,
  TEMPLATES_DIR,
  WorkstreamError,
  WorkstreamRefusal,
  createWorkstream,
  generateHash,
  planFilenameSlug,
  planSpecEntries,
  realEngineFs,
  resolveWorkstream,
  workstreamSlugFor,
} from "../lib/engine/workstream.js";

export interface RunLifecycleOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  now?: () => Date;
  /** Test seam for the GRAPH.md regen (default `regenerateGraph`). */
  regen?: RegenFn;
}

// ---------------------------------------------------------------------------
// Overlay fs — every write lands here first
// ---------------------------------------------------------------------------

/** An `EngineFs` that records writes and mkdirs in memory and reads through
 *  to the base for everything it has not been handed. `createWorkstream` runs
 *  against it unchanged, so a child scaffold is planned by the same code that
 *  scaffolds a workstream for real. */
class OverlayFs implements EngineFs {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  constructor(private readonly base: EngineFs) {}

  readFile(p: string): string {
    const v = this.files.get(p);
    return v !== undefined ? v : this.base.readFile(p);
  }
  writeFile(p: string, c: string): void {
    // Same ENOENT contract as `realEngineFs.writeFile`: a write into a
    // directory nobody made is a bug in the plan, not something to paper over.
    if (!this.exists(dirname(p))) {
      const e = new Error(`ENOENT: no such directory, write '${p}'`) as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    }
    this.files.set(p, c);
  }
  exists(p: string): boolean {
    return this.files.has(p) || this.dirs.has(p) || this.base.exists(p);
  }
  mkdirRecursive(p: string): void {
    let cur = p;
    while (!this.base.exists(cur) && !this.dirs.has(cur)) {
      this.dirs.add(cur);
      const up = dirname(cur);
      if (up === cur) break;
      cur = up;
    }
  }
  readdir(p: string): string[] {
    const names = new Set<string>(this.base.exists(p) ? this.base.readdir(p) : []);
    for (const k of [...this.files.keys(), ...this.dirs]) {
      if (dirname(k) === p) names.add(basename(k));
    }
    return [...names];
  }

  /** Flush to the base. Directories first (shallowest first), then files.
   *  Returns every absolute path written, in order, for a failure report. */
  flush(written: string[]): void {
    for (const d of [...this.dirs].sort((a, b) => a.length - b.length)) {
      if (!this.base.exists(d)) this.base.mkdirRecursive(d);
    }
    for (const [p, c] of this.files) {
      this.base.writeFile(p, c);
      written.push(p);
    }
  }
}

// ---------------------------------------------------------------------------
// Fact gathering
// ---------------------------------------------------------------------------

function readIfExists(fs: EngineFs, abs: string): string | null {
  return fs.exists(abs) ? fs.readFile(abs) : null;
}

const subjectAbs = (ws: ResolvedWorkstream, kind: ArtifactKind): string =>
  stageSubject(ws.layout, ws, kind).abs;

type Dependents = { error: string | null; of(hash: string): WorkstreamFacts["dependents"] };

/** Specs whose `blocked_by` names a hash, read off the story graph — the
 *  one model that already unions backlog-row and frontmatter edges. A cycle
 *  means the graph cannot be built, and then this fails CLOSED. */
function dependentsFrom(fs: EngineFs, repoRoot: string, engine: EngineConfig): Dependents {
  let built;
  try {
    built = buildGraphModel(fs, repoRoot, engine);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `the story graph could not be built: ${msg}`, of: () => [] };
  }
  if (!built.ok) {
    return { error: `the story graph has a blocking cycle (${built.cycle.join(", ")}); fix it with \`devx graph\``, of: () => [] };
  }
  const status = new Map(built.model.nodes.map((n) => [n.hash, n.status as string]));
  const edges = built.model.edges.filter((e) => e.kind === "blocks");
  return {
    error: null,
    of: (hash) =>
      edges
        .filter((e) => e.to === hash && e.from !== hash)
        .map((e) => ({ hash: e.from, status: status.get(e.from) ?? null })),
  };
}

function gatherFacts(
  fs: EngineFs,
  repoRoot: string,
  engine: EngineConfig,
  ws: ResolvedWorkstream,
  deps: Dependents,
): WorkstreamFacts {
  return {
    hash: ws.hash,
    slug: workstreamSlugFor(basename(ws.specRel), ws.workstreamRel, engine) ?? ws.hash,
    specRel: ws.specRel,
    workstreamRel: ws.workstreamRel,
    layout: ws.layout,
    state: ws.state,
    frontmatterError: ws.frontmatterError,
    blockedBy: readBlockedByAllSpellings(ws.content),
    expectations: readIfExists(fs, subjectAbs(ws, { kind: "expectations" })),
    prd: readIfExists(fs, subjectAbs(ws, { kind: "agent", stage: "prd" })),
    plan: readIfExists(fs, planAbs(ws)),
    questions: readIfExists(fs, subjectAbs(ws, { kind: "questions" })),
    emitted: emittedSpecsFor(repoRoot, ws, fs),
    dependents: deps.of(ws.hash),
    dependentsError: deps.error,
  };
}

/** Every `.md` under a directory, recursively. */
function mdTexts(fs: EngineFs, dir: string): string[] {
  if (!fs.exists(dir)) return [];
  const out: string[] = [];
  for (const name of fs.readdir(dir)) {
    const abs = join(dir, name);
    let entries: string[] | null = null;
    try {
      entries = fs.readdir(abs);
    } catch {
      entries = null;
    }
    if (entries !== null) out.push(...mdTexts(fs, abs));
    else if (name.endsWith(".md")) out.push(fs.readFile(abs));
  }
  return out;
}

/** Live backlog rows for a hash — reported for striking, never edited. */
function liveRows(fs: EngineFs, repoRoot: string, hash: string): string[] {
  const out: string[] = [];
  for (const file of BACKLOG_FILES) {
    const abs = join(repoRoot, file);
    if (!fs.exists(abs)) continue;
    for (const row of parseDevMd(fs.readFile(abs))) {
      if (row.hash === hash && !SETTLED_STATUSES.has(row.status)) {
        out.push(`${file}:${row.lineIndex + 1} (${row.status})`);
      }
    }
  }
  return out;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minuteStamp = (d: Date): string => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function refuse(
  name: string,
  out: (s: string) => void,
  err: (s: string) => void,
  refusals: LifecycleRefusal[],
  extra: Record<string, unknown> = {},
): number {
  out(`${JSON.stringify({ refused: true, refusals, ...extra })}\n`);
  for (const r of refusals) {
    err(`devx workstream ${name}: refused [${r.code}] — ${r.message}\n`);
    for (const p of (r.paths ?? []).slice(0, 12)) err(`  ${p}\n`);
  }
  err(`devx workstream ${name}: nothing written.\n`);
  return 1;
}

/** Patch a spec's frontmatter and append its status-log line. */
const patchSpec = (content: string, patch: EnginePatch, logLine: string): string =>
  appendStatusLogLine(applyEnginePatch(content, patch), logLine);

function flushOrReport(
  name: string,
  overlay: OverlayFs,
  repoRoot: string,
  err: (s: string) => void,
): boolean {
  const written: string[] = [];
  try {
    overlay.flush(written);
    return true;
  } catch (e) {
    const rel = (p: string) => relative(repoRoot, p).split(sep).join("/");
    err(
      `devx workstream ${name}: write failed after ${written.length} file(s) landed: ` +
        `${e instanceof Error ? e.message : String(e)}\n` +
        "  written so far (remove the new ones and `git checkout --` the patched specs to recover):\n" +
        written.map((p) => `    ${rel(p)}\n`).join(""),
    );
    return false;
  }
}

function regenGraph(
  regen: RegenFn,
  fs: EngineFs,
  repoRoot: string,
  engine: EngineConfig,
  err: (s: string) => void,
  name: string,
): string {
  let r;
  try {
    r = regen(fs, repoRoot, engine);
  } catch (e) {
    r = { ok: false as const, warning: `GRAPH.md not regenerated: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (r.ok) return "regenerated";
  err(`devx workstream ${name}: WARN — ${r.warning}\n`);
  return r.warning;
}

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------

export function runWorkstreamSplit(
  args: string[],
  flags: { into?: string; partition?: string; dryRun?: boolean },
  opts: RunLifecycleOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  const now = (opts.now ?? (() => new Date()))();

  if (args.length !== 1) {
    err("usage: devx workstream split <hash> --into <a>,<b>[,…] [--partition <file>] [--dry-run]\n");
    return 2;
  }
  const into = (flags.into ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  const bad = intoError(into);
  if (bad !== null) {
    err(`devx workstream split: ${bad}\n`);
    return 2;
  }
  let partition: unknown = null;
  if (flags.partition !== undefined) {
    try {
      partition = JSON.parse(fs.readFile(flags.partition));
    } catch (e) {
      err(`devx workstream split: --partition '${flags.partition}' is not readable JSON: ${e instanceof Error ? e.message : String(e)}\n`);
      return 2;
    }
  }

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream split: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;
  let ws: ResolvedWorkstream;
  try {
    ws = resolveWorkstream(repoRoot, args[0], engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      err(`devx workstream split: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  const templateAbs = join(repoRoot, TEMPLATES_DIR, "expectations.md");
  if (!fs.exists(templateAbs)) {
    err(`devx workstream split: engine template missing at ${TEMPLATES_DIR}/expectations.md — run \`devx init\` first\n`);
    return 2;
  }

  const parent = gatherFacts(fs, repoRoot, engine, ws, dependentsFrom(fs, repoRoot, engine));
  const overlay = new OverlayFs(fs);
  const childHashes: string[] = [];
  for (let i = 0; i < into.length; i++) {
    let h = generateHash(overlay, repoRoot);
    while (childHashes.includes(h)) h = generateHash(overlay, repoRoot);
    childHashes.push(h);
  }
  const plans = planSpecEntries(fs, repoRoot, undefined);
  const childTaken = (slug: string): string | null => {
    const wsRel = `${engine.workstreamsRoot}/${slug}`;
    if (fs.exists(join(repoRoot, ...wsRel.split("/")))) return `${wsRel}/ already exists`;
    const archived = `${engine.archiveRoot}/${slug}`;
    if (fs.exists(join(repoRoot, ...archived.split("/")))) return `an archived workstream uses it (${archived}/)`;
    const claim = plans.find((e) => e.state.workstream === wsRel || planFilenameSlug(e.name) === slug);
    return claim ? `plan/${claim.name} already uses it` : null;
  };
  const exists = (rel: string): boolean => fs.exists(join(repoRoot, ...rel.split("/")));

  const plan: SplitPlan = planSplit({
    parent,
    into,
    childHashes,
    partition,
    childTaken,
    exists,
    expectationsTemplate: fs.readFile(templateAbs),
    expectationsMin: engine.expectationsMin,
    workstreamsRoot: engine.workstreamsRoot,
    today: ymd(now),
    stamp: minuteStamp(now),
  });
  if (plan.refusals.length > 0 || plan.parent === null) {
    return refuse("split", out, err, plan.refusals, plan.template ? { template: plan.template } : {});
  }

  const summary = {
    parent: { hash: parent.hash, slug: parent.slug, spec: parent.specRel, record: plan.parent.recordRel },
    children: plan.children.map((c) => ({
      slug: c.slug,
      hash: c.hash,
      workstream: c.workstreamRel,
      expectations: c.expectationIds,
      shared: c.sharedIds,
      covers_to_define: c.coversToDefine,
      eval_targets: c.evalTargets,
      shipped_in_parent: c.shippedInParent,
      record: c.recordRel,
    })),
    backlog_rows: liveRows(fs, repoRoot, parent.hash),
    warnings: plan.warnings,
  };

  // ---- step 1: everything into the overlay --------------------------------
  const childSpecs: string[] = [];
  try {
    for (const c of plan.children) {
      const made = createWorkstream({ repoRoot, slug: c.slug, hash: c.hash, engine, now: () => now, fs: overlay });
      const specAbs = join(repoRoot, ...made.specPath.split("/"));
      childSpecs.push(made.specPath);
      overlay.writeFile(join(repoRoot, ...c.workstreamRel.split("/"), "expectations.md"), c.expectations);
      overlay.writeFile(join(repoRoot, ...c.recordRel.split("/")), c.record);
      overlay.writeFile(specAbs, patchSpec(overlay.readFile(specAbs), c.patch, c.logLine));
    }
    const recordAbs = join(repoRoot, ...plan.parent.recordRel.split("/"));
    overlay.mkdirRecursive(dirname(recordAbs));
    overlay.writeFile(recordAbs, plan.parent.record);
    overlay.writeFile(ws.specAbs, patchSpec(ws.content, plan.parent.patch, plan.parent.logLine));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`devx workstream split: ${e instanceof WorkstreamRefusal ? "refused while scaffolding" : "could not compose the split"}: ${msg} — nothing written\n`);
    return e instanceof WorkstreamRefusal ? 1 : 2;
  }
  const result = {
    ...summary,
    children: summary.children.map((c, i) => ({ ...c, spec: childSpecs[i] })),
  };
  if (flags.dryRun) {
    out(`${JSON.stringify({ dry_run: true, ...result })}\n`);
    return 0;
  }

  // ---- step 2: flush, then the derived board ------------------------------
  if (!flushOrReport("split", overlay, repoRoot, err)) return 2;
  const graph = regenGraph(opts.regen ?? regenerateGraph, fs, repoRoot, engine, err, "split");
  for (const w of plan.warnings) err(`devx workstream split: WARN — ${w}\n`);
  if (result.backlog_rows.length > 0) {
    err(`devx workstream split: WARN — '${parent.slug}' still has live backlog rows; strike them (\`~~…~~ (superseded by …)\`): ${result.backlog_rows.join(", ")}\n`);
  }
  out(`${JSON.stringify({ ...result, graph })}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// combine
// ---------------------------------------------------------------------------

export function runWorkstreamCombine(
  args: string[],
  flags: { dryRun?: boolean },
  opts: RunLifecycleOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  const now = (opts.now ?? (() => new Date()))();

  if (args.length !== 2) {
    err("usage: devx workstream combine <into-hash> <from-hash> [--dry-run]\n");
    return 2;
  }
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream combine: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;
  let sWs: ResolvedWorkstream;
  let aWs: ResolvedWorkstream;
  try {
    sWs = resolveWorkstream(repoRoot, args[0], engine, opts.fs ?? {});
    aWs = resolveWorkstream(repoRoot, args[1], engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      err(`devx workstream combine: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const deps = dependentsFrom(fs, repoRoot, engine);
  const survivor = gatherFacts(fs, repoRoot, engine, sWs, deps);
  const absorbed = gatherFacts(fs, repoRoot, engine, aWs, deps);
  const plan: CombinePlan = planCombine({
    survivor,
    absorbed,
    survivorTexts: mdTexts(fs, sWs.workstreamAbs),
    survivorHas: (rel) => fs.exists(join(sWs.workstreamAbs, ...rel.split("/"))),
    exists: (rel) => fs.exists(join(repoRoot, ...rel.split("/"))),
    today: ymd(now),
    stamp: minuteStamp(now),
  });
  if (plan.refusals.length > 0 || plan.survivor === null || plan.absorbed === null) {
    return refuse("combine", out, err, plan.refusals);
  }

  const result = {
    survivor: {
      hash: survivor.hash,
      slug: survivor.slug,
      spec: survivor.specRel,
      resets: plan.survivor.resets,
      stage: plan.survivor.stage,
      record: plan.survivor.recordRel,
    },
    absorbed: { hash: absorbed.hash, slug: absorbed.slug, spec: absorbed.specRel, record: plan.absorbed.recordRel },
    expectation_map: plan.eMap,
    id_map: plan.idMap,
    not_carried: plan.notCarried,
    likely_duplicates: plan.likelyDuplicates,
    survivor_shipped: plan.survivorShipped,
    backlog_rows: liveRows(fs, repoRoot, absorbed.hash),
    warnings: plan.warnings,
  };

  const overlay = new OverlayFs(fs);
  try {
    overlay.writeFile(subjectAbs(sWs, { kind: "expectations" }), plan.survivor.expectations);
    overlay.writeFile(sWs.specAbs, patchSpec(sWs.content, plan.survivor.patch, plan.survivor.logLine));
    overlay.writeFile(aWs.specAbs, patchSpec(aWs.content, plan.absorbed.patch, plan.absorbed.logLine));
    for (const [rel, body] of [
      [plan.survivor.recordRel, plan.survivor.record],
      [plan.absorbed.recordRel, plan.absorbed.record],
    ] as const) {
      const abs = join(repoRoot, ...rel.split("/"));
      overlay.mkdirRecursive(dirname(abs));
      overlay.writeFile(abs, body);
    }
  } catch (e) {
    err(`devx workstream combine: could not compose the combine: ${e instanceof Error ? e.message : String(e)} — nothing written\n`);
    return 2;
  }
  if (flags.dryRun) {
    out(`${JSON.stringify({ dry_run: true, ...result })}\n`);
    return 0;
  }

  if (!flushOrReport("combine", overlay, repoRoot, err)) return 2;
  const graph = regenGraph(opts.regen ?? regenerateGraph, fs, repoRoot, engine, err, "combine");
  for (const w of plan.warnings) err(`devx workstream combine: WARN — ${w}\n`);
  if (result.backlog_rows.length > 0) {
    err(`devx workstream combine: WARN — '${absorbed.slug}' still has live backlog rows; strike them (\`~~…~~ (superseded by ${survivor.hash})\`): ${result.backlog_rows.join(", ")}\n`);
  }
  out(`${JSON.stringify({ ...result, graph })}\n`);
  return 0;
}
