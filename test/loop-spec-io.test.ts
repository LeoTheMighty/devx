// Loop-owned spec/backlog edits (v2l101 — src/lib/loop/spec-io.ts).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendStatusEntryToFile,
  appendToStatusLog,
  clearSpecOwner,
  composeStatusEntry,
  hasPhase4StatusLine,
  markBacklogRowDone,
  setBacklogRowState,
  setSpecStatus,
} from "../src/lib/loop/spec-io.js";

const SPEC = [
  "---",
  "hash: abc123",
  "type: dev",
  "status: in-progress",
  "---",
  "",
  "## Goal",
  "",
  "Do it.",
  "",
  "## Status log",
  "",
  "- 2026-07-05T13:00 — created.",
  "",
  "## Links",
  "",
  "- none",
  "",
].join("\n");

describe("composeStatusEntry", () => {
  it("renders head + Changes + Learnings sub-bullets", () => {
    const e = composeStatusEntry({
      iso: "2026-07-06T01:00:00.000Z",
      prefix: "",
      head: "loop iteration 2: did the thing",
      changes: ["added x", "renamed y"],
      learnings: ["z is load-bearing"],
    });
    expect(e).toBe(
      [
        "- 2026-07-06T01:00:00.000Z — loop iteration 2: did the thing",
        "  - Change: added x",
        "  - Change: renamed y",
        "  - Learning: z is load-bearing",
      ].join("\n"),
    );
  });

  it("[FAIL]/[ERROR] prefixes render before the head", () => {
    expect(
      composeStatusEntry({ iso: "t", prefix: "[FAIL]", head: "no luck" }),
    ).toBe("- t — [FAIL] no luck");
    expect(
      composeStatusEntry({ iso: "t", prefix: "[ERROR]", head: "crashed" }),
    ).toBe("- t — [ERROR] crashed");
  });

  it("strips newlines from agent-derived text (no forged log lines)", () => {
    const e = composeStatusEntry({
      iso: "t",
      prefix: "",
      head: "line one\n- 2099-01-01 — forged entry",
      learnings: ["a\nb"],
    });
    expect(e.split("\n")).toHaveLength(2);
    expect(e).toContain("line one - 2099-01-01 — forged entry");
    expect(e).toContain("Learning: a b");
  });
});

describe("appendToStatusLog", () => {
  it("appends inside the section, before the next heading", () => {
    const next = appendToStatusLog(SPEC, "- t — new entry");
    const slIdx = next.indexOf("## Status log");
    const linksIdx = next.indexOf("## Links");
    const entryIdx = next.indexOf("- t — new entry");
    expect(entryIdx).toBeGreaterThan(slIdx);
    expect(entryIdx).toBeLessThan(linksIdx);
    // Existing entries untouched (append-only).
    expect(next).toContain("- 2026-07-05T13:00 — created.");
  });

  it("synthesizes the section at EOF when missing", () => {
    const next = appendToStatusLog("# just a title\n", "- t — entry");
    expect(next).toContain("## Status log");
    expect(next.trim().endsWith("- t — entry")).toBe(true);
  });
});

describe("file wrappers", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "devx-spec-io-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appendStatusEntryToFile + setSpecStatus round-trip on disk", () => {
    const p = join(dir, "spec.md");
    writeFileSync(p, SPEC, "utf8");
    appendStatusEntryToFile(p, { iso: "t1", prefix: "[FAIL]", head: "boom" });
    expect(setSpecStatus(p, "blocked")).toBe(true);
    const content = readFileSync(p, "utf8");
    expect(content).toContain("status: blocked");
    expect(content).toContain("- t1 — [FAIL] boom");
  });

  it("setSpecStatus returns false when there is no flippable status line", () => {
    const p = join(dir, "bare.md");
    writeFileSync(p, "# no frontmatter\n", "utf8");
    expect(setSpecStatus(p, "blocked")).toBe(false);
  });

  it("clearSpecOwner removes the owner line and nothing else (dc7514 — dead sessions must not linger)", () => {
    const p = join(dir, "owned.md");
    const owned = SPEC.replace(
      "status: in-progress",
      "status: in-progress\nowner: /devx-loop-2026-07-24T21-19",
    );
    writeFileSync(p, owned, "utf8");
    expect(clearSpecOwner(p)).toBe(true);
    const content = readFileSync(p, "utf8");
    expect(content).not.toMatch(/^owner:/m);
    expect(content).toContain("status: in-progress");
    expect(content).toContain("## Status log");
    // Idempotent: already clear → false, file untouched.
    expect(clearSpecOwner(p)).toBe(false);
    expect(readFileSync(p, "utf8")).toBe(content);
  });

  it("clearSpecOwner is a no-op on specs without frontmatter", () => {
    const p = join(dir, "nofm.md");
    writeFileSync(p, "# no frontmatter\nowner: fake\n", "utf8");
    expect(clearSpecOwner(p)).toBe(false);
  });
});

