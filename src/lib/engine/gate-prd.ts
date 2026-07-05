// Gate 1 — mechanical PRD validator (v2e101). Pure evaluation over the two
// Gate-1 inputs (prd.md + expectations.md) plus the spec's blocked_by; the
// CLI passthrough in src/commands/gate.ts owns resolution, writes, and exit
// codes.
//
// Checks (v2/02-engine.md §4.2 — "the framework's value is in the refusal"):
//
//   1. Required PRD sections present, non-empty, and non-placeholder
//      (template furniture — `<...>` stanzas — counts as placeholder;
//      HTML comments and fenced/inline code are exempt).
//   2. ≥ engine.expectations_min E-blocks (default 3).
//   3. Per block: Priority ∈ P0–P3; Expectation matches the EARS regex
//      `When .+, the system SHALL .+` AND is not template furniture;
//      Threshold is numeric (contains a digit, no placeholder); Verified-by
//      is a concrete runnable target (path-shaped, no placeholder).
//   4. Bidirectional ID resolution: every `Covers:` ID resolves to a
//      definition in prd.md (dangling refs fail); every `G-` goal defined
//      in prd.md is covered by ≥1 expectation (orphan goals fail).
//   5. INTERVIEW-blocker check: the spec's `blocked_by:` must be empty.
//
// Pass → the CLI flips `prd_validated: true` + `stage: design` (both
// written in one frontmatter patch). Fail → precise gap report on stdout,
// NOTHING written. Exit 0 pass / 1 fail / 2 error.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.1–4.2

import {
  type EBlock,
  normalizePriority,
  parseCoversIds,
  parseExpectations,
} from "./expectations.js";

export interface GateGap {
  /** Stable check identifier — grep-able (mirrors validate-emit's shape). */
  check: string;
  message: string;
  /** `<file>:<line>` where known. */
  location?: string;
}

export interface GatePrdInputs {
  prd: string;
  expectations: string;
  /** Spec frontmatter blocked_by entries. */
  blockedBy: string[];
  /** engine.expectations_min (default 3). */
  expectationsMin: number;
}

export interface GatePrdResult {
  verdict: "PASS" | "FAIL";
  gaps: GateGap[];
  /** IDs defined in prd.md — reused by callers for reporting. */
  definedIds: string[];
}

/** Sections gate-prd requires in prd.md (template order). `Evals seed` and
 *  `Open questions` are template-suggested but not gate-required — a PRD
 *  with fully-promoted expectations legitimately empties them. */
export const REQUIRED_PRD_SECTIONS = [
  "Problem",
  "Goals",
  "Non-goals",
  "Users",
  "Use cases",
  "Capabilities",
  "Feature requirements",
] as const;

const EARS_RE = /When .+, the system SHALL .+/;

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------

/**
 * Strip the spans placeholder detection must ignore: HTML comments
 * (template guidance is allowed to survive), fenced code blocks, and
 * inline backtick code (real prose legitimately writes `Map<string>` or
 * `<hash>` inside code spans). Operates on whole-document text.
 */
export function stripExemptSpans(text: string): string {
  let out = text.replace(/<!--[\s\S]*?-->/g, "");
  // Fenced code blocks (``` ... ```): drop the body, keep line count via
  // newline preservation so gap line numbers stay meaningful.
  out = out.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, (m) =>
    m.replace(/[^\n]/g, ""),
  );
  // Inline code spans.
  out = out.replace(/`[^`\n]*`/g, "");
  return out;
}

// Template furniture: `<...>` with non-space characters hugging both
// brackets (`<what hurts>`, `<P0 | P1>`). The inner-edge \S requirement
// keeps comparator prose like "p95 < 8s and retries > 3" (space after `<`,
// space before `>`) from false-positiving — real thresholds legitimately
// use both comparators in one sentence.
const PLACEHOLDER_RE = /<(?:\S|\S[^<>\n]*\S)>/;

/** First placeholder token in the (already-stripped) text, or null. */
export function findPlaceholder(strippedText: string): string | null {
  const m = strippedText.match(PLACEHOLDER_RE);
  return m ? m[0] : null;
}

interface Section {
  name: string;
  /** 1-based heading line. */
  line: number;
  body: string;
}

/** Split a markdown doc into `## `-level sections. */
export function splitSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  const bodyLines: string[] = [];
  const flush = () => {
    if (current) {
      current.body = bodyLines.join("\n");
      sections.push(current);
      bodyLines.length = 0;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (m && !lines[i].startsWith("###")) {
      flush();
      current = { name: m[1], line: i + 1, body: "" };
    } else if (current) {
      bodyLines.push(lines[i]);
    }
  }
  flush();
  return sections;
}

