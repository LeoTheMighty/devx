// Gates 2 & 3 — the state-aware two-mode coverage gate (v2e101).
//
// Split of labor (v2/02-engine.md §4.4): the semantic covered/partial
// judgment is a single schema-constrained subagent run by the skill body;
// it hands the CLI a tri-state table via `--table <json>`. EVERYTHING else
// is mechanical and lives here:
//
//   - mode detection      (design/agent.md exists ∧ ¬design_verified → design;
//                          else plan/agent.md ∧ ¬plan_verified → plan; the
//                          earlier open gate always wins)
//   - source-ID extraction (design mode: G-/UC-/CAP-/FR- defs in prd/agent.md;
//                          plan mode: E-ids in expectations.md)
//   - table completeness  (every source ID has exactly one row)
//   - verdict computation (FAIL = any ❌ or unmet P0 floor; CONCERNS =
//                          only ⚠️; PASS = all ✅ — D-9 vocabulary)
//   - P0 floor            (plan mode: every P0 E-row `covered` AND naming
//                          a runnable artifact path)
//   - report writing      (decisions/<date>-<mode>-verify.md via the
//                          shared verdict module, extras section included)
//   - execution graph     (plan mode only, harness-s5: the plan's optional
//                          `## Execution graph` is checked by plan-graph.ts
//                          and folded in via `applyGraphFindings` — a `fail`
//                          finding is a FAIL, a `concern` is CONCERNS at most)
//   - hygiene             (design mode only, harness-s4: §18/§21 content
//                          checks — decision residue, duplicated fact,
//                          ungrounded load-bearing claim, bare decision. The
//                          subagent judges them into `hygiene`; two are
//                          mechanical here (`mechanicalHygiene`). Folded in
//                          via `applyHygieneFindings`: CONCERNS at most,
//                          never FAIL — the design advances with the finding
//                          on record)
//
// Table JSON shape (authored by the subagent):
//
//   {
//     "rows": [
//       { "id": "G-1", "status": "covered", "where": "…", "note": "…",
//         "artifact": "test/x.test.ts" }   // artifact: plan mode only
//     ],
//     "extras": [ { "item": "…", "where": "…" } ],
//     "hygiene": [ { "kind": "residue", "where": "…", "note": "…" } ]
//                                          // design mode only; optional
//   }
//
// Rows whose id is not a source ID are NOT errors — they land in the
// "Extras requiring product approval" section (scope creep flagged
// neutrally, §4.4).
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.4; D-9 (verdict vocabulary)

import { type EngineState } from "./frontmatter.js";
import {
  normalizePriority,
  parseExpectations,
} from "./expectations.js";
import { extractDefinedIds, isConcreteVerifiedBy } from "./gate-prd.js";
import {
  INACTIVE_WAIVER,
  type Verdict,
  renderVerdictBlock,
} from "./verdict.js";
import { type GraphCheck, effectiveParallelSafe } from "./plan-graph.js";
import { fencedLineMask } from "./md-fence.js";

export type CoverageMode = "design" | "plan";
export type TriState = "covered" | "partial" | "missing";

export interface CoverageRow {
  id: string;
  status: TriState;
  where: string;
  note: string;
  artifact: string | null;
}

export interface CoverageExtra {
  item: string;
  where: string;
}

/** The design-mode hygiene lens's four finding kinds (gap analysis A6/C6):
 *
 *  - `residue`       decision narrative in the design body ("we chose",
 *                    Q→A lists, dated history) — it belongs in `decisions/`,
 *                    linked from the Decision log
 *  - `duplication`   one fact spelled out in two sections — one home per fact
 *  - `ungrounded`    a load-bearing claim about existing code with no
 *                    citation and no research finding behind it
 *  - `bare-decision` a load-bearing choice with no alternative weighed
 *                    (nothing in Trade-offs / Discarded, no record linked) */
