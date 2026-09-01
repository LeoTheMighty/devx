// RED step-body locking — "fix the code, not the eval."
//
// Ported from mycase/8am-harness #59 play 1, the constitution-level one.
//
// The RED gate's whole claim is that an eval was watched failing for the
// right reason BEFORE any code existed to pass it. That claim is worth
// exactly as much as the eval's immutability afterwards: an eval quietly
// softened during implementation turns a green run into a tautology, and
// nothing downstream can tell the difference. Before this module the only
// protection was instruction-level — "don't weaken the eval" in a skill body
// — which is a request, not a guard.
//
// Three layers, matching the outline guard's proven shape:
//
//   L1 (write-time)  PreToolUse hook → evalsGuardDecision()
//   L2 (gate-time)   Gate 4 stamps each eval's step-body sha256 into
//                    gate_status.red_eval_shas
//   L3 (verify-time) verifyStepBodies() FAILs a body that moved under a
//                    stamp, naming the eval
//
// What stays writable while locked: the RESULT OF RECORD. An eval's Status /
// Last-run / Runs rows are how a run is recorded at all — freezing those
// would freeze the gate itself. Only the step body is locked, and the split
// between them is mechanical (`isResultOfRecordLine`), not a judgment call
// made per edit.
//
// Pure: no I/O, no clock. Callers read files and gate_status.
//
// Spec: docs/CONFIG.md §15; upstream rationale in mycase/8am-harness #59.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Step body vs result of record
// ---------------------------------------------------------------------------

/** Field names an eval carries as its result of record — writable while the
 *  eval is locked, because they are how a run gets recorded. Matched on the
 *  line's leading `**Field:**` / `Field:` marker, case-insensitively. */
const RESULT_FIELDS = ["status", "last run", "last-run", "run", "runs", "result", "verdict"];

const RESULT_LINE_RE = new RegExp(
  `^\\s*(?:[-*+]\\s*)?\\**\\s*(${RESULT_FIELDS.join("|")})\\s*\\**\\s*:`,
  "i",
);

/** A row of the Runs table (`| 2026-08-31 | RED | … |`) — result of record. */
const RUNS_ROW_RE = /^\s*\|/;

/** True when a line records the outcome of a run rather than defining the
 *  eval's steps. */
export function isResultOfRecordLine(line: string): boolean {
  return RESULT_LINE_RE.test(line) || RUNS_ROW_RE.test(line);
}

/**
 * Reduce an eval artifact to its step body: the part the RED gate's claim
 * rests on. Result-of-record lines are dropped; whitespace is normalized so
 * a reflow, a trailing space, or a CRLF checkout never reads as a semantic
 * change (which would make the lock cry wolf and get switched off).
 */
