// Revise — the backward path's cascade-reset applier (v2e101).
//
// `devx revise <hash> --touched <path>` applies the §4.9 cascade table:
//
//   | Changed                  | Resets                                    | stage → |
//   |--------------------------|-------------------------------------------|---------|
//   | prd.md / expectations.md | all 4 gate flags                          | prd     |
//   | design.md                | design_verified, plan_verified, evals_red | design  |
//   | plan.md                  | plan_verified, evals_red                  | plan    |
//
// and prints the replay path — the ordered list of gate commands now open —
// so the forward skills' refusals force actual absorption of the change.
// The CLI does NOT edit the touched artifact itself (that's the /devx
// revise skill's collaborative surface, v2e102); it only rolls the spec's
// state back. Unknown artifacts are refused (exit 1) — a typo'd --touched
// silently resetting four gate flags would be the worst possible failure
// shape for this command.
//
// Stage only ever rolls BACK: touching plan.md while the workstream is
// still at stage prd keeps stage prd (the earlier of current vs cascade
// target wins). Gate flags are one-directional too — the cascade only
// clears flags, never sets them.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.9

import {
  type EngineState,
  type GateFlag,
  type Stage,
  stageIndex,
} from "./frontmatter.js";

export interface CascadeEntry {
  /** Artifact basename this row matches. */
  artifact: string;
  resets: GateFlag[];
  stage: Stage;
}

export const CASCADE_TABLE: CascadeEntry[] = [
  {
    artifact: "prd.md",
    resets: ["prd_validated", "design_verified", "plan_verified", "evals_red"],
    stage: "prd",
  },
  {
    artifact: "expectations.md",
    resets: ["prd_validated", "design_verified", "plan_verified", "evals_red"],
    stage: "prd",
  },
  {
    artifact: "design.md",
    resets: ["design_verified", "plan_verified", "evals_red"],
    stage: "design",
  },
  {
    artifact: "plan.md",
    resets: ["plan_verified", "evals_red"],
    stage: "plan",
  },
];

export const KNOWN_ARTIFACTS = CASCADE_TABLE.map((e) => e.artifact);

/** Cascade row for a touched path (matched on basename), or null. */
export function cascadeFor(touched: string): CascadeEntry | null {
  const base = touched.split("/").pop() ?? touched;
  return CASCADE_TABLE.find((e) => e.artifact === base) ?? null;
}

export interface ReviseComputation {
  /** Flags to clear (only those currently true — the actual delta). */
  flagsCleared: GateFlag[];
  /** Full reset set from the table (delta or not — for the report). */
  resets: GateFlag[];
  /** Stage after rollback (earlier of current vs cascade target). */
  stage: Stage;
  stageChanged: boolean;
  /** Ordered gate commands now open. */
  replay: string[];
}

/**
 * Pure cascade computation over the current engine state. The CLI applies
 * `flagsCleared` + `stage` via applyEnginePatch and prints `replay`.
 */
export function computeRevise(
  state: EngineState,
  entry: CascadeEntry,
  hash: string,
): ReviseComputation {
  const flagsCleared = entry.resets.filter((f) => state.gateStatus[f]);

  const current = state.stage ?? "prd";
  const target = entry.stage;
  const stage =
    stageIndex(current as Stage) < stageIndex(target) ? (current as Stage) : target;

  return {
    flagsCleared,
    resets: entry.resets,
    stage,
    stageChanged: stage !== state.stage,
    replay: replayPath(stage, hash),
  };
}

/**
 * The ordered list of gate commands open from a given stage. The two
 * coverage entries are annotated with their mode — same command, two open
 * gates — so the replay path reads unambiguously.
 */
export function replayPath(stage: Stage, hash: string): string[] {
  const full = [
    { from: "prd", cmd: `devx gate prd ${hash}` },
    { from: "design", cmd: `devx gate coverage ${hash}  # design mode` },
    { from: "plan", cmd: `devx gate coverage ${hash}  # plan mode` },
    { from: "red", cmd: `devx gate evals ${hash}` },
  ] as const;
  const startIdx = full.findIndex((e) => e.from === stage);
  if (startIdx === -1) {
    // intake rolls to the full path; executing/done/retired have no open
    // gates (revise always rolls back to prd/design/plan, so only intake
    // can reach here).
    return stage === "intake" ? full.map((e) => e.cmd) : [];
  }
  return full.slice(startIdx).map((e) => e.cmd);
}