export const HYGIENE_KINDS = ["residue", "duplication", "ungrounded", "bare-decision"] as const;
export type HygieneKind = (typeof HYGIENE_KINDS)[number];

export interface HygieneFinding {
  kind: HygieneKind;
  where: string;
  note: string;
  /** `judgment` = the subagent's table; `cli` = `mechanicalHygiene`. */
  by: "judgment" | "cli";
}

export interface CoverageTable {
  rows: CoverageRow[];
  extras: CoverageExtra[];
  /** Design-mode advisory lens; `[]` when the table carries none. */
  hygiene: HygieneFinding[];
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

export interface ModeDetectInputs {
  state: EngineState;
  designExists: boolean;
  planExists: boolean;
  /** Repo-relative display path of the design subject, resolved through the
   *  layout by the caller. The refusals below tell an author which file to
   *  go write, so they must name the file THIS repo would have. */
  designRel: string;
  /** Repo-relative display path of the plan subject. Same contract. */
  planRel: string;
}

export type ModeDetectResult =
  | { mode: CoverageMode }
  /** `closed` marks the one refusal that is about a gate having PASSED
   *  rather than not being ready: both coverage gates are shut, so the only
   *  way to a re-stamp is `devx revise`, and the CLI says so. */
  | { mode: null; refusal: string; closed?: true };

export function detectCoverageMode(i: ModeDetectInputs): ModeDetectResult {
  const gs = i.state.gateStatus;
  // Gates can't pass before their predecessor (tenet 2): the coverage gate
  // is meaningless before Gate 1.
  if (!gs.prd_validated) {
    return {
      mode: null,
      refusal:
        "Gate 1 (prd) has not passed — run `devx gate prd` before any coverage gate",
    };
  }
  // Earlier open gate wins: an unverified design/agent.md takes precedence over
  // an open plan gate even when plan/agent.md also exists.
  if (i.designExists && !gs.design_verified) return { mode: "design" };
  if (!gs.design_verified) {
    return {
      mode: null,
      refusal:
        `design gate is open but ${i.designRel} does not exist — run \`/devx design\` first`,
    };
  }
  if (i.planExists && !gs.plan_verified) return { mode: "plan" };
  if (!gs.plan_verified) {
    return {
      mode: null,
      refusal:
        `plan gate is open but ${i.planRel} does not exist — run \`/devx plan\` first`,
    };
  }
  return {
    mode: null,
    refusal:
      "no open coverage gate — design_verified and plan_verified are both true",
    closed: true,
  };
}

// ---------------------------------------------------------------------------
// Source-ID extraction
// ---------------------------------------------------------------------------

/**
 * design mode: one row per G-/UC-/CAP-/FR- ID defined in prd/agent.md.
 * plan mode: one row per E-id in expectations.md.
 */
export function extractSourceIds(
  mode: CoverageMode,
  files: { prd: string; expectations: string },
): string[] {
  if (mode === "design") {
    return extractDefinedIds(files.prd).map((r) => r.id);
  }
  return parseExpectations(files.expectations).map((b) => b.id);
}

/**
 * Which coverage gate a judgment table judges, read off the source IDs its
 * rows key: the one mode whose IDs it names, or null when it names both or
 * neither.
 *
 * This is the caller's half of mode selection. `detectCoverageMode` picks
 * the gate from STATE; the table is what the caller actually judged, and the
 * CLI refuses when the two disagree — otherwise a design table handed in
 * after Gate 2 closed is quietly run against Gate 3, and only completeness
 * happens to stop it.
 *
 * Both-or-neither is deliberately null, not a refusal: off-source rows were
 * always tolerated as extras, so a complete design table with one stray
 * E-id still judges design; and a table keying nothing is the completeness
 * check's to report. Matching is exact, as `computeCoverageVerdict` keys
 * rows, so a row this reads as one mode's is a row the verdict would count.
 */
export function tableJudges(
  table: CoverageTable,
  files: { prd: string; expectations: string },
): CoverageMode | null {
  const keys = (mode: CoverageMode): boolean => {
    const ids = new Set(extractSourceIds(mode, files));
    return table.rows.some((row) => ids.has(row.id));
  };
  const design = keys("design");
  const plan = keys("plan");
  if (design === plan) return null;
  return design ? "design" : "plan";
}

/** E-id → normalized priority (plan-mode P0-floor input). */
export function expectationPriorities(
  expectations: string,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const b of parseExpectations(expectations)) {
    out.set(b.id, normalizePriority(b.priority));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Table parse + validation
// ---------------------------------------------------------------------------

const STATUS_ALIASES: Record<string, TriState> = {
  covered: "covered",
  full: "covered",
  "✅": "covered",
  partial: "partial",
  "⚠️": "partial",
  missing: "missing",
  "❌": "missing",
};

export type TableParseResult =
  | { ok: true; table: CoverageTable }
  | { ok: false; error: string };

export function parseCoverageTable(json: string): TableParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: `table is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "table root must be a JSON object" };
  }
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.rows)) {
    return { ok: false, error: "table must have a `rows` array" };
  }
  const rows: CoverageRow[] = [];
  for (let i = 0; i < root.rows.length; i++) {
    const raw = root.rows[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `rows[${i}] must be an object` };
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id.trim() === "") {
      return { ok: false, error: `rows[${i}] has no string \`id\`` };
    }
    const statusRaw =
      typeof r.status === "string" ? r.status.trim().toLowerCase() : "";
    const status = STATUS_ALIASES[statusRaw] ?? STATUS_ALIASES[String(r.status ?? "").trim()];
    if (!status) {
      return {
        ok: false,
        error: `rows[${i}] (id=${r.id}) has unknown status '${String(r.status)}' (expected covered|partial|missing)`,
      };
    }
    rows.push({
      id: r.id.trim(),
      status,
      where: typeof r.where === "string" ? r.where : "",
      note: typeof r.note === "string" ? r.note : "",
      artifact:
        typeof r.artifact === "string" && r.artifact.trim() !== ""
          ? r.artifact.trim()
          : null,
    });
  }
  const extras: CoverageExtra[] = [];
  if (root.extras !== undefined) {
    if (!Array.isArray(root.extras)) {
      return { ok: false, error: "`extras` must be an array when present" };
    }
    for (let i = 0; i < root.extras.length; i++) {
      const raw = root.extras[i];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, error: `extras[${i}] must be an object` };
      }
      const x = raw as Record<string, unknown>;
      if (typeof x.item !== "string" || x.item.trim() === "") {
        return { ok: false, error: `extras[${i}] has no string \`item\`` };
      }
      extras.push({
        item: x.item.trim(),
        where: typeof x.where === "string" ? x.where : "",
      });
    }
  }
  const hygiene: HygieneFinding[] = [];
  if (root.hygiene !== undefined) {
    if (!Array.isArray(root.hygiene)) {
      return { ok: false, error: "`hygiene` must be an array when present" };
    }
    for (let i = 0; i < root.hygiene.length; i++) {
      const raw = root.hygiene[i];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, error: `hygiene[${i}] must be an object` };
      }
      const h = raw as Record<string, unknown>;
      const kind = hygieneKindOf(h.kind);
      if (kind === null) {
        return {
          ok: false,
          error: `hygiene[${i}] has unknown kind '${String(h.kind)}' (expected ${HYGIENE_KINDS.join("|")})`,
        };
      }
      // A finding with no location or no statement is not actionable — the
      // lens is advisory, but a receipt-less advisory is noise.
      for (const field of ["where", "note"] as const) {
        if (typeof h[field] !== "string" || (h[field] as string).trim() === "") {
          return { ok: false, error: `hygiene[${i}] (kind=${kind}) has no string \`${field}\`` };
        }
      }
      // One line each: `where` becomes a health-queue entry title (a
      // markdown heading), where a newline would split the entry in two.
      hygiene.push({
        kind,
        where: (h.where as string).replace(/\s+/g, " ").trim(),
        note: (h.note as string).replace(/\s+/g, " ").trim(),
        by: "judgment",
      });
    }
  }
  return { ok: true, table: { rows, extras, hygiene } };
}

