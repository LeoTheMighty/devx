// tour.json schema + validator (v2t101).
//
// The review tour is generated in three steps (v2/03-review-tour.md §2):
// gather (CLI, deterministic) → narrate (agent, judgment) → render (CLI,
// deterministic). This module is the contract between steps 2 and 3: the
// narrating agent emits tour.json, `devx tour validate` / `devx tour build`
// validate it here, and the agent retries on the typed errors this validator
// returns (same retry protocol as pr-body/merge-gate JSON contracts).
//
// The shape is the upstream code-review-tour tour.json model with two v2
// deltas (v2/03-review-tour.md §1):
//   • NO `mermaid` field on trails — v1 renders trail step tables only
//     (dropping ~1MB of inlined mermaid; O-1 tracks re-adding). The validator
//     REJECTS a mermaid key rather than ignoring it so the narrating agent
//     learns the contract instead of silently emitting dead weight.
//   • NO severity verdicts anywhere — the tour presents and points; judging
//     is the human's job. Any `severity`/`severities` key at any depth is a
//     typed error.
//
// Validation is hand-rolled (not ajv) for the same reason merge-gate
// hand-rolls its frontmatter read: we control both sides of the contract,
// the shape is small, and ajv is a devDependency we don't want in the
// runtime graph. `TOUR_JSON_SCHEMA` is the JSON-schema rendering of the same
// contract — shipped for documentation + the drift-pin test that asserts the
// schema object and the validator vocabularies never diverge (dvx107 move).
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md
// Design: v2/03-review-tour.md §1–2

// ---------------------------------------------------------------------------
// Canonical vocabularies
// ---------------------------------------------------------------------------

/** Change-map weight classes — honesty about what's skimmable. */
export const TOUR_WEIGHTS = [
  "core",
  "supporting",
  "mechanical",
  "tests",
] as const;
export type TourWeight = (typeof TOUR_WEIGHTS)[number];

/** Stop review priorities — drive the reading order + time-boxed line. */
export const TOUR_PRIORITIES = ["must", "should", "skim"] as const;
export type TourPriority = (typeof TOUR_PRIORITIES)[number];

/** The 4-flag attention vocabulary: ⚠ decision · 🔍 scrutinize · 💬 discussed
 *  · 🕳 gap. No severity verdicts — that's the whole point. */
export const TOUR_FLAGS = [
  "decision",
  "scrutinize",
  "discussed",
  "gap",
] as const;
export type TourFlag = (typeof TOUR_FLAGS)[number];

/** Trail step statuses. An edge that could not be grep-verified is narrated
 *  as a 🕳 `gap` flag in the step's note, not a distinct status — the step
 *  itself is still one of these three relative to the diff. */
export const TRAIL_STEP_STATUSES = ["new", "modified", "unchanged"] as const;
export type TrailStepStatus = (typeof TRAIL_STEP_STATUSES)[number];

// ---------------------------------------------------------------------------
// Typed tour shape
// ---------------------------------------------------------------------------

export interface TourMeta {
  /** PR / change title (usually the spec title). */
  title: string;
  /** Spec hash (e.g. "v2t101") — keys the tour directory + publish path. */
  hash: string;
  repo?: string;
  specPath?: string;
  base?: string;
  branch?: string;
  sha?: string;
  files?: number;
  additions?: number;
  deletions?: number;
  commits?: number;
}

export interface TourOrientation {
  /** What this change does and why — spec Goal cross-checked against what
   *  the code ACTUALLY does; discrepancies called out explicitly. Markdown. */
  summary: string;
  ci?: string;
  mergeable?: string;
  baseNote?: string;
  concurrent?: string;
  standingPriorities: string[];
  activatedPatterns?: string[];
  readingOrder: string;
  /** "~30 min: Stops 2, 5, Trail A, Blast Radius" — the must-priority path. */
  timeBoxed: string;
  /** Count of ⚠ / 🔍 / 💬 / 🕳 with a one-line index. */
  flagIndex: string;
}

export interface TourChangeMapRow {
  file: string;
  area?: string;
  weight: TourWeight;
  what?: string;
  stops: (string | number)[];
}

