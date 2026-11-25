// Gate 4's reason check, pure half (D-19). The CLI half — real processes,
// a mkdtemp workstream, byte-identity — is gate-evals-red-reason-cli.test.ts.
//
// Every structured report below is REAL output, captured from vitest 3 and
// pytest 9 on purpose-built files (assert fails, module fails to import, file
// has no tests, every test skipped, the body throws, fixture setup raises,
// fixture missing), then scrubbed of host and path. Hand-written XML would
// have tested the parser against what its author believed the runners emit;
// the vitest JUnit case below is the reason that is not good enough — vitest
// reports a module that failed to import as a `<failure>`, which a parser
// written from the JUnit spec would count as a test that failed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type ShellExec, projectRunnersFrom, runGateEvals } from "../src/lib/engine/gate-evals.js";
import {
  type RedContract,
  classifyRed,
  parseJestJson,
  parseJunit,
  redContractFrom,
  shellFailure,
} from "../src/lib/engine/red-reason.js";
import { REAL_REPO_ROOT, validExpectations, validPlan } from "./fixtures/engine-repo.js";

const REPORTS = join(REAL_REPO_ROOT, "test", "fixtures", "red-reports");
const report = (name: string): string => readFileSync(join(REPORTS, name), "utf8");

const JUNIT: RedContract = { command: null, report: "junit", args: null, failedExit: null };
const JEST: RedContract = { command: null, report: "jest-json", args: null, failedExit: null };
const EXIT1: RedContract = { command: null, report: null, args: null, failedExit: [1] };

function classify(exitCode: number, contract: RedContract | null, reportText?: string | null) {
  return classifyRed({ exitCode, contract, reportText, runnerName: "r" });
}

// ---------------------------------------------------------------------------
// Parsers over real output
// ---------------------------------------------------------------------------

describe("parseJunit — real pytest 9 output", () => {
  it("an assertion failure is a failed case; its neighbour passed", () => {
    const t = parseJunit(report("pytest-junit-assert.xml"))!;
    expect([t.failed, t.passed, t.errored, t.skipped]).toEqual([1, 1, 0, 0]);
    expect(t.cases.find((c) => c.status === "failed")!.id).toBe("test_assert > test_add");
  });

  it("a module-level import error is a COLLECTION error, never a failed test", () => {
    const t = parseJunit(report("pytest-junit-importfail.xml"))!;
    expect([t.failed, t.errored]).toEqual([0, 1]);
    expect(t.cases[0].message).toBe("collection failure");
  });

  it("a fixture that raises (a DB that is not running) is a SETUP error", () => {
    const t = parseJunit(report("pytest-junit-fixture.xml"))!;
    expect([t.failed, t.errored]).toEqual([0, 1]);
    expect(t.cases[0].message).toContain("db not running");
  });

  it("a missing fixture is a setup error too", () => {
    const t = parseJunit(report("pytest-junit-nofixture.xml"))!;
    expect([t.failed, t.errored]).toEqual([0, 1]);
  });

  it("an empty module is zero cases; all-skipped is skipped", () => {
    expect(parseJunit(report("pytest-junit-empty.xml"))!.cases).toEqual([]);
    const s = parseJunit(report("pytest-junit-skip.xml"))!;
    expect([s.skipped, s.failed, s.passed]).toEqual([1, 0, 0]);
  });

  it("a NameError inside the test body reads as a failed test — the limit D-19 records", () => {
    const t = parseJunit(report("pytest-junit-throws.xml"))!;
    expect([t.failed, t.errored]).toEqual([1, 0]);
    expect(t.cases[0].message).toContain("NameError");
  });
});

describe("parseJunit — real vitest 3 output", () => {
  it("an assertion failure is a failed case", () => {
    const t = parseJunit(report("vitest-junit-assert.xml"))!;
    expect([t.failed, t.passed]).toEqual([1, 1]);
    expect(t.cases[0].message).toContain("expected 2 to be 3");
  });

  it("an import failure arrives as <failure> on a file-named case — read as errored, not failed", () => {
    const xml = report("vitest-junit-importfail.xml");
    expect(xml).toContain("<failure"); // the trap, as vitest writes it
    const t = parseJunit(xml)!;
    expect([t.failed, t.errored]).toEqual([0, 1]);
    expect(t.cases[0].message).toContain("Failed to load url");
  });

  it("'No test suite found' is the same synthetic case — errored", () => {
    const t = parseJunit(report("vitest-junit-empty.xml"))!;
    expect([t.failed, t.errored]).toEqual([0, 1]);
  });

  it("a skipped test is skipped", () => {
    expect(parseJunit(report("vitest-junit-skip.xml"))!.skipped).toBe(1);
  });
});

