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
  FLAG_TO_GATE_KEY,
  type GateFlag,
  type GateKey,
  type Stage,
  stageIndex,
} from "./frontmatter.js";
import { DESIGN_REL, EXPECTATIONS_REL, PLAN_REL, PRD_REL } from "./artifacts.js";

export interface CascadeEntry {
  /** Artifact basename this row matches. */
  artifact: string;
  resets: GateFlag[];
  stage: Stage;
}

export const CASCADE_TABLE: CascadeEntry[] = [
  {
    artifact: PRD_REL,
    resets: ["prd_validated", "design_verified", "plan_verified", "evals_red"],
    stage: "prd",
  },
  {
    artifact: EXPECTATIONS_REL,
    resets: ["prd_validated", "design_verified", "plan_verified", "evals_red"],
    stage: "prd",
  },
  {
    artifact: DESIGN_REL,
    resets: ["design_verified", "plan_verified", "evals_red"],
    stage: "design",
  },
  {
    artifact: PLAN_REL,
    resets: ["plan_verified", "evals_red"],
    stage: "plan",
  },
];

export const KNOWN_ARTIFACTS = CASCADE_TABLE.map((e) => e.artifact);

/** Bare-stage shorthand: `--touched prd` names that stage's authoritative
 *  artifact. evals has no cascade row (RED artifacts re-run, they don't
 *  roll stages back), so it is deliberately absent. */
const STAGE_SHORTHAND: Record<string, string> = {
  prd: PRD_REL,
  design: DESIGN_REL,
  plan: PLAN_REL,
};

/** Cascade row for a touched path, or null. Matches the workstream-relative
 *  key (`prd/agent.md`), a root-artifact basename (`expectations.md`), a
 *  longer path ending in the key, or the bare stage shorthand (`prd`).
 *  A bare `agent.md` is ambiguous across stages → null (refusal). human.md,
 *  outline.md and outline-critique.md never cascade — a digest refresh or
 *  outline critique must not reset gate flags. */
export function cascadeFor(touched: string): CascadeEntry | null {
  const norm = touched.replace(/\\/g, "/").replace(/\/+$/, "");
  const segs = norm.split("/").filter((s) => s !== "");
  const last1 = segs[segs.length - 1] ?? "";
  const last2 = segs.slice(-2).join("/");
  const shorthand = segs.length === 1 ? STAGE_SHORTHAND[norm] : undefined;
  return (
    CASCADE_TABLE.find(
      (e) =>
        e.artifact === last2 ||
        e.artifact === last1 ||
        e.artifact === shorthand,
    ) ?? null
  );
}

export interface ReviseComputation {
  /** Flags to clear (only those currently true — the actual delta). */
  flagsCleared: GateFlag[];
  /** Full reset set from the table (delta or not — for the report). */
  resets: GateFlag[];
  /** Gate verdicts to clear — the full reset set mapped to gate keys, NOT
   *  the flags-true delta: a FAIL verdict lives on a gate whose flag is
   *  false, and revise must erase it too (hfi102). */
  verdictsCleared: GateKey[];
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
    verdictsCleared: entry.resets.map((f) => FLAG_TO_GATE_KEY[f]),
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
