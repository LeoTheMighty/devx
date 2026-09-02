// Revise — the backward path's cascade-reset applier (v2e101).
//
// `devx revise <hash> --touched <path>` applies the §4.9 cascade table:
//
//   | Changed                  | Resets                                    | stage → |
//   |--------------------------|-------------------------------------------|---------|
//   | prd/agent.md / expectations.md | all 4 gate flags                          | prd     |
//   | design/agent.md                | design_verified, plan_verified, evals_red | design  |
//   | plan/agent.md                  | plan_verified, evals_red                  | plan    |
//
// and prints the replay path — the ordered list of gate commands now open —
// so the forward skills' refusals force actual absorption of the change.
// The CLI does NOT edit the touched artifact itself (that's the /devx
// revise skill's collaborative surface, v2e102); it only rolls the spec's
// state back. Unknown artifacts are refused (exit 1) — a typo'd --touched
// silently resetting four gate flags would be the worst possible failure
// shape for this command.
//
// Stage only ever rolls BACK: touching plan/agent.md while the workstream is
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
import {
  type ArtifactKind,
  DOCS_LAYOUTS,
  artifactKindIdentity,
  artifactRel,
} from "./artifacts.js";
import { pathToArtifactKind } from "./artifact-index.js";

export interface CascadeEntry {
  /** Layout-INDEPENDENT identity of the artifact this row matches.
   *
   *  Keyed on the identity rather than on a path because the two layouts
   *  spell the same artifact differently (`prd/agent.md` vs `prd.md`), and a
   *  table keyed on one spelling matches nothing under the other —
   *  `cascadeFor()` returns null and `devx revise` refuses every invocation
   *  in a flat repo. */
  artifact: ArtifactKind;
  /** Readable path for user-facing text — the CLI's help string and the
   *  unknown-artifact refusal, both rendered with no repo (and therefore no
   *  layout) in hand. `artifact` is an object, so interpolating it renders
   *  `[object Object]`; the display spelling is carried rather than derived
   *  at the call site.
   *
   *  It is the `workstream` spelling because that is the shipped default and
   *  what the pre-dlr105 help text said. Sites that DO hold a resolved layout
   *  (`runRevise`) render `artifactRel(ws.layout, e.artifact)` instead and get
   *  the flat spelling where it applies. */
  display: string;
  resets: GateFlag[];
  stage: Stage;
}

const row = (
  artifact: ArtifactKind,
  resets: GateFlag[],
  stage: Stage,
): CascadeEntry => ({
  artifact,
  display: artifactRel("workstream", artifact),
  resets,
  stage,
});

export const CASCADE_TABLE: CascadeEntry[] = [
  row(
    { kind: "agent", stage: "prd" },
    ["prd_validated", "design_verified", "plan_verified", "evals_red"],
    "prd",
  ),
  row(
    { kind: "expectations" },
    ["prd_validated", "design_verified", "plan_verified", "evals_red"],
    "prd",
  ),
  row(
    { kind: "agent", stage: "design" },
    ["design_verified", "plan_verified", "evals_red"],
    "design",
  ),
  row({ kind: "agent", stage: "plan" }, ["plan_verified", "evals_red"], "plan"),
];

export const KNOWN_ARTIFACTS = CASCADE_TABLE.map((e) => e.display);

/** Bare-stage shorthand: `--touched prd` names that stage's authoritative
 *  artifact. evals has no cascade row (RED artifacts re-run, they don't roll
 *  stages back), so it is deliberately absent.
 *
 *  It maps onto IDENTITIES, not paths, and that is the whole reason this
 *  guard ships in the same phase as the re-key. The obvious fix for the flat
 *  layout — pointing the shorthand at the project-level spelling — breaks the
 *  command outright while the table is keyed on paths: nothing matches,
 *  `cascadeFor()` returns null, and every invocation refuses. Naming the
 *  identity is the fix one level up, and it is layout-blind by construction.
 *
 *  The flat-era names (`prd.md` / `design.md` / `plan.md`) are no longer
 *  listed here — they are real `project-level` spellings, so the reverse
 *  index resolves them under BOTH layouts (R-4). Every pre-migration
 *  `decisions/` report, todo and in-flight session says `--touched
 *  design.md`, and refusing those would silently leave stale gate flags
 *  standing over a rewritten artifact. */
