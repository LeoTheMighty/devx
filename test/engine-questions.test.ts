// questions.md health-queue parse + reconcile (B11/C11).
//
// Two halves under test, because either one missing makes the queue lie:
// a finding that gets no entry (the queue under-reports) and a fixed concern
// that stays open (the queue over-reports, and every board reads "blocked"
// on a gate that now advances).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  QuestionsError,
  blocksForGate,
  blocksForPhase,
  healthCounts,
  isBlocking,
  isOpen,
  maskComments,
  nextQuestionId,
  parseQuestions,
  reconcileGateConcerns,
} from "../src/lib/engine/questions.js";
import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

const TEMPLATE = readFileSync(
  join(REAL_REPO_ROOT, "_devx", "templates", "engine", "questions.md"),
  "utf8",
);

function entry(
  id: string,
  title: string,
  fields: Record<string, string>,
): string {
  const f = {
    Kind: "gate-concern",
    Severity: "concern",
    Blocks: "gate-design",
    Origin: "devx gate coverage",
    Recommendation: "do the thing",
    Status: "open",
    Resolution: "—",
    ...fields,
  };
  return [
    `## ${id}: ${title}`,
    "",
    ...Object.entries(f).map(([k, v]) => `- **${k}:** ${v}`),
    "",
    "---",
    "",
  ].join("\n");
}

describe("maskComments", () => {
  it("blanks comment bodies while preserving the line count", () => {
    const lines = ["a", "<!-- x", "## Q-1: hidden", "-->", "b"];
    expect(maskComments(lines)).toEqual(["a", "", "", "", "b"]);
  });

  it("keeps text either side of an inline comment", () => {
    expect(maskComments(["keep <!-- drop --> this"])).toEqual(["keep  this"]);
  });

  it("masks the tail of a line that opens a comment", () => {
    expect(maskComments(["live <!-- dead", "still dead"])).toEqual([
      "live ",
      "",
    ]);
  });
});

describe("parseQuestions", () => {
  it("reads a fresh template as an EMPTY queue (its example lives in a comment)", () => {
    const doc = parseQuestions(TEMPLATE);
    expect(doc.entries).toEqual([]);
    expect(doc.headingDrift).toEqual([]);
  });

  it("pulls every field off a canonical entry", () => {
    const doc = parseQuestions(
      entry("Q-1", "FR-3 not covered", {
        Severity: "blocking",
        Blocks: "gate-plan",
        Origin: "devx gate coverage · plan/agent.md",
        Recommendation: "add a phase covering FR-3",
        Resolution: "—",
      }),
    );
    expect(doc.entries).toHaveLength(1);
    const q = doc.entries[0];
    expect(q).toMatchObject({
      id: "Q-1",
      title: "FR-3 not covered",
      kind: "gate-concern",
      severity: "blocking",
      blocks: "gate-plan",
      origin: "devx gate coverage · plan/agent.md",
      recommendation: "add a phase covering FR-3",
      status: "open",
      // Em-dash placeholders read as empty, not as the literal dash.
      resolution: "",
    });
    expect(isOpen(q)).toBe(true);
    expect(isBlocking(q)).toBe(true);
  });

  it("THROWS on a missing Severity rather than defaulting to a note", () => {
    const text = [
      "## Q-1: something",
      "",
      "- **Kind:** gate-concern",
      "- **Status:** open",
      "",
    ].join("\n");
    expect(() => parseQuestions(text)).toThrow(QuestionsError);
    expect(() => parseQuestions(text)).toThrow(/missing Severity/);
  });

  it("THROWS on a fumbled Severity", () => {
    expect(() =>
      parseQuestions(entry("Q-1", "x", { Severity: "blocker" })),
    ).toThrow(/unrecognized Severity 'blocker'/);
  });

  it("defaults an unreadable Status to open — never to resolved", () => {
    const q = parseQuestions(entry("Q-1", "x", { Status: "closed-ish" }))
      .entries[0];
    expect(q.status).toBe("open");
    expect(isOpen(q)).toBe(true);
  });

  it("takes the FIRST spelling of a duplicated field (a stray later bullet can't downgrade)", () => {
    const text = [
      "## Q-1: x",
      "",
      "- **Kind:** gate-concern",
      "- **Severity:** blocking",
      "- **Severity:** concern",
      "- **Status:** open",
      "",
    ].join("\n");
    expect(parseQuestions(text).entries[0].severity).toBe("blocking");
  });

  it("reads an unrecognized Kind as null without failing", () => {
    expect(parseQuestions(entry("Q-1", "x", { Kind: "vibes" })).entries[0].kind)
      .toBeNull();
  });

  it("reports a drifted `## Q…` heading by line instead of swallowing it", () => {
    const text = `${entry("Q-1", "first", {})}## Q2 malformed\n\n- **Severity:** blocking\n`;
    const doc = parseQuestions(text);
    expect(doc.entries.map((q) => q.id)).toEqual(["Q-1"]);
    expect(doc.headingDrift).toHaveLength(1);
  });

  it("treats asked/answered as still open", () => {
    for (const status of ["asked", "answered"]) {
      expect(
        isOpen(parseQuestions(entry("Q-1", "x", { Status: status })).entries[0]),
      ).toBe(true);
    }
    expect(
      isOpen(parseQuestions(entry("Q-1", "x", { Status: "resolved" })).entries[0]),
    ).toBe(false);
  });
});

