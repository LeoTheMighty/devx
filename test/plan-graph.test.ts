// Pure-layer tests for the plan's Execution graph (harness-s5):
// extraction, parse errors, Files-entry semantics, path overlap, the Gate 3
// checks (cycle / bijection / unknown dep / unordered overlap / waivers /
// flags) and the emission view (order, blocked_by, independent pairs).

import { describe, expect, it } from "vitest";

import {
  blockedByFromGraph,
  checkExecutionGraph,
  emissionPlan,
  executionGraphYaml,
  extractExecutionGraph,
  filesEntryPaths,
  pathsOverlap,
  planPhaseFiles,
  planPhaseIds,
  topoOrder,
} from "../src/lib/engine/plan-graph.js";

function plan(opts: {
  graph?: string | null;
  checklist?: string[];
  phase3Files?: string[];
  phase2Files?: string[];
}): string {
  const checklist = opts.checklist ?? ["Phase 1: parser", "Phase 2: model", "Phase 3: cli"];
  const graph =
    opts.graph === null
      ? ""
      : [
          "## Execution graph",
          "",
          "```yaml",
          opts.graph ??
            [
              "phases:",
              "  - { id: 1, depends_on: [] }",
              "  - { id: 2, depends_on: [1] }",
              "  - { id: 3, depends_on: [1] }",
            ].join("\n"),
          "```",
          "",
        ].join("\n");
  const p2 = opts.phase2Files ?? ["- `src/lib/b.ts` — model (reads `src/commands/c.ts` as a pattern)"];
  const p3 = opts.phase3Files ?? ["- `src/commands/c.ts` — cli"];
  return [
    "# Plan — Demo",
    "",
    "## Phase checklist",
    "",
    ...checklist.map((c) => `- [ ] ${c}`),
    "",
    graph,
    "## Phases",
    "",
    "### 1. Phase: parser",
    "",
    "**Overview**: parse.",
    "",
    "**Files**:",
    "- `src/lib/a.ts` — parse things, patterned on `src/lib/zzz.ts`",
    "- `test/a.test.ts`, `test/b.test.ts` — coverage",
    "",
    "**Context**:",
    "- Reused unchanged: `src/lib/shared.ts` — not a change",
    "",
    "### 2. Phase: model",
    "",
    "**Files**:",
    ...p2,
    "",
    "### 3. Phase: cli",
    "",
    "**Files**:",
    ...p3,
    "",
  ].join("\n");
}

describe("extraction", () => {
  it("absent section → present: false", () => {
    expect(executionGraphYaml(plan({ graph: null }))).toBeNull();
    expect(extractExecutionGraph(plan({ graph: null }))).toEqual({ present: false });
  });

  it("reads the first fenced block under the section and stops at the next ##", () => {
    const g = extractExecutionGraph(plan({}));
    expect(g.present && g.ok).toBe(true);
    if (g.present && g.ok) {
      expect(g.graph.phases.map((p) => p.id)).toEqual([1, 2, 3]);
      expect(g.graph.phases[1].dependsOn).toEqual([1]);
      expect(g.graph.phases[1].parallelSafe).toBe(true);
    }
  });

  it("section with no fence, bad YAML, duplicate ids and non-integer ids are invalid", () => {
    const noFence = plan({}).replace(/```yaml[\s\S]*?```/, "nothing here");
    expect(extractExecutionGraph(noFence)).toMatchObject({ present: true, ok: false });
    expect(extractExecutionGraph(plan({ graph: "phases: [" }))).toMatchObject({ ok: false });
    const dup = extractExecutionGraph(plan({ graph: "phases:\n  - { id: 1 }\n  - { id: 1 }" }));
    expect(dup).toMatchObject({ ok: false });
    expect((dup as { error: string }).error).toContain("twice");
    const bad = extractExecutionGraph(plan({ graph: "phases:\n  - { id: one }" }));
    expect((bad as { error: string }).error).toContain("positive integer");
  });

  it("accepts `overlap_waivers` as an alias and defaults the flags", () => {
    const g = extractExecutionGraph(
      plan({
        graph: [
          "phases:",
          "  - { id: 1 }",
          "  - { id: 2, integration: true }",
          "  - { id: 3 }",
          "overlap_waivers:",
          "  - { phases: [2, 3], approver: leo, reason: ok }",
        ].join("\n"),
      }),
    );
    if (!(g.present && g.ok)) throw new Error("expected ok");
    expect(g.graph.waivers).toHaveLength(1);
    expect(g.graph.phases[1]).toMatchObject({ integration: true, parallelSafe: true, productionTouch: false });
  });
});

