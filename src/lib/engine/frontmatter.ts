// Engine-aware spec-frontmatter read/write (v2e101).
//
// The v2 engine extends the v1 plan-spec frontmatter with nested state
// (`stage:`, `gate_status:` — a 4-flag map, `gate_verdicts:` — a 4-key
// D-9 verdict map (hfi102), `outcome:` — a 2-field map; see
// v2/02-engine.md §3). The existing frontmatter helpers in the repo
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
import { isMap, isScalar, parseDocument } from "yaml";

import { VERDICTS, type Verdict } from "./verdict.js";

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

/** Gate-name keys for the `gate_verdicts:` sibling map (hfi102). Named after
 *  the gates themselves (the resolved 2026-07-24 design decision), not the
 *  boolean flags — `coverage` runs twice (design/plan mode), so the map keys
 *  by evaluated surface. */
export const GATE_KEYS = ["prd", "design", "plan", "evals"] as const;
export type GateKey = (typeof GATE_KEYS)[number];

/** Last evaluated D-9 verdict per gate; null ≡ never evaluated (or cleared
 *  by `devx revise`). Absent map reads as all-null. */
export type GateVerdicts = Record<GateKey, Verdict | null>;

export const FLAG_TO_GATE_KEY: Record<GateFlag, GateKey> = {
  prd_validated: "prd",
  design_verified: "design",
  plan_verified: "plan",
  evals_red: "evals",
};

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
  gateVerdicts: GateVerdicts;
  outcome: Outcome;
  /** Repo-relative workstream dir (`_devx/workstreams/<slug>`), if recorded. */
  workstream: string | null;
  /** `blocked_by:` entries — the Gate 1 INTERVIEW-blocker signal. */
  blockedBy: string[];
  /** `plan:` — dev specs point back at their workstream dir with this key
   *  (plan specs use `workstream:` for the same pointer). */
  plan: string | null;
  /** `phase:` — 1-based plan phase an emitted dev spec implements. Null when
   *  absent or not a positive integer (pre-9b9be5 specs are grandfathered:
   *  no phase, no shipped-green deferral). */
  phase: number | null;
}