export function stepBody(md: string): string {
  return md
    .split(/\r?\n/)
    .filter((l) => !isResultOfRecordLine(l))
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** sha256 of an eval's step body — the value Gate 4 stamps. */
export function stepBodySha(md: string): string {
  return createHash("sha256").update(stepBody(md), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Stamping and verification
// ---------------------------------------------------------------------------

/** `gate_status.red_eval_shas` — eval path (workstream-relative) → sha256. */
export type RedEvalShas = Record<string, string>;

/** Stamp every eval's step body. Called by Gate 4 on a PASS. */
export function stampEvalShas(evals: Record<string, string>): RedEvalShas {
  const out: RedEvalShas = {};
  for (const [rel, md] of Object.entries(evals)) out[rel] = stepBodySha(md);
  return out;
}

export interface StepBodyFinding {
  kind: "moved" | "missing" | "unstamped";
  evalPath: string;
  message: string;
}

/**
 * Compare stamped shas against the evals on disk now.
 *
 * `moved`     — a locked step body changed. This is the failure the whole
 *               module exists for.
 * `missing`   — a stamped eval is gone. Deleting an eval out from under a
 *               RED stamp is the same class of move as editing it.
 * `unstamped` — an eval exists that Gate 4 never stamped. Advisory: it is
 *               how a grandfathered workstream looks, and how a legitimately
 *               new eval looks before its gate re-runs.
 */
export function verifyStepBodies(
  stamped: RedEvalShas,
  current: Record<string, string>,
): StepBodyFinding[] {
  const findings: StepBodyFinding[] = [];
  for (const [rel, sha] of Object.entries(stamped)) {
    if (!(rel in current)) {
      findings.push({
        kind: "missing",
        evalPath: rel,
        message: `${rel} was stamped by the RED gate and is now absent — an eval cannot leave under its own stamp`,
      });
      continue;
    }
    const now = stepBodySha(current[rel]);
    if (now !== sha) {
      findings.push({
        kind: "moved",
        evalPath: rel,
        message: `${rel} step body changed under a RED stamp (${sha.slice(0, 12)} → ${now.slice(0, 12)}) — fix the code, not the eval; re-run \`devx gate evals\` if the expectation genuinely changed`,
      });
    }
  }
  for (const rel of Object.keys(current)) {
    if (!(rel in stamped)) {
      findings.push({
        kind: "unstamped",
        evalPath: rel,
        message: `${rel} carries no RED stamp — re-run \`devx gate evals\` to bring it under the lock`,
      });
    }
  }
  return findings;
}

/** True when findings should fail a verification. `unstamped` never blocks. */
export const blocksVerification = (f: readonly StepBodyFinding[]): boolean =>
  f.some((x) => x.kind === "moved" || x.kind === "missing");

// ---------------------------------------------------------------------------
// L1 — the write-time guard
// ---------------------------------------------------------------------------

const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

/** Repo-relative-ish match for a RED eval artifact: an `E-*` file inside an
 *  `evals` directory. Mirrors the outline guard's segment-anchored style so
 *  an absolute path from Edit/Write classifies the same as a diff name. */
export function isEvalArtifactPath(path: string): boolean {
  const segs = path.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
  if (segs.length < 2) return false;
  const base = segs[segs.length - 1];
  if (segs[segs.length - 2] !== "evals") return false;
  // The gate's own report is not an eval.
  if (/^RED-report\.md$/i.test(base)) return false;
  return /^E-/.test(base);
}

export interface EvalsGuardDecision {
  deny: boolean;
  reason?: string;
}

export interface EvalsGuardInput {
  /** The PreToolUse payload. */
  payload: unknown;
  /** Whether the workstream owning the target is currently RED-locked
   *  (`gate_status.evals_red === true`). Resolved by the caller — this
   *  module does no I/O. */
  evalsRed: boolean;
}

/**
 * Decide a PreToolUse payload against the RED lock.
 *
 * Denies an edit to a locked eval artifact. Unknown or malformed input
 * allows: like the outline guard, this must never brick unrelated tool use,
 * and a guard that fails closed on a shape it did not expect gets disabled.
 *
 * NOTE the deliberate asymmetry with the outline guard — this one is scoped
 * by STATE (`evals_red`), not by path alone. An eval is fully writable while
 * it is being authored; it locks only once a gate has certified it failing
 * for the right reason, and unlocks when that gate is legitimately re-run.
 */
export function evalsGuardDecision(input: EvalsGuardInput): EvalsGuardDecision {
  if (!input.evalsRed) return { deny: false };
  const p = input.payload;
  if (typeof p !== "object" || p === null) return { deny: false };
  const { tool_name, tool_input } = p as {
    tool_name?: unknown;
    tool_input?: unknown;
  };
  const tool = typeof tool_name === "string" ? tool_name : "";
  if (!EDIT_TOOLS.has(tool)) return { deny: false };
  const inp =
    typeof tool_input === "object" && tool_input !== null
      ? (tool_input as Record<string, unknown>)
      : {};
  const target =
    (typeof inp.file_path === "string" && inp.file_path) ||
    (typeof inp.notebook_path === "string" && inp.notebook_path) ||
    "";
  if (target === "" || !isEvalArtifactPath(target)) return { deny: false };

  return {
    deny: true,
    reason:
      `${tool} on '${target}' denied: this eval is RED-locked. The gate ` +
      "certified it failing for the right reason, and an eval edited during " +
      "implementation turns a green run into a tautology. Fix the code, not " +
      "the eval. If the expectation itself genuinely changed, say so and " +
      "re-run `devx gate evals <hash>` — that is the sanctioned path, and it " +
      "re-stamps the body. Result-of-record stamps (Status / Last run / Runs " +
      "rows) stay writable and do not need this.",
  };
}
