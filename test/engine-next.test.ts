// Tests for `devx next <hash>` v1 (v2e101 AC #7): the workstream-stage
// rows of the dispatcher table (v2/05-dispatcher.md §2 rows 9–12), pure
// and table-driven; the CLI resolves state + artifacts and prints JSON.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runNext } from "../src/commands/next.js";
import {
  type WorkstreamArtifacts,
  nextForWorkstream,
} from "../src/lib/engine/next.js";
import { type EngineState } from "../src/lib/engine/frontmatter.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
} from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// Pure decision table
// ---------------------------------------------------------------------------

function state(overrides: {
  stage?: EngineState["stage"];
  gates?: Partial<EngineState["gateStatus"]>;
  outcomeStatus?: string | null;
  measureBy?: string | null;
}): EngineState {
  return {
    hash: "abc123",
    type: "plan",
    status: "in-progress",
    stage: overrides.stage ?? "prd",
    enteredAt: "prd",
    gateStatus: {
      prd_validated: false,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
      ...(overrides.gates ?? {}),
    },
    outcome: {
      status: overrides.outcomeStatus ?? null,
      measure_by: overrides.measureBy ?? null,
    },
    workstream: "_devx/workstreams/demo",
    blockedBy: [],
  };
}

function artifacts(overrides: Partial<WorkstreamArtifacts> = {}): WorkstreamArtifacts {
  return {
    prd: true,
    expectations: true,
    design: true,
    plan: true,
    evalsAuthored: true,
    ...overrides,
  };
}

