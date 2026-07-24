// E-3 permanent suite (hfi102): gate-verdict persistence across all three
// gate commands. Every *evaluated* run — PASS, CONCERNS, and FAIL alike —
// writes its D-9 verdict into the spec's `gate_verdicts:` map; refusals,
// --dry-run, and exit-2 error paths write nothing to the spec. FAIL runs are
// verdict-only: gate_status booleans and stage stay untouched.
//
// Plus T2.5: `devx next <hash>` renders FAIL distinctly from never-run,
// with the FAIL fix path pointing at the report the same gate run wrote.
//
// Spec: dev/dev-hfi102-2026-07-24T10:41-gate-verdict-persistence.md
// Eval: _devx/workstreams/harness-fold-in/evals/E-3_gate-verdict-persist.ts

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runGateCoverage,
  runGateEvalsCli,
  runGatePrd,
} from "../src/commands/gate.js";
import { runNext } from "../src/commands/next.js";
import { runRevise } from "../src/commands/revise.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  type EngineRepo,
  captureIo,
  designTable,
  makeEngineRepo,
  planTable,
  validExpectations,
  validPlan,
  validPrd,
} from "./fixtures/engine-repo.js";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const SPEC_REL = "plan/plan-abc123-2026-07-05T13:01-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";

function seedSpec(flags: {
  stage?: string;
  prd_validated?: boolean;
  design_verified?: boolean;
  plan_verified?: boolean;
}): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${flags.stage ?? "prd"}`,
      "gate_status:",
      `  prd_validated: ${flags.prd_validated ?? false}`,
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
}

function state() {
  return readEngineState(repo.read(SPEC_REL));
}

// ---------------------------------------------------------------------------
// devx gate prd
// ---------------------------------------------------------------------------

function gatePrd(fsOverride?: { exists: (p: string) => boolean }) {
  const io = captureIo();
  const code = runGatePrd(["abc123"], {
    ...io,
    projectPath: repo.configPath,
    ...(fsOverride ? { fs: fsOverride } : {}),
  });
  return { code, io };
}

describe("gate prd — verdict persistence", () => {
  it("PASS writes gate_verdicts.prd alongside the flag flip", () => {
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.prd).toBe("PASS");
    expect(s.gateStatus.prd_validated).toBe(true);
    expect(s.stage).toBe("design");
  });

  it("evaluated FAIL writes the verdict only — flags and stage untouched", () => {
    seedSpec({});
    repo.write(
      `${WS}/expectations.md`,
      validExpectations().replace("- **Threshold:** tour present on 100% of PRs\n", ""),
    );
    expect(gatePrd().code).toBe(1);
    const s = state();
    expect(s.gateVerdicts.prd).toBe("FAIL");
    expect(s.gateStatus.prd_validated).toBe(false);
    expect(s.stage).toBe("prd");
  });

  it("refusal (missing gate inputs) writes nothing", () => {
    seedSpec({});
    const before = repo.read(SPEC_REL);
    const { code } = gatePrd({
      exists: (p) => !p.endsWith("prd.md") || p.includes("templates"),
    });
    expect(code).toBe(1);
    expect(repo.read(SPEC_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// devx gate coverage (design + plan modes)
// ---------------------------------------------------------------------------

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
    now: () => new Date(2026, 6, 24, 13, 0, 0),
  });
  return { code, io };
}

describe("gate coverage — verdict persistence", () => {
  it("design PASS writes gate_verdicts.design", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable()).code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.design).toBe("PASS");
    expect(s.gateStatus.design_verified).toBe(true);
  });

  it("design CONCERNS advances the gate AND records CONCERNS", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "CAP-1": "partial" })).code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.design).toBe("CONCERNS");
    expect(s.gateStatus.design_verified).toBe(true);
  });

  it("design FAIL writes the verdict only — flags and stage untouched", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);
    const s = state();
    expect(s.gateVerdicts.design).toBe("FAIL");
    expect(s.gateStatus.design_verified).toBe(false);
    expect(s.stage).toBe("design");
  });

  it("plan PASS writes gate_verdicts.plan (coverage keys by evaluated surface)", () => {
    seedSpec({ prd_validated: true, design_verified: true, stage: "plan" });
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    repo.write(`${WS}/plan.md`, "## Plan\n\nreal.\n");
    expect(gateCoverage(planTable()).code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.plan).toBe("PASS");
    expect(s.gateVerdicts.design).toBe(null);
    expect(s.gateStatus.plan_verified).toBe(true);
  });

  it("plan FAIL (P0 floor) writes gate_verdicts.plan only", () => {
    seedSpec({ prd_validated: true, design_verified: true, stage: "plan" });
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    repo.write(`${WS}/plan.md`, "## Plan\n\nreal.\n");
    expect(gateCoverage(planTable({ "E-1": { artifact: null } })).code).toBe(1);
    const s = state();
    expect(s.gateVerdicts.plan).toBe("FAIL");
    expect(s.gateStatus.plan_verified).toBe(false);
    expect(s.stage).toBe("plan");
  });

  it("refusal (Gate 1 open) writes nothing", () => {
    seedSpec({});
    const before = repo.read(SPEC_REL);
    expect(gateCoverage(designTable()).code).toBe(1);
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("exit-2 error (missing --table) writes nothing", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    const before = repo.read(SPEC_REL);
    expect(gateCoverage(undefined).code).toBe(2);
    expect(repo.read(SPEC_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// devx gate evals
// ---------------------------------------------------------------------------

function seedEvals(flags: { plan_verified?: boolean } = {}): void {
  seedSpec({
    stage: "red",
    prd_validated: true,
    design_verified: true,
    plan_verified: flags.plan_verified ?? true,
  });
  repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
  repo.write(`${WS}/plan.md`, validPlan());
  repo.write("test/demo.test.mjs", "process.exit(1);\n");
  repo.write("test/perf.test.mjs", "process.exit(1);\n");
}

function gateEvals(flags: { dryRun?: boolean } = {}, exitCode = 1) {
  const io = captureIo();
  const code = runGateEvalsCli(["abc123"], flags, {
    ...io,
    projectPath: repo.configPath,
    now: () => new Date(2026, 6, 24, 13, 0, 0),
    exec: () => ({ stdout: "", stderr: "not implemented", exitCode }),
  });
  return { code, io };
}

describe("gate evals — verdict persistence", () => {
  it("PASS (all P0s observed RED) writes gate_verdicts.evals", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.evals).toBe("PASS");
    expect(s.gateStatus.evals_red).toBe(true);
  });

  it("FAIL (non-RED P0) writes the verdict only — flags and stage untouched", () => {
    seedEvals();
    expect(gateEvals({}, 0).code).toBe(1);
    const s = state();
    expect(s.gateVerdicts.evals).toBe("FAIL");
    expect(s.gateStatus.evals_red).toBe(false);
    expect(s.stage).toBe("red");
  });

  it("refusal (Gate 3 open) writes nothing", () => {
    seedEvals({ plan_verified: false });
    const before = repo.read(SPEC_REL);
    expect(gateEvals().code).toBe(1);
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("--dry-run writes nothing", () => {
    seedEvals();
    const before = repo.read(SPEC_REL);
    expect(gateEvals({ dryRun: true }).code).toBe(0);
    expect(repo.read(SPEC_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// devx revise — the only eraser (T2.3)
// ---------------------------------------------------------------------------

function revise(touched: string) {
  const io = captureIo();
  const code = runRevise(["abc123"], { touched }, {
    ...io,
    projectPath: repo.configPath,
  });
  return { code, io };
}

describe("devx revise — post-revise verdict clearing", () => {
  it("gate-written verdicts read null after revise; earlier stages survive", () => {
    // Real lifecycle: gate prd PASSes (writes prd: PASS), gate coverage
    // FAILs in design mode (writes design: FAIL, flag stays false), then
    // design.md is revised — the FAIL must be erased, prd's PASS kept.
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);
    expect(state().gateVerdicts).toMatchObject({ prd: "PASS", design: "FAIL" });

    expect(revise("design.md").code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.prd).toBe("PASS");
    expect(s.gateVerdicts.design).toBe(null);
    expect(s.gateVerdicts.plan).toBe(null);
    expect(s.gateVerdicts.evals).toBe(null);
  });

  it("prd.md revise erases all four verdicts", () => {
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    expect(revise("prd.md").code).toBe(0);
    const s = state();
    expect(s.gateVerdicts).toEqual({
      prd: null,
      design: null,
      plan: null,
      evals: null,
    });
    expect(s.stage).toBe("prd");
  });

  it("post-revise, `devx next` renders the cleared gate as never-run again", () => {
    // FAIL → revise → the summary must drop back to `—`, not keep FAIL.
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);
    expect(revise("design.md").code).toBe(0);
    expect(next().summary).toBe("gates: prd PASS · design — · plan — · evals —");
  });

  it("replay-path stdout shape is unchanged by verdict clearing", () => {
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    const { code, io } = revise("prd.md");
    expect(code).toBe(0);
    expect(Object.keys(io.json() as Record<string, unknown>).sort()).toEqual([
      "flags_cleared",
      "hash",
      "replay",
      "resets",
      "spec",
      "stage",
      "touched",
    ]);
  });
});

// ---------------------------------------------------------------------------
// devx next — FAIL vs never-run rendering (T2.5)
// ---------------------------------------------------------------------------

/** Run `devx next abc123` and return its verdict map + summary block. */
function next(): {
  verdicts: Record<string, string | null>;
  summary: string;
} {
  const io = captureIo();
  expect(runNext(["abc123"], { ...io, projectPath: repo.configPath })).toBe(0);
  const j = io.json() as {
    gate_verdicts: Record<string, string | null>;
    gate_summary: string;
  };
  return { verdicts: j.gate_verdicts, summary: j.gate_summary };
}

describe("devx next — FAIL vs never-run (T2.5)", () => {
  it("never-run gates render as em-dash with all-null verdicts", () => {
    seedSpec({});
    const { verdicts, summary } = next();
    expect(verdicts).toEqual({ prd: null, design: null, plan: null, evals: null });
    expect(summary).toBe("gates: prd — · design — · plan — · evals —");
  });

  it("a gate FAIL renders FAIL — visibly distinct from never-run — with the report the run wrote", () => {
    // Real lifecycle: prd PASSes, design coverage FAILs (which also writes
    // decisions/2026-07-24-design-verify.md); never-run gates stay `—`.
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);

    const { verdicts, summary } = next();
    expect(verdicts).toEqual({
      prd: "PASS",
      design: "FAIL",
      plan: null,
      evals: null,
    });
    expect(summary).toBe(
      [
        "gates: prd PASS · design FAIL · plan — · evals —",
        `  design FAIL → report: ${WS}/decisions/2026-07-24-design-verify.md · re-run: devx gate coverage abc123`,
      ].join("\n"),
    );
  });

  it("legacy flag-true without a verdict renders PASS (migration fallback)", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    const { verdicts, summary } = next();
    expect(verdicts.prd).toBe(null);
    expect(summary).toBe("gates: prd PASS · design — · plan — · evals —");
  });
});
