// Gate 2's advisory hygiene lens (harness-s4; gap analysis rows A6/C6).
//
// The contract, pinned from both ends:
//   - the subagent's `hygiene` array parses strictly (four kinds, receipts
//     required) and the CLI adds two mechanical findings of its own
//     (a settled-questions section; no captured research);
//   - findings hold the verdict at CONCERNS at most and NEVER produce or
//     mask a FAIL — however many there are;
//   - the lens is design-mode only: a plan-mode table carrying one is warned
//     about and ignored, and the plan report grows no hygiene section;
//   - research presence resolves through the layout, so the two shapes agree.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGateCoverage } from "../src/commands/gate.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  type CoverageComputation,
  type HygieneFinding,
  applyHygieneFindings,
  computeCoverageVerdict,
  mechanicalHygiene,
  parseCoverageTable,
  renderVerifyReport,
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

const finding = (over: Partial<HygieneFinding> = {}): HygieneFinding => ({
  kind: "residue",
  where: "design/agent.md § Architecture",
  note: "says 'we chose X over Y' in the body",
  by: "judgment",
  ...over,
});

function computation(verdict: CoverageComputation["verdict"]): CoverageComputation {
  return {
    verdict,
    reasons: verdict === "PASS" ? [] : [`G-1 is ${verdict === "FAIL" ? "❌ missing" : "⚠️ partial"}`],
    keyedRows: [],
    extraRows: [],
    missingRowIds: [],
    duplicateRowIds: [],
    hygiene: [],
  };
}

// ---------------------------------------------------------------------------
// Table parse
// ---------------------------------------------------------------------------

