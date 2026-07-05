// Adversarial tests for `devx revise` (v2e101 AC #6): the §4.9 cascade
// table (prd/expectations → 4 flags; design → 3; plan → 2), stage rollback
// (never forward), the replay path, refusal on unknown/foreign artifacts,
// and the guarantee that the touched artifact itself is never edited.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRevise } from "../src/commands/revise.js";
import {
  type EngineState,
  readEngineState,
} from "../src/lib/engine/frontmatter.js";
import {
  CASCADE_TABLE,
  cascadeFor,
  computeRevise,
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
    expect(CASCADE_TABLE).toEqual([
      {
        artifact: "prd.md",
        resets: ["prd_validated", "design_verified", "plan_verified", "evals_red"],
        stage: "prd",
      },
      {
        artifact: "expectations.md",
        resets: ["prd_validated", "design_verified", "plan_verified", "evals_red"],
        stage: "prd",
      },
      {
        artifact: "design.md",
        resets: ["design_verified", "plan_verified", "evals_red"],
        stage: "design",
      },
      {
        artifact: "plan.md",
        resets: ["plan_verified", "evals_red"],
        stage: "plan",
      },
    ]);
  });

  it("cascadeFor matches on basename, full paths included", () => {
    expect(cascadeFor("prd.md")!.stage).toBe("prd");
    expect(cascadeFor("_devx/workstreams/demo/design.md")!.stage).toBe("design");
    expect(cascadeFor("notes.md")).toBeNull();
    expect(cascadeFor("prd.md.bak")).toBeNull();
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
    outcome: { status: null, measure_by: null },
    workstream: "_devx/workstreams/demo",
    blockedBy: [],
  };
}

describe("computeRevise", () => {
  it("prd.md from executing: clears all 4 flags, stage → prd, full replay", () => {
    const c = computeRevise(allTrueState(), cascadeFor("prd.md")!, "abc123");
    expect(c.flagsCleared).toEqual([
      "prd_validated",
      "design_verified",
      "plan_verified",
      "evals_red",
    ]);
    expect(c.stage).toBe("prd");
    expect(c.replay).toEqual([
      "devx gate prd abc123",
      "devx gate coverage abc123  # design mode",
      "devx gate coverage abc123  # plan mode",
      "devx gate evals abc123",
    ]);
  });

  it("design.md: clears 3 flags, prd_validated survives", () => {
    const c = computeRevise(allTrueState(), cascadeFor("design.md")!, "abc123");
    expect(c.flagsCleared).toEqual(["design_verified", "plan_verified", "evals_red"]);
    expect(c.stage).toBe("design");
    expect(c.replay[0]).toContain("gate coverage");
  });

  it("plan.md: clears 2 flags, replay is coverage(plan) + evals", () => {
    const c = computeRevise(allTrueState(), cascadeFor("plan.md")!, "abc123");
    expect(c.flagsCleared).toEqual(["plan_verified", "evals_red"]);
    expect(c.replay).toEqual([
      "devx gate coverage abc123  # plan mode",
      "devx gate evals abc123",
    ]);
  });

  it("stage never advances: touching plan.md at stage prd keeps stage prd", () => {
    const state = {
      ...allTrueState("prd"),
      gateStatus: {
        prd_validated: false,
        design_verified: false,
        plan_verified: false,
        evals_red: false,
      },
    };
    const c = computeRevise(state, cascadeFor("plan.md")!, "abc123");
    expect(c.stage).toBe("prd");
    expect(c.flagsCleared).toEqual([]); // nothing was set — reports the delta
    expect(c.resets).toEqual(["plan_verified", "evals_red"]);
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

function seed(): void {
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
  repo.write(`${WS}/prd.md`, "# the prd\n");
  repo.write(`${WS}/design.md`, "# the design\n");
  repo.write(`${WS}/plan.md`, "# the plan\n");
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
  it("design.md cascade: flags reset, stage rolled back, replay printed", () => {
    seed();
    const { code, io } = revise("design.md");
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

  it("expectations.md resets all four flags (same row as prd.md)", () => {
    seed();
    const { code } = revise("expectations.md");
    expect(code).toBe(0);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.prd_validated).toBe(false);
    expect(state.stage).toBe("prd");
  });

  it("accepts the workstream-relative path form", () => {
    seed();
    const { code } = revise(`${WS}/plan.md`);
    expect(code).toBe(0);
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.design_verified).toBe(true); // untouched by plan row
    expect(state.gateStatus.plan_verified).toBe(false);
    expect(state.stage).toBe("plan");
  });

  it("never edits the touched artifact itself", () => {
    seed();
    revise("design.md");
    expect(repo.read(`${WS}/design.md`)).toBe("# the design\n");
  });

  it("preserves the status-log body through the frontmatter rewrite", () => {
    seed();
    revise("prd.md");
    expect(repo.read(SPEC_REL)).toContain("- created.");
  });

  it("refuses an unknown artifact (exit 1), spec untouched", () => {
    seed();
    const before = repo.read(SPEC_REL);
    const { code, io } = revise("notes.md");
    expect(code).toBe(1);
    expect(io.stderr()).toContain("unknown artifact 'notes.md'");
    expect(io.stderr()).toContain("prd.md, expectations.md, design.md, plan.md");
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("refuses a path into a DIFFERENT workstream (exit 1)", () => {
    seed();
    const before = repo.read(SPEC_REL);
    const { code, io } = revise("_devx/workstreams/other-stream/design.md");
    expect(code).toBe(1);
    expect(io.stderr()).toContain("not an artifact of workstream");
    expect(repo.read(SPEC_REL)).toBe(before);
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
      const c = runRevise(["zz9999"], { touched: "prd.md" }, {
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
    revise("plan.md");
    const afterFirst = repo.read(SPEC_REL);
    const { code, io } = revise("plan.md");
    expect(code).toBe(0);
    expect(repo.read(SPEC_REL)).toBe(afterFirst);
    expect((io.json() as { flags_cleared: string[] }).flags_cleared).toEqual([]);
  });
});