// ---------------------------------------------------------------------------
// PRD ID definitions
// ---------------------------------------------------------------------------

/**
 * IDs *defined* in prd.md. A definition is an ID at a defining position:
 * bold (`**G-1**`) or a heading (`### FR-1: ...`) — matching the template's
 * two shapes. Mentions in running prose don't define.
 */
export function extractDefinedIds(prd: string): Array<{ id: string; line: number }> {
  const out: Array<{ id: string; line: number }> = [];
  const seen = new Set<string>();
  const lines = prd.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(/\*\*((?:G|UC|CAP|FR)-\d+)\*\*/gi)) {
      const id = m[1].toUpperCase();
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ id, line: i + 1 });
      }
    }
    const h = line.match(/^#{2,4}\s+((?:G|UC|CAP|FR)-\d+)\b/i);
    if (h) {
      const id = h[1].toUpperCase();
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ id, line: i + 1 });
      }
    }
  }
  return out;
}

/**
 * Concrete Verified-by: a runnable target — a test path or an
 * `evals/E-<n>_*.md` spec (v2/02-engine.md §4.1). Mechanically: after
 * stripping backticks, a single path-shaped token (contains `/` or ends in
 * a file extension), no placeholder furniture, no prose.
 */
export function isConcreteVerifiedBy(value: string): boolean {
  const cleaned = value.replace(/`/g, "").trim();
  if (cleaned === "") return false;
  if (PLACEHOLDER_RE.test(cleaned)) return false;
  // Multiple whitespace-separated words ⇒ prose ("manual QA later"), not a
  // runnable target.
  if (/\s/.test(cleaned)) return false;
  return cleaned.includes("/") || /\.[a-z0-9]+$/i.test(cleaned);
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export function evaluateGatePrd(inputs: GatePrdInputs): GatePrdResult {
  const gaps: GateGap[] = [];

  // ---- 1. PRD sections: present, non-empty, non-placeholder. ------------
  const sections = splitSections(inputs.prd);
  const byName = new Map(sections.map((s) => [s.name, s]));
  for (const required of REQUIRED_PRD_SECTIONS) {
    const section = byName.get(required);
    if (!section) {
      gaps.push({
        check: "prd-section-missing",
        message: `prd.md is missing the \`## ${required}\` section`,
        location: "prd.md",
      });
      continue;
    }
    const stripped = stripExemptSpans(section.body);
    if (stripped.trim() === "") {
      gaps.push({
        check: "prd-section-empty",
        message: `prd.md \`## ${required}\` has no content`,
        location: `prd.md:${section.line}`,
      });
      continue;
    }
    const placeholder = findPlaceholder(stripped);
    if (placeholder) {
      gaps.push({
        check: "prd-section-placeholder",
        message: `prd.md \`## ${required}\` still contains template furniture: ${placeholder}`,
        location: `prd.md:${section.line}`,
      });
    }
  }

  // ---- 2. E-block count. -------------------------------------------------
  const blocks = parseExpectations(inputs.expectations);
  if (blocks.length < inputs.expectationsMin) {
    gaps.push({
      check: "expectations-too-few",
      message: `expectations.md has ${blocks.length} E-block(s); engine.expectations_min is ${inputs.expectationsMin}`,
      location: "expectations.md",
    });
  }

  // ---- 3. Per-block field checks. ----------------------------------------
  const definedIdRefs = extractDefinedIds(inputs.prd);
  const definedIds = new Set(definedIdRefs.map((r) => r.id));
  const coveredIds = new Set<string>();

  for (const block of blocks) {
    const loc = `expectations.md:${block.line}`;
    checkPriority(block, loc, gaps);
    checkExpectationEars(block, loc, gaps);
    checkThreshold(block, loc, gaps);
    checkVerifiedBy(block, loc, gaps);

    // Covers: present, non-placeholder, every ID resolves.
    if (block.covers === null || block.covers.trim() === "") {
      gaps.push({
        check: "expectation-covers-missing",
        message: `${block.id} has no Covers value`,
        location: loc,
      });
    } else if (PLACEHOLDER_RE.test(stripExemptSpans(block.covers))) {
      gaps.push({
        check: "expectation-covers-placeholder",
        message: `${block.id} Covers is template furniture: ${block.covers}`,
        location: loc,
      });
    } else {
      const ids = parseCoversIds(block.covers);
      if (ids.length === 0) {
        gaps.push({
          check: "expectation-covers-unparseable",
          message: `${block.id} Covers ('${block.covers}') contains no G-/UC-/CAP-/FR- IDs`,
          location: loc,
        });
      }
      for (const id of ids) {
        coveredIds.add(id);
        if (!definedIds.has(id)) {
          gaps.push({
            check: "covers-id-dangling",
            message: `${block.id} covers '${id}' but prd.md defines no such ID`,
            location: loc,
          });
        }
      }
    }
  }

  // ---- 4b. Every G- goal covered by ≥1 expectation. -----------------------
  for (const ref of definedIdRefs) {
    if (!ref.id.startsWith("G-")) continue;
    if (!coveredIds.has(ref.id)) {
      gaps.push({
        check: "goal-uncovered",
        message: `prd.md goal '${ref.id}' is not covered by any expectation`,
        location: `prd.md:${ref.line}`,
      });
    }
  }

  // ---- 5. INTERVIEW blockers. ---------------------------------------------
  if (inputs.blockedBy.length > 0) {
    gaps.push({
      check: "interview-blocker",
      message: `spec has unresolved blocked_by entries: ${inputs.blockedBy.join(", ")} — Gate 1 requires an empty blocked_by`,
    });
  }

  return {
    verdict: gaps.length === 0 ? "PASS" : "FAIL",
    gaps,
    definedIds: [...definedIds],
  };
}

