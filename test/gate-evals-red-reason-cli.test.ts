// Gate 4's reason check, end to end (D-19): `devx gate evals` over a mkdtemp
// workstream with two P0s, through REAL processes — no exec seam. The runner
// is a small node script that reads a scenario out of the eval file it is
// handed and reports exactly that, so each case is one real run of one real
// command line through the real shell, the real `{report}` substitution, the
// real `DEVX_RED_REPORT` env and the real temp dir.
//
// This file imports nothing D-19 added, on purpose: run against the base it
// shows what used to pass. On base, the vacuous runner below — exits 1 on a
// suite whose every test passed — PASSes Gate 4 and flips `evals_red`, and so
// does a P0 whose file never imported, a runner that is not on PATH, and a
// runner killed by a signal. That is the defect: nonzero was the whole check.
//
// The idiom is test/gate-closed-rerun.test.ts's: a refusal is proven by the
// BYTE-IDENTITY of the whole fixture tree, never by an exit code alone.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGateEvalsCli } from "../src/commands/gate.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import { type EngineRepo, captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";

const SPEC_REL = "plan/plan-abc123-2026-11-25T09:00-red-reason.md";
const WS = "_devx/workstreams/red-reason";
const RED_REPORT = `${WS}/evals/RED-report.md`;
const NOW = () => new Date(2026, 10, 25, 12, 0, 0);

/** A runner that does what its eval file's first line says. Every execution
 *  appends the report path it was handed to $D19_PROBE — outside the fixture
 *  tree, so "was the eval run at all" never disturbs a byte-identity check. */
const RUNNER = `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const s = JSON.parse(readFileSync(args[0], "utf8").split("\\n")[0].replace(/^\\/\\/ scenario: /, ""));
const at = args.indexOf("--report");
const out = at >= 0 ? args[at + 1] : process.env.DEVX_RED_REPORT;
if (process.env.D19_PROBE) appendFileSync(process.env.D19_PROBE, (out ?? "") + "\\n", "utf8");
if (s.report !== undefined && out && s.ignorePath !== true) writeFileSync(out, s.report, "utf8");
if (s.signal) process.kill(process.pid, s.signal);
process.exit(s.exit);
`;

const junit = (...cases: string[]): string =>
  `<?xml version="1.0"?><testsuites><testsuite name="t">${cases.join("")}</testsuite></testsuites>`;
const FAILED = (name: string) =>
  `<testcase classname="feature" name="${name}"><failure message="AssertionError: expected the feature"/></testcase>`;
const PASSED = (name: string) => `<testcase classname="feature" name="${name}"/>`;
/** vitest's encoding of a file that failed to import (see red-reports/). */
const LOAD_FAILED = (file: string) =>
  `<testcase classname="${file}" name="${file}"><failure message="Failed to load url ../src/feature.js"/></testcase>`;
const COLLECTION = `<testcase classname="" name="test_e"><error message="collection failure"/></testcase>`;

interface Scenario {
  exit: number;
  report?: string;
  ignorePath?: boolean;
  signal?: string;
}

const CONTRACTS = {
  junit: ["    red:", "      report: junit", "      args: --report {report}"],
  env: ["    red:", "      report: junit"],
  exit: ["    red:", "      failed_exit: [1]"],
  none: [] as string[],
};

let repo: EngineRepo;
let probeDir: string;
let probe: string;
beforeEach(() => {
  probeDir = mkdtempSync(join(tmpdir(), "devx-d19-probe-"));
  probe = join(probeDir, "runs");
  process.env.D19_PROBE = probe;
});
afterEach(() => {
  delete process.env.D19_PROBE;
  rmSync(probeDir, { recursive: true, force: true });
  repo?.cleanup();
});
/** Report paths handed to the runner so far, one per execution. */
const runs = (): string[] =>
  existsSync(probe) ? readFileSync(probe, "utf8").split("\n").filter((l) => l !== "") : [];

