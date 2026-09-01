// §31 Reading Guide structural check (port of mycase/8am-harness #62).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  blocksGate,
  checkReadingGuide,
  headings,
  parseReadingGuide,
  splitTableRow,
} from "../src/lib/engine/reading-guide.js";

const ROLES = ["pm", "architect", "dev", "qa"];

const GOOD_HUMAN = `# design — thing (human digest)

## Reading guide

| Section | What it covers | pm | architect | dev | qa |
| --- | --- | :-: | :-: | :-: | :-: |
| Overview | what this solves | ● | ● | ● | ● |
| Architecture | what shape, and why | ○ | ● | ● | |
| Token bucket | how spend is bounded | | ● | ● | ● |
| Risks | what could go wrong | ● | ○ | ○ | ● |

## Overview

Prose.

## Architecture

Prose.

## Token bucket

Prose.

## Risks

Prose.
`;

const GOOD_AGENT = `# Design — thing

## Design

### Token bucket

Prose.

## Migration plan
`;

describe("splitTableRow", () => {
  it("splits on unescaped pipes and trims", () => {
    expect(splitTableRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  });

  it("treats an escaped pipe as cell content, not a separator", () => {
    // The upstream bug: splitting on a bare `|` shredded enum cells and
    // shifted every later column, so the checks read the wrong cell.
    expect(splitTableRow("| `a` \\| `b` | second | third |")).toEqual([
      "`a` | `b`",
      "second",
      "third",
    ]);
  });

  it("handles rows without outer pipes", () => {
    expect(splitTableRow("a | b")).toEqual(["a", "b"]);
  });
});

describe("headings", () => {
  it("collects ATX headings with levels", () => {
    expect(headings("# A\n\n## B\n\n### C\n")).toEqual([
      { level: 1, text: "A" },
      { level: 2, text: "B" },
      { level: 3, text: "C" },
    ]);
  });

  it("ignores headings inside fenced code", () => {
    expect(headings("# A\n\n```\n# not a heading\n```\n")).toEqual([
      { level: 1, text: "A" },
    ]);
  });
});

describe("parseReadingGuide", () => {
  it("parses roles and rows from the anchored section", () => {
    const g = parseReadingGuide(GOOD_HUMAN);
    expect(g.present).toBe(true);
    expect(g.roles).toEqual(ROLES);
    expect(g.rows.map((r) => r.section)).toEqual([
      "Overview",
      "Architecture",
      "Token bucket",
      "Risks",
    ]);
    expect(g.rows[1].marks).toEqual(["○", "●", "●", ""]);
  });

  it("reports absent when there is no guide heading", () => {
    expect(parseReadingGuide("# design\n\n## Overview\n").present).toBe(false);
  });

  it("anchors on the heading — a table ABOVE the guide is never scanned", () => {
    // Upstream's phantom-failure bug: an unanchored find() matched an
    // unrelated table and scanned it as if it were the guide.
    const md = `# design

| Config key | Value |
| --- | --- |
| foo | bar |

## Reading guide

| Section | What it covers | pm |
| --- | --- | :-: |
| Overview | the thing | ● |

## Overview
`;
    const g = parseReadingGuide(md);
    expect(g.roles).toEqual(["pm"]);
    expect(g.rows).toHaveLength(1);
  });

  it("stops at the next section heading", () => {
    const g = parseReadingGuide(GOOD_HUMAN);
    expect(g.rows.every((r) => r.section !== "")).toBe(true);
  });

  it("skips the template's HTML comment block", () => {
    const md = `## Reading guide

<!-- guidance
| not | a | row |
-->

| Section | What it covers | pm |
| --- | --- | :-: |
| Overview | the thing | ● |

## Overview
`;
    const g = parseReadingGuide(md);
    expect(g.rows.map((r) => r.section)).toEqual(["Overview"]);
  });

  it("splits a grouped edge row on ·", () => {
    const md = `## Reading guide

| Section | What it covers | pm |
| --- | --- | :-: |
| Constraints · Assumptions | the edges | ○ |

## Constraints

## Assumptions
`;
    expect(parseReadingGuide(md).rows[0].sections).toEqual([
      "Constraints",
      "Assumptions",
    ]);
  });
});

describe("checkReadingGuide", () => {
  it("passes a synced guide", () => {
    const f = checkReadingGuide({
      humanMd: GOOD_HUMAN,
      designAgentMd: GOOD_AGENT,
      roles: ROLES,
    });
    expect(f).toEqual([]);
    expect(blocksGate(f)).toBe(false);
  });

  it("grandfathers a pre-§31 render as one advisory finding", () => {
    const f = checkReadingGuide({
      humanMd: "# design\n\n## Overview\n\nProse.\n",
      designAgentMd: GOOD_AGENT,
      roles: ROLES,
    });
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("missing-guide");
    expect(blocksGate(f)).toBe(false);
  });

  it("blocks a row that names no section in the render", () => {
    const human = GOOD_HUMAN.replace("| Risks |", "| Ghost section |");
    const f = checkReadingGuide({
      humanMd: human,
      designAgentMd: GOOD_AGENT,
      roles: ROLES,
    });
    expect(f.some((x) => x.kind === "row-names-no-section")).toBe(true);
    expect(blocksGate(f)).toBe(true);
  });

  it("blocks a design mechanism with no row", () => {
    const agent = GOOD_AGENT.replace(
      "### Token bucket",
      "### Token bucket\n\nProse.\n\n### Refill clock",
    );
    const f = checkReadingGuide({
      humanMd: GOOD_HUMAN,
      designAgentMd: agent,
      roles: ROLES,
    });
    const hit = f.find((x) => x.kind === "mechanism-has-no-row");
    expect(hit?.message).toContain("Refill clock");
    expect(blocksGate(f)).toBe(true);
  });

  it("ignores `###` headings outside the Design section", () => {
    const agent = `# Design — thing

## Trade-offs

### Rejected: a global lock

## Design

### Token bucket
`;
    const f = checkReadingGuide({
      humanMd: GOOD_HUMAN,
      designAgentMd: agent,
      roles: ROLES,
    });
    expect(f.some((x) => x.kind === "mechanism-has-no-row")).toBe(false);
  });

  it("flags a role column carrying no ● outside Overview", () => {
    const human = GOOD_HUMAN.replace(
      "| Risks | what could go wrong | ● | ○ | ○ | ● |",
      "| Risks | what could go wrong | ○ | ○ | ○ | ● |",
    ).replace(
      "| Architecture | what shape, and why | ○ | ● | ● | |",
      "| Architecture | what shape, and why | ○ | ● | ● | |",
    );
    // pm now carries ● only on Overview.
    const f = checkReadingGuide({
      humanMd: human,
      designAgentMd: GOOD_AGENT,
      roles: ROLES,
    });
    const hit = f.find((x) => x.kind === "blank-role-column");
    expect(hit?.message).toContain('"pm"');
    expect(hit?.severity).toBe("advisory");
  });

  it("flags a malformed mark", () => {
    const human = GOOD_HUMAN.replace(
      "| Risks | what could go wrong | ● | ○ | ○ | ● |",
      "| Risks | what could go wrong | X | ○ | ○ | ● |",
    );
    const f = checkReadingGuide({
      humanMd: human,
      designAgentMd: GOOD_AGENT,
      roles: ROLES,
    });
    expect(f.some((x) => x.kind === "malformed-mark")).toBe(true);
  });

  it("flags a column set that disagrees with config, advisorily", () => {
    const f = checkReadingGuide({
      humanMd: GOOD_HUMAN,
      designAgentMd: GOOD_AGENT,
      roles: ["pm", "architect", "dev", "qa", "security"],
    });
    const hit = f.find((x) => x.kind === "role-set-mismatch");
    expect(hit?.severity).toBe("advisory");
    expect(blocksGate(f.filter((x) => x.kind === "role-set-mismatch"))).toBe(false);
  });

  it("never matches template placeholders against real headings", () => {
    const human = GOOD_HUMAN.replace(
      "| Risks | what could go wrong | ● | ○ | ○ | ● |",
      "| <### mechanism> | <the question it answers> | ● | ○ | ○ | ● |",
    ).replace("## Risks\n\nProse.\n", "");
    const f = checkReadingGuide({
      humanMd: human,
      designAgentMd: GOOD_AGENT,
      roles: ROLES,
    });
    expect(f.some((x) => x.kind === "row-names-no-section")).toBe(false);
  });

  it("the SHIPPED design templates are structurally in sync with each other", () => {
    // The scaffold is the exemplar every render is copied from. If it cannot
    // pass its own check, neither will anything derived from it.
    const dir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "_devx/templates/engine/design",
    );
    const f = checkReadingGuide({
      humanMd: readFileSync(join(dir, "human.md"), "utf8"),
      designAgentMd: readFileSync(join(dir, "agent.md"), "utf8"),
      roles: ROLES,
    });
    expect(f).toEqual([]);
  });

  it("sorts blocking findings ahead of advisory ones", () => {
    const human = GOOD_HUMAN.replace("| Risks |", "| Ghost section |");
    const f = checkReadingGuide({
      humanMd: human,
      designAgentMd: GOOD_AGENT,
      roles: ["pm", "architect", "dev", "qa", "security"],
    });
    expect(f[0].severity).toBe("blocking");
    expect(f[f.length - 1].severity).toBe("advisory");
  });
});
