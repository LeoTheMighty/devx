// `devx workstream new <slug> [--hash <hash>]` — CLI passthrough for the
// workstream scaffolder (v2e101). Mirrors the merge-gate/plan-helper
// pattern: thin driver, JSON on stdout, diagnostics on stderr.
//
// Exit codes:
//   0 — scaffolded (or clean no-op re-run; `noop: true` in the JSON).
//   1 — refusal: slug/hash conflict with existing state (dir claimed by a
//       different spec, spec bound to a different dir, dir with no spec
//       and no --hash). Nothing written.
//   2 — error: invalid slug/hash, missing engine templates, config load
//       failure.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §3, §8

import { join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { type Exec, realExec } from "../lib/exec.js";
import * as artifacts from "../lib/engine/artifacts.js";
import type { EngineConfig } from "../lib/engine/config.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  GATE_KEYS,
  type EngineState,
  readEngineState,
} from "../lib/engine/frontmatter.js";
import { type GateGap, evaluateGatePrd } from "../lib/engine/gate-prd.js";
import { nextForWorkstream } from "../lib/engine/next.js";
import { baseBranchFrom } from "../lib/engine/outline.js";
import { PlanScopeError, checkStoryPlanScope, storyFromBranch } from "../lib/engine/plan-scope.js";
import { emissionPlan } from "../lib/engine/plan-graph.js";
import {
  type FindingTally,
  type GateEvidenceMap,
  type PathProbe,
  type PositionFinding,
  type ReviewVerdict,
  reconcileGates,
  reviewVerdictFor,
  tallyFindings,
} from "../lib/engine/position.js";
import {
  gateCellFor,
  newestDecisionReport,
  renderGateSummary,
} from "../lib/engine/render.js";
import {
  type EngineFs,
  WorkstreamError,
  WorkstreamRefusal,
  createWorkstream,
  planFilenameHash,
  planSpecEntries,
  planSpecWorkstreamRel,
  realEngineFs,
  resolveWorkstream,
  workstreamSlugFor,
} from "../lib/engine/workstream.js";

export interface RunWorkstreamNewOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  now?: () => Date;
}

export function runWorkstreamNew(
  args: string[],
  flags: { hash?: string },
  opts: RunWorkstreamNewOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // The arity check does NOT live here any more (dlr104). A missing slug is a
  // refusal under `workstream` and perfectly legal under `project-level`, and
  // only `createWorkstream` knows which — so the decision goes where the
  // layout is, and the message can name `engine.docs_layout` as the reason.
  if (args.length > 1) {
    err("usage: devx workstream new [slug] [--hash <hash>]\n");
    return 2;
  }
  // An explicitly EMPTY slug is absent, not a slug. Without this,
  // `devx workstream new ""` gives commander `args.length === 1`, so the
  // project-level default never runs and it exits 2 with `invalid slug ''` —
  // under the one layout where the slug is optional (review EC#8).
  const slug = args.length === 1 && args[0].trim() !== "" ? args[0] : undefined;

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream new: ${ctx.error}\n`);
    return 2;
  }

  try {
    const result = createWorkstream({
      repoRoot: ctx.ctx.repoRoot,
      slug,
      hash: flags.hash,
      engine: ctx.ctx.engine,
      now: opts.now,
      fs: opts.fs,
    });
    out(`${JSON.stringify(result)}\n`);
    if (result.noop) {
      err(
        `devx workstream new: '${result.slug}' already scaffolded — nothing to do\n`,
      );
    }
    return 0;
  } catch (e) {
    if (e instanceof WorkstreamRefusal) {
      err(`devx workstream new: ${e.message}\n`);
      // A missing slug is the one refusal E-5 pins at exit 1 — it is the
      // engine saying no to a valid request, and the flat layout accepts the
      // same invocation. Every other refusal keeps 1 as it always did.
      return 1;
    }
    if (e instanceof WorkstreamError) {
      err(`devx workstream new: ${e.message}\n`);
      return 2;
    }
    err(
      `devx workstream new: unexpected failure: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
}

// ---------------------------------------------------------------------------
// scope-check (debug-2d6fc1)
// ---------------------------------------------------------------------------

