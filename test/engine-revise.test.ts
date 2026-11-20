// Adversarial tests for `devx revise` (v2e101 AC #6): the §4.9 cascade
// table (prd/expectations → 4 flags; design → 3; plan → 2), stage rollback
// (never forward), the replay path, refusal on unknown/foreign artifacts,
// and the guarantee that the touched artifact itself is never edited.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRevise } from "../src/commands/revise.js";
import {
  type EngineState,
  readEngineState,
} from "../src/lib/engine/frontmatter.js";
import {
  CASCADE_TABLE,
  EMITTED_DISPOSITIONS,
  KNOWN_ARTIFACTS,
  cascadeFor,
  computeRevise,
  dispositionFor,
  emittedCounts,
  emittedSpecsFor,
  replayPath,
} from "../src/lib/engine/revise.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
} from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// Pure layer
// ---------------------------------------------------------------------------

describe("cascade table (§4.9, pinned)", () => {
  it("matches the design doc row-for-row", () => {
    // Keyed on identities since dlr105, so the row shape is asserted through
    // `display` + `artifact` rather than a bare path — the re-key is exactly
    // the kind of change that should have to restate this table.
    expect(CASCADE_TABLE).toEqual([
      {
        artifact: { kind: "agent", stage: "prd" },
        display: "prd/agent.md",
        resets: ["prd_validated", "design_verified", "plan_verified", "evals_red"],
        stage: "prd",
      },
      {
        artifact: { kind: "expectations" },
        display: "expectations.md",
        resets: ["prd_validated", "design_verified", "plan_verified", "evals_red"],
        stage: "prd",
      },
      {
        artifact: { kind: "agent", stage: "design" },
        display: "design/agent.md",
        resets: ["design_verified", "plan_verified", "evals_red"],
        stage: "design",
      },
      {
        artifact: { kind: "agent", stage: "plan" },
        display: "plan/agent.md",
        resets: ["plan_verified", "evals_red"],
        stage: "plan",
      },
    ]);
  });

  it("KNOWN_ARTIFACTS renders paths, not [object Object]", () => {
    // `KNOWN_ARTIFACTS` is joined into the CLI's help string and its
    // unknown-artifact refusal. Re-keying the table on an object without a
    // display projection renders both as `[object Object], [object Object]…`,
    // and nothing else in the suite would have noticed.
    expect(KNOWN_ARTIFACTS).toEqual([
      "prd/agent.md",
      "expectations.md",
      "design/agent.md",
      "plan/agent.md",
    ]);
    expect(KNOWN_ARTIFACTS.join(" | ")).not.toContain("object Object");
  });

  it("cascadeFor matches on basename, full paths included", () => {
    expect(cascadeFor("prd/agent.md")!.stage).toBe("prd");
    expect(cascadeFor("_devx/workstreams/demo/design/agent.md")!.stage).toBe("design");
    expect(cascadeFor("notes.md")).toBeNull();
    expect(cascadeFor("prd/agent.md.bak")).toBeNull();
  });

  it("resolves BOTH layouts' spellings to the same row (R-4)", () => {
    // The whole point of the identity re-key: `cascadeFor` takes no layout,
    // so a flat-era `--touched design.md` typed against a folder-layout repo
    // and the same string typed against a flat one land on one row. Refusing
    // either would silently leave stale gate flags over a rewritten artifact.
    for (const [ws, flat, stage] of [
      ["prd/agent.md", "prd.md", "prd"],
      ["design/agent.md", "design.md", "design"],
      ["plan/agent.md", "plan.md", "plan"],
    ] as const) {
      expect(cascadeFor(flat)!.stage, flat).toBe(stage);
      expect(cascadeFor(flat)).toBe(cascadeFor(ws));
      // …and inside a workstream path, which is how a `--touched` copied out
      // of a diff arrives.
      expect(cascadeFor(`_devx/workstreams/demo/${ws}`)).toBe(cascadeFor(ws));
    }
  });

  it("the bare-stage shorthand still resolves, and only for the three stages", () => {
    expect(cascadeFor("prd")!.stage).toBe("prd");
    expect(cascadeFor("design")!.stage).toBe("design");
    expect(cascadeFor("plan")!.stage).toBe("plan");
    // evals has no cascade row — RED artifacts re-run, they don't roll a
    // stage back — and the shorthand must not invent one.
    expect(cascadeFor("evals")).toBeNull();
  });

  it("refuses an ambiguous or near-miss name rather than guessing", () => {
    // A bare companion basename belongs to no single stage. Refusing is
    // recoverable; resolving to the wrong row leaves stale gate flags
    // standing over a rewritten artifact, which nothing downstream detects.
    for (const ambiguous of ["agent.md", "human.md", "outline-critique.md"]) {
      expect(cascadeFor(ambiguous), ambiguous).toBeNull();
    }
    // Fully-spelled companions resolve to real identities and STILL do not
    // cascade — refreshing a digest or a critique is not a revision.
    for (const companion of [
      "prd/human.md",
      "prd-human.md",
      "design/outline-critique.md",
      "design-outline-critique.md",
    ]) {
      expect(cascadeFor(companion), companion).toBeNull();
    }
    // Case is NOT folded, and `PLAN.md` is the reason: devx's own backlog
    // sits beside the doc set's `plan.md` under `project-level`, so folding
    // case would cascade the plan gates for a backlog edit.
    for (const nearMiss of ["PLAN.md", "PRD", "Design.md", "prd/AGENT.md"]) {
      expect(cascadeFor(nearMiss), nearMiss).toBeNull();
    }
    // The shorthand lookup is keyed by raw user input. On an object literal
    // these reach Object.prototype and hand back a function where an
    // ArtifactKind is expected.
    for (const proto of ["constructor", "toString", "valueOf", "__proto__"]) {
      expect(cascadeFor(proto), proto).toBeNull();
    }
  });

  it("survives odd but legal --touched shapes", () => {
    // `./prd.md` and `x/../prd.md` normalize to a real artifact; a resolver
    // that only tried the two-segment tail would miss both.
    expect(cascadeFor("./prd.md")!.stage).toBe("prd");
    expect(cascadeFor("./prd/agent.md")!.stage).toBe("prd");
    expect(cascadeFor("prd\\agent.md")!.stage).toBe("prd"); // Windows separator
    expect(cascadeFor("design/agent.md/")!.stage).toBe("design"); // trailing slash
    expect(cascadeFor("")).toBeNull();
    expect(cascadeFor("/")).toBeNull();
  });

  it("root artifacts that are not cascade rows stay refused", () => {
    // `todo.md` and `RESULTS.md` are real identities the reverse index owns.
    // Resolving an identity is not the same as having a cascade row, and a
    // `find` that fell back to "closest row" would clear gate flags for a
    // derived working-memory file.
    for (const rel of ["todo.md", "RESULTS.md", "evals/RED-report.md"]) {
      expect(cascadeFor(rel), rel).toBeNull();
    }
    expect(cascadeFor("expectations.md")!.stage).toBe("prd");
  });
});

