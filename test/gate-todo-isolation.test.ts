// E-2 permanent suite (hfi101): gates are firewalled from todo.md.
// (a) Static read-surface scan — 0 references to the todo surface in the
// gate implementation modules (src/commands/gate.ts + the three pure
// evaluators); the firewall is total, not "reads but ignores".
// (b) Byte-identity — each gate's full observable verdict (exit code,
// stdout JSON, stderr, spec bytes after the run, report artifact) is
// identical across 4 todo.md fixtures: present (in-flight, mixed) /
// absent / fully checked / fully unchecked. Runs against today's gates so
// the invariant is provable before hfi102 touches gate.ts; the static
// scan keeps it pinned afterward.
// Eval: _devx/workstreams/harness-fold-in/evals/E-2_gate-todo-isolation.ts
// Spec: dev/dev-hfi101-2026-07-24T10:41-todo-core.md

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  runGateCoverage,
  runGateEvalsCli,
  runGatePrd,
} from "../src/commands/gate.js";
import { formatDate } from "../src/lib/engine/verdict.js";
import {
  type EngineRepo,
  REAL_REPO_ROOT,
  captureIo,
  designTable,
  makeEngineRepo,
  validExpectations,
  validPlan,
  validPrd,
} from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// (a) Static read-surface scan
// ---------------------------------------------------------------------------

const GATE_MODULES = [
  "src/commands/gate.ts",
  "src/lib/engine/gate-prd.ts",
  "src/lib/engine/gate-coverage.ts",
  "src/lib/engine/gate-evals.ts",
];

// Mirrors the breach regex in evals/E-2_gate-todo-isolation.ts: any mention
// of the todo file or the todo engine module inside gate code is a breach.
const BREACH_RE =
  /todo\.md|engine\/todo(?:\.js|\.ts)?|parseTodo|currentFocus|computeTodoDrift|trueDerivedLines/;

describe("gate ↔ todo firewall — static read-surface scan", () => {
  for (const rel of GATE_MODULES) {
    it(`${rel} has 0 references to the todo surface`, () => {
      const lines = readFileSync(
        join(REAL_REPO_ROOT, ...rel.split("/")),
        "utf8",
      ).split("\n");
      const breaches = lines
        .map((line, i) => (BREACH_RE.test(line) ? `${rel}:${i + 1}: ${line.trim()}` : null))
        .filter((b): b is string => b !== null);
      expect(breaches).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// (b) 4-fixture byte-identity
// ---------------------------------------------------------------------------

const SPEC_REL = "plan/plan-abc123-2026-07-24T10:41-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";
const FIXED_NOW = () => new Date(2026, 6, 24, 12, 0, 0);

function shippedTemplate(): string {
  return readFileSync(
    join(REAL_REPO_ROOT, "_devx", "templates", "engine", "todo.md"),
    "utf8",
  );
}

/** Realistic mid-flight file: stages checked through Design + a free item. */
function inFlightTodo(): string {
  return shippedTemplate()
    .replace("- [ ] Stage: PRD", "- [x] Stage: PRD")
    .replace("- [ ] Gate: prd", "- [x] Gate: prd")
    .replace(
      "- [ ] Stage: Design",
      "- [x] Stage: Design\n  - [ ] free-nested skill note — sync never touches this",
    );
}

const TODO_FIXTURES: Array<{ name: string; todo: string | null }> = [
  { name: "present (in-flight)", todo: inFlightTodo() },
  { name: "absent", todo: null },
  { name: "fully checked", todo: shippedTemplate().replaceAll("- [ ]", "- [x]") },
  { name: "fully unchecked", todo: shippedTemplate() },
];

interface GateTrace {
  code: number;
  stdout: string;
  stderr: string;
  spec: string;
  report: string | null;
}

function seedRepo(flags: {
  stage: string;
  prd_validated: boolean;
  design_verified: boolean;
  plan_verified: boolean;
  todo: string | null;
}): EngineRepo {
  const repo = makeEngineRepo();
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${flags.stage}`,
      "gate_status:",
      `  prd_validated: ${flags.prd_validated}`,
      `  design_verified: ${flags.design_verified}`,
      `  plan_verified: ${flags.plan_verified}`,
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
  if (flags.todo !== null) repo.write(`${WS}/todo.md`, flags.todo);
  return repo;
}

/**
 * Run one gate in a fresh repo seeded with the given todo fixture and
 * capture everything an observer could see. Every trace field is
 * repo-root-free (gates emit rel paths only), so traces from different
 * mkdtemp roots compare byte-for-byte.
 */
function traceGate(
  gate: "prd" | "coverage" | "evals",
  todo: string | null,
): GateTrace {
  const repo = seedRepo({
    stage: gate === "prd" ? "prd" : gate === "coverage" ? "design" : "red",
    prd_validated: gate !== "prd",
    design_verified: gate === "evals",
    plan_verified: gate === "evals",
    todo,
  });
  try {
    const io = captureIo();
    const common = { ...io, projectPath: repo.configPath, now: FIXED_NOW };
    let code: number;
    let report: string | null = null;
    if (gate === "prd") {
      code = runGatePrd(["abc123"], common);
    } else if (gate === "coverage") {
      repo.write(`${WS}/design.md`, "## Design\n\nreal.\n");
      repo.write("table.json", designTable());
      code = runGateCoverage(
        ["abc123"],
        { table: join(repo.root, "table.json") },
        common,
      );
      report = repo.read(
        `${WS}/decisions/${formatDate(FIXED_NOW())}-design-verify.md`,
      );
    } else {
      repo.write(`${WS}/design.md`, "## Design\n");
      repo.write(`${WS}/plan.md`, validPlan());
      repo.write("test/demo.test.mjs", "process.exit(1);\n");
      repo.write("test/perf.test.mjs", "process.exit(1);\n");
      code = runGateEvalsCli(["abc123"], {}, {
        ...common,
        exec: () => ({
          stdout: "",
          stderr: "Error: tour missing (not implemented)",
          exitCode: 1,
        }),
      });
      report = repo.read(`${WS}/evals/RED-report.md`);
    }
    // The gate must never write the todo file either.
    if (todo !== null) expect(repo.read(`${WS}/todo.md`)).toBe(todo);
    else expect(repo.exists(`${WS}/todo.md`)).toBe(false);
    return {
      code,
      stdout: io.stdout(),
      stderr: io.stderr(),
      spec: repo.read(SPEC_REL),
      report,
    };
  } finally {
    repo.cleanup();
  }
}

describe.each(["prd", "coverage", "evals"] as const)(
  "devx gate %s — verdict is byte-identical across todo fixtures",
  (gate) => {
    const baseline = traceGate(gate, TODO_FIXTURES[0].todo);

    it("baseline fixture actually passes the gate (exit 0)", () => {
      expect(baseline.code).toBe(0);
      expect(baseline.stdout).toContain('"PASS"');
    });

    it.each(TODO_FIXTURES.slice(1).map((f) => [f.name, f.todo] as const))(
      "todo %s → identical exit code, stdout, stderr, spec, report",
      (_name, todo) => {
        const trace = traceGate(gate, todo);
        expect(trace.code).toBe(baseline.code);
        expect(trace.stdout).toBe(baseline.stdout);
        expect(trace.stderr).toBe(baseline.stderr);
        expect(trace.spec).toBe(baseline.spec);
        expect(trace.report).toBe(baseline.report);
      },
    );
  },
);
