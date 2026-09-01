// Reading Guide structural check — §31 port (upstream mycase/8am-harness #62).
//
// Every design human render opens with a Reading Guide: an annotated table of
// contents that doubles as an audience map. One row per section carrying the
// question that section answers, one column per role marked ● (read before
// signing off) / ○ (useful context) / blank (skip). A reviewer scans their own
// column and has their reading list.
//
// This module owns the MECHANICAL half only — the half a machine can settle:
//
//   - the guide is present at all
//   - every guide row names a section that exists in the render
//   - every `###` design mechanism in the authoritative artifact has a row
//   - no role column is entirely blank outside Overview (a column of blanks
//     teaches a reader to ignore the table)
//
// The audience MARKS are judgment — whether Legal really needs to read the
// data model is not a thing a parser can know — and stay advisory. Renders
// authored before the guide existed are grandfathered: `present: false` with
// no other findings is a migration nudge, never a failure.
//
// Pure: no I/O, no clock. Callers read the files.
//
// Registry: docs/CONFIG.md §15 (engine.reading_guide_roles).

/** Heading text of the guide section itself. */
export const READING_GUIDE_HEADING = "Reading guide";

/** The row that groups the design's edge sections. Its cell names several
 *  sections joined by `·`; each part must match a real heading. */
const GROUP_SEPARATOR = "·";

/** Marks a role cell may carry. Anything else is a malformed cell. */
const VALID_MARKS = new Set(["●", "○", ""]);

export interface ReadingGuideRow {
  /** The Section cell, verbatim. */
  section: string;
  /** The section names this row claims — the Section cell split on `·` for
   *  the grouped edge row, else a single-element list. */
  sections: string[];
  /** The "What it covers" cell. */
  covers: string;
  /** Role cells, in column order, aligned to the parsed role header. */
  marks: string[];
}

export interface ParsedReadingGuide {
  present: boolean;
  /** Role names parsed from the header, in column order. */
  roles: string[];
  rows: ReadingGuideRow[];
}