export interface RunScopeCheckOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  projectPath?: string;
  exec?: Exec;
  env?: Record<string, string | undefined>;
}

/**
 * `devx workstream scope-check [--diff <range>] [--story <hash>]`
 *
 * Fails (exit 1) when a workstream story's diff edits `plan/agent.md` lines
 * outside the story's own phase. The one allowed crossing: flipping another
 * phase's checklist row to `[x]` when that phase's spec is already `done` at
 * the base. Exit 0 = in scope, or not a workstream-phase story. Exit 2 =
 * could not tell (fail closed, like `devx outline check`).
 *
 * Runs in CI because CI is the gate a hand-merge still respects. The story
 * comes from `--story`, else `GITHUB_HEAD_REF`, else the current branch.
 */
export function runScopeCheck(
  flags: { diff?: string; story?: string },
  opts: RunScopeCheckOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const exec = opts.exec ?? realExec;
  const env = opts.env ?? process.env;
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream scope-check: ${ctx.error}\n`);
    return 2;
  }
  const repoRoot = ctx.ctx.repoRoot;
  const git = (args: string[]) => exec("git", args, { cwd: repoRoot });

  const range = flags.diff ?? `origin/${baseBranchFrom(ctx.ctx.merged)}...HEAD`;
  const three = range.includes("...");
  const dots = three ? "..." : range.includes("..") ? ".." : null;
  if (dots === null) {
    err(`devx workstream scope-check: --diff needs a range (A...B or A..B), got '${range}'\n`);
    return 2;
  }
  const lhs = range.slice(0, range.indexOf(dots)).trim() || "HEAD";
  const head = range.slice(range.indexOf(dots) + dots.length).trim() || "HEAD";
  let base = lhs;
  if (three) {
    // A three-dot range diffs from the merge base, exactly as git does.
    const mb = git(["merge-base", lhs, head]);
    // (Two-dot ranges are validated inside the check: an unknown rev there is
    // exit 2, never a silent "nothing changed" — review round 1.)
    if (mb.exitCode !== 0) {
      err(`devx workstream scope-check: no merge base for '${range}': ${mb.stderr.trim()}\n`);
      return 2;
    }
    base = mb.stdout.trim();
  }

  let story = flags.story ?? null;
  if (story === null) {
    const branch =
      env.GITHUB_HEAD_REF && env.GITHUB_HEAD_REF.trim() !== ""
        ? env.GITHUB_HEAD_REF
        : git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    story = storyFromBranch(branch);
    if (story === null) {
      // Non-story branches (planning, archival) are where whole-plan edits
      // legitimately happen, so they are skipped — but said out loud.
      out(`${JSON.stringify({ skipped: `branch '${branch}' is not a story branch` })}\n`);
      return 0;
    }
  }

  let report;
  try {
    report = checkStoryPlanScope({ repoRoot, base, head, story, exec });
  } catch (e) {
    if (e instanceof PlanScopeError) {
      err(`devx workstream scope-check: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  out(`${JSON.stringify(report)}\n`);
  if (report.unscoped.length > 0) {
    err(
      `devx workstream scope-check: WARN — ${report.skipped ?? "this story has no phase"}, but the diff changes ${report.unscoped.join(", ")}. ` +
        "Nothing holds it to a phase; make sure none of it is another session's work.\n",
    );
  }
  if (report.skipped !== null || report.files.length === 0) return 0;

  err(
    `devx workstream scope-check: story '${story}' (phase ${report.ownPhase}) edits plan lines outside its own phase.\n` +
      "A story trues only its own phase's rows; anything wider is a revision (`devx revise`). " +
      "The usual cause is carrying main's working copy of a shared plan/agent.md into the branch, " +
      "which brings every other session's uncommitted edits with it (debug-2d6fc1). " +
      "Edit the worktree's copy instead.\n",
  );
  for (const f of report.files) {
    if (f.reason !== null) {
      err(`  ${f.path}: ${f.reason}\n`);
      continue;
    }
    for (const v of f.violations.slice(0, 12)) {
      const where = v.phase === null ? "outside every phase" : `phase ${v.phase}`;
      err(`  ${f.path}:${v.line} ${v.side === "added" ? "+" : "-"} [${where}] ${v.text.slice(0, 100)}\n`);
    }
    if (f.violations.length > 12) err(`  … and ${f.violations.length - 12} more in ${f.path}\n`);
  }
  return 1;
}