describe("plan text: phase ids and Files entries", () => {
  it("checklist rows win; headings are the fallback", () => {
    expect(planPhaseIds(plan({}))).toEqual([1, 2, 3]);
    const noChecklist = plan({}).replace(/## Phase checklist[\s\S]*?\n\n(?=## )/, "");
    expect(noChecklist).not.toContain("Phase checklist");
    expect(planPhaseIds(noChecklist)).toEqual([1, 2, 3]);
  });

  it("entry paths are the ticked tokens before the annotation separator — never inside it", () => {
    expect(filesEntryPaths("- `src/lib/a.ts` — parse, patterned on `src/lib/zzz.ts`")).toEqual(["src/lib/a.ts"]);
    expect(filesEntryPaths("- `test/a.test.ts`, `test/b.test.ts` — coverage")).toEqual([
      "test/a.test.ts",
      "test/b.test.ts",
    ]);
    expect(filesEntryPaths("- src/plain.ts - bare path, hyphen separator")).toEqual(["src/plain.ts"]);
    expect(filesEntryPaths("- `a.ts`")).toEqual(["a.ts"]);
  });

  it("planPhaseFiles reads only the Files list of each phase, skipping Context", () => {
    const files = planPhaseFiles(plan({}));
    expect(files.get(1)).toEqual(["src/lib/a.ts", "test/a.test.ts", "test/b.test.ts"]);
    expect(files.get(2)).toEqual(["src/lib/b.ts"]);
    expect(files.get(3)).toEqual(["src/commands/c.ts"]);
    expect([...files.values()].flat()).not.toContain("src/lib/shared.ts");
    expect([...files.values()].flat()).not.toContain("src/lib/zzz.ts");
  });
});

describe("pathsOverlap", () => {
  it("equal, dir prefix, glob prefix overlap; siblings do not", () => {
    expect(pathsOverlap("src/a.ts", "src/a.ts")).toBe(true);
    expect(pathsOverlap("src/lib/**", "src/lib/x/y.ts")).toBe(true);
    expect(pathsOverlap("src/lib/x/y.ts", "src/lib/*")).toBe(true);
    expect(pathsOverlap("src/lib", "src/lib/y.ts")).toBe(true);
    expect(pathsOverlap("src/lib/a.ts", "src/lib/b.ts")).toBe(false);
    expect(pathsOverlap("src/libx/a.ts", "src/lib/**")).toBe(false);
  });
});

describe("checkExecutionGraph", () => {
  it("no section → present false, no findings, files still read", () => {
    const c = checkExecutionGraph(plan({ graph: null }));
    expect(c.present).toBe(false);
    expect(c.findings).toEqual([]);
    expect(c.files.get(1)).toContain("src/lib/a.ts");
  });

  it("a sound graph has no findings", () => {
    const c = checkExecutionGraph(plan({}));
    expect(c.failed).toBe(false);
    expect(c.findings).toEqual([]);
  });

  it("cycle → fail", () => {
    const c = checkExecutionGraph(
      plan({ graph: "phases:\n  - { id: 1, depends_on: [3] }\n  - { id: 2, depends_on: [1] }\n  - { id: 3, depends_on: [1] }" }),
    );
    expect(c.failed).toBe(true);
    expect(c.findings.map((f) => f.code)).toContain("graph-cycle");
  });

  it("unknown and self dependencies → fail", () => {
    const c = checkExecutionGraph(
      plan({ graph: "phases:\n  - { id: 1, depends_on: [9] }\n  - { id: 2, depends_on: [2] }\n  - { id: 3 }" }),
    );
    const codes = c.findings.filter((f) => f.code === "graph-unknown-dep");
    expect(codes).toHaveLength(2);
    expect(c.failed).toBe(true);
  });

  it("phase set ≠ checklist → fail, naming both directions", () => {
    const extra = checkExecutionGraph(plan({ graph: "phases:\n  - { id: 1 }\n  - { id: 2 }\n  - { id: 3 }\n  - { id: 4 }" }));
    expect(extra.findings[0]).toMatchObject({ code: "graph-checklist-mismatch", severity: "fail" });
    expect(extra.findings[0].message).toContain("not in the plan: 4");
    const missing = checkExecutionGraph(plan({ graph: "phases:\n  - { id: 1 }\n  - { id: 2 }" }));
    expect(missing.findings[0].message).toContain("not in the graph: 3");
  });

  it("unordered same-file overlap → fail; an ordered one is fine", () => {
    // phases 2 and 3 both depend on 1 and are unordered w.r.t. each other.
    const c = checkExecutionGraph(plan({ phase3Files: ["- `src/lib/b.ts` — also edits the model"] }));
    expect(c.failed).toBe(true);
    const f = c.findings.find((x) => x.code === "graph-overlap");
    expect(f?.message).toContain("phases 2 and 3");
    expect(f?.message).toContain("src/lib/b.ts");
    // Order them and the overlap serializes by construction.
    const ordered = checkExecutionGraph(
      plan({
        graph: "phases:\n  - { id: 1 }\n  - { id: 2, depends_on: [1] }\n  - { id: 3, depends_on: [2] }",
        phase3Files: ["- `src/lib/b.ts` — also edits the model"],
      }),
    );
    expect(ordered.findings).toEqual([]);
  });

  it("an annotation mention is prose, not an overlap", () => {
    // Phase 2's Files bullet MENTIONS src/commands/c.ts after the separator;
    // phase 3 changes it. Unordered, yet no overlap.
    expect(checkExecutionGraph(plan({})).findings).toEqual([]);
  });

  it("`touches` globs count as changes", () => {
    const c = checkExecutionGraph(
      plan({ graph: "phases:\n  - { id: 1 }\n  - { id: 2, depends_on: [1], touches: [src/commands/**] }\n  - { id: 3, depends_on: [1] }" }),
    );
    expect(c.findings.map((f) => f.code)).toContain("graph-overlap");
  });

  it("a waiver with approver + reason clears the overlap; both parallel-safe → concern", () => {
    const g = [
      "phases:",
      "  - { id: 1 }",
      "  - { id: 2, depends_on: [1] }",
      "  - { id: 3, depends_on: [1] }",
      "waivers:",
      "  - { phases: [2, 3], paths: [src/lib/b.ts], approver: leo, reason: append-only file }",
    ].join("\n");
    const c = checkExecutionGraph(plan({ graph: g, phase3Files: ["- `src/lib/b.ts` — appends"] }));
    expect(c.failed).toBe(false);
    expect(c.findings).toEqual([
      expect.objectContaining({ severity: "concern", code: "graph-parallel-collision" }),
    ]);
    // Make one side non-parallel: the concern goes away.
    const quiet = checkExecutionGraph(
      plan({ graph: g.replace("{ id: 3, depends_on: [1] }", "{ id: 3, depends_on: [1], parallel_safe: false }"), phase3Files: ["- `src/lib/b.ts` — appends"] }),
    );
    expect(quiet.findings).toEqual([]);
  });

  it("a waiver missing approver or reason is invalid and does not cover", () => {
    const g = [
      "phases:",
      "  - { id: 1 }",
      "  - { id: 2, depends_on: [1] }",
      "  - { id: 3, depends_on: [1] }",
      "waivers:",
      "  - { phases: [2, 3], paths: [src/lib/b.ts] }",
    ].join("\n");
    const c = checkExecutionGraph(plan({ graph: g, phase3Files: ["- `src/lib/b.ts` — appends"] }));
    expect(c.findings.map((f) => f.code).sort()).toEqual(["graph-overlap", "graph-waiver-invalid"]);
  });

  it("parallel_safe on an integration phase is a concern and reads as not parallel-safe", () => {
    const c = checkExecutionGraph(
      plan({ graph: "phases:\n  - { id: 1 }\n  - { id: 2, depends_on: [1], integration: true, parallel_safe: true }\n  - { id: 3, depends_on: [1] }" }),
    );
    expect(c.failed).toBe(false);
    expect(c.findings.map((f) => f.code)).toEqual(["graph-parallel-flag"]);
    const ep = emissionPlan(plan({ graph: "phases:\n  - { id: 1 }\n  - { id: 2, depends_on: [1], integration: true }\n  - { id: 3, depends_on: [1] }" }));
    expect(ep.phases[1].parallelSafe).toBe(false);
    expect(ep.phases[1].independentWith).toEqual([]);
    expect(ep.phases[2].independentWith).toEqual([]);
  });
});

describe("emission view", () => {
  it("serial plan: checklist order, no deps, nothing independent", () => {
    const ep = emissionPlan(plan({ graph: null }));
    expect(ep.present).toBe(false);
    expect(ep.order).toEqual([1, 2, 3]);
    expect(ep.phases.every((p) => p.dependsOn.length === 0 && !p.parallelSafe)).toBe(true);
  });

  it("graph plan: topo order, depends_on, symmetric independent pairs, files", () => {
    const ep = emissionPlan(plan({}));
    expect(ep.present).toBe(true);
    expect(ep.order).toEqual([1, 2, 3]);
    expect(ep.phases[1]).toMatchObject({ id: 2, dependsOn: [1], parallelSafe: true, independentWith: [3] });
    expect(ep.phases[2]).toMatchObject({ id: 3, dependsOn: [1], independentWith: [2], files: ["src/commands/c.ts"] });
    expect(ep.phases[0].independentWith).toEqual([]);
  });

  it("topoOrder respects deps and keeps ids ascending within a layer", () => {
    const g = extractExecutionGraph(
      plan({ graph: "phases:\n  - { id: 3, depends_on: [1, 2] }\n  - { id: 2 }\n  - { id: 1 }" }),
    );
    if (!(g.present && g.ok)) throw new Error("expected ok");
    expect(topoOrder(g.graph)).toEqual([1, 2, 3]);
  });

  it("blockedByFromGraph maps deps to hashes and skips phases without a hash", () => {
    const g = extractExecutionGraph(plan({}));
    if (!(g.present && g.ok)) throw new Error("expected ok");
    const m = blockedByFromGraph(g.graph, new Map([[1, "aaa111"], [2, "bbb222"]]));
    expect(m.get(1)).toEqual([]);
    expect(m.get(2)).toEqual(["aaa111"]);
    expect(m.has(3)).toBe(false);
  });

  it("a failed graph still reports but proves nothing independent", () => {
    const ep = emissionPlan(plan({ graph: "phases:\n  - { id: 1, depends_on: [2] }\n  - { id: 2, depends_on: [1] }\n  - { id: 3 }" }));
    expect(ep.findings.some((f) => f.code === "graph-cycle")).toBe(true);
    expect(ep.phases.every((p) => p.independentWith.length === 0)).toBe(true);
  });
});
