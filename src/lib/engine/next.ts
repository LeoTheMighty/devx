// `devx next <hash>` v1 — the workstream-scoped next-command function
// (v2e101). Pure and table-driven: frontmatter (stage + gate_status +
// outcome) plus artifact presence → the single next command. Computed
// fresh every call, no stored rollup, so it can't go stale
// (v2/02-engine.md §5; the 8am-harness `next_command()` move).
//
// v1 covers the workstream-stage rows of the dispatcher decision table
// (v2/05-dispatcher.md §2 rows 9–12): a workstream mid-pipeline routes to
// its next stage or gate. The repo-level rows (live loops, open PRs,
// DEV.md/PLAN.md scans — rows 1–8 and the no-hash form) land in v2d101.
//
// First match wins:
//
//   | # | Condition                                   | Next command            |
//   |---|---------------------------------------------|-------------------------|
//   | 1 | stage retired                               | (nothing)               |
//   | 2 | stage done, outcome unarmed OR pending+due  | /devx outcome <hash>    |
//   | 3 | stage done, outcome scored or pending+early | (nothing / wait)        |
//   | 4 | prd.md or expectations.md missing           | /devx prd <hash>        |
//   | 5 | ¬prd_validated                              | devx gate prd <hash>    |
//   | 6 | design.md missing                           | /devx design <hash>     |
//   | 7 | ¬design_verified                            | devx gate coverage <hash> |
//   | 8 | plan.md missing                             | /devx plan <hash>       |
//   | 9 | ¬plan_verified                              | devx gate coverage <hash> |
//   | 10| ¬evals_red, evals/ empty                    | /devx red <hash>        |
//   | 11| ¬evals_red, evals/ has artifacts            | devx gate evals <hash>  |
//   | 12| all gates true                              | /devx  (execute arm)    |
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/05-dispatcher.md §2 rows 9–12; v2/02-engine.md §5

import { type EngineState } from "./frontmatter.js";
import { isMeasureByDue, isOutcomeVerdict } from "./outcome.js";

export interface WorkstreamArtifacts {
  prd: boolean;
  expectations: boolean;
  design: boolean;
  plan: boolean;
  /** evals/ contains at least one entry besides RED-report.md. */
  evalsAuthored: boolean;
}

export interface NextDecision {
  /** Table row that fired (for tests + audit). */
  row: number;
  /** The single next command, or null when the workstream is closed. */
  command: string | null;
  reason: string;
}

interface NextRow {
  row: number;
  matches(s: EngineState, a: WorkstreamArtifacts, today: string | null): boolean;
  decide(
    hash: string,
    s: EngineState,
  ): { command: string | null; reason: string };
}

/** Row 2's due predicate: an unarmed outcome is always actionable (arm it);
 *  a pending outcome is actionable only once measure_by ≤ today; only a
 *  REAL verdict (keep|tune|restart|retire) counts as scored — a typo'd
 *  status ("keeep") must surface as actionable, not silently read as
 *  "scored — nothing next" (adversarial-review BH#5; `devx outcome score`
 *  agrees: its already-scored refusal uses the same isOutcomeVerdict).
 *  When no `today` is supplied the pre-v2o101 behavior holds (pending =
 *  actionable) — callers that care about the window pass the date. */
function outcomeActionable(s: EngineState, today: string | null): boolean {
  if (isOutcomeVerdict(s.outcome.status)) return false;
  if (s.outcome.status === "pending") {
    return today === null || isMeasureByDue(s.outcome.measure_by, today);
  }
  return true; // null or garbage — arm/score it
}

const TABLE: NextRow[] = [
  {
    row: 1,
    matches: (s) => s.stage === "retired",
    decide: () => ({
      command: null,
      reason: "workstream is retired — nothing next",
    }),
  },
  {
    row: 2,
    matches: (s, _a, today) =>
      s.stage === "done" && outcomeActionable(s, today),
    decide: (hash, s) => ({
      command: `/devx outcome ${hash}`,
      reason:
        s.outcome.status === "pending"
          ? `workstream is done and its outcome came due (measure_by ${s.outcome.measure_by ?? "unset"}) — score it`
          : "workstream is done but its outcome has not been armed/scored",
    }),
  },
  {
    row: 3,
    matches: (s) => s.stage === "done",
    decide: (_hash, s) => ({
      command: null,
      reason:
        s.outcome.status === "pending"
          ? `workstream is done; outcome armed (measure_by ${s.outcome.measure_by ?? "unset"}) — waiting for the measurement window`
          : "workstream is done and its outcome is scored — nothing next",
    }),
  },
  {
    row: 4,
    matches: (_s, a) => !a.prd || !a.expectations,
    decide: (hash) => ({
      command: `/devx prd ${hash}`,
      reason: "prd.md / expectations.md not yet authored",
    }),
  },
  {
    row: 5,
    matches: (s) => !s.gateStatus.prd_validated,
    decide: (hash) => ({
      command: `devx gate prd ${hash}`,
      reason: "Gate 1 open: prd.md + expectations.md exist but prd_validated is false",
    }),
  },
  {
    row: 6,
    matches: (_s, a) => !a.design,
    decide: (hash) => ({
      command: `/devx design ${hash}`,
      reason: "design.md not yet authored",
    }),
  },
  {
    row: 7,
    matches: (s) => !s.gateStatus.design_verified,
    decide: (hash) => ({
      command: `devx gate coverage ${hash}`,
      reason: "Gate 2 open: design.md exists but design_verified is false",
    }),
  },
  {
    row: 8,
    matches: (_s, a) => !a.plan,
    decide: (hash) => ({
      command: `/devx plan ${hash}`,
      reason: "plan.md not yet authored",
    }),
  },
  {
    row: 9,
    matches: (s) => !s.gateStatus.plan_verified,
    decide: (hash) => ({
      command: `devx gate coverage ${hash}`,
      reason: "Gate 3 open: plan.md exists but plan_verified is false",
    }),
  },
  {
    row: 10,
    matches: (s, a) => !s.gateStatus.evals_red && !a.evalsAuthored,
    decide: (hash) => ({
      command: `/devx red ${hash}`,
      reason: "Gate 4 open and no RED artifacts authored under evals/ yet",
    }),
  },
  {
    row: 11,
    matches: (s) => !s.gateStatus.evals_red,
    decide: (hash) => ({
      command: `devx gate evals ${hash}`,
      reason: "Gate 4 open: RED artifacts exist but evals_red is false",
    }),
  },
  {
    row: 12,
    matches: () => true,
    decide: () => ({
      command: "/devx",
      reason:
        "all four gates passed — the workstream is executing; /devx picks up its dev items",
    }),
  },
];

export function nextForWorkstream(
  hash: string,
  state: EngineState,
  artifacts: WorkstreamArtifacts,
  /** YYYY-MM-DD; gates row 2's pending-outcome branch on measure_by. Omit
   *  for the pre-v2o101 behavior (pending outcomes always actionable). */
  today: string | null = null,
): NextDecision {
  for (const row of TABLE) {
    if (row.matches(state, artifacts, today)) {
      return { row: row.row, ...row.decide(hash, state) };
    }
  }
  // Unreachable — row 12 always matches. Kept for the type system.
  return { row: -1, command: null, reason: "no row matched" };
}