describe("healthCounts", () => {
  it("counts open blocking and open concern, ignoring resolved", () => {
    const doc = parseQuestions(
      [
        entry("Q-1", "a", { Severity: "blocking" }),
        entry("Q-2", "b", { Severity: "concern" }),
        entry("Q-3", "c", { Severity: "concern" }),
        entry("Q-4", "d", { Severity: "blocking", Status: "resolved" }),
      ].join(""),
    );
    expect(healthCounts(doc.entries)).toEqual({ blocking: 1, concern: 2 });
  });
});

describe("nextQuestionId", () => {
  it("is max+1 over EVERY entry, resolved included — ids are never reused", () => {
    const doc = parseQuestions(
      [
        entry("Q-1", "a", {}),
        entry("Q-7", "b", { Status: "resolved" }),
        entry("Q-3", "c", {}),
      ].join(""),
    );
    expect(nextQuestionId(doc.entries)).toBe("Q-8");
  });

  it("starts at Q-1 on an empty queue", () => {
    expect(nextQuestionId([])).toBe("Q-1");
  });
});

describe("reconcileGateConcerns — each current finding gets an entry", () => {
  const input = {
    blocks: "gate-design",
    origin: "devx gate coverage · design/agent.md",
    resolution: "_devx/workstreams/x/decisions/2026-11-20-design-verify.md",
  };

  it("appends a fresh entry carrying all five required fields", () => {
    const r = reconcileGateConcerns(TEMPLATE, {
      ...input,
      findings: [
        { title: "FR-3 missing", severity: "blocking", recommendation: "cover FR-3" },
      ],
    });
    expect(r.added).toEqual(["Q-1"]);
    const q = parseQuestions(r.content).entries[0];
    expect(q).toMatchObject({
      id: "Q-1",
      title: "FR-3 missing",
      kind: "gate-concern",
      severity: "blocking",
      blocks: "gate-design",
      recommendation: "cover FR-3",
      status: "open",
    });
  });

  it("allocates distinct ids for several findings in one run", () => {
    const r = reconcileGateConcerns(TEMPLATE, {
      ...input,
      findings: [
        { title: "a", severity: "concern", recommendation: "ra" },
        { title: "b", severity: "concern", recommendation: "rb" },
        { title: "c", severity: "blocking", recommendation: "rc" },
      ],
    });
    expect(r.added).toEqual(["Q-1", "Q-2", "Q-3"]);
    expect(parseQuestions(r.content).entries.map((q) => q.id)).toEqual([
      "Q-1",
      "Q-2",
      "Q-3",
    ]);
  });

  it("UPDATES a matching open entry in place rather than duplicating it", () => {
    const before = entry("Q-1", "FR-3 missing", {
      Severity: "blocking",
      Recommendation: "old advice",
    });
    const r = reconcileGateConcerns(before, {
      ...input,
      findings: [
        { title: "FR-3 missing", severity: "concern", recommendation: "new advice" },
      ],
    });
    expect(r.updated).toEqual(["Q-1"]);
    expect(r.added).toEqual([]);
    const entries = parseQuestions(r.content).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "Q-1",
      severity: "concern",
      recommendation: "new advice",
      origin: input.origin,
      status: "open",
    });
  });

  it("matches on a normalized title (case, whitespace, trailing punctuation)", () => {
    const before = entry("Q-1", "FR-3  is   missing.", {});
    const r = reconcileGateConcerns(before, {
      ...input,
      findings: [
        { title: "fr-3 is missing", severity: "blocking", recommendation: "x" },
      ],
    });
    expect(r.updated).toEqual(["Q-1"]);
    expect(parseQuestions(r.content).entries).toHaveLength(1);
  });

  it("keeps an `asked` entry's status when it updates (the human was already pinged)", () => {
    const before = entry("Q-1", "FR-3 missing", { Status: "asked" });
    const r = reconcileGateConcerns(before, {
      ...input,
      findings: [
        { title: "FR-3 missing", severity: "blocking", recommendation: "x" },
      ],
    });
    expect(parseQuestions(r.content).entries[0].status).toBe("asked");
  });

  it("INSERTS a field the existing entry lacks instead of dropping it", () => {
    const before = [
      "## Q-1: FR-3 missing",
      "",
      "- **Kind:** gate-concern",
      "- **Severity:** concern",
      "- **Blocks:** gate-design",
      "- **Status:** open",
      "",
    ].join("\n");
    const r = reconcileGateConcerns(before, {
      ...input,
      findings: [
        { title: "FR-3 missing", severity: "blocking", recommendation: "cover it" },
      ],
    });
    const q = parseQuestions(r.content).entries[0];
    expect(q.recommendation).toBe("cover it");
    expect(q.origin).toBe(input.origin);
    expect(q.severity).toBe("blocking");
  });
});

