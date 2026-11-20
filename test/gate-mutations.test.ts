// Mutation benchmark for the four gates — "a gate that passes a mutant is a
// broken gate" (upstream FUTURE.md §B.2; row C29 of
// docs/updates/8am-harness-gap-analysis.md).
//
// Every other gate test asserts that a GOOD artifact passes. This file
// asserts the other half, which is the half a gate exists for: take a
// known-passing fixture, break exactly one thing a gate claims to protect,
// and require the gate to stop. Nothing else in the suite proves that the
// checks are load-bearing rather than decorative — a gate whose predicate
// was accidentally inverted, or whose regex silently stopped matching, still
// passes every happy-path test it has.
//
// This is cheap in devx precisely because the gates are pure, exit-coded
// functions over files (v2/02-engine.md §1, §8) rather than a skill reading
// a checklist.
//
// Two rules the cases are written to:
//
//   1. **A negative control runs first.** The unmutated fixture must PASS
//      every gate. Without it, a fixture that broke for an unrelated reason
//      would make every mutation "caught" and the file would pass by
//      accident, forever.
//   2. **"Did not pass" is the assertion, not "FAILed".** A mutation can land
//      as an evaluated FAIL (exit 1) or as a refusal (exit 2 — invalid input
//      from the judgment layer). Both are the gate stopping. Requiring one
//      specific code would couple the benchmark to which side of that line a
//      check happens to sit on, and the distinction is documented per case
//      instead.
//
// Each case also asserts the gate wrote NO flag flip: a gate that reports a
// failure and advances anyway is the same defect wearing a verdict.

import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runGateCoverage, runGateEvalsCli, runGatePrd } from "../src/commands/gate.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
  planTable,
  validExpectations,
  validPlan,
  validPrd,
} from "./fixtures/engine-repo.js";

const SPEC_REL = "plan/plan-abc123-2026-11-20T09:00-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";
const FIXED_NOW = () => new Date(2026, 10, 20, 12, 0, 0);

/** Which gate a case exercises, and the stage/flags that leave it open. */
type Which = "prd" | "plan-coverage" | "evals";

const OPEN_STATE: Record<Which, { stage: string; prd: boolean; design: boolean; plan: boolean }> = {
  prd: { stage: "prd", prd: false, design: false, plan: false },
  "plan-coverage": { stage: "plan", prd: true, design: true, plan: false },
  evals: { stage: "red", prd: true, design: true, plan: true },
};

interface Mutation {
  /** PRD body. */
  prd?: (s: string) => string;
  /** expectations.md body. */
  expectations?: (s: string) => string;
  /** plan/agent.md body. */
  plan?: (s: string) => string;
  /** The judgment table `--table` is handed (plan mode). */
  table?: string;
  /** Exit code of the E-1 (P0) runner. Default 1 = RED, as Gate 4 demands. */
  p0Exit?: number;
  /** Drop E-1's artifact from disk. */
  dropP0Artifact?: boolean;
}

