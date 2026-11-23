// blankFencedLines() fence parity (harness loose end 1). Before it delegated
// to md-fence.ts it was a bare `^\s*```` toggle, so an INLINE ```lang```
// span at the start of a line opened a phantom fence and blanked everything
// below it. The line under test is story-graph's design prose verbatim
// (`_devx/archive/story-graph/design/agent.md:30`); each case puts it in a
// file a real caller reads and asserts on what sits BELOW it — on the old
// toggle that content was "inside a fence" and vanished.

import { describe, expect, it } from "vitest";

import { blankFencedLines, parseDevMd } from "../src/lib/backlog/parse.js";
import { appendToStatusLog } from "../src/lib/loop/spec-io.js";
import { parsePlanStoryHashes } from "../src/lib/plan/validate-emit.js";

const INLINE_SPAN = "  ```mermaid``` flowchart per GRAPH.md; must stay within GitHub's Mermaid";
const WRAPPED_BULLET = ["- **GitHub-rendered Mermaid is the whole UI** (PRD non-goal): one fenced", INLINE_SPAN];

describe("blankFencedLines — inline ```lang``` span keeps fence parity", () => {
  it("leaves the span and every line after it visible", () => {
    const lines = [...WRAPPED_BULLET, "## Below", "```", "code", "```", "after"];
    expect(blankFencedLines(lines)).toEqual([...WRAPPED_BULLET, "## Below", "", "", "", "after"]);
  });

  it("closes only on a bare closer at least as long as the opener (md-fence semantics)", () => {
    const lines = ["````md", "```ts", "- [ ] not a row", "````", "prose"];
    expect(blankFencedLines(lines)).toEqual(["", "", "", "", "prose"]);
  });

  it("CRLF lines still open and close fences (validate-emit passes them un-stripped)", () => {
    const body = ["## Phase checklist", "```md", "- [ ] Phase 9: example (dev spec: zzz999)", "```", "- [ ] Phase 1: real (dev spec: abc123)", ""].join("\r\n");
    expect(parsePlanStoryHashes(body).map((h) => h.hash)).toEqual(["abc123"]);
  });

  it("parseDevMd: rows below the span are still rows (devx next, graph, loop)", () => {
    const md = [
      "# DEV",
      "",
      "### Epic — story graph",
      ...WRAPPED_BULLET,
      "",
      "- [ ] `dev/dev-abc123-2026-11-01T10:00-render.md` — Render. Status: ready.",
      "- [ ] `dev/dev-def456-2026-11-01T10:01-backfill.md` — Backfill. Status: ready.",
      "",
    ].join("\n");
    expect(parseDevMd(md).map((r) => r.hash)).toEqual(["abc123", "def456"]);
  });

  it("parsePlanStoryHashes: a Phase checklist below the span still yields its stories", () => {
    const body = [
      "## Overview",
      ...WRAPPED_BULLET,
      "",
      "## Phase checklist",
      "- [ ] Phase 1: render (dev spec: abc123)",
      "- [ ] Phase 2: backfill (dev spec: def456)",
      "",
    ].join("\n");
    expect(parsePlanStoryHashes(body).map((h) => h.hash)).toEqual(["abc123", "def456"]);
  });

  it("appendToStatusLog: writes into the real section, not a duplicate at EOF", () => {
    const spec = [
      "## Technical notes",
      ...WRAPPED_BULLET,
      "",
      "## Status log",
      "",
      "- t0 — created",
      "",
      "## Links",
      "",
      "- none",
      "",
    ].join("\n");
    const next = appendToStatusLog(spec, "- t1 — claimed");
    expect(next.match(/^## Status log$/gm)).toHaveLength(1);
    expect(next).toContain("- t0 — created\n- t1 — claimed\n\n## Links");
  });
});
