// The health queue is never a gate INPUT (B11).
//
// A static scan, deliberately narrower than the todo firewall it is modelled
// on (test/gate-todo-isolation.test.ts). Gates WRITE questions.md — that is
// the whole point of the reconcile — so "0 references" is the wrong bar. The
// bar that matters is one-directional: the three pure evaluators must be
// totally questions-free, and the CLI driver may write the queue but must
// never READ it.
//
// Why the distinction is load-bearing: a gate that read its own prior
// concerns could grade an artifact differently on a second run with identical
// inputs — a verdict that depends on its own bookkeeping is not deterministic
// (design tenet 5), and the reconcile would have quietly turned the queue
// into a cache nobody declared.
//
// The byte-identity half lives in test/gate-questions-reconcile.test.ts
// ("the gate never READS the queue"): the same inputs with and without a
// seeded queue produce an identical exit code, stdout, spec and report.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

/** The pure evaluators — the modules that compute a verdict. Nothing about
 *  the queue may appear in them at all. */
const EVALUATORS = [
  "src/lib/engine/gate-prd.ts",
  "src/lib/engine/gate-coverage.ts",
  "src/lib/engine/gate-evals.ts",
];

/** Any mention of the queue file or its modules. */
const ANY_RE =
  /questions\.md|engine\/questions(?:-io)?(?:\.js|\.ts)?|parseQuestions|reconcileGateConcerns|reconcileQuestionsOnDisk|healthCounts/;

/** A READ of the queue, as opposed to the sanctioned write path. The write
 *  goes through exactly one function (`reconcileQuestionsOnDisk`), which
 *  parses internally for its own refusal; anything else that parses or loads
 *  the queue inside gate code is a read. */
const READ_RE = /parseQuestions|questionsAbs|loadQuestions|healthCounts|isBlocking\(/;

describe("gate ↔ health-queue firewall", () => {
  for (const rel of EVALUATORS) {
    it(`${rel} has 0 references to the queue surface`, () => {
      const abs = join(REAL_REPO_ROOT, ...rel.split("/"));
      const breaches = readFileSync(abs, "utf8")
        .split("\n")
        .map((line, i) =>
          ANY_RE.test(line) ? `${rel}:${i + 1}: ${line.trim()}` : null,
        )
        .filter((b): b is string => b !== null);
      expect(
        breaches,
        "a pure evaluator must not know the health queue exists — the queue is written from its verdict, never read into it",
      ).toEqual([]);
    });
  }

  it("src/commands/gate.ts writes the queue but never reads it", () => {
    const rel = "src/commands/gate.ts";
    const lines = readFileSync(
      join(REAL_REPO_ROOT, ...rel.split("/")),
      "utf8",
    ).split("\n");
    const reads = lines
      .map((line, i) => (READ_RE.test(line) ? `${rel}:${i + 1}: ${line.trim()}` : null))
      .filter((b): b is string => b !== null);
    expect(
      reads,
      "a gate that read its own prior concerns could grade identical inputs differently on a re-run",
    ).toEqual([]);
    // Negative control: the scan is looking at a file that really does carry
    // the write path, so an empty `reads` means "no reads", not "wrong file".
    expect(lines.some((l) => l.includes("reconcileQuestionsOnDisk"))).toBe(true);
  });

  it("the queue module imports no gate module — the dependency runs one way", () => {
    for (const rel of [
      "src/lib/engine/questions.ts",
      "src/lib/engine/questions-io.ts",
    ]) {
      const src = readFileSync(join(REAL_REPO_ROOT, ...rel.split("/")), "utf8");
      const imports = [...src.matchAll(/^import .*?from "(.+?)";$/gm)].map(
        (m) => m[1],
      );
      expect(imports.filter((i) => /gate-/.test(i)), rel).toEqual([]);
    }
  });
});
