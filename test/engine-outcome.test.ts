// Outcome loop tests (v2o101): arm/score pure fns + the `devx outcome`
// CLI passthrough, against the real shipped results template. Covers the
// injectable clock (+4w default from a frozen now), the four verdict
// paths (keep mechanical; tune cascade-reopen keyed to E-ids; restart
// lineage stamping both directions; retire status-only), goal-coverage
// refusals, and a golden RESULTS.md render.
//
// Spec: dev/dev-v2o101-2026-07-05T13:07-outcome-loop.md
// Design: v2/02-engine.md §4.10

import { describe, expect, it } from "vitest";

import {
  computeArm,
  computeGoalRows,
  computeTune,
  defaultStatusReason,
  isMeasureByDue,
  parsePrdGoals,
  renderResults,
  resolveMeasureBy,
  OutcomeError,
  OutcomeRefusal,
} from "../src/lib/engine/outcome.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import { runOutcomeArm, runOutcomeScore } from "../src/commands/outcome.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
  validExpectations,
  validPrd,
} from "./fixtures/engine-repo.js";

const NOW = new Date("2026-07-05T12:00:00");

// ---------------------------------------------------------------------------
// Pure: measure_by
// ---------------------------------------------------------------------------

describe("resolveMeasureBy — injectable clock, no Date.now", () => {
  it("defaults to +4 weeks from the injected now", () => {
    expect(resolveMeasureBy(undefined, NOW)).toBe("2026-08-02");
    expect(resolveMeasureBy("", NOW)).toBe("2026-08-02");
  });

  it("accepts +Nw relative weeks", () => {
    expect(resolveMeasureBy("+1w", NOW)).toBe("2026-07-12");
    expect(resolveMeasureBy("+4w", NOW)).toBe("2026-08-02");
  });

  it("accepts an absolute YYYY-MM-DD", () => {
    expect(resolveMeasureBy("2026-08-02", NOW)).toBe("2026-08-02");
  });

  it("rejects calendar nonsense and unknown shapes", () => {
    expect(() => resolveMeasureBy("2026-13-40", NOW)).toThrow(OutcomeError);
    expect(() => resolveMeasureBy("next month", NOW)).toThrow(OutcomeError);
    expect(() => resolveMeasureBy("+0w", NOW)).toThrow(OutcomeError);
  });
});