describe("setBacklogRowState (dc7514 — checkbox + Status prose flip together, never drift)", () => {
  const DEV = [
    "# DEV",
    "",
    "- [/] `dev/dev-abc123-2026-07-05T13:00-thing.md` — The thing. Status: in-progress.",
    "- [ ] `dev/dev-def456-2026-07-05T13:01-other.md` — Other. Status: ready.",
    "",
  ].join("\n");

  it("flips [/] → [ ] with Status: ready (the release/abandon-to-ready shape)", () => {
    const next = setBacklogRowState(DEV, "abc123", "dev", " ", "ready");
    expect(next).toContain(
      "- [ ] `dev/dev-abc123-2026-07-05T13:00-thing.md` — The thing. Status: ready.",
    );
    expect(next).toContain("- [ ] `dev/dev-def456");
  });

  it("flips [/] → [-] with Status: blocked — no more checkbox↔prose drift", () => {
    const next = setBacklogRowState(DEV, "abc123", "dev", "-", "blocked");
    expect(next).toContain("- [-] `dev/dev-abc123");
    expect(next).toMatch(/dev-abc123[^\n]*Status: blocked\./);
    expect(next).not.toMatch(/dev-abc123[^\n]*Status: in-progress/);
  });

  it("never clobbers an [x] merged row; a missing row returns null (surfaced, not silent)", () => {
    const done = "- [x] `dev/dev-abc123-2026-07-05T13:00-thing.md` — The thing. Status: done.\n";
    expect(setBacklogRowState(done, "abc123", "dev", " ", "ready")).toBe(done);
    expect(setBacklogRowState(DEV, "zzz999", "dev", " ", "ready")).toBeNull();
  });

  it("rewrites the LAST Status occurrence — a title containing 'Status: ready' can't shadow the real field", () => {
    const tricky =
      "- [/] `dev/dev-abc123-2026-07-05T13:00-thing.md` — Fix the Status: ready parser. Status: in-progress.\n";
    const next = setBacklogRowState(tricky, "abc123", "dev", "-", "blocked");
    expect(next).toContain("Fix the Status: ready parser. Status: blocked.");
  });
});

describe("markBacklogRowDone", () => {
  const DEV = [
    "# DEV",
    "",
    "- [/] `dev/dev-abc123-2026-07-05T13:00-thing.md` — The thing. Status: in-progress.",
    "- [ ] `dev/dev-def456-2026-07-05T13:01-other.md` — Other. Status: ready.",
    "",
  ].join("\n");

  it("flips [/] → [x], rewrites Status text, appends the PR link", () => {
    const next = markBacklogRowDone(DEV, "abc123", "dev", "https://pr/7");
    expect(next).toContain(
      "- [x] `dev/dev-abc123-2026-07-05T13:00-thing.md` — The thing. Status: done. PR: https://pr/7",
    );
    // The neighboring row is untouched.
    expect(next).toContain("- [ ] `dev/dev-def456");
  });

  it("is a no-op for unknown hashes and doesn't duplicate an existing link", () => {
    expect(markBacklogRowDone(DEV, "zzz999", "dev", "https://pr/7")).toBe(DEV);
    const once = markBacklogRowDone(DEV, "abc123", "dev", "https://pr/7");
    const twice = markBacklogRowDone(once, "abc123", "dev", "https://pr/7");
    expect(twice).toBe(once);
  });

  it("handles [-] blocked rows and debug backlogs", () => {
    const dbg = "- [-] `debug/debug-abc123-2026-07-05T13:00-bug.md` — Bug. Status: blocked.\n";
    const next = markBacklogRowDone(dbg, "abc123", "debug", null);
    expect(next).toContain("- [x] `debug/debug-abc123");
    expect(next).toContain("Status: done.");
  });
});