/** Normalize a judged kind: case, `_`/space → `-`. Exact names only after
 *  that — a schema-constrained subagent that invents a fifth kind is invalid
 *  input, the same as an unknown coverage status. */
function hygieneKindOf(v: unknown): HygieneKind | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return (HYGIENE_KINDS as readonly string[]).includes(k) ? (k as HygieneKind) : null;
}

// ---------------------------------------------------------------------------
// Hygiene — the mechanical half (design mode)
// ---------------------------------------------------------------------------

/** A heading that names a settled-questions list: `## Resolved design
 *  questions`, `### Resolved questions`, … — the section 8am's Gate 2 flags by
 *  name (§18). Its content is Q→A history, which is exactly what a decision
 *  record holds and a current-state design does not. */
const RESOLVED_QUESTIONS_HEADING_RE = /^#{2,4}\s+(resolved\b.*?\bquestions?\b.*?)(?:\s+#+)?\s*$/i;

export interface MechanicalHygieneInputs {
  /** design/agent.md content. */
  design: string;
  designRel: string;
  /** Whether the Design stage's captured research exists. */
  researchPresent: boolean;
  researchRel: string;
}

/**
 * The two hygiene checks a program can make without judgment. Everything
 * else in the lens is the subagent's (residue phrasing, duplication,
 * groundedness of a specific claim, whether a decision was weighed):
 * phrase scans for "instead of" and kin were measured against this repo's
 * nine shipped designs and read as ordinary prose far more often than as
 * residue, so they stay judgment.
 */
