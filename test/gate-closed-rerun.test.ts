// A gate that has closed is not re-run, and `devx gate coverage` evaluates
// only the gate its table judges.
//
// Two verdict-path bugs, both found by running a gate the caller believed was
// a read-only look:
//
//  1. `devx gate prd` had no closed-gate refusal. Against a spec with
//     `prd_validated: true` it re-evaluated and re-stamped `gate_verdicts.prd`
//     — overwriting the key when present, adding it when not — and resolved
//     the gate's `questions.md` entries as it went. It put a stray
//     `prd: CONCERNS` into a real plan spec.
//  2. `devx gate coverage` picks its mode from state, so against a closed
//     Gate 2 it silently evaluated Gate 3. A design-judged table then failed
//     completeness by luck (exit 2); nothing made the substitution itself a
//     refusal.
//  3. `devx gate evals` had no closed-gate refusal either. Re-run after
//     implementation it stamped `evals: FAIL` beside `evals_red: true` and
//     OVERWROTE `evals/RED-report.md` — the only record that the P0s were
//     ever watched failing. Re-run over an eval edited to still fail, it
//     re-locked the edited body, and `--verify` then passed: the lock
//     laundered by the gate that set it.
//
// The assertion that matters is BYTE-IDENTITY of the whole repo tree, not the
// exit code: "exit 1" and "wrote nothing" are different claims, and the
// second is the one the bug broke. Every refusal case snapshots every file
// under the fixture root before and after.

import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGateCoverage, runGateEvalsCli, runGatePrd } from "../src/commands/gate.js";
import { runRevise } from "../src/commands/revise.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import { parseCoverageTable, tableJudges } from "../src/lib/engine/gate-coverage.js";
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

const SPEC_REL = "plan/plan-abc123-2026-11-20T09:00-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";
const QUESTIONS = `${WS}/questions.md`;
const FIXED_NOW = () => new Date(2026, 10, 20, 12, 0, 0);
/** Lives outside the fixture tree, so the snapshot never sees it change. */
const TABLE = "table.json";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

interface SeedState {
  stage: string;
  prd: boolean;
  design: boolean;
  plan: boolean;
  /** `gate_verdicts:` entries to seed; omitted → no `gate_verdicts:` key. */
  verdicts?: Partial<Record<"prd" | "design" | "plan", string>>;
}

function seed(s: SeedState, files: { design?: boolean; plan?: boolean } = {}): void {
  const verdicts = s.verdicts ?? {};
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${s.stage}`,
      "gate_status:",
      `  prd_validated: ${s.prd}`,
      `  design_verified: ${s.design}`,
      `  plan_verified: ${s.plan}`,
      "  evals_red: false",
      ...(Object.keys(verdicts).length > 0
        ? [
            "gate_verdicts:",
            ...Object.entries(verdicts).map(([k, v]) => `  ${k}: ${v}`),
          ]
        : []),
      `workstream: ${WS}`,
      "---",
      "",
      "## Status log",
      "",
      "- created.",
      "",
    ].join("\n"),
  );
  repo.write(`${WS}/prd/agent.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
  if (files.design !== false) repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
  if (files.plan === true) repo.write(`${WS}/plan/agent.md`, validPlan());
}

/** Every file under the fixture root, path → bytes. The table the caller
 *  hands in is excluded: it is the caller's input, not the gate's output. */
function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(repo.root, abs);
      if (rel === TABLE) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else out.set(rel, readFileSync(abs, "latin1"));
    }
  };
  walk(repo.root);
  return out;
}

function expectTreeUnchanged(before: Map<string, string>): void {
  const after = snapshot();
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [rel, bytes] of before) expect(after.get(rel), rel).toBe(bytes);
}

function gatePrd() {
  const io = captureIo();
  const code = runGatePrd(["abc123"], {
    ...io,
    projectPath: repo.configPath,
    now: FIXED_NOW,
  });
  return { code, io };
}

function gateCoverage(table: string) {
  repo.write(TABLE, table);
  const io = captureIo();
  const code = runGateCoverage(["abc123"], { table: join(repo.root, TABLE) }, {
    ...io,
    projectPath: repo.configPath,
    now: FIXED_NOW,
  });
  return { code, io };
}