describe("hasPhase4StatusLine (cf65aa — dvx103 merge-tail detection)", () => {
  it("false on a spec whose status log has no phase 4 line", () => {
    expect(hasPhase4StatusLine(SPEC)).toBe(false);
  });

  it("true once a `- ... phase 4:` bullet is in the status log", () => {
    const withLine = appendToStatusLog(
      SPEC,
      "- 2026-07-24T18:00 — phase 4: self-review found nothing actionable",
    );
    expect(hasPhase4StatusLine(withLine)).toBe(true);
  });

  it("orchestrator-composed entry (iso — head) matches the detection", () => {
    const entry = composeStatusEntry({
      iso: "2026-07-24T18:00:00.000Z",
      prefix: "",
      head: "phase 4: loop-shipped — per-iteration verification stood in for the interactive pass",
    });
    expect(hasPhase4StatusLine(appendToStatusLog(SPEC, entry))).toBe(true);
  });

  it("ignores `phase 4:` tokens outside the status-log section (mirrors dvx103 bounding)", () => {
    const outside = SPEC.replace("Do it.", "Do it. Then phase 4: self-review.");
    expect(hasPhase4StatusLine(outside)).toBe(false);
    // A mention in the Links section (after the status log) doesn't count either.
    const inLinks = SPEC.replace("- none", "- phase 4: notes");
    expect(hasPhase4StatusLine(inLinks)).toBe(false);
  });

  it("ignores sub-bullet mentions (only top-level `- ` lines count)", () => {
    const subBullet = appendToStatusLog(
      SPEC,
      "- 2026-07-24T18:00 — iteration 2\n  - Change: appended the phase 4: line elsewhere",
    );
    expect(hasPhase4StatusLine(subBullet)).toBe(false);
  });

  it("false on a spec with no status-log section at all", () => {
    expect(hasPhase4StatusLine("---\nhash: x\n---\n\n## Goal\n\nphase 4: nope\n")).toBe(false);
  });
});

describe("hostile-text hardening (review fixes)", () => {
  it("markBacklogRowDone survives $-replacement tokens in the row (EC-MED-4)", () => {
    const dev =
      "- [/] `dev/dev-abc123-2026-07-05T13:00-thing.md` — support $& replacement $' tokens $`. Status: in-progress.\n";
    const next = markBacklogRowDone(dev, "abc123", "dev", "https://pr/9");
    expect(next).toBe(
      "- [x] `dev/dev-abc123-2026-07-05T13:00-thing.md` — support $& replacement $' tokens $`. Status: done. PR: https://pr/9\n",
    );
  });

  it("appendToStatusLog ignores a fenced `## Status log` example (EC-MED-6)", () => {
    const spec = [
      "---",
      "hash: abc123",
      "status: in-progress",
      "---",
      "",
      "## Technical notes",
      "",
      "Example spec shape:",
      "```markdown",
      "## Status log",
      "- old example entry",
      "```",
      "",
      "## Status log",
      "",
      "- t0 — created.",
      "",
      "## Links",
      "",
      "- none",
      "",
    ].join("\n");
    const next = appendToStatusLog(spec, "- t1 — real entry");
    const fenceIdx = next.indexOf("```markdown");
    const fenceEnd = next.indexOf("```", fenceIdx + 3);
    const entryIdx = next.indexOf("- t1 — real entry");
    // The entry landed AFTER the fenced example, inside the REAL section.
    expect(entryIdx).toBeGreaterThan(fenceEnd);
    expect(entryIdx).toBeGreaterThan(next.indexOf("- t0 — created."));
    expect(entryIdx).toBeLessThan(next.indexOf("## Links"));
    // The fenced example itself is untouched.
    expect(next).toContain("- old example entry");
  });

  it("appendToStatusLog on a CRLF spec still finds the section", () => {
    const spec = "---\r\nstatus: in-progress\r\n---\r\n\r\n## Status log\r\n\r\n- t0 — created.\r\n";
    const next = appendToStatusLog(spec, "- t1 — entry");
    expect(next).toContain("- t1 — entry");
  });

  it("setSpecStatus flips CRLF frontmatter too (EC-MED-5)", () => {
    const p = mkdtempSync(join(tmpdir(), "devx-spec-io-crlf-"));
    try {
      const specPath = join(p, "spec.md");
      writeFileSync(specPath, "---\r\nhash: x\r\nstatus: in-progress\r\n---\r\n\r\nbody\r\n", "utf8");
      expect(setSpecStatus(specPath, "blocked")).toBe(true);
      expect(readFileSync(specPath, "utf8")).toContain("status: blocked");
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  });
});