describe("isMeasureByDue", () => {
  it("compares ISO dates lexicographically", () => {
    expect(isMeasureByDue("2026-07-05", "2026-07-05")).toBe(true);
    expect(isMeasureByDue("2026-07-04", "2026-07-05")).toBe(true);
    expect(isMeasureByDue("2026-07-06", "2026-07-05")).toBe(false);
  });

  it("null / malformed dates count as due (never wait forever)", () => {
    expect(isMeasureByDue(null, "2026-07-05")).toBe(true);
    expect(isMeasureByDue("someday", "2026-07-05")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure: arm
// ---------------------------------------------------------------------------

function doneState(outcome: { status: string | null; measure_by: string | null }) {
  return readEngineStateFor("done", outcome);
}

function readEngineStateFor(
  stage: string,
  outcome: { status: string | null; measure_by: string | null },
) {
  return readEngineState(
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: done",
      `stage: ${stage}`,
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: true",
      "  evals_red: true",
      "outcome:",
      `  status: ${outcome.status ?? "null"}`,
      `  measure_by: ${outcome.measure_by ?? "null"}`,
      "workstream: _devx/workstreams/demo",
      "---",
      "body",
    ].join("\n"),
  );
}

describe("computeArm", () => {
  it("arms a done workstream with the +4w default", () => {
    const c = computeArm(doneState({ status: null, measure_by: null }), undefined, NOW);
    expect(c.measureBy).toBe("2026-08-02");
    expect(c.noop).toBe(false);
  });

  it("refuses when the stage isn't done (arm happens at close)", () => {
    expect(() =>
      computeArm(readEngineStateFor("executing", { status: null, measure_by: null }), undefined, NOW),
    ).toThrow(OutcomeRefusal);
  });

  it("refuses to re-arm over a recorded verdict", () => {
    expect(() =>
      computeArm(doneState({ status: "keep", measure_by: "2026-08-02" }), undefined, NOW),
    ).toThrow(/already scored/);
  });

  it("re-arming the same pending measure_by is a no-op", () => {
    const c = computeArm(
      doneState({ status: "pending", measure_by: "2026-08-02" }),
      "2026-08-02",
      NOW,
    );
    expect(c.noop).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure: goal parsing + scoring
// ---------------------------------------------------------------------------

describe("parsePrdGoals", () => {
  it("extracts bullet-defined goals with their text", () => {
    const goals = parsePrdGoals(validPrd());
    expect(goals.map((g) => g.id)).toEqual(["G-1", "G-2"]);
    expect(goals[0].text).toContain("review time per PR under 10 min");
  });

  it("folds wrapped continuation lines into the goal text (v2e102 parser lesson)", () => {
    const prd = [
      "## Goals",
      "",
      "- **G-1**: the full test suite stays green",
      "  (≥ 1571 tests) through the ejection PR",
      "",
    ].join("\n");
    const goals = parsePrdGoals(prd);
    expect(goals[0].text).toBe(
      "the full test suite stays green (≥ 1571 tests) through the ejection PR",
    );
  });

  it("extracts heading-defined goals too", () => {
    const goals = parsePrdGoals("### G-3: latency ≤ 250 ms\n\nprose\n");
    expect(goals).toHaveLength(1);
    expect(goals[0].text).toBe("latency ≤ 250 ms");
  });

  it("CRLF prd.md keeps its goal text (comparator inference survives)", () => {
    const goals = parsePrdGoals(
      "## Goals\r\n\r\n- **G-1**: reach ≥ 100 users\r\n",
    );
    expect(goals[0].text).toBe("reach ≥ 100 users");
    const { rows } = computeGoalRows(goals, inputs({ actuals: [["G-1", "150"]] }));
    expect(rows[0].verdict).toBe("hit");
  });

  it("indented tables and numbered sub-lists under a goal are NOT folded into its text", () => {
    const prd = [
      "## Goals",
      "",
      "- **G-1**: adoption target",
      "  | metric | target |",
      "  |---|---|",
      "  | weekly users | ≥ 500 |",
      "- **G-2**: cost stays flat",
      "  1. first thing costs ≥ 10",
      "",
    ].join("\n");
    const goals = parsePrdGoals(prd);
    expect(goals[0].text).toBe("adoption target");
    expect(goals[1].text).toBe("cost stays flat");
  });
});

function inputs(overrides: {
  actuals?: Array<[string, string]>;
  sources?: Array<[string, string]>;
  results?: Array<[string, "hit" | "miss" | "partial"]>;
}) {
  return {
    actuals: new Map(overrides.actuals ?? []),
    sources: new Map(overrides.sources ?? []),
    results: new Map(overrides.results ?? []),
  };
}

describe("computeGoalRows", () => {
  const goals = [
    { id: "G-1", line: 1, text: "suite stays green (≥ 1571 tests)" },
    { id: "G-2", line: 2, text: "tour build p95 ≤ 8 s" },
    { id: "G-3", line: 3, text: "zero silent scope-creep incidents" },
  ];

  it("scores ≥/≤ comparator goals mechanically; prose goals score 'recorded'", () => {
    const { rows } = computeGoalRows(
      goals,
      inputs({
        actuals: [
          ["G-1", "1974"],
          ["G-2", "12"],
          ["G-3", "0"],
        ],
      }),
    );
    expect(rows.map((r) => [r.id, r.verdict, r.derivation])).toEqual([
      ["G-1", "hit", "comparator"],
      ["G-2", "miss", "comparator"],
      ["G-3", "recorded", "recorded"],
    ]);
  });

  it("a date after the comparator is not a bound (`ship ≤ 2026-08-01` → recorded)", () => {
    const dated = [{ id: "G-1", line: 1, text: "ship the feature ≤ 2026-08-01" }];
    const { rows } = computeGoalRows(dated, inputs({ actuals: [["G-1", "5"]] }));
    expect(rows[0].verdict).toBe("recorded");
  });

  it("multi-comparator goal text is NOT scored mechanically (falls back to recorded)", () => {
    // "raise the eval pass rate from its ≥ 60% baseline to ≥ 95%" — scoring
    // 80 against the first bound (60) would be a false hit (BH#2).
    const multi = [
      {
        id: "G-1",
        line: 1,
        text: "raise the eval pass rate from its ≥ 60 baseline to ≥ 95",
      },
    ];
    const { rows } = computeGoalRows(multi, inputs({ actuals: [["G-1", "80"]] }));
    expect(rows[0].verdict).toBe("recorded");
    expect(rows[0].derivation).toBe("recorded");
  });

  it("an explicit --result always wins over the comparator", () => {
    const { rows } = computeGoalRows(
      goals,
      inputs({
        actuals: [
          ["G-1", "1974"],
          ["G-2", "12"],
          ["G-3", "0"],
        ],
        results: [
          ["G-2", "partial"],
          ["G-3", "hit"],
        ],
      }),
    );
    expect(rows.map((r) => r.verdict)).toEqual(["hit", "partial", "hit"]);
    expect(rows[1].derivation).toBe("explicit");
  });

  it("refuses when a defined goal has no --goal flag (bidirectional coverage)", () => {
    expect(() =>
      computeGoalRows(goals, inputs({ actuals: [["G-1", "1974"]] })),
    ).toThrow(/missing: G-2, G-3/);
  });

  it("refuses a --goal for an undefined goal", () => {
    expect(() =>
      computeGoalRows(
        goals,
        inputs({
          actuals: [
            ["G-1", "1"],
            ["G-2", "2"],
            ["G-3", "3"],
            ["G-9", "4"],
          ],
        }),
      ),
    ).toThrow(/G-9/);
  });

  it("refuses when the PRD defines no goals at all", () => {
    expect(() => computeGoalRows([], inputs({}))).toThrow(/no G- goals/);
  });

  it("defaultStatusReason rolls the table up deterministically", () => {
    const { rows } = computeGoalRows(
      goals,
      inputs({
        actuals: [
          ["G-1", "1974"],
          ["G-2", "12"],
          ["G-3", "0"],
        ],
      }),
    );
    expect(defaultStatusReason("keep", rows)).toBe(
      "verdict keep: 1/3 goals hit, 1 missed, 1 recorded.",
    );
  });
});

// ---------------------------------------------------------------------------
// Pure: tune cascade
// ---------------------------------------------------------------------------

describe("computeTune — cascade-reopen keyed to E-ids", () => {
  const st = doneState({ status: "pending", measure_by: "2026-06-01" });

  it("clears evals_red, rolls the stage back to red, prints the replay", () => {
    const t = computeTune(st, "E-2,E-1", validExpectations(), "abc123");
    expect(t.reopened).toEqual(["E-1", "E-2"]); // lowest E-id leads
    expect(t.reopenArtifacts).toEqual(["test/demo.test.mjs", "test/demo.test.mjs"]);
    expect(t.flagsCleared).toEqual(["evals_red"]);
    expect(t.stage).toBe("red");
    expect(t.replay).toEqual(["devx gate evals abc123"]);
  });

  it("dedupes repeated E-ids in --reopen", () => {
    const t = computeTune(st, "E-1,E-1,e-2", validExpectations(), "abc123");
    expect(t.reopened).toEqual(["E-1", "E-2"]);
  });

  it("refuses unknown E-ids against expectations.md", () => {
    expect(() => computeTune(st, "E-9", validExpectations(), "abc123")).toThrow(
      /E-9/,
    );
  });

  it("refuses an empty or malformed --reopen", () => {
    expect(() => computeTune(st, "", validExpectations(), "abc123")).toThrow(
      OutcomeRefusal,
    );
    expect(() => computeTune(st, "FR-1", validExpectations(), "abc123")).toThrow(
      /not an E-id/,
    );
  });

  it("never advances the stage (min-stage rule from revise)", () => {
    const early = readEngineStateFor("design", {
      status: "pending",
      measure_by: null,
    });
    const t = computeTune(early, "E-1", validExpectations(), "abc123");
    expect(t.stage).toBe("design");
  });
});

// ---------------------------------------------------------------------------
// CLI: arm + score against a real temp repo
// ---------------------------------------------------------------------------

function writeClosedWorkstream(
  repo: EngineRepo,
  hash: string,
  slug: string,
  opts: { outcome?: string[] } = {},
): void {
  repo.write(
    `plan/plan-${hash}-2026-07-05T12:00-${slug}.md`,
    [
      "---",
      `hash: ${hash}`,
      "type: plan",
      "status: done",
      "stage: done",
      "entered_at: prd",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: true",
      "  evals_red: true",
      ...(opts.outcome ?? ["outcome:", "  status: null", "  measure_by: null"]),
      `workstream: _devx/workstreams/${slug}`,
      "---",
      "",
      "## Status log",
      "",
      "- 2026-07-05T12:00 — closed.",
      "",
    ].join("\n"),
  );
  repo.mkdir(`_devx/workstreams/${slug}`);
  repo.write(`_devx/workstreams/${slug}/prd.md`, validPrd());
  repo.write(`_devx/workstreams/${slug}/expectations.md`, validExpectations());
}

function armed(repo: EngineRepo, hash = "abc123", slug = "demo"): void {
  writeClosedWorkstream(repo, hash, slug, {
    outcome: ["outcome:", "  status: pending", "  measure_by: 2026-08-02"],
  });
}

const cliOpts = (repo: EngineRepo, io: ReturnType<typeof captureIo>) => ({
  out: io.out,
  err: io.err,
  projectPath: repo.configPath,
  now: () => NOW,
});

describe("devx outcome arm — CLI", () => {
  it("arms with the +4w default and writes the frontmatter", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "abc123", "demo");
      const io = captureIo();
      const code = runOutcomeArm("abc123", {}, cliOpts(repo, io));
      expect(code).toBe(0);
      expect(io.json()).toMatchObject({
        hash: "abc123",
        armed: true,
        measure_by: "2026-08-02",
        noop: false,
      });
      const st = readEngineState(
        repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md"),
      );
      expect(st.outcome).toEqual({ status: "pending", measure_by: "2026-08-02" });
      // The gate flags and stage survive the arm untouched.
      expect(st.stage).toBe("done");
      expect(st.gateStatus.evals_red).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("--measure-by +6w and absolute dates both resolve", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "abc123", "demo");
      const io = captureIo();
      expect(
        runOutcomeArm("abc123", { measureBy: "+6w" }, cliOpts(repo, io)),
      ).toBe(0);
      expect((io.json() as { measure_by: string }).measure_by).toBe("2026-08-16");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses (exit 1) on a mid-pipeline workstream", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "abc123", "demo");
      const content = repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md");
      repo.write(
        "plan/plan-abc123-2026-07-05T12:00-demo.md",
        content.replace("stage: done", "stage: executing"),
      );
      const io = captureIo();
      expect(runOutcomeArm("abc123", {}, cliOpts(repo, io))).toBe(1);
      expect(io.stderr()).toContain("stage 'done'");
    } finally {
      repo.cleanup();
    }
  });

  it("errors (exit 2) on a bad --measure-by shape, writing nothing", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "abc123", "demo");
      const before = repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md");
      const io = captureIo();
      expect(
        runOutcomeArm("abc123", { measureBy: "soonish" }, cliOpts(repo, io)),
      ).toBe(2);
      expect(repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md")).toBe(before);
    } finally {
      repo.cleanup();
    }
  });
});

const KEEP_FLAGS = {
  verdict: "keep",
  goals: ["G-1=6", "G-2=0"],
  sources: ["G-1=timesheet", "G-2=retro sweep"],
  results: ["G-1=hit", "G-2=hit"],
  reopen: undefined,
  successor: undefined,
  reason: "Both goals hold.",
  notes: "Review time dropped to ~6 min; zero creep incidents recorded.",
  disposition: undefined,
};

describe("devx outcome score — CLI", () => {
  it("keep: writes RESULTS.md (golden vs the real template) + flips outcome.status", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      const code = runOutcomeScore("abc123", { ...KEEP_FLAGS, results: [] }, cliOpts(repo, io));
      expect(code).toBe(0);

      const results = repo.read("_devx/workstreams/demo/RESULTS.md");
      // Golden: the exact rendered artifact (template + these inputs).
      expect(results).toBe(
        [
          "---",
          "outcome: keep",
          "status_reason: 'Both goals hold.'",
          "reviewer: '/devx outcome'",
          "updated: 2026-07-05",
          "reopened_expectations: []   # E-ids, when outcome = tune",
          "successor: null             # workstream slug, when outcome = restart",
          "---",
          "",
          "# Results — demo — 2026-07-05",
          "",
          "<!-- Written by /devx outcome when measure_by comes due. Scores the PRD's",
          "     numeric goals against reality. keep = mechanical; tune/restart/retire =",
          "     recorded judgment. tune reopens via the revision cascade keyed to the",
          "     missed expectations; restart links a v2 workstream with",
          "     learns_from/superseded_by lineage.",
          "     (tune's reopen is verification-scoped: evals_red clears and the stage",
          "     rolls back to red so the missed expectations' RED artifacts re-run;",
          "     revising the expectation/design/plan itself goes through devx revise.) -->",
          "",
          "## Goal scores",
          "",
          "| Goal | Target | Actual | Source | Verdict |",
          "|---|---|---|---|---|",
          "| G-1 | review time per PR under 10 min by 2026-08-01 | 6 | timesheet | recorded |",
          "| G-2 | zero silent scope-creep incidents per month | 0 | retro sweep | recorded |",
          "",
          "## Reading",
          "",
          "Review time dropped to ~6 min; zero creep incidents recorded.",
          "",
          "## Disposition",
          "",
          "keep — goals hold as measured; no reopen, no successor.",
          "",
        ].join("\n"),
      );

      const st = readEngineState(
        repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md"),
      );
      expect(st.outcome.status).toBe("keep");
      // keep is mechanical: no gate flag or stage movement.
      expect(st.stage).toBe("done");
      expect(st.gateStatus.evals_red).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("keep with explicit --result rows renders hit verdicts", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      expect(runOutcomeScore("abc123", KEEP_FLAGS, cliOpts(repo, io))).toBe(0);
      const results = repo.read("_devx/workstreams/demo/RESULTS.md");
      expect(results).toContain("| G-1 | review time per PR under 10 min by 2026-08-01 | 6 | timesheet | hit |");
      expect(
        (io.json() as { goals: Array<{ derivation: string }> }).goals.every(
          (g) => g.derivation === "explicit",
        ),
      ).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("tune: clears evals_red, rolls stage to red, records reopened E-ids", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      const code = runOutcomeScore(
        "abc123",
        {
          ...KEEP_FLAGS,
          verdict: "tune",
          results: ["G-1=hit", "G-2=miss"],
          reopen: "E-2,E-1",
        },
        cliOpts(repo, io),
      );
      expect(code).toBe(0);
      expect(io.json()).toMatchObject({
        verdict: "tune",
        reopened: ["E-1", "E-2"],
        flags_cleared: ["evals_red"],
        stage: "red",
        replay: ["devx gate evals abc123"],
      });
      const st = readEngineState(
        repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md"),
      );
      expect(st.outcome.status).toBe("tune");
      expect(st.stage).toBe("red");
      expect(st.gateStatus.evals_red).toBe(false);
      // Earlier gates survive — the cascade is evals-scoped.
      expect(st.gateStatus.plan_verified).toBe(true);
      const results = repo.read("_devx/workstreams/demo/RESULTS.md");
      expect(results).toContain("reopened_expectations: [E-1, E-2]");
    } finally {
      repo.cleanup();
    }
  });

  it("tune without --reopen is a flag error (exit 2, symmetric with restart), nothing written", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      const code = runOutcomeScore(
        "abc123",
        { ...KEEP_FLAGS, verdict: "tune" },
        cliOpts(repo, io),
      );
      expect(code).toBe(2);
      expect(io.stderr()).toContain("--reopen");
      expect(repo.exists("_devx/workstreams/demo/RESULTS.md")).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it("restart: stamps successor + superseded_by here, learns_from on the successor spec", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      // Successor workstream spec already scaffolded.
      repo.write(
        "plan/plan-def456-2026-07-05T13:00-demo-v2.md",
        [
          "---",
          "hash: def456",
          "type: plan",
          "status: in-progress",
          "stage: prd",
          "workstream: _devx/workstreams/demo-v2",
          "---",
          "body",
          "",
        ].join("\n"),
      );
      const io = captureIo();
      const code = runOutcomeScore(
        "abc123",
        { ...KEEP_FLAGS, verdict: "restart", successor: "demo-v2" },
        cliOpts(repo, io),
      );
      expect(code).toBe(0);
      expect(io.json()).toMatchObject({
        verdict: "restart",
        successor: "demo-v2",
        successor_hash: "def456",
        successor_spec: "plan/plan-def456-2026-07-05T13:00-demo-v2.md",
      });
      const oldSpec = repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md");
      expect(oldSpec).toContain("successor: demo-v2");
      expect(oldSpec).toContain("superseded_by: def456");
      const newSpec = repo.read("plan/plan-def456-2026-07-05T13:00-demo-v2.md");
      expect(newSpec).toContain("learns_from: abc123");
      expect(repo.read("_devx/workstreams/demo/RESULTS.md")).toContain(
        "successor: demo-v2",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("restart with no successor spec yet still stamps + says what to run", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      const code = runOutcomeScore(
        "abc123",
        { ...KEEP_FLAGS, verdict: "restart", successor: "demo-v2" },
        cliOpts(repo, io),
      );
      expect(code).toBe(0);
      const json = io.json() as { successor_spec: null; note: string };
      expect(json.successor_spec).toBeNull();
      expect(json.note).toContain("devx workstream new demo-v2");
      expect(
        repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md"),
      ).toContain("successor: demo-v2");
    } finally {
      repo.cleanup();
    }
  });

  it("retire: outcome.status only — stage and gates untouched", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      expect(
        runOutcomeScore("abc123", { ...KEEP_FLAGS, verdict: "retire" }, cliOpts(repo, io)),
      ).toBe(0);
      const st = readEngineState(
        repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md"),
      );
      expect(st.outcome.status).toBe("retire");
      expect(st.stage).toBe("done");
      expect(st.gateStatus.evals_red).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses (exit 1) an incomplete goal set, writing nothing", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      const code = runOutcomeScore(
        "abc123",
        { ...KEEP_FLAGS, goals: ["G-1=6"] },
        cliOpts(repo, io),
      );
      expect(code).toBe(1);
      expect(io.stderr()).toContain("missing: G-2");
      expect(repo.exists("_devx/workstreams/demo/RESULTS.md")).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses (exit 1) a re-score once a verdict is recorded", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io1 = captureIo();
      expect(runOutcomeScore("abc123", KEEP_FLAGS, cliOpts(repo, io1))).toBe(0);
      const io2 = captureIo();
      expect(runOutcomeScore("abc123", KEEP_FLAGS, cliOpts(repo, io2))).toBe(1);
      expect(io2.stderr()).toContain("already scored");
    } finally {
      repo.cleanup();
    }
  });

  it("recovers over crash-residue RESULTS.md (status unscored) and reports the overwrite", () => {
    // A RESULTS.md while outcome.status is still pending is residue from a
    // run that died between the RESULTS write and the spec flip — refusing
    // would wedge the score forever (adversarial-review BH#3). Status
    // frontmatter is the source of truth: overwrite + say so.
    const repo = makeEngineRepo();
    try {
      armed(repo);
      repo.write("_devx/workstreams/demo/RESULTS.md", "stale crash residue");
      const io = captureIo();
      expect(runOutcomeScore("abc123", KEEP_FLAGS, cliOpts(repo, io))).toBe(0);
      expect(
        (io.json() as { overwrote_stale_results: boolean }).overwrote_stale_results,
      ).toBe(true);
      expect(repo.read("_devx/workstreams/demo/RESULTS.md")).toContain(
        "outcome: keep",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("a SCORED outcome still protects its RESULTS.md (already-scored refusal fires first)", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io1 = captureIo();
      expect(runOutcomeScore("abc123", KEEP_FLAGS, cliOpts(repo, io1))).toBe(0);
      const before = repo.read("_devx/workstreams/demo/RESULTS.md");
      const io2 = captureIo();
      expect(runOutcomeScore("abc123", KEEP_FLAGS, cliOpts(repo, io2))).toBe(1);
      expect(repo.read("_devx/workstreams/demo/RESULTS.md")).toBe(before);
    } finally {
      repo.cleanup();
    }
  });

  it("restart refuses when TWO plan specs claim the successor workstream (no arbitrary lineage)", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      for (const [hash, name] of [
        ["def456", "plan/plan-def456-2026-07-05T13:00-demo-v2.md"],
        ["fed654", "plan/plan-fed654-2026-07-05T13:01-demo-v2-again.md"],
      ] as const) {
        repo.write(
          name,
          [
            "---",
            `hash: ${hash}`,
            "type: plan",
            "status: in-progress",
            "stage: prd",
            "workstream: _devx/workstreams/demo-v2",
            "---",
            "body",
            "",
          ].join("\n"),
        );
      }
      const io = captureIo();
      expect(
        runOutcomeScore(
          "abc123",
          { ...KEEP_FLAGS, verdict: "restart", successor: "demo-v2" },
          cliOpts(repo, io),
        ),
      ).toBe(1);
      expect(io.stderr()).toContain("2 plan specs claim");
      expect(repo.exists("_devx/workstreams/demo/RESULTS.md")).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it("errors (exit 2) on an unknown verdict", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      expect(
        runOutcomeScore("abc123", { ...KEEP_FLAGS, verdict: "sunset" }, cliOpts(repo, io)),
      ).toBe(2);
      expect(io.stderr()).toContain("keep | tune | restart | retire");
    } finally {
      repo.cleanup();
    }
  });

  it("errors (exit 2) on --reopen/--successor with the wrong verdict", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      expect(
        runOutcomeScore("abc123", { ...KEEP_FLAGS, reopen: "E-1" }, cliOpts(repo, io)),
      ).toBe(2);
      expect(
        runOutcomeScore(
          "abc123",
          { ...KEEP_FLAGS, successor: "demo-v2" },
          cliOpts(repo, io),
        ),
      ).toBe(2);
    } finally {
      repo.cleanup();
    }
  });

  it("round-trip: score writes survive readEngineState + preserve the status log", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      expect(runOutcomeScore("abc123", KEEP_FLAGS, cliOpts(repo, io))).toBe(0);
      const spec = repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md");
      expect(spec).toContain("- 2026-07-05T12:00 — closed.");
      expect(readEngineState(spec).outcome.measure_by).toBe("2026-08-02");
    } finally {
      repo.cleanup();
    }
  });
});