export interface TourDecision {
  id: string | number;
  decision: string;
  /** `path:line` — the UI auto-links it into the Total Diff. */
  where: string;
  implies?: string;
  alternative?: string;
}

export interface TourStopConnects {
  prev?: string;
  next?: string;
}

export interface TourStop {
  id: string | number;
  priority: TourPriority;
  title: string;
  flags: TourFlag[];
  files: string[];
  /** Markdown. Cite code as `path:line` — auto-linkified. */
  narration: string;
  connects?: TourStopConnects;
  /** Raw unified diff for exactly this stop's hunks. May be empty for
   *  doc-only stops. */
  diff: string;
}

export interface TourTrailStep {
  n: number;
  what: string;
  where?: string;
  status: TrailStepStatus;
  note?: string;
}

export interface TourTrail {
  id: string | number;
  name: string;
  /** Grep-verified call chain — every A-calls-B edge confirmed at the call
   *  site or the step's note carries 🕳. NO mermaid field (v1). */
  steps: TourTrailStep[];
}

export interface TourBlastSection {
  title: string;
  body: string;
}

export interface TourBlastRadius {
  sections: TourBlastSection[];
  /** Grep-verified list of call sites not in the diff, or absent when clean. */
  callersNotUpdated?: string;
  expectedMissing?: string;
}

export interface TourCoverageRow {
  stop: string | number;
  testedBy?: string;
  gaps?: string;
}

export interface TourCoverage {
  /** Seeded from the spec's acceptance criteria — the spec is the intent
   *  source; no external tracker exists (D-10). */
  rows: TourCoverageRow[];
  todos?: string;
  questions?: string;
}

export interface Tour {
  meta: TourMeta;
  /** COMPLETE unified diff — powers the Total Diff section + deep links. */
  fullDiff: string;
  orientation: TourOrientation;
  changeMap: TourChangeMapRow[];
  decisions: TourDecision[];
  stops: TourStop[];
  trails: TourTrail[];
  blastRadius: TourBlastRadius;
  coverage: TourCoverage;
}

// ---------------------------------------------------------------------------
// JSON-schema rendering (documentation + drift-pin)
// ---------------------------------------------------------------------------

/** JSON-schema object for tour.json. The hand-rolled validator below is the
 *  runtime authority; this object is shipped so the narrating agent can be
 *  shown the schema verbatim and so the drift-pin test can assert the two
 *  never diverge on vocabularies/required keys. */