function seed(contract: keyof typeof CONTRACTS, e1: Scenario, e2: Scenario, test = "node runner.mjs"): void {
  repo = makeEngineRepo({
    config: ["mode: YOLO", "projects:", "  - name: cli", "    path: .", `    test: ${test}`, ...CONTRACTS[contract], ""].join("\n"),
  });
  repo.write("runner.mjs", RUNNER);
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      "stage: red",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: true",
      "  evals_red: false",
      `workstream: ${WS}`,
      "---",
      "",
      "## Status log",
      "",
      "- created.",
      "",
    ].join("\n"),
  );
  const block = (n: number, file: string) => [
    `## E-${n}: feature ${n}`,
    "",
    "- **Priority:** P0",
    "- **Covers:** G-1",
    "- **Trigger:** a request",
    `- **Expectation (EARS):** When asked, the system SHALL do ${n}.`,
    "- **Threshold:** always",
    `- **Verified by:** ${file}`,
    "",
  ];
  repo.write(
    `${WS}/expectations.md`,
    ["# Expectations", "", ...block(1, "test/e1.test.mjs"), ...block(2, "test/e2.test.mjs")].join("\n"),
  );
  repo.write(
    `${WS}/plan/agent.md`,
    [
      "# Plan",
      "",
      "| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |",
      "|---|---|---|---|---|---|",
      "| E-1 | P0 | 1 | tests-first | test/e1.test.mjs | full |",
      "| E-2 | P0 | 2 | tests-first | test/e2.test.mjs | full |",
      "",
    ].join("\n"),
  );
  repo.write("test/e1.test.mjs", `// scenario: ${JSON.stringify(e1)}\n`);
  repo.write("test/e2.test.mjs", `// scenario: ${JSON.stringify(e2)}\n`);
}

function gate(flags: { dryRun?: boolean; verify?: boolean } = {}) {
  const io = captureIo();
  const code = runGateEvalsCli(["abc123"], flags, { ...io, projectPath: repo.configPath, now: NOW });
  return { code, io, json: io.json() as Record<string, unknown> };
}

const state = () => readEngineState(repo.read(SPEC_REL));

function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.set(relative(repo.root, abs), readFileSync(abs, "latin1"));
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

/** A Gate 4 that did not pass: exit 1, FAIL, and nothing advanced or locked. */
function expectBlocked(r: ReturnType<typeof gate>, ...mustMention: string[]): void {
  expect(r.code).toBe(1);
  expect(r.json.gate).toBe("FAIL");
  expect(r.json.flipped).toBeNull();
  const s = state();
  expect(s.gateStatus.evals_red).toBe(false);
  expect(s.evalsLocked).toBe(false);
  expect(s.redEvalShas).toEqual({});
  expect(s.stage).toBe("red");
  const reasons = (r.json.reasons as string[]).join("\n");
  for (const m of mustMention) expect(reasons).toContain(m);
}

const RED = (name: string): Scenario => ({ exit: 1, report: junit(FAILED(name), PASSED(`${name} ok`)) });

// ---------------------------------------------------------------------------
// The demonstration: the same two-P0 workstream, PASS on base, FAIL now
// ---------------------------------------------------------------------------

