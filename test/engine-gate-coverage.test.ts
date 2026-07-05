// Adversarial tests for `devx gate coverage` (v2e101 AC #4): two-mode
// detection (earlier open gate wins), --table judgment injection, mechanical
// completeness + verdict computation, plan-mode P0 floor, verify-report
// emission via the shared verdict module, flag/stage flips on PASS/CONCERNS.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGateCoverage } from "../src/commands/gate.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  computeCoverageVerdict,
  detectCoverageMode,
  expectationPriorities,
  extractSourceIds,
  parseCoverageTable,
} from "../src/lib/engine/gate-coverage.js";
import { parseVerdictBlock } from "../src/lib/engine/verdict.js";
import {
  type EngineRepo,
  captureIo,
  designTable,
  makeEngineRepo,
  planTable,
  validExpectations,
  validPrd,
} from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// Pure layer
// ---------------------------------------------------------------------------

function stateWith(flags: Partial<Record<string, boolean>>) {
  return {
    hash: "abc123",
    type: "plan",
    status: "in-progress",
    stage: "design" as const,
    enteredAt: "prd",
    gateStatus: {
      prd_validated: true,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
      ...flags,
    },
    outcome: { status: null, measure_by: null },
    workstream: "_devx/workstreams/demo",
    blockedBy: [],
  };
}

describe("detectCoverageMode", () => {
  it("refuses before Gate 1 has passed", () => {
    const r = detectCoverageMode({
      state: stateWith({ prd_validated: false }),
      designExists: true,
      planExists: true,
    });
    expect(r.mode).toBeNull();
    expect((r as { refusal: string }).refusal).toContain("Gate 1");
  });

  it("design mode when design.md exists and design_verified is false", () => {
    const r = detectCoverageMode({
      state: stateWith({}),
      designExists: true,
      planExists: false,
    });
    expect(r.mode).toBe("design");
  });

  it("earlier open gate wins: design mode even when plan.md also exists", () => {
    const r = detectCoverageMode({
      state: stateWith({}),
      designExists: true,
      planExists: true,
    });
    expect(r.mode).toBe("design");
  });

  it("plan mode when design is verified and plan.md exists", () => {
    const r = detectCoverageMode({
      state: stateWith({ design_verified: true }),
      designExists: true,
      planExists: true,
    });
    expect(r.mode).toBe("plan");
  });

  it("refuses when the open gate's artifact is missing", () => {
    const noDesign = detectCoverageMode({
      state: stateWith({}),
      designExists: false,
      planExists: false,
    });
    expect((noDesign as { refusal: string }).refusal).toContain("/devx design");
    const noPlan = detectCoverageMode({
      state: stateWith({ design_verified: true }),
      designExists: true,
      planExists: false,
    });
    expect((noPlan as { refusal: string }).refusal).toContain("/devx plan");
  });

  it("refuses when both coverage gates are already closed", () => {
    const r = detectCoverageMode({
      state: stateWith({ design_verified: true, plan_verified: true }),
      designExists: true,
      planExists: true,
    });
    expect((r as { refusal: string }).refusal).toContain("no open coverage gate");
  });
});

describe("extractSourceIds", () => {
  const files = { prd: validPrd(), expectations: validExpectations() };

  it("design mode pulls the prd.md ID set", () => {
    expect(extractSourceIds("design", files)).toEqual([
      "G-1",
      "G-2",
      "UC-1",
      "CAP-1",
      "FR-1",
    ]);
  });

  it("plan mode pulls the E-id set", () => {
    expect(extractSourceIds("plan", files)).toEqual(["E-1", "E-2", "E-3"]);
  });
});

