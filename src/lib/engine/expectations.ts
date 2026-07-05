// expectations.md E-block parser (v2e101). Shared by all three gates:
// gate prd validates the blocks, gate coverage keys plan-mode rows +
// the P0 floor off them, gate evals resolves Verified-by targets.
//
// Canonical block shape (v2/02-engine.md §4.1, template
// _devx/templates/engine/expectations.md):
//
//   ## E-1: <human-readable name>
//   - **Priority:** P0
//   - **Covers:** `G-2, UC-1, FR-3`
//   - **Trigger:** <input shape>
//   - **Expectation (EARS):** When <trigger>, the system SHALL <behavior>.
//   - **Threshold:** p95 latency < 8s
//   - **Verified by:** test/foo.test.ts
//
// Parsing is tolerant of field order and missing fields — validation of
// each field is gate-prd's job, not the parser's; the parser reports what
// it sees (null for absent fields) so the gate can emit precise gaps.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md

export interface EBlock {
  /** Full ID as written, e.g. "E-1". */
  id: string;
  name: string;
  /** 1-based heading line in expectations.md. */
  line: number;
  /** Raw field values (markdown stripped of the bold label), null if the
   *  field line is absent. Empty string when present but blank. */
  priority: string | null;
  covers: string | null;
  trigger: string | null;
  expectation: string | null;
  threshold: string | null;
  verifiedBy: string | null;
}

const E_HEADING_RE = /^##\s+(E-\d+)\s*:\s*(.*)$/;

// Field lines: `- **<Label>:** <value>`. The Expectation label carries the
// `(EARS)` suffix in the template; accept it with or without.
const FIELD_RES: Array<{ key: keyof EBlock; re: RegExp }> = [
  { key: "priority", re: /^[-*]\s+\*\*Priority:\*\*\s*(.*)$/ },
  { key: "covers", re: /^[-*]\s+\*\*Covers:\*\*\s*(.*)$/ },
  { key: "trigger", re: /^[-*]\s+\*\*Trigger:\*\*\s*(.*)$/ },
  {
    key: "expectation",
    re: /^[-*]\s+\*\*Expectation(?:\s*\(EARS\))?:\*\*\s*(.*)$/,
  },
  { key: "threshold", re: /^[-*]\s+\*\*Threshold:\*\*\s*(.*)$/ },
  { key: "verifiedBy", re: /^[-*]\s+\*\*Verified[- ]by:\*\*\s*(.*)$/i },
];

export function parseExpectations(content: string): EBlock[] {
  const lines = content.split("\n");
  const blocks: EBlock[] = [];
  let current: EBlock | null = null;
  // Field values wrap at the house ~78-char line width (v2e102 dogfood
  // finding: a wrapped EARS sentence must parse as one value). A captured
  // field keeps absorbing indented continuation lines until a blank line,
  // a new bullet, or a heading ends it.
  let openKey: keyof EBlock | null = null;
  let openDuplicate = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(E_HEADING_RE);
    if (h) {
      current = {
        id: h[1],
        name: h[2].trim(),
        line: i + 1,
        priority: null,
        covers: null,
        trigger: null,
        expectation: null,
        threshold: null,
        verifiedBy: null,
      };
      blocks.push(current);
      openKey = null;
      continue;
    }
    if (line.startsWith("## ")) {
      // A non-E `## ` heading ends the current block's field scan.
      current = null;
      openKey = null;
      continue;
    }
    if (!current) continue;
    let matched = false;
    for (const { key, re } of FIELD_RES) {
      const m = line.match(re);
      if (m) {
        matched = true;
        openKey = key;
        // First occurrence wins; a duplicated field line inside one block
        // keeps the original (gate-prd doesn't police duplicates — the
        // template never produces them and the first value is the intent).
        openDuplicate = current[key] !== null;
        if (!openDuplicate) {
          (current as unknown as Record<string, string>)[key] = m[1].trim();
        }
        break;
      }
    }
    if (matched) continue;
    if (/^\s*$/.test(line) || /^\s*[-*]\s/.test(line) || line.startsWith("#")) {
      // Blank line, unrecognized bullet, or heading closes the open field.
      openKey = null;
      continue;
    }
    if (openKey && /^\s{2,}\S/.test(line) && !openDuplicate) {
      // Indented continuation of the open field's wrapped value.
      const joined = `${current[openKey] ?? ""} ${line.trim()}`.trim();
      (current as unknown as Record<string, string>)[openKey] = joined;
    }
  }
  return blocks;
}

/** IDs referenced by a Covers value: strips backticks, splits on commas /
 *  whitespace, keeps `<PREFIX>-<n>` shaped tokens. */
export function parseCoversIds(covers: string): string[] {
  const cleaned = covers.replace(/`/g, " ");
  const out: string[] = [];
  for (const tok of cleaned.split(/[\s,]+/)) {
    if (/^(?:G|UC|CAP|FR)-\d+$/i.test(tok)) out.push(tok.toUpperCase());
  }
  return out;
}

const PRIORITY_RE = /^P[0-3]$/;

/** Normalize a Priority value; null when it isn't a bare P0–P3. */
export function normalizePriority(priority: string | null): string | null {
  if (priority === null) return null;
  const cleaned = priority.replace(/`/g, "").trim().toUpperCase();
  return PRIORITY_RE.test(cleaned) ? cleaned : null;
}
