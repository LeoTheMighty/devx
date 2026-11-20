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
// whose prd/agent.md text carries an unambiguous `≥`/`>=`/`≤`/`<=` comparator is
// compared mechanically against the supplied actual; anything else scores
// `recorded` and the judgment lives in the Reading/Disposition prose.
//
// MEASUREMENT IS RUN, NOT ASKED FOR (upstream CONVENTIONS §16, row A18).
// The verdict machinery above shipped with the number hand-typed through
// `--goal G-1=<actual>`, which made the whole loop only as honest as the
// operator's memory: "a hand-typed figure or a bare dashboard link is not a
// result." So a goal may now NAME its measurement — an expectations
// `Measure:` one-liner, or a `(measured at outcome)` step in a `Verified by:`
// eval manifest — and `devx outcome score --run` executes it, recording the
// command, the value, the observation window and the timestamp as the source
// of record. Once a goal names a runnable measure, `--goal` for that goal is
// REFUSED: the point is not to offer running as an option, it is to stop the
// un-run number from being accepted. The sanctioned exception is explicit
// and recorded, never silent — `--attested G-1` with a `--source` says in the
// artifact that a human vouched for this figure instead of a command
// producing it, which is also the escape hatch when a measure exists but
// cannot run today (upstream: flag it as attested, never present it as
// measured). A goal with no measure at all keeps the old path, and Gate 1
// now warns about exactly that case while the PRD is still being written.
//
// Spec: dev/dev-v2o101-2026-07-05T13:07-outcome-loop.md
// Design: v2/02-engine.md §4.10; template _devx/templates/engine/results.md

import {
  type EngineState,
  type GateFlag,
  type GateKey,
  type Stage,
  stageIndex,
} from "./frontmatter.js";
import {
  type EBlock,
  parseCoversIds,
  parseExpectations,
  parseMeasureField,
} from "./expectations.js";
import { type PrdGoal, parsePrdGoals } from "./gate-prd.js";
import { outcomeMeasures } from "./eval-manifest.js";
import { replayPath } from "./revise.js";
import { formatDate } from "./verdict.js";

// `parsePrdGoals` moved to gate-prd.ts, beside `extractDefinedIds` it is
// built on, so Gate 1's measurability floor can read a goal's text without
// making the two modules a cycle. Re-exported here because this is where
// every existing caller imports it from.
export { type PrdGoal, parsePrdGoals } from "./gate-prd.js";

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
// Runnable measures (A18 / C5) — resolution is pure, execution is the CLI's
// ---------------------------------------------------------------------------

/** A runnable measurement bound to exactly one business goal. */
export interface GoalMeasure {
  /** Uppercased `G-n` this measure scores. */
  goalId: string;
  /** The expectation that declared it. */
  eId: string;
  /** The shell command. Run from the repo root. */
  command: string;
  /** The observation window the value is read over, when declared. Null is
   *  legal and recorded as such — a window nobody wrote down is a
   *  re-run nobody can interpret, which is worth SAYING rather than
   *  inventing a default that would silently change the number's meaning. */
  window: string | null;
  /** Human-readable provenance for messages and the Source cell audit
   *  trail — e.g. "E-1 Measure:" or "E-1 step 4 (metric)". */
  origin: string;
}

/** The result of running a measure: the value of record, with its clock. */
export interface MeasuredValue {
  measure: GoalMeasure;
  /** The value the command printed — its LAST non-empty stdout line. */
  value: string;
  /** ISO 8601 with offset, minute precision — see `measuredAtStamp`. */
  measuredAt: string;
}

/**
 * The value of record from a command's stdout: the last non-empty line.
 *
 * Last, not first and not the whole buffer: a measurement script that logs
 * while it works ends with its answer, and a first-line rule would score the
 * goal against a progress message. The template says so, so an author who
 * reads it gets this right by construction.
 */
export function measuredValueFrom(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return lines.length === 0 ? null : lines[lines.length - 1];
}

/**
 * ISO 8601 to the minute, in LOCAL time with an explicit offset —
 * `2026-07-05T12:00-06:00`.
 *
 * Local, not UTC, because every other date in this record is local:
 * `measure_by`, the verdict block's `updated:`, the decisions filenames. A
 * `…T06:00Z` stamp beside `updated: 2026-07-04` is a reader wondering which
 * day the measurement belongs to, in the one artifact whose whole job is to
 * be unambiguous months later. The offset is carried explicitly so the
 * instant is still exact — a bare local time would be the actual ambiguity.
 */
export function measuredAtStamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  // getTimezoneOffset() is minutes to ADD to local to get UTC, so it is
  // positive west of Greenwich — the sign is inverted from ISO 8601's.
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${date}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * The Source cell for a measured goal: command · value · window · timestamp.
 *
 * Deliberately self-contained — it repeats the value that is already in the
 * Actual column — because this cell is the EVIDENCE, read months later by
 * someone deciding whether the number can be reproduced. A cell that said
 * only "the measure" would send them back to an expectations.md that has
 * since been revised (upstream §16: "a bare dashboard link is not a result").
 */