describe("reconcileGateConcerns — each stale entry closes", () => {
  const input = {
    blocks: "gate-design",
    origin: "devx gate coverage · design/agent.md",
    resolution: "decisions/2026-11-20-design-verify.md",
  };

  it("resolves an open entry this run no longer finds, pointing at the report", () => {
    const before = entry("Q-1", "FR-3 missing", { Severity: "blocking" });
    const r = reconcileGateConcerns(before, { ...input, findings: [] });
    expect(r.resolved).toEqual(["Q-1"]);
    const q = parseQuestions(r.content).entries[0];
    expect(q.status).toBe("resolved");
    expect(q.resolution).toBe(input.resolution);
    expect(isOpen(q)).toBe(false);
    expect(healthCounts([q])).toEqual({ blocking: 0, concern: 0 });
  });

  it("a PASS re-run clears a prior FAIL's blocking entries", () => {
    const failRun = reconcileGateConcerns(TEMPLATE, {
      ...input,
      findings: [
        { title: "FR-1 missing", severity: "blocking", recommendation: "a" },
        { title: "FR-2 partial", severity: "concern", recommendation: "b" },
      ],
    });
    expect(healthCounts(parseQuestions(failRun.content).entries)).toEqual({
      blocking: 1,
      concern: 1,
    });
    const passRun = reconcileGateConcerns(failRun.content, {
      ...input,
      findings: [],
    });
    expect(passRun.resolved.sort()).toEqual(["Q-1", "Q-2"]);
    expect(healthCounts(parseQuestions(passRun.content).entries)).toEqual({
      blocking: 0,
      concern: 0,
    });
  });

  it("a CONCERNS re-run downgrades the survivor and resolves the rest", () => {
    const first = reconcileGateConcerns(TEMPLATE, {
      ...input,
      findings: [
        { title: "FR-1", severity: "blocking", recommendation: "a" },
        { title: "FR-2", severity: "blocking", recommendation: "b" },
      ],
    });
    const second = reconcileGateConcerns(first.content, {
      ...input,
      findings: [{ title: "FR-2", severity: "concern", recommendation: "b2" }],
    });
    expect(second.updated).toEqual(["Q-2"]);
    expect(second.resolved).toEqual(["Q-1"]);
    expect(healthCounts(parseQuestions(second.content).entries)).toEqual({
      blocking: 0,
      concern: 1,
    });
  });

  it("NEVER touches another gate's entries", () => {
    const before = [
      entry("Q-1", "design thing", { Blocks: "gate-design", Severity: "blocking" }),
      entry("Q-2", "evals thing", { Blocks: "gate-evals", Severity: "blocking" }),
    ].join("");
    const r = reconcileGateConcerns(before, { ...input, findings: [] });
    expect(r.resolved).toEqual(["Q-1"]);
    const evals = parseQuestions(r.content).entries.find((q) => q.id === "Q-2");
    expect(evals).toMatchObject({ status: "open", severity: "blocking" });
  });

  it("NEVER touches a non-gate-concern entry (a parked question, a discovered gap)", () => {
    const before = [
      entry("Q-1", "parked", { Kind: "open-question", Severity: "blocking" }),
      entry("Q-2", "found mid-build", { Kind: "discovered-gap", Severity: "concern" }),
    ].join("");
    const r = reconcileGateConcerns(before, { ...input, findings: [] });
    expect(r.resolved).toEqual([]);
    expect(r.content).toBe(before);
    expect(healthCounts(parseQuestions(r.content).entries)).toEqual({
      blocking: 1,
      concern: 1,
    });
  });

  it("NEVER re-opens an already-resolved entry", () => {
    const before = entry("Q-1", "FR-3 missing", { Status: "resolved" });
    const r = reconcileGateConcerns(before, { ...input, findings: [] });
    expect(r.resolved).toEqual([]);
    expect(r.content).toBe(before);
  });

  it("a finding matching a RESOLVED entry opens a new id rather than reviving it", () => {
    const before = entry("Q-1", "FR-3 missing", {
      Status: "resolved",
      Resolution: "decisions/old.md",
    });
    const r = reconcileGateConcerns(before, {
      ...input,
      findings: [
        { title: "FR-3 missing", severity: "blocking", recommendation: "again" },
      ],
    });
    expect(r.added).toEqual(["Q-2"]);
    const entries = parseQuestions(r.content).entries;
    expect(entries.map((q) => [q.id, q.status])).toEqual([
      ["Q-1", "resolved"],
      ["Q-2", "open"],
    ]);
  });
});

