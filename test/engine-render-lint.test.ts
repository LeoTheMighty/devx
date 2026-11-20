// `devx render lint` (harness-s4; gap analysis B9 / C16 / D6 / E3): the
// measurable half of docs/RENDER-STYLE.md. Each rule gets a positive and a
// negative case; the CLI gets its exit-code contract (0 clean · 1 HARD ·
// 2 could-not-check) under both layouts. The calibration against this repo's
// one shipped design render lives in the RENDER-STYLE.md "Calibration" note.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRenderLint } from "../src/commands/render.js";
import {
  RENDER_BUDGETS,
  countWords,
  formatLintReport,
  githubSlug,
  lintRender,
  renumberFootnotes,
} from "../src/lib/engine/render-lint.js";
import { type EngineRepo, captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";
import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

const rules = (md: string, opts?: { agentMd?: string }) =>
  lintRender(md, opts).findings.map((f) => `${f.severity}:${f.rule}`);
const words = (n: number, w = "word"): string => Array.from({ length: n }, () => w).join(" ");
/** n distinct words, so phrase/duplicate checks never fire by accident. */
const distinct = (n: number, seed = "w"): string => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

describe("word counting + slugs", () => {
  it("counts tokens carrying a letter or digit, ignoring markup and footnotes", () => {
    expect(countWords("a **b** `c` — | → [link text](x) <sup>[1](#y)</sup>")).toBe(5);
  });

  it("slugs headings the way GitHub anchors them", () => {
    expect(githubSlug("Data Model & Schema Changes")).toBe("data-model--schema-changes");
    expect(githubSlug("`devx layout migrate`")).toBe("devx-layout-migrate");
    expect(githubSlug("Threading the layout through `EngineConfig`")).toBe("threading-the-layout-through-engineconfig");
  });
});

describe("budgets (R9)", () => {
  it("total prose: advisory over the target, HARD over the hard stop", () => {
    const body = (n: number) => `## Overview\n\n${distinct(50)}\n\n${Array.from({ length: Math.ceil(n / 60) }, (_, i) => `## S${i}\n\n${distinct(60, `s${i}x`)}`).join("\n\n")}\n`;
    expect(rules(body(4200))).toContain("advisory:total-length");
    expect(rules(body(4200))).not.toContain("HARD:total-length");
    expect(rules(body(5100))).toContain("HARD:total-length");
    expect(rules(body(3000)).filter((r) => r.endsWith("total-length"))).toEqual([]);
  });

  it("boilerplate sections (Reading guide, Decision log, Glossary) are not prose", () => {
    const md = `## Reading guide\n\n${distinct(6000)}\n\n## Glossary\n\n${distinct(100, "g")}\n`;
    const r = lintRender(md);
    expect(r.metrics.proseWords).toBe(0);
    expect(r.findings.filter((f) => f.rule === "total-length")).toEqual([]);
  });

  it("Overview has its own budget", () => {
    expect(rules(`## Overview\n\n- ${distinct(30)}\n- ${distinct(30, "b")}\n- ${distinct(30, "c")}\n- ${distinct(30, "d")}\n- ${distinct(30, "e")}\n- ${distinct(30, "f")}\n- ${distinct(30, "g")}\n`)).toContain(
      "advisory:overview-length",
    );
    expect(rules(`## Overview\n\n${distinct(60)}\n`)).not.toContain("advisory:overview-length");
  });

  it("each `##` section is a unit, children included; a `## Design` container budgets its `###`s", () => {
    const big = Array.from({ length: 13 }, (_, i) => `- ${distinct(30, `p${i}`)}`).join("\n");
    const flat = lintRender(`## Mechanism\n\n### Part\n\n${big}\n`);
    expect(Object.keys(flat.metrics.sections)).toEqual(["Mechanism"]);
    expect(flat.findings.map((f) => f.rule)).toContain("section-length");
    const container = lintRender(`## Design\n\n### A\n\n${distinct(20)}\n\n### B\n\n${distinct(20, "b")}\n`);
    expect(Object.keys(container.metrics.sections)).toEqual(["Design › A", "Design › B"]);
  });

  it("paragraph and bullet budgets (bullet = own text, children excluded)", () => {
    expect(rules(`## A\n\n${distinct(81)}\n`)).toContain("advisory:paragraph-length");
    expect(rules(`## A\n\n${distinct(80)}\n`)).not.toContain("advisory:paragraph-length");
    expect(rules(`## A\n\n- ${distinct(41)}\n`)).toContain("advisory:bullet-length");
    expect(rules(`## A\n\n- ${distinct(20)}\n  - ${distinct(30, "c")}\n`)).not.toContain("advisory:bullet-length");
    // A continuation line counts toward its bullet.
    expect(rules(`## A\n\n- ${distinct(30)}\n  ${distinct(15, "k")}\n`)).toContain("advisory:bullet-length");
  });
});

describe("table cells (R6)", () => {
  const table = (cell: string) => `## A\n\n| When | Change |\n| --- | --- |\n| on claim | ${cell} |\n`;

  it("advisory over 20 words, HARD over 40", () => {
    expect(rules(table(distinct(21)))).toContain("advisory:table-cell-length");
    expect(rules(table(distinct(41)))).toContain("HARD:table-cell-length");
    expect(rules(table(distinct(10)))).toEqual([]);
  });

  it("an escaped pipe stays inside its cell", () => {
    expect(rules(table(`${distinct(12)} \\| ${distinct(12, "z")}`))).toContain("advisory:table-cell-length");
  });

  it("the Reading guide's cells are boilerplate, never budgeted", () => {
    expect(rules(`## Reading guide\n\n| Section | What it covers |\n| --- | --- |\n| A | ${distinct(45)} |\n`)).toEqual([]);
  });

  it("a whole-cell Why/Rationale/Failure column restates another section; an impact column does not", () => {
    expect(rules("## A\n\n| Part | Why |\n| --- | --- |\n| x | y |\n")).toContain("advisory:duplicate-column");
    expect(rules("## A\n\n| Part | Why it matters |\n| --- | --- |\n| x | y |\n")).not.toContain("advisory:duplicate-column");
    // The owning section may carry its own column.
    expect(rules("## A\n\n### Failure handling\n\n| Class | Failure |\n| --- | --- |\n| x | y |\n")).not.toContain(
      "advisory:duplicate-column",
    );
  });
});

describe("apparatus leak (R10)", () => {
  it.each(["G-2", "E-14", "FR-3", "UC-1", "CAP-7", "§15", "§ 4.4", "Gate 2", "RED gate"])("HARD on `%s`", (token) => {
    const r = lintRender(`## A\n\nThe thing ${token} names.\n`);
    expect(r.findings.map((f) => `${f.severity}:${f.rule}`)).toContain("HARD:apparatus-leak");
    expect(r.findings[0].message).toContain(token.replace(/\s+/g, " "));
  });

  it("is not fooled by look-alikes", () => {
    expect(rules("## A\n\nE-mail, G-force, a 2-gate design, FREE-1x.\n")).toEqual([]);
  });

  it("ignores fenced code", () => {
    expect(rules("## A\n\n```\nG-2\n```\n")).toEqual([]);
  });
});

describe("footnotes + back-references (R3, R13)", () => {
  const ok = [
    "## Reading guide",
    "",
    "A superscript number is a link to the section that owns that fact.",
    "",
    "## Overview",
    "",
    "Spend is bounded<sup>[1](#token-bucket)</sup> and audited<sup>[2](#audit-log)</sup>.",
    "",
    "## Token bucket",
    "<sup>[1]</sup>",
    "",
    "Refills on a timer, again<sup>[1](#token-bucket)</sup>.",
    "",
    "## Audit log",
    "<sup>[2]</sup>",
    "",
    "Appends a line.",
    "",
    // Enough prose that three footnotes sit under the density ceiling.
    "## Filler",
    "",
    ...Array.from({ length: 5 }, (_, i) => `- ${distinct(30, `f${i}x`)}`),
    "",
  ].join("\n");

  it("a correct render is clean", () => {
    expect(rules(ok)).toEqual([]);
    const m = lintRender(ok).metrics;
    expect([m.footnotes, m.footnoteTargets, m.backrefTargetsMarked, m.footnoteNumberingOk]).toEqual([3, 2, 2, true]);
  });

  it("a Markdown end-note is HARD (footnote-form)", () => {
    expect(rules("## A\n\nText[^1].\n")).toContain("HARD:footnote-form");
  });

  it("a jump to no heading is HARD (footnote-target)", () => {
    expect(rules("## A\n\nText<sup>[1](#nowhere)</sup>.\n")).toContain("HARD:footnote-target");
  });

  it("out-of-order numbering is HARD and --renumber fixes it, back-refs included", () => {
    const bad = ok.replace("[1](#token-bucket)</sup> and", "[2](#token-bucket)</sup> and").replace(
      "[2](#audit-log)",
      "[1](#audit-log)",
    );
    expect(rules(bad)).toContain("HARD:footnote-numbering");
    const swapped = bad.replace("## Token bucket\n<sup>[1]</sup>", "## Token bucket\n<sup>[7]</sup>");
    const fixed = renumberFootnotes(swapped);
    expect(rules(fixed)).toEqual([]);
    expect(renumberFootnotes(fixed)).toBe(fixed);
  });

  it("a back-reference with the wrong number, or in a non-destination, is HARD", () => {
    expect(rules(ok.replace("## Audit log\n<sup>[2]</sup>", "## Audit log\n<sup>[1]</sup>"))).toContain("HARD:backref-mismatch");
    expect(rules(`${ok}\n## Other\n<sup>[3]</sup>\n\nx\n`)).toContain("HARD:backref-mismatch");
  });

  it("a missing or misplaced back-reference is advisory", () => {
    expect(rules(ok.replace("## Audit log\n<sup>[2]</sup>\n", "## Audit log\n"))).toContain("advisory:backref-missing");
    expect(rules(ok.replace("## Audit log\n<sup>[2]</sup>\n\nAppends a line.", "## Audit log\n\nAppends a line.\n<sup>[2]</sup>"))).toContain(
      "advisory:backref-place",
    );
  });

  it("footnotes without the Reading guide gloss are advisory", () => {
    expect(rules(ok.replace("A superscript number is a link to the section that owns that fact.", "Map."))).toContain(
      "advisory:footnote-legend",
    );
  });

  it("GitHub's -1 suffix resolves a repeated heading", () => {
    const filler = Array.from({ length: 2 }, (_, i) => `- ${distinct(30, `q${i}x`)}`).join("\n");
    const md = `## Reading guide\n\nsuperscript\n\n## Notes\n\nx\n\n## Notes\n<sup>[1]</sup>\n\ny\n\n## A\n\nz<sup>[1](#notes-1)</sup>\n\n${filler}\n`;
    expect(rules(md)).toEqual([]);
  });
});

describe("judgment rules point, the author decides (all advisory)", () => {
  it("duplicate-phrase: an 8-word phrase in two sections; stance sections exempt", () => {
    const phrase = "the gate reads the plan spec frontmatter only";
    expect(rules(`## A\n\n${phrase} here.\n\n## B\n\nAnd ${phrase} again.\n`)).toContain("advisory:duplicate-phrase");
    expect(rules(`## A\n\n${phrase} here.\n\n## Trade-offs\n\n- ${phrase} again.\n`)).not.toContain("advisory:duplicate-phrase");
  });

  it("restated-fact: a number+unit in three sections", () => {
    const md = "## A\n\nWaits 30 days.\n\n## B\n\nKeeps 30 days.\n\n## C\n\nAfter 30 days it goes.\n";
    expect(rules(md)).toContain("advisory:restated-fact");
    expect(rules("## A\n\nWaits 30 days.\n\n## B\n\nKeeps 30 days.\n")).not.toContain("advisory:restated-fact");
  });

  it("old-design: history narration, except a cutover fact and the Migration plan", () => {
    expect(rules("## A\n\nAn earlier draft said otherwise.\n")).toContain("advisory:old-design");
    expect(rules("## A\n\nThe old index is dropped after cutover.\n")).not.toContain("advisory:old-design");
    expect(rules("## Migration plan\n\nPreviously the flag was global.\n")).not.toContain("advisory:old-design");
  });

  it("meta-prose and non-change", () => {
    expect(rules("## A\n\nIt is worth noting the queue drains.\n")).toContain("advisory:meta-prose");
    expect(rules("## A\n\n- No new table is added.\n")).toContain("advisory:non-change");
    expect(rules("## Constraints\n\n- No new table is added.\n")).not.toContain("advisory:non-change");
    expect(rules("## A\n\n- N/A — greenfield.\n")).not.toContain("advisory:non-change");
  });

  it("why-heavy: more than a quarter of six-plus sentences explain why", () => {
    const why = "The queue is local because the daemon is gone.";
    const what = "The queue drains on every tick of the loop.";
    expect(rules(`## A\n\n${[why, why, what, what, what, what].join(" ")}\n`)).toContain("advisory:why-heavy");
    expect(rules(`## A\n\n${[why, what, what, what, what, what].join(" ")}\n`)).not.toContain("advisory:why-heavy");
  });

  it("inline-crossref: a parenthetical or `see X` naming a heading", () => {
    expect(rules("## A\n\nBounded (see Token bucket).\n\n## Token bucket\n\nx\n")).toContain("advisory:inline-crossref");
    expect(rules("## A\n\nBounded, see the Token bucket section.\n\n## Token bucket\n\nx\n")).toContain("advisory:inline-crossref");
    expect(rules("## A\n\nBounded (in practice).\n\n## Token bucket\n\nx\n")).not.toContain("advisory:inline-crossref");
  });
});

describe("parsing", () => {
  it("strips HTML comments (template guidance) before measuring", () => {
    const md = `## A\n\n<!-- ${distinct(200)}\n${distinct(200, "c")} G-1 -->\nreal text\n`;
    const r = lintRender(md);
    expect(r.findings).toEqual([]);
    expect(r.metrics.proseWords).toBe(2);
  });

  it("drops the page title and the preamble before the first `##`", () => {
    expect(lintRender(`# Title G-1\n\n> Authoritative: ${distinct(90)}\n\n## A\n\nx\n`).findings).toEqual([]);
  });

  it("counts mermaid vs other fences, and an inline ```lang``` span is not a fence", () => {
    const m = lintRender("## A\n\n- ```mermaid``` inline\n\n```mermaid\nflowchart LR\n```\n\n```ts\nx\n```\n").metrics;
    expect([m.mermaidBlocks, m.codeBlocks]).toEqual([1, 1]);
  });

  it("reports the length ratio to agent.md when given it", () => {
    const m = lintRender("## A\n\none two three four\n", { agentMd: distinct(40) }).metrics;
    expect(m.agentWords).toBe(40);
    // The ratio is whole-render words (the `A` heading included): 5 / 40.
    expect(m.ratioToAgent).toBe(0.125);
  });
});

describe("the shipped human.md templates lint clean", () => {
  for (const stage of ["prd", "design", "plan", "evals"]) {
    it(`${stage}/human.md has no HARD finding`, () => {
      const md = readFileSync(join(REAL_REPO_ROOT, "_devx", "templates", "engine", stage, "human.md"), "utf8");
      expect(lintRender(md).findings.filter((f) => f.severity === "HARD")).toEqual([]);
    });
  }
});

describe("text report", () => {
  it("leads with the metrics block, then HARD findings before advisories", () => {
    const txt = formatLintReport(lintRender(`## A\n\nG-1 here.\n\n${distinct(81)}\n`), "x/human.md");
    expect(txt.startsWith("render lint — x/human.md\n")).toBe(true);
    expect(txt).toContain(`(target ${RENDER_BUDGETS.totalProseWords}, hard ${RENDER_BUDGETS.totalProseWordsHard}`);
    expect(txt.indexOf("[HARD")).toBeLessThan(txt.indexOf("[advisory"));
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const WS = "_devx/workstreams/demo-feature";
function seed(layout: "workstream" | "project-level" = "workstream"): void {
  if (layout === "project-level") {
    repo.write(repo.configPath.slice(repo.root.length + 1), `${repo.read(repo.configPath.slice(repo.root.length + 1))}\nengine:\n  docs_layout: project-level\n`);
  }
  repo.write(
    "plan/plan-abc123-2026-07-05T13:01-demo-feature.md",
    ["---", "hash: abc123", "type: plan", "status: in-progress", "stage: design", `workstream: ${layout === "project-level" ? "." : WS}`, "---", "body", ""].join("\n"),
  );
}
const humanRel = (layout: "workstream" | "project-level") => (layout === "project-level" ? "design-human.md" : `${WS}/design/human.md`);

function lint(args: string[], flags: { json?: boolean; renumber?: boolean } = {}) {
  const io = captureIo();
  const code = runRenderLint(args, flags, { out: io.out, err: io.err, projectPath: repo.configPath });
  return { code, io };
}

describe("devx render lint — CLI", () => {
  for (const layout of ["workstream", "project-level"] as const) {
    it(`exit 0 on a clean render, 1 on a HARD finding (${layout})`, () => {
      seed(layout);
      repo.write(humanRel(layout), "## Overview\n\nA clean digest.\n");
      const clean = lint(["abc123", "design"]);
      expect(clean.code).toBe(0);
      expect(clean.io.stdout()).toContain(`render lint — ${humanRel(layout)}`);
      repo.write(humanRel(layout), "## Overview\n\nCovers G-1.\n");
      const hard = lint(["abc123", "design"], { json: true });
      expect(hard.code).toBe(1);
      const j = hard.io.json() as { path: string; metrics: { hardFindings: number } };
      expect(j.path).toBe(humanRel(layout));
      expect(j.metrics.hardFindings).toBe(1);
    });
  }

  it("advisories alone never fail", () => {
    seed();
    repo.write(humanRel("workstream"), `## Overview\n\n${distinct(300)}\n`);
    expect(lint(["abc123", "design"]).code).toBe(0);
  });

  it("exit 2 when it cannot check: bad usage, unknown stage, no digest, unknown hash", () => {
    seed();
    repo.write(humanRel("workstream"), "## Overview\n\nx\n");
    expect(lint(["abc123"]).code).toBe(2);
    expect(lint(["abc123", "outline"]).code).toBe(2);
    const missing = lint(["abc123", "plan"]);
    expect(missing.code).toBe(2);
    expect(missing.io.stderr()).toContain(`${WS}/plan/human.md does not exist`);
    expect(lint(["zzz999", "design"]).code).toBe(2);
  });

  it("--renumber rewrites the digest in place, then lints the fixed text", () => {
    seed();
    repo.write(
      humanRel("workstream"),
      "## Reading guide\n\nA superscript number jumps.\n\n## A\n\nx<sup>[4](#b)</sup>\n\n## B\n<sup>[9]</sup>\n\ny\n",
    );
    const r = lint(["abc123", "design"], { renumber: true });
    expect(r.code).toBe(0);
    expect(repo.read(humanRel("workstream"))).toContain("x<sup>[1](#b)</sup>");
    expect(repo.read(humanRel("workstream"))).toContain("## B\n<sup>[1]</sup>");
    expect(r.io.stderr()).toContain("renumbered footnotes");
  });
});