// `devx workstream graph <hash>` — the plan's Execution graph as RED emission
// reads it (harness-s5). JSON on stdout, always:
//
//   { hash, present, order: [ids], phases: [{ id, depends_on, parallel_safe,
//     independent_with, files }], findings: [{severity, code, message}] }
//
// With no `## Execution graph` section `present` is false and `order` is the
// Phase checklist order — the serial contract, unchanged. The gate owns the
// verdict; this command only reports, so findings never change its exit code.
//
// Exit codes: 0 — printed; 2 — unresolvable hash/workstream, no plan artifact,
// config load failure.
export interface RunWorkstreamGraphOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  projectPath?: string;
  fs?: Partial<EngineFs>;
}

export function runWorkstreamGraph(
  args: string[],
  opts: RunWorkstreamGraphOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  if (args.length !== 1) {
    err("usage: devx workstream graph <hash>\n");
    return 2;
  }
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream graph: ${ctx.error}\n`);
    return 2;
  }
  let ws;
  try {
    ws = resolveWorkstream(ctx.ctx.repoRoot, args[0], ctx.ctx.engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      err(`devx workstream graph: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  const plan = artifacts.planAbs(ws);
  if (!fs.exists(plan)) {
    err(`devx workstream graph: workstream '${ws.workstreamRel}' has no plan artifact yet — run the Plan stage first\n`);
    return 2;
  }
  const ep = emissionPlan(fs.readFile(plan));
  out(
    `${JSON.stringify({
      hash: ws.hash,
      present: ep.present,
      order: ep.order,
      phases: ep.phases.map((p) => ({
        id: p.id,
        depends_on: p.dependsOn,
        parallel_safe: p.parallelSafe,
        independent_with: p.independentWith,
        files: p.files,
      })),
      findings: ep.findings,
    })}\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// position (A16 — the review pass's mechanical half)
// ---------------------------------------------------------------------------

export interface RunPositionOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  projectPath?: string;
  fs?: Partial<EngineFs>;
  exec?: Exec;
  /** YYYY-MM-DD; `devx next` row 2 branches on a due measure_by. */
  today?: string;
}

/** One workstream as the review pass reads it. */
interface PositionReport {
  slug: string;
  hash: string;
  stage: string | null;
  workstream: string;
  gates: Record<string, string>;
  gate_summary: string[];
  next: { row: number; command: string | null; reason: string };
  blockers: string[];
  review: ReviewVerdict;
  tally: FindingTally;
  findings: PositionFinding[];
}

/**
 * `changedAt` + `dirty` per path, memoized per run and injected through the
 * same `Exec` seam every other command uses — so a repo with no git (or a
 * path git has never seen) degrades to "unknown", and the staleness
 * comparison is skipped rather than guessed.
 *
 * `--follow --diff-filter=AM` is the load-bearing part, not a flag
 * preference. `AM` keeps only commits that added or modified the content, so
 * a pure relocation is not a change; `--follow` tracks the content across
 * that relocation, so a real edit made under the artifact's OLD name still
 * counts. Without the pair, the folder-per-artifact migration (`design.md` →
 * `design/agent.md`, PR #144) reports every workstream it touched as a
 * rewritten artifact under a passed gate — four false BLOCKING findings in
 * this repo alone, which is how a review surface loses its reader.
 */
function gitProbe(repoRoot: string, exec: Exec) {
  const changedCache = new Map<string, number | null>();
  const dirtyCache = new Map<string, boolean>();
  const git = (args: string[]) => exec("git", args, { cwd: repoRoot });
  return {
    changedAt(rel: string): number | null {
      const hit = changedCache.get(rel);
      if (hit !== undefined) return hit;
      const r = git([
        "log",
        "--follow",
        "-1",
        "--format=%ct",
        "--diff-filter=AM",
        "--",
        rel,
      ]);
      const secs = r.exitCode === 0 ? Number.parseInt(r.stdout.trim(), 10) : Number.NaN;
      const value = Number.isFinite(secs) ? secs : null;
      changedCache.set(rel, value);
      return value;
    },
    dirty(rel: string): boolean {
      const hit = dirtyCache.get(rel);
      if (hit !== undefined) return hit;
      const r = git(["status", "--porcelain", "--", rel]);
      const value = r.exitCode === 0 && r.stdout.trim() !== "";
      dirtyCache.set(rel, value);
      return value;
    },
  };
}

/** Probe a repo-relative path. Every probe routes through here so `rel` is
 *  spelled once per path — the receipt prints it, and a receipt naming a path
 *  the reader cannot `git log` is not a receipt. */
function probeRel(
  fs: EngineFs,
  repoRoot: string,
  rel: string,
  git: ReturnType<typeof gitProbe>,
  exists?: boolean,
): PathProbe {
  return {
    rel,
    exists: exists ?? fs.exists(join(repoRoot, ...rel.split("/"))),
    changedAt: git.changedAt(rel),
    dirty: git.dirty(rel),
  };
}

function probeFor(
  fs: EngineFs,
  repoRoot: string,
  base: artifacts.ResolvedBase,
  kind: artifacts.ArtifactKind,
  git: ReturnType<typeof gitProbe>,
): PathProbe {
  const subject = artifacts.stageSubject(base.layout, base, kind);
  // `artifactExists`, not a bare `fs.exists`: under `project-level` the doc
  // set sits beside devx's own PLAN.md on a case-insensitive filesystem.
  return probeRel(
    fs,
    repoRoot,
    subject.rel,
    git,
    artifacts.artifactExists(fs, base, kind),
  );
}

/**
 * Gate 4's subjects: the authored RED artifacts, one probe each — not the
 * `evals/` directory.
 *
 * The directory is what the gate conceptually gates, and probing it is
 * exactly wrong: `--follow` has no meaning for a directory, so every
 * relocation of the doc set (the folder-per-artifact migration, `devx
 * archive`) reads as "the evals changed" and reports a passed Gate 4 as
 * stale. Per-file probes follow their own renames and give the real answer —
 * which in this repo included a genuine finding (an eval authored four days
 * AFTER the RED report that locked the gate) that the directory probe had
 * buried under three false ones.
 */
function evalSubjects(
  fs: EngineFs,
  repoRoot: string,
  base: artifacts.ResolvedBase,
  git: ReturnType<typeof gitProbe>,
): PathProbe[] {
  const dirRel = artifacts.stageSubject(base.layout, base, { kind: "evals-dir" }).rel;
  const dirAbs = artifacts.evalsDirAbs(base);
  if (!fs.exists(dirAbs)) {
    return [probeRel(fs, repoRoot, dirRel, git, false)];
  }
  let names: string[];
  try {
    names = [...fs.readdir(dirAbs)].filter((n) => artifacts.isAuthoredEvalEntry(n)).sort();
  } catch {
    return [probeRel(fs, repoRoot, dirRel, git, false)];
  }
  // No authored artifacts under a green Gate 4 is itself the finding, and
  // `subject-missing` is the one that states it.
  if (names.length === 0) return [probeRel(fs, repoRoot, dirRel, git, false)];
  return names.map((n) => probeRel(fs, repoRoot, `${dirRel}/${n}`, git, true));
}

/** Newest `<date>-<mode>-verify.md` in a decisions listing, as a probe. The
 *  dated name is chosen by `newestDecisionReport` — the same picker
 *  `renderGateSummary` uses for its FAIL fix paths, so the report this
 *  reconciles against is the report a reader is pointed at. */
function verifyProbe(
  decisionsRel: string,
  decisionNames: readonly string[],
  mode: "design" | "plan",
  git: ReturnType<typeof gitProbe>,
  fs: EngineFs,
  repoRoot: string,
): PathProbe {
  const name = newestDecisionReport(decisionNames, mode);
  if (name === null) {
    return {
      rel: `${decisionsRel}/<date>-${mode}-verify.md`,
      exists: false,
      changedAt: null,
      dirty: false,
    };
  }
  return probeRel(fs, repoRoot, `${decisionsRel}/${name}`, git);
}

function buildReport(args: {
  repoRoot: string;
  slug: string;
  hash: string;
  base: artifacts.ResolvedBase;
  state: EngineState;
  fs: EngineFs;
  git: ReturnType<typeof gitProbe>;
  today: string | null;
  expectationsMin: number;
}): PositionReport {
  const { repoRoot, base, state, fs, git } = args;
  // Repo-relative, through the resolver: `stageSubject` already prefixes the
  // doc-set dir (and collapses it to nothing under `project-level`), so
  // joining `workstreamRel` on by hand here would be a second spelling of a
  // path the map already owns — and the one that gets it wrong in a flat repo.
  const decisionsRel = artifacts.stageSubject(base.layout, base, {
    kind: "decisions-dir",
  }).rel;
  const decisionsAbs = artifacts.decisionsDirAbs(base);
  let decisionNames: readonly string[] = [];
  if (fs.exists(decisionsAbs)) {
    try {
      decisionNames = fs.readdir(decisionsAbs);
    } catch {
      // Unreadable decisions/ ≡ no records: every evidence probe then reads
      // as missing, which is the fail-loud direction for a review pass.
    }
  }
  const probe = (kind: artifacts.ArtifactKind): PathProbe =>
    probeFor(fs, repoRoot, base, kind, git);

  const gates: GateEvidenceMap = {
    // Gate 1 gates two artifacts and writes no report (see GateEvidence).
    prd: {
      subjects: [probe({ kind: "agent", stage: "prd" }), probe({ kind: "expectations" })],
      evidence: null,
      rerun: `devx gate prd ${args.hash}`,
    },
    design: {
      subjects: [probe({ kind: "agent", stage: "design" })],
      evidence: verifyProbe(decisionsRel, decisionNames, "design", git, fs, repoRoot),
      rerun: `devx gate coverage ${args.hash}`,
    },
    plan: {
      subjects: [probe({ kind: "agent", stage: "plan" })],
      evidence: verifyProbe(decisionsRel, decisionNames, "plan", git, fs, repoRoot),
      rerun: `devx gate coverage ${args.hash}`,
    },
    evals: {
      subjects: evalSubjects(fs, repoRoot, base, git),
      evidence: probe({ kind: "red-report" }),
      rerun: `devx gate evals ${args.hash}`,
    },
  };

  const findings = reconcileGates({
    state,
    gates,
    prdRecheck: recheckGate1(fs, base, state, args.expectationsMin),
  });
  const next = nextForWorkstream(
    args.hash,
    state,
    {
      prd: artifacts.artifactExists(fs, base, { kind: "agent", stage: "prd" }),
      expectations: artifacts.artifactExists(fs, base, { kind: "expectations" }),
      design: artifacts.artifactExists(fs, base, { kind: "agent", stage: "design" }),
      plan: artifacts.artifactExists(fs, base, { kind: "agent", stage: "plan" }),
      evalsAuthored: evalsAuthoredIn(fs, base),
    },
    args.today,
    base.layout,
  );

  const summary = renderGateSummary(state, {
    hash: args.hash,
    workstreamRel: base.workstreamRel,
    layout: base.layout,
    decisionNames,
    evalsReportExists: artifacts.artifactExists(fs, base, { kind: "red-report" }),
  }).split("\n");

  return {
    slug: args.slug,
    hash: args.hash,
    stage: state.stage,
    workstream: base.workstreamRel,
    gates: Object.fromEntries(GATE_KEYS.map((k) => [k, gateCellFor(state, k)])),
    gate_summary: summary,
    next,
    blockers: state.blockedBy,
    review: reviewVerdictFor(findings),
    tally: tallyFindings(findings),
    findings,
  };
}

/**
 * Gate 1, re-applied to the artifacts as they stand now.
 *
 * `evaluateGatePrd` is the gate's OWN evaluator, called directly rather than
 * reimplemented: a review that re-derived "what Gate 1 requires" would be a
 * second opinion drifting from the first, and the one answer worth having
 * here is the gate's. It is pure, so asking writes nothing — which is the
 * whole reason this check is available to a read-only pass at all. Returns
 * null when either input is unreadable; a missing subject is already its own
 * finding, and a half-read PRD must not read as a regression.
 */
function recheckGate1(
  fs: EngineFs,
  base: artifacts.ResolvedBase,
  state: EngineState,
  expectationsMin: number,
): { verdict: "PASS" | "FAIL"; gaps: readonly GateGap[] } | null {
  const prd = artifacts.stageSubject(base.layout, base, { kind: "agent", stage: "prd" });
  const exp = artifacts.stageSubject(base.layout, base, { kind: "expectations" });
  if (
    !artifacts.artifactExists(fs, base, { kind: "agent", stage: "prd" }) ||
    !artifacts.artifactExists(fs, base, { kind: "expectations" })
  ) {
    return null;
  }
  try {
    const result = evaluateGatePrd({
      prd: fs.readFile(prd.abs),
      expectations: fs.readFile(exp.abs),
      // `blocked_by` is reported on its own (`blocked-while-validated`), so
      // it is passed empty here: folding it in would make every blocked
      // workstream also report a Gate-1 regression for the same one fact.
      blockedBy: [],
      expectationsMin,
      prdRel: prd.rel,
      expectationsRel: exp.rel,
    });
    return { verdict: result.verdict, gaps: result.gaps };
  } catch {
    return null;
  }
}

/** Does evals/ hold at least one authored RED artifact? Same predicate
 *  `devx next`'s gatherer uses (row 10 vs row 11). */
function evalsAuthoredIn(fs: EngineFs, base: artifacts.ResolvedBase): boolean {
  const dir = artifacts.evalsDirAbs(base);
  if (!fs.exists(dir)) return false;
  try {
    return [...fs.readdir(dir)].some((n) => artifacts.isAuthoredEvalEntry(n));
  } catch {
    return false;
  }
}

function renderReport(r: PositionReport): string {
  const lines = [
    `${r.slug} (${r.hash})  stage: ${r.stage ?? "none"}  review: ${r.review}` +
      ` (${r.tally.blocking} blocking · ${r.tally.advisory} advisory)`,
    ...r.gate_summary.map((l) => `  ${l}`),
    `  next: ${r.next.command ?? "(nothing)"} — ${r.next.reason}`,
  ];
  if (r.blockers.length > 0) lines.push(`  blocked_by: ${r.blockers.join(", ")}`);
  for (const f of r.findings) {
    lines.push(`  [${f.severity === "blocking" ? "BLOCKING" : "advisory"}] ${f.check}: ${f.message}`);
    lines.push(`      receipt: ${f.receipt}`);
  }
  return lines.join("\n");
}

/**
 * `devx workstream position [hash] [--json] [--changed <range>]`
 *
 * Where a workstream stands, and every place its frontmatter disagrees with
 * the evidence on disk. **Reads `gate_status`; never writes it** — advisory
 * by construction, so findings never change the exit code
 * (`test/review-never-writes-gates.test.ts` pins both halves). Exit 2 only
 * when the question cannot be answered: no config, or an unresolvable hash.
 *
 * `--changed <range>` narrows to the doc sets a diff actually touches, which
 * is what the advisory CI job passes. The decision lives here rather than in
 * workflow yaml for the usual reason: a path predicate in a shell one-liner
 * is untestable, and one that silently matches nothing turns the whole job
 * into a no-op that still reports success.
 */
export function runPosition(
  args: string[],
  flags: { json?: boolean; changed?: string },
  opts: RunPositionOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  const exec = opts.exec ?? realExec;

  if (args.length > 1) {
    err("usage: devx workstream position [hash] [--json] [--changed <range>]\n");
    return 2;
  }
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream position: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;
  const git = gitProbe(repoRoot, exec);
  const today = opts.today ?? null;

  let changedPaths: string[] | null = null;
  if (flags.changed !== undefined) {
    const r = exec("git", ["diff", "--name-only", flags.changed], { cwd: repoRoot });
    if (r.exitCode !== 0) {
      err(
        `devx workstream position: cannot diff '${flags.changed}': ${r.stderr.trim()}\n`,
      );
      return 2;
    }
    changedPaths = r.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  }

  const reports: PositionReport[] = [];
  // Lowercased on both sides: `planFilenameHash` lowercases its fallback and
  // frontmatter carries whatever was typed, so a hash given in caps would
  // match nothing and exit 2 — a hard error on a perfectly valid hash.
  const asked = args.length === 1 ? args[0].trim().toLowerCase() : null;
  if (asked !== null && changedPaths !== null) {
    // Said out loud rather than silently ignored: an explicit hash is an
    // explicit request, and a flag that quietly does nothing is worse than
    // one that refuses.
    err(
      "devx workstream position: --changed is ignored when a hash is given — reviewing that workstream regardless of the diff\n",
    );
  }

  for (const entry of enginePlanSpecs(fs, repoRoot, engine)) {
    if (asked !== null && entry.hash.toLowerCase() !== asked) continue;
    if (asked === null) {
      // No hash: the same active set `devx status` renders — a review of a
      // retired workstream is a question you ask by name.
      const active = entry.state.stage !== "done" && entry.state.stage !== "retired";
      const outcomePending =
        entry.state.stage === "done" && entry.state.outcome.status === "pending";
      if (!active && !outcomePending) continue;
      if (changedPaths !== null && !touchesDocSet(changedPaths, entry, engine)) {
        continue;
      }
    }
    reports.push(
      buildReport({
        repoRoot,
        slug: entry.slug,
        hash: entry.hash,
        base: entry.base,
        state: entry.state,
        fs,
        git,
        today,
        expectationsMin: engine.expectationsMin,
      }),
    );
  }

  if (asked !== null && reports.length === 0) {
    err(
      `devx workstream position: no engine-managed plan spec for hash '${asked}' — run \`devx status\` for the live ones\n`,
    );
    return 2;
  }

  const tally = reports.reduce(
    (acc, r) => ({
      blocking: acc.blocking + r.tally.blocking,
      advisory: acc.advisory + r.tally.advisory,
    }),
    { blocking: 0, advisory: 0 },
  );
  const review = reviewVerdictFor(reports.flatMap((r) => r.findings));

  if (flags.json === true) {
    out(`${JSON.stringify({ review, tally, workstreams: reports })}\n`);
    return 0;
  }
  if (reports.length === 0) {
    out(
      changedPaths !== null
        ? `no workstream artifacts in '${flags.changed}' — nothing to reconcile\n`
        : "no active workstreams\n",
    );
    return 0;
  }
  out(`${reports.map(renderReport).join("\n\n")}\n`);
  return 0;
}