export interface ReadingGuideFinding {
  /** `missing-guide` and `desynced` are structural; `marks` is judgment. */
  kind:
    | "missing-guide"
    | "row-names-no-section"
    | "mechanism-has-no-row"
    | "blank-role-column"
    | "malformed-mark"
    | "role-set-mismatch";
  severity: "blocking" | "advisory";
  message: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split a markdown table row into trimmed cells. Escaped pipes (`\|`) are
 *  cell CONTENT, not separators — markdown escapes literal pipes inside enum
 *  cells, and splitting on a bare `|` shreds them and shifts every later
 *  column. (That exact bug shipped green upstream: the checks were reading
 *  the wrong cell and passing by accident.) */
export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  // A well-formed row starts and ends with `|`, producing empty outer cells.
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** True for a markdown table delimiter row (`| --- | :-: | :--- | ---: |`).
 *  Alignment cells carry as few as one dash (`:-:`), so the dash count is
 *  `+`, not `{3,}` — a stricter count silently reclassifies the delimiter as
 *  a data row and shifts every subsequent row by one. */
function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** Collect every ATX heading text in a markdown document, with its level. */
export function headings(md: string): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  let inFence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/**
 * Parse the Reading Guide out of a design human render.
 *
 * Anchored on the `## Reading guide` heading — never on a bare `find()` of
 * the table shape. An unanchored search matches the first table in the file,
 * which upstream discovered the hard way: it scanned unrelated tables above
 * the guide and reported 31 phantom failures.
 */
export function parseReadingGuide(humanMd: string): ParsedReadingGuide {
  const lines = humanMd.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{2,3}\s+(.*?)\s*$/.exec(lines[i]);
    if (m && m[1].trim().toLowerCase() === READING_GUIDE_HEADING.toLowerCase()) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return { present: false, roles: [], rows: [] };

  let roles: string[] = [];
  const rows: ReadingGuideRow[] = [];
  let seenHeader = false;
  let inFence = false;
  let inComment = false;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    // Stop at the next heading of the same or higher rank.
    if (/^#{1,3}\s+/.test(line) && !inFence && !inComment) break;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.includes("<!--")) inComment = true;
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (!line.trim().startsWith("|")) continue;

    const cells = splitTableRow(line);
    if (isDelimiterRow(cells)) continue;
    if (!seenHeader) {
      // Header: Section | What it covers | <role> | <role> | …
      roles = cells.slice(2);
      seenHeader = true;
      continue;
    }
    const section = cells[0] ?? "";
    rows.push({
      section,
      sections: section
        .split(GROUP_SEPARATOR)
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      covers: cells[1] ?? "",
      marks: cells.slice(2),
    });
  }

  return { present: seenHeader, roles, rows };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

/** Normalize a heading/section name for comparison — case and surrounding
 *  punctuation are not meaningful here, and a template placeholder
 *  (`<### mechanism>`) is never matched against real headings. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True for an unfilled template placeholder (`<the outline's structure…>`). */
function isPlaceholder(s: string): boolean {
  return /^<.*>$/.test(s.trim());
}

export interface ReadingGuideCheckInput {
  /** The design stage's human render. */
  humanMd: string;
  /** The authoritative design artifact — source of the `###` mechanisms. */
  designAgentMd: string;
  /** Configured column set (engine.reading_guide_roles). */
  roles: readonly string[];
}

/**
 * Check a render's guide for structural sync. Returns findings, most severe
 * first; an empty list is a clean guide.
 *
 * Grandfathering: a render with no guide at all yields exactly one advisory
 * `missing-guide` finding. A render that HAS a guide is held to it — once the
 * map exists, reviewers rely on it, and a half-synced map is worse than none.
 */
export function checkReadingGuide(
  input: ReadingGuideCheckInput,
): ReadingGuideFinding[] {
  const guide = parseReadingGuide(input.humanMd);
  if (!guide.present) {
    return [
      {
        kind: "missing-guide",
        severity: "advisory",
        message:
          "design human render has no `## Reading guide` — pre-§31 render, " +
          "add the audience-mapped ToC on the next revision",
      },
    ];
  }

  const findings: ReadingGuideFinding[] = [];
  const renderHeadings = new Set(headings(input.humanMd).map((h) => norm(h.text)));

  // 1. Every row names a real section.
  for (const row of guide.rows) {
    for (const name of row.sections) {
      if (isPlaceholder(name)) continue;
      if (!renderHeadings.has(norm(name))) {
        findings.push({
          kind: "row-names-no-section",
          severity: "blocking",
          message: `Reading Guide row "${name}" names no section in the render`,
        });
      }
    }
  }

  // 2. Every `###` design mechanism has a row. Scoped to headings under
  //    `## Design` — sections outside it are free to go unrowed.
  const mechanisms: string[] = [];
  let inDesign = false;
  for (const h of headings(input.designAgentMd)) {
    if (h.level === 2) inDesign = norm(h.text) === "design";
    else if (h.level === 3 && inDesign) mechanisms.push(h.text);
  }
  const rowNames = new Set(
    guide.rows.flatMap((r) => r.sections.map(norm)).filter((n) => n !== ""),
  );
  for (const m of mechanisms) {
    if (isPlaceholder(m)) continue;
    if (!rowNames.has(norm(m))) {
      findings.push({
        kind: "mechanism-has-no-row",
        severity: "blocking",
        message: `design mechanism "${m}" has no Reading Guide row`,
      });
    }
  }

  // 3. The parsed role header matches the configured column set.
  const parsed = guide.roles.map(norm).join("|");
  const configured = input.roles.map(norm).join("|");
  if (parsed !== configured) {
    findings.push({
      kind: "role-set-mismatch",
      severity: "advisory",
      message:
        `Reading Guide columns [${guide.roles.join(", ")}] do not match ` +
        `engine.reading_guide_roles [${input.roles.join(", ")}]`,
    });
  }

  // 4. Marks are well formed, and no column is blank outside Overview.
  //    "Columns are the scarce resource" — a column carrying no ● anywhere
  //    but Overview should be dropped, not rendered as decoration.
  const nonOverview = guide.rows.filter((r) => norm(r.section) !== "overview");
  guide.roles.forEach((role, col) => {
    let anyStrong = false;
    for (const row of guide.rows) {
      const mark = (row.marks[col] ?? "").trim();
      if (!VALID_MARKS.has(mark)) {
        findings.push({
          kind: "malformed-mark",
          severity: "advisory",
          message:
            `Reading Guide row "${row.section}" column "${role}" carries ` +
            `"${mark}" — expected ●, ○, or blank`,
        });
      }
    }
    for (const row of nonOverview) {
      if ((row.marks[col] ?? "").trim() === "●") anyStrong = true;
    }
    if (nonOverview.length > 0 && !anyStrong) {
      findings.push({
        kind: "blank-role-column",
        severity: "advisory",
        message:
          `Reading Guide column "${role}" carries no ● outside Overview — ` +
          "drop the column or give it a section to own",
      });
    }
  });

  findings.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1,
  );
  return findings;
}

/** Convenience: does this findings list block? */
export const blocksGate = (f: readonly ReadingGuideFinding[]): boolean =>
  f.some((x) => x.severity === "blocking");
