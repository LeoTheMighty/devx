// Iteration contract pins (v2l101 — src/lib/loop/iteration.ts).
//
// The prompt-pin block below is LOAD-BEARING: these sentences are what keep
// unattended iterations honest (v2/04 §2.2). Changing the prompt requires
// changing these pins in the same PR — that's the point.

import { describe, expect, it } from "vitest";

import {
  buildCommitRepairPrompt,
  buildIterationPrompt,
  buildReportRetryPrompt,
  extractReportJson,
  validateIterationReport,
} from "../src/lib/loop/iteration.js";

const params = {
  hash: "abc123",
  specRelPath: "dev/dev-abc123-2026-07-05T13:06-thing.md",
  iteration: 3,
  maxIterations: 8,
};

describe("buildIterationPrompt — load-bearing sentence pins (§2.2)", () => {
  const prompt = buildIterationPrompt(params);

  it("identifies the iteration + spec", () => {
    expect(prompt).toContain("This is iteration 3 of at most 8 on spec `abc123`");
  });

  it("sends the worker to the Status log first", () => {
    expect(prompt).toContain("read the spec's Status log first");
    expect(prompt).toContain(params.specRelPath);
  });

  it("pins smallest-verifiable-slice", () => {
    expect(prompt).toContain(
      "Pick the next smallest logical unit of work that is individually verifiable. Do not attempt the whole spec.",
    );
  });

  it("pins report-don't-pivot", () => {
    expect(prompt).toContain(
      "record learnings and report failure rather than continuously pivoting",
    );
  });

  it("pins run-gates-before-claiming-success", () => {
    expect(prompt).toContain("Run the relevant build/tests/linters before reporting success");
  });

  it("pins no-commits / no-status-log-edits (the loop owns both)", () => {
    expect(prompt).toContain("Do NOT commit; do NOT edit the Status log — the loop owns both.");
  });

  it("pins stop-background-processes", () => {
    expect(prompt).toContain("Stop any background processes you started");
  });

  it("pins the no-op rule and the acs_met claim semantics", () => {
    expect(prompt).toMatch(/no-op iteration.*is not a success/s);
    expect(prompt).toMatch(/acs_met: set to true ONLY when every acceptance criterion/);
    expect(prompt).toMatch(/it is a claim, not acceptance/);
  });

  it("asks for a single fenced json block with the five schema fields", () => {
    expect(prompt).toContain("```json");
    for (const field of ["success", "summary", "key_changes_made", "key_learnings", "acs_met"]) {
      expect(prompt).toContain(`- ${field}:`);
    }
  });

  it("includes prior attempts when given (newest last, [FAIL]-tagged)", () => {
    const withPrior = buildIterationPrompt({
      ...params,
      priorAttempts: [
        { iteration: 1, success: true, summary: "did a thing" },
        { iteration: 2, success: false, summary: "broke a thing" },
      ],
    });
    expect(withPrior).toContain("## Prior attempts this run");
    expect(withPrior).toContain("- iteration 1: ok — did a thing");
    expect(withPrior).toContain("- iteration 2: [FAIL] — broke a thing");
    expect(prompt).not.toContain("## Prior attempts this run");
  });
});

describe("buildCommitRepairPrompt", () => {
  it("appends a repair-only section carrying the git output", () => {
    const base = buildIterationPrompt(params);
    const repair = buildCommitRepairPrompt(base, "hook rejected: trailing whitespace");
    expect(repair.startsWith(base)).toBe(true);
    expect(repair).toContain("REPAIR-ONLY ITERATION");
    expect(repair).toContain("Do not start unrelated work.");
    expect(repair).toContain("fix the existing uncommitted changes so the commit can pass");
    expect(repair).toContain("hook rejected: trailing whitespace");
  });
});

describe("buildReportRetryPrompt", () => {
  it("forbids new work and carries the typed errors + output tail", () => {
    const retry = buildReportRetryPrompt("prose prose prose", [
      { code: "missing-field", field: "acs_met", message: "acs_met is required" },
    ]);
    expect(retry).toContain("Do NOT do any new work");
    expect(retry).toContain("acs_met is required (missing-field)");
    expect(retry).toContain("prose prose prose");
  });

  it("bounds the carried output to a tail", () => {
    const retry = buildReportRetryPrompt("x".repeat(10_000), [
      { code: "no-json-found", message: "no JSON object found" },
    ]);
    expect(retry.length).toBeLessThan(6_000);
  });
});

// ---------------------------------------------------------------------------
// Report schema validation
// ---------------------------------------------------------------------------

const VALID = {
  success: true,
  summary: "did the thing",
  key_changes_made: ["added x"],
  key_learnings: [],
  acs_met: false,
};

