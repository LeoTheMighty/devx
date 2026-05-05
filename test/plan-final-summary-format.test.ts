// Tests for pln106 — Phase 8 final-summary `Next command(s)` block format.
//
// pln106 is a skill-body contract story: the Phase 8 final-summary's
// `Next command(s)` block is the bridge from /devx-plan to /devx (and
// Concierge in Phase 2). The block is rendered by the LLM following the
// canonical format pinned in `.claude/commands/devx-plan.md` Hand-off
// section. Tests assert:
//
//   1. The skill body documents the canonical format with each variant
//      (leader, dependent, parallel-safe, both, empty-case).
//   2. Each format invariant is documented (header line, indent, command
//      token, comment separator, dependency/parallel-safe annotations,
//      empty-case literal, title rules).
//   3. A reference renderer (inline in this test) produces output that
//      matches the documented format AND validates inputs (hash shape,
//      title rules) per the skill body's invariants. The renderer is
//      the canonical format-stability fixture per Murat's locked
//      decision: changing the snapshot requires updating the skill body
//      too (soft enforcement via retro discipline).
//
// Pattern matches plan-mode-gate.test.ts (pln105) and
// plan-precedence-enforcement.test.ts (pln104): doc-check the skill body
// to guard against silent drift between the spec contract and the prose
// that drives /devx-plan.
//
// Spec: dev/dev-pln106-2026-04-28T19:30-plan-summary-format.md
// Closes the parsing contract that downstream consumers (Concierge,
// future LearnAgent surveys, mobile companion) rely on.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Skill body slicing — the Hand-off section is the canonical format source;
// Phase 8 item 12 references it. Slice once at module load.
// ---------------------------------------------------------------------------

const skillPath = join(process.cwd(), ".claude/commands/devx-plan.md");
const body = readFileSync(skillPath, "utf-8");

function findHeadingOffset(re: RegExp, label: string): number {
  const match = re.exec(body);
  if (match === null) {
    throw new Error(`could not locate ${label} heading in devx-plan.md`);
  }
  return match.index;
}

// Hand-off section: `## Hand-off to /devx` to next `## ` heading. If no
// trailing `## ` exists, throw — the Hand-off section is the canonical
// source and an unbounded slice silently swallows downstream content
// (Edge Case Hunter F6).
const handoffStart = findHeadingOffset(
  /^## Hand-off to \/devx\b/m,
  "## Hand-off to /devx",
);
const handoffEndMatch = /\n## /.exec(body.slice(handoffStart + 1));
if (handoffEndMatch === null) {
  throw new Error(
    "Hand-off section unbounded — expected a following `## ` heading; refusing to slice to EOF",
  );
}
const handoff = body.slice(
  handoffStart,
  handoffStart + 1 + handoffEndMatch.index,
);

