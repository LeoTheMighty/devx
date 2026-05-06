// Pure helpers for /devx Phase 5 mode-derived coverage gate (dvx104).
//
// The skill body's Phase 5 prose dispatches the coverage gate by mode
// (verbatim per spec AC #1):
//
//   YOLO     → informational only; never blocks merge.
//   BETA     → warn if touched-surface coverage < 80% (still merges).
//   PROD     → block if touched-surface coverage < 100% (line-level diff
//              of changed files against coverage report).
//   LOCKDOWN → block if < 100% OR if a browser-QA pass hasn't run.
//
// This module is the pure decision primitive behind that prose — same
// shape as merge-gate.ts (mrg101): no I/O, no imports beyond TS types.
// The skill body computes the touched surface (`git diff --name-only
// <integration-branch>..HEAD`), reads the coverage runner output, parses
// opt-out markers via `parseOptOutMarkers`, and feeds the structured
// result into `coverageTouchedGate`.
//
// Surface:
//
//   coverageTouchedGate(input)  — pure mode dispatch over a structured
//                                 file-line snapshot. Returns outcome +
//                                 touched-line pct + reason.
//
//   parseOptOutMarkers(content, marker?) — line-number list of
//                                 `# devx:no-coverage [<reason>]` markers
//                                 in `content`. Pure string scan.
//
// Spec: dev/dev-dvx104-2026-04-28T19:30-devx-coverage-gate.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

export type Mode = "YOLO" | "BETA" | "PROD" | "LOCKDOWN";
export type GateOutcome = "informational" | "warn" | "block";

export interface FileLineCoverage {
  path: string;
  /** Touched (changed) line numbers, 1-indexed. */
  touchedLines: number[];
  /** Subset of `touchedLines` that the coverage runner reports as covered. */
  coveredLines: number[];
  /** Subset of `touchedLines` bearing `# devx:no-coverage [<reason>]`.
   *  Excluded from the denominator per spec AC #3. */
  optedOutLines: number[];
}

export interface CoverageGateInput {
  mode: Mode | string;
  files: FileLineCoverage[];
  /** LOCKDOWN-only signal: whether a browser-QA pass has run. */
  browserQaRan?: boolean;
}

export interface CoverageGateDecision {
  outcome: GateOutcome;
  /** Touched-line coverage in [0, 1], or `null` when all touched lines are
   *  opted out (denominator zero) or the input has no touched lines at all. */
  pctTouched: number | null;
  reason: string;
}

const KNOWN_MODES: ReadonlySet<string> = new Set([
  "YOLO",
  "BETA",
  "PROD",
  "LOCKDOWN",
]);

const BETA_THRESHOLD = 0.8;
const PROD_THRESHOLD = 1.0;

/**
 * Mode-dispatch the coverage gate. Mirrors merge-gate.ts shape; both are
 * pure functions consumed by the /devx skill body and verified by no-I/O
 * tests.
 *
 * Order of evaluation:
 *   1. Mode validation — fail closed on unknown values (matches mrg101).
 *   2. Compute touched-line pct (denominator excludes opt-out lines).
 *   3. Per-mode dispatch — YOLO is informational; BETA warns at <80%;
 *      PROD blocks at <100%; LOCKDOWN blocks at <100% OR if browser-QA
 *      hasn't run.
 *
 * `null` pctTouched means "no countable touched lines" — either the diff
 * was empty (rare; `/devx` Phase 5 only runs on a feature branch with
 * commits) or every touched line is opted out. YOLO/BETA treat that as
 * informational (nothing to grade). PROD/LOCKDOWN block — coverage data
 * is required at those gates and `null` is a missing-data signal.
 */