describe("reconcileGateConcerns — surgery, not re-render", () => {
  const input = {
    blocks: "gate-design",
    origin: "o",
    resolution: "r",
    findings: [] as const,
  };

  it("is a byte-for-byte no-op when there is nothing to do", () => {
    expect(reconcileGateConcerns(TEMPLATE, input).content).toBe(TEMPLATE);
  });

  it("preserves prose and hand-added bullets inside an updated entry", () => {
    const before = [
      "## Q-1: FR-3 missing",
      "",
      "Some hand-written context nobody should lose.",
      "",
      "- **Kind:** gate-concern",
      "- **Severity:** concern",
      "- **Blocks:** gate-design",
      "- **Origin:** old",
      "- **Recommendation:** old",
      "- **Status:** open",
      "- **Resolution:** —",
      "- **Notes:** a bullet only a human wrote",
      "",
      "---",
      "",
    ].join("\n");
    const r = reconcileGateConcerns(before, {
      ...input,
      findings: [
        { title: "FR-3 missing", severity: "blocking", recommendation: "new" },
      ],
    });
    expect(r.content).toContain("Some hand-written context nobody should lose.");
    expect(r.content).toContain("- **Notes:** a bullet only a human wrote");
    expect(r.content).toContain("- **Severity:** blocking");
    expect(r.content).not.toContain("- **Recommendation:** old");
  });

  it("keeps the template header when it appends the first entry", () => {
    const r = reconcileGateConcerns(TEMPLATE, {
      ...input,
      findings: [{ title: "t", severity: "concern", recommendation: "x" }],
    });
    expect(r.content.startsWith("<!-- questions.md")).toBe(true);
    expect(r.content).toContain("## Q-1: t");
  });

  it("collapses a multi-line value so the entry's shape survives", () => {
    // A newline in a field splits the bullet; the tail stops matching
    // FIELD_RE and the next parse reads a truncated field with orphan prose
    // beside it — half a recommendation lost, silently.
    const r = reconcileGateConcerns(TEMPLATE, {
      ...input,
      findings: [
        {
          title: "a title\nwith a break",
          severity: "blocking",
          recommendation: "line one\nline two\n  line three",
        },
      ],
    });
    const q = parseQuestions(r.content).entries[0];
    expect(q.title).toBe("a title with a break");
    expect(q.recommendation).toBe("line one line two line three");
    // Still exactly seven bullets — the shape held.
    const bullets = r.content
      .split("\n")
      .filter((l) => /^- \*\*[^*]+:\*\*/.test(l));
    expect(bullets).toHaveLength(7);
  });

  it("collapses a multi-line value on an UPDATE too", () => {
    const before = entry("Q-1", "FR-3 missing", {});
    const r = reconcileGateConcerns(before, {
      ...input,
      findings: [
        {
          title: "FR-3 missing",
          severity: "concern",
          recommendation: "first\nsecond",
        },
      ],
    });
    const q = parseQuestions(r.content).entries[0];
    expect(q.recommendation).toBe("first second");
    expect(
      r.content.split("\n").filter((l) => /^- \*\*[^*]+:\*\*/.test(l)),
    ).toHaveLength(7);
  });

  it("does not read a commented-out entry as live, in either half", () => {
    const masked = `<!--\n${entry("Q-9", "ghost", { Severity: "blocking" })}-->\n`;
    expect(parseQuestions(masked).entries).toEqual([]);
    const r = reconcileGateConcerns(masked, {
      ...input,
      findings: [{ title: "ghost", severity: "blocking", recommendation: "x" }],
    });
    // A new id, not Q-10: the commented block is not an entry, so it neither
    // matches nor reserves a number.
    expect(r.added).toEqual(["Q-1"]);
    expect(r.resolved).toEqual([]);
  });
});

describe("Blocks vocabulary", () => {
  it("derives a gate scope from the gate key", () => {
    expect(blocksForGate("prd")).toBe("gate-prd");
    expect(blocksForGate("design")).toBe("gate-design");
    expect(blocksForGate("plan")).toBe("gate-plan");
    expect(blocksForGate("evals")).toBe("gate-evals");
  });

  it("derives a phase scope from a phase number", () => {
    expect(blocksForPhase(3)).toBe("phase-3");
  });
});