export const TOUR_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "devx review tour",
  type: "object",
  additionalProperties: false,
  required: [
    "meta",
    "fullDiff",
    "orientation",
    "changeMap",
    "decisions",
    "stops",
    "trails",
    "blastRadius",
    "coverage",
  ],
  properties: {
    meta: {
      type: "object",
      required: ["title", "hash"],
      properties: {
        title: { type: "string", minLength: 1 },
        hash: { type: "string", minLength: 1 },
        repo: { type: "string" },
        specPath: { type: "string" },
        base: { type: "string" },
        branch: { type: "string" },
        sha: { type: "string" },
        files: { type: "number" },
        additions: { type: "number" },
        deletions: { type: "number" },
        commits: { type: "number" },
      },
    },
    fullDiff: { type: "string", minLength: 1 },
    orientation: {
      type: "object",
      required: [
        "summary",
        "standingPriorities",
        "readingOrder",
        "timeBoxed",
        "flagIndex",
      ],
      properties: {
        summary: { type: "string", minLength: 1 },
        ci: { type: "string" },
        mergeable: { type: "string" },
        baseNote: { type: "string" },
        concurrent: { type: "string" },
        standingPriorities: { type: "array", items: { type: "string" } },
        activatedPatterns: { type: "array", items: { type: "string" } },
        readingOrder: { type: "string" },
        timeBoxed: { type: "string" },
        flagIndex: { type: "string" },
      },
    },
    changeMap: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["file", "weight", "stops"],
        properties: {
          file: { type: "string", minLength: 1 },
          area: { type: "string" },
          weight: { enum: [...TOUR_WEIGHTS] },
          what: { type: "string" },
          stops: { type: "array", items: { type: ["string", "number"] } },
        },
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "decision", "where"],
        properties: {
          id: { type: ["string", "number"] },
          decision: { type: "string", minLength: 1 },
          where: { type: "string", minLength: 1 },
          implies: { type: "string" },
          alternative: { type: "string" },
        },
      },
    },
    stops: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "priority", "title", "flags", "files", "narration", "diff"],
        properties: {
          id: { type: ["string", "number"] },
          priority: { enum: [...TOUR_PRIORITIES] },
          title: { type: "string", minLength: 1 },
          flags: { type: "array", items: { enum: [...TOUR_FLAGS] } },
          files: { type: "array", items: { type: "string" } },
          narration: { type: "string", minLength: 1 },
          connects: {
            type: "object",
            properties: {
              prev: { type: "string" },
              next: { type: "string" },
            },
          },
          diff: { type: "string" },
        },
      },
    },
    trails: {
      type: "array",
      items: {
        type: "object",
        // NO mermaid property — v1 renders trail step tables only.
        additionalProperties: false,
        required: ["id", "name", "steps"],
        properties: {
          id: { type: ["string", "number"] },
          name: { type: "string", minLength: 1 },
          steps: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["n", "what", "status"],
              properties: {
                n: { type: "number" },
                what: { type: "string", minLength: 1 },
                where: { type: "string" },
                status: { enum: [...TRAIL_STEP_STATUSES] },
                note: { type: "string" },
              },
            },
          },
        },
      },
    },
    blastRadius: {
      type: "object",
      required: ["sections"],
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "body"],
            properties: {
              title: { type: "string", minLength: 1 },
              body: { type: "string" },
            },
          },
        },
        callersNotUpdated: { type: "string" },
        expectedMissing: { type: "string" },
      },
    },
    coverage: {
      type: "object",
      required: ["rows"],
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            required: ["stop"],
            properties: {
              stop: { type: ["string", "number"] },
              testedBy: { type: "string" },
              gaps: { type: "string" },
            },
          },
        },
        todos: { type: "string" },
        questions: { type: "string" },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export interface TourValidationError {
  /** JSON-pointer-ish path, e.g. "stops[2].priority". "" = document root. */
  path: string;
  message: string;
}

/** Keys that must not appear ANYWHERE in a tour — the tour presents and
 *  points; judging is the human's job (v2/03-review-tour.md §1 "No severity
 *  verdicts"). */
const FORBIDDEN_KEY_RE = /^severit(y|ies)$/i;

/**
 * Validate a parsed tour.json candidate. Returns `[]` when valid; otherwise
 * a list of typed errors the narrating agent uses to fix + retry. Collects
 * ALL errors in one pass (not fail-fast) so one retry round-trip fixes
 * everything. (One deliberate exception: stop-id cross-ref checks are
 * suppressed while ZERO stop ids parsed — flagging every changeMap/coverage
 * ref as "unknown" when the real problem is the stops array would be
 * noise; that shape costs one extra retry round-trip.)
 */
