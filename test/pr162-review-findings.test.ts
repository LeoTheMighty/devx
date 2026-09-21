// Regression suite for the retroactive three-agent review of PR #162
// (828385's shared frontmatter primitive). Each block names the review item
// it pins. Spec: debug/debug-108c57-2026-09-21T12:02-pr162-review-findings.md

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { patchParentSuperseded } from "../src/lib/devx/split.js";
import { detectMalformedFrontmatter } from "../src/lib/doctor/detect.js";
import { replaceFrontmatterStatus as doctorReplaceStatus } from "../src/lib/doctor/fix.js";
import { splitFrontmatter } from "../src/lib/engine/frontmatter.js";
import {
  duplicateFrontmatterKeys,
  editFrontmatter,
  findFrontmatterKeys,
  frontmatterKeyValue,
  frontmatterKeyValues,
  keyBlockEnd,
  specFrontmatterIssues,
  upsertFrontmatterKey,
} from "../src/lib/frontmatter-keys.js";
import { clearSpecOwner, setSpecStatus } from "../src/lib/loop/spec-io.js";
import { replaceFrontmatterStatus as loopReplaceStatus } from "../src/lib/manage/loop.js";
import { parseFrontmatterValue } from "../src/lib/plan/validate-emit.js";

const tmp: string[] = [];
function tempFile(content: string): string {
  const d = mkdtempSync(join(tmpdir(), "devx-108c57-"));
  tmp.push(d);
  const p = join(d, "spec.md");
  writeFileSync(p, content);
  return p;
}
afterEach(() => {
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true });
});

describe("item 1 — manage/loop replaceFrontmatterStatus", () => {
  it("a bare `status:` no longer swallows the next line", () => {
    const out = loopReplaceStatus("---\nstatus:\nowner: /devx-me\n---\nb\n", "blocked");
    expect(out).toBe("---\nstatus: blocked\nowner: /devx-me\n---\nb\n");
  });
  it("keeps a CRLF spec CRLF (v2l101 EC-MED-5 contract)", () => {
    const out = loopReplaceStatus("---\r\nstatus: ready\r\nowner: x\r\n---\r\nb\r\n", "blocked");
    expect(out).toBe("---\r\nstatus: blocked\r\nowner: x\r\n---\r\nb\r\n");
  });
  it("leaves content unchanged when there is no status line", () => {
    const c = "---\nowner: x\n---\nb\n";
    expect(loopReplaceStatus(c, "blocked")).toBe(c);
  });
  it("keeps a trailing comment on the status line (review round 2)", () => {
    expect(loopReplaceStatus("---\nstatus: ready  # parked until Q3\n---\nb\n", "blocked")).toBe(
      "---\nstatus: blocked  # parked until Q3\n---\nb\n",
    );
  });
  it("an indented comment under `status:` does not make it a block (review round 2)", () => {
    // This THREW in round 1: keyBlockEnd counted the comment as a child and
    // the scalar-overwrite refusal fired on a spec every writer handled.
    expect(loopReplaceStatus("---\nstatus: ready\n  # set by planner\nowner: null\n---\nb\n", "blocked")).toBe(
      "---\nstatus: blocked\n  # set by planner\nowner: null\n---\nb\n",
    );
  });
  it("leaves content unchanged rather than orphaning a multi-line status", () => {
    const c = "---\nstatus: |\n  multi\nowner: x\n---\nb\n";
    expect(loopReplaceStatus(c, "blocked")).toBe(c);
  });
});

describe("item 2 — split patchParentSuperseded", () => {
  // Guard, not a regression test: an earlier draft of 108c57 claimed the old
  // `/^owner:/` matched `ownership:`. It never did (the colon must follow
  // `owner` directly) — this passes on main too. Kept so the new key matcher
  // can't start matching it either.
  it("does not touch an `ownership:` key", () => {
    const out = patchParentSuperseded(
      "---\nstatus: in-progress\nownership: team-a\nowner: /devx-s\n---\nb\n",
      "abc123",
    );
    expect(out).toContain("ownership: team-a");
    expect(out).toContain("owner: null");
    expect(out).toContain("status: superseded\nsuperseded_by: abc123");
  });
  it("rewrites the FIRST of a duplicated status and removes the rest", () => {
    const out = patchParentSuperseded("---\nstatus: in-progress\nstatus: ready\n---\nb\n", "abc123");
    expect(out.match(/^status:/gm)).toHaveLength(1);
    expect(out).toContain("status: superseded");
  });
});

describe("item 3 — clearSpecOwner", () => {
  it("removes every owner key, and only owner keys", () => {
    const p = tempFile("---\nstatus: ready\nowner: /devx-a\nownership: t\nowner: /devx-b\n---\nb\n");
    expect(clearSpecOwner(p)).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("---\nstatus: ready\nownership: t\n---\nb\n");
  });
  it("returns false when there is no owner key", () => {
    expect(clearSpecOwner(tempFile("---\nstatus: ready\n---\nb\n"))).toBe(false);
  });
});

