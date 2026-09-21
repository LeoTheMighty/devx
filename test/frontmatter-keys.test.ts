// Unit tests for src/lib/frontmatter-keys.ts (828385).
//
// The primitive exists because `updateSpecForClaim` detected its keys with
// `/^owner:\s/` — whitespace REQUIRED after the colon — so a spec authored
// with a bare `owner:` missed the replace branch and got a second key
// spliced in. Everything here is built around the four `owner:` shapes from
// the spec's repro table plus the two things that make a naive reader wrong
// in a different way: body content that looks like frontmatter, and a key
// name that appears as a substring of a value.
//
// Spec: debug/debug-828385-2026-09-20T10:06-claim-splices-duplicate-owner-key.md

import { describe, expect, it } from "vitest";

import {
  duplicateFrontmatterKeys,
  findFrontmatterKeys,
  frontmatterKeyValue,
  renderFrontmatter,
  splitFrontmatterLines,
  upsertFrontmatterKey,
} from "../src/lib/frontmatter-keys.js";

function block(fm: string): string[] {
  const parsed = splitFrontmatterLines(`---\n${fm}\n---\n\n## Goal\nbody\n`);
  if (!parsed) throw new Error("fixture has no frontmatter");
  return parsed.lines;
}

// ---------------------------------------------------------------------------
// The repro table from the spec: all four `owner:` shapes upsert to ONE key
// ---------------------------------------------------------------------------