export function validateTour(json: unknown): TourValidationError[] {
  const errors: TourValidationError[] = [];
  const err = (path: string, message: string): void => {
    errors.push({ path, message });
  };

  if (!isRecord(json)) {
    err("", `tour must be a JSON object (got ${typeName(json)})`);
    return errors;
  }

  // Forbidden vocabulary anywhere in the document — checked first so a
  // severity-shaped tour gets the "no severities" message even when the rest
  // of the shape is broken too.
  scanForbiddenKeys(json, "", errors);

  // --- meta ---------------------------------------------------------------
  const meta = json.meta;
  if (!isRecord(meta)) {
    err("meta", `required object (got ${typeName(meta)})`);
  } else {
    requireNonEmptyString(meta, "meta", "title", err);
    requireNonEmptyString(meta, "meta", "hash", err);
    for (const k of ["repo", "specPath", "base", "branch", "sha"] as const) {
      optionalString(meta, "meta", k, err);
    }
    for (const k of ["files", "additions", "deletions", "commits"] as const) {
      // Number.isFinite (not typeof) so NaN/Infinity — which JSON.parse
      // can't produce but a programmatic caller can — are rejected too.
      if (meta[k] !== undefined && !Number.isFinite(meta[k])) {
        err(`meta.${k}`, `expected finite number (got ${typeName(meta[k])})`);
      }
    }
  }

  // --- fullDiff -----------------------------------------------------------
  if (typeof json.fullDiff !== "string" || json.fullDiff.trim() === "") {
    err(
      "fullDiff",
      `required non-empty string — the complete unified diff (got ${typeName(json.fullDiff)})`,
    );
  }

  // --- orientation ----------------------------------------------------------
  const orientation = json.orientation;
  if (!isRecord(orientation)) {
    err("orientation", `required object (got ${typeName(orientation)})`);
  } else {
    requireNonEmptyString(orientation, "orientation", "summary", err);
    requireNonEmptyString(orientation, "orientation", "readingOrder", err);
    requireNonEmptyString(orientation, "orientation", "timeBoxed", err);
    requireNonEmptyString(orientation, "orientation", "flagIndex", err);
    for (const k of ["ci", "mergeable", "baseNote", "concurrent"] as const) {
      optionalString(orientation, "orientation", k, err);
    }
    requireStringArray(orientation, "orientation", "standingPriorities", err);
    if (orientation.activatedPatterns !== undefined) {
      checkStringArray(
        orientation.activatedPatterns,
        "orientation.activatedPatterns",
        err,
      );
    }
  }

  // --- stops (validated before changeMap so stop-id cross-refs can resolve) -
  const stopIds = new Set<string>();
  const stops = json.stops;
  if (!Array.isArray(stops) || stops.length === 0) {
    err("stops", `required non-empty array (got ${typeName(stops)})`);
  } else {
    stops.forEach((raw, i) => {
      const p = `stops[${i}]`;
      if (!isRecord(raw)) {
        err(p, `expected object (got ${typeName(raw)})`);
        return;
      }
      const id = raw.id;
      if (typeof id !== "string" && typeof id !== "number") {
        err(`${p}.id`, `required string|number (got ${typeName(id)})`);
      } else if (stopIds.has(String(id))) {
        // Ids are compared after String() coercion (cross-refs, DOM anchors,
        // and hash deep-links all live in string space), so numeric 1 and
        // string "1" deliberately collide here.
        err(
          `${p}.id`,
          `duplicate stop id '${String(id)}' (ids collide after string coercion)`,
        );
      } else {
        stopIds.add(String(id));
      }
      if (!isOneOf(raw.priority, TOUR_PRIORITIES)) {
        err(
          `${p}.priority`,
          `expected one of ${TOUR_PRIORITIES.join("|")} (got ${JSON.stringify(raw.priority)})`,
        );
      }
      requireNonEmptyString(raw, p, "title", err);
      requireNonEmptyString(raw, p, "narration", err);
      if (!Array.isArray(raw.flags)) {
        err(`${p}.flags`, `required array (got ${typeName(raw.flags)})`);
      } else {
        raw.flags.forEach((f, j) => {
          if (!isOneOf(f, TOUR_FLAGS)) {
            err(
              `${p}.flags[${j}]`,
              `expected one of ${TOUR_FLAGS.join("|")} — the 4-flag vocabulary, no severities (got ${JSON.stringify(f)})`,
            );
          }
        });
      }
      requireStringArray(raw, p, "files", err);
      if (typeof raw.diff !== "string") {
        err(`${p}.diff`, `required string — this stop's unified-diff hunks (got ${typeName(raw.diff)})`);
      }
      if (raw.connects !== undefined) {
        if (!isRecord(raw.connects)) {
          err(`${p}.connects`, `expected object (got ${typeName(raw.connects)})`);
        } else {
          optionalString(raw.connects, `${p}.connects`, "prev", err);
          optionalString(raw.connects, `${p}.connects`, "next", err);
        }
      }
    });
  }

  // --- changeMap ------------------------------------------------------------
  const changeMap = json.changeMap;
  if (!Array.isArray(changeMap) || changeMap.length === 0) {
    err("changeMap", `required non-empty array (got ${typeName(changeMap)})`);
  } else {
    changeMap.forEach((raw, i) => {
      const p = `changeMap[${i}]`;
      if (!isRecord(raw)) {
        err(p, `expected object (got ${typeName(raw)})`);
        return;
      }
      requireNonEmptyString(raw, p, "file", err);
      optionalString(raw, p, "area", err);
      optionalString(raw, p, "what", err);
      if (!isOneOf(raw.weight, TOUR_WEIGHTS)) {
        err(
          `${p}.weight`,
          `expected one of ${TOUR_WEIGHTS.join("|")} (got ${JSON.stringify(raw.weight)})`,
        );
      }
      if (!Array.isArray(raw.stops)) {
        err(`${p}.stops`, `required array of stop ids (got ${typeName(raw.stops)})`);
      } else {
        raw.stops.forEach((s, j) => {
          if (typeof s !== "string" && typeof s !== "number") {
            err(`${p}.stops[${j}]`, `expected string|number stop id (got ${typeName(s)})`);
          } else if (stopIds.size > 0 && !stopIds.has(String(s))) {
            err(`${p}.stops[${j}]`, `references unknown stop id '${String(s)}'`);
          }
        });
      }
    });
  }

  // --- decisions ------------------------------------------------------------
  const decisions = json.decisions;
  if (!Array.isArray(decisions)) {
    err("decisions", `required array (got ${typeName(decisions)})`);
  } else {
    decisions.forEach((raw, i) => {
      const p = `decisions[${i}]`;
      if (!isRecord(raw)) {
        err(p, `expected object (got ${typeName(raw)})`);
        return;
      }
      if (typeof raw.id !== "string" && typeof raw.id !== "number") {
        err(`${p}.id`, `required string|number (got ${typeName(raw.id)})`);
      }
      requireNonEmptyString(raw, p, "decision", err);
      requireNonEmptyString(raw, p, "where", err);
      optionalString(raw, p, "implies", err);
      optionalString(raw, p, "alternative", err);
    });
  }

  // --- trails ---------------------------------------------------------------
  const trails = json.trails;
  if (!Array.isArray(trails)) {
    err("trails", `required array (may be empty) (got ${typeName(trails)})`);
  } else {
    trails.forEach((raw, i) => {
      const p = `trails[${i}]`;
      if (!isRecord(raw)) {
        err(p, `expected object (got ${typeName(raw)})`);
        return;
      }
      if ("mermaid" in raw) {
        err(
          `${p}.mermaid`,
          "mermaid is not supported in v1 tours — trails render as step tables only (v2/03-review-tour.md §1 change 2; O-1 tracks re-adding)",
        );
      }
      if (typeof raw.id !== "string" && typeof raw.id !== "number") {
        err(`${p}.id`, `required string|number (got ${typeName(raw.id)})`);
      }
      requireNonEmptyString(raw, p, "name", err);
      if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
        err(`${p}.steps`, `required non-empty array (got ${typeName(raw.steps)})`);
      } else {
        raw.steps.forEach((s, j) => {
          const sp = `${p}.steps[${j}]`;
          if (!isRecord(s)) {
            err(sp, `expected object (got ${typeName(s)})`);
            return;
          }
          if (typeof s.n !== "number") {
            err(`${sp}.n`, `required number (got ${typeName(s.n)})`);
          }
          requireNonEmptyString(s, sp, "what", err);
          optionalString(s, sp, "where", err);
          optionalString(s, sp, "note", err);
          if (!isOneOf(s.status, TRAIL_STEP_STATUSES)) {
            err(
              `${sp}.status`,
              `expected one of ${TRAIL_STEP_STATUSES.join("|")} (got ${JSON.stringify(s.status)})`,
            );
          }
        });
      }
    });
  }

  // --- blastRadius ----------------------------------------------------------
  const blast = json.blastRadius;
  if (!isRecord(blast)) {
    err("blastRadius", `required object (got ${typeName(blast)})`);
  } else {
    if (!Array.isArray(blast.sections)) {
      err(
        "blastRadius.sections",
        `required array (got ${typeName(blast.sections)})`,
      );
    } else {
      blast.sections.forEach((s, i) => {
        const p = `blastRadius.sections[${i}]`;
        if (!isRecord(s)) {
          err(p, `expected object (got ${typeName(s)})`);
          return;
        }
        requireNonEmptyString(s, p, "title", err);
        if (typeof s.body !== "string") {
          err(`${p}.body`, `required string (got ${typeName(s.body)})`);
        }
      });
    }
    optionalString(blast, "blastRadius", "callersNotUpdated", err);
    optionalString(blast, "blastRadius", "expectedMissing", err);
  }

  // --- coverage ------------------------------------------------------------
  const coverage = json.coverage;
  if (!isRecord(coverage)) {
    err("coverage", `required object (got ${typeName(coverage)})`);
  } else {
    if (!Array.isArray(coverage.rows)) {
      err("coverage.rows", `required array (got ${typeName(coverage.rows)})`);
    } else {
      coverage.rows.forEach((r, i) => {
        const p = `coverage.rows[${i}]`;
        if (!isRecord(r)) {
          err(p, `expected object (got ${typeName(r)})`);
          return;
        }
        if (typeof r.stop !== "string" && typeof r.stop !== "number") {
          err(`${p}.stop`, `required string|number stop id (got ${typeName(r.stop)})`);
        } else if (stopIds.size > 0 && !stopIds.has(String(r.stop))) {
          err(`${p}.stop`, `references unknown stop id '${String(r.stop)}'`);
        }
        optionalString(r, p, "testedBy", err);
        optionalString(r, p, "gaps", err);
      });
    }
    optionalString(coverage, "coverage", "todos", err);
    optionalString(coverage, "coverage", "questions", err);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function isOneOf<T extends string>(
  v: unknown,
  vocab: readonly T[],
): v is T {
  return typeof v === "string" && (vocab as readonly string[]).includes(v);
}

function requireNonEmptyString(
  obj: Record<string, unknown>,
  parent: string,
  key: string,
  err: (path: string, message: string) => void,
): void {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    err(`${parent}.${key}`, `required non-empty string (got ${typeName(v)})`);
  }
}