describe("item 4 — validate-emit parseFrontmatterValue", () => {
  it("a bare key reads as absent, not as the next line", () => {
    const spec = "---\nowner:\nbranch: feat/x\n---\n";
    expect(parseFrontmatterValue(spec, "owner")).toBeNull();
    expect(parseFrontmatterValue(spec, "branch")).toBe("feat/x");
  });
});

describe("item 5 — splitFrontmatter fence tolerance", () => {
  it("accepts a closing fence with trailing whitespace", () => {
    expect(splitFrontmatter("---\nstatus: ready\n--- \nbody\n")?.fmText).toBe("status: ready");
  });
  it("accepts an opening fence with trailing whitespace", () => {
    expect(splitFrontmatter("---\t\nstatus: ready\n---\nbody\n")?.fmText).toBe("status: ready");
  });
  it("accepts an empty block", () => {
    expect(splitFrontmatter("---\n---\nbody\n")).toEqual({ fmText: "", delim: "\n", body: "body\n" });
  });
  it("an empty block is not extended to a horizontal rule later in the body (review round 2)", () => {
    expect(splitFrontmatter("---\n---\n# Title\n\ntext\n\n---\n\nmore\n")).toEqual({
      fmText: "",
      delim: "\n",
      body: "# Title\n\ntext\n\n---\n\nmore\n",
    });
    expect(splitFrontmatter("---\r\n---\r\nbody\r\n---\r\nz")?.fmText).toBe("");
  });
  it("writing into an empty block leaves no stray blank line", () => {
    const out = editFrontmatter("---\n---\nb\n", (l) => { upsertFrontmatterKey(l, "owner", "x"); return true; });
    expect(out).toBe("---\nowner: x\n---\nb\n");
  });
  it("stops at the first fence, so a body horizontal rule is never frontmatter", () => {
    const r = splitFrontmatter("---\na: 1\n--- \n# t\n---\nx\n");
    expect(r?.fmText).toBe("a: 1");
    expect(r?.body).toBe("# t\n---\nx\n");
  });
});

describe("item 6 — setSpecStatus reports only a real flip", () => {
  it("false when the frontmatter has no status, even if the body mentions one", () => {
    const p = tempFile("---\nowner: x\n---\n\nstatus: done in the body\n");
    expect(setSpecStatus(p, "done")).toBe(false);
  });
  it("true and written when the flip happens", () => {
    const p = tempFile("---\nstatus: ready\n---\nb\n");
    expect(setSpecStatus(p, "blocked")).toBe(true);
    expect(readFileSync(p, "utf8")).toContain("status: blocked");
  });
  it("true without a write when the status already matches", () => {
    const p = tempFile("---\nstatus: blocked\n---\nb\n");
    expect(setSpecStatus(p, "blocked")).toBe(true);
  });
});

describe("items 8-11 — the primitive", () => {
  it("keyBlockEnd covers indented children but not trailing blank lines", () => {
    expect(keyBlockEnd(["k:", "  a: 1", "", "  b: 2", "", "next: 1"], 0)).toBe(4);
    expect(keyBlockEnd(["k: v", "next: 1"], 0)).toBe(1);
  });
  it("keyBlockEnd: comment lines join a block only when continuation follows (review round 2)", () => {
    expect(keyBlockEnd(["a:", "# c", "  x: 1", "b: 1"], 0)).toBe(3); // col-0 comment inside a's value
    expect(keyBlockEnd(["status: ready", "  # note", "owner: null"], 0)).toBe(1); // not a child
    expect(keyBlockEnd(["a: 1", "# between keys", "b: 2"], 0)).toBe(1);
  });
  it("keyBlockEnd: a compact sequence at the key's indent belongs to a bare header (review round 2)", () => {
    expect(keyBlockEnd(["spawned:", "- a", "- b", "status: ready"], 0)).toBe(3);
    expect(keyBlockEnd(["title: t", "- not-a-child"], 0)).toBe(1);
    const lines = ["spawned:", "- a", "status: ready", "spawned:", "- b", "owner: x"];
    expect(() => upsertFrontmatterKey(lines, "spawned", "[]")).toThrow(/refusing/);
  });
  it("frontmatterKeyValue: one rule for every reader — first meaningful value (review round 2)", () => {
    expect(frontmatterKeyValue(["owner:", "owner: /devx-d"], "owner")).toBe(" /devx-d");
    expect(frontmatterKeyValue(["owner: ''", "owner: /devx-q"], "owner")).toBe(" /devx-q");
    expect(frontmatterKeyValue(["owner: # none", "owner: /devx-q"], "owner")).toBe(" /devx-q");
    expect(frontmatterKeyValue(["owner:"], "owner")).toBe("");
  });
  it("item 8: deleting a duplicate takes its continuation lines with it", () => {
    const lines = ["owner: a", "title: t", "owner: |", "  l1", "  l2", "next: 1"];
    upsertFrontmatterKey(lines, "owner", "X");
    expect(lines).toEqual(["owner: X", "title: t", "next: 1"]);
  });
  it("item 9: refuses to overwrite a nested mapping with a scalar", () => {
    const lines = ["gate_status:", "  prd_validated: true"];
    expect(() => upsertFrontmatterKey(lines, "gate_status", "X")).toThrow(/refusing/);
    expect(lines).toEqual(["gate_status:", "  prd_validated: true"]);
  });
  it("item 10: afterKey inserts after the anchor's whole block", () => {
    const lines = ["status:", "  a: 1", "title: t"];
    upsertFrontmatterKey(lines, "owner", "X", { afterKey: "status" });
    expect(lines).toEqual(["status:", "  a: 1", "owner: X", "title: t"]);
  });
  it("item 11: quoted and space-before-colon spellings are the same key", () => {
    for (const spelling of ['"owner": old', "'owner': old", "owner : old"]) {
      const lines = [spelling, "status: ready"];
      expect(upsertFrontmatterKey(lines, "owner", "new").action).toBe("replaced");
      expect(lines).toEqual(["owner: new", "status: ready"]);
    }
    expect(duplicateFrontmatterKeys(['"owner": a', "owner: b"])).toEqual(["owner"]);
    expect(duplicateFrontmatterKeys(["my key: 1", "my key : 2"])).toEqual(["my key"]);
    expect(frontmatterKeyValue(['"owner": /devx-q'], "owner")).toBe(" /devx-q");
  });
  it("still refuses keys that merely share a prefix", () => {
    expect(findFrontmatterKeys(["ownership: x", "owner:x"], "owner")).toEqual([]);
  });
  it("frontmatterKeyValues returns every declaration in order", () => {
    expect(frontmatterKeyValues(["owner:", "owner: /devx-a"], "owner")).toEqual(["", " /devx-a"]);
  });
  it("editFrontmatter keeps CRLF and abandons cleanly", () => {
    const c = "---\r\na: 1\r\n---\r\nb\r\n";
    expect(editFrontmatter(c, (l) => { l.push("c: 2"); return true; })).toBe(
      "---\r\na: 1\r\nc: 2\r\n---\r\nb\r\n",
    );
    expect(editFrontmatter(c, () => false)).toBeNull();
    expect(editFrontmatter("no frontmatter\n", () => true)).toBeNull();
  });
});

