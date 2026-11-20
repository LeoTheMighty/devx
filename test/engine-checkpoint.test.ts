// `devx checkpoint` — the per-phase verification record (A11/B15).
//
// The template shipped with v2s101 and nothing ever wrote it. These tests pin
// the three properties that make the record worth having: the verdict block is
// D-9-valid or the write is refused; an un-run expectation reads as un-run
// rather than as a pass; and a re-run carries the human's drift note forward
// while replacing everything it owns.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runCheckpoint } from "../src/commands/checkpoint.js";
import {
  carryForwardDrift,
  renderCheckpoint,
} from "../src/lib/engine/checkpoint.js";
import { parseVerdictBlock } from "../src/lib/engine/verdict.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
  validPlan,
} from "./fixtures/engine-repo.js";

const WS = "_devx/workstreams/demo-feature";
const PLAN_SPEC = "plan/plan-abc123-2026-07-24T10:41-demo-feature.md";
const DEV_SPEC = "dev/dev-ph0001-2026-07-25T09:00-phase-one.md";
const FIXED_NOW = () => new Date(2026, 10, 20, 12, 0, 0);

// ---------------------------------------------------------------------------
// Pure renderer
// ---------------------------------------------------------------------------

const baseInput = {
  workstreamLabel: "demo-feature",
  phase: 1,
  date: "2026-11-20",
  verdict: "PASS" as const,
  statusReason: "Every P0 for phase 1 ran green; lint and types clean.",
  runs: [
    {
      eId: "E-1",
      type: "tests-first",
      command: "npx vitest run test/demo.test.ts",
      exitCode: 0,
      detail: "was RED at Gate 4; now green",
    },
  ],
  checks: { lint: "clean", types: "clean", suite: "2316 passed" },
  drift: "",
};

describe("renderCheckpoint", () => {
  it("opens with a parseable D-9 verdict block naming its producer", () => {
    const parsed = parseVerdictBlock(renderCheckpoint(baseInput));
    expect(parsed).not.toBeNull();
    expect(parsed!.issues).toEqual([]);
    expect(parsed!.block).toMatchObject({
      gate: "PASS",
      reviewer: "devx checkpoint",
      updated: "2026-11-20",
    });
  });

  it("refuses to render an invalid verdict block rather than writing one", () => {
    expect(() =>
      renderCheckpoint({ ...baseInput, verdict: "WAIVED" }),
    ).toThrow(/WAIVED verdict requires/);
  });

  it("renders a run's glyph from its observed exit code", () => {
    const body = renderCheckpoint({
      ...baseInput,
      runs: [
        { ...baseInput.runs[0], eId: "E-1", exitCode: 0 },
        { ...baseInput.runs[0], eId: "E-2", exitCode: 1 },
        { ...baseInput.runs[0], eId: "E-3", exitCode: null },
      ],
    });
    expect(body).toMatch(/\| E-1 \|.*\| 0 \| ✅ \|/);
    expect(body).toMatch(/\| E-2 \|.*\| 1 \| ❌ \|/);
    // Nothing run → no exit column and ⏳, never a 0 that reads as a pass.
    expect(body).toMatch(/\| E-3 \|.*\| — \| ⏳ \|/);
  });

  it("says so explicitly when no expectation is verified in the phase", () => {
    const body = renderCheckpoint({ ...baseInput, runs: [] });
    expect(body).toContain("no expectation is verified in this phase");
  });

  it("escapes a pipe in a command so the row cannot split", () => {
    const body = renderCheckpoint({
      ...baseInput,
      runs: [{ ...baseInput.runs[0], command: "npm test | tail -5" }],
    });
    expect(body).toContain("npm test \\| tail -5");
    // Exactly 6 cells on the row — the escape held.
    const row = body.split("\n").find((l) => l.startsWith("| E-1 |"))!;
    expect(row.split(/(?<!\\)\|/).length - 2).toBe(6);
  });

  it("states the clean case rather than leaving the drift section blank", () => {
    expect(renderCheckpoint(baseInput)).toContain(
      "Nothing — the plan's later phases need no change from this one.",
    );
    expect(renderCheckpoint({ ...baseInput, drift: "Phase 3 needs a new seam." })).toContain(
      "Phase 3 needs a new seam.",
    );
  });

  it("renders em-dashes rather than empty cells for unrecorded checks", () => {
    const body = renderCheckpoint({
      ...baseInput,
      checks: { lint: "", types: "", suite: "" },
    });
    expect(body).toContain("- Lint (touched surfaces): —");
    expect(body).toContain("- Types: —");
  });
});

