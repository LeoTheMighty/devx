// Outcome loop — arm + score (v2o101; v2/02-engine.md §4.10).
//
// The loop v1 never had: at workstream close the outcome is ARMED
// (`outcome: {status: pending, measure_by: <+4 weeks>}`); when measure_by
// comes due, `devx outcome score` measures the PRD's numeric `G-` goals
// against reality, writes RESULTS.md from the shipped template, and flips
// `outcome.status` to one of the four verdicts:
//
//   keep    — mechanical: goals hit, nothing changes.
//   tune    — cascade-reopen keyed to the missed E-ids (`--reopen E-1,E-2`):
//             evals_red clears and the stage rolls back to `red` (never
//             forward — reuse of revise.ts's min-stage rule), because the
//             missed expectations' RED artifacts (their `Verified by:`
//             targets) are the reopen surface; the replay path is printed
//             via revise.ts's replayPath. A deeper revision (the
//             expectation itself was wrong, the design was wrong) goes
//             through `devx revise --touched <artifact>` — this command
//             reopens verification, not authorship.
//   restart — a successor workstream carries the lineage: the old spec is
//             stamped `successor:` + `superseded_by:`; the successor's plan
//             spec (when it already exists) gets `learns_from:` pointing
//             back. Scaffold-later is legal: the stamp survives and the
//             JSON output says what to run.
//   retire  — outcome.status only; the workstream ends without an heir.
//
// Pure evaluation lives here; the CLI passthrough in src/commands/outcome.ts
// owns resolution, writes, and exit codes (the mrg/prt/pln pure-fn +
// CLI-passthrough pattern). All clock reads are injected (`now`) — no
// Date.now() in this module.
//
// Per-goal verdicts are deterministic, not vibes (design tenet 5): an
// explicit `--result G-n=hit|miss|partial` always wins; otherwise a goal
// whose prd.md text carries an unambiguous `≥`/`>=`/`≤`/`<=` comparator is
// compared mechanically against the supplied actual; anything else scores
// `recorded` and the judgment lives in the Reading/Disposition prose.
//
// Spec: dev/dev-v2o101-2026-07-05T13:07-outcome-loop.md
// Design: v2/02-engine.md §4.10; template _devx/templates/engine/results.md

import { type EngineState, type GateFlag, type Stage, stageIndex } from "./frontmatter.js";
import { parseExpectations } from "./expectations.js";
import { extractDefinedIds } from "./gate-prd.js";
import { replayPath } from "./revise.js";
import { formatDate } from "./verdict.js";

export const OUTCOME_VERDICTS = ["keep", "tune", "restart", "retire"] as const;
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];

export function isOutcomeVerdict(v: string | null): v is OutcomeVerdict {
  return v !== null && (OUTCOME_VERDICTS as readonly string[]).includes(v);
}

/** Refusal (exit 1): valid request, the outcome loop says no. */
export class OutcomeRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutcomeRefusal";
  }
}

/** Hard error (exit 2): bad flag shape, missing template, unreadable input. */
export class OutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutcomeError";
  }
}

// ---------------------------------------------------------------------------
// measure_by parsing (arm)
// ---------------------------------------------------------------------------

export const DEFAULT_MEASURE_BY_DAYS = 28; // +4 weeks (v2/02-engine.md §4.10)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE_WEEKS_RE = /^\+(\d+)w$/i;

/**
 * Resolve a `--measure-by` value to YYYY-MM-DD. Accepts an absolute date or
 * `+Nw` (N weeks from `now`). Omitted → +4 weeks. Throws OutcomeError on
 * any other shape — a mis-typed date must not silently arm for the wrong
 * decade.
 */
export function resolveMeasureBy(spec: string | undefined, now: Date): string {
  if (spec === undefined || spec.trim() === "") {
    return addDays(now, DEFAULT_MEASURE_BY_DAYS);
  }
  const cleaned = spec.trim();
  const rel = RELATIVE_WEEKS_RE.exec(cleaned);
  if (rel) {
    const weeks = Number(rel[1]);
    if (weeks < 1 || weeks > 520) {
      throw new OutcomeError(
        `--measure-by '${cleaned}' is out of range (1–520 weeks)`,
      );
    }
    return addDays(now, weeks * 7);
  }
  if (DATE_RE.test(cleaned)) {
    // Reject calendar nonsense (2026-13-40) without timezone traps: parse
    // as UTC and require the components to round-trip.
    const [y, m, d] = cleaned.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d
    ) {
      throw new OutcomeError(`--measure-by '${cleaned}' is not a real date`);
    }
    return cleaned;
  }
  throw new OutcomeError(
    `--measure-by '${cleaned}' — expected YYYY-MM-DD or +Nw (e.g. +4w)`,
  );
}