/** Does a changed-path list touch this doc set? Under `workstream` that is a
 *  prefix test on the workstream dir. Under `project-level` the doc set IS
 *  the repo root, so a prefix test would match every path in the repo —
 *  there the question is whether a changed path IS one of the doc set's own
 *  artifacts.
 *
 *  Either way the plan spec counts. A PR whose whole diff is one flipped
 *  gate flag touches no artifact at all, and that is precisely the diff this
 *  pass most wants to see. */
function touchesDocSet(
  changed: readonly string[],
  entry: PlanSpecEntry,
  engine: { docsLayout: artifacts.DocsLayout },
): boolean {
  const normalized = changed.map((p) => artifacts.normalizeArtifactPath(p));
  const specRel = artifacts.normalizeArtifactPath(entry.specRel);
  if (normalized.includes(specRel)) return true;
  const base = entry.base;
  if (engine.docsLayout !== "project-level") {
    const prefix = `${base.workstreamRel}/`;
    return normalized.some((p) => p.startsWith(prefix));
  }
  const owned = new Set(
    artifacts.ALL_ARTIFACT_KINDS.map((k) =>
      artifacts.normalizeArtifactPath(artifacts.artifactRel(base.layout, k)),
    ),
  );
  return normalized.some((p) => {
    if (owned.has(p)) return true;
    // A dated record under one of the doc set's directories counts too.
    return [...owned].some((o) => !o.endsWith(".md") && p.startsWith(`${o}/`));
  });
}