describe("items 14-15 — the frontmatter rule set and its reach", () => {
  it("flags duplicates and a bare owner/branch, and nothing else", () => {
    expect(specFrontmatterIssues(["owner: a", "owner: b"])).toEqual([
      { kind: "duplicate", keys: ["owner"] },
    ]);
    expect(specFrontmatterIssues(["owner:", "branch:"])).toEqual([
      { kind: "bare", keys: ["owner", "branch"] },
    ]);
    // A comment-only value is bare too — YAML reads it as null.
    expect(specFrontmatterIssues(["owner: # none"])).toEqual([{ kind: "bare", keys: ["owner"] }]);
    // Bare keys that head nested mappings are normal — the corpus depends on them.
    expect(specFrontmatterIssues(["gate_status:", "  a: true", "outcome:", "  s: x", "spawned:"])).toEqual([]);
    // Non-token owners are legitimate (measured: 23 of 223 real values) — not flagged.
    expect(specFrontmatterIssues(["owner: interactive-session-2026-07-24"])).toEqual([]);
  });

  it("doctor finds them across every spec directory, debug/ included", () => {
    const root = mkdtempSync(join(tmpdir(), "devx-108c57-repo-"));
    tmp.push(root);
    mkdirSync(join(root, "debug"));
    mkdirSync(join(root, "dev"));
    writeFileSync(join(root, "debug", "debug-aaa111-x.md"), "---\nstatus: ready\nowner:\n---\nb\n");
    writeFileSync(join(root, "dev", "dev-bbb222-x.md"), "---\nstatus: ready\nstatus: done\n---\nb\n");
    writeFileSync(join(root, "dev", "dev-ccc333-x.md"), "---\nstatus: ready\nowner: null\n---\nb\n");
    const found = detectMalformedFrontmatter({ repoRoot: root } as never);
    expect(found.map((f) => [f.class, f.target, f.fixable])).toEqual([
      ["malformed-frontmatter", "dev/dev-bbb222-x.md", false],
      ["malformed-frontmatter", "debug/debug-aaa111-x.md", false],
    ]);
    // doctor's human output prints only `class: detail`, so the detail must
    // name the file (review round 2).
    expect(found[0].detail).toMatch(/^dev\/dev-bbb222-x\.md /);
    expect(found[1].detail).toMatch(/^debug\/debug-aaa111-x\.md /);
  });
});

describe("doctor status replace never throws (review round 2)", () => {
  it("returns a multi-line status unchanged instead of throwing mid-repair", () => {
    const c = "---\nstatus: |\n  multi\n---\nb\n";
    expect(doctorReplaceStatus(c, "ready")).toBe(c);
  });
});

describe("item 16 — the doctor bare-status fix", () => {
  it("doctor's status replace rewrites a bare `status:`", () => {
    expect(doctorReplaceStatus("---\nstatus:\nowner: x\n---\nb\n", "ready")).toContain("status: ready\nowner: x");
  });
});