export function formatMeasuredSource(m: MeasuredValue): string {
  return [
    `\`${m.measure.command}\``,
    m.value,
    `window: ${m.measure.window ?? "not declared"}`,
    m.measuredAt,
  ].join(" · ");
}

/**
 * Resolve each goal's runnable measure from the expectations that Cover it.
 *
 * Two declaration sites, with a fixed precedence per expectation:
 *   1. the E-block's `Measure:` one-liner, and
 *   2. failing that, a `(measured at outcome)` step with a `Run:` command in
 *      the `Verified by:` eval manifest.
 * The one-liner wins for its own block because it is the more specific
 * statement; it does not suppress a DIFFERENT expectation's manifest.
 *
 * A goal with two or more measures REFUSES. "Which of these two numbers is
 * G-1?" has no mechanical answer, and quietly taking the first would record
 * a verdict against a bound nobody chose — the same reason
 * `comparatorVerdict` declines two comparators instead of guessing.
 * `--attested G-1` is the escape when the author genuinely means one of them,
 * which is why `attested` is checked BEFORE the refusal is raised rather
 * than after: an escape hatch behind a refusal is not an escape hatch.
 *
 * `readManifest` is injected (given a raw `Verified by:` value, return the
 * file or null) so this stays pure and layout-blind: path resolution is the
 * CLI's job, through the same `resolveArtifactPath` Gate 4 uses.
 */
