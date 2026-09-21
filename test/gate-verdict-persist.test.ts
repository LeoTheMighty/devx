// E-3 permanent suite (hfi102): gate-verdict persistence across all three
// gate commands. Every *evaluated* run — PASS, CONCERNS, and FAIL alike —
// writes its D-9 verdict into the spec's `gate_verdicts:` map; refusals,
// --dry-run, and exit-2 error paths write nothing to the spec. FAIL runs are
// verdict-only: gate_status booleans and stage stay untouched.
//
// Plus T2.5: `devx next <hash>` renders FAIL distinctly from never-run,
// with the FAIL fix path pointing at the report the same gate run wrote.
//
// Spec: dev/dev-hfi102-2026-07-24T10:41-gate-verdict-persistence.md
// Eval: _devx/workstreams/harness-fold-in/evals/E-3_gate-verdict-persist.ts

import { rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runGateCoverage,
  runGateEvalsCli,
  runGatePrd,
} from "../src/commands/gate.js";
import { runNext } from "../src/commands/next.js";
import { runRevise } from "../src/commands/revise.js";
import { applyEnginePatch, readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  type EngineRepo,
  captureIo,
  designTable,
  makeEngineRepo,
  planTable,
  validExpectations,
  validPlan,
  validPrd,
} from "./fixtures/engine-repo.js";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const SPEC_REL = "plan/plan-abc123-2026-07-05T13:01-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";

