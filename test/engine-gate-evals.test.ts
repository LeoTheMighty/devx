// Adversarial tests for `devx gate evals` (v2e101 AC #5): every runnable
// expectation runs via the projects: runner; P0s must be observed RED
// (nonzero exit + captured excerpt); non-RED P0 blocks; deferred stubs are
// legal only for tests-after/human types; RED-report.md written via the
// verdict module; PASS/CONCERNS flips evals_red + stage: executing.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGateEvalsCli } from "../src/commands/gate.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  type ShellExec,
  parsePlanCoverageTable,
  projectRunnersFrom,
  renderRedReport,
  resolveRunner,
  runGateEvals,
} from "../src/lib/engine/gate-evals.js";
import { parseVerdictBlock } from "../src/lib/engine/verdict.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
  validExpectations,
  validPlan,
  validPrd,
} from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// Pure parsers + runner resolution
// ---------------------------------------------------------------------------

describe("parsePlanCoverageTable", () => {
  it("maps E-id → validation type + artifact by header position", () => {
    const rows = parsePlanCoverageTable(validPlan());
    expect(rows).toEqual([
      { eId: "E-1", validationType: "tests-first", artifact: "test/demo.test.mjs" },
      { eId: "E-2", validationType: "tests-after", artifact: "test/demo.test.mjs" },
      { eId: "E-3", validationType: "human", artifact: "evals/E-3_perf.md" },
    ]);
  });

  it("survives reordered columns", () => {
    const plan = [
      "| Validation type | E-id | Eval artifact |",
      "|---|---|---|",
      "| human | E-1 | evals/E-1_x.md |",
    ].join("\n");
    expect(parsePlanCoverageTable(plan)).toEqual([
      { eId: "E-1", validationType: "human", artifact: "evals/E-1_x.md" },
    ]);
  });

  it("returns [] when plan.md has no E-id table", () => {
    expect(parsePlanCoverageTable("# Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")).toEqual([]);
  });

  it("treats unknown validation types as null (defaults to tests-first downstream)", () => {
    const plan = [
      "| E-id | Validation type | Eval artifact |",
      "|---|---|---|",
      "| E-1 | vibes | test/x.ts |",
    ].join("\n");
    expect(parsePlanCoverageTable(plan)[0].validationType).toBeNull();
  });
});

