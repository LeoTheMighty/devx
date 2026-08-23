// Outline/human ↔ gate firewall (folder-per-artifact layout). Same shape as
// test/gate-todo-isolation.test.ts: outline.md and human.md are NEVER gate
// inputs — outlines are the human's channel and human.md is a rendered
// digest, so neither may influence a verdict. The firewall is what keeps
// "non-gating" true mechanically rather than by convention.
//
// The one sanctioned mention: src/lib/engine/artifacts.ts owns the
// basenames (isAuthoredEvalEntry must EXCLUDE the companions from the
// evals/ authored probe) — that module is a path dictionary, not a reader.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

const FIREWALLED_MODULES = [
  // Gate evaluators + driver: verdicts must be outline-blind.
  "src/commands/gate.ts",
  "src/lib/engine/gate-prd.ts",
  "src/lib/engine/gate-coverage.ts",
  "src/lib/engine/gate-evals.ts",
  // Routing: `devx next` decides from agent.md/expectations/evals presence
  // and gate flags only.
  "src/lib/engine/next.ts",
  "src/lib/next/gather.ts",
  "src/commands/next.ts",
];

// Any read-shaped mention of the human-facing companions inside firewalled
// code is a breach. `isAuthoredEvalEntry` is allowed — it is the exclusion
// filter itself (imported from artifacts.ts, where the basenames live).
const BREACH_RE = /outline\.md|outline-critique|human\.md|OUTLINE/;
const ALLOWED_RE = /isAuthoredEvalEntry/;

describe("gate/next ↔ outline firewall — static read-surface scan", () => {
  for (const rel of FIREWALLED_MODULES) {
    it(`${rel} has 0 references to outline/human surfaces`, () => {
      const lines = readFileSync(
        join(REAL_REPO_ROOT, ...rel.split("/")),
        "utf8",
      ).split("\n");
      const breaches = lines
        .map((line, i) =>
          BREACH_RE.test(line) && !ALLOWED_RE.test(line)
            ? `${rel}:${i + 1}: ${line.trim()}`
            : null,
        )
        .filter((b): b is string => b !== null);
      expect(breaches).toEqual([]);
    });
  }
});