describe("a vacuously red workstream no longer passes Gate 4", () => {
  it("negative control: two P0s that genuinely fail a test PASS, and the report says what was checked", () => {
    seed("junit", RED("e1"), RED("e2"));
    const r = gate();
    expect(r.code).toBe(0);
    expect(r.json.gate).toBe("PASS");
    expect(state().gateStatus.evals_red).toBe(true);
    const md = repo.read(RED_REPORT);
    expect(md).toContain("- **RED verdict**: red (asserted)");
    expect(md).toContain("junit report: 1 failed case, 0 errored, 0 skipped, 1 passed");
    expect(md).toContain("`feature > e1` — AssertionError: expected the feature");
    // The scope is in the output, not implied by it.
    expect(md).toContain("What Gate 4 checked (D-19)");
    expect(md).toContain("Not checked: that the failing test fails on the missing behaviour");
    expect(r.json.red_reason).toMatchObject({ not_checked: expect.stringContaining("author's judgment") });
  });

  it("THE vacuous suite: every test passes, the runner exits 1 anyway → FAIL (it PASSed on base)", () => {
    const green: Scenario = { exit: 1, report: junit(PASSED("a"), PASSED("b")) };
    seed("junit", green, green);
    expectBlocked(gate(), "E-1 is RED for the wrong reason", "every test passed", "E-2 is RED for the wrong reason");
    expect(repo.read(RED_REPORT)).toContain("wrong-reason (passed)");
  });

  it("the same vacuous runner with NO contract → FAIL as unchecked (it PASSed on base)", () => {
    seed("none", { exit: 1 }, { exit: 1 });
    expectBlocked(gate(), "cannot see why", "declares no `red:` contract");
    expect(repo.read(RED_REPORT)).toContain("red (reason unchecked)");
  });

  it("one P0 red for the right reason does not carry one that never imported", () => {
    seed("junit", RED("e1"), { exit: 1, report: junit(LOAD_FAILED("test/e2.test.mjs")) });
    const r = gate();
    expectBlocked(r, "E-2 is RED for the wrong reason", "Failed to load url");
    expect((r.json.reasons as string[]).some((x) => x.startsWith("E-1"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mutants of the eval's RESULT — each must stop the gate (gate-mutations idiom)
// ---------------------------------------------------------------------------

describe("every wrong reason stops the gate and advances nothing", () => {
  const mutants: [string, keyof typeof CONTRACTS, Scenario, string][] = [
    ["a collection error (pytest import)", "junit", { exit: 2, report: junit(COLLECTION) }, "errored before a test body ran"],
    ["an empty selection", "junit", { exit: 5, report: junit() }, "selection was empty"],
    ["every test skipped", "junit", { exit: 1, report: junit('<testcase classname="f" name="s"><skipped/></testcase>') }, "every selected test was skipped"],
    ["a runner that ignores the report path", "junit", { exit: 1, report: junit(FAILED("x")), ignorePath: true }, "wrote none"],
    ["a report that is not JUnit", "junit", { exit: 1, report: "3 failed" }, "cannot read as junit"],
    ["exit 2 against failed_exit [1]", "exit", { exit: 2 }, "not one of runner 'cli''s declared failure codes"],
    ["a runner killed by SIGKILL", "exit", { exit: 1, signal: "SIGKILL" }, "killed (signal 9)"],
  ];
  for (const [label, contract, e2, mention] of mutants) {
    it(`${label} → FAIL`, () => {
      seed(contract, contract === "exit" ? { exit: 1 } : RED("e1"), e2);
      expectBlocked(gate(), "E-2", mention);
    });
  }

  it("a runner that is not installed (exit 127) → FAIL, even with no contract at all", () => {
    seed("none", { exit: 1 }, { exit: 1 }, "devx-no-such-runner-d19");
    expectBlocked(gate(), "exit 127");
  });

  it("the contract can arrive by env alone: $DEVX_RED_REPORT, no {report} in args", () => {
    seed("env", RED("e1"), RED("e2"));
    expect(gate().json.gate).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// What D-19 must NOT change: the closed-gate refusal, --verify, --dry-run
// ---------------------------------------------------------------------------

describe("refusals and read-only looks are untouched", () => {
  it("a closed Gate 4 over a now-vacuous runner still refuses first: tree byte-identical, runner never run", () => {
    seed("junit", RED("e1"), RED("e2"));
    expect(gate().code).toBe(0);
    rmSync(probe, { force: true });
    repo.write("test/e1.test.mjs", `// scenario: ${JSON.stringify({ exit: 1, report: junit(PASSED("a")) })}\n`);
    const before = snapshot();
    const r = gate();
    expect(r.code).toBe(1);
    expect(String(r.json.refusal)).toContain("Gate 4 (evals) is closed");
    expectTreeUnchanged(before);
    expect(runs()).toEqual([]);
  });

  it("--verify runs no eval and writes nothing", () => {
    seed("junit", RED("e1"), RED("e2"));
    expect(gate().code).toBe(0);
    rmSync(probe, { force: true });
    const before = snapshot();
    const r = gate({ verify: true });
    expect(r.json.verify).toBe("PASS");
    expectTreeUnchanged(before);
    expect(runs()).toEqual([]);
  });

  it("--dry-run names each run's contract before anything runs, and writes nothing", () => {
    seed("none", { exit: 1 }, { exit: 1 });
    const before = snapshot();
    const r = gate({ dryRun: true });
    expect(r.code).toBe(0);
    expect((r.json.planned as { red_contract: string }[]).map((p) => p.red_contract)).toEqual(["none", "none"]);
    expectTreeUnchanged(before);
    expect(runs()).toEqual([]);
  });

  it("each run gets its own report path, and the temp dir is gone afterwards", () => {
    seed("junit", RED("e1"), RED("e2"));
    expect(gate().code).toBe(0);
    const paths = runs();
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
    for (const p of paths) {
      expect(p).toMatch(/devx-red-/);
      expect(existsSync(p)).toBe(false);
      expect(existsSync(dirname(p))).toBe(false);
    }
  });
});
