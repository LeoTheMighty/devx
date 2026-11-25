// Gate 4 — RED (v2e101). For every expectation, resolve the Verified-by
// target and RUN it via the project's `projects:` runner command
// (devx.config.yaml — v1's per-project CI config; no new eval.command
// concept, per v2/02-engine.md §4.6). The gate requires each P0's artifact
// to be *observed failing* — nonzero exit + a captured failure excerpt —
// before implementation starts. "If you didn't watch it fail, you don't
// know if it tests the right thing."
//
//   - P0: must run RED (nonzero exit). Missing artifact, exit 0, or a
//     deferred validation type ⇒ FAIL.
//   - P0 RED must also be RED for a reason the gate can see (D-19,
//     red-reason.ts): the eval ran and a test in it failed, by the runner's
//     declared `projects[].red` contract. A wrong reason (could not start,
//     killed, load/collection/setup error, nothing ran, all passed, an exit
//     outside the contract) or an unchecked one (no contract) ⇒ FAIL.
//     The gate does NOT check that the failing test fails on the missing
//     behaviour — that stays the author's judgment, and the report says so.
//   - P1+: gaps (missing artifact / exit 0 / deferred / wrong or unchecked
//     reason) ⇒ CONCERNS, never a block.
//   - Deferred stubs are legal only for `tests-after` / `human` validation
//     types, read from plan/agent.md's Expectation-coverage table when present
//     (column `Validation type`); expectations without a plan row default
//     to `tests-first` (must run).
//   - `.md` artifacts (eval specs under evals/) are not mechanically
//     runnable — they count as deferred and follow the same type rules.
//   - Outcome-measure manifests (B17): a `.md` artifact that parses as an
//     eval manifest whose steps are ALL marked `(measured at outcome)` is
//     deferred at any priority, P0 included. Such a step asserts a number
//     that cannot exist before the thing is live, so it is RED by
//     construction and proves nothing here; `devx outcome score --run`
//     executes it weeks later. A manifest with even one non-deferred step
//     keeps the strict rule — see `isOutcomeDeferredManifest`.
//   - Shipped-green (debug-9b9be5): an eval whose plan-table phase resolves
//     to a `status: done` dev spec is deferred at any priority — after a
//     revise cascade its behavior already merged and the artifact is green
//     by definition, so demanding RED would wedge the replay.
//
// Writes `evals/RED-report.md` (shared verdict block; reviewer
// `devx gate evals`) with command + exit code + failure quote per E-id.
// PASS/CONCERNS flip `evals_red` + `stage: executing` (CONCERNS advances
// with the concern recorded — D-9 semantics, same as gate coverage).
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.6

import { spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

import {
  type EBlock,
  normalizePriority,
  parseExpectations,
} from "./expectations.js";
import { readEngineState } from "./frontmatter.js";
import { EVALS_DIR_REL, type WorkstreamPointerTarget, planPointerMatches } from "./artifacts.js";
import { isOutcomeDeferredManifest } from "./eval-manifest.js";
import {
  type CaseResult,
  RED_REPORT_ENV,
  RED_REPORT_PLACEHOLDER,
  type RedContract,
  type RedReason,
  classifyRed,
  describeContract,
  redContractFrom,
} from "./red-reason.js";
import {
  INACTIVE_WAIVER,
  type Verdict,
  renderVerdictBlock,
} from "./verdict.js";

// ---------------------------------------------------------------------------
// plan/agent.md Expectation-coverage table (validation types + artifacts)
// ---------------------------------------------------------------------------

export type ValidationType = "tests-first" | "tests-after" | "human" | "none";

export interface PlanCoverageRow {
  eId: string;
  validationType: ValidationType | null;
  artifact: string | null;
  /** `Verified in phase` column, when it's a bare positive integer. */
  phase: number | null;
}

const VALIDATION_TYPES: ReadonlySet<string> = new Set([
  "tests-first",
  "tests-after",
  "human",
  "none",
]);

/**
 * Parse the `| E-id | Priority | Verified in phase | Validation type |
 * Eval artifact | Coverage |` table out of plan/agent.md. Column positions are
 * resolved from the header row (not hardcoded) so column reordering or
 * added columns don't silently misparse. Returns [] when no table with an
 * `E-id` header exists — the caller treats every expectation as
 * tests-first in that case.
 */
export function parsePlanCoverageTable(plan: string): PlanCoverageRow[] {
  const lines = plan.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const headers = splitRow(line).map((h) => h.toLowerCase());
    const idCol = headers.findIndex((h) => h === "e-id" || h === "eid" || h === "id");
    if (idCol === -1) continue;
    const typeCol = headers.findIndex((h) => h.includes("type"));
    const artifactCol = headers.findIndex((h) => h.includes("artifact"));
    const phaseCol = headers.findIndex((h) => h.includes("phase"));
    // Walk rows until the table ends (first non-| line). Skip the divider.
    const rows: PlanCoverageRow[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const rowLine = lines[j].trim();
      if (!rowLine.startsWith("|")) break;
      if (/^\|[\s:|-]+\|?$/.test(rowLine)) continue; // divider
      const cells = splitRow(rowLine);
      const eId = (cells[idCol] ?? "").replace(/`/g, "").trim();
      if (!/^E-\d+$/i.test(eId)) continue;
      const typeRaw =
        typeCol !== -1 ? (cells[typeCol] ?? "").replace(/`/g, "").trim().toLowerCase() : "";
      const artifactRaw =
        artifactCol !== -1 ? (cells[artifactCol] ?? "").replace(/`/g, "").trim() : "";
      const phaseRaw =
        phaseCol !== -1 ? (cells[phaseCol] ?? "").replace(/`/g, "").trim() : "";
      rows.push({
        eId: eId.toUpperCase().replace(/^E/, "E"),
        validationType: VALIDATION_TYPES.has(typeRaw)
          ? (typeRaw as ValidationType)
          : null,
        artifact: artifactRaw === "" || artifactRaw === "-" ? null : artifactRaw,
        phase: /^[1-9]\d*$/.test(phaseRaw) ? Number(phaseRaw) : null,
      });
    }
    if (rows.length > 0) return rows;
  }
  return [];
}

function splitRow(line: string): string[] {
  // `| a | b |` → ["a", "b"]. Escaped pipes are not used in these tables.
  const trimmed = line.replace(/^\|/, "").replace(/\|\s*$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Runner resolution — devx.config.yaml `projects:`
// ---------------------------------------------------------------------------

export interface ProjectRunner {
  name: string;
  path: string;
  test: string | null;
  /** Gate 4 contract (`projects[].red`, D-19). Absent/null → undeclared. */
  red?: RedContract | null;
  /** Why a present `red:` block was rejected; it then reads as undeclared. */
  redProblems?: string[];
}

/** Narrow the merged-config `projects:` list. Malformed entries dropped. */
export function projectRunnersFrom(merged: unknown): ProjectRunner[] {
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) return [];
  const projects = (merged as Record<string, unknown>).projects;
  if (!Array.isArray(projects)) return [];
  const out: ProjectRunner[] = [];
  for (const raw of projects) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.name !== "string" || typeof p.path !== "string") continue;
    const red = redContractFrom(p.red);
    out.push({
      name: p.name,
      path: p.path.replace(/\/+$/, "") || ".",
      test: typeof p.test === "string" && p.test.trim() !== "" ? p.test : null,
      red: red.contract,
      ...(red.problems.length > 0 ? { redProblems: red.problems } : {}),
    });
  }
  return out;
}

/**
 * Pick the project whose path is the longest prefix of the artifact's
 * repo-relative path. `.` matches everything (length 0).
 */
