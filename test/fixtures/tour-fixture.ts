// Canonical valid tour fixture (v2t101) — shared by the schema, render, and
// pr-body tour tests. Kept in fixtures/ (not a .test.ts) so importing it
// doesn't re-register another file's suites.

import type { Tour } from "../../src/lib/tour/schema.js";

export function validTour(): Tour {
  return {
    meta: {
      title: "V2.3 — static HTML review tour",
      hash: "v2t101",
      base: "main",
      branch: "feat/dev-v2t101",
      sha: "0123456789abcdef0123456789abcdef01234567",
      files: 2,
      additions: 10,
      deletions: 2,
      commits: 1,
    },
    fullDiff:
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n line\n+added\n",
    orientation: {
      summary: "Adds the tour engine.",
      ci: "green",
      standingPriorities: ["no silent product decisions"],
      readingOrder: "Stops 1–2, Blast Radius",
      timeBoxed: "~10 min: Stop 1",
      flagIndex: "1 ⚠ · 0 🔍 · 0 💬 · 0 🕳",
    },
    changeMap: [
      {
        file: "src/a.ts",
        area: "tour",
        weight: "core",
        what: "the engine",
        stops: [1],
      },
    ],
    decisions: [
      {
        id: 1,
        decision: "hand-rolled validator",
        where: "src/a.ts:1",
        implies: "no ajv at runtime",
        alternative: "ajv",
      },
    ],
    stops: [
      {
        id: 1,
        priority: "must",
        title: "The engine",
        flags: ["decision"],
        files: ["src/a.ts:1"],
        narration: "Everything starts at src/a.ts:1.",
        connects: { next: "→ Stop 2 because tests" },
        diff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1,2 @@\n line\n+added\n",
      },
      {
        id: 2,
        priority: "skim",
        title: "Tests",
        flags: [],
        files: ["test/a.test.ts"],
        narration: "Tests for stop 1.",
        diff: "",
      },
    ],
    trails: [
      {
        id: "A",
        name: "build flow",
        steps: [
          { n: 1, what: "CLI calls build", where: "src/a.ts:1", status: "new" },
          {
            n: 2,
            what: "render writes html",
            where: "src/a.ts:2",
            status: "modified",
            note: "🕳 edge unverified",
          },
        ],
      },
    ],
    blastRadius: {
      sections: [{ title: "CLI surface", body: "new `devx tour` command" }],
      callersNotUpdated: "none",
    },
    coverage: {
      rows: [{ stop: 1, testedBy: "test/a.test.ts", gaps: "none" }],
      todos: "none",
    },
  };
}