/** Every engine-managed plan spec, with its resolved doc-set base. The same
 *  scan `devx status` runs — identity derives from the FILE, never a hash
 *  round-trip, so the two surfaces cannot disagree about one spec. */
interface PlanSpecEntry {
  slug: string;
  hash: string;
  state: EngineState;
  base: artifacts.ResolvedBase;
  /** Repo-relative plan-spec path. The spec IS the state this pass
   *  reconciles, so a PR that edits nothing but a gate flag must still
   *  count as touching the doc set. */
  specRel: string;
}

function enginePlanSpecs(
  fs: EngineFs,
  repoRoot: string,
  engine: EngineConfig,
): PlanSpecEntry[] {
  const out: PlanSpecEntry[] = [];
  for (const { name, state } of planSpecEntries(fs, repoRoot, undefined)) {
    // Only engine-managed specs participate; a legacy plan spec has no stage
    // and PLAN.md is its surface.
    if (state.stage === null) continue;
    const hash = state.hash ?? planFilenameHash(name);
    if (hash === null) continue;
    const wsRel = planSpecWorkstreamRel(name, state.workstream, engine);
    if (wsRel === null) continue;
    if (!fs.exists(join(repoRoot, ...wsRel.split("/")))) continue;
    out.push({
      slug: workstreamSlugFor(name, wsRel, engine) ?? wsRel,
      hash,
      state,
      base: { repoRoot, workstreamRel: wsRel, layout: engine.docsLayout },
      specRel: `plan/${name}`,
    });
  }
  return out;
}