export function resolveGoalMeasures(
  goals: readonly PrdGoal[],
  blocks: readonly EBlock[],
  readManifest: (verifiedBy: string) => string | null,
  attested: ReadonlySet<string> = new Set<string>(),
): Map<string, GoalMeasure> {
  const byGoal = new Map<string, GoalMeasure[]>();
  for (const block of blocks) {
    const covered = block.covers === null ? [] : parseCoversIds(block.covers);
    const goalIds = covered.filter((id) => id.startsWith("G-"));
    if (goalIds.length === 0) continue;

    const found: Array<{ command: string; window: string | null; origin: string }> = [];
    const inline = parseMeasureField(block.measure);
    if (inline !== null) {
      found.push({
        command: inline.command,
        window: inline.window,
        origin: `${block.id} Measure:`,
      });
    } else if (block.verifiedBy !== null) {
      const target = block.verifiedBy.replace(/`/g, "").trim();
      if (target.toLowerCase().endsWith(".md")) {
        const md = readManifest(target);
        if (md !== null) {
          for (const step of outcomeMeasures(md)) {
            if (step.run === null) continue;
            found.push({
              command: step.run,
              window: step.window,
              origin: `${block.id} ${target} step ${step.index} (${step.type})`,
            });
          }
        }
      }
    }
    for (const goalId of goalIds) {
      const list = byGoal.get(goalId) ?? [];
      for (const f of found) list.push({ goalId, eId: block.id, ...f });
      byGoal.set(goalId, list);
    }
  }

  const out = new Map<string, GoalMeasure>();
  const defined = new Set(goals.map((g) => g.id));
  for (const [goalId, list] of byGoal) {
    // A measure on an expectation covering an ID the PRD never defines is
    // gate-prd's `covers-id-dangling` FAIL, not this command's business.
    if (!defined.has(goalId) || list.length === 0) continue;
    // An attested goal is not scored from a measure at all, so which of its
    // measures "wins" is a question nobody asked.
    if (attested.has(goalId)) continue;
    if (list.length > 1) {
      throw new OutcomeRefusal(
        `${goalId} has ${list.length} runnable measures (${list
          .map((m) => m.origin)
          .join("; ")}) — a goal scores from exactly one; remove the extras, or pass --attested ${goalId} --goal ${goalId}=<value> --source ${goalId}=<who/where> to record a human-attested figure instead`,
      );
    }
    out.set(goalId, list[0]);
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
  /** Goals whose measure RAN this session (`--run`), keyed by goal ID. */
  measured?: ReadonlyMap<string, MeasuredValue>;
  /** Goals that NAME a runnable measure which was not run — i.e. `--run`
   *  was omitted. Each refuses rather than accepting a hand-typed figure. */
  unrun?: ReadonlyMap<string, GoalMeasure>;
  /** Goals the operator explicitly attested (`--attested G-1`): the number
   *  is hand-supplied AND labelled as such in the artifact. */
  attested?: ReadonlySet<string>;
}

export interface GoalRow {
  id: string;
  /** Target column: the goal's prd/agent.md definition text. */
  target: string;
  actual: string;
  source: string;
  verdict: GoalRowVerdict;
  /** How the verdict was derived (for the JSON audit trail). */
  derivation: "explicit" | "comparator" | "recorded";
  /** How the ACTUAL was obtained — orthogonal to `derivation`, which is
   *  about the verdict. `measured` is the only one §16 calls a result. */
  provenance: "measured" | "attested" | "hand-typed";
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
 * Score every prd/agent.md goal. Bidirectional coverage is required (the gate-prd
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
      "the PRD defines no G- goals — nothing to score (outcome scoring is keyed to the PRD's numeric goals)",
    );
  }
  const defined = new Set(goals.map((g) => g.id));
  const measured = input.measured ?? new Map<string, MeasuredValue>();
  const unrun = input.unrun ?? new Map<string, GoalMeasure>();
  const attested = input.attested ?? new Set<string>();

  // A goal whose measure RAN needs no --goal, and must not be handed one:
  // "measurement is run, not asked for" (§16) only bites if the un-run
  // number is refused rather than merely discouraged. Same for --source —
  // the source of a measured goal is the command, the value, the window and
  // the clock, all of which this command produced itself.
  for (const [id, m] of measured) {
    if (input.actuals.has(id)) {
      throw new OutcomeRefusal(
        `--goal ${id}=${input.actuals.get(id) ?? ""} was supplied but ${id} has a runnable measure (${m.measure.origin}) which this run executed — a hand-typed figure is not a result; drop the flag, or pass --attested ${id} to record an attested number instead`,
      );
    }
    if (input.sources.has(id)) {
      throw new OutcomeRefusal(
        `--source ${id}=... was supplied but ${id}'s source is computed from its measure (command, value, window, timestamp) — drop the flag`,
      );
    }
  }

  // A goal that NAMES a measure nobody ran. Refusing (rather than silently
  // accepting the --goal value) is the whole point: the operator either runs
  // it or says out loud, in the artifact, that a human vouched for the
  // number. Both are honest; a quiet hand-type is not.
  for (const [id, measure] of unrun) {
    if (measured.has(id) || attested.has(id)) continue;
    throw new OutcomeRefusal(
      `${id} names a runnable measure (${measure.origin}: \`${measure.command}\`) — re-run with --run so the figure is measured, or pass --attested ${id} --source ${id}=<who/where> to record it as human-attested`,
    );
  }

  const needsActual = goals.filter((g) => !measured.has(g.id));
  const missing = needsActual
    .filter((g) => !input.actuals.has(g.id))
    .map((g) => g.id);
  if (missing.length > 0) {
    throw new OutcomeRefusal(
      `every PRD goal needs a --goal flag (or a measure this run executed); missing: ${missing.join(", ")}`,
    );
  }
  for (const id of input.actuals.keys()) {
    if (!defined.has(id)) {
      throw new OutcomeRefusal(
        `--goal names '${id}' but the PRD defines no such goal (defined: ${[...defined].join(", ")})`,
      );
    }
  }
  for (const map of [input.sources, input.results] as const) {
    for (const id of map.keys()) {
      if (!defined.has(id)) {
        throw new OutcomeRefusal(
          `flag names '${id}' but the PRD defines no such goal`,
        );
      }
    }
  }
  for (const id of attested) {
    if (!defined.has(id)) {
      throw new OutcomeRefusal(
        `--attested names '${id}' but the PRD defines no such goal`,
      );
    }
    // An attestation with no provenance is a vibe with a flag on it. The
    // whole reason this escape hatch is allowed is that it is RECORDED.
    if ((input.sources.get(id) ?? "").trim() === "") {
      throw new OutcomeRefusal(
        `--attested ${id} requires --source ${id}=<who/where> — an attested number has to say who vouched for it`,
      );
    }
  }

  const rows: GoalRow[] = goals.map((g) => {
    const run = measured.get(g.id);
    const actual = run !== undefined ? run.value : (input.actuals.get(g.id) ?? "");
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
    const handSource = input.sources.get(g.id) ?? "(not recorded)";
    return {
      id: g.id,
      target: g.text || "(definition text not extractable)",
      actual,
      source:
        run !== undefined
          ? formatMeasuredSource(run)
          : attested.has(g.id)
            ? `attested — ${handSource}`
            : handSource,
      verdict,
      derivation,
      provenance:
        run !== undefined
          ? "measured"
          : attested.has(g.id)
            ? "attested"
            : "hand-typed",
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
  /** Gate verdicts to erase (hfi102) — the FULL reopened set, not the
   *  flags-true delta: tune always reopens the evals gate, and a stale
   *  `gate_verdicts.evals` must not outlive the reopen even when
   *  `evals_red` was already false (same semantics as revise's
   *  verdictsCleared). */
  verdictsCleared: GateKey[];
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
    verdictsCleared: ["evals"],
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