export function coverageTouchedGate(
  input: CoverageGateInput,
): CoverageGateDecision {
  if (!KNOWN_MODES.has(input.mode)) {
    return {
      outcome: "block",
      pctTouched: null,
      reason: `unknown mode: ${input.mode}`,
    };
  }
  const pct = computePctTouched(input.files);

  switch (input.mode as Mode) {
    case "YOLO":
      return {
        outcome: "informational",
        pctTouched: pct,
        reason:
          pct == null
            ? "YOLO: no countable touched lines (informational only; never blocks merge)"
            : `YOLO: touched-line coverage ${pctStr(pct)} (informational only; never blocks merge)`,
      };

    case "BETA":
      if (pct == null) {
        return {
          outcome: "informational",
          pctTouched: pct,
          reason:
            "BETA: no countable touched lines (nothing to grade; still merges)",
        };
      }
      if (pct < BETA_THRESHOLD) {
        return {
          outcome: "warn",
          pctTouched: pct,
          reason: `BETA: touched-surface coverage ${pctStr(pct)} < 80% (still merges)`,
        };
      }
      return {
        outcome: "informational",
        pctTouched: pct,
        reason: `BETA: touched-surface coverage ${pctStr(pct)} >= 80%`,
      };

    case "PROD":
      if (pct == null) {
        return {
          outcome: "block",
          pctTouched: pct,
          reason: "PROD: coverage data missing (no countable touched lines)",
        };
      }
      if (pct < PROD_THRESHOLD) {
        return {
          outcome: "block",
          pctTouched: pct,
          reason: `PROD: touched-surface coverage ${pctStr(pct)} < 100%`,
        };
      }
      return {
        outcome: "informational",
        pctTouched: pct,
        reason: "PROD: touched-surface coverage 100%",
      };

    case "LOCKDOWN":
      if (pct == null) {
        return {
          outcome: "block",
          pctTouched: pct,
          reason: "LOCKDOWN: coverage data missing (no countable touched lines)",
        };
      }
      if (pct < PROD_THRESHOLD) {
        return {
          outcome: "block",
          pctTouched: pct,
          reason: `LOCKDOWN: touched-surface coverage ${pctStr(pct)} < 100%`,
        };
      }
      if (!input.browserQaRan) {
        return {
          outcome: "block",
          pctTouched: pct,
          reason: "LOCKDOWN: browser-QA pass has not run",
        };
      }
      return {
        outcome: "informational",
        pctTouched: pct,
        reason:
          "LOCKDOWN: touched-surface coverage 100% + browser-QA pass green",
      };
  }
  // Exhaustive — KNOWN_MODES gates every value above. The compiler proves
  // this branch is unreachable but TS still demands a tail return.
  return {
    outcome: "block",
    pctTouched: null,
    reason: `unhandled mode: ${input.mode}`,
  };
}

/**
 * Compute `(covered touched lines) / (touched lines minus opt-out lines)`.
 * Returns `null` when the denominator is zero. Adversarial-edge:
 * coveredLines and optedOutLines may overlap (a covered line that ALSO
 * has an opt-out marker — operator hand-edited a test exclusion onto a
 * line that turned out to be covered anyway). Opt-out wins — the line
 * is excluded from BOTH numerator and denominator.
 */
function computePctTouched(files: FileLineCoverage[]): number | null {
  let denom = 0;
  let numer = 0;
  for (const f of files) {
    const optedOutSet = new Set(f.optedOutLines);
    const coveredSet = new Set(f.coveredLines);
    for (const ln of f.touchedLines) {
      if (optedOutSet.has(ln)) continue;
      denom += 1;
      if (coveredSet.has(ln)) numer += 1;
    }
  }
  if (denom === 0) return null;
  return numer / denom;
}

function pctStr(pct: number): string {
  // 100% renders as "100.0%" not "100%" — keeps formatting consistent
  // with merge-gate.ts (which uses `.toFixed(1)` for the same reason:
  // `(0.999 * 100).toFixed(1)` is "99.9", and we want symmetric output
  // at the boundary).
  return `${(pct * 100).toFixed(1)}%`;
}

const DEFAULT_OPT_OUT_MARKER = "devx:no-coverage";

/**
 * Scan `content` for the opt-out marker. Returns 1-indexed line numbers
 * of every line that contains the marker — typically as a trailing
 * comment like `# devx:no-coverage <reason>` (Python/YAML/Ruby) or
 * `// devx:no-coverage <reason>` (JS/TS/Dart/C/etc).
 *
 * Match policy: the marker must be flanked on at least one side by a
 * non-word character (or start/end of line) so that an unrelated string
 * containing the marker as a substring doesn't accidentally exclude a
 * line. Specifically:
 *   - `# devx:no-coverage` (matches; surrounded by ` ` and EOL)
 *   - `// devx:no-coverage some reason` (matches; surrounded by ` `)
 *   - `# devx:no-coverage-extended` (does NOT match; trailing `-` is a
 *     word-class char that breaks the boundary — `:` is a non-word char,
 *     so we require the trailing boundary to be a `\W` (non-word) char,
 *     not just `\b`. Without this, "devx:no-coverage-extended" would
 *     pass `\bdevx:no-coverage\b` because `-` IS a word boundary in JS
 *     regex terms (`\b` is between word and non-word chars and `e`/`-`
 *     qualify).
 *
 * The default marker matches the project-canonical string from
 * `devx.config.yaml → coverage.opt_out_marker` (line 145 of this repo's
 * config). Callers MAY override but should not need to — the spec
 * fixates the literal `# devx:no-coverage <reason>` shape (AC #3).
 */
export function parseOptOutMarkers(
  content: string,
  marker: string = DEFAULT_OPT_OUT_MARKER,
): number[] {
  if (marker === "") return [];
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Boundary on both sides: start-of-string or non-word char on the left,
  // end-of-string or non-word char on the right. The trailing boundary
  // is the load-bearing one (see the docstring example).
  const re = new RegExp(`(?:^|[^\\w-])${escaped}(?:[^\\w-]|$)`);
  const lines = content.split("\n");
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      out.push(i + 1);
    }
  }
  return out;
}