describe("projectRunnersFrom + resolveRunner", () => {
  const merged = {
    projects: [
      { name: "cli", path: ".", test: "npm test --silent" },
      { name: "mobile", path: "mobile", test: "flutter test" },
      { name: "broken", path: 42, test: "x" },
    ],
  };

  it("narrows the projects list, dropping malformed entries", () => {
    const runners = projectRunnersFrom(merged);
    expect(runners.map((r) => r.name)).toEqual(["cli", "mobile"]);
  });

  it("longest path prefix wins; '.' is the fallback", () => {
    const runners = projectRunnersFrom(merged);
    expect(resolveRunner(runners, "mobile/test/a_test.dart")!.name).toBe("mobile");
    expect(resolveRunner(runners, "test/demo.test.ts")!.name).toBe("cli");
  });

  it("returns null when nothing matches", () => {
    expect(resolveRunner([{ name: "m", path: "mobile", test: "t" }], "src/x.ts")).toBeNull();
  });

  it("handles a config with no projects key", () => {
    expect(projectRunnersFrom({ mode: "YOLO" })).toEqual([]);
    expect(projectRunnersFrom(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pure gate over an exec seam
// ---------------------------------------------------------------------------

interface ExecCall {
  command: string;
  cwd: string;
}

function fakeExec(
  exitCode: number,
  output = "AssertionError: tour missing",
): { exec: ShellExec; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  return {
    exec: (command, cwd) => {
      calls.push({ command, cwd });
      return { stdout: "", stderr: output, exitCode };
    },
    calls,
  };
}

function runPure(opts: {
  exitCode?: number;
  expectations?: string;
  plan?: string | null;
  existing?: string[];
  dryRun?: boolean;
}) {
  const { exec, calls } = fakeExec(opts.exitCode ?? 1);
  const existing = new Set(
    (opts.existing ?? ["test/demo.test.mjs", "test/perf.test.mjs"]).map(
      (p) => `/repo/${p}`,
    ),
  );
  const result = runGateEvals({
    repoRoot: "/repo",
    workstreamAbs: "/repo/_devx/workstreams/demo",
    expectations: opts.expectations ?? validExpectations(),
    plan: opts.plan === undefined ? validPlan() : opts.plan,
    runners: [{ name: "cli", path: ".", test: "npm test --" }],
    exec,
    exists: (p) => existing.has(p),
    dryRun: opts.dryRun,
  });
  return { result, calls };
}

describe("runGateEvals — pure gate", () => {
  it("PASS: P0 observed RED, deferred types recorded, excerpt captured", () => {
    const { result, calls } = runPure({});
    expect(result.verdict).toBe("PASS");
    expect(result.runs).toHaveLength(1); // E-1 only; E-2/E-3 deferred by type
    const run = result.runs[0];
    expect(run.eId).toBe("E-1");
    expect(run.command).toBe("npm test -- test/demo.test.mjs");
    expect(run.exitCode).toBe(1);
    expect(run.excerpt).toContain("AssertionError");
    expect(run.redVerdict).toBe("right-reason");
    expect(result.deferred.map((d) => d.redVerdict)).toEqual([
      "not-run (deferred: tests-after)",
      "not-run (deferred: human)",
    ]);
    expect(calls).toHaveLength(1);
  });

  it("non-RED P0 (exit 0) → FAIL with the exact refusal", () => {
    const { result } = runPure({ exitCode: 0 });
    expect(result.verdict).toBe("FAIL");
    const run = result.runs.find((r) => r.eId === "E-1")!;
    expect(run.redVerdict).toBe("not-red");
    expect(run.gap).toContain("expected RED");
    expect(run.gap).toContain("exited 0");
  });

  it("missing P0 artifact → FAIL pointing at /devx red", () => {
    const { result } = runPure({ existing: [] });
    expect(result.verdict).toBe("FAIL");
    const run = result.runs.find((r) => r.eId === "E-1")!;
    expect(run.redVerdict).toBe("not-run (artifact missing)");
    expect(run.gap).toContain("/devx red");
  });

  it("P0 with a deferred validation type → FAIL (P0s must be RED)", () => {
    const plan = validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs | full |",
      "| E-1 | P0 | 1 | tests-after | test/demo.test.mjs | full |",
    );
    const { result } = runPure({ plan });
    expect(result.verdict).toBe("FAIL");
    const d = result.deferred.find((r) => r.eId === "E-1")!;
    expect(d.gap).toContain("must be observed RED");
  });

  it("P0 with an eval-spec (.md) artifact → FAIL (no capturable exit)", () => {
    const plan = validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs | full |",
      "| E-1 | P0 | 1 | tests-first | evals/E-1_x.md | full |",
    );
    const { result } = runPure({
      plan,
      existing: ["_devx/workstreams/demo/evals/E-1_x.md", "test/perf.test.mjs"],
    });
    expect(result.verdict).toBe("FAIL");
    const run = result.runs.find((r) => r.eId === "E-1")!;
    expect(run.redVerdict).toBe("not-run (eval-spec)");
    expect(run.gap).toContain("nonzero exit");
  });

  it("P1+ gaps are CONCERNS, never a block", () => {
    // No plan table → every row tests-first. E-1 (P0) RED ok. E-2/E-3
    // artifacts missing → P1/P2 gaps → CONCERNS.
    const { result } = runPure({
      plan: null,
      existing: ["test/demo.test.mjs"],
    });
    expect(result.verdict).toBe("CONCERNS");
    expect(result.reasons.join(" ")).toContain("E-3");
  });

  it("no matching runner → gap (blocking only for P0)", () => {
    const { exec } = fakeExec(1);
    const result = runGateEvals({
      repoRoot: "/repo",
      workstreamAbs: "/repo/_devx/workstreams/demo",
      expectations: validExpectations(),
      plan: validPlan(),
      runners: [{ name: "mobile", path: "mobile", test: "flutter test" }],
      exec,
      exists: () => true,
    });
    expect(result.verdict).toBe("FAIL"); // E-1 is P0 with no runner
    expect(result.reasons.join(" ")).toContain("no `projects:` runner");
  });

  it("dry-run resolves commands but never execs", () => {
    const { result, calls } = runPure({ dryRun: true });
    expect(calls).toHaveLength(0);
    expect(result.runs[0].command).toBe("npm test -- test/demo.test.mjs");
    expect(result.runs[0].exitCode).toBeNull();
  });

  it("zero E-blocks → FAIL, never a vacuous PASS (self-review finding)", () => {
    const { result } = runPure({ expectations: "# Expectations\n\nnothing here\n" });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join(" ")).toContain("no E-blocks");
  });

  it("empty runner output renders the no-output sentinel, not a blank quote", () => {
    const { exec } = fakeExec(1, "");
    const result = runGateEvals({
      repoRoot: "/repo",
      workstreamAbs: "/repo/_devx/workstreams/demo",
      expectations: validExpectations(),
      plan: validPlan(),
      runners: [{ name: "cli", path: ".", test: "npm test --" }],
      exec,
      exists: () => true,
    });
    const report = renderRedReport({
      workstreamRel: "_devx/workstreams/demo",
      date: "2026-07-05",
      result,
    });
    expect(report).toContain("(no output captured)");
  });

  it("plan artifact column refines the Verified-by target", () => {
    const plan = validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs | full |",
      "| E-1 | P0 | 1 | tests-first | test/pinned.test.mjs | full |",
    );
    const { result } = runPure({
      plan,
      existing: ["test/pinned.test.mjs", "test/perf.test.mjs"],
    });
    expect(result.runs[0].artifact).toBe("test/pinned.test.mjs");
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

function seed(flags: { plan_verified?: boolean; prd_validated?: boolean } = {}): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      "stage: red",
      "gate_status:",
      `  prd_validated: ${flags.prd_validated ?? true}`,
      "  design_verified: true",
      `  plan_verified: ${flags.plan_verified ?? true}`,
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
  repo.write(`${WS}/design.md`, "## Design\n");
  repo.write(`${WS}/plan.md`, validPlan());
  repo.write("test/demo.test.mjs", 'process.exit(1);\n');
  repo.write("test/perf.test.mjs", 'process.exit(1);\n');
}

function gateEvals(flags: { dryRun?: boolean } = {}, exitCode = 1) {
  const io = captureIo();
  const calls: ExecCall[] = [];
  const code = runGateEvalsCli(["abc123"], flags, {
    ...io,
    projectPath: repo.configPath,
    now: () => new Date(2026, 6, 5, 13, 0, 0),
    exec: (command, cwd) => {
      calls.push({ command, cwd });
      return { stdout: "", stderr: "Error: tour missing (not implemented)", exitCode };
    },
  });
  return { code, io, calls };
}

describe("devx gate evals — CLI driver", () => {
  it("PASS: writes RED-report.md + flips evals_red + stage: executing", () => {
    seed();
    const { code, io } = gateEvals();
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.gate).toBe("PASS");
    expect(j.report).toBe(`${WS}/evals/RED-report.md`);

    const report = repo.read(`${WS}/evals/RED-report.md`);
    const verdict = parseVerdictBlock(report);
    expect(verdict!.block.gate).toBe("PASS");
    expect(verdict!.block.reviewer).toBe("devx gate evals");
    expect(report).toContain("### E-1: tour renders (P0)");
    expect(report).toContain("- **Exit code**: 1");
    expect(report).toContain("tour missing");
    expect(report).toContain("## Deferred stubs");
    expect(report).toContain("E-2: not-run (deferred: tests-after)");

    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.evals_red).toBe(true);
    expect(state.stage).toBe("executing");
  });

  it("non-RED P0 → exit 1, report records FAIL, frontmatter untouched", () => {
    seed();
    const specBefore = repo.read(SPEC_REL);
    const { code, io } = gateEvals({}, 0);
    expect(code).toBe(1);
    expect((io.json() as { gate: string }).gate).toBe("FAIL");
    const report = repo.read(`${WS}/evals/RED-report.md`);
    expect(parseVerdictBlock(report)!.block.gate).toBe("FAIL");
    expect(repo.read(SPEC_REL)).toBe(specBefore);
  });

  it("refuses (exit 1) when Gate 3 has not passed, naming the open gate", () => {
    seed({ plan_verified: false });
    const { code, io, calls } = gateEvals();
    expect(code).toBe(1);
    expect((io.json() as { refusal: string }).refusal).toContain("Gate 3");
    expect(calls).toHaveLength(0);
    expect(repo.exists(`${WS}/evals/RED-report.md`)).toBe(false);
  });

  it("--dry-run: prints the plan, runs nothing, writes nothing", () => {
    seed();
    const { code, io, calls } = gateEvals({ dryRun: true });
    expect(code).toBe(0);
    const j = io.json() as {
      dryRun: boolean;
      planned: Array<{ eId: string; command: string }>;
      deferred: Array<{ eId: string }>;
    };
    expect(j.dryRun).toBe(true);
    expect(j.planned[0].eId).toBe("E-1");
    expect(j.deferred.map((d) => d.eId)).toEqual(["E-2", "E-3"]);
    expect(calls).toHaveLength(0);
    expect(repo.exists(`${WS}/evals/RED-report.md`)).toBe(false);
    expect(readEngineState(repo.read(SPEC_REL)).gateStatus.evals_red).toBe(false);
  });

  it("runs the configured projects: test command from the project cwd", () => {
    seed();
    const { calls } = gateEvals();
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toContain("test/demo.test.mjs");
    expect(calls[0].cwd).toBe(repo.root);
  });

  it("unknown hash → exit 2", () => {
    const io = captureIo();
    const code = runGateEvalsCli(["zz9999"], {}, { ...io, projectPath: repo.configPath });
    expect(code).toBe(2);
  });

  it("wrong argc → exit 2 with usage", () => {
    const io = captureIo();
    const code = runGateEvalsCli([], {}, { ...io, projectPath: repo.configPath });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("usage:");
  });
});
