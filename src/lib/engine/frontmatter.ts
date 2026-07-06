// Engine-aware spec-frontmatter read/write (v2e101).
//
// The v2 engine extends the v1 plan-spec frontmatter with nested state
// (`stage:`, `gate_status:` — a 4-flag map, `outcome:` — a 2-field map;
// see v2/02-engine.md §3). The existing frontmatter helpers in the repo
// are all flat-scalar readers/splicers and can't round-trip nested maps:
//
//   - merge-gate.ts readFrontmatter        — 3 known scalars, regex read-only
//   - plan/validate-emit.ts parseFrontmatterValue — 1 scalar, read-only
//   - devx/claim.ts updateSpecForClaim     — line-splice of `status:`/`owner:`
//
// Rather than duplicate a fourth hand-rolled parser that ALSO grows nested-
// map support, this module wraps eemeli/yaml's `parseDocument` — the exact
// engine config-io.ts already uses for comment-preserving config writes.
// parseDocument round-trips comments, key order, and unknown fields through
// a write, which is the AC-load-bearing property ("round-trip preserves
// unknown fields + status-log body"). The body (everything after the closing
// `---`) is never touched — only the frontmatter block is re-serialized, and
// only when a patch is applied.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §3 (workstream anatomy + frontmatter shape)

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const STAGES = [
  "intake",
  "prd",
  "design",
  "plan",
  "red",
  "executing",
  "done",
  "retired",
] as const;
export type Stage = (typeof STAGES)[number];

/** Ordinal for stage-rollback comparisons (revise never advances a stage). */
export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export const GATE_FLAGS = [
  "prd_validated",
  "design_verified",
  "plan_verified",
  "evals_red",
] as const;
export type GateFlag = (typeof GATE_FLAGS)[number];

export type GateStatus = Record<GateFlag, boolean>;

export interface Outcome {
  status: string | null;
  measure_by: string | null;
}

export interface EngineState {
  hash: string | null;
  type: string | null;
  status: string | null;
  stage: Stage | null;
  enteredAt: string | null;
  gateStatus: GateStatus;
  outcome: Outcome;
  /** Repo-relative workstream dir (`_devx/workstreams/<slug>`), if recorded. */
  workstream: string | null;
  /** `blocked_by:` entries — the Gate 1 INTERVIEW-blocker signal. */
  blockedBy: string[];
}