function allTrueState(
  stage: "executing" | "red" | "plan" | "design" | "prd" = "executing",
): EngineState {
  return {
    hash: "abc123",
    type: "plan",
    status: "in-progress",
    stage,
    enteredAt: "prd",
    gateStatus: {
      prd_validated: true,
      design_verified: true,
      plan_verified: true,
      evals_red: true,
    },
    redEvalShas: {},
    evalsLocked: false,
    redEvalIds: {},
    gateVerdicts: { prd: null, design: null, plan: null, evals: null },
    outcome: { status: null, measure_by: null },
    workstream: "_devx/workstreams/demo",
    blockedBy: [],
    plan: null,
    phase: null,
  };
}

describe("computeRevise", () => {
  it("prd/agent.md from executing: clears all 4 flags, stage → prd, full replay", () => {
    const c = computeRevise(allTrueState(), cascadeFor("prd/agent.md")!, "abc123");
    expect(c.flagsCleared).toEqual([
      "prd_validated",
      "design_verified",
      "plan_verified",
      "evals_red",
    ]);
    expect(c.verdictsCleared).toEqual(["prd", "design", "plan", "evals"]);
    expect(c.stage).toBe("prd");
    expect(c.replay).toEqual([
      "devx gate prd abc123",
      "devx gate coverage abc123  # design mode",
      "devx gate coverage abc123  # plan mode",
      "devx gate evals abc123",
    ]);
  });

  it("design/agent.md: clears 3 flags, prd_validated survives", () => {
    const c = computeRevise(allTrueState(), cascadeFor("design/agent.md")!, "abc123");
    expect(c.flagsCleared).toEqual(["design_verified", "plan_verified", "evals_red"]);
    expect(c.verdictsCleared).toEqual(["design", "plan", "evals"]);
    expect(c.stage).toBe("design");
    expect(c.replay[0]).toContain("gate coverage");
  });

  it("plan/agent.md: clears 2 flags, replay is coverage(plan) + evals", () => {
    const c = computeRevise(allTrueState(), cascadeFor("plan/agent.md")!, "abc123");
    expect(c.flagsCleared).toEqual(["plan_verified", "evals_red"]);
    expect(c.replay).toEqual([
      "devx gate coverage abc123  # plan mode",
      "devx gate evals abc123",
    ]);
  });

  it("stage never advances: touching plan/agent.md at stage prd keeps stage prd", () => {
    const state = {
      ...allTrueState("prd"),
      gateStatus: {
        prd_validated: false,
        design_verified: false,
        plan_verified: false,
        evals_red: false,
      },
    };
    const c = computeRevise(state, cascadeFor("plan/agent.md")!, "abc123");
    expect(c.stage).toBe("prd");
    expect(c.flagsCleared).toEqual([]); // nothing was set — reports the delta
    expect(c.resets).toEqual(["plan_verified", "evals_red"]);
    // verdictsCleared is the FULL reset set, not the flags-true delta — a
    // FAIL verdict lives on a false flag and must still be erased.
    expect(c.verdictsCleared).toEqual(["plan", "evals"]);
  });

  it("replayPath from every stage", () => {
    expect(replayPath("prd", "h1")).toHaveLength(4);
    expect(replayPath("design", "h1")).toHaveLength(3);
    expect(replayPath("plan", "h1")).toHaveLength(2);
    expect(replayPath("red", "h1")).toEqual(["devx gate evals h1"]);
    expect(replayPath("intake", "h1")).toHaveLength(4);
    expect(replayPath("executing", "h1")).toEqual([]);
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

function seed(verdicts?: string[]): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      "stage: executing",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: true",
      "  evals_red: true",
      ...(verdicts ? ["gate_verdicts:", ...verdicts.map((l) => `  ${l}`)] : []),
      `workstream: ${WS}`,
      "---",
      "",
      "## Status log",
      "",
      "- created.",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd/agent.md`, "# the prd\n");
  repo.write(`${WS}/design/agent.md`, "# the design\n");
  repo.write(`${WS}/plan/agent.md`, "# the plan\n");
}

function revise(touched: string) {
  const io = captureIo();
  const code = runRevise(["abc123"], { touched }, {
    ...io,
    projectPath: repo.configPath,
  });
  return { code, io };
}

describe("devx revise — CLI driver", () => {
  it("design/agent.md cascade: flags reset, stage rolled back, replay printed", () => {
    seed();
    const { code, io } = revise("design/agent.md");
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.resets).toEqual(["design_verified", "plan_verified", "evals_red"]);
    expect(j.stage).toBe("design");
    expect(j.replay).toEqual([
      "devx gate coverage abc123  # design mode",
      "devx gate coverage abc123  # plan mode",
      "devx gate evals abc123",
    ]);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.prd_validated).toBe(true);
    expect(state.gateStatus.design_verified).toBe(false);
    expect(state.gateStatus.plan_verified).toBe(false);
    expect(state.gateStatus.evals_red).toBe(false);
    expect(state.stage).toBe("design");
  });

  it("design/agent.md cascade erases reset gates' verdicts; prd's survives (hfi102)", () => {
    seed(["prd: PASS", "design: CONCERNS", "plan: PASS", "evals: PASS"]);
    const { code } = revise("design/agent.md");
    expect(code).toBe(0);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateVerdicts.prd).toBe("PASS");
    expect(state.gateVerdicts.design).toBe(null);
    expect(state.gateVerdicts.plan).toBe(null);
    expect(state.gateVerdicts.evals).toBe(null);
  });

  it("erases a FAIL verdict sitting on an already-false flag", () => {
    seed(["prd: PASS", "design: PASS", "plan: FAIL", "evals: null"]);
    // plan_verified false + FAIL verdict: the honest-history state after a
    // failed gate run. Revise must erase the FAIL, not just the true flags.
    repo.write(
      SPEC_REL,
      repo.read(SPEC_REL).replace("  plan_verified: true", "  plan_verified: false"),
    );
    const { code } = revise("plan/agent.md");
    expect(code).toBe(0);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateVerdicts.plan).toBe(null);
    expect(state.gateVerdicts.design).toBe("PASS"); // untouched by plan row
  });

  it("legacy spec without gate_verdicts: revise stays clean (all-null map)", () => {
    seed();
    const { code } = revise("plan/agent.md");
    expect(code).toBe(0);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateVerdicts).toEqual({
      prd: null,
      design: null,
      plan: null,
      evals: null,
    });
  });

  it("expectations.md resets all four flags (same row as prd/agent.md)", () => {
    seed();
    const { code } = revise("expectations.md");
    expect(code).toBe(0);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.prd_validated).toBe(false);
    expect(state.stage).toBe("prd");
  });

  it("accepts the workstream-relative path form", () => {
    seed();
    const { code } = revise(`${WS}/plan/agent.md`);
    expect(code).toBe(0);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.design_verified).toBe(true); // untouched by plan row
    expect(state.gateStatus.plan_verified).toBe(false);
    expect(state.stage).toBe("plan");
  });

  it("never edits the touched artifact itself", () => {
    seed();
    revise("design/agent.md");
    expect(repo.read(`${WS}/design/agent.md`)).toBe("# the design\n");
  });

  it("preserves the status-log body through the frontmatter rewrite", () => {
    seed();
    revise("prd/agent.md");
    expect(repo.read(SPEC_REL)).toContain("- created.");
  });

  it("refuses an unknown artifact (exit 1), spec untouched", () => {
    seed();
    const before = repo.read(SPEC_REL);
    const { code, io } = revise("notes.md");
    expect(code).toBe(1);
    expect(io.stderr()).toContain("unknown artifact 'notes.md'");
    expect(io.stderr()).toContain("prd/agent.md, expectations.md, design/agent.md, plan/agent.md");
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("refuses a path into a DIFFERENT workstream (exit 1)", () => {
    seed();
    const before = repo.read(SPEC_REL);
    const { code, io } = revise("_devx/workstreams/other-stream/design/agent.md");
    expect(code).toBe(1);
    expect(io.stderr()).toContain("not an artifact of workstream");
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("all three entry.artifact consumers print paths, not [object Object]", () => {
    // dlr105 AC 3. `entry.artifact` became an `ArtifactKind` — an object —
    // and it feeds three user-visible surfaces. Interpolating one renders
    // `[object Object]`, which is not a crash and not a test failure
    // anywhere else: the command still exits 0 and still writes the right
    // frontmatter. Only these assertions would notice.
    seed();

    // 1. the JSON `touched:` output
    const { code, io } = revise("prd");
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.touched).toBe("prd/agent.md");

    // 2. the unknown-artifact refusal's covered list
    const unknown = revise("notes.md");
    expect(unknown.io.stderr()).not.toContain("object Object");
    expect(unknown.io.stderr()).toContain("prd/agent.md");

    // 3. the cross-workstream refusal's expected-path hint
    const foreign = revise("_devx/workstreams/other-stream/design/agent.md");
    expect(foreign.io.stderr()).not.toContain("object Object");
    expect(foreign.io.stderr()).toContain(`expected ${WS}/design/agent.md`);
  });

  it("accepts the flat-era spelling in a folder-layout repo (R-4)", () => {
    // A `--touched design.md` typed from a pre-migration decisions/ report
    // has to keep working, and it has to keep working END TO END: resolving
    // in `cascadeFor` and then being refused by the CLI's containment check
    // would be the same regression one layer down.
    seed();
    const { code, io } = revise("design.md");
    expect(code).toBe(0);
    expect((io.json() as Record<string, unknown>).stage).toBe("design");
    expect(readEngineState(repo.read(SPEC_REL)).gateStatus.design_verified).toBe(false);
  });

  it("missing --touched → exit 2 usage error", () => {
    seed();
    const io = captureIo();
    const code = runRevise(["abc123"], {}, { ...io, projectPath: repo.configPath });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("--touched");
  });

  it("unknown hash → exit 2", () => {
    const { code, io } = (() => {
      const io2 = captureIo();
      const c = runRevise(["zz9999"], { touched: "prd/agent.md" }, {
        ...io2,
        projectPath: repo.configPath,
      });
      return { code: c, io: io2 };
    })();
    expect(code).toBe(2);
    expect(io.stderr()).toContain("no plan spec");
  });

  it("is idempotent: a second identical revise is a clean no-op re-write", () => {
    seed();
    revise("plan/agent.md");
    const afterFirst = repo.read(SPEC_REL);
    const { code, io } = revise("plan/agent.md");
    expect(code).toBe(0);
    expect(repo.read(SPEC_REL)).toBe(afterFirst);
    expect((io.json() as { flags_cleared: string[] }).flags_cleared).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Emitted dev specs (A14 mid-execution half)
// ---------------------------------------------------------------------------

describe("dispositionFor — status → what the backward path owes", () => {
  it("maps the four live statuses", () => {
    expect(dispositionFor("ready")).toBe("block");
    expect(dispositionFor("in-progress")).toBe("halt");
    expect(dispositionFor("done")).toBe("shipped");
    expect(dispositionFor("blocked")).toBe("already-blocked");
  });

  it("is case- and whitespace-insensitive (frontmatter is hand-edited)", () => {
    expect(dispositionFor(" Ready ")).toBe("block");
    expect(dispositionFor("IN-PROGRESS")).toBe("halt");
  });

  it("reports an unrecognized or absent status rather than guessing", () => {
    // `unknown` exists so a typo'd status surfaces in the report instead of
    // defaulting to `shipped` (silently dropped) or `block` (a spurious edit
    // proposal on a spec nobody can classify).
    expect(dispositionFor(null)).toBe("unknown");
    expect(dispositionFor("")).toBe("unknown");
    expect(dispositionFor("reddy")).toBe("unknown");
  });

  it("every disposition is reachable from some status (no dead arm)", () => {
    const reached = new Set(
      ["ready", "in-progress", "done", "blocked", "nonsense"].map(dispositionFor),
    );
    expect([...reached].sort()).toEqual([...EMITTED_DISPOSITIONS].sort());
  });
});

describe("emittedCounts", () => {
  it("carries every key, zeros included (halt: 0 is the proceed signal)", () => {
    expect(emittedCounts([])).toEqual({
      block: 0,
      halt: 0,
      shipped: 0,
      "already-blocked": 0,
      unknown: 0,
    });
  });
});

describe("emittedSpecsFor — the plan's executable face", () => {
  let r: EngineRepo;
  beforeEach(() => {
    r = makeEngineRepo();
  });
  afterEach(() => r.cleanup());

  const fs = () => ({
    exists: (p: string) => existsSync(p),
    readdir: (p: string) => readdirSync(p),
    readFile: (p: string) => readFileSync(p, "utf8"),
  });

  function devSpec(
    name: string,
    fm: Record<string, string | number>,
  ): void {
    r.write(
      `dev/${name}`,
      [
        "---",
        ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`),
        "---",
        "",
        "## Status log",
        "",
      ].join("\n"),
    );
  }

  it("returns [] when dev/ does not exist", () => {
    expect(emittedSpecsFor(r.root, WS, fs())).toEqual([]);
  });

  it("collects only specs whose plan: points at THIS workstream", () => {
    devSpec("dev-aaa111-2026-01-01T00:00-one.md", {
      hash: "aaa111",
      type: "dev",
      status: "ready",
      phase: 1,
      plan: WS,
    });
    devSpec("dev-bbb222-2026-01-01T00:00-elsewhere.md", {
      hash: "bbb222",
      type: "dev",
      status: "ready",
      phase: 1,
      plan: "_devx/workstreams/other-stream",
    });
    const got = emittedSpecsFor(r.root, WS, fs());
    expect(got.map((s) => s.hash)).toEqual(["aaa111"]);
  });

  it("normalizes both sides of the pointer (`./x`, `x/`, `x` are one workstream)", () => {
    // A raw === here reports an empty list, which reads exactly like
    // "this revision reopens nothing" — the worst possible failure shape.
    devSpec("dev-ccc333-2026-01-01T00:00-trailing.md", {
      hash: "ccc333",
      type: "dev",
      status: "ready",
      phase: 2,
      plan: `./${WS}/`,
    });
    expect(emittedSpecsFor(r.root, `${WS}/`, fs()).map((s) => s.hash)).toEqual(["ccc333"]);
  });

  it("matches the root doc set under project-level (both sides normalize to '')", () => {
    devSpec("dev-ddd444-2026-01-01T00:00-flat.md", {
      hash: "ddd444",
      type: "dev",
      status: "ready",
      phase: 1,
      plan: ".",
    });
    expect(emittedSpecsFor(r.root, ".", fs()).map((s) => s.hash)).toEqual(["ddd444"]);
  });

  it("orders by phase, phase-less last, hash as the stable tiebreak", () => {
    const mk = (hash: string, phase: number | null) =>
      devSpec(`dev-${hash}-2026-01-01T00:00-x.md`, {
        hash,
        type: "dev",
        status: "ready",
        ...(phase === null ? {} : { phase }),
        plan: WS,
      });
    mk("zzz999", 1);
    mk("aaa111", 1);
    mk("mmm555", null);
    mk("bbb222", 3);
    expect(emittedSpecsFor(r.root, WS, fs()).map((s) => s.hash)).toEqual([
      "aaa111",
      "zzz999",
      "bbb222",
      "mmm555",
    ]);
  });

  it("skips a spec with no plan: pointer, and files one with no phase", () => {
    devSpec("dev-eee555-2026-01-01T00:00-orphan.md", {
      hash: "eee555",
      type: "dev",
      status: "ready",
    });
    devSpec("dev-fff666-2026-01-01T00:00-direct.md", {
      hash: "fff666",
      type: "dev",
      status: "ready",
      plan: WS,
    });
    const got = emittedSpecsFor(r.root, WS, fs());
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ hash: "fff666", phase: null, disposition: "block" });
  });

  it("ignores non-dev filenames in dev/", () => {
    r.write("dev/README.md", "notes\n");
    r.write("dev/dev-ggg777-2026-01-01T00:00-x.txt", "nope\n");
    expect(emittedSpecsFor(r.root, WS, fs())).toEqual([]);
  });
});

