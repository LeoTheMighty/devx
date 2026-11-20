// md-fence (harness-s4): CommonMark-shaped fence detection shared by Gate 2's
// mechanical hygiene and `devx render lint`. The first case is the real-repo
// regression: story-graph's design writes an inline ```mermaid``` span at the
// start of a bullet, and a naive toggle flipped every fence after it.

import { describe, expect, it } from "vitest";

import { fenceLang, fencedLineMask } from "../src/lib/engine/md-fence.js";

const mask = (md: string): boolean[] => fencedLineMask(md.split("\n"));

describe("fencedLineMask", () => {
  it("does not open a fence on an inline ```lang``` span (story-graph shape)", () => {
    const md = [
      "  ```mermaid``` flowchart per GRAPH.md",
      "## Real heading",
      "```",
      "code",
      "```",
      "## After",
    ].join("\n");
    expect(mask(md)).toEqual([false, false, true, true, true, false]);
  });

  it("closes only on the same character, at least as long, with nothing after", () => {
    const md = ["````md", "```", "~~~", "```` trailing", "````", "prose"].join("\n");
    expect(mask(md)).toEqual([true, true, true, true, true, false]);
  });

  it("accepts tilde fences, whose info string may hold a backtick", () => {
    expect(mask(["~~~ `x`", "inside", "~~~", "out"].join("\n"))).toEqual([true, true, true, false]);
  });

  it("treats indented fences inside list items as fences", () => {
    expect(mask(["- item", "  ```ts", "  x", "  ```", "- next"].join("\n"))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("leaves an unclosed fence open to the end (CommonMark)", () => {
    expect(mask(["```", "a", "## not a heading"].join("\n"))).toEqual([true, true, true]);
  });
});

describe("fenceLang", () => {
  it("reads the info string's first word", () => {
    expect(fenceLang("```mermaid")).toBe("mermaid");
    expect(fenceLang("  ~~~ ts title=x")).toBe("ts");
    expect(fenceLang("```")).toBe("");
    expect(fenceLang("prose")).toBe("");
  });
});