function seedSpec(flags: {
  stage?: string;
  prd_validated?: boolean;
  design_verified?: boolean;
  plan_verified?: boolean;
}): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${flags.stage ?? "prd"}`,
      "gate_status:",
      `  prd_validated: ${flags.prd_validated ?? false}`,
      `  design_verified: ${flags.design_verified ?? false}`,
      `  plan_verified: ${flags.plan_verified ?? false}`,
      "  evals_red: false",
      `workstream: ${WS}`,
      "---",
      "body",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd/agent.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
}

function state() {
  return readEngineState(repo.read(SPEC_REL));
}

// ---------------------------------------------------------------------------
// devx gate prd
// ---------------------------------------------------------------------------

function gatePrd(fsOverride?: { exists: (p: string) => boolean }) {
  const io = captureIo();
  const code = runGatePrd(["abc123"], {
    ...io,
    projectPath: repo.configPath,
    ...(fsOverride ? { fs: fsOverride } : {}),
  });
  return { code, io };
}

describe("gate prd — verdict persistence", () => {
  it("PASS writes gate_verdicts.prd alongside the flag flip", () => {
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.prd).toBe("PASS");
    expect(s.gateStatus.prd_validated).toBe(true);
    expect(s.stage).toBe("design");
  });

  it("evaluated FAIL writes the verdict only — flags and stage untouched", () => {
    seedSpec({});
    repo.write(
      `${WS}/expectations.md`,
      validExpectations().replace("- **Threshold:** tour present on 100% of PRs\n", ""),
    );
    expect(gatePrd().code).toBe(1);
    const s = state();
    expect(s.gateVerdicts.prd).toBe("FAIL");
    expect(s.gateStatus.prd_validated).toBe(false);
    expect(s.stage).toBe("prd");
  });

  it("refusal (missing gate inputs) writes nothing", () => {
    seedSpec({});
    const before = repo.read(SPEC_REL);
    const { code } = gatePrd({
      exists: (p) => !p.endsWith("prd/agent.md") || p.includes("templates"),
    });
    expect(code).toBe(1);
    expect(repo.read(SPEC_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// devx gate coverage (design + plan modes)
// ---------------------------------------------------------------------------

function gateCoverage(tableJson?: string) {
  const io = captureIo();
  let tablePath: string | undefined;
  if (tableJson !== undefined) {
    repo.write("table.json", tableJson);
    tablePath = `${repo.root}/table.json`;
  }
  const code = runGateCoverage(["abc123"], { table: tablePath }, {
    ...io,
    projectPath: repo.configPath,
    now: () => new Date(2026, 6, 24, 13, 0, 0),
  });
  return { code, io };
}

describe("gate coverage — verdict persistence", () => {
  it("design PASS writes gate_verdicts.design", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable()).code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.design).toBe("PASS");
    expect(s.gateStatus.design_verified).toBe(true);
  });

  it("design CONCERNS advances the gate AND records CONCERNS", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "CAP-1": "partial" })).code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.design).toBe("CONCERNS");
    expect(s.gateStatus.design_verified).toBe(true);
  });

  it("design FAIL writes the verdict only — flags and stage untouched", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);
    const s = state();
    expect(s.gateVerdicts.design).toBe("FAIL");
    expect(s.gateStatus.design_verified).toBe(false);
    expect(s.stage).toBe("design");
  });

  it("plan PASS writes gate_verdicts.plan (coverage keys by evaluated surface)", () => {
    seedSpec({ prd_validated: true, design_verified: true, stage: "plan" });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    repo.write(`${WS}/plan/agent.md`, "## Plan\n\nreal.\n");
    expect(gateCoverage(planTable()).code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.plan).toBe("PASS");
    expect(s.gateVerdicts.design).toBe(null);
    expect(s.gateStatus.plan_verified).toBe(true);
  });

  it("plan FAIL (P0 floor) writes gate_verdicts.plan only", () => {
    seedSpec({ prd_validated: true, design_verified: true, stage: "plan" });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    repo.write(`${WS}/plan/agent.md`, "## Plan\n\nreal.\n");
    expect(gateCoverage(planTable({ "E-1": { artifact: null } })).code).toBe(1);
    const s = state();
    expect(s.gateVerdicts.plan).toBe("FAIL");
    expect(s.gateStatus.plan_verified).toBe(false);
    expect(s.stage).toBe("plan");
  });

  it("refusal (Gate 1 open) writes nothing", () => {
    seedSpec({});
    const before = repo.read(SPEC_REL);
    expect(gateCoverage(designTable()).code).toBe(1);
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("exit-2 error (missing --table) writes nothing", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    const before = repo.read(SPEC_REL);
    expect(gateCoverage(undefined).code).toBe(2);
    expect(repo.read(SPEC_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// devx gate evals
// ---------------------------------------------------------------------------

function seedEvals(flags: { plan_verified?: boolean } = {}): void {
  seedSpec({
    stage: "red",
    prd_validated: true,
    design_verified: true,
    plan_verified: flags.plan_verified ?? true,
  });
  repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
  repo.write(`${WS}/plan/agent.md`, validPlan());
  repo.write("test/demo.test.mjs", "process.exit(1);\n");
  repo.write("test/perf.test.mjs", "process.exit(1);\n");
}

function gateEvals(flags: { dryRun?: boolean; verify?: boolean } = {}, exitCode = 1) {
  const io = captureIo();
  const code = runGateEvalsCli(["abc123"], flags, {
    ...io,
    projectPath: repo.configPath,
    now: () => new Date(2026, 6, 24, 13, 0, 0),
    exec: () => ({ stdout: "", stderr: "not implemented", exitCode }),
  });
  return { code, io };
}

describe("gate evals — verdict persistence", () => {
  it("PASS (all P0s observed RED) writes gate_verdicts.evals", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.evals).toBe("PASS");
    expect(s.gateStatus.evals_red).toBe(true);
  });

  it("FAIL (non-RED P0) writes the verdict only — flags and stage untouched", () => {
    seedEvals();
    expect(gateEvals({}, 0).code).toBe(1);
    const s = state();
    expect(s.gateVerdicts.evals).toBe("FAIL");
    expect(s.gateStatus.evals_red).toBe(false);
    expect(s.stage).toBe("red");
  });

  it("CONCERNS (P1+ gap) flips the flag AND records CONCERNS verbatim", () => {
    // No plan/agent.md → every row tests-first; E-1/E-2 (demo.test.mjs) observed
    // RED, E-3's artifact (test/perf.test.mjs) missing → P2 gap →
    // CONCERNS. Pins that the combined patch writes result.verdict, not a
    // hardcoded PASS (adversarial-review test-gap finding).
    seedSpec({
      stage: "red",
      prd_validated: true,
      design_verified: true,
      plan_verified: true,
    });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    repo.write("test/demo.test.mjs", "process.exit(1);\n");
    expect(gateEvals().code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.evals).toBe("CONCERNS");
    expect(s.gateStatus.evals_red).toBe(true);
  });

  it("refusal (Gate 3 open) writes nothing", () => {
    seedEvals({ plan_verified: false });
    const before = repo.read(SPEC_REL);
    expect(gateEvals().code).toBe(1);
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("--dry-run writes nothing", () => {
    seedEvals();
    const before = repo.read(SPEC_REL);
    expect(gateEvals({ dryRun: true }).code).toBe(0);
    expect(repo.read(SPEC_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// debug-75563d — the RED step-body lock is actually armed
//
// `stampEvalShas()` shipped with zero callers in src/, so `red_eval_shas`
// was never written, `verifyStepBodies()` had nothing to verify, and the
// lock's grandfathering rule read every workstream as "predates the stamp".
// An inert producer did not fail loudly — it read as permission.
//
// AC 1: these must FAIL against main before the fix.
// ---------------------------------------------------------------------------

describe("gate evals — RED step-body stamp (debug-75563d)", () => {
  it("PASS stamps the evals that actually RAN — deduped, deferred excluded", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const shas = state().redEvalShas;
    // validPlan(): E-1 (P0) and E-2 (P1) both cite test/demo.test.mjs, so
    // the stamp is keyed by ARTIFACT and carries one entry, not two.
    // E-3 is `human` → deferred → never observed RED → deliberately NOT
    // stamped: the lock's whole claim is "watched failing for the right
    // reason", and an eval nobody ran has no such observation to lock.
    expect(Object.keys(shas)).toEqual(["test/demo.test.mjs"]);
    expect(shas["test/demo.test.mjs"]).toMatch(/^[0-9a-f]{64}$/);
    expect(shas["evals/E-3_perf.md"]).toBeUndefined();
  });

  it("the stamp is the artifact's real content, not a placeholder", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const before = state().redEvalShas["test/demo.test.mjs"];
    // Same file, different body → different sha. A stamp that ignored
    // content would pass every other assertion here.
    repo.write("test/demo.test.mjs", "process.exit(2); // softened\n");
    expect(gateEvals().code).toBe(0);
    expect(state().redEvalShas["test/demo.test.mjs"]).not.toBe(before);
  });

  it("CONCERNS stamps too — a non-PASS verdict is not a lock bypass", () => {
    // Same seed as the CONCERNS case above: no plan/agent.md, E-3's
    // artifact absent. `evals_red` flips and execution begins, so the
    // evals that DID run must come under the lock. Leaving them unstamped
    // would let any non-PASS verdict silently drop immutability.
    seedSpec({
      stage: "red",
      prd_validated: true,
      design_verified: true,
      plan_verified: true,
    });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    repo.write("test/demo.test.mjs", "process.exit(1);\n");
    expect(gateEvals().code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.evals).toBe("CONCERNS");
    expect(s.gateStatus.evals_red).toBe(true);
    expect(Object.keys(s.redEvalShas)).toContain("test/demo.test.mjs");
    // The absent artifact is skipped, never stamped empty — an empty sha
    // would lock it to "absent" and read the real file as `moved` later.
    expect(s.redEvalShas["test/perf.test.mjs"]).toBeUndefined();
  });

  it("FAIL stamps nothing — the lock arms only when the gate clears", () => {
    seedEvals();
    expect(gateEvals({}, 0).code).toBe(1);
    expect(state().redEvalShas).toEqual({});
  });

  it("AC 5: an unstamped workstream stays grandfathered", () => {
    // A spec whose Gate 4 predates the fix has no `red_eval_shas` key at
    // all. Reading it must yield {} rather than throwing or inventing
    // entries — {} is what `verifyStepBodies` reports as advisory
    // `unstamped`, which never blocks.
    seedSpec({ stage: "executing", prd_validated: true });
    expect(state().redEvalShas).toEqual({});
  });

  it("--verify PASSes a stamped workstream whose evals are untouched", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const { code, io: vio } = gateEvals({ verify: true }, 1);
    expect(code).toBe(0);
    const out = JSON.parse(vio.stdout());
    expect(out.verify).toBe("PASS");
    expect(out.stamped).toBe(1);
    expect(out.findings).toEqual([]);
  });

  it("--verify FAILs (exit 1) on a body that moved under its stamp", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    // The eval softened during implementation — the exact move the lock
    // exists to catch. Before this story nothing could detect it, because
    // nothing was ever stamped.
    repo.write("test/demo.test.mjs", "process.exit(0); // softened\n");
    const { code, io: vio } = gateEvals({ verify: true }, 1);
    expect(code).toBe(1);
    const out = JSON.parse(vio.stdout());
    expect(out.verify).toBe("FAIL");
    expect(out.findings.map((f: { kind: string }) => f.kind)).toEqual(["moved"]);
  });

  it("--verify FAILs on a stamped eval that vanished", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    rmSync(join(repo.root, "test", "demo.test.mjs"));
    const { code, io: vio } = gateEvals({ verify: true }, 1);
    expect(code).toBe(1);
    expect(JSON.parse(vio.stdout()).findings[0].kind).toBe("missing");
  });

  it("AC 5: --verify PASSes an unstamped (grandfathered) workstream", () => {
    // Nothing stamped → no findings → exit 0. Failing here would
    // retroactively block every workstream whose Gate 4 predates the fix,
    // which is exactly what AC 5 forbids.
    seedEvals();
    const { code, io: vio } = gateEvals({ verify: true }, 1);
    expect(code).toBe(0);
    const out = JSON.parse(vio.stdout());
    expect(out.verify).toBe("PASS");
    expect(out.stamped).toBe(0);
  });

  it("--verify writes nothing to the spec", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const before = repo.read(SPEC_REL);
    expect(gateEvals({ verify: true }, 1).code).toBe(0);
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("--verify refuses to combine with --dry-run or --waive", () => {
    seedEvals();
    expect(gateEvals({ verify: true, dryRun: true }, 1).code).toBe(2);
  });

  it("a re-stamp REPLACES the map rather than merging into it", () => {
    // Exercised at the patch seam rather than through the CLI: producing
    // two different run-sets from one fixture means deleting a P0
    // artifact, which FAILs the gate before it can re-stamp. The
    // semantics under test are the writer's, not the gate's.
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const stamped = state().redEvalShas;
    expect(Object.keys(stamped)).toEqual(["test/demo.test.mjs"]);

    const withStale = applyEnginePatch(repo.read(SPEC_REL), {
      redEvalShas: { ...stamped, "evals/E-gone.md": "f".repeat(64) },
    });
    repo.write(SPEC_REL, withStale);
    expect(Object.keys(readEngineState(repo.read(SPEC_REL)).redEvalShas).sort()).toEqual([
      "evals/E-gone.md",
      "test/demo.test.mjs",
    ]);

    // Re-stamping without it must DROP it. Merging would leave the sha
    // behind forever, where verifyStepBodies reads it as `missing` and
    // blocks the workstream on an eval nobody deleted improperly.
    repo.write(SPEC_REL, applyEnginePatch(repo.read(SPEC_REL), { redEvalShas: stamped }));
    expect(Object.keys(readEngineState(repo.read(SPEC_REL)).redEvalShas)).toEqual([
      "test/demo.test.mjs",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Evaluated FAIL whose verdict write fails: diagnostics survive, exit 2
// ---------------------------------------------------------------------------

/** Seed the spec with a duplicated frontmatter key: readEngineState (toJS)
 *  tolerates it, applyEnginePatch (doc.errors) refuses — so the gate
 *  evaluates normally and only the verdict write fails. */
function seedBrokenSpec(flags: {
  stage?: string;
  prd_validated?: boolean;
}): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "type: plan", // duplicate key — botched-merge shape
      "status: in-progress",
      `stage: ${flags.stage ?? "prd"}`,
      "gate_status:",
      `  prd_validated: ${flags.prd_validated ?? false}`,
      "  design_verified: false",
      "  plan_verified: false",
      "  evals_red: false",
      `workstream: ${WS}`,
      "---",
      "body",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd/agent.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
}

describe("FAIL verdict write failure — gap diagnostics are never swallowed", () => {
  it("gate prd: gaps print, exit is 2, the spec is untouched", () => {
    seedBrokenSpec({});
    repo.write(
      `${WS}/expectations.md`,
      validExpectations().replace("- **Threshold:** tour present on 100% of PRs\n", ""),
    );
    const before = repo.read(SPEC_REL);
    const { code, io } = gatePrd();
    expect(code).toBe(2);
    const j = io.json() as { gate: string; gaps: unknown[] };
    expect(j.gate).toBe("FAIL");
    expect(j.gaps.length).toBeGreaterThan(0);
    expect(io.stderr()).toContain("frontmatter write failed");
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("gate coverage: the JSON still names the verify report already on disk", () => {
    seedBrokenSpec({ prd_validated: true, stage: "design" });
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    const before = repo.read(SPEC_REL);
    const { code, io } = gateCoverage(designTable({ "FR-1": "missing" }));
    expect(code).toBe(2);
    const j = io.json() as { gate: string; report: string };
    expect(j.gate).toBe("FAIL");
    expect(j.report).toBe(`${WS}/decisions/2026-07-24-design-verify.md`);
    expect(repo.exists(`${WS}/decisions/2026-07-24-design-verify.md`)).toBe(true);
    expect(repo.read(SPEC_REL)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// devx revise — the only eraser (T2.3)
// ---------------------------------------------------------------------------

function revise(touched: string) {
  const io = captureIo();
  const code = runRevise(["abc123"], { touched }, {
    ...io,
    projectPath: repo.configPath,
  });
  return { code, io };
}

describe("devx revise — post-revise verdict clearing", () => {
  it("gate-written verdicts read null after revise; earlier stages survive", () => {
    // Real lifecycle: gate prd PASSes (writes prd: PASS), gate coverage
    // FAILs in design mode (writes design: FAIL, flag stays false), then
    // design/agent.md is revised — the FAIL must be erased, prd's PASS kept.
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);
    expect(state().gateVerdicts).toMatchObject({ prd: "PASS", design: "FAIL" });

    expect(revise("design/agent.md").code).toBe(0);
    const s = state();
    expect(s.gateVerdicts.prd).toBe("PASS");
    expect(s.gateVerdicts.design).toBe(null);
    expect(s.gateVerdicts.plan).toBe(null);
    expect(s.gateVerdicts.evals).toBe(null);
  });

  it("prd/agent.md revise erases all four verdicts", () => {
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    expect(revise("prd/agent.md").code).toBe(0);
    const s = state();
    expect(s.gateVerdicts).toEqual({
      prd: null,
      design: null,
      plan: null,
      evals: null,
    });
    expect(s.stage).toBe("prd");
  });

  it("post-revise, `devx next` renders the cleared gate as never-run again", () => {
    // FAIL → revise → the summary must drop back to `—`, not keep FAIL.
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);
    expect(revise("design/agent.md").code).toBe(0);
    expect(next().summary).toBe("gates: prd PASS · design — · plan — · evals —");
  });

  it("replay-path stdout shape is unchanged by verdict clearing", () => {
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    const { code, io } = revise("prd/agent.md");
    expect(code).toBe(0);
    expect(Object.keys(io.json() as Record<string, unknown>).sort()).toEqual([
      "flags_cleared",
      "hash",
      "replay",
      "resets",
      "spec",
      "stage",
      "touched",
    ]);
  });
});

// ---------------------------------------------------------------------------
// devx next — FAIL vs never-run rendering (T2.5)
// ---------------------------------------------------------------------------

/** Run `devx next abc123` and return its verdict map + summary block. */
function next(): {
  verdicts: Record<string, string | null>;
  summary: string;
} {
  const io = captureIo();
  expect(runNext(["abc123"], { ...io, projectPath: repo.configPath })).toBe(0);
  const j = io.json() as {
    gate_verdicts: Record<string, string | null>;
    gate_summary: string;
  };
  return { verdicts: j.gate_verdicts, summary: j.gate_summary };
}

describe("devx next — FAIL vs never-run (T2.5)", () => {
  it("never-run gates render as em-dash with all-null verdicts", () => {
    seedSpec({});
    const { verdicts, summary } = next();
    expect(verdicts).toEqual({ prd: null, design: null, plan: null, evals: null });
    expect(summary).toBe("gates: prd — · design — · plan — · evals —");
  });

  it("a gate FAIL renders FAIL — visibly distinct from never-run — with the report the run wrote", () => {
    // Real lifecycle: prd PASSes, design coverage FAILs (which also writes
    // decisions/2026-07-24-design-verify.md); never-run gates stay `—`.
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);

    const { verdicts, summary } = next();
    expect(verdicts).toEqual({
      prd: "PASS",
      design: "FAIL",
      plan: null,
      evals: null,
    });
    expect(summary).toBe(
      [
        "gates: prd PASS · design FAIL · plan — · evals —",
        `  design FAIL → report: ${WS}/decisions/2026-07-24-design-verify.md · re-run: devx gate coverage abc123`,
      ].join("\n"),
    );
  });

  it("legacy flag-true without a verdict renders PASS (migration fallback)", () => {
    seedSpec({ prd_validated: true, stage: "design" });
    const { verdicts, summary } = next();
    expect(verdicts.prd).toBe(null);
    expect(summary).toBe("gates: prd PASS · design — · plan — · evals —");
  });

  it("a file squatting on decisions/ degrades to re-run-only — no crash", () => {
    // fs.exists is true but readdir throws ENOTDIR; the dispatcher must
    // degrade the fix path, not die (adversarial-review finding).
    seedSpec({});
    expect(gatePrd().code).toBe(0);
    repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
    expect(gateCoverage(designTable({ "FR-1": "missing" })).code).toBe(1);
    rmSync(join(repo.root, WS, "decisions"), { recursive: true });
    repo.write(`${WS}/decisions`, "not a directory");
    const { summary } = next();
    expect(summary).toBe(
      [
        "gates: prd PASS · design FAIL · plan — · evals —",
        "  design FAIL → re-run: devx gate coverage abc123",
      ].join("\n"),
    );
  });
});