export function resolveRunner(
  runners: ProjectRunner[],
  artifactRel: string,
): ProjectRunner | null {
  let best: ProjectRunner | null = null;
  let bestLen = -1;
  for (const r of runners) {
    if (r.path === ".") {
      if (bestLen < 0) {
        best = r;
        bestLen = 0;
      }
      continue;
    }
    const prefix = r.path.endsWith("/") ? r.path : `${r.path}/`;
    if (artifactRel.startsWith(prefix) && prefix.length > bestLen) {
      best = r;
      bestLen = prefix.length;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Shipped-phase resolution — dev/ frontmatter scan (debug-9b9be5)
// ---------------------------------------------------------------------------

/**
 * Plan phases already shipped for a workstream: every `dev/dev-*.md` whose
 * `plan:` frontmatter names this workstream (`planPointerMatches` — either
 * spelling, the directory or the parent plan spec's path), carries a
 * `phase:` number, and is `status: done` contributes its phase. Anything
 * unresolvable (missing dir, unreadable spec, absent `phase:`) reads
 * not-done — the conservative direction; the gate then demands RED as
 * before. Frontmatter is the only phase→spec mapping gates may read: the
 * workstream working-memory file also holds one, but gates are firewalled
 * from it (hfi E-2).
 */
export function donePhasesFor(
  fs: {
    exists(path: string): boolean;
    readdir(path: string): string[];
    readFile(path: string): string;
  },
  repoRoot: string,
  target: WorkstreamPointerTarget,
): Set<number> {
  const done = new Set<number>();
  const dir = join(repoRoot, "dev");
  if (!fs.exists(dir)) return done;
  let names: string[];
  try {
    names = fs.readdir(dir);
  } catch {
    return done;
  }
  for (const name of names) {
    if (!name.startsWith("dev-") || !name.endsWith(".md")) continue;
    try {
      const state = readEngineState(fs.readFile(join(dir, name)));
      if (
        planPointerMatches(state.plan, target) &&
        state.phase !== null &&
        state.status?.toLowerCase() === "done"
      ) {
        done.add(state.phase);
      }
    } catch {
      // unreadable spec reads not-done
    }
  }
  return done;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** `env` is merged over the gate's own environment when given. */
export type ShellExec = (
  command: string,
  cwd: string,
  env?: Readonly<Record<string, string>>,
) => ExecResult;

export const realShellExec: ShellExec = (command, cwd, env) => {
  const r = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    cwd,
    ...(env ? { env: { ...process.env, ...env } } : {}),
    // The 1 MB default kills a chatty suite with ENOBUFS, which lands below
    // as exit 127. Since D-19 that reads "could not run" — right for a
    // missing binary, wrong for a long log — so give the output room.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!r.error && r.status === null && r.signal) {
    // Killed by a signal with no shell left to report 128+n (sh exec'd the
    // runner directly). Say so in the shell's own convention, so the reason
    // check reads "killed", not "not found" (D-19).
    const n = osConstants.signals[r.signal as keyof typeof osConstants.signals];
    return {
      stdout: r.stdout ?? "",
      stderr: `${r.stderr ?? ""}\nkilled by ${r.signal}`,
      exitCode: 128 + (typeof n === "number" ? n : 0),
    };
  }
  if (r.error || r.status === null) {
    return {
      stdout: r.stdout ?? "",
      stderr: r.error ? r.error.message : "spawn returned null status",
      exitCode: 127,
    };
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status };
};

export type RedVerdict =
  /** Ran, and a test failed, by the runner's contract (D-19). NOT a claim
   *  that the failure is the missing behaviour — see red-reason.ts. */
  | "red (asserted)"
  /** Nonzero exit; the runner declares nothing the gate can check. */
  | "red (reason unchecked)"
  | "wrong-reason (could not run)"
  | "wrong-reason (nothing ran)"
  | "wrong-reason (no result)"
  | "wrong-reason (passed)"
  | "wrong-reason (undeclared exit)"
  | "not-red"
  | "not-run (artifact missing)"
  | "not-run (deferred: tests-after)"
  | "not-run (deferred: human)"
  | "not-run (deferred: none)"
  | "not-run (deferred: shipped-green)"
  | "not-run (deferred: waived)"
  | "not-run (deferred: outcome-measure)"
  | "not-run (eval-spec)"
  | "not-run (no runner)";

export interface EvalRun {
  eId: string;
  name: string;
  priority: string | null;
  artifact: string | null;
  command: string | null;
  exitCode: number | null;
  excerpt: string | null;
  redVerdict: RedVerdict;
  /** What the gate could see of WHY it was red (D-19); null when not run
   *  or not red. */
  reason: RedReason | null;
  /** The runner's Gate 4 contract, as `describeContract` prints it. */
  contract: string | null;
  /** Non-null when this run contributes a gap (P0 → blocking). */
  gap: string | null;
  blocking: boolean;
}

export interface GateEvalsInputs {
  repoRoot: string;
  /** Absolute workstream dir (for evals/ artifact resolution). */
  workstreamAbs: string;
  expectations: string;
  /** plan/agent.md content, or null when absent (all rows default tests-first). */
  plan: string | null;
  runners: ProjectRunner[];
  exec: ShellExec;
  /** fs.exists seam. */
  exists: (absPath: string) => boolean;
  /**
   * Read seam for markdown eval artifacts, used ONLY to decide whether a
   * `.md` target is an all-deferred outcome-measure manifest (B17).
   * Returns null when the file cannot be read, which reads as "not a
   * manifest" — the conservative direction, keeping today's strict verdict.
   * Optional so every pre-existing caller behaves exactly as before.
   */
  readFile?: (absPath: string) => string | null;
  /** Plan phases whose dev spec is `status: done` (see donePhasesFor).
   *  Evals verified in a shipped phase are green by definition — a
   *  post-revise replay defers them instead of demanding RED
   *  (debug-9b9be5). Absent → no deferral (grandfathered specs without
   *  `phase:` frontmatter keep today's strict behavior). */
  donePhases?: ReadonlySet<number>;
  /** Uppercased E-ids the operator waived via `--waive` (D-9). Waived
   *  evals are never run and never a gap; ≥1 applied waiver makes a
   *  non-FAIL verdict WAIVED (debug-9b9be5). */
  waived?: ReadonlySet<string>;
  /** Dry-run: resolve everything, run nothing. */
  dryRun?: boolean;
  /**
   * Structured-result seam for runners whose contract declares `report`
   * (D-19). `allocate` returns a fresh path no file occupies yet, one per
   * run; `read` returns its text after the run, or null. Absent → a
   * declared report can never be read, which classifies "no result" — the
   * strict direction.
   */
  redReport?: {
    allocate(eId: string): string;
    read(path: string): string | null;
  };
}

export interface GateEvalsResult {
  verdict: Verdict;
  runs: EvalRun[];
  deferred: EvalRun[];
  reasons: string[];
}

/**
 * Resolve an artifact path: `evals/...` targets live under the workstream
 * dir; everything else is repo-relative. Returns {abs, rel} where rel is
 * repo-relative for runner matching.
 *
 * Exported because `devx outcome score --run` resolves the same
 * `Verified by:` values to find a manifest's measures. Two spellings of
 * that rule is how a manifest the RED gate ran becomes a manifest the
 * outcome gate cannot find.
 */
export function resolveArtifactPath(
  repoRoot: string,
  workstreamAbs: string,
  target: string,
): { abs: string; rel: string } {
  const cleaned = target.replace(/`/g, "").trim();
  if (cleaned.startsWith(`${EVALS_DIR_REL}/`)) {
    const abs = join(workstreamAbs, ...cleaned.split("/"));
    return { abs, rel: relative(repoRoot, abs).split(sep).join("/") };
  }
  const abs = isAbsolute(cleaned)
    ? cleaned
    : join(repoRoot, ...cleaned.split("/"));
  return { abs, rel: relative(repoRoot, abs).split(sep).join("/") };
}

function lastLines(text: string, n: number): string {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.slice(-n).join("\n");
}

export function runGateEvals(inputs: GateEvalsInputs): GateEvalsResult {
  const blocks = parseExpectations(inputs.expectations);
  // A RED gate over zero expectations must not pass vacuously — flipping
  // evals_red with nothing observed failing would defeat the gate's entire
  // point. Gate 1 already requires ≥ expectations_min blocks, so reaching
  // here with zero means the workstream state is corrupt.
  if (blocks.length === 0) {
    return {
      verdict: "FAIL",
      runs: [],
      deferred: [],
      reasons: [
        "expectations.md contains no E-blocks — nothing to observe RED; workstream state is inconsistent",
      ],
    };
  }
  const planRows = inputs.plan ? parsePlanCoverageTable(inputs.plan) : [];
  const planByE = new Map(planRows.map((r) => [r.eId.toUpperCase(), r]));

  const runs: EvalRun[] = [];
  const deferred: EvalRun[] = [];
  const reasons: string[] = [];

  for (const block of blocks) {
    const run = evaluateExpectation(block, planByE, inputs);
    if (run.redVerdict.startsWith("not-run (deferred")) {
      deferred.push(run);
    } else {
      runs.push(run);
    }
    if (run.gap) reasons.push(run.gap);
  }

  const anyBlocking = [...runs, ...deferred].some((r) => r.blocking);
  const anyGap = [...runs, ...deferred].some((r) => r.gap !== null);
  // ≥1 applied waiver turns a would-be PASS/CONCERNS into WAIVED — the
  // report must record that the gate cleared by operator override, not on
  // its own merits (D-9). A blocking gap the waiver didn't cover still
  // FAILs; the waiver never masks other blockers.
  const anyWaived = deferred.some(
    (r) => r.redVerdict === "not-run (deferred: waived)",
  );
  const verdict: GateEvalsResult["verdict"] = anyBlocking
    ? "FAIL"
    : anyWaived
      ? "WAIVED"
      : anyGap
        ? "CONCERNS"
        : "PASS";

  return { verdict, runs, deferred, reasons };
}

function evaluateExpectation(
  block: EBlock,
  planByE: Map<string, PlanCoverageRow>,
  inputs: GateEvalsInputs,
): EvalRun {
  const priority = normalizePriority(block.priority);
  const isP0 = priority === "P0";
  const planRow = planByE.get(block.id.toUpperCase());
  const validationType: ValidationType =
    planRow?.validationType ?? "tests-first";

  const base: EvalRun = {
    eId: block.id,
    name: block.name,
    priority,
    artifact: null,
    command: null,
    exitCode: null,
    excerpt: null,
    redVerdict: "not-red",
    reason: null,
    contract: null,
    gap: null,
    blocking: false,
  };

  // Operator waiver (debug-9b9be5): explicit `--waive E-n` intent outranks
  // every mechanical rule — the eval is never run, never a gap, at any
  // priority. The gate-level verdict becomes WAIVED (see runGateEvals);
  // the CLI supplies the D-9 approver + reason for the verdict block.
  if (inputs.waived?.has(block.id.toUpperCase())) {
    base.redVerdict = "not-run (deferred: waived)";
    return base;
  }

  // Shipped-green (debug-9b9be5): the eval's phase already merged (its dev
  // spec is `status: done`), so its artifact is green by definition — a
  // post-revise replay defers it (any priority, P0 included) instead of
  // demanding RED from shipped behavior. Checked before every other rule:
  // a shipped phase's eval is never run, never a gap.
  const phase = planRow?.phase ?? null;
  if (phase !== null && inputs.donePhases?.has(phase)) {
    base.redVerdict = "not-run (deferred: shipped-green)";
    return base;
  }

  // Deferred validation types: legal stubs for P1+, a P0 floor breach for P0.
  if (validationType !== "tests-first") {
    base.redVerdict = `not-run (deferred: ${validationType})` as RedVerdict;
    if (isP0) {
      base.gap = `${block.id} is P0 but its validation type is '${validationType}' — P0 expectations must be observed RED pre-implementation`;
      base.blocking = true;
    }
    return base;
  }

  // Target: expectations.md Verified-by is the contract; plan/agent.md's artifact
  // column may refine it (e.g. Verified-by named evals/E-3_*.md at PRD time
  // and the plan pinned the concrete file).
  const target = planRow?.artifact ?? block.verifiedBy;
  if (target === null || target.trim() === "") {
    base.gap = `${block.id} has no Verified-by target to run`;
    base.blocking = isP0;
    base.redVerdict = "not-run (artifact missing)";
    return base;
  }

  const { abs, rel } = resolveArtifactPath(
    inputs.repoRoot,
    inputs.workstreamAbs,
    target,
  );
  base.artifact = rel;

  if (!inputs.exists(abs)) {
    base.redVerdict = "not-run (artifact missing)";
    base.gap = `${block.id} artifact '${rel}' does not exist on disk${isP0 ? " — author it (/devx red) before this gate can pass" : ""}`;
    base.blocking = isP0;
    return base;
  }

  // Eval-spec markdown artifacts aren't mechanically runnable. Their RED
  // check is the /devx red skill's judgment surface, not the CLI's. P0s
  // must be runnable (the plan-mode P0 floor already required a runnable
  // artifact) — a P0 that lands here blocks.
  if (rel.toLowerCase().endsWith(".md")) {
    // B17: an all-deferred outcome-measure manifest is the one markdown
    // artifact the RED gate accepts from a P0. Read BEFORE the eval-spec
    // branch below, because that branch's whole claim ("a P0 needs a
    // captured nonzero exit") is the thing this case contradicts.
    const md = inputs.readFile?.(abs) ?? null;
    if (md !== null && isOutcomeDeferredManifest(md)) {
      base.redVerdict = "not-run (deferred: outcome-measure)";
      return base;
    }
    base.redVerdict = "not-run (eval-spec)";
    if (isP0) {
      base.gap = `${block.id} is P0 but its artifact '${rel}' is an eval spec (.md), not a runnable target — P0s need a captured nonzero exit`;
      base.blocking = true;
    } else {
      base.gap = `${block.id} artifact '${rel}' is an eval spec (.md); not mechanically runnable`;
    }
    return base;
  }

  const runner = resolveRunner(inputs.runners, rel);
  const baseCommand = runner ? (runner.red?.command ?? runner.test) : null;
  if (!runner || baseCommand === null) {
    base.redVerdict = "not-run (no runner)";
    base.gap = `${block.id}: no \`projects:\` runner with a test command matches '${rel}'`;
    base.blocking = isP0;
    return base;
  }

  const cwd = join(inputs.repoRoot, ...runner.path.split("/").filter((s) => s !== "."));
  const artifactForRunner =
    runner.path === "."
      ? rel
      : relative(join(inputs.repoRoot, runner.path), abs).split(sep).join("/");
  const contract = runner.red ?? null;
  // Recorded with `{report}` left as written: the real path is a temp file
  // the gate deletes, and a report that named it would differ on every run.
  const command = `${baseCommand} ${artifactForRunner}${
    contract?.args ? ` ${contract.args}` : ""
  }`;
  base.command = command;
  base.contract = describeContract(contract);

  if (inputs.dryRun) {
    base.redVerdict = "not-red";
    base.gap = null;
    return base;
  }

  let reportPath: string | null = null;
  if (contract?.report && inputs.redReport) {
    reportPath = inputs.redReport.allocate(block.id);
  }
  const executed =
    reportPath === null
      ? command
      : command.split(RED_REPORT_PLACEHOLDER).join(shellQuote(reportPath));
  const result = inputs.exec(
    executed,
    cwd,
    reportPath === null ? undefined : { [RED_REPORT_ENV]: reportPath },
  );
  base.exitCode = result.exitCode;
  const combined = `${result.stdout}\n${result.stderr}`;
  base.excerpt = lastLines(combined, 10);

  if (result.exitCode === 0) {
    base.redVerdict = "not-red";
    base.gap = `${block.id} expected RED but '${command}' exited 0 — the artifact does not test the missing behavior`;
    base.blocking = isP0;
    return base;
  }

  const reason = classifyRed({
    exitCode: result.exitCode,
    contract,
    reportText:
      reportPath !== null && inputs.redReport ? inputs.redReport.read(reportPath) : null,
    runnerName: runner.name,
    contractProblems: runner.redProblems,
  });
  base.reason = reason;
  if (reason.kind === "asserted") {
    base.redVerdict = "red (asserted)";
    return base;
  }
  if (reason.kind === "unchecked") {
    base.redVerdict = "red (reason unchecked)";
    base.gap = `${block.id} ran RED but the gate cannot see why — ${reason.detail}${
      isP0 ? "; a P0 must fail for a reason the gate can check" : ""
    }`;
  } else {
    base.redVerdict = `wrong-reason (${reason.wrong})`;
    base.gap = `${block.id} is RED for the wrong reason — ${reason.detail}${
      isP0 ? "; a P0 must fail inside a test, on the missing behaviour" : ""
    }`;
  }
  base.blocking = isP0;
  return base;
}

/** POSIX single-quote a path for the shell the runner command goes to. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// RED-report rendering — evals/RED-report.md
// ---------------------------------------------------------------------------

/** The two halves of the D-19 scope statement every report carries. */
export const CHECKED =
  "Each run P0 must have executed and failed a test, by its runner's `projects[].red` contract: a counted structured report, or exit codes the runner declares mean a test failed.";
export const NOT_CHECKED =
  "Not checked: that the failing test fails on the missing behaviour rather than a typo or a wrong assertion — the author's judgment, from the failure quotes.";

export function renderRedReport(args: {
  workstreamRel: string;
  date: string;
  result: GateEvalsResult;
  /** D-9 waiver detail; required when result.verdict is WAIVED (the
   *  verdict-block writer refuses an approver-less WAIVED). */
  waiver?: { approver: string; reason: string };
}): string {
  const { result } = args;
  const waivedIds = result.deferred
    .filter((r) => r.redVerdict === "not-run (deferred: waived)")
    .map((r) => r.eId);
  const statusReason =
    result.verdict === "PASS"
      ? `Every runnable expectation ran and failed a test, by its runner's contract (${result.runs.length} run(s), ${result.deferred.length} deferred). ${NOT_CHECKED}`
      : result.verdict === "WAIVED"
        ? `${waivedIds.join(", ")} waived by ${args.waiver?.approver ?? "(unknown)"}: ${args.waiver?.reason ?? "(no reason)"} — remaining expectations clear (${result.runs.length} run(s), ${result.deferred.length} deferred).`
        : result.reasons.slice(0, 2).join(" ") +
          (result.reasons.length > 2 ? ` (+${result.reasons.length - 2} more)` : "");

  const lines: string[] = [];
  lines.push(
    renderVerdictBlock({
      gate: result.verdict,
      statusReason,
      reviewer: "devx gate evals",
      updated: args.date,
      waiver:
        result.verdict === "WAIVED" && args.waiver
          ? {
              active: true,
              approver: args.waiver.approver,
              reason: args.waiver.reason,
            }
          : INACTIVE_WAIVER,
    }),
  );
  lines.push(`# RED report — ${args.workstreamRel} — ${args.date}`);
  lines.push("");
  lines.push(`> **What Gate 4 checked (D-19).** ${CHECKED} ${NOT_CHECKED}`);
  lines.push("");
  lines.push("## Runs");
  lines.push("");
  for (const run of result.runs) {
    lines.push(
      `### ${run.eId}: ${run.name}${run.priority ? ` (${run.priority})` : ""}`,
    );
    lines.push("");
    lines.push(`- **Artifact**: ${run.artifact ?? "(unresolved)"}`);
    lines.push(`- **Command**: ${run.command ? `\`${run.command}\`` : "(none)"}`);
    lines.push(`- **Exit code**: ${run.exitCode ?? "(not run)"}`);
    lines.push("- **Failure quote**:");
    lines.push("  ```");
    const excerpt =
      run.excerpt && run.excerpt.trim() !== ""
        ? run.excerpt
        : "(no output captured)";
    for (const l of excerpt.split("\n")) {
      lines.push(`  ${l}`);
    }
    lines.push("  ```");
    lines.push(`- **RED verdict**: ${run.redVerdict}`);
    if (run.contract !== null) lines.push(`- **Runner contract**: ${run.contract}`);
    if (run.reason !== null) {
      lines.push(`- **Reason check**: ${run.reason.detail}`);
      const failing: CaseResult[] = run.reason.kind === "unchecked" ? [] : run.reason.failing;
      if (failing.length > 0) {
        lines.push("- **Failing cases**:");
        for (const c of failing.slice(0, 5)) {
          lines.push(`  - \`${c.id}\`${c.message ? ` — ${c.message}` : ""}`);
        }
        if (failing.length > 5) lines.push(`  - (+${failing.length - 5} more)`);
      }
    }
    lines.push("");
  }
  if (result.runs.length === 0) {
    lines.push("- none");
    lines.push("");
  }
  lines.push("## Deferred stubs");
  lines.push("");
  if (result.deferred.length === 0) {
    lines.push("- none");
  } else {
    for (const run of result.deferred) {
      lines.push(
        `- ${run.eId}: ${run.redVerdict}${run.priority ? ` (${run.priority})` : ""}${run.gap ? ` — ${run.gap}` : ""}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