function addDays(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/** YYYY-MM-DD ≤ today comparison (lexicographic is safe for ISO dates).
 *  A null/unparseable measure_by counts as DUE — a pending outcome must
 *  never wait forever on a malformed date. */
export function isMeasureByDue(measureBy: string | null, today: string): boolean {
  if (measureBy === null || !DATE_RE.test(measureBy.trim())) return true;
  return measureBy.trim() <= today;
}

// ---------------------------------------------------------------------------
// Arm
// ---------------------------------------------------------------------------

export interface ArmComputation {
  measureBy: string;
  /** True when the spec already carried the same pending measure_by. */
  noop: boolean;
}

/**
 * Validate + compute the arm patch. Arm happens at workstream close: the
 * stage must be `done`. A scored outcome refuses (re-arming would erase a
 * recorded verdict); re-arming a pending outcome updates measure_by.
 */
export function computeArm(
  state: EngineState,
  measureBySpec: string | undefined,
  now: Date,
): ArmComputation {
  if (state.stage !== "done") {
    throw new OutcomeRefusal(
      `outcome arm requires stage 'done' (workstream close) — stage is '${state.stage ?? "unset"}'`,
    );
  }
  if (isOutcomeVerdict(state.outcome.status)) {
    throw new OutcomeRefusal(
      `outcome is already scored ('${state.outcome.status}') — refusing to re-arm over a recorded verdict`,
    );
  }
  const measureBy = resolveMeasureBy(measureBySpec, now);
  const noop =
    state.outcome.status === "pending" && state.outcome.measure_by === measureBy;
  return { measureBy, noop };
}

// ---------------------------------------------------------------------------
// PRD goal parsing (score)
// ---------------------------------------------------------------------------

export interface PrdGoal {
  /** "G-1" (uppercased). */
  id: string;
  /** 1-based prd.md line of the definition. */
  line: number;
  /** The goal's definition text (bullet body after the colon, wrapped
   *  continuation lines folded), "" when the shape is unrecognized. */
  text: string;
}

/**
 * Extract the `G-` goals defined in prd.md, with their definition text.
 * Definition positions come from gate-prd's extractDefinedIds (bold or
 * heading — the template's two shapes); the text is the remainder of the
 * defining bullet/heading line plus indented continuation lines (same
 * wrapped-value folding lesson as parseExpectations — v2e102's first real
 * run caught exactly this class).
 */
export function parsePrdGoals(prd: string): PrdGoal[] {
  // CRLF-normalize first: `(.*)$` won't cross a trailing `\r`, which would
  // silently blank every goal's text on a CRLF checkout (EC#3).
  const normalized = prd.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const out: PrdGoal[] = [];
  for (const ref of extractDefinedIds(normalized)) {
    if (!ref.id.startsWith("G-")) continue;
    const line = lines[ref.line - 1] ?? "";
    // Bullet shape: `- **G-1**: <text>`; heading shape: `### G-1: <text>`.
    const m =
      new RegExp(`\\*\\*${ref.id}\\*\\*\\s*:?\\s*(.*)$`, "i").exec(line) ??
      new RegExp(`^#{2,4}\\s+${ref.id}\\b\\s*:?\\s*(.*)$`, "i").exec(line);
    let text = m ? m[1].trim() : "";
    for (let i = ref.line; i < lines.length; i++) {
      const next = lines[i];
      // Continuation = indented plain prose. Sub-bullets, numbered lists,
      // and table rows under a goal are NOT part of its sentence (EC#6 —
      // folding a table in garbles the Target cell and its stray `≥ N`
      // tokens poison comparator inference).
      if (
        /^\s{2,}\S/.test(next) &&
        !/^\s*[-*]\s/.test(next) &&
        !/^\s*\d+[.)]\s/.test(next) &&
        !/^\s*\|/.test(next)
      ) {
        text = `${text} ${next.trim()}`.trim();
      } else {
        break;
      }
    }
    out.push({ id: ref.id, line: ref.line, text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Goal scoring
// ---------------------------------------------------------------------------

export type GoalRowVerdict = "hit" | "miss" | "partial" | "recorded";

export interface GoalScoreInput {
  /** `--goal G-1=<actual>` values, keyed by uppercased goal ID. */
  actuals: Map<string, string>;
  /** `--source G-1=<where>` values. */
  sources: Map<string, string>;
  /** `--result G-1=hit|miss|partial` overrides. */
  results: Map<string, GoalRowVerdict>;
}

export interface GoalRow {
  id: string;
  /** Target column: the goal's prd.md definition text. */
  target: string;
  actual: string;
  source: string;
  verdict: GoalRowVerdict;
  /** How the verdict was derived (for the JSON audit trail). */
  derivation: "explicit" | "comparator" | "recorded";
}

// A mechanical comparator in goal prose: `≥ 1571`, `>=10`, `≤ 5`, `<= 5`.
// Bare numbers and `< / >` prose comparisons are NOT auto-scored — gate-prd's
// placeholder lesson ("p95 < 8s and retries > 3" is legitimate prose) says
// half-open comparators in prose are too ambiguous to score mechanically.
// Accepted bounds (documented, adversarial review): comma/underscore are
// digit separators (`≥ 1,571`; European decimal commas unsupported); a
// `%`-suffixed actual is non-numeric → falls back to `recorded`
// (conservative); a bolded prose cross-reference above the Goals section
// can claim a goal's definition line (first-mention-wins in
// extractDefinedIds) — the template's shapes make that a hand-authored
// anomaly, and `--result` always overrides the inference.
const COMPARATOR_RE = /(≥|>=|≤|<=)\s*([0-9][0-9,._]*)/g;

function comparatorVerdict(target: string, actual: string): GoalRowVerdict | null {
  // A date after the comparator (`ship ≤ 2026-08-01`) must not become
  // bound 2026 (EC#5). Checked in code, not via a regex lookahead — a
  // lookahead after a greedy quantifier backtracks ("2026" → "202" and
  // the lookahead passes), silently producing an even wronger bound.
  const matches = [...target.matchAll(COMPARATOR_RE)].filter((m) => {
    const after = target.slice((m.index ?? 0) + m[0].length);
    return !/^-\d/.test(after);
  });
  // Exactly one comparator = unambiguous. Two or more (a baseline + a
  // target, per-percentile bounds, a range) can't be scored mechanically —
  // fall back to `recorded` rather than score against the wrong bound
  // (adversarial-review BH#2).
  if (matches.length !== 1) return null;
  const m = matches[0];
  const bound = Number(m[2].replace(/[,_]/g, ""));
  const actualNum = Number(actual.replace(/[,_]/g, ""));
  if (!Number.isFinite(bound) || !Number.isFinite(actualNum)) return null;
  const ge = m[1] === "≥" || m[1] === ">=";
  return (ge ? actualNum >= bound : actualNum <= bound) ? "hit" : "miss";
}

export interface GoalScoreComputation {
  rows: GoalRow[];
}

/**
 * Score every prd.md goal. Bidirectional coverage is required (the gate-prd
 * orphan-check posture): a defined goal with no `--goal` flag refuses, and
 * a `--goal` flag naming an undefined goal refuses — a silent partial score
 * would undermine the whole loop.
 */
export function computeGoalRows(
  goals: PrdGoal[],
  input: GoalScoreInput,
): GoalScoreComputation {
  if (goals.length === 0) {
    throw new OutcomeRefusal(
      "prd.md defines no G- goals — nothing to score (outcome scoring is keyed to the PRD's numeric goals)",
    );
  }
  const defined = new Set(goals.map((g) => g.id));
  const missing = goals.filter((g) => !input.actuals.has(g.id)).map((g) => g.id);
  if (missing.length > 0) {
    throw new OutcomeRefusal(
      `every prd.md goal needs a --goal flag; missing: ${missing.join(", ")}`,
    );
  }
  for (const id of input.actuals.keys()) {
    if (!defined.has(id)) {
      throw new OutcomeRefusal(
        `--goal names '${id}' but prd.md defines no such goal (defined: ${[...defined].join(", ")})`,
      );
    }
  }
  for (const map of [input.sources, input.results] as const) {
    for (const id of map.keys()) {
      if (!defined.has(id)) {
        throw new OutcomeRefusal(
          `flag names '${id}' but prd.md defines no such goal`,
        );
      }
    }
  }

  const rows: GoalRow[] = goals.map((g) => {
    const actual = input.actuals.get(g.id) ?? "";
    const explicit = input.results.get(g.id);
    let verdict: GoalRowVerdict;
    let derivation: GoalRow["derivation"];
    if (explicit !== undefined) {
      verdict = explicit;
      derivation = "explicit";
    } else {
      const mech = comparatorVerdict(g.text, actual);
      if (mech !== null) {
        verdict = mech;
        derivation = "comparator";
      } else {
        verdict = "recorded";
        derivation = "recorded";
      }
    }
    return {
      id: g.id,
      target: g.text || "(definition text not extractable)",
      actual,
      source: input.sources.get(g.id) ?? "(not recorded)",
      verdict,
      derivation,
    };
  });
  return { rows };
}

// ---------------------------------------------------------------------------
// Verdict-specific computations
// ---------------------------------------------------------------------------

export interface TuneComputation {
  reopened: string[];
  /** Verified-by targets of the reopened expectations (the reopen surface). */
  reopenArtifacts: string[];
  flagsCleared: GateFlag[];
  stage: Stage;
  replay: string[];
}

const E_ID_RE = /^E-\d+$/i;

/**
 * tune's cascade-reopen. The reopened E-ids must exist in expectations.md;
 * evals_red clears and the stage rolls back to `red` (min-stage rule from
 * revise.ts — the stage never advances on a backward-path command). The
 * replay path from `red` is the gate-evals re-run.
 */
export function computeTune(
  state: EngineState,
  reopenSpec: string,
  expectationsContent: string,
  hash: string,
): TuneComputation {
  const ids = reopenSpec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (ids.length === 0) {
    throw new OutcomeRefusal(
      "verdict 'tune' requires --reopen with at least one E-id (e.g. --reopen E-1,E-2)",
    );
  }
  for (const id of ids) {
    if (!E_ID_RE.test(id)) {
      throw new OutcomeRefusal(
        `--reopen entry '${id}' is not an E-id (expected E-<n>)`,
      );
    }
  }
  // Dedupe (--reopen E-1,E-1,E-2 is a typo, not two reopens) while
  // normalizing case.
  const normalized = [...new Set(ids.map((s) => s.toUpperCase()))];
  const blocks = parseExpectations(expectationsContent);
  // First block wins on a duplicated E-id — matching parseExpectations'
  // own duplicate-field policy and the gates' canonical-first posture
  // (EC#12; `new Map(...)` alone would keep the LAST duplicate).
  const known = new Map<string, (typeof blocks)[number]>();
  for (const b of blocks) {
    const key = b.id.toUpperCase();
    if (!known.has(key)) known.set(key, b);
  }
  const unknown = normalized.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new OutcomeRefusal(
      `--reopen names ${unknown.join(", ")} but expectations.md defines only: ${blocks.map((b) => b.id).join(", ") || "(none)"}`,
    );
  }
  // Reopen surface: the missed expectations' runnable artifacts, lowest
  // E-id first (the "lowest reopened expectation" leads the replay).
  const sorted = [...normalized].sort(
    (a, b) => Number(a.slice(2)) - Number(b.slice(2)),
  );
  const reopenArtifacts = sorted
    .map((id) => known.get(id)?.verifiedBy ?? null)
    .filter((v): v is string => v !== null && v.trim() !== "");

  const flagsCleared: GateFlag[] = state.gateStatus.evals_red
    ? ["evals_red"]
    : [];
  const current = state.stage ?? "red";
  const stage: Stage =
    stageIndex(current) < stageIndex("red") ? current : "red";
  return {
    reopened: sorted,
    reopenArtifacts,
    flagsCleared,
    stage,
    replay: replayPath(stage, hash),
  };
}

export interface RestartLineage {
  successorSlug: string;
  /** Repo-relative successor workstream dir. */
  successorWorkstream: string;
  /** Hash of the successor's plan spec, when one already claims the dir. */
  successorHash: string | null;
}

// ---------------------------------------------------------------------------
// RESULTS.md rendering (template-driven)
// ---------------------------------------------------------------------------

export interface RenderResultsOpts {
  template: string;
  workstreamTitle: string;
  date: string;
  verdict: OutcomeVerdict;
  statusReason: string;
  rows: GoalRow[];
  reading: string;
  disposition: string;
  reopened: string[];
  successor: string | null;
}

/**
 * Fill the shipped results.md template. Substitution is token-targeted
 * (each template placeholder replaced exactly once) so template comments
 * and section order survive verbatim — the golden test pins the output
 * against the real template, and engine-templates.test.ts pins the
 * template itself, so the two can't drift apart silently.
 */
const DISPOSITION_TOKEN =
  "<why the frontmatter outcome; if tune: which E-ids reopen and what changes;\n" +
  "if restart: what the successor keeps and abandons; if retire: what gets\n" +
  "removed and when>";

/**
 * Fill the shipped results.md template. Substitution is token-targeted and
 * sequential-first-occurrence; user prose that contains a LITERAL later
 * placeholder token could hijack that token's slot (EC#10) — accepted
 * bound: the values come from the operator's own flags in a local CLI, and
 * the drift-pinned required-token check below means the damage is visible
 * in the artifact, not silent state corruption.
 */
export function renderResults(opts: RenderResultsOpts): string {
  // CRLF-checkout template must not fail the multi-line DISPOSITION_TOKEN
  // check with a misleading "template drift" message (EC#11).
  const t = opts.template.replace(/\r\n/g, "\n");
  const required = [
    "<keep | tune | restart | retire>",
    "'<1–2 sentences>'",
    "updated: <YYYY-MM-DD>",
    "reopened_expectations: []",
    "successor: null",
    "# Results — <workstream> — <YYYY-MM-DD>",
    "| G-1 | <target> | <measured> | <where the number came from> | <hit / miss / partial> |",
    "<what the numbers mean; what surprised us>",
    DISPOSITION_TOKEN,
  ];
  for (const token of required) {
    if (!t.includes(token)) {
      throw new OutcomeError(
        `results template is missing the placeholder ${JSON.stringify(token)} — template drift; re-seed _devx/templates/engine/results.md`,
      );
    }
  }
  const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const tableRows = opts.rows
    .map(
      (r) =>
        `| ${r.id} | ${cell(r.target)} | ${cell(r.actual)} | ${cell(r.source)} | ${r.verdict} |`,
    )
    .join("\n");
  const reopenedYaml =
    opts.reopened.length > 0 ? `[${opts.reopened.join(", ")}]` : "[]";

  // Every substitution goes through a replacer FUNCTION: String.replace's
  // string form expands `$&`/`$$`/`$'` inside the replacement, so a
  // status_reason (or goal source) containing a literal `$&` would splice
  // template text into the artifact silently.
  const sub = (input: string, token: string | RegExp, value: string): string =>
    input.replace(token, () => value);

  let out = t;
  out = sub(out, "<keep | tune | restart | retire>", opts.verdict);
  out = sub(out, "'<1–2 sentences>'", sq(opts.statusReason));
  out = sub(out, /^updated: <YYYY-MM-DD>$/m, `updated: ${opts.date}`);
  out = sub(
    out,
    /^reopened_expectations: \[\].*$/m,
    `reopened_expectations: ${reopenedYaml}   # E-ids, when outcome = tune`,
  );
  out = sub(
    out,
    /^successor: null.*$/m,
    `successor: ${opts.successor ?? "null"}             # workstream slug, when outcome = restart`,
  );
  out = sub(
    out,
    "# Results — <workstream> — <YYYY-MM-DD>",
    `# Results — ${opts.workstreamTitle} — ${opts.date}`,
  );
  out = sub(
    out,
    "| G-1 | <target> | <measured> | <where the number came from> | <hit / miss / partial> |",
    tableRows,
  );
  out = sub(out, "<what the numbers mean; what surprised us>", opts.reading);
  out = sub(out, DISPOSITION_TOKEN, opts.disposition);
  return out;
}

/** Escape a value for a one-line markdown table cell. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || "—";
}

/** Default status_reason when --reason is omitted: deterministic roll-up
 *  of the goal table. */
export function defaultStatusReason(
  verdict: OutcomeVerdict,
  rows: GoalRow[],
): string {
  const hit = rows.filter((r) => r.verdict === "hit").length;
  const miss = rows.filter((r) => r.verdict === "miss").length;
  const scored = rows.filter((r) => r.verdict !== "recorded").length;
  const parts = [`${hit}/${rows.length} goals hit`];
  if (miss > 0) parts.push(`${miss} missed`);
  if (scored < rows.length) parts.push(`${rows.length - scored} recorded`);
  return `verdict ${verdict}: ${parts.join(", ")}.`;
}
