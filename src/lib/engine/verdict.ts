// Shared verdict-block writer/parser (v2e101).
//
// Every gate/report artifact in the v2 engine opens with a schema-fixed YAML
// verdict block (design tenet 5, v2/02-engine.md §1: "deterministic verdicts
// ... computed from tables and ID sets, not vibes"). One module owns the
// shape so `devx gate coverage` and `devx gate evals` (and later checkpoint
// writers) can never drift from each other or from the templates in
// `_devx/templates/engine/` (decision.md, red-report.md, checkpoint.md).
//
// Vocabulary is locked by D-9 (v2/07-decisions.md): PASS | CONCERNS | FAIL |
// WAIVED, and WAIVED requires a named approver + reason. render throws on a
// D-9 violation rather than emitting an invalid artifact.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.4 (verdict block, "steal verbatim")

import { parse as parseYaml } from "yaml";

export const VERDICTS = ["PASS", "CONCERNS", "FAIL", "WAIVED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Waiver {
  active: boolean;
  approver: string | null;
  reason: string | null;
}

export interface VerdictBlock {
  gate: Verdict;
  /** 1–2 sentences; lands in `status_reason:` single-quoted. */
  statusReason: string;
  /** e.g. `devx gate coverage (plan mode)` / `devx gate evals`. */
  reviewer: string;
  /** YYYY-MM-DD. */
  updated: string;
  waiver: Waiver;
}

export const INACTIVE_WAIVER: Waiver = {
  active: false,
  approver: null,
  reason: null,
};

/**
 * D-9 structural validation. Returns [] when the block is well-formed.
 * Checked on both render (refuse to write an invalid artifact) and parse
 * (surface a hand-edited violation to the caller).
 */
export function validateVerdictBlock(block: VerdictBlock): string[] {
  const issues: string[] = [];
  if (!(VERDICTS as readonly string[]).includes(block.gate)) {
    issues.push(
      `gate '${block.gate}' is not in the D-9 vocabulary (${VERDICTS.join(" | ")})`,
    );
  }
  if (block.statusReason.trim() === "") {
    issues.push("status_reason must be non-empty");
  }
  if (block.reviewer.trim() === "") {
    issues.push("reviewer must be non-empty");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(block.updated)) {
    issues.push(`updated '${block.updated}' is not YYYY-MM-DD`);
  }
  const w = block.waiver;
  if (block.gate === "WAIVED") {
    if (!w.active) issues.push("WAIVED verdict requires waiver.active: true");
    if (!w.approver || w.approver.trim() === "") {
      issues.push("WAIVED verdict requires a named waiver.approver (D-9)");
    }
    if (!w.reason || w.reason.trim() === "") {
      issues.push("WAIVED verdict requires a waiver.reason (D-9)");
    }
  } else if (w.active) {
    issues.push(`waiver.active is true but gate is ${block.gate}, not WAIVED`);
  }
  return issues;
}

function sq(s: string): string {
  // YAML single-quoted scalar: double any embedded single quotes.
  return `'${s.replace(/'/g, "''")}'`;
}

function waiverScalar(v: string | null): string {
  return v === null ? "null" : sq(v);
}

/**
 * Render the block as a markdown frontmatter stanza, byte-shaped to match
 * the templates (`_devx/templates/engine/decision.md` / `red-report.md`):
 *
 *   ---
 *   gate: PASS
 *   status_reason: '<1–2 sentences>'
 *   reviewer: 'devx gate coverage (plan mode)'
 *   updated: 2026-07-05
 *   waiver: { active: false, approver: null, reason: null }
 *   ---
 *
 * Throws on a D-9 violation (see validateVerdictBlock).
 */
export function renderVerdictBlock(block: VerdictBlock): string {
  const issues = validateVerdictBlock(block);
  if (issues.length > 0) {
    throw new Error(`invalid verdict block: ${issues.join("; ")}`);
  }
  const w = block.waiver;
  return [
    "---",
    `gate: ${block.gate}`,
    `status_reason: ${sq(block.statusReason)}`,
    `reviewer: ${sq(block.reviewer)}`,
    `updated: ${block.updated}`,
    `waiver: { active: ${w.active}, approver: ${waiverScalar(w.approver)}, reason: ${waiverScalar(w.reason)} }`,
    "---",
    "",
  ].join("\n");
}

export interface ParsedVerdict {
  block: VerdictBlock;
  /** D-9/shape violations found while parsing; empty for a clean block. */
  issues: string[];
}

/**
 * Parse the leading verdict block out of a gate artifact. Returns null when
 * the file has no frontmatter block or the block lacks a `gate:` key (i.e.
 * it isn't a verdict artifact at all). A present-but-invalid block parses
 * with `issues` populated — callers decide whether to hard-fail.
 */
export function parseVerdictBlock(content: string): ParsedVerdict | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(m[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const fm = parsed as Record<string, unknown>;
  if (typeof fm.gate !== "string") return null;

  const str = (v: unknown): string =>
    typeof v === "string" ? v : v == null ? "" : String(v);
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v !== "" ? v : null;

  const waiverRaw =
    fm.waiver && typeof fm.waiver === "object" && !Array.isArray(fm.waiver)
      ? (fm.waiver as Record<string, unknown>)
      : {};

  // `updated:` may arrive as a Date (yaml parses bare YYYY-MM-DD as a
  // timestamp when the schema allows) — normalize back to the date string.
  let updated: string;
  if (fm.updated instanceof Date) {
    updated = fm.updated.toISOString().slice(0, 10);
  } else {
    updated = str(fm.updated);
  }

  const block: VerdictBlock = {
    gate: str(fm.gate) as Verdict,
    statusReason: str(fm.status_reason),
    reviewer: str(fm.reviewer),
    updated,
    waiver: {
      active: waiverRaw.active === true,
      approver: strOrNull(waiverRaw.approver),
      reason: strOrNull(waiverRaw.reason),
    },
  };
  return { block, issues: validateVerdictBlock(block) };
}

/** YYYY-MM-DD in local time — matches the templates' `updated:` shape. */
export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