export function register(program: Command): void {
  const sub = program
    .command("workstream")
    .description(
      "Workstream operations (v2 engine). `new <slug>` scaffolds _devx/workstreams/<slug>/ + the plan spec's engine frontmatter.",
    );

  sub
    .command("new")
    .description(
      "Scaffold a workstream: the PRD + expectations from templates, empty decisions/checkpoints/evals, plan-spec engine frontmatter. Idempotent. Artifact names follow `engine.docs_layout`.",
    )
    .argument(
      "[slug]",
      "workstream slug (kebab-case, ≤50 chars) — optional under `engine.docs_layout: project-level`",
    )
    .option("--hash <hash>", "bind an existing plan spec instead of creating one")
    .action((slug: string | undefined, cmdOpts: { hash?: string }) => {
      const code = runWorkstreamNew(slug === undefined ? [] : [slug], {
        hash: cmdOpts.hash,
      });
      if (code !== 0) process.exit(code);
    });

  sub
    .command("graph")
    .description(
      "Print the plan's Execution graph as RED emission consumes it: phase order, per-phase depends_on / parallel_safe / independent_with, and the gate's findings. JSON on stdout; no graph section → serial checklist order.",
    )
    .argument("<hash>", "plan-spec hash")
    .action((hash: string) => {
      const code = runWorkstreamGraph([hash]);
      if (code !== 0) process.exit(code);
    });

  sub
    .command("position")
    .description(
      "Where a workstream stands (stage, verdict-aware gates, next command, blockers) plus every place its frontmatter disagrees with the evidence on disk. Advisory: reads gate_status, never writes it, and findings never change the exit code.",
    )
    .argument("[hash]", "one workstream (default: every active one, as `devx status` scopes them)")
    .option("--json", "machine-readable report — what /devx-review writes review.md from")
    .option("--changed <range>", "only doc sets a git diff range touches (the advisory CI job's form)")
    .action((hash: string | undefined, cmdOpts: { json?: boolean; changed?: string }) => {
      const code = runPosition(hash === undefined ? [] : [hash], {
        json: cmdOpts.json,
        changed: cmdOpts.changed,
      });
      if (code !== 0) process.exit(code);
    });

  sub
    .command("scope-check")
    .description(
      "Fail (exit 1) when a workstream story's diff edits plan/agent.md outside its own phase — the capture of another session's work that debug-2d6fc1 found. Exit 2 = could not tell (fail closed).",
    )
    .option("--diff <range>", "git diff range (default origin/<base>...HEAD)")
    .option("--story <hash>", "the story hash (default: from GITHUB_HEAD_REF or the current branch)")
    .action((cmdOpts: { diff?: string; story?: string }) => {
      const code = runScopeCheck({ diff: cmdOpts.diff, story: cmdOpts.story });
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