export function mechanicalHygiene(i: MechanicalHygieneInputs): HygieneFinding[] {
  const out: HygieneFinding[] = [];
  const lines = i.design.split("\n");
  const fenced = fencedLineMask(lines);
  for (let n = 0; n < lines.length; n++) {
    if (fenced[n]) continue;
    const m = RESOLVED_QUESTIONS_HEADING_RE.exec(lines[n].replace(/\r$/, ""));
    if (m) {
      out.push({
        kind: "residue",
        where: `${i.designRel} § ${m[1]}`,
        note: "a list of settled questions is decision history — move each answer into the design body in present tense, its reasoning into a decisions/ record, and list the record in the Decision log",
        by: "cli",
      });
    }
  }
  if (!i.researchPresent) {
    out.push({
      kind: "ungrounded",
      where: i.researchRel,
      note: "no captured research — load-bearing claims about existing code have no findings to trace to; run the Design stage's research step",
      by: "cli",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verdict computation
// ---------------------------------------------------------------------------

/**
 * One source ID this run did not clear, with the severity its own verdict
 * contribution proves — `blocking` when it is what made the run FAIL
 * (❌ missing, or an unmet P0 floor), `concern` when the run still advances
 * (⚠️ partial).
 *
 * Emitted alongside `reasons` rather than derived from it: severity is
 * decided by the same branches that set `anyMissing` / `anyPartial`, and a
 * consumer re-deriving it from the reason STRINGS would be a second,
 * drifting copy of the floor rule. One finding per ID, not per reason — a
 * P0 expectation that is missing contributes three reasons and is one defect.
 *
 * Read by `devx gate coverage`'s health-queue reconcile (B11). Never by the
 * verdict: `verdict` is computed from the same loop and does not look here.
 */
export interface CoverageFinding {
  id: string;
  severity: "blocking" | "concern";
  /** Every reason recorded for this ID, joined — the entry's Recommendation. */
  detail: string;
}

export interface CoverageComputation {
  verdict: Extract<Verdict, "PASS" | "CONCERNS" | "FAIL">;
  /** Human-precise reasons behind a FAIL / CONCERNS. */
  reasons: string[];
  /** The same shortfalls, one per source ID and severity-classified. */
  findings: CoverageFinding[];
  /** Source-keyed rows in source order. */
  keyedRows: CoverageRow[];
  /** Table rows whose id is not a source ID → extras section. */
  extraRows: CoverageRow[];
  /** Source IDs with no table row — a completeness error, computed here so
   *  the caller can exit 2 with the full list. */
  missingRowIds: string[];
  /** Source IDs with >1 table row. */
  duplicateRowIds: string[];
  /** Design-mode advisory findings (`applyHygieneFindings`); `[]` otherwise. */
  hygiene: HygieneFinding[];
}

export function computeCoverageVerdict(
  mode: CoverageMode,
  sourceIds: string[],
  table: CoverageTable,
  priorities: Map<string, string | null>,
): CoverageComputation {
  const sourceSet = new Set(sourceIds);
  const byId = new Map<string, CoverageRow[]>();
  const extraRows: CoverageRow[] = [];
  for (const row of table.rows) {
    if (!sourceSet.has(row.id)) {
      extraRows.push(row);
      continue;
    }
    const list = byId.get(row.id) ?? [];
    list.push(row);
    byId.set(row.id, list);
  }

  const missingRowIds = sourceIds.filter((id) => !byId.has(id));
  const duplicateRowIds = sourceIds.filter(
    (id) => (byId.get(id)?.length ?? 0) > 1,
  );

  const keyedRows: CoverageRow[] = [];
  const reasons: string[] = [];
  // id → its shortfalls. `blocking` latches true: a P0 partial is blocking
  // even though `partial` alone is not, and the floor branch below is what
  // knows that.
  const shortfalls = new Map<string, { blocking: boolean; details: string[] }>();
  const note = (id: string, blocking: boolean, detail: string): void => {
    const cur = shortfalls.get(id) ?? { blocking: false, details: [] };
    cur.blocking = cur.blocking || blocking;
    cur.details.push(detail);
    shortfalls.set(id, cur);
  };
  let anyMissing = false;
  let anyPartial = false;

  for (const id of sourceIds) {
    const row = byId.get(id)?.[0];
    if (!row) continue; // completeness error — caller refuses before verdict
    keyedRows.push(row);
    if (row.status === "missing") {
      anyMissing = true;
      const reason = `${id} is ❌ missing${row.note ? ` (${row.note})` : ""}`;
      reasons.push(reason);
      note(id, true, reason);
    } else if (row.status === "partial") {
      anyPartial = true;
      const reason = `${id} is ⚠️ partial${row.note ? ` (${row.note})` : ""}`;
      reasons.push(reason);
      note(id, false, reason);
    }

    // P0 floor — plan mode only: every P0 expectation `covered` AND naming
    // a runnable artifact path.
    if (mode === "plan" && priorities.get(id) === "P0") {
      if (row.status !== "covered") {
        anyMissing = true;
        const reason = `P0 floor unmet: ${id} is P0 but not fully covered (status: ${row.status})`;
        reasons.push(reason);
        note(id, true, reason);
      }
      if (row.artifact === null || !isConcreteVerifiedBy(row.artifact)) {
        anyMissing = true;
        const reason = `P0 floor unmet: ${id} is P0 but names no runnable artifact path${row.artifact ? ` ('${row.artifact}' is not path-shaped)` : ""}`;
        reasons.push(reason);
        note(id, true, reason);
      }
    }
  }

  const verdict: CoverageComputation["verdict"] = anyMissing
    ? "FAIL"
    : anyPartial
      ? "CONCERNS"
      : "PASS";

  // Source order, so the queue's entry order matches the report's.
  const findings: CoverageFinding[] = sourceIds
    .filter((id) => shortfalls.has(id))
    .map((id) => {
      const s = shortfalls.get(id)!;
      return {
        id,
        severity: s.blocking ? ("blocking" as const) : ("concern" as const),
        detail: s.details.join("; "),
      };
    });

  return {
    verdict,
    reasons,
    findings,
    keyedRows,
    extraRows,
    missingRowIds,
    duplicateRowIds,
    hygiene: [],
  };
}

/**
 * Fold the design-mode hygiene lens into a computation (harness-s4). Pure and
 * additive, the same shape as `applyGraphFindings`: coverage rows are
 * untouched, and the verdict moves PASS → CONCERNS at most — **never to
 * FAIL**, and never off a FAIL the coverage rows already earned. One summary
 * reason, not one per finding: the report's Hygiene section carries them,
 * and repeating each in Verdict detail would be the duplication the lens
 * exists to flag. Plan mode never calls this.
 */
export function applyHygieneFindings(
  c: CoverageComputation,
  findings: readonly HygieneFinding[],
): CoverageComputation {
  if (findings.length === 0) return c;
  const counts = HYGIENE_KINDS.map((k) => [k, findings.filter((f) => f.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const n = findings.length;
  return {
    ...c,
    hygiene: [...findings],
    verdict: c.verdict === "PASS" ? "CONCERNS" : c.verdict,
    reasons: [
      ...c.reasons,
      `hygiene: ${n} advisory finding${n === 1 ? "" : "s"} (${counts}) — CONCERNS at most, never FAIL`,
    ],
  };
}

/**
 * Fold the plan's Execution graph findings into a plan-mode computation
 * (harness-s5). Pure and additive: coverage rows are untouched, the
 * verdict only ever moves toward FAIL, and a plan with no graph section is
 * a no-op. Design mode never calls this.
 */
export function applyGraphFindings(
  c: CoverageComputation,
  check: GraphCheck,
): CoverageComputation {
  if (!check.present || check.findings.length === 0) return c;
  const reasons = [...c.reasons, ...check.findings.map((f) => `execution graph: ${f.message}`)];
  let verdict = c.verdict;
  if (check.failed) verdict = "FAIL";
  else if (verdict === "PASS") verdict = "CONCERNS";
  return { ...c, verdict, reasons };
}

// ---------------------------------------------------------------------------
// Report rendering — decisions/<date>-<mode>-verify.md
// ---------------------------------------------------------------------------

const STATUS_GLYPH: Record<TriState, string> = {
  covered: "✅",
  partial: "⚠️",
  missing: "❌",
};

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderVerifyReport(args: {
  mode: CoverageMode;
  hash: string;
  workstreamRel: string;
  date: string;
  computation: CoverageComputation;
  extras: CoverageExtra[];
  /** The four artifact paths this report NAMES, each resolved through the
   *  layout by the caller. The report is a committed record a human reads
   *  weeks later; a Subject line citing a file the repo does not have is
   *  the same defect as a gap pointing at one. */
  subjects: {
    prdRel: string;
    designRel: string;
    planRel: string;
    expectationsRel: string;
  };
  /** Plan mode only (harness-s5). Omitted / null in design mode. */
  graph?: GraphCheck | null;
}): string {
  const { mode, computation: c, subjects } = args;
  const source =
    mode === "design"
      ? subjects.prdRel
      : `${subjects.designRel} + ${subjects.expectationsRel}`;
  const subject = mode === "design" ? subjects.designRel : subjects.planRel;
  const statusReason =
    c.verdict === "PASS"
      ? `All ${c.keyedRows.length} source IDs fully covered in ${mode} mode.`
      : c.reasons.slice(0, 2).join(" ") +
        (c.reasons.length > 2 ? ` (+${c.reasons.length - 2} more)` : "");

  const lines: string[] = [];
  lines.push(
    renderVerdictBlock({
      gate: c.verdict,
      statusReason,
      reviewer: `devx gate coverage (${mode} mode)`,
      updated: args.date,
      waiver: INACTIVE_WAIVER,
    }),
  );
  lines.push(`# Verify — ${args.workstreamRel} — ${args.date}`);
  lines.push("");
  lines.push("## Subject");
  lines.push("");
  lines.push(
    `\`${subject}\` reviewed against \`${source}\` (${mode} mode; workstream \`${args.hash}\`).`,
  );
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push("| ID | Status | Where covered | Note |");
  lines.push("|---|---|---|---|");
  for (const row of c.keyedRows) {
    lines.push(
      `| ${mdCell(row.id)} | ${STATUS_GLYPH[row.status]} | ${mdCell(row.where)} | ${mdCell(row.note)} |`,
    );
  }
  lines.push("");
  lines.push("## Extras requiring product approval");
  lines.push("");
  const extraLines: string[] = [];
  for (const row of c.extraRows) {
    extraLines.push(`- ${row.id} — ${row.where || row.note || "(no location given)"}`);
  }
  for (const x of args.extras) {
    extraLines.push(`- ${x.item}${x.where ? ` — ${x.where}` : ""}`);
  }
  if (extraLines.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...extraLines);
  }
  // ── Design-mode-only section (harness-s4). ──────────────────────────
  // Rendered on every design run, `- none` included, so a clean lens is an
  // explicit zero rather than an absent section a reader cannot tell from
  // a pre-lens report.
  if (mode === "design") {
    lines.push("");
    lines.push("## Hygiene (advisory)");
    lines.push("");
    if (c.hygiene.length === 0) {
      lines.push("- none");
    } else {
      lines.push("Holds the verdict at CONCERNS at most; never FAILs it.");
      lines.push("");
      lines.push("| Kind | Where | Note | By |");
      lines.push("|---|---|---|---|");
      for (const h of c.hygiene) {
        lines.push(`| ${h.kind} | ${mdCell(h.where)} | ${mdCell(h.note)} | ${h.by} |`);
      }
    }
  }
  // ── Plan-mode-only section (harness-s5). ────────────────────────────
  if (mode === "plan" && args.graph) {
    lines.push("");
    lines.push("## Execution graph");
    lines.push("");
    const g = args.graph;
    if (!g.present) {
      lines.push("- none declared — the plan is serial-only; phases emit in checklist order.");
    } else if (g.graph === null) {
      lines.push("- declared but unreadable (see Verdict detail).");
    } else {
      lines.push("| Phase | Depends on | Parallel-safe | Changes |");
      lines.push("|---|---|---|---|");
      for (const p of [...g.graph.phases].sort((a, b) => a.id - b.id)) {
        const touched = [...(g.files.get(p.id) ?? []), ...p.touches];
        lines.push(
          `| ${p.id} | ${p.dependsOn.length ? p.dependsOn.join(", ") : "—"} | ${effectiveParallelSafe(p) ? "yes" : "no"} | ${mdCell(touched.join(", ") || "—")} |`,
        );
      }
      if (g.graph.waivers.length > 0) {
        lines.push("");
        for (const w of g.graph.waivers) {
          lines.push(
            `- waiver: phases ${w.phases.join(", ")}${w.paths.length ? ` on ${w.paths.join(", ")}` : ""} — ${w.approver || "(no approver)"}: ${w.reason || "(no reason)"}`,
          );
        }
      }
    }
    for (const f of g.findings) {
      lines.push(`- ${f.severity === "fail" ? "❌" : "⚠️"} ${f.message}`);
    }
  }
  lines.push("");
  lines.push("## Verdict detail");
  lines.push("");
  if (c.reasons.length === 0) {
    lines.push(`PASS — every source ID is ✅ covered.`);
  } else {
    for (const r of c.reasons) lines.push(`- ${r}`);
    if (c.verdict === "FAIL") {
      lines.push("");
      lines.push(
        "Unblock by covering every ❌ row (and, in plan mode, meeting the P0 floor), then re-run `devx gate coverage`.",
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
