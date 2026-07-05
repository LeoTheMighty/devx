// Tests for src/lib/engine/verdict.ts (v2e101 AC — shared verdict module):
// render/parse round-trip, template byte-shape, D-9 vocabulary enforcement
// (WAIVED requires named approver + reason).

import { describe, expect, it } from "vitest";

import {
  INACTIVE_WAIVER,
  type VerdictBlock,
  formatDate,
  parseVerdictBlock,
  renderVerdictBlock,
  validateVerdictBlock,
} from "../src/lib/engine/verdict.js";

function block(overrides: Partial<VerdictBlock> = {}): VerdictBlock {
  return {
    gate: "PASS",
    statusReason: "All rows covered.",
    reviewer: "devx gate coverage (design mode)",
    updated: "2026-07-05",
    waiver: { ...INACTIVE_WAIVER },
    ...overrides,
  };
}

describe("renderVerdictBlock", () => {
  it("matches the template byte-shape", () => {
    const text = renderVerdictBlock(block());
    expect(text).toBe(
      [
        "---",
        "gate: PASS",
        "status_reason: 'All rows covered.'",
        "reviewer: 'devx gate coverage (design mode)'",
        "updated: 2026-07-05",
        "waiver: { active: false, approver: null, reason: null }",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("escapes embedded single quotes YAML-style", () => {
    const text = renderVerdictBlock(
      block({ statusReason: "E-1's artifact isn't RED." }),
    );
    expect(text).toContain("status_reason: 'E-1''s artifact isn''t RED.'");
    const parsed = parseVerdictBlock(text);
    expect(parsed!.block.statusReason).toBe("E-1's artifact isn't RED.");
  });

  it("renders a WAIVED block with approver + reason", () => {
    const text = renderVerdictBlock(
      block({
        gate: "WAIVED",
        waiver: { active: true, approver: "leo", reason: "prototype spike" },
      }),
    );
    expect(text).toContain("gate: WAIVED");
    expect(text).toContain(
      "waiver: { active: true, approver: 'leo', reason: 'prototype spike' }",
    );
  });

  it("throws on WAIVED without an approver (D-9)", () => {
    expect(() =>
      renderVerdictBlock(
        block({
          gate: "WAIVED",
          waiver: { active: true, approver: null, reason: "because" },
        }),
      ),
    ).toThrow(/approver/);
  });

  it("throws on WAIVED without a reason (D-9)", () => {
    expect(() =>
      renderVerdictBlock(
        block({
          gate: "WAIVED",
          waiver: { active: true, approver: "leo", reason: null },
        }),
      ),
    ).toThrow(/reason/);
  });

  it("throws on an out-of-vocabulary verdict", () => {
    expect(() =>
      renderVerdictBlock(block({ gate: "MAYBE" as VerdictBlock["gate"] })),
    ).toThrow(/vocabulary/);
  });

  it("throws on an active waiver under a non-WAIVED gate", () => {
    expect(() =>
      renderVerdictBlock(
        block({
          gate: "PASS",
          waiver: { active: true, approver: "leo", reason: "n/a" },
        }),
      ),
    ).toThrow(/not WAIVED/);
  });

  it("throws on a malformed updated date", () => {
    expect(() => renderVerdictBlock(block({ updated: "07/05/2026" }))).toThrow(
      /YYYY-MM-DD/,
    );
  });
});

describe("parseVerdictBlock", () => {
  it("round-trips every rendered verdict", () => {
    for (const gate of ["PASS", "CONCERNS", "FAIL"] as const) {
      const original = block({ gate });
      const parsed = parseVerdictBlock(renderVerdictBlock(original) + "# body\n");
      expect(parsed).not.toBeNull();
      expect(parsed!.issues).toEqual([]);
      expect(parsed!.block).toEqual(original);
    }
  });

  it("round-trips WAIVED with waiver fields intact", () => {
    const original = block({
      gate: "WAIVED",
      waiver: { active: true, approver: "leo", reason: "spike" },
    });
    const parsed = parseVerdictBlock(renderVerdictBlock(original));
    expect(parsed!.block.waiver).toEqual({
      active: true,
      approver: "leo",
      reason: "spike",
    });
    expect(parsed!.issues).toEqual([]);
  });

  it("parses the shipped red-report template's verdict keys", () => {
    // The template uses placeholder scalars; the parser should read the
    // structure and report D-9 issues rather than crash.
    const text = [
      "---",
      "gate: FAIL",
      "status_reason: 'x'",
      "reviewer: 'devx gate evals'",
      "updated: 2026-07-05",
      "waiver: { active: false, approver: null, reason: null }",
      "---",
      "",
      "# RED report",
    ].join("\n");
    const parsed = parseVerdictBlock(text);
    expect(parsed!.block.gate).toBe("FAIL");
    expect(parsed!.issues).toEqual([]);
  });

  it("normalizes a bare YAML date back to YYYY-MM-DD", () => {
    const parsed = parseVerdictBlock(
      "---\ngate: PASS\nstatus_reason: 'x'\nreviewer: 'r'\nupdated: 2026-07-05\nwaiver: { active: false, approver: null, reason: null }\n---\n",
    );
    expect(parsed!.block.updated).toBe("2026-07-05");
  });

  it("surfaces a hand-edited WAIVED-without-approver as issues", () => {
    const parsed = parseVerdictBlock(
      "---\ngate: WAIVED\nstatus_reason: 'x'\nreviewer: 'r'\nupdated: 2026-07-05\nwaiver: { active: true, approver: null, reason: null }\n---\n",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.issues.join(" ")).toMatch(/approver/);
    expect(parsed!.issues.join(" ")).toMatch(/reason/);
  });

  it("returns null for a non-verdict frontmatter block", () => {
    expect(parseVerdictBlock("---\nhash: abc\n---\nbody\n")).toBeNull();
  });

  it("returns null when there is no frontmatter at all", () => {
    expect(parseVerdictBlock("# just a doc\n")).toBeNull();
  });
});

describe("validateVerdictBlock + formatDate", () => {
  it("accepts every non-WAIVED verdict with an inactive waiver", () => {
    for (const gate of ["PASS", "CONCERNS", "FAIL"] as const) {
      expect(validateVerdictBlock(block({ gate }))).toEqual([]);
    }
  });

  it("rejects empty reviewer and status_reason", () => {
    const issues = validateVerdictBlock(
      block({ reviewer: " ", statusReason: "" }),
    );
    expect(issues.length).toBe(2);
  });

  it("formatDate pads month and day", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