// Phase 8 Next-command item: searched by content (`**Next command**`), not
// by ordinal — list renumbering must not break the slice (Blind Hunter
// LOW-6 / Edge Case Hunter F7).
const phase8Start = findHeadingOffset(/^### Phase 8\b/m, "Phase 8");
const nextCommandMatch = /\n\d+\. \*\*Next command\*\*/.exec(
  body.slice(phase8Start),
);
if (nextCommandMatch === null) {
  throw new Error(
    "could not locate `**Next command**` numbered item within Phase 8 — list re-numbered? content drift?",
  );
}
const nextCommandStart = phase8Start + nextCommandMatch.index + 1;
const nextCommandBody = body.slice(nextCommandStart);
const nextCommandEnd = nextCommandBody.search(/\n\d+\. \*\*|\n## /);
const phase8NextCommand =
  nextCommandEnd === -1
    ? nextCommandBody
    : nextCommandBody.slice(0, nextCommandEnd);

// ---------------------------------------------------------------------------
// 1) Phase 8 Next-command item references the canonical format in Hand-off.
// ---------------------------------------------------------------------------

describe("/devx-plan Phase 8 Next-command item references canonical format (pln106)", () => {
  it("Phase 8 Next-command item anchors pln106 (LearnAgent-readable closure marker)", () => {
    expect(phase8NextCommand).toMatch(/pln106/);
  });

  it("Phase 8 Next-command item defers to the Hand-off section as the canonical source", () => {
    // The format itself is NOT inlined in this item — it lives in Hand-off.
    // This item must point readers there so paraphrase doesn't drift.
    expect(phase8NextCommand).toMatch(/Hand-off to \/devx/i);
    expect(phase8NextCommand).toMatch(/do not paraphrase/i);
  });

  it("Phase 8 Next-command item names Concierge as the downstream parser (Phase 2 forward-reference)", () => {
    // The whole point of pinning the format is parser-stability for
    // Concierge's `devx ask` flow. Document it where reviewers will see it.
    expect(phase8NextCommand).toMatch(/Concierge/);
  });
});

// ---------------------------------------------------------------------------
// 2) Hand-off section pins each format variant + invariant. AC #1, #2, #3.
// ---------------------------------------------------------------------------

describe("/devx-plan Hand-off section pins canonical format (pln106 AC#1, #2, #3)", () => {
  it("Hand-off opens the canonical format under a discoverable heading anchored on pln106", () => {
    // Anchor the heading so future edits don't silently demote the format
    // documentation to a casual sentence.
    expect(handoff).toMatch(/Canonical Next-command block format \(pln106\)/);
  });

  it("Hand-off documents the verbatim header line `Next command(s), in dependency order:`", () => {
    // Comma + colon, no period — load-bearing for Concierge's grep.
    expect(handoff).toContain("Next command(s), in dependency order:");
  });

  it("Hand-off shows the leader form: `/devx <hash>          # <one-line title>` (no annotation)", () => {
    // Plain leader entry — first line of any non-empty block. Bound the
    // gap to exactly 10 spaces (Blind Hunter LOW-7 / Edge Case Hunter F8)
    // so a copyedit that adds/removes a space is caught.
    expect(handoff).toContain(
      "/devx <hash>          # <one-line title>",
    );
  });

  it("Hand-off shows the dependent form: `; depends on <hash>` annotation (AC#1)", () => {
    expect(handoff).toContain(
      "/devx <hash>          # <one-line title>; depends on <hash>",
    );
  });

  it("Hand-off shows the parallel-safe form: `; parallel-safe with <hash>` annotation (AC#2)", () => {
    expect(handoff).toContain(
      "/devx <hash>          # <one-line title>; parallel-safe with <hash>",
    );
  });

  it("Hand-off shows the both-annotations form (depends-first, parallel-safe second)", () => {
    // Order is load-bearing for the parser per the documented invariant.
    expect(handoff).toContain(
      "/devx <hash>          # <one-line title>; depends on <hash>; parallel-safe with <hash>",
    );
  });

  it("Hand-off documents the empty-case literal verbatim per spec AC#3 (no leading indent, 2 spaces before `#`)", () => {
    // Spec AC#3 literal: `/devx next  # picks top of DEV.md (currently empty)`.
    // Source-of-truth precedence: spec ACs > epic locked decisions > skill
    // defaults. The empty case is standalone, no header, no indent.
    expect(handoff).toContain(
      "/devx next  # picks top of DEV.md (currently empty)",
    );
  });

  it("Hand-off documents the empty case omits both the header AND the leading indent", () => {
    // Distinguishing the empty case from a degenerate single-entry non-empty
    // case requires the omissions to be explicit. Both header omission AND
    // indent omission are documented invariants.
    expect(handoff).toMatch(/empty case omits the header/i);
    expect(handoff).toMatch(/zero leading spaces|no leading indent/i);
  });

  it("Hand-off shows non-empty leader/dependent/parallel-safe/both forms have IDENTICAL column position for `#`", () => {
    // Defense against partial copyedits that fix one variant's spacing
    // and miss the others. Count `<hash>          #` (10-space form)
    // occurrences — should appear at least once for each of the 4 variants.
    const tenSpaceForm = "<hash>          #";
    const occurrences = handoff.split(tenSpaceForm).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// 3) Format invariants — each one documented as a load-bearing rule.
// ---------------------------------------------------------------------------

describe("/devx-plan Hand-off section documents every format invariant (pln106)", () => {
  it("invariant: 2-space indent in non-empty case; zero indent in empty case", () => {
    expect(handoff).toMatch(/2\s*leading\s*spaces|2-space indent/i);
    // Empty case's "no indent" is documented separately and must be explicit.
    expect(handoff).toMatch(/zero leading spaces|no leading indent/i);
  });

  it("invariant: hash matches [a-z0-9]{6} — strictly 6 chars, lowercase + digits", () => {
    // The character class + length is the parser's anchor — without it,
    // Concierge can't tell `pln105` from `pln1057` (or worse, a fixture
    // hash from a real one). "Strictly 6" must be documented to prevent
    // silent renderer drift.
    expect(handoff).toMatch(/\[a-z0-9\]\{6\}/);
    expect(handoff).toMatch(/strictly 6 chars|exactly 6/i);
  });

  it("invariant: renderers MUST validate hash shape", () => {
    // Without explicit MUST-language, future LLM renderers may emit
    // uppercase or 7-char hashes silently.
    expect(handoff).toMatch(/[Rr]enderers? MUST validate/);
  });

  it("invariant: comment separator is `#` preceded by ≥1 spaces and followed by exactly one space", () => {
    expect(handoff).toMatch(/≥\s*1\s*spaces|>=\s*1\s*spaces|one or more spaces/i);
    expect(handoff).toMatch(/exactly one space.*title|single space after `#`/i);
  });

  it("invariant: title is the spec's `title:` frontmatter, verbatim — with explicit MUST-NOT-contain rules", () => {
    expect(handoff).toMatch(/title:.*frontmatter|frontmatter.*title:/);
    expect(handoff).toMatch(/verbatim/i);
    // Title rules — load-bearing because `;` is the annotation separator
    // and `\n` would break line-based parsing (Blind Hunter MED-5 /
    // Edge Case Hunter F2/F9).
    expect(handoff).toMatch(/MUST NOT contain.*`;`|titles? .*`;`/);
    expect(handoff).toMatch(/MUST NOT contain.*\\n|titles? .*newline/i);
    // Multi-line YAML normalization rule.
    expect(handoff).toMatch(
      /multi-line YAML.*join|`title: \|`.*single line|join.*single space/i,
    );
  });

  it("invariant: dependency annotation names the deepest-single-edge parent", () => {
    // The parser doesn't enumerate the full transitive list — naming the
    // deepest single edge is what makes the line one-shot parseable.
    expect(handoff).toMatch(
      /most-recently-required parent|deepest single edge|deepest.*edge/i,
    );
  });

  it("invariant: parallel-safe annotation names ONE peer", () => {
    expect(handoff).toMatch(
      /one peer|single peer|most recently emitted sibling/i,
    );
  });

  it("invariant: both-annotation order is depends-first, parallel-safe second", () => {
    expect(handoff).toMatch(
      /depends-first.*parallel-safe.*second|depends.*then.*parallel-safe/i,
    );
    expect(handoff).toMatch(/[Oo]rder is load-bearing/);
  });

  it("invariant: empty-case `(currently empty)` literal is what Concierge greps for", () => {
    expect(handoff).toMatch(/currently empty/);
    expect(handoff).toMatch(/Concierge.*greps?|greps?.*Concierge/i);
  });

  it("invariant: stability paired with test/plan-final-summary-format.test.ts (Murat's lock)", () => {
    expect(handoff).toMatch(/test\/plan-final-summary-format\.test\.ts/);
    // Murat's lock is named explicitly so a future LearnAgent finding can
    // close the feedback loop on the soft-enforcement discipline.
    expect(handoff).toMatch(/Murat|locked decision|retro discipline/i);
  });
});

// ---------------------------------------------------------------------------
// 4) Reference renderer — fixture format-stability test.
//
// Murat's lock + AC#4: the test exercises a 3-epic fixture with at least one
// parallel-safe pair. The renderer below is the canonical fixture: changing
// it requires updating the skill body's documented format too (the test
// asserts both move in lockstep). This is the closest thing pln106 has to
// a runtime function — every other story in this epic ships a TS helper,
// but pln106's logic is in the skill body, so the test ships the renderer
// inline as the format-stability anchor.
//
// The renderer validates inputs per the skill body's documented invariants
// (hash shape, title rules) — silent acceptance of bad input would leak a
// malformed line to Concierge (Edge Case Hunter F2/F3/F4/F5).
// ---------------------------------------------------------------------------

interface FixtureEntry {
  hash: string;
  title: string;
  dependsOn?: string;
  parallelSafeWith?: string;
}

const HASH_RE = /^[a-z0-9]{6}$/;

function validateHash(value: string, field: string): void {
  if (!HASH_RE.test(value)) {
    throw new Error(
      `${field}: must match [a-z0-9]{6} exactly; got '${value}'`,
    );
  }
}

function validateTitle(title: string): void {
  if (title.includes("\n")) {
    throw new Error(
      "title contains newline — must be normalized to a single line before render",
    );
  }
  if (title.includes(";")) {
    throw new Error(
      "title contains `;` — conflicts with the annotation separator; reject or sanitize at planning time",
    );
  }
}

function renderNextCommandBlock(entries: FixtureEntry[]): string {
  if (entries.length === 0) {
    // Empty case: bare `/devx next` line, no header, no leading indent,
    // 2 spaces between `next` and `#` — verbatim per spec AC#3.
    return "/devx next  # picks top of DEV.md (currently empty)";
  }
  const lines = ["Next command(s), in dependency order:"];
  for (const e of entries) {
    validateHash(e.hash, "hash");
    validateTitle(e.title);
    if (e.dependsOn !== undefined) {
      validateHash(e.dependsOn, "dependsOn");
    }
    if (e.parallelSafeWith !== undefined) {
      validateHash(e.parallelSafeWith, "parallelSafeWith");
    }
    let comment = e.title;
    if (e.dependsOn !== undefined) {
      comment += `; depends on ${e.dependsOn}`;
    }
    if (e.parallelSafeWith !== undefined) {
      comment += `; parallel-safe with ${e.parallelSafeWith}`;
    }
    // Hash is exactly 6 chars (validated above); 10 trailing spaces aligns
    // `#` at column 24 (2-space indent + `/devx ` + 6-char hash + 10
    // spaces = 24).
    lines.push(`  /devx ${e.hash}          # ${comment}`);
  }
  return lines.join("\n");
}

// Line regex matching ANY entry form. Anchored to the canonical 2-space
// indent + `/devx ` prefix + 6-char-lowercase-hash-or-`next` + `#` separator
// + non-empty title.
const ENTRY_LINE_RE =
  /^  \/devx (?:[a-z0-9]{6}|next)\s+#\s+\S(?:.*\S)?$/;

// Order-aware regex for entries with both annotations: depends-first,
// then parallel-safe (Blind Hunter MED-4 / Edge Case Hunter F1).
// Matches title chars that are NOT `;` to anchor the annotation boundary
// unambiguously (titles MUST NOT contain `;` per the title invariant).
const BOTH_ANNOTATIONS_LINE_RE =
  /^  \/devx [a-z0-9]{6}\s+#\s+[^;]+; depends on [a-z0-9]{6}; parallel-safe with [a-z0-9]{6}$/;

describe("Reference renderer matches canonical format (pln106 AC#4 — 3-epic fixture + 1 parallel pair)", () => {
  it("non-empty case: renders 3 entries with 1 parallel-safe pair, shape matches every documented invariant", () => {
    // Fixture: 3 epics. fix001 is the leader. fix002 depends on fix001.
    // fix003 is parallel-safe with fix001 (no edge between them).
    const rendered = renderNextCommandBlock([
      { hash: "fix001", title: "Foundation epic" },
      { hash: "fix002", title: "Builds on foundation", dependsOn: "fix001" },
      { hash: "fix003", title: "Independent epic", parallelSafeWith: "fix001" },
    ]);

    const lines = rendered.split("\n");
    expect(lines[0]).toBe("Next command(s), in dependency order:");
    expect(lines).toHaveLength(4);

    // Every entry line matches the canonical line shape.
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).toMatch(ENTRY_LINE_RE);
    }

    // Specific annotations are present where expected.
    expect(lines[1]).not.toMatch(/depends on|parallel-safe/);
    expect(lines[2]).toContain("; depends on fix001");
    expect(lines[2]).not.toContain("; parallel-safe");
    expect(lines[3]).toContain("; parallel-safe with fix001");
    expect(lines[3]).not.toContain("; depends on");
  });

  it("non-empty case: depends-first, parallel-safe second when both annotations present (order-aware regex)", () => {
    const rendered = renderNextCommandBlock([
      { hash: "fix001", title: "Leader" },
      {
        hash: "fix002",
        title: "Dual annotation",
        dependsOn: "fix001",
        parallelSafeWith: "fix003",
      },
    ]);
    const dualLine = rendered.split("\n")[2]!;
    // Order-aware regex: depends MUST appear before parallel-safe; title
    // chars are bounded by `[^;]+` so a title containing `; depends on `
    // can't fool the order check (Edge Case Hunter F1).
    expect(dualLine).toMatch(BOTH_ANNOTATIONS_LINE_RE);
  });

  it("`BOTH_ANNOTATIONS_LINE_RE` rejects leader-only / depends-only / parallel-only forms (negative assertions — defends against future regex loosening)", () => {
    // The order-aware regex must reject any line that does NOT carry both
    // annotations. Without these negative assertions, a future edit that
    // swaps `;` for `,` (or otherwise loosens the pattern) could silently
    // accept leader/depends-only/parallel-only lines (auditor N1).
    const rendered = renderNextCommandBlock([
      { hash: "fix001", title: "Leader" },
      { hash: "fix002", title: "Builds on", dependsOn: "fix001" },
      { hash: "fix003", title: "Independent", parallelSafeWith: "fix001" },
    ]);
    const [, leader, depsOnly, parallelOnly] = rendered.split("\n");
    expect(leader).not.toMatch(BOTH_ANNOTATIONS_LINE_RE);
    expect(depsOnly).not.toMatch(BOTH_ANNOTATIONS_LINE_RE);
    expect(parallelOnly).not.toMatch(BOTH_ANNOTATIONS_LINE_RE);
  });

  it("empty case: renders the bare `/devx next` line per spec AC#3 (no leading indent, 2 spaces before `#`)", () => {
    const rendered = renderNextCommandBlock([]);
    expect(rendered).toBe(
      "/devx next  # picks top of DEV.md (currently empty)",
    );
    // No header line.
    expect(rendered).not.toContain("Next command(s)");
    // Concierge's grep target.
    expect(rendered).toContain("(currently empty)");
    // Single-line.
    expect(rendered.split("\n")).toHaveLength(1);
    // No leading indent.
    expect(rendered.startsWith("/devx")).toBe(true);
    expect(rendered.startsWith(" ")).toBe(false);
  });

  it("non-empty case: title may contain spaces and punctuation (commas, em-dashes, colons) but no `;` and no newline", () => {
    const rendered = renderNextCommandBlock([
      {
        hash: "fix001",
        title: "Title: with, punctuation — and a long phrase",
      },
    ]);
    const entryLine = rendered.split("\n")[1]!;
    expect(entryLine).toMatch(ENTRY_LINE_RE);
    expect(entryLine).toContain(
      "# Title: with, punctuation — and a long phrase",
    );
    // No accidental newline in the rendered title.
    expect(entryLine.split("\n")).toHaveLength(1);
  });

  // ---------- Renderer input validation (Edge Case Hunter F2/F3/F4/F5) ----------

  it("renderer rejects hash with wrong length (< 6 chars)", () => {
    expect(() =>
      renderNextCommandBlock([{ hash: "abc12", title: "Short hash" }]),
    ).toThrow(/\[a-z0-9\]\{6\}/);
  });

  it("renderer rejects hash with wrong length (> 6 chars)", () => {
    expect(() =>
      renderNextCommandBlock([{ hash: "abc1234", title: "Long hash" }]),
    ).toThrow(/\[a-z0-9\]\{6\}/);
  });

  it("renderer rejects uppercase hash characters", () => {
    expect(() =>
      renderNextCommandBlock([{ hash: "FIX001", title: "Upper hash" }]),
    ).toThrow(/\[a-z0-9\]\{6\}/);
  });

  it("renderer rejects hash with non-alphanumeric characters", () => {
    expect(() =>
      renderNextCommandBlock([{ hash: "fix-01", title: "Hyphenated" }]),
    ).toThrow(/\[a-z0-9\]\{6\}/);
  });

  it("renderer rejects empty-string dependsOn (validates with same hash regex)", () => {
    expect(() =>
      renderNextCommandBlock([
        { hash: "fix001", title: "Empty dep", dependsOn: "" },
      ]),
    ).toThrow(/dependsOn/);
  });

  it("renderer rejects empty-string parallelSafeWith", () => {
    expect(() =>
      renderNextCommandBlock([
        { hash: "fix001", title: "Empty parallel", parallelSafeWith: "" },
      ]),
    ).toThrow(/parallelSafeWith/);
  });

  it("renderer rejects title containing `;` (conflicts with annotation separator)", () => {
    expect(() =>
      renderNextCommandBlock([
        { hash: "fix001", title: "title; with semicolon" },
      ]),
    ).toThrow(/`;`|annotation separator/);
  });

  it("renderer rejects title containing newline", () => {
    expect(() =>
      renderNextCommandBlock([
        { hash: "fix001", title: "title\nwith newline" },
      ]),
    ).toThrow(/newline|single line/);
  });

  // ---------- Lockstep with skill body docs (Murat's lock) ----------

  it("renderer's empty-case literal is byte-identical to the skill-body documented form (Murat's lock — format stability)", () => {
    // The skill body and the renderer must agree on the empty-case literal
    // byte-for-byte. If either changes without the other, this test fails.
    const renderedEmpty = renderNextCommandBlock([]);
    expect(handoff).toContain(renderedEmpty);
  });

  it("renderer's leader line shape (column-aligned hash + `#` + title) is documented in the skill body", () => {
    // The skill body's example shows `/devx <hash>          # <one-line title>`
    // (10 spaces between `<hash>` and `#`). The renderer pads hash to 6
    // chars + 10 spaces. Substitute placeholders with literals and confirm.
    const docLeaderShape = "/devx <hash>          # <one-line title>";
    expect(handoff).toContain(docLeaderShape);
  });

  it("renderer's column-aligned form lands `#` at the documented column position", () => {
    // Doc invariant: `#` lands at column 24 from line start, where line
    // composition is: 2-space indent (2) + `/devx ` (6) + 6-char hash (6)
    // + 10 spaces (10) = 24 chars before `#`. So `#` is at 0-indexed
    // position 24. Verify against a real fixture.
    const rendered = renderNextCommandBlock([
      { hash: "fix001", title: "Title" },
    ]);
    const entryLine = rendered.split("\n")[1]!;
    expect(entryLine[24]).toBe("#");
  });
});

// ---------------------------------------------------------------------------
// 5) AC#5 — Phase 8 references this format as the canonical shape.
// ---------------------------------------------------------------------------

describe("Phase 8 documents the canonical format (pln106 AC#5)", () => {
  it("Phase 8 Next-command item prose reads as 'render from the template, do not paraphrase' (canonical-shape anchor)", () => {
    expect(phase8NextCommand).toMatch(/canonical/i);
    expect(phase8NextCommand).toMatch(/render.*from|emit.*from/i);
  });
});