describe("upsertFrontmatterKey — the 828385 repro table", () => {
  const shapes: Array<[label: string, line: string]> = [
    ["bare", "owner:"],
    ["null", "owner: null"],
    ["trailing space", "owner: "],
    ["two spaces", "owner:  "],
  ];

  for (const [label, line] of shapes) {
    it(`${label} → replaced in place, exactly one owner key`, () => {
      const lines = block(`hash: abc123\nstatus: ready\n${line}\nbranch:`);
      const res = upsertFrontmatterKey(lines, "owner", "/devx-session-1");

      expect(res.action).toBe("replaced");
      expect(findFrontmatterKeys(lines, "owner")).toHaveLength(1);
      expect(frontmatterKeyValue(lines, "owner")).toBe(" /devx-session-1");
      expect(duplicateFrontmatterKeys(lines)).toEqual([]);
    });
  }

  it("keeps the key in its original position rather than re-homing it", () => {
    const lines = block("hash: abc123\nstatus: ready\nowner:\nbranch:");
    upsertFrontmatterKey(lines, "owner", "/devx-session-1");
    expect(lines).toEqual([
      "hash: abc123",
      "status: ready",
      "owner: /devx-session-1",
      "branch:",
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC 3 — a spec ALREADY corrupted converges rather than growing a third key
// ---------------------------------------------------------------------------

describe("upsertFrontmatterKey — convergence on already-corrupt specs", () => {
  // Shaped exactly like the in-the-wild instance: palateful's imptb1 after
  // its claim, real owner spliced at statusIdx+1 with the stale bare key
  // left below it. (That file was repaired in PR #26, so this is the
  // synthetic fixture the spec calls for — there is no live instance.)
  const CORRUPT = [
    "hash: imptb1",
    "type: debug",
    "status: in-progress",
    "owner: /devx-2026-09-20T0958-90325",
    "owner:",
    "branch:",
  ];

  it("collapses duplicates to one key on the next write", () => {
    const lines = [...CORRUPT];
    const res = upsertFrontmatterKey(lines, "owner", "/devx-session-2");

    expect(res.action).toBe("replaced");
    expect(res.removedDuplicates).toBe(1);
    expect(findFrontmatterKeys(lines, "owner")).toHaveLength(1);
    expect(lines).toEqual([
      "hash: imptb1",
      "type: debug",
      "status: in-progress",
      "owner: /devx-session-2",
      "branch:",
    ]);
  });

  it("does not grow a third key", () => {
    const lines = [...CORRUPT];
    upsertFrontmatterKey(lines, "owner", "/devx-a");
    upsertFrontmatterKey(lines, "owner", "/devx-b");
    expect(findFrontmatterKeys(lines, "owner")).toHaveLength(1);
  });

  it("reports the duplication before it is repaired", () => {
    expect(duplicateFrontmatterKeys([...CORRUPT])).toEqual(["owner"]);
  });
});

// ---------------------------------------------------------------------------
// Inserting a genuinely absent key
// ---------------------------------------------------------------------------

describe("upsertFrontmatterKey — insert path", () => {
  it("inserts after the anchor key when one is given", () => {
    const lines = block("hash: abc123\nstatus: ready\nbranch:");
    const res = upsertFrontmatterKey(lines, "owner", "/devx-1", {
      afterKey: "status",
    });
    expect(res.action).toBe("inserted");
    expect(lines).toEqual([
      "hash: abc123",
      "status: ready",
      "owner: /devx-1",
      "branch:",
    ]);
  });

  it("appends when the anchor key is absent", () => {
    const lines = block("hash: abc123\nbranch:");
    upsertFrontmatterKey(lines, "owner", "/devx-1", { afterKey: "status" });
    expect(lines[lines.length - 1]).toBe("owner: /devx-1");
  });
});

// ---------------------------------------------------------------------------
// AC 6 — block-scoping is the control; anchoring alone is not
// ---------------------------------------------------------------------------

describe("splitFrontmatterLines — block scoping", () => {
  it("ignores a bare key inside a fenced body block", () => {
    // This is 828385's own shape. A correctly line-anchored whole-file scan
    // (`grep '^owner:$'`) matches the sample in the body and reports the
    // spec as carrying the bug it documents. Scoping is what saves you.
    const content = [
      "---",
      "hash: 828385",
      "status: ready",
      "owner: null",
      "---",
      "",
      "## The consequence",
      "",
      "```yaml",
      "status: in-progress",
      "owner: /devx-2026-09-20T1000-111",
      "owner:",
      "branch: null",
      "```",
      "",
    ].join("\n");

    const fm = splitFrontmatterLines(content);
    expect(fm).not.toBeNull();
    expect(findFrontmatterKeys(fm!.lines, "owner")).toHaveLength(1);
    expect(frontmatterKeyValue(fm!.lines, "owner")).toBe(" null");
    expect(duplicateFrontmatterKeys(fm!.lines)).toEqual([]);
  });

  it("does not count `owner:` appearing inside a quoted title value", () => {
    // The frontmatter block below holds 2 substring occurrences of `owner:`
    // and exactly 1 line-anchored key, so an unanchored reader is wrong in a
    // different way than an unscoped one.
    const lines = block(
      'hash: 828385\ntitle: "Claim splices a duplicate owner: key"\nowner: null',
    );
    expect(findFrontmatterKeys(lines, "owner")).toHaveLength(1);
    expect(duplicateFrontmatterKeys(lines)).toEqual([]);
  });

  it("does not match a nested key indented under a bare parent", () => {
    // devx's own plan specs do this: `outcome:` bare, heading a mapping
    // whose child is itself called `status:`. A top-level reader must not
    // mistake the child for the spec's own `status:`.
    const lines = block(
      "hash: 62bcd1\nstatus: done\noutcome:\n  status: pending\n  measure_by: 2026-09-20",
    );
    expect(findFrontmatterKeys(lines, "status")).toEqual([1]);
    expect(frontmatterKeyValue(lines, "status")).toBe(" done");
    expect(duplicateFrontmatterKeys(lines)).toEqual([]);
  });

  it("does not match a key that is a prefix of another", () => {
    const lines = block("owner: /devx-1\nownership: shared");
    expect(findFrontmatterKeys(lines, "owner")).toEqual([0]);
  });

  it("does not read a column-0 YAML list item as a key", () => {
    // `- foo: bar` at column 0 is a list item, not a mapping key. A reader
    // that takes "anything up to the first colon" calls it `- foo` — the
    // same reader-disagrees-with-YAML class this module exists to end.
    const lines = block("hash: abc\nblocked_by:\n- foo: bar\n- foo: baz");
    expect(duplicateFrontmatterKeys(lines)).toEqual([]);
  });

  it("returns null for content with no frontmatter", () => {
    expect(splitFrontmatterLines("# Just a doc\n")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bare keys stay legal — they are devx's own template convention
// ---------------------------------------------------------------------------

describe("bare keys are valid, not defects", () => {
  it("reads a bare key as empty, distinctly from absent", () => {
    const lines = block("hash: abc\nowner:");
    expect(frontmatterKeyValue(lines, "owner")).toBe("");
    expect(frontmatterKeyValue(lines, "branch")).toBeNull();
  });

  it("treats a plan spec's bare nested-mapping parents as clean", () => {
    // Verbatim shape from plan/plan-62bcd1-...-story-graph.md, one of the
    // 14 of 25 devx plan specs that would have failed a bare-key rule.
    const lines = block(
      [
        "hash: 62bcd1",
        "status: done",
        "gate_status:",
        "  prd_validated: true",
        "  design_verified: true",
        "outcome:",
        "  status: pending",
        "gate_verdicts:",
        "  prd: PASS",
      ].join("\n"),
    );
    expect(duplicateFrontmatterKeys(lines)).toEqual([]);
    expect(findFrontmatterKeys(lines, "gate_status")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Round-tripping
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CRLF — the reason this module delegates its fence parse to engine/
// ---------------------------------------------------------------------------

describe("CRLF specs", () => {
  // A fresh hand-rolled /^---\n…\n---/ finds NO frontmatter in a CRLF file
  // and returns null, which surfaces as "spec missing frontmatter block"
  // from the claim and as a silent "no owner" from doctor — i.e. strictly
  // worse than the `m`-flag readers it replaced. engine/frontmatter.ts
  // already owned a CRLF-tolerant fence regex, so this delegates rather
  // than keeping a second parser for one format.
  const CRLF = "---\r\nhash: abc\r\nstatus: ready\r\nowner:\r\n---\r\n\r\n## Goal\r\nx\r\n";

  it("finds the frontmatter block", () => {
    const fm = splitFrontmatterLines(CRLF);
    expect(fm).not.toBeNull();
    expect(findFrontmatterKeys(fm!.lines, "owner")).toHaveLength(1);
  });

  it("reads a bare key despite the carriage return", () => {
    const fm = splitFrontmatterLines(CRLF)!;
    expect(frontmatterKeyValue(fm.lines, "status")?.trim()).toBe("ready");
    expect(frontmatterKeyValue(fm.lines, "owner")).toBe("");
  });

  it("upserts without splicing a duplicate", () => {
    const fm = splitFrontmatterLines(CRLF)!;
    upsertFrontmatterKey(fm.lines, "owner", "/devx-1");
    expect(findFrontmatterKeys(fm.lines, "owner")).toHaveLength(1);
    const out = renderFrontmatter(fm);
    expect(out).toContain("owner: /devx-1");
    // Body is preserved verbatim, CRLF and all; only the frontmatter
    // block normalizes to LF.
    expect(out).toContain("## Goal\r\nx\r\n");
  });

  it("round-trips a spec that ends at the closing fence", () => {
    const noBody = "---\nhash: abc\nstatus: ready\n---";
    const fm = splitFrontmatterLines(noBody)!;
    // joinFrontmatter's rule: a block that ended the file with no trailing
    // newline gets one back rather than producing a newline-less spec.
    expect(renderFrontmatter(fm)).toBe("---\nhash: abc\nstatus: ready\n---\n");
  });
});

describe("renderFrontmatter", () => {
  it("round-trips an untouched spec byte-for-byte", () => {
    const content = "---\nhash: abc\nstatus: ready\nowner:\n---\n\n## Goal\nx\n";
    const fm = splitFrontmatterLines(content)!;
    expect(renderFrontmatter(fm)).toBe(content);
  });

  it("preserves body content around an edit", () => {
    const content = "---\nhash: abc\nstatus: ready\nowner:\n---\n\n## Goal\nx\n";
    const fm = splitFrontmatterLines(content)!;
    upsertFrontmatterKey(fm.lines, "owner", "/devx-1");
    expect(renderFrontmatter(fm)).toBe(
      "---\nhash: abc\nstatus: ready\nowner: /devx-1\n---\n\n## Goal\nx\n",
    );
  });
});