describe("parseCoverageTable", () => {
  it("normalizes the status vocabulary (full/✅/covered → covered)", () => {
    const r = parseCoverageTable(
      JSON.stringify({
        rows: [
          { id: "E-1", status: "full" },
          { id: "E-2", status: "✅" },
          { id: "E-3", status: "PARTIAL" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.table.rows.map((x) => x.status)).toEqual([
        "covered",
        "covered",
        "partial",
      ]);
    }
  });

  it("rejects malformed JSON, non-object roots, and rows without ids", () => {
    expect(parseCoverageTable("{oops").ok).toBe(false);
    expect(parseCoverageTable("[1,2]").ok).toBe(false);
    expect(parseCoverageTable('{"rows":[{"status":"covered"}]}').ok).toBe(false);
  });

  it("rejects an unknown status naming the row", () => {
    const r = parseCoverageTable(
      '{"rows":[{"id":"E-1","status":"kinda"}]}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("E-1");
  });

  it("parses extras and rejects malformed extras", () => {
    const ok = parseCoverageTable(
      '{"rows":[],"extras":[{"item":"telemetry","where":"§4"}]}',
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.table.extras[0].item).toBe("telemetry");
    expect(parseCoverageTable('{"rows":[],"extras":[{}]}').ok).toBe(false);
  });
});

describe("computeCoverageVerdict", () => {
  const priorities = expectationPriorities(validExpectations());

  function compute(tableJson: string, mode: "design" | "plan" = "plan") {
    const parsed = parseCoverageTable(tableJson);
    if (!parsed.ok) throw new Error(parsed.error);
    const ids = mode === "plan" ? ["E-1", "E-2", "E-3"] : ["G-1", "G-2"];
    return computeCoverageVerdict(mode, ids, parsed.table, priorities);
  }

  it("all covered → PASS", () => {
    expect(compute(planTable()).verdict).toBe("PASS");
  });

  it("only ⚠️ partial → CONCERNS with the reason recorded", () => {
    const c = compute(planTable({ "E-2": { status: "partial" } }));
    expect(c.verdict).toBe("CONCERNS");
    expect(c.reasons.join(" ")).toContain("E-2");
  });

  it("any ❌ missing → FAIL", () => {
    const c = compute(planTable({ "E-3": { status: "missing" } }));
    expect(c.verdict).toBe("FAIL");
  });

  it("P0 floor: a partial P0 fails even though partial alone is CONCERNS", () => {
    const c = compute(planTable({ "E-1": { status: "partial" } }));
    expect(c.verdict).toBe("FAIL");
    expect(c.reasons.join(" ")).toContain("P0 floor unmet");
  });

  it("P0 floor: a covered P0 with no artifact path fails", () => {
    const c = compute(planTable({ "E-1": { artifact: null } }));
    expect(c.verdict).toBe("FAIL");
    expect(c.reasons.join(" ")).toContain("names no runnable artifact");
  });

  it("P0 floor: a non-path artifact ('see plan') fails", () => {
    const c = compute(planTable({ "E-1": { artifact: "ask the maintainer" } }));
    expect(c.verdict).toBe("FAIL");
  });

  it("P0 floor does not apply in design mode", () => {
    const c = compute(designTable({ "G-1": "partial" }), "design");
    expect(c.verdict).toBe("CONCERNS");
  });

  it("reports missing rows (completeness) without inventing a verdict", () => {
    const c = compute('{"rows":[{"id":"E-1","status":"covered","artifact":"t/x.ts"}]}');
    expect(c.missingRowIds).toEqual(["E-2", "E-3"]);
  });

  it("reports duplicate rows", () => {
    const c = compute(
      JSON.stringify({
        rows: [
          { id: "E-1", status: "covered", artifact: "t/x.ts" },
          { id: "E-1", status: "missing" },
          { id: "E-2", status: "covered" },
          { id: "E-3", status: "covered" },
        ],
      }),
    );
    expect(c.duplicateRowIds).toEqual(["E-1"]);
  });

  it("routes non-source rows to extras, not errors", () => {
    const parsed = parseCoverageTable(
      JSON.stringify({
        rows: [
          { id: "E-1", status: "covered", artifact: "t/x.ts" },
          { id: "E-2", status: "covered" },
          { id: "E-3", status: "covered" },
          { id: "E-99", status: "covered", where: "phase 9" },
        ],
      }),
    );
    if (!parsed.ok) throw new Error("unexpected");
    const c = computeCoverageVerdict("plan", ["E-1", "E-2", "E-3"], parsed.table, priorities);
    expect(c.extraRows.map((r) => r.id)).toEqual(["E-99"]);
    expect(c.missingRowIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CLI driver layer
// ---------------------------------------------------------------------------

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const SPEC_REL = "plan/plan-abc123-2026-07-05T13:01-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";

function seed(flags: {
  prd_validated?: boolean;
  design_verified?: boolean;
  plan_verified?: boolean;
  stage?: string;
  design?: boolean;
  plan?: boolean;
}): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${flags.stage ?? "design"}`,
      "gate_status:",
      `  prd_validated: ${flags.prd_validated ?? true}`,
      `  design_verified: ${flags.design_verified ?? false}`,
      `  plan_verified: ${flags.plan_verified ?? false}`,
      "  evals_red: false",
      `workstream: ${WS}`,
      "---",
      "body",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
  if (flags.design !== false) repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
  if (flags.plan) repo.write(`${WS}/plan.md`, "## Plan\n\nreal.\n");
}

function gateCoverage(tableJson?: string) {
  const io = captureIo();
  let tablePath: string | undefined;
  if (tableJson !== undefined) {
    repo.write("table.json", tableJson);
    tablePath = `${repo.root}/table.json`;
  }
  const code = runGateCoverage(["abc123"], { table: tablePath }, {
    ...io,
    projectPath: repo.configPath,
    now: () => new Date(2026, 6, 5, 13, 0, 0),
  });
  return { code, io };
}

describe("devx gate coverage — CLI driver", () => {
  it("design mode PASS: writes the verify report + flips design_verified/stage", () => {
    seed({});
    const { code, io } = gateCoverage(designTable());
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.gate).toBe("PASS");
    expect(j.mode).toBe("design");
    expect(j.report).toBe(`${WS}/decisions/2026-07-05-design-verify.md`);

    const report = repo.read(`${WS}/decisions/2026-07-05-design-verify.md`);
    const verdict = parseVerdictBlock(report);
    expect(verdict!.block.gate).toBe("PASS");
    expect(verdict!.block.reviewer).toBe("devx gate coverage (design mode)");
    expect(report).toContain("| G-1 | ✅ |");
    expect(report).toContain("## Extras requiring product approval");

    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.design_verified).toBe(true);
    expect(state.stage).toBe("plan");
  });

  it("CONCERNS advances the gate with the concern recorded", () => {
    seed({});
    const { code, io } = gateCoverage(designTable({ "CAP-1": "partial" }));
    expect(code).toBe(0);
    const j = io.json() as { gate: string; reasons: string[] };
    expect(j.gate).toBe("CONCERNS");
    expect(j.reasons.join(" ")).toContain("CAP-1");
    expect(readEngineState(repo.read(SPEC_REL)).gateStatus.design_verified).toBe(true);
  });

  it("FAIL: exit 1, report written, frontmatter NOT flipped", () => {
    seed({});
    const before = repo.read(SPEC_REL);
    const { code, io } = gateCoverage(designTable({ "FR-1": "missing" }));
    expect(code).toBe(1);
    expect((io.json() as { gate: string }).gate).toBe("FAIL");
    // The verify report is the record of the run — written even on FAIL.
    const report = repo.read(`${WS}/decisions/2026-07-05-design-verify.md`);
    expect(parseVerdictBlock(report)!.block.gate).toBe("FAIL");
    expect(report).toContain("| FR-1 | ❌ |");
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("plan mode: keys rows off E-ids and enforces the P0 floor", () => {
    seed({ design_verified: true, stage: "plan", plan: true });
    const { code, io } = gateCoverage(planTable({ "E-1": { artifact: null } }));
    expect(code).toBe(1);
    const j = io.json() as { gate: string; mode: string; reasons: string[] };
    expect(j.mode).toBe("plan");
    expect(j.reasons.join(" ")).toContain("P0 floor unmet");
  });

  it("plan mode PASS flips plan_verified + stage: red", () => {
    seed({ design_verified: true, stage: "plan", plan: true });
    const { code } = gateCoverage(planTable());
    expect(code).toBe(0);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.plan_verified).toBe(true);
    expect(state.stage).toBe("red");
  });

  it("extras (table rows off the source set + explicit extras) land in the report", () => {
    seed({});
    const table = JSON.parse(designTable()) as { rows: unknown[]; extras?: unknown[] };
    table.rows.push({ id: "FR-9", status: "covered", where: "design §9" });
    table.extras = [{ item: "telemetry hook", where: "design §4" }];
    const { code } = gateCoverage(JSON.stringify(table));
    expect(code).toBe(0);
    const report = repo.read(`${WS}/decisions/2026-07-05-design-verify.md`);
    expect(report).toContain("FR-9");
    expect(report).toContain("telemetry hook");
  });

  it("refuses (exit 1) before Gate 1 passes", () => {
    seed({ prd_validated: false });
    const { code, io } = gateCoverage(designTable());
    expect(code).toBe(1);
    expect((io.json() as { refusal: string }).refusal).toContain("Gate 1");
  });

  it("refuses (exit 1) when both coverage gates are closed", () => {
    seed({ design_verified: true, plan_verified: true, plan: true });
    const { code, io } = gateCoverage(designTable());
    expect(code).toBe(1);
    expect((io.json() as { refusal: string }).refusal).toContain("no open coverage gate");
  });

  it("missing --table → exit 2 explaining the judgment split", () => {
    seed({});
    const { code, io } = gateCoverage(undefined);
    expect(code).toBe(2);
    expect(io.stderr()).toContain("--table");
    expect(io.stderr()).toContain("subagent");
  });

  it("incomplete table → exit 2 listing every missing ID, nothing written", () => {
    seed({});
    const { code, io } = gateCoverage(
      '{"rows":[{"id":"G-1","status":"covered"}]}',
    );
    expect(code).toBe(2);
    expect(io.stderr()).toContain("G-2");
    expect(io.stderr()).toContain("FR-1");
    expect(repo.exists(`${WS}/decisions/2026-07-05-design-verify.md`)).toBe(false);
    expect(readEngineState(repo.read(SPEC_REL)).gateStatus.design_verified).toBe(false);
  });

  it("duplicate table rows → exit 2", () => {
    seed({});
    const table = JSON.parse(designTable()) as { rows: Array<{ id: string; status: string }> };
    table.rows.push({ id: "G-1", status: "missing" });
    const { code, io } = gateCoverage(JSON.stringify(table));
    expect(code).toBe(2);
    expect(io.stderr()).toContain("duplicate");
  });

  it("malformed table JSON → exit 2", () => {
    seed({});
    const { code, io } = gateCoverage("{nope");
    expect(code).toBe(2);
    expect(io.stderr()).toContain("not valid JSON");
  });

  it("unreadable --table path → exit 2", () => {
    seed({});
    const io = captureIo();
    const code = runGateCoverage(["abc123"], { table: `${repo.root}/nope.json` }, {
      ...io,
      projectPath: repo.configPath,
    });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("cannot read --table");
  });

  it("unknown hash → exit 2", () => {
    const io = captureIo();
    const code = runGateCoverage(["zz9999"], { table: "x.json" }, {
      ...io,
      projectPath: repo.configPath,
    });
    expect(code).toBe(2);
  });
});
