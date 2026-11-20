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
//
// Table JSON shape (authored by the subagent):
//
//   {
//     "rows": [
//       { "id": "G-1", "status": "covered", "where": "…", "note": "…",
//         "artifact": "test/x.test.ts" }   // artifact: plan mode only
//     ],
//     "extras": [ { "item": "…", "where": "…" } ]
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

export interface CoverageTable {
  rows: CoverageRow[];
  extras: CoverageExtra[];
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
  | { mode: null; refusal: string };

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
  return { ok: true, table: { rows, extras } };
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
  // ── Plan-mode-only section (harness-s5). ────────────────────────────
  // SEAM: design-mode additions (the advisory hygiene lens, Stream 4 of
  // docs/updates/8am-harness-gap-analysis.md) belong in their own block,
  // gated on `mode === "design"`, not inside this one.
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