describe("nextForWorkstream — decision table", () => {
  it("retired → nothing", () => {
    const d = nextForWorkstream("abc123", state({ stage: "retired" }), artifacts());
    expect(d.command).toBeNull();
    expect(d.row).toBe(1);
  });

  it("done + unscored outcome → /devx outcome", () => {
    const d = nextForWorkstream("abc123", state({ stage: "done" }), artifacts());
    expect(d.command).toBe("/devx outcome abc123");
    const pending = nextForWorkstream(
      "abc123",
      state({ stage: "done", outcomeStatus: "pending" }),
      artifacts(),
    );
    expect(pending.command).toBe("/devx outcome abc123");
  });

  it("done + scored outcome → nothing", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "done", outcomeStatus: "keep" }),
      artifacts(),
    );
    expect(d.command).toBeNull();
    expect(d.row).toBe(3);
  });

  it("done + pending outcome due today → row 2 with the came-due reason (v2o101)", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "done", outcomeStatus: "pending", measureBy: "2026-08-02" }),
      artifacts(),
      "2026-08-02",
    );
    expect(d.row).toBe(2);
    expect(d.command).toBe("/devx outcome abc123");
    expect(d.reason).toContain("came due");
    expect(d.reason).toContain("2026-08-02");
  });

  it("done + pending outcome NOT yet due → row 3 waiting, no command (v2o101)", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "done", outcomeStatus: "pending", measureBy: "2026-08-02" }),
      artifacts(),
      "2026-07-05",
    );
    expect(d.row).toBe(3);
    expect(d.command).toBeNull();
    expect(d.reason).toContain("waiting for the measurement window");
  });

  it("done + pending with a malformed measure_by counts as due (never waits forever)", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "done", outcomeStatus: "pending", measureBy: "someday" }),
      artifacts(),
      "2026-07-05",
    );
    expect(d.row).toBe(2);
    expect(d.command).toBe("/devx outcome abc123");
  });

  it("done + unarmed outcome is actionable regardless of today (arm it)", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "done" }),
      artifacts(),
      "2026-07-05",
    );
    expect(d.row).toBe(2);
    expect(d.command).toBe("/devx outcome abc123");
  });

  it("done + garbage outcome status ('keeep') stays actionable — never misread as scored", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "done", outcomeStatus: "keeep" }),
      artifacts(),
      "2026-07-05",
    );
    expect(d.row).toBe(2);
    expect(d.command).toBe("/devx outcome abc123");
  });

  it("prd.md missing → /devx prd (authoring precedes the gate)", () => {
    const d = nextForWorkstream("abc123", state({}), artifacts({ prd: false }));
    expect(d.command).toBe("/devx prd abc123");
  });

  it("expectations.md missing → /devx prd", () => {
    const d = nextForWorkstream("abc123", state({}), artifacts({ expectations: false }));
    expect(d.command).toBe("/devx prd abc123");
  });

  it("inputs exist, prd not validated → devx gate prd", () => {
    const d = nextForWorkstream("abc123", state({}), artifacts());
    expect(d.command).toBe("devx gate prd abc123");
  });

  it("prd validated, design missing → /devx design", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "design", gates: { prd_validated: true } }),
      artifacts({ design: false }),
    );
    expect(d.command).toBe("/devx design abc123");
  });

  it("design exists, not verified → devx gate coverage", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "design", gates: { prd_validated: true } }),
      artifacts(),
    );
    expect(d.command).toBe("devx gate coverage abc123");
  });

  it("design verified, plan missing → /devx plan", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "plan", gates: { prd_validated: true, design_verified: true } }),
      artifacts({ plan: false }),
    );
    expect(d.command).toBe("/devx plan abc123");
  });

  it("plan exists, not verified → devx gate coverage (plan turn)", () => {
    const d = nextForWorkstream(
      "abc123",
      state({ stage: "plan", gates: { prd_validated: true, design_verified: true } }),
      artifacts(),
    );
    expect(d.command).toBe("devx gate coverage abc123");
  });

  it("plan verified, nothing authored under evals/ → /devx red", () => {
    const d = nextForWorkstream(
      "abc123",
      state({
        stage: "red",
        gates: { prd_validated: true, design_verified: true, plan_verified: true },
      }),
      artifacts({ evalsAuthored: false }),
    );
    expect(d.command).toBe("/devx red abc123");
  });

  it("RED artifacts authored, evals_red false → devx gate evals", () => {
    const d = nextForWorkstream(
      "abc123",
      state({
        stage: "red",
        gates: { prd_validated: true, design_verified: true, plan_verified: true },
      }),
      artifacts(),
    );
    expect(d.command).toBe("devx gate evals abc123");
  });

  it("all four gates true → /devx (execute arm)", () => {
    const d = nextForWorkstream(
      "abc123",
      state({
        stage: "executing",
        gates: {
          prd_validated: true,
          design_verified: true,
          plan_verified: true,
          evals_red: true,
        },
      }),
      artifacts(),
    );
    expect(d.command).toBe("/devx");
    expect(d.row).toBe(12);
  });

  it("first match wins: missing prd beats an open prd gate", () => {
    const d = nextForWorkstream("abc123", state({}), artifacts({ prd: false }));
    expect(d.command).toBe("/devx prd abc123");
    expect(d.row).toBe(4);
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

function seed(gates: string, stage = "prd"): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${stage}`,
      "gate_status:",
      gates,
      `workstream: ${WS}`,
      "---",
      "body",
      "",
    ].join("\n"),
  );
  repo.mkdir(`${WS}/evals`);
}

const ALL_FALSE = [
  "  prd_validated: false",
  "  design_verified: false",
  "  plan_verified: false",
  "  evals_red: false",
].join("\n");

function next(hash?: string) {
  const io = captureIo();
  const code = runNext(hash === undefined ? [] : [hash], {
    ...io,
    projectPath: repo.configPath,
  });
  return { code, io };
}

describe("devx next — CLI driver", () => {
  it("routes a fresh workstream to /devx prd", () => {
    seed(ALL_FALSE);
    const { code, io } = next("abc123");
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.next).toBe("/devx prd abc123");
    expect(j.stage).toBe("prd");
    expect(j.reason).toBeTruthy();
  });

  it("routes to devx gate prd once the inputs exist", () => {
    seed(ALL_FALSE);
    repo.write(`${WS}/prd.md`, "# real\n");
    repo.write(`${WS}/expectations.md`, "# real\n");
    const { io } = next("abc123");
    expect((io.json() as { next: string }).next).toBe("devx gate prd abc123");
  });

  it("evals/ with only RED-report.md still counts as un-authored", () => {
    seed(
      [
        "  prd_validated: true",
        "  design_verified: true",
        "  plan_verified: true",
        "  evals_red: false",
      ].join("\n"),
      "red",
    );
    repo.write(`${WS}/prd.md`, "x");
    repo.write(`${WS}/expectations.md`, "x");
    repo.write(`${WS}/design.md`, "x");
    repo.write(`${WS}/plan.md`, "x");
    repo.write(`${WS}/evals/RED-report.md`, "stale report from a reverted run");
    const { io } = next("abc123");
    expect((io.json() as { next: string }).next).toBe("/devx red abc123");
  });

  it("evals/ with an authored artifact routes to devx gate evals", () => {
    seed(
      [
        "  prd_validated: true",
        "  design_verified: true",
        "  plan_verified: true",
        "  evals_red: false",
      ].join("\n"),
      "red",
    );
    repo.write(`${WS}/prd.md`, "x");
    repo.write(`${WS}/expectations.md`, "x");
    repo.write(`${WS}/design.md`, "x");
    repo.write(`${WS}/plan.md`, "x");
    repo.write(`${WS}/evals/E-1_smoke.md`, "eval spec");
    const { io } = next("abc123");
    expect((io.json() as { next: string }).next).toBe("devx gate evals abc123");
  });

  it("no hash → repo-level dispatcher (v2d101): empty fixture routes row 12", () => {
    const io = captureIo();
    const code = runNext(["--no-gh"], {
      ...io,
      projectPath: repo.configPath,
    });
    expect(code).toBe(0);
    const j = JSON.parse(io.stdout().trim()) as { row: number; action: string };
    expect(j.row).toBe(12);
    expect(j.action).toBe("propose-interview");
  });

  it("unknown hash → exit 2", () => {
    const { code, io } = next("zz9999");
    expect(code).toBe(2);
    expect(io.stderr()).toContain("no plan spec");
  });

  it("emits gate_status alongside the decision for dashboard consumers", () => {
    seed(ALL_FALSE);
    const { io } = next("abc123");
    const j = io.json() as { gate_status: Record<string, boolean> };
    expect(j.gate_status).toEqual({
      prd_validated: false,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
    });
  });
});
