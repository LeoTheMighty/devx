// Gate 1 — mechanical PRD validator (v2e101). Pure evaluation over the two
// Gate-1 inputs (prd/agent.md + expectations.md) plus the spec's blocked_by; the
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
//      definition in prd/agent.md (dangling refs fail); every `G-` goal defined
//      in prd/agent.md is covered by ≥1 expectation (orphan goals fail).
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
import { EVALS_DIR_REL } from "./artifacts.js";

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
  /**
   * Repo-relative display path of the PRD subject, resolved through the
   * layout by the caller (`stageSubject`). Every `location:` and `message:`
   * below is part of this gate's OUTPUT contract, not decoration — a gap
   * pointing at `prd/agent.md:42` in a repo whose file is `prd.md` is a
   * finding a human cannot act on.
   *
   * Required, not defaulted: the gate must not be able to name a subject
   * nobody resolved. A default would be the folder-layout spelling, which
   * is exactly the wrong answer under `project-level` and would be wrong
   * silently. The gate still cannot see the LAYOUT — only the path.
   */
  prdRel: string;
  /** Repo-relative display path of expectations.md. Same contract as
   *  `prdRel`; the basename is layout-identical but the prefix is not. */
  expectationsRel: string;
}

export interface GatePrdResult {
  verdict: "PASS" | "FAIL";
  gaps: GateGap[];
  /** IDs defined in prd/agent.md — reused by callers for reporting. */
  definedIds: string[];
}

/** Sections gate-prd requires in prd/agent.md (template order). `Evals seed` and
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
 * IDs *defined* in prd/agent.md. A definition is an ID at a defining position:
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
  // Bound once so every message and location below names the SAME resolved
  // spelling. Two reads of the same subject is how one gap points at
  // `prd.md` and the next at `prd/agent.md` in a single report.
  const prdRel = inputs.prdRel;
  const expectationsRel = inputs.expectationsRel;

  // ---- 1. PRD sections: present, non-empty, non-placeholder. ------------
  const sections = splitSections(inputs.prd);
  const byName = new Map(sections.map((s) => [s.name, s]));
  for (const required of REQUIRED_PRD_SECTIONS) {
    const section = byName.get(required);
    if (!section) {
      gaps.push({
        check: "prd-section-missing",
        message: `${prdRel} is missing the \`## ${required}\` section`,
        location: prdRel,
      });
      continue;
    }
    const stripped = stripExemptSpans(section.body);
    if (stripped.trim() === "") {
      gaps.push({
        check: "prd-section-empty",
        message: `${prdRel} \`## ${required}\` has no content`,
        location: `${prdRel}:${section.line}`,
      });
      continue;
    }
    const placeholder = findPlaceholder(stripped);
    if (placeholder) {
      gaps.push({
        check: "prd-section-placeholder",
        message: `${prdRel} \`## ${required}\` still contains template furniture: ${placeholder}`,
        location: `${prdRel}:${section.line}`,
      });
    }
  }

  // ---- 2. E-block count. -------------------------------------------------
  const blocks = parseExpectations(inputs.expectations);
  if (blocks.length < inputs.expectationsMin) {
    gaps.push({
      check: "expectations-too-few",
      message: `${expectationsRel} has ${blocks.length} E-block(s); engine.expectations_min is ${inputs.expectationsMin}`,
      location: expectationsRel,
    });
  }

  // ---- 3. Per-block field checks. ----------------------------------------
  const definedIdRefs = extractDefinedIds(inputs.prd);
  const definedIds = new Set(definedIdRefs.map((r) => r.id));
  const coveredIds = new Set<string>();

  for (const block of blocks) {
    const loc = `${expectationsRel}:${block.line}`;
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
            message: `${block.id} covers '${id}' but ${prdRel} defines no such ID`,
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
        message: `${prdRel} goal '${ref.id}' is not covered by any expectation`,
        location: `${prdRel}:${ref.line}`,
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
      // The hint is deliberately NOT the resolved subject: it describes
      // what the author types into the Verified-by field, which is written
      // relative to the workstream, while the sibling `location:` is
      // repo-relative. Saying so keeps one JSON blob from carrying two
      // unlabelled path frames (review BH-5).
      message: `${block.id} Verified-by '${block.verifiedBy}' is not a concrete runnable target (expected a repo-relative test path, or \`${EVALS_DIR_REL}/E-${block.id.slice(2)}_*.md\` relative to the workstream)`,
      location: loc,
    });
  }
}