function seed(which: Which, m: Mutation): EngineRepo {
  const repo = makeEngineRepo();
  const s = OPEN_STATE[which];
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
      `workstream: ${WS}`,
      "---",
      "",
      "body",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd/agent.md`, (m.prd ?? ((x) => x))(validPrd()));
  repo.write(`${WS}/expectations.md`, (m.expectations ?? ((x) => x))(validExpectations()));
  repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
  repo.write(`${WS}/plan/agent.md`, (m.plan ?? ((x) => x))(validPlan()));
  if (m.dropP0Artifact !== true) repo.write("test/demo.test.mjs", "process.exit(1);\n");
  repo.write("test/perf.test.mjs", "process.exit(1);\n");
  if (which === "plan-coverage") repo.write("table.json", m.table ?? planTable());
  return repo;
}

interface GateRun {
  code: number;
  stdout: string;
  stderr: string;
  /** gate_status after the run — a stopped gate must not have advanced. */
  flags: ReturnType<typeof readEngineState>["gateStatus"];
  stage: string | null;
}

function run(which: Which, m: Mutation = {}): GateRun {
  const repo = seed(which, m);
  try {
    const io = captureIo();
    const common = { ...io, projectPath: repo.configPath, now: FIXED_NOW };
    let code: number;
    if (which === "prd") {
      code = runGatePrd(["abc123"], common);
    } else if (which === "plan-coverage") {
      code = runGateCoverage(["abc123"], { table: join(repo.root, "table.json") }, common);
    } else {
      // Gate 4 runs the `Verified by:` targets through the project's runner.
      // The seam decides each one's exit code: E-1 (P0) is RED by default,
      // and `p0Exit: 0` is the "green P0 eval" mutant.
      code = runGateEvalsCli(["abc123"], {}, {
        ...common,
        // `ShellExec` is (command, cwd) — one shell string, not argv.
        exec: (command: string) => {
          const isP0 = command.includes("demo.test.mjs");
          const exitCode = isP0 ? (m.p0Exit ?? 1) : 1;
          return {
            stdout: "",
            stderr: exitCode === 0 ? "" : "Error: not implemented",
            exitCode,
          };
        },
      });
    }
    const state = readEngineState(repo.read(SPEC_REL));
    return {
      code,
      stdout: io.stdout(),
      stderr: io.stderr(),
      flags: state.gateStatus,
      stage: state.stage,
    };
  } finally {
    repo.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Rule 1 — the negative control
// ---------------------------------------------------------------------------

describe("negative control — the unmutated fixture passes every gate", () => {
  it("Gate 1 passes and advances", () => {
    const r = run("prd");
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.flags.prd_validated).toBe(true);
  });

  it("Gate 3 (plan mode) passes and advances", () => {
    const r = run("plan-coverage");
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.flags.plan_verified).toBe(true);
  });

  it("Gate 4 passes with every P0 observed RED", () => {
    const r = run("evals");
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.flags.evals_red).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — one mutant per protected claim
// ---------------------------------------------------------------------------

interface Case {
  name: string;
  which: Which;
  mutate: Mutation;
  /** The flag that must stay false. */
  flag: "prd_validated" | "plan_verified" | "evals_red";
  /** Substring the gap report must name, so a stop for the RIGHT reason is
   *  what passes. A gate that stopped for an unrelated reason would
   *  otherwise count as catching the mutant. */
  because: string;
}

const CASES: Case[] = [
  {
    // The gap analysis's "a dropped `Covers:`" mutant.
    name: "a P0 expectation loses its `Covers:` line",
    which: "prd",
    mutate: { expectations: (s) => s.replace("- **Covers:** `G-1, UC-1, FR-1`\n", "") },
    flag: "prd_validated",
    because: "E-1 has no Covers",
  },
  {
    // "A deleted P0 row", in its bluntest form: the whole block goes. Caught
    // by the ≥`engine.expectations_min` floor, which fires before ID
    // resolution — so this mutant exercises the FLOOR, and the one below
    // isolates the bidirectional ID check that the floor masks here.
    name: "the P0 expectation block is deleted outright",
    which: "prd",
    mutate: {
      expectations: (s) =>
        s.slice(0, s.indexOf("## E-1:")) + s.slice(s.indexOf("## E-2:")),
    },
    flag: "prd_validated",
    because: "expectations-too-few",
  },
  {
    // The same loss with the count floor SATISFIED: every block stays, but
    // G-1's two covering expectations (E-1 and E-3) both stop naming it.
    // Nothing but the backward ID resolution can catch this, which is why
    // the mutant leaves every other check happy — a mutant a second check
    // also catches proves nothing about the first.
    //
    // It must re-point BOTH. An earlier draft moved only E-1 and the gate
    // correctly PASSED, because E-3 still covered G-1: a mutant that does
    // not actually break the claim is a false alarm about the gate, and the
    // "names the right reason" assertion is what caught it.
    name: "both of a goal's covering expectations are re-pointed",
    which: "prd",
    mutate: {
      expectations: (s) =>
        s
          .replace("`G-1, UC-1, FR-1`", "`G-2, UC-1, FR-1`")
          .replace("- **Covers:** G-1\n", "- **Covers:** G-2\n"),
    },
    flag: "prd_validated",
    because: "G-1",
  },
  {
    name: "a `Covers:` id the PRD does not define",
    which: "prd",
    mutate: { expectations: (s) => s.replace("G-1, UC-1, FR-1", "G-1, UC-1, FR-99") },
    flag: "prd_validated",
    because: "FR-99",
  },
  {
    name: "a goal nothing covers",
    which: "prd",
    mutate: {
      prd: (s) =>
        s.replace(
          "- **G-2**: zero silent scope-creep incidents per month",
          "- **G-2**: zero silent scope-creep incidents per month\n- **G-3**: review cost under $5 per PR",
        ),
    },
    flag: "prd_validated",
    because: "G-3",
  },
  {
    name: "the P0's EARS expectation softened into prose",
    which: "prd",
    mutate: {
      expectations: (s) =>
        s.replace(
          "When a PR is opened, the system SHALL attach a tour.",
          "Tours should generally be attached to pull requests.",
        ),
    },
    flag: "prd_validated",
    because: "E-1",
  },
  {
    name: "the P0 names no runnable verification target",
    which: "prd",
    mutate: {
      expectations: (s) =>
        s.replace(
          "- **Verified by:** test/demo.test.mjs\n\n## E-2",
          "- **Verified by:** TBD\n\n## E-2",
        ),
    },
    flag: "prd_validated",
    because: "E-1",
  },
  {
    // The P0 floor, plan mode: 100% or nothing. `partial` is the softest
    // possible downgrade and must still stop the gate.
    name: "the P0's coverage row is downgraded to partial",
    which: "plan-coverage",
    mutate: { table: planTable({ "E-1": { status: "partial" } }) },
    flag: "plan_verified",
    because: "P0 floor unmet",
  },
  {
    name: "the P0's coverage row names no eval artifact",
    which: "plan-coverage",
    mutate: { table: planTable({ "E-1": { artifact: null } }) },
    flag: "plan_verified",
    because: "P0 floor unmet",
  },
  {
    // The literal "deleted P0 row". It lands as a REFUSAL (exit 2), not an
    // evaluated FAIL: the judgment table is the gate's input, so an absent
    // row is incomplete input rather than a verdict about coverage. Either
    // way the gate does not pass — which is the property that matters.
    name: "the P0's row is deleted from the coverage table",
    which: "plan-coverage",
    mutate: {
      table: JSON.stringify({
        rows: JSON.parse(planTable()).rows.filter((r: { id: string }) => r.id !== "E-1"),
      }),
    },
    flag: "plan_verified",
    because: "E-1",
  },
  {
    // "A green P0 eval" — the mutant the whole RED gate exists to stop. If
    // you did not watch it fail, you do not know it tests the right thing.
    name: "the P0 eval runs GREEN at the RED gate",
    which: "evals",
    mutate: { p0Exit: 0 },
    flag: "evals_red",
    because: "E-1",
  },
  {
    name: "the P0's eval artifact is missing from disk",
    which: "evals",
    mutate: { dropP0Artifact: true },
    flag: "evals_red",
    because: "E-1",
  },
];

describe.each(CASES)("mutant: $name", (c) => {
  const r = run(c.which, c.mutate);

  it("the gate does not pass", () => {
    expect(r.code, `gate passed the mutant\n${r.stdout}${r.stderr}`).not.toBe(0);
  });

  it("and does not flip its flag", () => {
    // A gate that reports the gap and advances anyway is the same defect.
    expect(r.flags[c.flag]).toBe(false);
  });

  it("and names the right reason", () => {
    expect(r.stdout + r.stderr).toContain(c.because);
  });
});

describe("the benchmark is honest", () => {
  it("covers all three mechanically-mutable gates", () => {
    // A suite that drifted to one gate would still report every case green.
    const covered = new Set(CASES.map((c) => c.which));
    expect([...covered].sort()).toEqual(["evals", "plan-coverage", "prd"]);
  });

  it("has at least one case per gate", () => {
    for (const which of ["prd", "plan-coverage", "evals"] as const) {
      expect(CASES.filter((c) => c.which === which).length).toBeGreaterThan(0);
    }
  });
});
