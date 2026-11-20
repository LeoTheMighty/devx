// `devx workstream graph <hash>` — the emission reader (harness-s5). JSON
// shape, serial fallback, and the exit-2 refusals.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runWorkstreamGraph } from "../src/commands/workstream.js";
import { type EngineRepo, captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";

const SPEC_REL = "plan/plan-abc123-2026-07-05T13:01-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
  repo.write(
    SPEC_REL,
    ["---", "hash: abc123", "type: plan", "status: in-progress", "stage: red", `workstream: ${WS}`, "---", "body", ""].join("\n"),
  );
  repo.mkdir(WS);
});
afterEach(() => repo.cleanup());

function planText(graph: boolean): string {
  return [
    "# Plan",
    "",
    "## Phase checklist",
    "",
    "- [ ] Phase 1: a",
    "- [ ] Phase 2: b",
    "- [ ] Phase 3: c",
    "",
    ...(graph
      ? ["## Execution graph", "", "```yaml", "phases:", "  - { id: 1 }", "  - { id: 2, depends_on: [1] }", "  - { id: 3, depends_on: [1] }", "```", ""]
      : []),
    "## Phases",
    "",
    "### 1. Phase: a",
    "",
    "**Files**:",
    "- `src/a.ts` — a",
    "",
    "### 2. Phase: b",
    "",
    "**Files**:",
    "- `src/b.ts` — b",
    "",
    "### 3. Phase: c",
    "",
    "**Files**:",
    "- `src/c.ts` — c",
    "",
  ].join("\n");
}

function run(hash = "abc123") {
  const io = captureIo();
  const code = runWorkstreamGraph([hash], { ...io, projectPath: repo.configPath });
  return { code, io };
}

describe("devx workstream graph", () => {
  it("prints order, depends_on and independent pairs for a graph plan", () => {
    repo.write(`${WS}/plan/agent.md`, planText(true));
    const { code, io } = run();
    expect(code).toBe(0);
    const j = io.json() as {
      present: boolean;
      order: number[];
      phases: Array<{ id: number; depends_on: number[]; parallel_safe: boolean; independent_with: number[]; files: string[] }>;
      findings: unknown[];
    };
    expect(j.present).toBe(true);
    expect(j.order).toEqual([1, 2, 3]);
    expect(j.phases[1]).toEqual({ id: 2, depends_on: [1], parallel_safe: true, independent_with: [3], files: ["src/b.ts"] });
    expect(j.findings).toEqual([]);
  });

  it("serial plan: present false, checklist order, nothing parallel", () => {
    repo.write(`${WS}/plan/agent.md`, planText(false));
    const { code, io } = run();
    expect(code).toBe(0);
    const j = io.json() as { present: boolean; order: number[]; phases: Array<{ parallel_safe: boolean }> };
    expect(j.present).toBe(false);
    expect(j.order).toEqual([1, 2, 3]);
    expect(j.phases.every((p) => p.parallel_safe === false)).toBe(true);
  });

  it("findings ride along without changing the exit code — the gate owns the verdict", () => {
    repo.write(`${WS}/plan/agent.md`, planText(true).replace("{ id: 1 }", "{ id: 1, depends_on: [3] }"));
    const { code, io } = run();
    expect(code).toBe(0);
    const j = io.json() as { findings: Array<{ code: string }> };
    expect(j.findings.map((f) => f.code)).toContain("graph-cycle");
  });

  it("exit 2 with no plan artifact, and on an unknown hash", () => {
    const missing = run();
    expect(missing.code).toBe(2);
    expect(missing.io.stderr()).toContain("no plan artifact");
    const unknown = run("zzz999");
    expect(unknown.code).toBe(2);
  });
});
