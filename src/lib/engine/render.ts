// Gate-summary rendering (hfi102, workstream harness-fold-in Phase 2).
//
// Renders the per-gate verdict line consumed by `devx next` (and later
// `devx status`) under workstream rows:
//
//   gates: prd PASS · design FAIL · plan — · evals —
//     design FAIL → report: <ws>/decisions/2026-07-24-design-verify.md · re-run: devx gate coverage <hash>
//
// Fallback rule per gate (design/agent.md §Rendering): verdict ≠ null → verdict;
// else flag true → PASS (legacy pre-verdict runs — shipped specs are never
// rewritten, the flag-true fallback IS the migration); else `—` (never
// evaluated, or cleared by `devx revise`). FAIL therefore renders visibly
// distinct from never-run (G-2).
//
// FAIL rows append the fix path: coverage gates point at the newest
// `decisions/<date>-<mode>-verify.md`, evals at `evals/RED-report.md`, prd
// has no report artifact (re-run command only). Re-run command strings
// match `nextForWorkstream` (src/lib/engine/next.ts) verbatim.
//
// Pure module by design — same posture as next/decide.ts: the caller
// supplies the `decisions/` listing (gather.ts owns the fs seam), so the
// renderer is table-testable without touching disk.
//
// Spec: dev/dev-hfi102-2026-07-24T10:41-gate-verdict-persistence.md (AC 4)
// Design: _devx/workstreams/harness-fold-in/design/agent.md §Rendering

import {
  GATE_KEYS,
  type EngineState,
  type GateKey,
  type Stage,
} from "./frontmatter.js";
import { type TodoDoc, currentFocus } from "./todo.js";
import { DECISIONS_DIR_REL, RED_REPORT_REL } from "./artifacts.js";

/** Rendered when a gate has no verdict and no legacy flag-true fallback. */
export const NEVER_RUN = "—";

/**
 * Context for the FAIL fix-path lines. Optional as a whole — without it
 * (or with fields null/empty) FAIL rows degrade to the re-run command
 * alone, never a broken pointer.
 */
export interface GateSummaryContext {
  /** Workstream hash for re-run commands; falls back to state.hash. */
  hash?: string | null;
  /** Repo-relative workstream dir (`_devx/workstreams/<slug>`) for report
   *  pointers. Null/absent → pointers omitted. */
  workstreamRel?: string | null;
  /** Plain listing of `<workstreamRel>/decisions/` (names only, unsorted).
   *  Absent dir ≡ []. */
  decisionNames?: readonly string[];
  /** Whether `<workstreamRel>/evals/RED-report.md` exists. Omitted ≡ true
   *  (a machine-written evals FAIL always has the report — gate.ts writes
   *  it before the verdict); pass false when the caller checked and it's
   *  gone (hand-authored FAIL, deleted report) to degrade to re-run-only
   *  instead of a dangling pointer. */
  evalsReportExists?: boolean;
}

/** The coverage gate writes `decisions/<date>-<mode>-verify.md`; the map
 *  from gate key to that mode. prd/evals have fixed artifacts. */
const COVERAGE_MODE: Partial<Record<GateKey, "design" | "plan">> = {
  design: "design",
  plan: "plan",
};

const RERUN_COMMAND: Record<GateKey, (hash: string) => string> = {
  prd: (h) => `devx gate prd ${h}`,
  design: (h) => `devx gate coverage ${h}`,
  plan: (h) => `devx gate coverage ${h}`,
  evals: (h) => `devx gate evals ${h}`,
};

/**
 * Pick the newest `<date>-<mode>-verify.md` out of a decisions/ listing.
 * The date prefix is ISO (YYYY-MM-DD), so lexicographic max IS newest —
 * no mtime needed, which keeps the renderer pure. Returns the bare file
 * name, or null when no report for that mode exists.
 */
export function newestDecisionReport(
  decisionNames: readonly string[],
  mode: "design" | "plan",
): string | null {
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${mode}-verify\\.md$`);
  let best: string | null = null;
  for (const name of decisionNames) {
    if (!re.test(name)) continue;
    if (best === null || name > best) best = name;
  }
  return best;
}

/** The verdict cell for one gate: verdict → verdict; else legacy flag-true
 *  → PASS; else never-run. */
function gateCell(state: EngineState, key: GateKey): string {
  const verdict = state.gateVerdicts[key];
  if (verdict !== null) return verdict;
  const legacyFlag = {
    prd: state.gateStatus.prd_validated,
    design: state.gateStatus.design_verified,
    plan: state.gateStatus.plan_verified,
    evals: state.gateStatus.evals_red,
  }[key];
  return legacyFlag ? "PASS" : NEVER_RUN;
}

/** Report pointer (repo-relative) for a FAILed gate, or null when the gate
 *  has no report artifact (prd) or the pointer can't be resolved. */
function failReportPointer(
  key: GateKey,
  ctx: GateSummaryContext,
): string | null {
  const ws = ctx.workstreamRel ?? null;
  if (ws === null) return null;
  if (key === "evals") {
    return ctx.evalsReportExists === false
      ? null
      : `${ws}/${RED_REPORT_REL}`;
  }
  const mode = COVERAGE_MODE[key];
  if (mode === undefined) return null; // prd — re-run command only
  const report = newestDecisionReport(ctx.decisionNames ?? [], mode);
  return report !== null ? `${ws}/${DECISIONS_DIR_REL}/${report}` : null;
}

/**
 * Render the gate-summary block for one workstream: the `gates:` line,
 * plus one indented fix-path line per FAILed gate. Single string, newline-
 * joined, no trailing newline — callers indent/emit as they see fit.
 */
export function renderGateSummary(
  state: EngineState,
  ctx: GateSummaryContext = {},
): string {
  const cells = GATE_KEYS.map((key) => `${key} ${gateCell(state, key)}`);
  const lines = [`gates: ${cells.join(" · ")}`];

  const hash = ctx.hash ?? state.hash ?? "<hash>";
  for (const key of GATE_KEYS) {
    if (state.gateVerdicts[key] !== "FAIL") continue;
    const pointer = failReportPointer(key, ctx);
    const rerun = `re-run: ${RERUN_COMMAND[key](hash)}`;
    lines.push(
      pointer !== null
        ? `  ${key} FAIL → report: ${pointer} · ${rerun}`
        : `  ${key} FAIL → ${rerun}`,
    );
  }
  return lines.join("\n");
}

/**
 * The current-focus line for a workstream (hfi103): `focus: <text>` from
 * the frontmatter-rooted focus walk (currentFocus, FR-5). Null — line
 * omitted entirely, never rendered empty — when the caller has no todo.md
 * (doc null: FR-1 grandfathered workstream), the stage doesn't map to a
 * skeleton section (retired / stage null), or the section was hand-deleted.
 */
export function renderFocusLine(
  doc: TodoDoc | null,
  stage: Stage | null,
): string | null {
  if (doc === null || stage === null) return null;
  const focus = currentFocus(doc, stage);
  return focus !== null ? `focus: ${focus}` : null;
}