describe("regression — write hygiene", () => {
  it("a literal $& in --reason lands verbatim (no String.replace expansion)", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      expect(
        runOutcomeScore(
          "abc123",
          { ...KEEP_FLAGS, reason: "cost hit $& stayed under $$100" },
          cliOpts(repo, io),
        ),
      ).toBe(0);
      expect(repo.read("_devx/workstreams/demo/RESULTS.md")).toContain(
        "status_reason: 'cost hit $& stayed under $$100'",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("a frontmatter-less successor spec is skipped by the adoption walk (scaffold-later), score stays atomic", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      // No frontmatter → readEngineState yields workstream:null → the walk
      // can't adopt it; the restart falls back to the scaffold-later branch
      // instead of throwing mid-write.
      repo.write(
        "plan/plan-def456-2026-07-05T13:00-demo-v2.md",
        "no frontmatter here\nworkstream: _devx/workstreams/demo-v2\n",
      );
      const io = captureIo();
      const code = runOutcomeScore(
        "abc123",
        { ...KEEP_FLAGS, verdict: "restart", successor: "demo-v2" },
        cliOpts(repo, io),
      );
      expect(code).toBe(0);
      expect((io.json() as { successor_spec: null }).successor_spec).toBeNull();
      expect(repo.exists("_devx/workstreams/demo/RESULTS.md")).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("compute-then-write: a compute failure surfaces as exit 2 with NOTHING written", () => {
    const repo = makeEngineRepo();
    try {
      armed(repo);
      const io = captureIo();
      // fs seam: reading files back for patch computation is fine, but the
      // OLD spec's content is corrupted between resolve and patch via a
      // readFile override that serves a frontmatter-less body to the
      // patcher's input path... not reachable — the patch uses ws.content
      // from resolve time. So drive the failure through the seam that IS
      // reachable: make renderResults' template unreadable → OutcomeError
      // (exit 2) BEFORE any write happens.
      const realRead = repo.read.bind(repo);
      const code = runOutcomeScore("abc123", KEEP_FLAGS, {
        ...cliOpts(repo, io),
        fs: {
          readFile: (p: string) => {
            if (p.endsWith("results.md")) {
              return "# not the template";
            }
            return realRead(p.startsWith(repo.root) ? p.slice(repo.root.length + 1) : p);
          },
        },
      });
      expect(code).toBe(2);
      expect(io.stderr()).toContain("template");
      expect(repo.exists("_devx/workstreams/demo/RESULTS.md")).toBe(false);
      // Spec untouched — the run is fully re-runnable.
      expect(
        repo.read("plan/plan-abc123-2026-07-05T12:00-demo.md"),
      ).toContain("status: pending");
    } finally {
      repo.cleanup();
    }
  });
});

describe("renderResults — template drift guard", () => {
  it("throws OutcomeError when a placeholder is missing from the template", () => {
    expect(() =>
      renderResults({
        template: "# not the template",
        workstreamTitle: "demo",
        date: "2026-07-05",
        verdict: "keep",
        statusReason: "x",
        rows: [],
        reading: "r",
        disposition: "d",
        reopened: [],
        successor: null,
      }),
    ).toThrow(OutcomeError);
  });
});
