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
//   - P1+: gaps (missing artifact / exit 0 / deferred) ⇒ CONCERNS, never a
//     block.
//   - Deferred stubs are legal only for `tests-after` / `human` validation
//     types, read from plan.md's Expectation-coverage table when present
//     (column `Validation type`); expectations without a plan row default
//     to `tests-first` (must run).
//   - `.md` artifacts (eval specs under evals/) are not mechanically
//     runnable — they count as deferred and follow the same type rules.
//
// Writes `evals/RED-report.md` (shared verdict block; reviewer
// `devx gate evals`) with command + exit code + failure quote per E-id.
// PASS/CONCERNS flip `evals_red` + `stage: executing` (CONCERNS advances
// with the concern recorded — D-9 semantics, same as gate coverage).
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.6

import { spawnSync } from "node:child_process";
import { isAbsolute, join, relative, sep } from "node:path";

import {
  type EBlock,
  normalizePriority,
  parseExpectations,
} from "./expectations.js";
import {
  INACTIVE_WAIVER,
  type Verdict,
  renderVerdictBlock,
} from "./verdict.js";

// ---------------------------------------------------------------------------
// plan.md Expectation-coverage table (validation types + artifacts)
// ---------------------------------------------------------------------------

export type ValidationType = "tests-first" | "tests-after" | "human" | "none";

export interface PlanCoverageRow {
  eId: string;
  validationType: ValidationType | null;
  artifact: string | null;
}

const VALIDATION_TYPES: ReadonlySet<string> = new Set([
  "tests-first",
  "tests-after",
  "human",
  "none",
]);

/**
 * Parse the `| E-id | Priority | Verified in phase | Validation type |
 * Eval artifact | Coverage |` table out of plan.md. Column positions are
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
      rows.push({
        eId: eId.toUpperCase().replace(/^E/, "E"),
        validationType: VALIDATION_TYPES.has(typeRaw)
          ? (typeRaw as ValidationType)
          : null,
        artifact: artifactRaw === "" || artifactRaw === "-" ? null : artifactRaw,
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
    out.push({
      name: p.name,
      path: p.path.replace(/\/+$/, "") || ".",
      test: typeof p.test === "string" && p.test.trim() !== "" ? p.test : null,
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
// The gate
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ShellExec = (command: string, cwd: string) => ExecResult;

export const realShellExec: ShellExec = (command, cwd) => {
  const r = spawnSync(command, { shell: true, encoding: "utf8", cwd });
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
  | "right-reason"
  | "not-red"
  | "not-run (artifact missing)"
  | "not-run (deferred: tests-after)"
  | "not-run (deferred: human)"
  | "not-run (deferred: none)"
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
  /** Non-null when this run contributes a gap (P0 → blocking). */
  gap: string | null;
  blocking: boolean;
}

export interface GateEvalsInputs {
  repoRoot: string;
  /** Absolute workstream dir (for evals/ artifact resolution). */
  workstreamAbs: string;
  expectations: string;
  /** plan.md content, or null when absent (all rows default tests-first). */
  plan: string | null;
  runners: ProjectRunner[];
  exec: ShellExec;
  /** fs.exists seam. */
  exists: (absPath: string) => boolean;
  /** Dry-run: resolve everything, run nothing. */
  dryRun?: boolean;
}

export interface GateEvalsResult {
  verdict: Extract<Verdict, "PASS" | "CONCERNS" | "FAIL">;
  runs: EvalRun[];
  deferred: EvalRun[];
  reasons: string[];
}

/**
 * Resolve an artifact path: `evals/...` targets live under the workstream
 * dir; everything else is repo-relative. Returns {abs, rel} where rel is
 * repo-relative for runner matching.
 */
function resolveArtifactPath(
  repoRoot: string,
  workstreamAbs: string,
  target: string,
): { abs: string; rel: string } {
  const cleaned = target.replace(/`/g, "").trim();
  if (cleaned.startsWith("evals/")) {
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
  const verdict: GateEvalsResult["verdict"] = anyBlocking
    ? "FAIL"
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
    gap: null,
    blocking: false,
  };

  // Deferred validation types: legal stubs for P1+, a P0 floor breach for P0.
  if (validationType !== "tests-first") {
    base.redVerdict = `not-run (deferred: ${validationType})` as RedVerdict;
    if (isP0) {
      base.gap = `${block.id} is P0 but its validation type is '${validationType}' — P0 expectations must be observed RED pre-implementation`;
      base.blocking = true;
    }
    return base;
  }

  // Target: expectations.md Verified-by is the contract; plan.md's artifact
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
  if (!runner || runner.test === null) {
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
  const command = `${runner.test} ${artifactForRunner}`;
  base.command = command;

  if (inputs.dryRun) {
    base.redVerdict = "not-red";
    base.gap = null;
    return base;
  }

  const result = inputs.exec(command, cwd);
  base.exitCode = result.exitCode;
  const combined = `${result.stdout}\n${result.stderr}`;
  base.excerpt = lastLines(combined, 10);

  if (result.exitCode === 0) {
    base.redVerdict = "not-red";
    base.gap = `${block.id} expected RED but '${command}' exited 0 — the artifact does not test the missing behavior`;
    base.blocking = isP0;
  } else {
    base.redVerdict = "right-reason";
  }
  return base;
}

// ---------------------------------------------------------------------------
// RED-report rendering — evals/RED-report.md
// ---------------------------------------------------------------------------

export function renderRedReport(args: {
  workstreamRel: string;
  date: string;
  result: GateEvalsResult;
}): string {
  const { result } = args;
  const statusReason =
    result.verdict === "PASS"
      ? `Every runnable expectation observed RED for the right reason (${result.runs.length} run(s), ${result.deferred.length} deferred).`
      : result.reasons.slice(0, 2).join(" ") +
        (result.reasons.length > 2 ? ` (+${result.reasons.length - 2} more)` : "");

  const lines: string[] = [];
  lines.push(
    renderVerdictBlock({
      gate: result.verdict,
      statusReason,
      reviewer: "devx gate evals",
      updated: args.date,
      waiver: INACTIVE_WAIVER,
    }),
  );
  lines.push(`# RED report — ${args.workstreamRel} — ${args.date}`);
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