describe("devx revise — emitted dev specs in the report", () => {
  function emit(hash: string, status: string, phase: number): void {
    repo.write(
      `dev/dev-${hash}-2026-01-01T00:00-phase.md`,
      ["---", `hash: ${hash}`, "type: dev", `status: ${status}`, `phase: ${phase}`, `plan: ${WS}`, "---", ""].join("\n"),
    );
  }

  it("lists every emitted spec with a disposition and the counts", () => {
    seed();
    emit("aaa111", "ready", 1);
    emit("bbb222", "in-progress", 2);
    emit("ccc333", "done", 3);
    emit("ddd444", "blocked", 4);
    const { code, io } = revise("design/agent.md");
    expect(code).toBe(0);
    const j = io.json() as {
      emitted: Array<Record<string, unknown>>;
      emitted_counts: Record<string, number>;
    };
    expect(j.emitted.map((s) => [s.hash, s.disposition])).toEqual([
      ["aaa111", "block"],
      ["bbb222", "halt"],
      ["ccc333", "shipped"],
      ["ddd444", "already-blocked"],
    ]);
    expect(j.emitted_counts).toEqual({
      block: 1,
      halt: 1,
      shipped: 1,
      "already-blocked": 1,
      unknown: 0,
    });
    expect(j.emitted[0].spec).toBe("dev/dev-aaa111-2026-01-01T00:00-phase.md");
  });

  it("NEVER edits an emitted spec — report only", () => {
    // The boundary the whole design rests on: an in-progress spec holds a
    // claim lock and a live worktree (the dvxret resume-collision shape).
    seed();
    emit("aaa111", "ready", 1);
    emit("bbb222", "in-progress", 2);
    const before = [
      repo.read("dev/dev-aaa111-2026-01-01T00:00-phase.md"),
      repo.read("dev/dev-bbb222-2026-01-01T00:00-phase.md"),
    ];
    revise("prd/agent.md");
    expect([
      repo.read("dev/dev-aaa111-2026-01-01T00:00-phase.md"),
      repo.read("dev/dev-bbb222-2026-01-01T00:00-phase.md"),
    ]).toEqual(before);
  });

  it("warns on stderr about claimed and claimable specs, naming hashes", () => {
    seed();
    emit("aaa111", "ready", 1);
    emit("bbb222", "in-progress", 2);
    const { io } = revise("plan/agent.md");
    expect(io.stderr()).toContain("1 emitted dev spec(s) are in-progress");
    expect(io.stderr()).toContain("bbb222");
    expect(io.stderr()).toContain("verify claim ownership");
    expect(io.stderr()).toContain("1 emitted dev spec(s) are still ready");
    expect(io.stderr()).toContain("aaa111");
  });

  it("stdout stays pure JSON when the warnings fire", () => {
    // captureIo().json() reads the LAST stdout line; a warning written to
    // stdout would shift it and silently break every scripted consumer.
    seed();
    emit("bbb222", "in-progress", 2);
    const { io } = revise("plan/agent.md");
    expect(io.stdout().trim().split("\n")).toHaveLength(1);
    expect(() => io.json()).not.toThrow();
  });

  it("is silent and empty when the plan emitted nothing yet", () => {
    seed();
    const { io } = revise("design/agent.md");
    const j = io.json() as { emitted: unknown[]; emitted_counts: Record<string, number> };
    expect(j.emitted).toEqual([]);
    expect(j.emitted_counts.halt).toBe(0);
    expect(io.stderr()).toBe("");
  });
});