describe("parseJestJson — real vitest 3 --reporter=json output", () => {
  it("assertion failure: one failed, one passed", () => {
    const t = parseJestJson(report("vitest-json-assert.json"))!;
    expect([t.failed, t.passed, t.errored]).toEqual([1, 1, 0]);
  });

  it("import failure: no assertion results, a file message — one errored case", () => {
    const t = parseJestJson(report("vitest-json-importfail.json"))!;
    expect([t.failed, t.errored]).toEqual([0, 1]);
    expect(t.cases[0].message).toContain("Failed to load url");
  });

  it("empty file: errored; skipped: skipped; green: passed", () => {
    expect(parseJestJson(report("vitest-json-empty.json"))!.errored).toBe(1);
    expect(parseJestJson(report("vitest-json-skip.json"))!.skipped).toBe(1);
    expect(parseJestJson(report("vitest-json-pass.json"))!.passed).toBe(1);
  });

  it("non-JSON and non-jest JSON are not reports", () => {
    expect(parseJestJson("not json")).toBeNull();
    expect(parseJestJson('{"tests": 3}')).toBeNull();
  });
});

describe("parseJunit — structure the real samples do not exercise", () => {
  it("self-closing cases pass; CDATA and comments cannot fake a failure", () => {
    const t = parseJunit(
      [
        "<testsuites><testsuite>",
        '<testcase classname="a" name="one"/>',
        '<testcase classname="a" name="two"><system-out><![CDATA[<failure message="x">]]></system-out></testcase>',
        '<!-- <testcase name="ghost"><failure/></testcase> -->',
        "</testsuite></testsuites>",
      ].join(""),
    )!;
    expect([t.passed, t.failed, t.cases.length]).toEqual([2, 0, 2]);
  });

  it("an unescaped `>` inside an attribute does not end the tag early", () => {
    const t = parseJunit(
      '<testsuite><testcase classname="m" name="gt"><failure message="assert 2 > 3"/></testcase></testsuite>',
    )!;
    expect(t.failed).toBe(1);
    expect(t.cases[0].message).toBe("assert 2 > 3");
  });

  it("a suite-level <error> with no case is an errored suite", () => {
    const t = parseJunit('<testsuite><error message="boom"/></testsuite>')!;
    expect([t.errored, t.failed]).toEqual([1, 0]);
  });

  it("a real case is not mistaken for vitest's file-level case unless both names are one path", () => {
    const t = parseJunit(
      '<testsuite><testcase classname="suite adds" name="suite adds"><failure message="no"/></testcase></testsuite>',
    )!;
    expect(t.failed).toBe(1); // jest-junit's default templates repeat the title: still a test
  });

  it("text that is not JUnit at all is not a report", () => {
    expect(parseJunit("PASS 3 tests")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyRed
// ---------------------------------------------------------------------------

describe("classifyRed — the shell rule holds for every runner, declared or not", () => {
  for (const exit of [126, 127, 130, 137, 255]) {
    for (const [label, c] of [
      ["undeclared", null],
      ["exit contract", EXIT1],
      ["junit", JUNIT],
    ] as const) {
      it(`exit ${exit} × ${label} → could not run`, () => {
        const r = classify(exit, c, report("pytest-junit-assert.xml"));
        expect(r.kind).toBe("wrong");
        expect(r.kind === "wrong" && r.wrong).toBe("could not run");
      });
    }
  }

  it("shellFailure leaves ordinary runner codes alone", () => {
    for (const exit of [1, 2, 3, 4, 5, 101, 125]) expect(shellFailure(exit)).toBeNull();
  });
});

describe("classifyRed — a declared report is counted by the gate", () => {
  const cases: [string, string, RedContract, string | null][] = [
    ["pytest assertion", "pytest-junit-assert.xml", JUNIT, null],
    ["pytest NameError in body", "pytest-junit-throws.xml", JUNIT, null],
    ["pytest import error", "pytest-junit-importfail.xml", JUNIT, "could not run"],
    ["pytest DB fixture down", "pytest-junit-fixture.xml", JUNIT, "could not run"],
    ["pytest missing fixture", "pytest-junit-nofixture.xml", JUNIT, "could not run"],
    ["pytest empty selection", "pytest-junit-empty.xml", JUNIT, "nothing ran"],
    ["pytest all skipped", "pytest-junit-skip.xml", JUNIT, "nothing ran"],
    ["vitest junit assertion", "vitest-junit-assert.xml", JUNIT, null],
    ["vitest junit import error", "vitest-junit-importfail.xml", JUNIT, "could not run"],
    ["vitest junit no tests", "vitest-junit-empty.xml", JUNIT, "could not run"],
    ["vitest json assertion", "vitest-json-assert.json", JEST, null],
    ["vitest json import error", "vitest-json-importfail.json", JEST, "could not run"],
    ["vitest json no tests", "vitest-json-empty.json", JEST, "could not run"],
    ["vitest json all skipped", "vitest-json-skip.json", JEST, "nothing ran"],
    // The Palateful shape: green tests, exit 1 anyway (a coverage pin).
    ["vitest json green, exit 1", "vitest-json-pass.json", JEST, "passed"],
  ];
  for (const [label, file, contract, wrong] of cases) {
    it(`${label} → ${wrong ?? "asserted"}`, () => {
      const r = classify(1, contract, report(file));
      if (wrong === null) {
        expect(r.kind).toBe("asserted");
        expect(r.kind === "asserted" && r.basis).toBe("report");
      } else {
        expect(r.kind).toBe("wrong");
        expect(r.kind === "wrong" && r.wrong).toBe(wrong);
      }
    });
  }

  it("a declared report that was never written → no result", () => {
    const r = classify(1, JUNIT, null);
    expect(r.kind === "wrong" && r.wrong).toBe("no result");
  });

  it("a report in the wrong format → no result", () => {
    const r = classify(1, JUNIT, report("vitest-json-assert.json"));
    expect(r.kind === "wrong" && r.wrong).toBe("no result");
  });

  it("an errored case blocks even beside a real failure — part of the eval never ran", () => {
    const xml =
      '<testsuite><testcase classname="m" name="a"><failure message="x"/></testcase>' +
      '<testcase classname="m" name="b"><error message="setup"/></testcase></testsuite>';
    const r = classify(1, JUNIT, xml);
    expect(r.kind === "wrong" && r.wrong).toBe("could not run");
  });
});

describe("classifyRed — an exit contract is the runner's word", () => {
  it("a declared failure code → asserted, and the detail says the gate counted nothing", () => {
    const r = classify(1, EXIT1);
    expect(r.kind).toBe("asserted");
    expect(r.kind === "asserted" && r.basis).toBe("exit-contract");
    expect(r.kind === "asserted" && r.detail).toContain("counted no test cases");
  });

  it("pytest's 2 (collection) / 3 (internal) / 5 (none collected) are outside [1] → undeclared exit", () => {
    for (const exit of [2, 3, 4, 5]) {
      const r = classify(exit, EXIT1);
      expect(r.kind === "wrong" && r.wrong).toBe("undeclared exit");
    }
  });

  it("report AND failed_exit: both are necessary", () => {
    const both: RedContract = { ...JUNIT, failedExit: [1] };
    expect(classify(1, both, report("pytest-junit-assert.xml")).kind).toBe("asserted");
    expect(classify(4, both, report("pytest-junit-assert.xml")).kind).toBe("wrong");
    expect(classify(1, both, report("pytest-junit-importfail.xml")).kind).toBe("wrong");
  });
});

describe("classifyRed — no contract is said out loud", () => {
  it("undeclared → unchecked, naming the missing contract", () => {
    const r = classify(1, null);
    expect(r.kind).toBe("unchecked");
    expect(r.detail).toContain("declares no `red:` contract");
  });

  it("a malformed contract reads as undeclared and names its problem", () => {
    const r = classifyRed({
      exitCode: 1,
      contract: null,
      runnerName: "r",
      contractProblems: ["`red.report` must be `junit` or `jest-json`"],
    });
    expect(r.kind).toBe("unchecked");
    expect(r.detail).toContain("malformed");
    expect(r.detail).toContain("junit");
  });
});

describe("redContractFrom", () => {
  it("absent → no contract, no problems", () => {
    expect(redContractFrom(undefined)).toEqual({ contract: null, problems: [] });
  });

  it("parses every field", () => {
    expect(
      redContractFrom({
        command: "npx vitest run",
        report: "jest-json",
        args: "--reporter=json --outputFile={report}",
        failed_exit: [1, 1],
      }).contract,
    ).toEqual({
      command: "npx vitest run",
      report: "jest-json",
      args: "--reporter=json --outputFile={report}",
      failedExit: [1],
    });
  });

  it.each([
    ["a scalar", "junit"],
    ["an unknown format", { report: "tap" }],
    ["an empty exit list", { failed_exit: [] }],
    ["exit 0 as a failure", { failed_exit: [0] }],
    ["a shell code as a failure", { failed_exit: [127] }],
    ["a string exit", { failed_exit: ["1"] }],
    ["nothing to check", { command: "x" }],
    ["args without a report", { failed_exit: [1], args: "--x" }],
  ])("refuses %s — the contract is dropped, never half-trusted", (_label, raw) => {
    const r = redContractFrom(raw);
    expect(r.contract).toBeNull();
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it("projectRunnersFrom carries the contract and its problems", () => {
    const runners = projectRunnersFrom({
      projects: [
        { name: "ok", path: ".", test: "t", red: { failed_exit: [1] } },
        { name: "bad", path: "b", test: "t", red: { report: "tap" } },
        { name: "none", path: "n", test: "t" },
      ],
    });
    expect(runners[0].red).toEqual({ command: null, report: null, args: null, failedExit: [1] });
    expect(runners[1].red).toBeNull();
    expect(runners[1].redProblems).toHaveLength(1);
    expect(runners[2].red).toBeNull();
    expect(runners[2].redProblems).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runGateEvals — the verdict the classification produces
// ---------------------------------------------------------------------------

/** E-1 P0 runs, E-2 is a P1 that runs too (the plan's tests-after row is
 *  flipped), E-3 stays a human deferral. */
const RUNNING_P1_PLAN = validPlan().replace(
  "| E-2 | P1 | 2 | tests-after | test/demo.test.mjs | full |",
  "| E-2 | P1 | 2 | tests-first | test/p1.test.mjs | full |",
);

function gate(opts: {
  red?: RedContract | null;
  /** Report text per artifact basename; absent → never written. */
  reports?: Record<string, string>;
  exit?: number;
  plan?: string;
  command?: string;
}) {
  const written = new Map<string, string>();
  const calls: { command: string; env?: Readonly<Record<string, string>> }[] = [];
  const exec: ShellExec = (command, _cwd, env) => {
    calls.push({ command, env });
    const name = /test\/(\S+?)\.test\.mjs/.exec(command)?.[1] ?? "";
    const text = opts.reports?.[name];
    if (text !== undefined && env?.DEVX_RED_REPORT) written.set(env.DEVX_RED_REPORT, text);
    return { stdout: "", stderr: "boom", exitCode: opts.exit ?? 1 };
  };
  let n = 0;
  const result = runGateEvals({
    repoRoot: "/repo",
    workstreamAbs: "/repo/_devx/workstreams/demo",
    expectations: validExpectations().replace(
      "- **Verified by:** test/demo.test.mjs\n- **Measure:** `scripts/creep-incidents.sh`",
      "- **Verified by:** test/p1.test.mjs\n- **Measure:** `scripts/creep-incidents.sh`",
    ),
    plan: opts.plan ?? RUNNING_P1_PLAN,
    runners: [{ name: "cli", path: ".", test: opts.command ?? "run", red: opts.red ?? null }],
    exec,
    exists: () => true,
    readFile: () => null,
    redReport: {
      allocate: (eId) => `/tmp/red/${++n}-${eId}`,
      read: (p) => written.get(p) ?? null,
    },
  });
  return { result, calls };
}

describe("runGateEvals — P0 blocks, P1 concerns, on every wrong or unchecked reason", () => {
  it("negative control: both evals asserted by report → PASS", () => {
    const ok = report("pytest-junit-assert.xml");
    const { result } = gate({ red: JUNIT, reports: { demo: ok, p1: ok } });
    expect(result.verdict).toBe("PASS");
    expect(result.runs.map((r) => r.redVerdict)).toEqual(["red (asserted)", "red (asserted)"]);
  });

  it("an undeclared runner: the P0 is unchecked and FAILs; nothing reads as right-reason", () => {
    const { result } = gate({ red: null });
    expect(result.verdict).toBe("FAIL");
    const p0 = result.runs.find((r) => r.eId === "E-1")!;
    expect(p0.redVerdict).toBe("red (reason unchecked)");
    expect(p0.blocking).toBe(true);
    expect(p0.gap).toContain("a P0 must fail for a reason the gate can check");
  });

  it("a P0 whose file failed to import FAILs; the P1 beside it that did the same is a concern", () => {
    const ok = report("pytest-junit-assert.xml");
    const bad = report("pytest-junit-importfail.xml");
    const p0bad = gate({ red: JUNIT, reports: { demo: bad, p1: ok } }).result;
    expect(p0bad.verdict).toBe("FAIL");
    expect(p0bad.runs[0].redVerdict).toBe("wrong-reason (could not run)");
    const p1bad = gate({ red: JUNIT, reports: { demo: ok, p1: bad } }).result;
    expect(p1bad.verdict).toBe("CONCERNS");
    expect(p1bad.runs[1].blocking).toBe(false);
    expect(p1bad.runs[1].gap).toContain("wrong reason");
  });

  it("the gate hands the runner a fresh report path per run, in {report} and $DEVX_RED_REPORT", () => {
    const ok = report("pytest-junit-assert.xml");
    const { calls, result } = gate({
      red: { ...JUNIT, args: "--junitxml={report}" },
      reports: { demo: ok, p1: ok },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].command).toBe("run test/demo.test.mjs --junitxml='/tmp/red/1-E-1'");
    expect(calls[0].env).toEqual({ DEVX_RED_REPORT: "/tmp/red/1-E-1" });
    expect(calls[1].env).toEqual({ DEVX_RED_REPORT: "/tmp/red/2-E-2" });
    // Recorded with the placeholder: the temp path is gone after the run.
    expect(result.runs[0].command).toBe("run test/demo.test.mjs --junitxml={report}");
  });

  it("red.command replaces `test` for Gate 4 runs only", () => {
    const { calls } = gate({ red: { ...EXIT1, command: "npx vitest run" } });
    expect(calls[0].command).toBe("npx vitest run test/demo.test.mjs");
  });

  it("an exit-contract runner gets no report path and no env", () => {
    const { calls } = gate({ red: EXIT1 });
    expect(calls[0].env).toBeUndefined();
  });

  it("dry-run executes nothing and allocates nothing, but names the contract", () => {
    let allocated = 0;
    const result = runGateEvals({
      repoRoot: "/repo",
      workstreamAbs: "/repo/_devx/workstreams/demo",
      expectations: validExpectations(),
      plan: validPlan(),
      runners: [{ name: "cli", path: ".", test: "run", red: { ...JUNIT, args: "--x {report}" } }],
      exec: () => {
        throw new Error("dry run must not exec");
      },
      exists: () => true,
      redReport: {
        allocate: () => {
          allocated += 1;
          return "/x";
        },
        read: () => null,
      },
      dryRun: true,
    });
    expect(allocated).toBe(0);
    expect(result.runs[0].contract).toBe("junit report");
    expect(result.runs[0].command).toBe("run test/demo.test.mjs --x {report}");
  });

  it("exit 0 is still not-red, whatever the report says", () => {
    const { result } = gate({ red: JUNIT, exit: 0, reports: { demo: report("pytest-junit-assert.xml") } });
    expect(result.runs[0].redVerdict).toBe("not-red");
    expect(result.verdict).toBe("FAIL");
  });
});