/** A Map, not an object literal, because the key is raw user input: on a
 *  plain object `--touched constructor` (or `toString`, or `valueOf`) reaches
 *  the prototype chain and hands back a FUNCTION where an `ArtifactKind` is
 *  expected. Nothing downstream currently mistakes one for a cascade row, so
 *  today that resolves to a refusal by luck rather than by rule — and the
 *  next reader of `kind` has no reason to expect it. A Map has no prototype
 *  keys to reach. */
const STAGE_SHORTHAND = new Map<string, ArtifactKind>([
  ["prd", { kind: "agent", stage: "prd" }],
  ["design", { kind: "agent", stage: "design" }],
  ["plan", { kind: "agent", stage: "plan" }],
]);

/** The shorthands above, for the CLI's containment check — which must skip
 *  exactly the inputs this resolves and no others. `commands/revise.ts` kept
 *  its own `new Set(["prd","design","plan"])`; a fourth shorthand added here
 *  would have been resolved by `cascadeFor` and then refused there as a
 *  cross-workstream path, which reads as the command rejecting its own
 *  documented input. */
export const STAGE_SHORTHAND_NAMES: readonly string[] = [...STAGE_SHORTHAND.keys()];

/** Cascade row for a touched path, or null.
 *
 *  Resolves the touched string to an `ArtifactKind` first — accepting BOTH
 *  layouts' spellings, so `prd/agent.md` and `prd.md` name the same PRD —
 *  then matches that identity against the table. It takes no layout parameter
 *  and wants none: a user typing `--touched design.md` in a folder-layout
 *  repo means the design doc, and a resolver that consulted the repo's layout
 *  would refuse them (R-4).
 *
 *  Matches the doc-set-relative key (`prd/agent.md`), a root-artifact
 *  basename (`expectations.md`), a longer path ending in either, or the bare
 *  stage shorthand (`prd`). An AMBIGUOUS name refuses rather than guessing: a
 *  bare `agent.md` belongs to no single stage, so the reverse index owns no
 *  such key and this returns null. Refusing is recoverable — the user
 *  re-types with the stage — while resolving to the wrong row silently leaves
 *  stale gate flags standing over a rewritten artifact, which nothing
 *  downstream can detect.
 *
 *  The human-facing companions resolve to real identities when fully spelled
 *  and still never cascade: the table has no row for them, so refreshing a
 *  digest or a critique cannot reset a gate flag. */
export function cascadeFor(touched: string): CascadeEntry | null {
  const norm = touched.replace(/\\/g, "/").replace(/\/+$/, "");
  const segs = norm.split("/").filter((s) => s !== "");
  const last1 = segs[segs.length - 1] ?? "";
  const last2 = segs.slice(-2).join("/");
  // Longest first: `prd/agent.md` must beat the ambiguous bare `agent.md`.
  const kind =
    (segs.length === 1 ? STAGE_SHORTHAND.get(norm) : undefined) ??
    exactly(last2) ??
    exactly(last1);
  if (!kind) return null;
  const id = artifactKindIdentity(kind);
  return CASCADE_TABLE.find((e) => artifactKindIdentity(e.artifact) === id) ?? null;
}

/** The reverse lookup, narrowed back to an EXACT spelling.
 *
 *  `pathToArtifactKind` lowercases its keys, deliberately and for this very
 *  surface — but folding case here would make `--touched PLAN.md` resolve to
 *  the plan artifact, and `PLAN.md` is devx's own backlog: the single most
 *  confusable name in any devx repo, sitting beside `plan.md` in the doc set
 *  under `project-level`. A user who edited the backlog and reached for
 *  `devx revise` would silently roll the workstream back to stage `plan` and
 *  clear `plan_verified` + `evals_red`, with nothing downstream able to tell.
 *
 *  So the resolved kind must spell the input back, under one layout or the
 *  other. That is what keeps every input `main` accepted resolving
 *  identically while the project-level names newly resolve — and what keeps
 *  a near-miss a refusal, which is recoverable, rather than a wrong cascade,
 *  which is not. */
function exactly(rel: string): ArtifactKind | null {
  const kind = pathToArtifactKind(rel);
  if (!kind) return null;
  return DOCS_LAYOUTS.some((l) => artifactRel(l, kind) === rel) ? kind : null;
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
