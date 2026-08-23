// Central artifact-path resolver — the single source of truth for where a
// workstream's engine artifacts live relative to its directory.
//
// Before this module every consumer join()'d bare filenames ("prd.md",
// "evals/RED-report.md", …) against workstreamAbs independently, which made
// any layout change a ~15-module hunt. All path construction and all
// user-facing artifact names route through these exports; changing the
// layout is now a constants change here plus the prose surfaces.
//
// Naming: `*_REL` constants are workstream-relative POSIX paths (display
// form — what gate messages, next-table reasons, and revise keys print).
// `*Abs()` helpers join them onto an absolute workstream dir with the
// platform separator.
//
// Design: v2/02-engine.md §3 (workstream anatomy)

import { join } from "node:path";

// ---------------------------------------------------------------------------
// Workstream-relative artifact paths (display form).
// ---------------------------------------------------------------------------

/** PRD stage's authoritative artifact (Gate 1 subject). */
export const PRD_REL = "prd.md";
/** Design stage's authoritative artifact (Gate 2 subject). */
export const DESIGN_REL = "design.md";
/** Plan stage's authoritative artifact (Gate 3 subject; coverage table + phases). */
export const PLAN_REL = "plan.md";
/** EARS expectations — Gate 1 co-input, Gate 4 driver. Workstream root. */
export const EXPECTATIONS_REL = "expectations.md";
/** Derived working memory (`devx todo sync`). Workstream root; never a gate input. */
export const TODO_REL = "todo.md";
/** RED-gate artifact dir (E-* runnables/checklists + RED-report.md). */
export const EVALS_DIR_REL = "evals";
/** Gate 4's persisted report. */
export const RED_REPORT_REL = "evals/RED-report.md";
/** Dated verify/critique/revision reports. */
export const DECISIONS_DIR_REL = "decisions";
/** Per-phase verification reports (/devx verify). */
export const CHECKPOINTS_DIR_REL = "checkpoints";
/** Outcome scoring output (devx outcome). */
export const RESULTS_REL = "RESULTS.md";

/** The subdirs `devx workstream new` creates empty. */
export const SCAFFOLD_SUBDIRS = [
  DECISIONS_DIR_REL,
  CHECKPOINTS_DIR_REL,
  EVALS_DIR_REL,
] as const;

// ---------------------------------------------------------------------------
// Absolute resolvers.
// ---------------------------------------------------------------------------

/** Join a workstream-relative artifact path (POSIX form) onto an absolute
 *  workstream dir with the platform separator. */
export function artifactAbs(wsAbs: string, rel: string): string {
  return join(wsAbs, ...rel.split("/"));
}

export const prdAbs = (wsAbs: string): string => artifactAbs(wsAbs, PRD_REL);
export const designAbs = (wsAbs: string): string => artifactAbs(wsAbs, DESIGN_REL);
export const planAbs = (wsAbs: string): string => artifactAbs(wsAbs, PLAN_REL);
export const expectationsAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, EXPECTATIONS_REL);
export const todoAbs = (wsAbs: string): string => artifactAbs(wsAbs, TODO_REL);
export const evalsDirAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, EVALS_DIR_REL);
export const redReportAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, RED_REPORT_REL);
export const decisionsDirAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, DECISIONS_DIR_REL);
export const checkpointsDirAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, CHECKPOINTS_DIR_REL);
export const resultsAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, RESULTS_REL);

// ---------------------------------------------------------------------------
// evals/ classification.
// ---------------------------------------------------------------------------

/** Basename of the Gate 4 report inside evals/. */
export const RED_REPORT_BASENAME = "RED-report.md";

/** Non-authored evals/ residents: the gate report plus the human-facing
 *  companions (folder-per-artifact layout). Listing any of these must NOT
 *  count as "RED artifacts authored" — that existence check routes
 *  `devx next` between row 10 (author evals) and row 11 (run the gate). */
const NON_AUTHORED_EVAL_ENTRIES = new Set([
  RED_REPORT_BASENAME,
  "human.md",
  "outline.md",
  "outline-critique.md",
]);

/** True when an evals/ directory entry is an authored RED artifact
 *  (an E-* runnable/checklist or its fixture), as opposed to the gate's
 *  own report, a human-facing companion doc, or a dotfile. */
export function isAuthoredEvalEntry(name: string): boolean {
  return !name.startsWith(".") && !NON_AUTHORED_EVAL_ENTRIES.has(name);
}