describe("validateIterationReport", () => {
  it("accepts the canonical shape", () => {
    const r = validateIterationReport(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.summary).toBe("did the thing");
  });

  it("ignores extra keys (models decorate; retries are expensive)", () => {
    const r = validateIterationReport({ ...VALID, vibe: "immaculate" });
    expect(r.ok).toBe(true);
  });

  it("rejects non-objects with not-an-object", () => {
    for (const v of [null, 42, "x", [VALID]]) {
      const r = validateIterationReport(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0].code).toBe("not-an-object");
    }
  });

  it("reports every missing field with a typed error", () => {
    const r = validateIterationReport({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(5);
      expect(new Set(r.errors.map((e) => e.code))).toEqual(new Set(["missing-field"]));
      expect(new Set(r.errors.map((e) => e.field))).toEqual(
        new Set(["success", "summary", "key_changes_made", "key_learnings", "acs_met"]),
      );
    }
  });

  it("rejects wrong types without coercion", () => {
    const cases: Array<[string, unknown]> = [
      ["success", "true"],
      ["summary", 42],
      ["summary", "   "],
      ["key_changes_made", "not an array"],
      ["key_changes_made", [1, 2]],
      ["key_learnings", null],
      ["acs_met", 1],
    ];
    for (const [field, bad] of cases) {
      const r = validateIterationReport({ ...VALID, [field]: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].code).toBe("wrong-type");
        expect(r.errors[0].field).toBe(field);
      }
    }
  });

  it("trims the summary on the way out", () => {
    const r = validateIterationReport({ ...VALID, summary: "  padded  " });
    expect(r.ok && r.report.summary).toBe("padded");
  });
});

// ---------------------------------------------------------------------------
// JSON recovery (gnhf json-extract idea)
// ---------------------------------------------------------------------------

describe("extractReportJson", () => {
  it("finds a clean fenced json block", () => {
    const text = `did work\n\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n`;
    expect(extractReportJson(text)).toEqual(VALID);
  });

  it("finds a bare-fenced block", () => {
    const text = `\`\`\`\n${JSON.stringify(VALID)}\n\`\`\``;
    expect(extractReportJson(text)).toEqual(VALID);
  });

  it("prefers the LAST parseable fenced block", () => {
    const first = { ...VALID, summary: "first" };
    const last = { ...VALID, summary: "last" };
    const text = `\`\`\`json\n${JSON.stringify(first)}\n\`\`\`\nmore prose\n\`\`\`json\n${JSON.stringify(last)}\n\`\`\``;
    expect((extractReportJson(text) as { summary: string }).summary).toBe("last");
  });

  it("recovers a prose-wrapped bare object", () => {
    const text = `Here's my final report: ${JSON.stringify(VALID)} — hope that helps!`;
    expect(extractReportJson(text)).toEqual(VALID);
  });

  it("survives braces inside JSON strings", () => {
    const tricky = { ...VALID, summary: 'fixed the "{weird}" case } {' };
    const text = `report: ${JSON.stringify(tricky)}`;
    expect(extractReportJson(text)).toEqual(tricky);
  });

  it("ignores irrelevant JSON blobs without a success key", () => {
    const text = `test output: {"passed": 12, "failed": 0}\nno report emitted`;
    expect(extractReportJson(text)).toBeNull();
  });

  it("returns null on empty / json-free text", () => {
    expect(extractReportJson("")).toBeNull();
    expect(extractReportJson("all prose, no json")).toBeNull();
  });

  it("recovered-but-invalid shapes still fail validation downstream (retry protocol)", () => {
    const bad = { success: "yes", summary: "x" };
    const parsed = extractReportJson(`\`\`\`json\n${JSON.stringify(bad)}\n\`\`\``);
    expect(parsed).not.toBeNull();
    const v = validateIterationReport(parsed);
    expect(v.ok).toBe(false);
  });
});

describe("extractReportJson — validate-first preference (EC-MED-7)", () => {
  it("an earlier VALID report beats a later decorative fence that merely parses", () => {
    const decorative = { name: "pkg", version: "1.0.0", success: "not-a-report" };
    const text = `\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\nquoting my package.json:\n\`\`\`json\n${JSON.stringify(decorative)}\n\`\`\``;
    expect(extractReportJson(text)).toEqual(VALID);
  });

  it("falls back to the last parseable object when nothing validates", () => {
    const a = { success: "nope", summary: "a" };
    const b = { success: "nope", summary: "b" };
    const text = `\`\`\`json\n${JSON.stringify(a)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(b)}\n\`\`\``;
    expect((extractReportJson(text) as { summary: string }).summary).toBe("b");
  });

  it("prose-wrapped valid report beats a later prose-wrapped invalid one", () => {
    const invalid = { success: "yes" };
    const text = `report ${JSON.stringify(VALID)} and quoting ${JSON.stringify(invalid)}`;
    expect(extractReportJson(text)).toEqual(VALID);
  });
});