function revise(touched: string): number {
  const io = captureIo();
  return runRevise(["abc123"], { touched }, { ...io, projectPath: repo.configPath });
}

const state = () => readEngineState(repo.read(SPEC_REL));
const refusalOf = (io: ReturnType<typeof captureIo>): string =>
  (io.json() as { refusal?: string }).refusal ?? "";

// ---------------------------------------------------------------------------
// Bug 1 — Gate 1 refuses once it has closed
// ---------------------------------------------------------------------------

describe("devx gate prd — a closed gate refuses and writes nothing", () => {
  it("refuses over an existing `prd:` verdict, leaving the tree byte-identical", () => {
    seed({ stage: "design", prd: true, design: false, plan: false, verdicts: { prd: "CONCERNS" } });
    const before = snapshot();
    const { code, io } = gatePrd();
    expect(code).toBe(1);
    expect((io.json() as { gate: string }).gate).toBe("FAIL");
    expect(refusalOf(io)).toContain("Gate 1 (prd) is closed");
    expectTreeUnchanged(before);
    // The verdict it would have stamped over is still the one on disk.
    expect(state().gateVerdicts.prd).toBe("CONCERNS");
  });

  it("refuses when the spec has no `gate_verdicts:` key — it does not add one", () => {
    seed({ stage: "design", prd: true, design: false, plan: false });
    const before = snapshot();
    expect(gatePrd().code).toBe(1);
    expectTreeUnchanged(before);
    expect(repo.read(SPEC_REL)).not.toContain("gate_verdicts");
  });

  it("refuses a closed gate whose PRD would now FAIL — no FAIL is stamped over a passed gate", () => {
    seed({ stage: "plan", prd: true, design: true, plan: false, verdicts: { prd: "PASS" } });
    repo.write(`${WS}/prd/agent.md`, "# PRD — Demo Feature\n\n## Problem\n\nx.\n");
    const before = snapshot();
    expect(gatePrd().code).toBe(1);
    expectTreeUnchanged(before);
    expect(state().gateVerdicts.prd).toBe("PASS");
  });

  it("refuses before checking inputs: a closed gate with its PRD gone still writes nothing", () => {
    seed({ stage: "design", prd: true, design: false, plan: false, verdicts: { prd: "PASS" } });
    rmSync(join(repo.root, WS, "prd", "agent.md"));
    rmSync(join(repo.root, WS, "expectations.md"));
    const before = snapshot();
    const { code, io } = gatePrd();
    expect(code).toBe(1);
    expect(refusalOf(io)).toContain("Gate 1 (prd) is closed");
    expectTreeUnchanged(before);
  });

  it("does not resolve the gate's open questions.md entries", () => {
    // An open gate FAILs and files its gaps; the flag is then flipped by hand
    // (the shape a pre-fix stray run, or a hand edit, leaves behind). A
    // re-run must not quietly close those entries.
    seed({ stage: "prd", prd: false, design: false, plan: false });
    repo.write(`${WS}/prd/agent.md`, "# PRD — Demo Feature\n\n## Problem\n\nx.\n");
    expect(gatePrd().code).toBe(1);
    expect(repo.read(QUESTIONS)).toContain("Status: open");
    repo.write(SPEC_REL, repo.read(SPEC_REL).replace("prd_validated: false", "prd_validated: true"));
    repo.write(`${WS}/prd/agent.md`, validPrd());
    const before = snapshot();
    expect(gatePrd().code).toBe(1);
    expectTreeUnchanged(before);
    expect(repo.read(QUESTIONS)).not.toContain("Status: resolved");
  });

  it("names the read-only look and the sanctioned re-open in the refusal", () => {
    seed({ stage: "design", prd: true, design: false, plan: false, verdicts: { prd: "PASS" } });
    const { io } = gatePrd();
    const refusal = refusalOf(io);
    expect(refusal).toContain("`devx workstream position abc123`");
    expect(refusal).toContain("`devx revise abc123 --touched prd`");
    expect(refusal).toContain("verdict: PASS");
  });

  it("re-gates normally once `devx revise` re-opens it — the refusal is not a dead end", () => {
    seed({ stage: "design", prd: true, design: false, plan: false, verdicts: { prd: "CONCERNS" } });
    expect(revise("prd")).toBe(0);
    expect(state().gateStatus.prd_validated).toBe(false);
    const { code, io } = gatePrd();
    expect(code).toBe(0);
    expect((io.json() as { gate: string }).gate).toBe("PASS");
    expect(state().gateStatus.prd_validated).toBe(true);
    expect(state().gateVerdicts.prd).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — coverage evaluates only the gate its table judges
// ---------------------------------------------------------------------------

describe("devx gate coverage — never evaluates a gate the table did not judge", () => {
  it("a design table against a closed Gate 2 refuses instead of evaluating Gate 3", () => {
    seed({ stage: "plan", prd: true, design: true, plan: false, verdicts: { prd: "PASS", design: "PASS" } }, { plan: true });
    const before = snapshot();
    const { code, io } = gateCoverage(designTable());
    expect(code).toBe(1);
    const refusal = refusalOf(io);
    expect(refusal).toContain("Gate 2 (design coverage) is closed");
    expect(refusal).toContain("Gate 3 (plan coverage)");
    expect(refusal).toContain("`devx workstream position abc123`");
    expect(refusal).toContain("`devx revise abc123 --touched design`");
    // Nothing: no decisions/ report, no verdict, no queue.
    expectTreeUnchanged(before);
    expect(repo.exists(`${WS}/decisions`)).toBe(false);
    expect(repo.exists(QUESTIONS)).toBe(false);
  });

  it("a plan table while Gate 2 is still open refuses instead of evaluating Gate 2", () => {
    seed({ stage: "design", prd: true, design: false, plan: false }, { plan: true });
    const before = snapshot();
    const { code, io } = gateCoverage(planTable());
    expect(code).toBe(1);
    expect(refusalOf(io)).toContain("Gate 2 (design coverage) is still open");
    expectTreeUnchanged(before);
  });

  it("a design table with both coverage gates closed refuses, naming the read-only look", () => {
    seed({ stage: "red", prd: true, design: true, plan: true }, { plan: true });
    const before = snapshot();
    const { code, io } = gateCoverage(designTable());
    expect(code).toBe(1);
    const refusal = refusalOf(io);
    expect(refusal).toContain("no open coverage gate");
    expect(refusal).toContain("`devx workstream position abc123`");
    expect(refusal).toContain("`devx revise abc123 --touched design`");
    expectTreeUnchanged(before);
  });

  // The property, over every reachable coverage state × both table shapes:
  // the run either refuses with the tree byte-identical, or the mode it
  // evaluated is the mode the table judges. There is no third outcome.
  const STATES: Array<{ name: string; s: SeedState; plan: boolean }> = [
    { name: "design open", s: { stage: "design", prd: true, design: false, plan: false }, plan: false },
    { name: "design open, plan drafted", s: { stage: "design", prd: true, design: false, plan: false }, plan: true },
    { name: "design closed, plan open", s: { stage: "plan", prd: true, design: true, plan: false }, plan: true },
    { name: "design closed, no plan yet", s: { stage: "plan", prd: true, design: true, plan: false }, plan: false },
    { name: "both closed", s: { stage: "red", prd: true, design: true, plan: true }, plan: true },
  ];
  const TABLES = [
    { judges: "design", json: () => designTable() },
    { judges: "plan", json: () => planTable() },
  ] as const;

  for (const st of STATES) {
    for (const t of TABLES) {
      it(`${st.name} × ${t.judges} table → refuses untouched, or evaluates ${t.judges}`, () => {
        seed(st.s, { plan: st.plan });
        const before = snapshot();
        const { code, io } = gateCoverage(t.json());
        // An exit-2 input error prints nothing on stdout; that is still a
        // "did not evaluate" outcome, held to the same byte-identity bar.
        const j = (io.stdout().trim() === "" ? null : io.json()) as { mode?: string } | null;
        if (j !== null && j.mode !== undefined) {
          expect(j.mode).toBe(t.judges);
          expect(code).toBe(0);
        } else {
          expect(code).not.toBe(0);
          expectTreeUnchanged(before);
        }
      });
    }
  }

  it("the matching table still evaluates and advances — the gate itself is unchanged", () => {
    seed({ stage: "plan", prd: true, design: true, plan: false }, { plan: true });
    const { code, io } = gateCoverage(planTable());
    expect(code).toBe(0);
    expect((io.json() as { mode: string }).mode).toBe("plan");
    expect(state().gateStatus.plan_verified).toBe(true);
    expect(state().gateVerdicts.plan).toBe("PASS");
  });

  it("a design table with a stray E-id row is still a design table", () => {
    // Extras were always tolerated (they land in the report); a stray row of
    // the other family must not turn a complete design judgment into a
    // refusal.
    seed({ stage: "design", prd: true, design: false, plan: false });
    const table = JSON.parse(designTable()) as { rows: unknown[] };
    table.rows.push({ id: "E-1", status: "covered", where: "stray" });
    const { code, io } = gateCoverage(JSON.stringify(table));
    expect(code).toBe(0);
    expect((io.json() as { mode: string }).mode).toBe("design");
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — Gate 4 refuses once it has closed
// ---------------------------------------------------------------------------

const RED_REPORT = `${WS}/evals/RED-report.md`;
/** Re-runs happen on a later day than the run that closed the gate, so a
 *  re-written RED report differs by its date even when the runs match. */
const LATER = () => new Date(2026, 10, 27, 9, 0, 0);
/** Same plan with E-2 moved from tests-after to a running tests-first eval. */
const TWO_RUNNING_PLAN = () =>
  validPlan().replace(
    "| E-2 | P1 | 2 | tests-after | test/demo.test.mjs | full |",
    "| E-2 | P1 | 2 | tests-first | test/perf.test.mjs | full |",
  );

interface EvalFlags {
  dryRun?: boolean;
  verify?: boolean;
  waive?: string[];
  reason?: string;
  approver?: string;
}

/** Gates 1–3 closed, Gate 4 open, and the P0's eval authored. */
function seedRed(plan: string = validPlan()): void {
  seed({ stage: "red", prd: true, design: true, plan: true }, { plan: true });
  repo.write(`${WS}/plan/agent.md`, plan);
  repo.write("test/demo.test.mjs", "process.exit(1);\n");
  repo.write("test/perf.test.mjs", "process.exit(1);\n");
}

/** `evalExit` is what the stub runner reports for every eval: 1 is RED (the
 *  feature is missing), 0 is green (the feature has been built). */
function gateEvals(flags: EvalFlags = {}, evalExit = 1, now = LATER) {
  const io = captureIo();
  const code = runGateEvalsCli(["abc123"], flags, {
    ...io,
    projectPath: repo.configPath,
    now,
    exec: () => ({ stdout: "", stderr: "not implemented", exitCode: evalExit }),
  });
  return { code, io };
}

/** Close Gate 4 the legal way: every P0 observed failing, on FIXED_NOW. */
function closeGate4(): void {
  const { code } = gateEvals({}, 1, FIXED_NOW);
  expect(code).toBe(0);
  expect(state().gateStatus.evals_red).toBe(true);
  expect(state().gateVerdicts.evals).toBe("PASS");
  expect(repo.exists(RED_REPORT)).toBe(true);
}

const WAIVE = (ids: string[]): EvalFlags => ({ waive: ids, reason: "flaky", approver: "agent" });

describe("devx gate evals — a closed gate refuses and writes nothing", () => {
  it("refuses a re-run after implementation: no FAIL beside evals_red, and the RED report survives", () => {
    seedRed();
    closeGate4();
    const report = repo.read(RED_REPORT);
    const before = snapshot();
    // The feature now exists, so the P0 passes — the run that used to stamp
    // `evals: FAIL` and rewrite the report with the P0 reading green.
    const { code, io } = gateEvals({}, 0);
    expect(code).toBe(1);
    expect((io.json() as { gate: string }).gate).toBe("FAIL");
    expect(refusalOf(io)).toContain("Gate 4 (evals) is closed");
    expectTreeUnchanged(before);
    expect(repo.read(RED_REPORT)).toBe(report);
    expect(state().gateVerdicts.evals).toBe("PASS");
    expect(state().gateStatus.evals_red).toBe(true);
  });

  it("refuses a would-be PASS re-run too — a closed gate is not re-stamped either way", () => {
    seedRed();
    closeGate4();
    const before = snapshot();
    expect(gateEvals({}, 1).code).toBe(1);
    expectTreeUnchanged(before);
  });

  it("an eval edited to still fail cannot be re-locked: refused, and --verify still reports it moved", () => {
    // Pre-fix this re-run exited 0 and re-stamped the edited body, after
    // which `--verify` PASSed — the softening laundered by the gate itself.
    seedRed();
    closeGate4();
    repo.write("test/demo.test.mjs", "process.exit(1); // assertion weakened, still red\n");
    const before = snapshot();
    expect(gateEvals({}, 1).code).toBe(1);
    expectTreeUnchanged(before);
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(
      (v.io.json() as { findings: { kind: string }[] }).findings.map((f) => f.kind),
    ).toEqual(["moved"]);
  });

  it("refuses --waive over a closed gate — a waiver is recorded once, when the gate closes", () => {
    seedRed(TWO_RUNNING_PLAN());
    closeGate4();
    const before = snapshot();
    const { code, io } = gateEvals(WAIVE(["E-2"]), 1);
    expect(code).toBe(1);
    expect(refusalOf(io)).toContain("A waiver is recorded when the gate closes");
    expectTreeUnchanged(before);
    expect(state().gateVerdicts.evals).toBe("PASS");
  });

  it("refuses to re-gate over a deleted locked eval: no PASS → CONCERNS, the E-id map untouched", () => {
    seedRed(TWO_RUNNING_PLAN());
    closeGate4();
    rmSync(join(repo.root, "test", "perf.test.mjs"));
    const before = snapshot();
    expect(gateEvals({}, 1).code).toBe(1);
    expectTreeUnchanged(before);
    expect(state().gateVerdicts.evals).toBe("PASS");
    expect(state().redEvalIds["E-2"]).toBe("test/perf.test.mjs");
  });

  it("refuses a flag-only close (no `gate_verdicts:` key) and does not add one", () => {
    seedRed();
    repo.write(SPEC_REL, repo.read(SPEC_REL).replace("evals_red: false", "evals_red: true"));
    const before = snapshot();
    expect(gateEvals({}, 0).code).toBe(1);
    expectTreeUnchanged(before);
    expect(repo.read(SPEC_REL)).not.toContain("gate_verdicts");
    expect(repo.exists(RED_REPORT)).toBe(false);
  });

  it("refuses before checking inputs: a closed gate with expectations.md gone still writes nothing", () => {
    seedRed();
    closeGate4();
    rmSync(join(repo.root, WS, "expectations.md"));
    const before = snapshot();
    const { code, io } = gateEvals({}, 0);
    expect(code).toBe(1);
    expect(refusalOf(io)).toContain("Gate 4 (evals) is closed");
    expectTreeUnchanged(before);
  });

  it("does not resolve the gate's open questions.md entries", () => {
    // An open Gate 4 FAILs (its P0 already passes) and files the gap; the
    // flag is then flipped by hand. A re-run must not quietly close the entry.
    seedRed();
    expect(gateEvals({}, 0, FIXED_NOW).code).toBe(1);
    expect(repo.read(QUESTIONS)).toContain("Status: open");
    repo.write(SPEC_REL, repo.read(SPEC_REL).replace("evals_red: false", "evals_red: true"));
    const before = snapshot();
    expect(gateEvals({}, 1).code).toBe(1);
    expectTreeUnchanged(before);
    expect(repo.read(QUESTIONS)).not.toContain("Status: resolved");
  });

  it("names the read-only looks and the sanctioned re-open in the refusal", () => {
    seedRed();
    closeGate4();
    const refusal = refusalOf(gateEvals({}, 0).io);
    expect(refusal).toContain("verdict: PASS");
    expect(refusal).toContain(RED_REPORT);
    expect(refusal).toContain("`devx workstream position abc123`");
    expect(refusal).toContain("`devx gate evals abc123 --verify`");
    expect(refusal).toContain("`devx revise abc123 --touched plan`");
    // Not a waiver refusal, so it does not talk about one.
    expect(refusal).not.toContain("waiver");
  });

  // The property, over every invocation a caller can make against a closed
  // Gate 4 × both eval outcomes: a run that would write refuses with the
  // tree byte-identical; a read-only run answers and is held to the same bar.
  const WRITING: Array<{ name: string; flags: EvalFlags }> = [
    { name: "plain", flags: {} },
    { name: "--waive E-1", flags: WAIVE(["E-1"]) },
    { name: "--waive E-2", flags: WAIVE(["E-2"]) },
    { name: "--waive E-1,E-2", flags: WAIVE(["E-1", "E-2"]) },
  ];
  const READ_ONLY: Array<{ name: string; flags: EvalFlags }> = [
    { name: "--verify", flags: { verify: true } },
    { name: "--dry-run", flags: { dryRun: true } },
    { name: "--dry-run --waive E-1", flags: { dryRun: true, ...WAIVE(["E-1"]) } },
  ];
  for (const evalExit of [1, 0]) {
    const outcome = evalExit === 1 ? "evals still red" : "evals now green";
    for (const inv of WRITING) {
      it(`closed × ${inv.name} × ${outcome} → refuses, tree byte-identical`, () => {
        seedRed(TWO_RUNNING_PLAN());
        closeGate4();
        const before = snapshot();
        const { code, io } = gateEvals(inv.flags, evalExit);
        expect(code).toBe(1);
        expect(refusalOf(io)).toContain("Gate 4 (evals) is closed");
        expectTreeUnchanged(before);
      });
    }
    for (const inv of READ_ONLY) {
      it(`closed × ${inv.name} × ${outcome} → answers (exit 0), tree byte-identical`, () => {
        seedRed(TWO_RUNNING_PLAN());
        closeGate4();
        const before = snapshot();
        expect(gateEvals(inv.flags, evalExit).code).toBe(0);
        expectTreeUnchanged(before);
      });
    }
  }

  it("re-gates normally once `devx revise` re-opens it — the refusal is not a dead end", () => {
    seedRed();
    closeGate4();
    expect(revise("plan")).toBe(0);
    expect(state().gateStatus.evals_red).toBe(false);
    expect(state().gateVerdicts.evals).toBeNull();
    // The replay: Gate 3, then Gate 4, each run on its own open gate.
    expect(gateCoverage(planTable()).code).toBe(0);
    const { code, io } = gateEvals({}, 1);
    expect(code).toBe(0);
    expect((io.json() as { gate: string }).gate).toBe("PASS");
    expect(state().gateStatus.evals_red).toBe(true);
    expect(repo.read(RED_REPORT)).toContain("2026-11-27");
  });

  it("an open gate is unchanged: it evaluates, writes its report, and closes", () => {
    seedRed();
    expect(repo.exists(RED_REPORT)).toBe(false);
    const { code, io } = gateEvals({}, 1);
    expect(code).toBe(0);
    expect((io.json() as { gate: string; report: string }).report).toBe(RED_REPORT);
    expect(state().gateStatus.evals_red).toBe(true);
    expect(state().stage).toBe("executing");
  });
});

describe("tableJudges — which gate a table judges", () => {
  const files = { prd: validPrd(), expectations: validExpectations() };
  const judge = (rows: Array<{ id: string }>) => {
    const parsed = parseCoverageTable(
      JSON.stringify({ rows: rows.map((r) => ({ ...r, status: "covered" })) }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return tableJudges(parsed.table, files);
  };

  it("reads the mode off the source IDs the rows key", () => {
    expect(judge([{ id: "G-1" }, { id: "FR-1" }])).toBe("design");
    expect(judge([{ id: "E-1" }])).toBe("plan");
  });

  it("is null for a table keying both modes, or neither", () => {
    expect(judge([{ id: "G-1" }, { id: "E-1" }])).toBeNull();
    expect(judge([{ id: "G-99" }, { id: "E-99" }])).toBeNull();
    expect(judge([])).toBeNull();
  });

  it("keys rows exactly, as the verdict does — a row it counts is a row the verdict counts", () => {
    // computeCoverageVerdict matches `row.id` verbatim against upper-cased
    // source IDs, so a lower-cased row is an extra there and must be here.
    expect(judge([{ id: "e-1" }])).toBeNull();
  });
});