export interface EnginePatch {
  stage?: Stage;
  enteredAt?: string;
  gateStatus?: Partial<GateStatus>;
  /** `null` clears a gate's verdict back to never-evaluated (revise path). */
  gateVerdicts?: Partial<GateVerdicts>;
  outcome?: Partial<Outcome>;
  workstream?: string;
  /** Outcome-loop lineage fields (v2o101, v2/02-engine.md §4.10):
   *  `successor:` on the restarted (old) spec; `learns_from:` on the
   *  successor (new) spec; `superseded_by:` on the old spec. */
  successor?: string;
  learnsFrom?: string;
  supersededBy?: string;
  /**
   * Blocking edges, written to the canonical underscore key in inline-array
   * form (`blocked_by: [aaa111, bbb222]` — the spelling every shipped spec
   * in this repo uses). Added at sgr106 so `devx graph backfill` completes
   * edges through the engine's own splice instead of a parallel writer.
   *
   * Entries are written VERBATIM: the backfill passes the existing raw list
   * plus the additions, so a spec-path-shaped blocker
   * (`dev/dev-aaa111-….md`) survives a completion pass unrewritten.
   *
   * Setting this also DELETES the hyphenated `blocked-by:` drift key. Both
   * spellings live at once in the wild and readers union them (graph
   * model.ts), so leaving the old key behind would re-warn forever about an
   * edge the canonical write just absorbed. Callers therefore MUST fold the
   * hyphen key's entries into the value they pass — the deletion is a
   * re-spelling, never an edge drop.
   */
  blocked_by?: string[];
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

function emptyGateVerdicts(): GateVerdicts {
  return { prd: null, design: null, plan: null, evals: null };
}

/**
 * The verbatim source text of a top-level PLAIN (unquoted) scalar, or null
 * when the key is absent, quoted, or not a scalar at all. Lets a field whose
 * YAML-inferred type is wrong (a numeric-looking hash) be read as the bytes
 * the author actually wrote, without the round-trip hazards of coercing the
 * parsed value back to a string.
 */
function plainScalarSource(
  doc: ReturnType<typeof parseDocument>,
  key: string,
): string | null {
  const node = doc.getIn([key], true);
  if (!isScalar(node)) return null;
  if (node.type !== "PLAIN" || typeof node.source !== "string") return null;
  const raw = node.source.trim();
  return raw === "" ? null : raw;
}

/**
 * Read the engine-relevant state out of a spec. Defensive by construction:
 * missing keys yield defaults (gate flags false, stage null, outcome null),
 * malformed values are coerced conservatively (only literal `true` counts
 * as a passed gate — a gate flag must fail closed).
 *
 * Soft on purpose, and that is now a LOCKED decision (D-13, debug-9f24c7):
 * an unparseable block yields a best-effort state rather than throwing, so a
 * half-edited spec can never crash a gate or a board render. The cost is that
 * "soft-degraded" and "genuinely records nothing" look identical HERE — so
 * every caller with an output channel is required to consult
 * `frontmatterParseError(content)` and say "unreadable" instead of asserting
 * the empty state it just read. Wired at `devx next` (a
 * `frontmatter-unreadable` drift row), `devx status`, and every gate (via
 * `ResolvedWorkstream.frontmatterError`). Do not change this return shape
 * without re-surveying the consumers listed in D-13.
 */
export function readEngineState(content: string): EngineState {
  const state: EngineState = {
    hash: null,
    type: null,
    status: null,
    stage: null,
    enteredAt: null,
    gateStatus: emptyGateStatus(),
    gateVerdicts: emptyGateVerdicts(),
    outcome: { status: null, measure_by: null },
    workstream: null,
    blockedBy: [],
    plan: null,
    phase: null,
  };
  const split = splitFrontmatter(content);
  if (!split) return state;

  let doc: ReturnType<typeof parseDocument>;
  let parsed: unknown;
  try {
    doc = parseDocument(split.fmText);
    parsed = doc.toJS() as unknown;
  } catch {
    return state;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return state;
  }
  const fm = parsed as Record<string, unknown>;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  // `hash:` is read from the RAW scalar source, not from toJS(). A spec hash
  // is 6 hex chars, and an all-digit one (`hash: 620337`) is a legal YAML
  // integer — toJS() hands back a number, which `str()` rejects, so the spec
  // reads as hashless. Coercing with String() would fix that one case and
  // silently CORRUPT others: `012345` parses to 12345 and `0x1234` to 4660,
  // either of which would resolve to a different spec than the file it came
  // from. The plain scalar's own bytes are the only lossless answer. Quoted
  // hashes take the normal path — toJS() already returns their exact text.
  // Found by the AC-2 spec-frontmatter canary (debug-9f24c7).
  state.hash = plainScalarSource(doc, "hash") ?? str(fm.hash);
  state.type = str(fm.type);
  state.status = str(fm.status);
  state.workstream = str(fm.workstream);
  state.enteredAt = str(fm.entered_at);
  state.plan = str(fm.plan);
  if (typeof fm.phase === "number" && Number.isInteger(fm.phase) && fm.phase > 0) {
    state.phase = fm.phase;
  } else if (typeof fm.phase === "string" && /^[1-9]\d*$/.test(fm.phase.trim())) {
    state.phase = Number(fm.phase.trim());
  }

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

  if (fm.gate_verdicts && typeof fm.gate_verdicts === "object") {
    const gv = fm.gate_verdicts as Record<string, unknown>;
    for (const key of GATE_KEYS) {
      const v = gv[key];
      state.gateVerdicts[key] =
        typeof v === "string" && (VERDICTS as readonly string[]).includes(v)
          ? (v as Verdict)
          : null;
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

/**
 * The first YAML error in a spec's frontmatter block, or null when it parses.
 *
 * `readEngineState` deliberately fails SOFT — a half-edited spec must not
 * crash a gate — which means an unparseable block reads as "no keys at all"
 * and every edge, status and pointer in it silently disappears. That is the
 * right posture for a reader and a trap for a WRITER: `applyEnginePatch`
 * throws on the same input, so a caller planning a write needs to know the
 * difference between "this spec records nothing" and "this spec is
 * unreadable". Added at sgr106, where backfill found two shipped specs whose
 * unquoted `title:` contains a colon.
 *
 * Returns null for a spec with no frontmatter block at all — that is a
 * different condition, and `splitFrontmatter` already reports it.
 */
export function frontmatterParseError(content: string): string | null {
  const split = splitFrontmatter(content);
  if (!split) return null;
  try {
    const doc = parseDocument(split.fmText);
    return doc.errors.length > 0 ? doc.errors[0].message.split("\n")[0] : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Apply an engine patch to a spec's frontmatter, preserving every unknown
 * field, the key order, YAML comments, and the entire body byte-for-byte.
 * Only the keys named in the patch are touched; `gate_status:` /
 * `outcome:` maps are created if absent and merged key-wise if present. The
 * one exception is `blocked_by`, which also removes the hyphenated
 * `blocked-by:` spelling of itself (see EnginePatch.blocked_by).
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
  if (patch.gateVerdicts) {
    // A hand-added bare `gate_verdicts:` (YAML null) or non-map value would
    // make setIn throw and brick every gate/revise write until hand-fixed.
    // The read side already treats those shapes as all-null, so replacing
    // the degenerate node with a fresh map loses nothing.
    const existing = doc.getIn(["gate_verdicts"], true);
    if (existing !== undefined && !isMap(existing)) {
      doc.deleteIn(["gate_verdicts"]);
    }
    for (const key of GATE_KEYS) {
      const v = patch.gateVerdicts[key];
      if (v !== undefined) doc.setIn(["gate_verdicts", key], v);
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
  if (patch.blocked_by !== undefined) {
    // `createNode(..., {flow:true})` rather than a bare array so the value
    // renders as `blocked_by: [a, b]` — the form every hand-authored and
    // emitted spec already carries. A block list would round-trip fine but
    // would rewrite the shape of every spec a completion pass touches.
    doc.setIn(["blocked_by"], doc.createNode(patch.blocked_by, { flow: true }));
    // See EnginePatch.blocked_by: the drift key's entries are already folded
    // into the value above, so this is a re-spelling, not a deletion.
    if (doc.hasIn(["blocked-by"])) doc.deleteIn(["blocked-by"]);
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
 *
 * `flowCollectionPadding: false` (sgr106) emits `[a, b]`, which is how every
 * hand-authored and emitted `blocked_by:` in this repo is spelled. yaml's
 * default re-pads to `[ a, b ]`, so WITHOUT this any patch — a gate flag, a
 * stage bump — silently reformats an untouched `blocked_by:` list on its way
 * past. Style churn in a diff that is supposed to show one flag flipping is
 * how a reviewer learns to skim.
 */
function docToFmText(doc: ReturnType<typeof parseDocument>): string {
  return doc
    .toString({ lineWidth: 0, flowCollectionPadding: false })
    .replace(/\n$/, "");
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

/** The backlog spec types whose dirs a bare hash can resolve into —
 *  CLAUDE.md "Spec file convention". `focus-group/personas` (init-write's
 *  extra scaffold dir) is not a spec type and is deliberately absent. */
export const SPEC_TYPE_DIRS: ReadonlyArray<string> = [
  "dev",
  "plan",
  "test",
  "debug",
  "focus",
  "learn",
  "qa",
];

export interface SpecResolution {
  /** Absolute path to the spec file. */
  path: string;
  /** The spec type == the dir it was found under (`dev`, `debug`, …). */
  type: string;
}

/** Thrown when the same hash resolves in more than one type dir. Hashes are
 *  unique by convention (6 random hex chars); a collision means a
 *  hand-authored duplicate, and picking one silently would gate the wrong
 *  spec. */
export class AmbiguousSpecHashError extends Error {
  constructor(
    public readonly hash: string,
    public readonly paths: ReadonlyArray<string>,
  ) {
    super(
      `hash '${hash}' resolves to ${paths.length} spec files (${paths.join(", ")}); ` +
        `spec hashes must be unique across type dirs`,
    );
    this.name = "AmbiguousSpecHashError";
  }
}

/**
 * Resolve a bare hash across every spec type dir (debug-6a913f). The single
 * type-aware resolution point for CLIs that take only a hash (`devx
 * merge-gate`, `devx split`, …) — per-command `dev/` hardcoding is the
 * regression class this replaces. Returns null when no dir has the hash;
 * throws AmbiguousSpecHashError on a cross-dir collision.
 */
export function findSpecForHashAnyType(
  repoRoot: string,
  hash: string,
): SpecResolution | null {
  const matches: SpecResolution[] = [];
  for (const type of SPEC_TYPE_DIRS) {
    const path = findSpecForHashIn(repoRoot, type, hash);
    if (path !== null) matches.push({ path, type });
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new AmbiguousSpecHashError(hash, matches.map((m) => m.path));
  }
  return matches[0];
}
