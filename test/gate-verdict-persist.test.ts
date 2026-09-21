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

function gateEvals(
  flags: {
    dryRun?: boolean;
    verify?: boolean;
    waive?: string[];
    reason?: string;
    approver?: string;
  } = {},
  exitCode = 1,
  fsOverride?: { readFile?: (p: string) => string },
) {
  const io = captureIo();
  const code = runGateEvalsCli(["abc123"], flags, {
    ...io,
    projectPath: repo.configPath,
    now: () => new Date(2026, 6, 24, 13, 0, 0),
    exec: () => ({ stdout: "", stderr: "not implemented", exitCode }),
    ...(fsOverride ? { fs: fsOverride as never } : {}),
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
// Retroactive adversarial review of #164 (debug-75563d) — regression suite.
// Each test FAILS on the pre-fix code; each names the finding it pins.
// ---------------------------------------------------------------------------

/** The --verify JSON line (last line of stdout). */
function verifyOut(io: ReturnType<typeof captureIo>) {
  return JSON.parse(io.stdout().trim().split("\n").pop() as string) as {
    verify: string;
    locked: boolean;
    coverage: boolean;
    stamped: number;
    findings: { kind: string; evalPath: string }[];
  };
}

describe("RED eval lock — review of #164", () => {
  it("A: a --waive re-run keeps the ORIGINAL lock, so the waived eval's softening is still caught", () => {
    // Pre-fix: the re-stamp REPLACED the map with only the evals that ran,
    // so waiving E-1 dropped its sha and --verify reported stamped:0, PASS.
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const original = state().redEvalShas["test/demo.test.mjs"];
    repo.write("test/demo.test.mjs", "process.exit(0); // softened\n");
    gateEvals({ waive: ["E-1"], reason: "flaky in CI", approver: "agent" }, 0);
    // The ORIGINAL sha survives — not re-hashed to the softened body, which
    // would launder the edit the waiver might be covering.
    expect(state().redEvalShas["test/demo.test.mjs"]).toBe(original);
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["moved"]);
  });

  it("A: a carried-forward key is still dropped once its file is actually gone", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const withGone = applyEnginePatch(repo.read(SPEC_REL), {
      redEvalShas: { ...state().redEvalShas, "test/deleted.test.mjs": "f".repeat(64) },
    });
    repo.write(SPEC_REL, withGone);
    expect(gateEvals().code).toBe(0);
    expect(Object.keys(state().redEvalShas)).toEqual(["test/demo.test.mjs"]);
  });

  it("E: a directory artifact is locked file by file, not silently skipped", () => {
    // Pre-fix: readFile threw EISDIR, the catch swallowed it, the gate PASSed
    // with an EMPTY stamp, and every file under the directory was unlocked.
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-first | test/e2e |",
    ));
    repo.write(`${WS}/expectations.md`, validExpectations().replace(
      "- **Verified by:** test/demo.test.mjs\n\n## E-2",
      "- **Verified by:** test/e2e\n\n## E-2",
    ));
    repo.mkdir("test/e2e");
    repo.write("test/e2e/b.test.mjs", "process.exit(1);\n");
    repo.write("test/e2e/a.test.mjs", "process.exit(1);\n");
    expect(gateEvals().code).toBe(0);
    // E-1 now points at the directory and E-2 is tests-after (deferred), so
    // exactly the directory's files are locked — each under its own path,
    // in sorted order so the stamp is stable across filesystems.
    expect(Object.keys(state().redEvalShas)).toEqual([
      "test/e2e/a.test.mjs",
      "test/e2e/b.test.mjs",
    ]);
    repo.write("test/e2e/a.test.mjs", "process.exit(0); // softened\n");
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["moved"]);
  });

  it("E: an unreadable artifact is WARNED about by name, never silently dropped", () => {
    seedEvals();
    const denied = (p: string) => {
      if (p.endsWith("demo.test.mjs")) {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      return repo.read(p.slice(repo.root.length + 1));
    };
    const g = gateEvals({}, 1, { readFile: denied });
    expect(g.io.stderr()).toMatch(/test\/demo\.test\.mjs.*EACCES.*NOT locked/);
  });

  it("F: CRLF or trailing whitespace on a .ts/.mjs eval does NOT read as moved", () => {
    // Pre-fix: non-md evals were hashed as raw bytes, so a core.autocrlf
    // checkout flagged `moved` — "fix the code, not the eval" on an eval
    // nobody changed. That is the cry-wolf failure that gets a lock disabled.
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write("test/demo.test.mjs", "process.exit(1);   \r\n");
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(0);
    expect(verifyOut(v.io).findings).toEqual([]);
  });

  it("G: revise clears the stamp with evals_red, so re-authoring an eval is not flagged", () => {
    // Pre-fix: revise cleared evals_red but left red_eval_shas, so the
    // sanctioned re-authoring path read as `moved` under --verify.
    seedEvals();
    expect(gateEvals().code).toBe(0);
    expect(revise("plan/agent.md").code).toBe(0);
    expect(state().gateStatus.evals_red).toBe(false);
    expect(state().redEvalShas).toEqual({});
    repo.write("test/demo.test.mjs", "process.exit(3); // re-authored\n");
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(0);
  });

  it("test gap: EVERY run artifact is stamped, not just the first", () => {
    // Pre-fix no fixture ran more than one artifact, so a collector that
    // locked only the first eval passed the whole suite (mutation M21).
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-2 | P1 | 2 | tests-after | test/demo.test.mjs |",
      "| E-2 | P1 | 2 | tests-first | test/perf.test.mjs |",
    ));
    repo.write(`${WS}/expectations.md`, validExpectations().replace(
      "## E-2: scope fence\n\n- **Priority:** P1\n- **Covers:** G-2, CAP-1\n- **Trigger:** a diff with extras\n- **Expectation (EARS):** When extras appear, the system SHALL flag them.\n- **Threshold:** at least 1 extras row per undeclared surface\n- **Verified by:** test/demo.test.mjs",
      "## E-2: scope fence\n\n- **Priority:** P1\n- **Covers:** G-2, CAP-1\n- **Trigger:** a diff with extras\n- **Expectation (EARS):** When extras appear, the system SHALL flag them.\n- **Threshold:** at least 1 extras row per undeclared surface\n- **Verified by:** test/perf.test.mjs",
    ));
    expect(gateEvals().code).toBe(0);
    expect(Object.keys(state().redEvalShas).sort()).toEqual([
      "test/demo.test.mjs",
      "test/perf.test.mjs",
    ]);
  });

  it("test gap: WAIVED stamps the evals that ran (a waiver is not a lock bypass)", () => {
    // Pre-fix nothing covered this: removing the WAIVED stamp passed every
    // test (mutation M8), though the write site calls it load-bearing.
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-2 | P1 | 2 | tests-after | test/demo.test.mjs |",
      "| E-2 | P1 | 2 | tests-first | test/perf.test.mjs |",
    ));
    const g = gateEvals({ waive: ["E-2"], reason: "x", approver: "agent" }, 1);
    expect(g.code).toBe(0);
    expect(state().gateVerdicts.evals).toBe("WAIVED");
    expect(Object.keys(state().redEvalShas)).toContain("test/demo.test.mjs");
  });

  it("test gap: --verify refuses to combine with --waive, not only --dry-run", () => {
    // The existing test is titled "…or --waive" but only exercised --dry-run
    // (mutation M20 / M1 survived).
    seedEvals();
    expect(gateEvals({ verify: true, waive: ["E-1"], reason: "x", approver: "a" }).code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// debug-evlk01 B/C — the lock covers the eval SET, not just stamped files
// (Leo's decision 2026-09-21: block in locked workstreams, advisory in
// never-locked ones). Each "blocks" test FAILS on the pre-evlk01 code.
// ---------------------------------------------------------------------------

const TWO_RUNNING_PLAN = () =>
  validPlan().replace(
    "| E-2 | P1 | 2 | tests-after | test/demo.test.mjs |",
    "| E-2 | P1 | 2 | tests-first | test/perf.test.mjs |",
  );

describe("RED eval lock — eval-set coverage (debug-evlk01)", () => {
  it("stamping records the lock marker and every E-id it knew", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const st = state();
    expect(st.evalsLocked).toBe(true);
    // E-1 ran and was stamped; E-2 (tests-after) and E-3 (human) were
    // known but deferred, so they map to null.
    expect(st.redEvalIds).toEqual({
      "E-1": "test/demo.test.mjs",
      "E-2": null,
      "E-3": null,
    });
  });

  it("B: an eval ADDED after the lock blocks", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write("test/new.test.mjs", "process.exit(0);\n");
    repo.write(`${WS}/plan/agent.md`, `${validPlan()}| E-4 | P0 | 1 | tests-first | test/new.test.mjs | full |\n`);
    repo.write(`${WS}/expectations.md`, `${validExpectations()}\n## E-4: added\n\n- **Priority:** P0\n- **Covers:** G-1\n- **Trigger:** t\n- **Expectation (EARS):** e\n- **Threshold:** th\n- **Verified by:** test/new.test.mjs\n`);
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toContain("unstamped");
  });

  it("B: an expectation RE-POINTED at a softened copy blocks", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write("test/demo2.test.mjs", "process.exit(0); // softened copy\n");
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-first | test/demo2.test.mjs |",
    ));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["repointed"]);
  });

  it("B: re-pointing at ANOTHER already-stamped eval still blocks", () => {
    // The case an "unstamped file" rule alone misses: every file involved
    // IS stamped, but E-1 now runs E-2's eval instead of its own.
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, TWO_RUNNING_PLAN());
    expect(gateEvals().code).toBe(0);
    expect(Object.keys(state().redEvalShas).sort()).toEqual(["test/demo.test.mjs", "test/perf.test.mjs"]);
    repo.write(`${WS}/plan/agent.md`, TWO_RUNNING_PLAN().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-first | test/perf.test.mjs |",
    ));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["repointed"]);
  });

  it("B: a new file dropped into a stamped directory blocks", () => {
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-first | test/e2e |",
    ));
    repo.mkdir("test/e2e");
    repo.write("test/e2e/a.test.mjs", "process.exit(1);\n");
    expect(gateEvals().code).toBe(0);
    repo.write("test/e2e/b.test.mjs", "process.exit(0); // added later\n");
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.evalPath)).toContain("test/e2e/b.test.mjs");
  });

  it("C: a stamp emptied by hand no longer reads as grandfathered — it blocks", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write(SPEC_REL, applyEnginePatch(repo.read(SPEC_REL), { redEvalShas: {} }));
    repo.write("test/demo.test.mjs", "process.exit(0); // softened\n");
    const v = gateEvals({ verify: true });
    // The bypass assertion comes FIRST, so on pre-evlk01 code this test fails
    // on the bypass itself (verify exit 0) — not on a field that did not exist
    // yet. (Phase 4 of evlk01: the earlier ordering was a correct test but
    // not a true repro.)
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).locked).toBe(true);
    expect(state().evalsLocked).toBe(true);
  });

  it("does NOT falsely block an eval that was WAIVED at gate time", () => {
    // --verify re-resolves without the gate's --waive, so the waived eval
    // reappears as runnable. Recorded as known-but-unstamped (null), it
    // must not block.
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, TWO_RUNNING_PLAN());
    expect(gateEvals({ waive: ["E-2"], reason: "x", approver: "a" }).code).toBe(0);
    expect(state().redEvalIds["E-2"]).toBeNull();
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(0);
    expect(verifyOut(v.io).findings).toEqual([]);
  });

  it("does NOT block a P1 whose artifact was written AFTER the gate (it was a known CONCERNS gap)", () => {
    // Otherwise the lock would be stricter than the gate that created it.
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-2 | P1 | 2 | tests-after | test/demo.test.mjs |",
      "| E-2 | P1 | 2 | tests-first | test/later.test.mjs |",
    ));
    expect(gateEvals().code).toBe(0);
    expect(state().gateVerdicts.evals).toBe("CONCERNS");
    expect(state().redEvalIds["E-2"]).toBeNull();
    repo.write("test/later.test.mjs", "process.exit(1);\n");
    expect(gateEvals({ verify: true }).code).toBe(0);
  });

  it("a clean locked workstream verifies clean", () => {
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, TWO_RUNNING_PLAN());
    expect(gateEvals().code).toBe(0);
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(0);
    expect(verifyOut(v.io).findings).toEqual([]);
  });

  it("a NEVER-locked workstream stays advisory: findings reported, exit 0", () => {
    // Grandfathering (75563d AC 5): no marker, no stamp. The current evals
    // are reported as unstamped — the "unstamped evals report" the skill
    // prose once promised and the code never did — but nothing blocks.
    seedEvals();
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(0);
    const out = verifyOut(v.io);
    expect(out.locked).toBe(false);
    expect(out.findings.map((f) => f.kind)).toEqual(["unstamped"]);
  });

  it("revise clears the marker and the E-id map along with the stamp", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    expect(revise("plan/agent.md").code).toBe(0);
    const st = state();
    expect(st.evalsLocked).toBe(false);
    expect(st.redEvalIds).toEqual({});
    expect(st.redEvalShas).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Phase 4 review of debug-evlk01 — regression suite. Each test pins one
// finding of the 3-agent review of the evlk01 diff itself.
// ---------------------------------------------------------------------------

/** Mark plan phase `phase` as shipped: a `status: done` dev spec for it. */
function shipPhase(phase: number): void {
  repo.write(
    `dev/dev-ship0${phase}-2026-09-21T12:00-shipped.md`,
    ["---", `hash: ship0${phase}`, "type: dev", "status: done", `phase: ${phase}`, `plan: ${WS}`, "---", "", "done", ""].join("\n"),
  );
}

describe("RED eval lock — Phase 4 of evlk01", () => {
  it("H1: re-pointing AND reclassifying in one edit is caught (it used to verify clean)", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write("test/soft.test.mjs", "process.exit(0); // softened\n");
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-after | test/soft.test.mjs |",
    ));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toContain("dropped");
  });

  it("H1: reclassifying a locked P0 to `human` is caught", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first |",
      "| E-1 | P0 | 1 | human |",
    ));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["dropped"]);
  });

  it("H1: removing a locked expectation is caught", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write(`${WS}/expectations.md`, validExpectations().replace(/## E-1:[\s\S]*?(?=## E-2)/, ""));
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(/\| E-1 \|[^\n]*\n/, ""));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["dropped"]);
  });

  it("H1: re-pointing an eval AFTER its phase ships is still caught", () => {
    // Shipped-green is a legitimate way to leave the run set, so --verify
    // resolves with no shipped deferral and still sees where E-1 points.
    seedEvals();
    expect(gateEvals().code).toBe(0);
    shipPhase(1);
    repo.write("test/soft.test.mjs", "process.exit(0);\n");
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-first | test/soft.test.mjs |",
    ));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["repointed"]);
  });

  it("H1: a shipped phase does NOT itself read as a dropped eval (no false block)", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    shipPhase(1);
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(0);
    expect(verifyOut(v.io).findings).toEqual([]);
  });

  it("H2: deleting expectations.md in a locked workstream blocks instead of skipping the check", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    rmSync(join(repo.root, WS, "expectations.md"));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["unverifiable"]);
  });

  it("H2: deleting the plan in a locked workstream blocks too", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    rmSync(join(repo.root, WS, "plan", "agent.md"));
    expect(gateEvals({ verify: true }).code).toBe(1);
  });

  it("H3: tool-written files under a stamped directory neither get stamped nor block", () => {
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-first | test/e2e |",
    ));
    repo.mkdir("test/e2e");
    repo.write("test/e2e/a.test.mjs", "process.exit(1);\n");
    repo.write("test/e2e/.DS_Store", "junk\n");
    expect(gateEvals().code).toBe(0);
    expect(Object.keys(state().redEvalShas)).toEqual(["test/e2e/a.test.mjs"]);
    // The first green run writes a snapshot; an editor drops a dotfile.
    repo.mkdir("test/e2e/__snapshots__");
    repo.write("test/e2e/__snapshots__/a.test.mjs.snap", "exports[`x`] = 1;\n");
    repo.write("test/e2e/.DS_Store", "changed junk\n");
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(0);
    expect(verifyOut(v.io).findings).toEqual([]);
  });

  it("M3: deleting the marker AND the stamp still leaves the workstream locked by its E-id map", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write(SPEC_REL, applyEnginePatch(repo.read(SPEC_REL), { evalsLocked: false, redEvalShas: {} }));
    expect(Object.keys(state().redEvalIds).length).toBeGreaterThan(0);
    repo.write("test/demo2.test.mjs", "process.exit(0);\n");
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-first | test/demo2.test.mjs |",
    ));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).coverage).toBe(true);
  });

  it("M3: a marker with its E-id map emptied is unverifiable and blocks", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write(SPEC_REL, applyEnginePatch(repo.read(SPEC_REL), { redEvalIds: {} }));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toContain("unverifiable");
  });

  it("M4: a workstream stamped BEFORE evlk01 (shas, no marker, no map) is not falsely blocked", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write(SPEC_REL, applyEnginePatch(repo.read(SPEC_REL), { evalsLocked: false, redEvalIds: {} }));
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(0);
    const out = verifyOut(v.io);
    expect(out.locked).toBe(true);
    expect(out.coverage).toBe(false);
  });

  it("M4: …but its stamped files are still re-hashed, so a softened eval still blocks", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    repo.write(SPEC_REL, applyEnginePatch(repo.read(SPEC_REL), { evalsLocked: false, redEvalIds: {} }));
    repo.write("test/demo.test.mjs", "process.exit(0); // softened\n");
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.kind)).toEqual(["moved"]);
  });

  it("M5: an EMPTY directory artifact at gate time still guards tests added under it later", () => {
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, validPlan().replace(
      "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs |",
      "| E-1 | P0 | 1 | tests-first | test/e2e |",
    ));
    repo.mkdir("test/e2e");
    expect(gateEvals().code).toBe(0);
    expect(state().redEvalIds["E-1"]).toBe("test/e2e");
    repo.write("test/e2e/late.test.mjs", "process.exit(0); // never watched failing\n");
    const v = gateEvals({ verify: true });
    expect(v.code).toBe(1);
    expect(verifyOut(v.io).findings.map((f) => f.evalPath)).toContain("test/e2e/late.test.mjs");
  });

  it("carry-forward: a later --waive never erases an earlier artifact from the E-id map", () => {
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, TWO_RUNNING_PLAN());
    expect(gateEvals().code).toBe(0);
    expect(state().redEvalIds["E-2"]).toBe("test/perf.test.mjs");
    expect(gateEvals({ waive: ["E-2"], reason: "x", approver: "a" }).code).toBe(0);
    expect(state().redEvalIds["E-2"]).toBe("test/perf.test.mjs");
    // …so re-pointing it afterwards is still caught.
    repo.write("test/soft.test.mjs", "process.exit(0);\n");
    repo.write(`${WS}/plan/agent.md`, TWO_RUNNING_PLAN().replace(
      "| E-2 | P1 | 2 | tests-first | test/perf.test.mjs |",
      "| E-2 | P1 | 2 | tests-first | test/soft.test.mjs |",
    ));
    expect(gateEvals({ verify: true }).code).toBe(1);
  });

  it("carry-forward: a locked eval deleted then re-gated keeps its artifact, so re-creating it softened is caught", () => {
    // A P1 that WAS watched failing is then deleted; the gate allows the
    // re-run (a missing P1 is only CONCERNS). Keeping its artifact in the map
    // is what stops "delete, re-gate, re-create softened" from laundering it.
    // Contrast a P1 that was missing at its FIRST gate: never watched, so it
    // maps to null and writing it later is allowed.
    seedEvals();
    repo.write(`${WS}/plan/agent.md`, TWO_RUNNING_PLAN());
    expect(gateEvals().code).toBe(0);
    expect(state().redEvalIds["E-2"]).toBe("test/perf.test.mjs");
    rmSync(join(repo.root, "test", "perf.test.mjs"));
    expect(gateEvals().code).toBe(0);
    expect(state().gateVerdicts.evals).toBe("CONCERNS");
    expect(state().redEvalIds["E-2"]).toBe("test/perf.test.mjs");
    repo.write("test/perf.test.mjs", "process.exit(0); // re-created, softened\n");
    expect(gateEvals({ verify: true }).code).toBe(1);
  });

  it("carry-forward: E-ids known to an earlier gate run are kept on a re-run", () => {
    seedEvals();
    expect(gateEvals().code).toBe(0);
    const before = state().redEvalIds;
    expect(gateEvals().code).toBe(0);
    expect(state().redEvalIds).toEqual(before);
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