describe("parseCoverageTable — the hygiene array", () => {
  const rows = [{ id: "G-1", status: "covered", where: "x" }];

  it("is optional: an absent array is []", () => {
    const r = parseCoverageTable(JSON.stringify({ rows }));
    expect(r.ok && r.table.hygiene).toEqual([]);
  });

  it("parses the four kinds, normalizing case and separators, tagged `judgment`", () => {
    const r = parseCoverageTable(
      JSON.stringify({
        rows,
        hygiene: [
          { kind: "Residue", where: "§ A", note: "n" },
          { kind: "duplication", where: "§ B", note: "n" },
          { kind: "UNGROUNDED", where: "§ C", note: "n" },
          { kind: "bare_decision", where: "§ D", note: "n" },
          { kind: "bare decision", where: "§ E", note: "n" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.table.hygiene.map((h) => h.kind)).toEqual([
      "residue",
      "duplication",
      "ungrounded",
      "bare-decision",
      "bare-decision",
    ]);
    expect(new Set(r.table.hygiene.map((h) => h.by))).toEqual(new Set(["judgment"]));
  });

  it.each([
    ["an invented fifth kind", { kind: "verbosity", where: "§ A", note: "n" }, "unknown kind 'verbosity'"],
    ["a missing kind", { where: "§ A", note: "n" }, "unknown kind"],
    ["a blank where", { kind: "residue", where: "  ", note: "n" }, "no string `where`"],
    ["a missing note", { kind: "residue", where: "§ A" }, "no string `note`"],
    ["a non-object entry", "residue", "hygiene[0] must be an object"],
  ])("rejects %s", (_label, entry, msg) => {
    const r = parseCoverageTable(JSON.stringify({ rows, hygiene: [entry] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });

  it("rejects a non-array hygiene", () => {
    const r = parseCoverageTable(JSON.stringify({ rows, hygiene: { kind: "residue" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("`hygiene` must be an array");
  });
});

// ---------------------------------------------------------------------------
// The mechanical half
// ---------------------------------------------------------------------------

describe("mechanicalHygiene", () => {
  const base = { designRel: "ws/design/agent.md", researchPresent: true, researchRel: "ws/design/research.md" };

  it("is silent on a clean design with research present", () => {
    expect(mechanicalHygiene({ ...base, design: "## Design\n\n### Architecture\n\nx\n" })).toEqual([]);
  });

  it("flags a settled-questions section as residue, naming the heading", () => {
    const out = mechanicalHygiene({
      ...base,
      design: "## Design\n\nx\n\n## Resolved design questions\n\n- a → b\n\n## Unresolved design questions\n\n- c\n",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "residue", by: "cli", where: "ws/design/agent.md § Resolved design questions" });
  });

  it("matches the heading at ##–#### and in any case, never `Unresolved …`", () => {
    for (const h of ["## Resolved questions", "### resolved Design Questions", "#### Resolved question"]) {
      expect(mechanicalHygiene({ ...base, design: `${h}\n` }), h).toHaveLength(1);
    }
    for (const h of ["## Unresolved design questions", "# Resolved questions", "## Open questions", "Resolved questions"]) {
      expect(mechanicalHygiene({ ...base, design: `${h}\n` }), h).toEqual([]);
    }
  });

  it("ignores a heading inside a fenced block", () => {
    const design = "## Design\n\n```md\n## Resolved design questions\n```\n";
    expect(mechanicalHygiene({ ...base, design })).toEqual([]);
  });

  it("flags absent research as ungrounded, naming the path the layout gives it", () => {
    const out = mechanicalHygiene({ ...base, design: "## Design\n", researchPresent: false });
    expect(out).toEqual([
      expect.objectContaining({ kind: "ungrounded", by: "cli", where: "ws/design/research.md" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// The verdict fold — CONCERNS at most, never FAIL
// ---------------------------------------------------------------------------

describe("applyHygieneFindings", () => {
  it("is the identity on an empty list", () => {
    const c = computation("PASS");
    expect(applyHygieneFindings(c, [])).toBe(c);
  });

  it("moves PASS to CONCERNS with ONE summary reason, not one per finding", () => {
    const out = applyHygieneFindings(computation("PASS"), [
      finding(),
      finding({ kind: "ungrounded", by: "cli" }),
      finding({ kind: "residue", where: "§ B" }),
    ]);
    expect(out.verdict).toBe("CONCERNS");
    expect(out.hygiene).toHaveLength(3);
    expect(out.reasons).toEqual([
      "hygiene: 3 advisory findings (residue 2, ungrounded 1) — CONCERNS at most, never FAIL",
    ]);
  });

  it("never produces a FAIL, however many findings there are", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      finding({ kind: (["residue", "duplication", "ungrounded", "bare-decision"] as const)[i % 4] }),
    );
    expect(applyHygieneFindings(computation("PASS"), many).verdict).toBe("CONCERNS");
    expect(applyHygieneFindings(computation("CONCERNS"), many).verdict).toBe("CONCERNS");
  });

  it("never masks a FAIL the coverage rows earned, and keeps their reasons first", () => {
    const out = applyHygieneFindings(computation("FAIL"), [finding()]);
    expect(out.verdict).toBe("FAIL");
    expect(out.reasons[0]).toBe("G-1 is ❌ missing");
  });
});

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

describe("renderVerifyReport — the Hygiene (advisory) section", () => {
  const subjects = {
    prdRel: "ws/prd/agent.md",
    designRel: "ws/design/agent.md",
    planRel: "ws/plan/agent.md",
    expectationsRel: "ws/expectations.md",
  };
  const render = (mode: "design" | "plan", c: CoverageComputation) =>
    renderVerifyReport({ mode, hash: "abc123", workstreamRel: "ws", date: "2026-11-20", computation: c, extras: [], subjects });

  it("design mode renders an explicit zero when the lens is clean", () => {
    const report = render("design", computation("PASS"));
    expect(report).toContain("## Hygiene (advisory)\n\n- none\n");
  });

  it("design mode tables each finding with its source, escaping pipes", () => {
    const report = render(
      "design",
      applyHygieneFindings(computation("PASS"), [finding({ note: "a | b" }), finding({ kind: "ungrounded", by: "cli" })]),
    );
    expect(report).toContain("| Kind | Where | Note | By |");
    expect(report).toContain("| residue | design/agent.md § Architecture | a \\| b | judgment |");
    expect(report).toContain("| ungrounded |");
    expect(report).toContain("| cli |");
    // The section sits between Extras and Verdict detail.
    const order = ["## Extras requiring product approval", "## Hygiene (advisory)", "## Verdict detail"].map((h) =>
      report.indexOf(h),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(parseVerdictBlock(report)!.block.gate).toBe("CONCERNS");
  });

  it("plan mode grows no hygiene section", () => {
    expect(render("plan", computation("PASS"))).not.toContain("Hygiene");
  });
});

// ---------------------------------------------------------------------------
// CLI driver
// ---------------------------------------------------------------------------

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const SPEC_REL = "plan/plan-abc123-2026-07-05T13:01-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";
const REPORT = `${WS}/decisions/2026-11-20-design-verify.md`;

function seed(opts: { design?: string; research?: boolean; planStage?: boolean } = {}): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${opts.planStage ? "plan" : "design"}`,
      "gate_status:",
      "  prd_validated: true",
      `  design_verified: ${opts.planStage ? "true" : "false"}`,
      "  plan_verified: false",
      "  evals_red: false",
      `workstream: ${WS}`,
      "---",
      "body",
      "",
    ].join("\n"),
  );
  repo.write(`${WS}/prd/agent.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
  repo.write(`${WS}/design/agent.md`, opts.design ?? "## Design\n\n### Architecture\n\nreal (`src/x.ts:1`).\n");
  if (opts.research !== false) repo.write(`${WS}/design/research.md`, "# Research\n\n## Q1\n\n`src/x.ts:1`\n");
  if (opts.planStage) repo.write(`${WS}/plan/agent.md`, "## Plan\n\nreal.\n");
}

function run(table: string) {
  const io = captureIo();
  repo.write("table.json", table);
  const code = runGateCoverage(["abc123"], { table: `${repo.root}/table.json` }, {
    ...io,
    projectPath: repo.configPath,
    now: () => new Date(2026, 10, 20, 12, 0, 0),
  });
  // An exit-2 run prints no verdict JSON — only a stderr diagnostic.
  const json = (code === 2 ? {} : io.json()) as Record<string, unknown>;
  return { code, io, json };
}

function withHygiene(table: string, hygiene: unknown[]): string {
  return JSON.stringify({ ...(JSON.parse(table) as object), hygiene });
}

describe("devx gate coverage — design-mode hygiene, end to end", () => {
  it("clean design + research → PASS with an explicit-zero hygiene section", () => {
    seed();
    const { code, json } = run(designTable());
    expect(code).toBe(0);
    expect(json.gate).toBe("PASS");
    expect(json.hygiene).toEqual([]);
    expect(repo.read(REPORT)).toContain("## Hygiene (advisory)\n\n- none");
  });

  it("no captured research → CONCERNS, gate still advances, verdict recorded", () => {
    seed({ research: false });
    const { code, json } = run(designTable());
    expect(code).toBe(0);
    expect(json.gate).toBe("CONCERNS");
    expect(json.hygiene).toEqual(["cli:ungrounded"]);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.design_verified).toBe(true);
    expect(state.gateVerdicts.design).toBe("CONCERNS");
    expect(state.stage).toBe("plan");
    expect(repo.read(REPORT)).toContain(`| ungrounded | ${WS}/design/research.md |`);
  });

  it("a settled-questions section → CONCERNS naming the heading", () => {
    seed({ design: "## Design\n\nx\n\n## Resolved design questions\n\n- a → b\n" });
    const { json } = run(designTable());
    expect(json.gate).toBe("CONCERNS");
    expect(json.hygiene).toEqual(["cli:residue"]);
    expect(repo.read(REPORT)).toContain(`${WS}/design/agent.md § Resolved design questions`);
  });

  it("judged findings on a fully covered design are CONCERNS, never FAIL (exit 0)", () => {
    seed();
    const judged = Array.from({ length: 12 }, (_, i) => ({
      kind: ["residue", "duplication", "ungrounded", "bare-decision"][i % 4],
      where: `design/agent.md § S${i}`,
      note: `finding ${i}`,
    }));
    const { code, json } = run(withHygiene(designTable(), judged));
    expect(code).toBe(0);
    expect(json.gate).toBe("CONCERNS");
    expect((json.hygiene as string[]).every((h) => h.startsWith("judgment:"))).toBe(true);
    expect(parseVerdictBlock(repo.read(REPORT))!.block.gate).toBe("CONCERNS");
  });

  it("a coverage FAIL stays FAIL with hygiene present (exit 1)", () => {
    seed({ research: false });
    const { code, json } = run(designTable({ "FR-1": "missing" }));
    expect(code).toBe(1);
    expect(json.gate).toBe("FAIL");
    expect((json.reasons as string[])[0]).toContain("FR-1");
  });

  it("an invalid judged kind is invalid input (exit 2), not a verdict", () => {
    seed();
    const { code } = run(withHygiene(designTable(), [{ kind: "tone", where: "x", note: "y" }]));
    expect(code).toBe(2);
    expect(repo.exists(REPORT)).toBe(false);
  });

  it("plan mode warns and ignores a hygiene array; the plan report has no hygiene section", () => {
    seed({ planStage: true, research: false });
    const io = captureIo();
    repo.write("table.json", withHygiene(planTable(), [{ kind: "residue", where: "x", note: "y" }]));
    const code = runGateCoverage(["abc123"], { table: `${repo.root}/table.json` }, {
      ...io,
      projectPath: repo.configPath,
      now: () => new Date(2026, 10, 20, 12, 0, 0),
    });
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.gate).toBe("PASS");
    expect(j).not.toHaveProperty("hygiene");
    expect(io.stderr()).toContain("`hygiene` is a design-mode lens — 1 finding(s) ignored in plan mode");
    expect(repo.read(`${WS}/decisions/2026-11-20-plan-verify.md`)).not.toContain("Hygiene");
  });
});

// The pure evaluator stays layout-blind; the caller resolves research through
// the artifact map. `computeCoverageVerdict` is untouched by the lens.
describe("computeCoverageVerdict is unchanged by the lens", () => {
  it("returns an empty hygiene list", () => {
    const c = computeCoverageVerdict("design", ["G-1"], { rows: [{ id: "G-1", status: "covered", where: "", note: "", artifact: null }], extras: [], hygiene: [finding()] }, new Map());
    expect(c.verdict).toBe("PASS");
    expect(c.hygiene).toEqual([]);
  });
});