describe("carryForwardDrift", () => {
  it("returns empty for no previous file", () => {
    expect(carryForwardDrift(null)).toBe("");
  });

  it("carries a real note forward", () => {
    const prev = renderCheckpoint({ ...baseInput, drift: "Phase 3 needs a seam." });
    expect(carryForwardDrift(prev)).toBe("Phase 3 needs a seam.");
  });

  it("does NOT carry the renderer's own clean sentence (it is not a finding)", () => {
    expect(carryForwardDrift(renderCheckpoint(baseInput))).toBe("");
  });

  it("does NOT carry the shipped template's `<…>` placeholder", () => {
    expect(
      carryForwardDrift("## Drift noted\n\n<anything the implementation revealed>\n"),
    ).toBe("");
  });

  it("returns empty when there is no drift section at all", () => {
    expect(carryForwardDrift("# Checkpoint\n\n## Expectation runs\n")).toBe("");
  });

  it("stops at the next heading in a hand-edited file", () => {
    expect(
      carryForwardDrift("## Drift noted\n\nreal note\n\n## Something else\n\nnot drift\n"),
    ).toBe("real note");
  });
});

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

function seed(
  over: { devPlanPointer?: string; devPhase?: string | null; plan?: boolean } = {},
): EngineRepo {
  const repo = makeEngineRepo();
  repo.write(
    PLAN_SPEC,
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
      "body",
      "",
    ].join("\n"),
  );
  const phaseLine =
    over.devPhase === null ? [] : [`phase: ${over.devPhase ?? "2"}`];
  repo.write(
    DEV_SPEC,
    [
      "---",
      "hash: ph0001",
      "type: dev",
      "status: in-progress",
      ...phaseLine,
      `plan: ${over.devPlanPointer ?? WS}`,
      "---",
      "## Goal",
      "",
      "Phase work.",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  if (over.plan !== false) repo.write(`${WS}/plan/agent.md`, validPlan());
  return repo;
}

function run(
  repo: EngineRepo,
  flags: Parameters<typeof runCheckpoint>[1] = {},
): { code: number; stdout: string; stderr: string; json: () => unknown } {
  const io = captureIo();
  const code = runCheckpoint(
    ["ph0001"],
    {
      verdict: "PASS",
      reason: "Phase 2 verified: both evals green.",
      lint: "clean",
      types: "clean",
      suite: "2316 passed",
      ...flags,
    },
    { ...io, projectPath: repo.configPath, now: FIXED_NOW },
  );
  return { code, stdout: io.stdout(), stderr: io.stderr(), json: io.json };
}

describe("devx checkpoint — resolution and write", () => {
  it("writes checkpoints/phase-<n>.md from the dev spec's `phase:`", () => {
    const repo = seed();
    try {
      const r = run(repo);
      expect(r.code).toBe(0);
      expect(r.json()).toMatchObject({
        checkpoint: `${WS}/checkpoints/phase-2.md`,
        phase: 2,
        verdict: "PASS",
        workstream: WS,
        seeded: true,
      });
      const body = repo.read(`${WS}/checkpoints/phase-2.md`);
      expect(parseVerdictBlock(body)!.issues).toEqual([]);
      expect(body).toContain("# Checkpoint — demo-feature phase 2 — 2026-11-20");
      expect(body).toContain("- Full suite: 2316 passed");
    } finally {
      repo.cleanup();
    }
  });

  it("resolves a `plan:` pointer spelled as the PARENT PLAN SPEC's path", () => {
    // Both spellings live in dev/ today, so the resolution goes through the
    // shared resolver rather than a private directory match.
    const repo = seed({ devPlanPointer: PLAN_SPEC });
    try {
      const r = run(repo);
      expect(r.code).toBe(0);
      expect(r.json()).toMatchObject({ workstream: WS, phase: 2 });
    } finally {
      repo.cleanup();
    }
  });

  it("seeds the runs table from the plan's rows for THAT phase, every exit null", () => {
    const repo = seed();
    try {
      run(repo);
      const body = repo.read(`${WS}/checkpoints/phase-2.md`);
      // validPlan() puts E-2 and E-3 in phase 2, E-1 in phase 1.
      expect(body).toContain("| E-2 |");
      expect(body).toContain("| E-3 |");
      expect(body).not.toContain("| E-1 |");
      // A seed is a worklist, never evidence: no seeded row claims an exit 0.
      for (const line of body.split("\n").filter((l) => /^\| E-\d/.test(l))) {
        expect(line).toContain("⏳");
        expect(line).toContain("not recorded");
      }
    } finally {
      repo.cleanup();
    }
  });

  it("records the OBSERVED runs when --runs is supplied", () => {
    const repo = seed();
    try {
      const runsPath = join(repo.root, "runs.json");
      writeFileSync(
        runsPath,
        JSON.stringify([
          {
            eId: "E-2",
            type: "tests-after",
            command: "npx vitest run test/demo.test.mjs",
            exitCode: 0,
            detail: "green",
          },
          { eId: "E-3", type: "human", command: "", exitCode: null, detail: "checklist" },
        ]),
        "utf8",
      );
      const r = run(repo, { runs: runsPath });
      expect(r.code).toBe(0);
      expect(r.json()).toMatchObject({ runs: 2, seeded: false });
      const body = repo.read(`${WS}/checkpoints/phase-2.md`);
      expect(body).toMatch(/\| E-2 \| tests-after \|.*\| 0 \| ✅ \| green \|/);
      expect(body).toMatch(/\| E-3 \| human \| — \| — \| ⏳ \| checklist \|/);
    } finally {
      repo.cleanup();
    }
  });

  it("REFUSES (exit 1) when the dev spec carries no phase and none is given", () => {
    const repo = seed({ devPhase: null });
    try {
      const r = run(repo);
      expect(r.code).toBe(1);
      expect((r.json() as { refusal: string }).refusal).toContain("--phase <n>");
      expect(repo.exists(`${WS}/checkpoints/phase-2.md`)).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it("--phase overrides a grandfathered spec's missing phase", () => {
    const repo = seed({ devPhase: null });
    try {
      const r = run(repo, { phase: "1" });
      expect(r.code).toBe(0);
      expect(repo.exists(`${WS}/checkpoints/phase-1.md`)).toBe(true);
      // Phase 1's row in validPlan() is E-1.
      expect(repo.read(`${WS}/checkpoints/phase-1.md`)).toContain("| E-1 |");
    } finally {
      repo.cleanup();
    }
  });

  it("REFUSES (exit 1) for a standalone spec that resolves to no workstream", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(
        DEV_SPEC,
        ["---", "hash: ph0001", "type: dev", "status: in-progress", "phase: 1", "---", "x", ""].join(
          "\n",
        ),
      );
      const r = run(repo);
      expect(r.code).toBe(1);
      expect((r.json() as { refusal: string }).refusal).toContain("no engine workstream");
    } finally {
      repo.cleanup();
    }
  });

  it("errors (exit 2) on an unknown hash", () => {
    const repo = seed();
    try {
      const io = captureIo();
      expect(
        runCheckpoint(
          ["nope99"],
          { verdict: "PASS", reason: "x" },
          { ...io, projectPath: repo.configPath },
        ),
      ).toBe(2);
      expect(io.stderr()).toContain("no dev spec found");
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx checkpoint — flag contract", () => {
  it("refuses an unrecognized verdict", () => {
    const repo = seed();
    try {
      const r = run(repo, { verdict: "GREEN" });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("--verdict must be one of");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a missing --reason — the block records WHY (D-9)", () => {
    const repo = seed();
    try {
      const r = run(repo, { reason: "   " });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("--reason <text> is required");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses WAIVED without a named approver and a reason (D-9)", () => {
    const repo = seed();
    try {
      expect(run(repo, { verdict: "WAIVED" }).stderr).toContain("--approver <name>");
      expect(
        run(repo, { verdict: "WAIVED", approver: "Leo" }).stderr,
      ).toContain("--waiver-reason <text>");
      const ok = run(repo, {
        verdict: "WAIVED",
        approver: "Leo",
        waiverReason: "infra unavailable this week",
      });
      expect(ok.code).toBe(0);
      const block = parseVerdictBlock(repo.read(`${WS}/checkpoints/phase-2.md`))!;
      expect(block.issues).toEqual([]);
      expect(block.block.waiver).toEqual({
        active: true,
        approver: "Leo",
        reason: "infra unavailable this week",
      });
    } finally {
      repo.cleanup();
    }
  });

  it("refuses waiver flags on a non-WAIVED verdict", () => {
    const repo = seed();
    try {
      expect(run(repo, { approver: "Leo" }).stderr).toContain(
        "only apply with --verdict WAIVED",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a --runs row whose exitCode is neither an integer nor null", () => {
    const repo = seed();
    try {
      const p = join(repo.root, "runs.json");
      writeFileSync(p, JSON.stringify([{ eId: "E-2", exitCode: "0" }]), "utf8");
      const r = run(repo, { runs: p });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("must be an integer or null");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a --runs row with a malformed E-id", () => {
    const repo = seed();
    try {
      const p = join(repo.root, "runs.json");
      writeFileSync(p, JSON.stringify([{ eId: "nope", exitCode: 0 }]), "utf8");
      expect(run(repo, { runs: p }).stderr).toContain("is not an E-<n> id");
    } finally {
      repo.cleanup();
    }
  });

  it("treats an absent exitCode as null, never as a pass", () => {
    const repo = seed();
    try {
      const p = join(repo.root, "runs.json");
      writeFileSync(p, JSON.stringify([{ eId: "E-2", detail: "forgot to record" }]), "utf8");
      expect(run(repo, { runs: p }).code).toBe(0);
      expect(repo.read(`${WS}/checkpoints/phase-2.md`)).toMatch(
        /\| E-2 \| — \| — \| — \| ⏳ \| forgot to record \|/,
      );
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx checkpoint — re-running", () => {
  it("replaces every section it owns and carries the drift note forward", () => {
    const repo = seed();
    try {
      run(repo, { verdict: "FAIL", reason: "E-3 still red." });
      const path = `${WS}/checkpoints/phase-2.md`;
      // A human adds a drift finding to the FAILed checkpoint.
      repo.write(
        path,
        repo
          .read(path)
          .replace(
            "Nothing — the plan's later phases need no change from this one.",
            "Phase 4 must absorb the new seam this phase introduced.",
          ),
      );

      const r = run(repo, { verdict: "PASS", reason: "E-3 green after the fix." });
      expect(r.code).toBe(0);
      expect(r.json()).toMatchObject({ drift_carried: true });
      const body = repo.read(path);
      expect(parseVerdictBlock(body)!.block.gate).toBe("PASS");
      expect(body).toContain("E-3 green after the fix.");
      expect(body).toContain("Phase 4 must absorb the new seam this phase introduced.");
      // The superseded reason is gone — the checkpoint is current-state.
      expect(body).not.toContain("E-3 still red.");
    } finally {
      repo.cleanup();
    }
  });

  it("reports drift_carried false on a first write", () => {
    const repo = seed();
    try {
      expect(run(repo).json()).toMatchObject({ drift_carried: false });
    } finally {
      repo.cleanup();
    }
  });
});