function checkPriority(block: EBlock, loc: string, gaps: GateGap[]): void {
  if (block.priority === null || block.priority.trim() === "") {
    gaps.push({
      check: "expectation-priority-missing",
      message: `${block.id} has no Priority value`,
      location: loc,
    });
    return;
  }
  if (normalizePriority(block.priority) === null) {
    gaps.push({
      check: "expectation-priority-invalid",
      message: `${block.id} Priority '${block.priority}' is not one of P0 | P1 | P2 | P3`,
      location: loc,
    });
  }
}

function checkExpectationEars(
  block: EBlock,
  loc: string,
  gaps: GateGap[],
): void {
  if (block.expectation === null || block.expectation.trim() === "") {
    gaps.push({
      check: "expectation-ears-missing",
      message: `${block.id} has no Expectation (EARS) value`,
      location: loc,
    });
    return;
  }
  // Placeholder FIRST: the template default "When <trigger>, the system
  // SHALL <behavior>." satisfies the EARS regex but is furniture.
  if (PLACEHOLDER_RE.test(stripExemptSpans(block.expectation))) {
    gaps.push({
      check: "expectation-ears-placeholder",
      message: `${block.id} Expectation is template furniture: ${block.expectation}`,
      location: loc,
    });
    return;
  }
  if (!EARS_RE.test(block.expectation)) {
    gaps.push({
      check: "expectation-ears-shape",
      message: `${block.id} Expectation does not match the EARS shape \`When <trigger>, the system SHALL <behavior>\`: '${block.expectation}'`,
      location: loc,
    });
  }
}

function checkThreshold(block: EBlock, loc: string, gaps: GateGap[]): void {
  if (block.threshold === null || block.threshold.trim() === "") {
    gaps.push({
      check: "expectation-threshold-missing",
      message: `${block.id} has no Threshold value`,
      location: loc,
    });
    return;
  }
  if (PLACEHOLDER_RE.test(stripExemptSpans(block.threshold))) {
    gaps.push({
      check: "expectation-threshold-placeholder",
      message: `${block.id} Threshold is template furniture: ${block.threshold}`,
      location: loc,
    });
    return;
  }
  if (!/\d/.test(block.threshold)) {
    gaps.push({
      check: "expectation-threshold-not-numeric",
      message: `${block.id} Threshold '${block.threshold}' carries no numeric value — thresholds must be measurable`,
      location: loc,
    });
  }
}

function checkVerifiedBy(block: EBlock, loc: string, gaps: GateGap[]): void {
  if (block.verifiedBy === null || block.verifiedBy.trim() === "") {
    gaps.push({
      check: "expectation-verified-by-missing",
      message: `${block.id} has no Verified-by value`,
      location: loc,
    });
    return;
  }
  if (!isConcreteVerifiedBy(block.verifiedBy)) {
    gaps.push({
      check: "expectation-verified-by-vague",
      message: `${block.id} Verified-by '${block.verifiedBy}' is not a concrete runnable target (expected a test path or evals/E-${block.id.slice(2)}_*.md)`,
      location: loc,
    });
  }
}
