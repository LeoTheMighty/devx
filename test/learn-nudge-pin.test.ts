// rtl101 — E-6 permanent suite: the wire-protocol pin.
//
// The nudge has two independent sides: skill prose prints it (the
// `<!-- nudge-canonical -->` marker in `.claude/commands/devx-learn.md`) and
// the Stop hook detects it (`NUDGE_PATTERN` in `src/lib/learn/nudge.ts`).
// Nothing at runtime notices when they drift — the wrap-up keeps printing, the
// queue silently stays empty. This suite is the only thing that notices, so it
// asserts the coupling *and* asserts that the assertion has teeth:
//
//   1. Containment — the real exported `NUDGE_PATTERN` is a
//      whitespace-collapsed substring of the live marker prose (read from disk,
//      never re-declared here: a copy in the test would agree with itself while
//      the shipped marker drifted).
//   2. Mutation negatives — reworded verb, renamed noun, deleted clause, and a
//      restyled command reference each break containment. A pattern generic
//      enough to survive them (say, "run") would pass (1) and pin nothing.
//   3. Matcher semantics — wording equality, not byte equality: hard-wrapped
//      and re-indented copies detect; a reworded one does not.
//
// Acceptance: _devx/workstreams/retro-listener/evals/E-6_nudge-pin.ts
// Spec: dev/dev-rtl101-2026-07-30T09:31-listener-nudge-pin.md (T1.6)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { NUDGE_PATTERN, collapseWhitespace, containsNudge } from "../src/lib/learn/nudge.js";

const REPO_ROOT = resolve(__dirname, "..");
const SKILL_PATH = resolve(REPO_ROOT, ".claude/commands/devx-learn.md");
const MIRROR_PATH = resolve(REPO_ROOT, "skills/devx-learn.md");
const MARKER = "<!-- nudge-canonical -->";

/**
 * The canonical sentence as shipped: the first paragraph after the marker,
 * whitespace-collapsed. Same extraction the eval uses, and deliberately the
 * same extraction the *emit* side documents — if the marker paragraph shape
 * changes, this returns something different and the containment test fails
 * loudly rather than the listener failing silently.
 */
function markerProse(path: string): string {
  const body = readFileSync(path, "utf8");
  const after = body.split(MARKER)[1] ?? "";
  return collapseWhitespace(after.trim().split(/\n\n/)[0] ?? "");
}

describe("rtl101 E-6 — NUDGE_PATTERN is pinned to the nudge-canonical marker", () => {
  const prose = markerProse(SKILL_PATH);
  const pattern = collapseWhitespace(NUDGE_PATTERN);

  it("finds non-empty marker prose in .claude/commands/devx-learn.md", () => {
    expect(prose).not.toBe("");
  });

  it("pins a substantive slice, not a generic fragment", () => {
    // The eval's floor. A short pattern would satisfy containment while
    // matching half the corpus; 20 chars is the smallest slice that can't.
    expect(pattern.length).toBeGreaterThanOrEqual(20);
  });

  it("is a whitespace-collapsed substring of the marker prose", () => {
    expect(prose).toContain(pattern);
  });

  it("is also a substring of the skills/ mirror's marker prose", () => {
    // The mirror is what ships in the npm package; a desynced mirror would
    // make consumer repos print a sentence this pattern can't detect.
    expect(markerProse(MIRROR_PATH)).toContain(pattern);
  });

  it("skips the sentence lead-in (survives a bolded or restyled opener)", () => {
    expect(prose.startsWith(pattern)).toBe(false);
    expect(prose.endsWith(pattern)).toBe(false);
  });
});

describe("rtl101 E-6 — the pin has teeth (marker mutations break containment)", () => {
  const prose = markerProse(SKILL_PATH);
  const pattern = collapseWhitespace(NUDGE_PATTERN);

  // Every case mutates the prose *in memory* — the shipped marker is never
  // touched. Each is a rewording a well-meaning editor could plausibly make.
  const MUTATIONS: Array<{ note: string; mutate: (s: string) => string }> = [
    {
      note: "reworded verb (run → execute)",
      mutate: (s) => s.replace("run", "execute"),
    },
    {
      note: "renamed noun (friction → difficulty)",
      mutate: (s) => s.replace("friction", "difficulty"),
    },
    {
      note: "deleted mid-sentence clause",
      mutate: (s) => {
        const mid = Math.floor(s.length / 2);
        return s.slice(0, mid - 20) + s.slice(mid + 20);
      },
    },
    {
      note: "restyled command reference (backticks dropped)",
      mutate: (s) => s.replace(/`/g, ""),
    },
  ];

  it.each(MUTATIONS)("$note breaks containment", ({ mutate }) => {
    const mutated = mutate(prose);
    // Guard the guard: a mutation that changed nothing would pass vacuously.
    expect(mutated).not.toBe(prose);
    expect(mutated).not.toContain(pattern);
  });
});

describe("rtl101 E-6 — containsNudge matches wording, not bytes", () => {
  const prose = markerProse(SKILL_PATH);

  it("detects the sentence verbatim", () => {
    expect(containsNudge(prose)).toBe(true);
  });

  it("detects a hard-wrapped copy", () => {
    // What a terminal-wrapped assistant message looks like in the transcript.
    const hardWrapped = prose.replace(/ /g, (m, i: number) => (i % 30 === 0 ? "\n   " : m));
    expect(containsNudge(hardWrapped)).toBe(true);
  });

  it("detects a copy embedded in a longer wrap-up message", () => {
    expect(containsNudge(`Done — PR #123 merged.\n\n${prose}\n\nNext: \`devx next\`.`)).toBe(true);
  });

  it("detects a copy indented as a blockquote continuation", () => {
    expect(containsNudge(prose.split(" ").join("\t \t"))).toBe(true);
  });

  it("misses a reworded sentence", () => {
    expect(containsNudge(prose.replace("friction", "difficulty"))).toBe(false);
  });

  it("misses ordinary wrap-up prose", () => {
    expect(containsNudge("All ACs met; CI green; merged and cleaned up.")).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("is total on %s input", (_note, input) => {
    // The Stop payload's `last_assistant_message` is absent on some turns; the
    // matcher must answer "not a nudge" rather than throw inside a hook.
    expect(containsNudge(input as string | null | undefined)).toBe(false);
  });
});

describe("rtl101 E-6 — collapseWhitespace", () => {
  it.each([
    ["single spaces are preserved", "a b c", "a b c"],
    ["runs collapse to one space", "a   b\t\tc", "a b c"],
    ["newlines collapse to one space", "a\nb\r\nc", "a b c"],
    ["ends are trimmed", "  \n a b \t ", "a b"],
    ["all-whitespace collapses to empty", " \t\n ", ""],
    ["empty stays empty", "", ""],
  ])("%s", (_note, input, want) => {
    expect(collapseWhitespace(input)).toBe(want);
  });
});