export interface EnginePatch {
  stage?: Stage;
  enteredAt?: string;
  gateStatus?: Partial<GateStatus>;
  outcome?: Partial<Outcome>;
  workstream?: string;
  /** Outcome-loop lineage fields (v2o101, v2/02-engine.md §4.10):
   *  `successor:` on the restarted (old) spec; `learns_from:` on the
   *  successor (new) spec; `superseded_by:` on the old spec. */
  successor?: string;
  learnsFrom?: string;
  supersededBy?: string;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Split a spec into `{ fmText, delim, body }`: fmText is the raw YAML
 * between the opening and closing `---`; delim is the newline that follows
 * the closing `---` ("" when the file ends right there); body is everything
 * after it. `fmText + delim + body` concatenated back around the fences
 * reproduces the input byte-for-byte. Returns null when the file has no
 * frontmatter block. CRLF-tolerant on the delimiters.
 */
export function splitFrontmatter(
  content: string,
): { fmText: string; delim: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
  if (!m) return null;
  return {
    fmText: m[1],
    delim: m[2],
    body: content.slice(m[0].length),
  };
}

/** Reassemble a splitFrontmatter() result with a replacement fm block. */
function joinFrontmatter(
  newFmText: string,
  split: { delim: string; body: string },
): string {
  const delim = split.delim === "" && split.body === "" ? "\n" : split.delim;
  return `---\n${newFmText}\n---${delim}${split.body}`;
}

function emptyGateStatus(): GateStatus {
  return {
    prd_validated: false,
    design_verified: false,
    plan_verified: false,
    evals_red: false,
  };
}

/**
 * Read the engine-relevant state out of a spec. Defensive by construction:
 * missing keys yield defaults (gate flags false, stage null, outcome null),
 * malformed values are coerced conservatively (only literal `true` counts
 * as a passed gate — a gate flag must fail closed).
 */
export function readEngineState(content: string): EngineState {
  const state: EngineState = {
    hash: null,
    type: null,
    status: null,
    stage: null,
    enteredAt: null,
    gateStatus: emptyGateStatus(),
    outcome: { status: null, measure_by: null },
    workstream: null,
    blockedBy: [],
  };
  const split = splitFrontmatter(content);
  if (!split) return state;

  let parsed: unknown;
  try {
    parsed = parseDocument(split.fmText).toJS() as unknown;
  } catch {
    return state;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return state;
  }
  const fm = parsed as Record<string, unknown>;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  state.hash = str(fm.hash);
  state.type = str(fm.type);
  state.status = str(fm.status);
  state.workstream = str(fm.workstream);
  state.enteredAt = str(fm.entered_at);

  const stage = str(fm.stage);
  if (stage && (STAGES as readonly string[]).includes(stage)) {
    state.stage = stage as Stage;
  }

  if (fm.gate_status && typeof fm.gate_status === "object") {
    const gs = fm.gate_status as Record<string, unknown>;
    for (const flag of GATE_FLAGS) {
      state.gateStatus[flag] = gs[flag] === true;
    }
  }

  if (fm.outcome && typeof fm.outcome === "object") {
    const oc = fm.outcome as Record<string, unknown>;
    state.outcome.status = str(oc.status);
    state.outcome.measure_by = str(oc.measure_by);
  }

  if (Array.isArray(fm.blocked_by)) {
    state.blockedBy = fm.blocked_by
      .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
      .map((x) => String(x).trim())
      .filter((x) => x !== "");
  } else if (typeof fm.blocked_by === "string" && fm.blocked_by.trim() !== "") {
    state.blockedBy = [fm.blocked_by.trim()];
  }

  return state;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Apply an engine patch to a spec's frontmatter, preserving every unknown
 * field, the key order, YAML comments, and the entire body byte-for-byte.
 * Only the keys named in the patch are touched; `gate_status:` /
 * `outcome:` maps are created if absent and merged key-wise if present.
 *
 * Throws when the spec has no frontmatter block — every engine consumer
 * resolves the spec through findSpecForHashIn() first, so a missing block
 * is a corrupted file, not an expected state.
 */
export function applyEnginePatch(content: string, patch: EnginePatch): string {
  const split = splitFrontmatter(content);
  if (!split) {
    throw new Error("applyEnginePatch: spec has no frontmatter block");
  }
  const doc = parseDocument(split.fmText);
  if (doc.errors.length > 0) {
    throw new Error(
      `applyEnginePatch: frontmatter YAML parse failed: ${doc.errors[0].message}`,
    );
  }

  if (patch.stage !== undefined) doc.setIn(["stage"], patch.stage);
  if (patch.enteredAt !== undefined) doc.setIn(["entered_at"], patch.enteredAt);
  if (patch.workstream !== undefined) {
    doc.setIn(["workstream"], patch.workstream);
  }
  if (patch.gateStatus) {
    for (const flag of GATE_FLAGS) {
      const v = patch.gateStatus[flag];
      if (v !== undefined) doc.setIn(["gate_status", flag], v);
    }
  }
  if (patch.outcome) {
    if (patch.outcome.status !== undefined) {
      doc.setIn(["outcome", "status"], patch.outcome.status);
    }
    if (patch.outcome.measure_by !== undefined) {
      doc.setIn(["outcome", "measure_by"], patch.outcome.measure_by);
    }
  }
  if (patch.successor !== undefined) doc.setIn(["successor"], patch.successor);
  if (patch.learnsFrom !== undefined) {
    doc.setIn(["learns_from"], patch.learnsFrom);
  }
  if (patch.supersededBy !== undefined) {
    doc.setIn(["superseded_by"], patch.supersededBy);
  }

  return joinFrontmatter(docToFmText(doc), split);
}

/**
 * Serialize a frontmatter Document back to text. `lineWidth: 0` disables
 * yaml's default 80-column folding — a long v1-authored scalar (`title:`,
 * `owner:`) must survive an engine write byte-identical, both for diff
 * hygiene and because the v1 line-splicing parsers (claim.ts, merge-gate)
 * read those lines positionally. The trailing newline is trimmed so the
 * closing `---` lands flush.
 */
function docToFmText(doc: ReturnType<typeof parseDocument>): string {
  return doc.toString({ lineWidth: 0 }).replace(/\n$/, "");
}

/**
 * Initialize the engine frontmatter block on a spec that may not have it
 * yet (the workstream-new create-or-extend path). Adds ONLY missing keys:
 * an in-flight workstream re-run must never reset live gate flags or
 * regress the stage. Returns { content, changed }.
 */
export function ensureEngineFrontmatter(
  content: string,
  init: { stage: Stage; enteredAt: Stage; workstream: string },
): { content: string; changed: boolean } {
  const split = splitFrontmatter(content);
  if (!split) {
    throw new Error("ensureEngineFrontmatter: spec has no frontmatter block");
  }
  const state = readEngineState(content);
  const doc = parseDocument(split.fmText);
  if (doc.errors.length > 0) {
    throw new Error(
      `ensureEngineFrontmatter: frontmatter YAML parse failed: ${doc.errors[0].message}`,
    );
  }

  let changed = false;
  if (state.stage === null) {
    doc.setIn(["stage"], init.stage);
    changed = true;
  }
  if (state.enteredAt === null) {
    doc.setIn(["entered_at"], init.enteredAt);
    changed = true;
  }
  if (!doc.hasIn(["gate_status"])) {
    for (const flag of GATE_FLAGS) doc.setIn(["gate_status", flag], false);
    changed = true;
  } else {
    for (const flag of GATE_FLAGS) {
      if (!doc.hasIn(["gate_status", flag])) {
        doc.setIn(["gate_status", flag], false);
        changed = true;
      }
    }
  }
  if (!doc.hasIn(["outcome"])) {
    doc.setIn(["outcome", "status"], null);
    doc.setIn(["outcome", "measure_by"], null);
    changed = true;
  }
  if (state.workstream === null) {
    doc.setIn(["workstream"], init.workstream);
    changed = true;
  }

  if (!changed) return { content, changed: false };
  return { content: joinFrontmatter(docToFmText(doc), split), changed: true };
}

// ---------------------------------------------------------------------------
// Spec resolution
// ---------------------------------------------------------------------------

/** Same hash shape as merge-gate.ts / plan-helper.ts. */
export const HASH_RE = /^[a-z0-9]{3,12}$/i;

/**
 * Locate a spec by hash under `<repoRoot>/<specDir>/`. Mirrors
 * merge-gate.ts findSpecForHash but parameterized on the spec dir —
 * workstream specs are `plan/plan-<hash>-*.md`, not `dev/dev-<hash>-*.md`.
 */
export function findSpecForHashIn(
  repoRoot: string,
  specDir: string,
  hash: string,
): string | null {
  const dir = join(repoRoot, specDir);
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(`${specDir}-${hash}-`) && name.endsWith(".md")) {
      return join(dir, name);
    }
  }
  return null;
}
