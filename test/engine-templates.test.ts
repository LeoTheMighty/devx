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
  "qa-walkthrough.md",
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

  // The emitted walkthrough is parsed by consumer-side evals (checkbox
  // lines tagged machine/human; human items carry an inline "verify"
  // hint). Pin the same regexes here so the template can't drift out of
  // the contract it's supposed to teach.
  it("qa-walkthrough template carries the machine/human item contract", () => {
    const body = readFileSync(join(engineDir, "qa-walkthrough.md"), "utf8");

    const headings = body
      .split("\n")
      .filter((l) => l.startsWith("## "))
      .map((l) => l.slice(3).trim());
    expect(headings).toEqual([
      "Pre-flight",
      "Manual checks",
      "Regressions to watch",
      "Post-merge follow-ups",
    ]);

    const items = body
      .split("\n")
      .filter((l) => /^\s*[-*]\s\[.\]/.test(l));
    const machine = items.filter((l) => /\bmachine\b/.test(l));
    const human = items.filter((l) => /\bhuman\b/.test(l));
    expect(machine.length, "template must demo a machine item").toBeGreaterThan(0);
    expect(human.length, "template must demo a human item").toBeGreaterThan(0);
    for (const l of human) {
      expect(l, `human item needs a "verify" hint: ${l}`).toMatch(/verify/i);
    }

    // Every machine item needs somewhere to paste evidence — the eval
    // budgets one fenced block pair per machine item, file-wide.
    const fences = (body.match(/^\s*```/gm) ?? []).length;
    expect(Math.floor(fences / 2)).toBeGreaterThanOrEqual(machine.length);
  });

  // ea4f41 AC 2: the emitted walkthrough is a spec, not a loose markdown
  // file — it needs a hash of its OWN (reusing the story's makes the story
  // unresolvable by every by-hash CLI) plus the fields the backlog tooling
  // reads. Pinned on the template because that is what the emission step
  // copies.
  it("qa-walkthrough template opens with canonical spec frontmatter", () => {
    const body = readFileSync(join(engineDir, "qa-walkthrough.md"), "utf8");
    expect(body.startsWith("---\n")).toBe(true);
    const fm = body.slice(4, body.indexOf("\n---", 4));
    for (const field of [
      "hash:",
      "type: test",
      "created:",
      "title:",
      "from:",
      "status: ready",
    ]) {
      expect(fm, `frontmatter missing ${field}`).toContain(field);
    }
    // The whole point of the field: the placeholder must not invite the
    // story's hash back in.
    expect(fm).toMatch(/never the story's/);
  });

  it("workstreams root exists", () => {
    expect(existsSync(join(repoRoot, "_devx", "workstreams", ".gitkeep"))).toBe(true);
  });
});