function optionalString(
  obj: Record<string, unknown>,
  parent: string,
  key: string,
  err: (path: string, message: string) => void,
): void {
  const v = obj[key];
  if (v !== undefined && typeof v !== "string") {
    err(`${parent}.${key}`, `expected string (got ${typeName(v)})`);
  }
}

function requireStringArray(
  obj: Record<string, unknown>,
  parent: string,
  key: string,
  err: (path: string, message: string) => void,
): void {
  const v = obj[key];
  if (!Array.isArray(v)) {
    err(`${parent}.${key}`, `required array of strings (got ${typeName(v)})`);
    return;
  }
  checkStringArray(v, `${parent}.${key}`, err);
}

function checkStringArray(
  v: unknown,
  path: string,
  err: (path: string, message: string) => void,
): void {
  if (!Array.isArray(v)) {
    err(path, `expected array of strings (got ${typeName(v)})`);
    return;
  }
  v.forEach((item, i) => {
    if (typeof item !== "string") {
      err(`${path}[${i}]`, `expected string (got ${typeName(item)})`);
    }
  });
}

/** Recursive scan for forbidden keys (`severity`/`severities`) at any depth.
 *  Skips string VALUES — a narration legitimately discussing "severity" in
 *  prose is fine; a structured severity field is the contract violation. */
function scanForbiddenKeys(
  node: unknown,
  path: string,
  errors: TourValidationError[],
): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      scanForbiddenKeys(item, `${path}[${i}]`, errors);
    });
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (FORBIDDEN_KEY_RE.test(key)) {
      errors.push({
        path: childPath,
        message:
          "severity vocabulary is forbidden — the tour presents and points; judging is the human's job (v2/03-review-tour.md §1)",
      });
    }
    scanForbiddenKeys(value, childPath, errors);
  }
}
