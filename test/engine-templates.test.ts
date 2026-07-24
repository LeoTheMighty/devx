import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(repoRoot, "_devx", "templates", "engine");

const EXPECTED_TEMPLATES = [
  "prd.md",
  "expectations.md",
  "design.md",
  "plan.md",
  "decision.md",
  "red-report.md",
  "checkpoint.md",
  "lessons-entry.md",
  "results.md",
  "todo.md",
];

// D-10 (v2/07-decisions.md): no external-tracker surface anywhere in the
// engine. GitHub is the only external surface.
const FORBIDDEN = /jira|confluence|atlassian/i;

describe("engine templates (v2s101)", () => {
  it("ships all engine templates", () => {
    const found = readdirSync(engineDir).filter((f) => f.endsWith(".md"));
    for (const name of EXPECTED_TEMPLATES) {
      expect(found, `missing template ${name}`).toContain(name);
    }
  });

  it.each(EXPECTED_TEMPLATES)(
    "%s contains no external-tracker references (D-10)",
    (name) => {
      const body = readFileSync(join(engineDir, name), "utf8");
      const match = body.match(FORBIDDEN);
      expect(
        match,
        `${name} references forbidden tracker "${match?.[0]}"`,
      ).toBeNull();
    },
  );

  it("expectations template carries the exact E-block field set", () => {
    const body = readFileSync(join(engineDir, "expectations.md"), "utf8");
    for (const field of [
      "**Priority:**",
      "**Covers:**",
      "**Trigger:**",
      "**Expectation (EARS):**",
      "**Threshold:**",
      "**Verified by:**",
    ]) {
      expect(body).toContain(field);
    }
    expect(body).toMatch(/When <trigger>, the system SHALL <behavior>\./);
  });

  it("verdict-bearing templates open with the deterministic verdict block (D-9)", () => {
    for (const name of ["decision.md", "red-report.md", "checkpoint.md"]) {
      const body = readFileSync(join(engineDir, name), "utf8");
      expect(body.startsWith("---\n"), `${name} must open with frontmatter`).toBe(true);
      expect(body, `${name} verdict vocabulary`).toMatch(/gate: <PASS \| CONCERNS \| FAIL/);
      expect(body).toContain("status_reason:");
      expect(body).toContain("reviewer:");
    }
    const results = readFileSync(join(engineDir, "results.md"), "utf8");
    expect(results).toMatch(/outcome: <keep \| tune \| restart \| retire>/);
  });

  it("workstreams root exists", () => {
    expect(existsSync(join(repoRoot, "_devx", "workstreams", ".gitkeep"))).toBe(true);
  });
});
