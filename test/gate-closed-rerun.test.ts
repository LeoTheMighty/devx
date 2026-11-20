// A gate that has closed is not re-run, and `devx gate coverage` evaluates
// only the gate its table judges.
//
// Two verdict-path bugs, both found by running a gate the caller believed was
// a read-only look:
//
//  1. `devx gate prd` had no closed-gate refusal. Against a spec with
//     `prd_validated: true` it re-evaluated and re-stamped `gate_verdicts.prd`
//     — overwriting the key when present, adding it when not — and resolved
//     the gate's `questions.md` entries as it went. It put a stray
//     `prd: CONCERNS` into a real plan spec.
//  2. `devx gate coverage` picks its mode from state, so against a closed
//     Gate 2 it silently evaluated Gate 3. A design-judged table then failed
//     completeness by luck (exit 2); nothing made the substitution itself a
//     refusal.
//
// The assertion that matters is BYTE-IDENTITY of the whole repo tree, not the
// exit code: "exit 1" and "wrote nothing" are different claims, and the
// second is the one the bug broke. Every refusal case snapshots every file
// under the fixture root before and after.

import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGatePrd } from "../src/commands/gate.js";
import { runRevise } from "../src/commands/revise.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
  validExpectations,
  validPlan,
  validPrd,
} from "./fixtures/engine-repo.js";

const SPEC_REL = "plan/plan-abc123-2026-11-20T09:00-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";
const QUESTIONS = `${WS}/questions.md`;
const FIXED_NOW = () => new Date(2026, 10, 20, 12, 0, 0);
/** Lives outside the fixture tree, so the snapshot never sees it change. */
const TABLE = "table.json";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

interface SeedState {
  stage: string;
  prd: boolean;
  design: boolean;
  plan: boolean;
  /** `gate_verdicts:` entries to seed; omitted → no `gate_verdicts:` key. */
  verdicts?: Partial<Record<"prd" | "design" | "plan", string>>;
}

function seed(s: SeedState, files: { design?: boolean; plan?: boolean } = {}): void {
  const verdicts = s.verdicts ?? {};
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${s.stage}`,
      "gate_status:",
      `  prd_validated: ${s.prd}`,
      `  design_verified: ${s.design}`,
      `  plan_verified: ${s.plan}`,
      "  evals_red: false",
      ...(Object.keys(verdicts).length > 0
        ? [
            "gate_verdicts:",
            ...Object.entries(verdicts).map(([k, v]) => `  ${k}: ${v}`),
          ]
        : []),
      `workstream: ${WS}`,
      "---",
      "",
      "## Status log",
      "",
      "- created.",
      "",
    ].join("\n"),
  );
  repo.write(`${WS}/prd/agent.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
  if (files.design !== false) repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
  if (files.plan === true) repo.write(`${WS}/plan/agent.md`, validPlan());
}

/** Every file under the fixture root, path → bytes. The table the caller
 *  hands in is excluded: it is the caller's input, not the gate's output. */
function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(repo.root, abs);
      if (rel === TABLE) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else out.set(rel, readFileSync(abs, "latin1"));
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

function gatePrd() {
  const io = captureIo();
  const code = runGatePrd(["abc123"], {
    ...io,
    projectPath: repo.configPath,
    now: FIXED_NOW,
  });
  return { code, io };
}

function revise(touched: string): number {
  const io = captureIo();
  return runRevise(["abc123"], { touched }, { ...io, projectPath: repo.configPath });
}

const state = () => readEngineState(repo.read(SPEC_REL));
const refusalOf = (io: ReturnType<typeof captureIo>): string =>
  (io.json() as { refusal?: string }).refusal ?? "";

// ---------------------------------------------------------------------------
// Bug 1 — Gate 1 refuses once it has closed
// ---------------------------------------------------------------------------

describe("devx gate prd — a closed gate refuses and writes nothing", () => {
  it("refuses over an existing `prd:` verdict, leaving the tree byte-identical", () => {
    seed({ stage: "design", prd: true, design: false, plan: false, verdicts: { prd: "CONCERNS" } });
    const before = snapshot();
    const { code, io } = gatePrd();
    expect(code).toBe(1);
    expect((io.json() as { gate: string }).gate).toBe("FAIL");
    expect(refusalOf(io)).toContain("Gate 1 (prd) is closed");
    expectTreeUnchanged(before);
    // The verdict it would have stamped over is still the one on disk.
    expect(state().gateVerdicts.prd).toBe("CONCERNS");
  });

  it("refuses when the spec has no `gate_verdicts:` key — it does not add one", () => {
    seed({ stage: "design", prd: true, design: false, plan: false });
    const before = snapshot();
    expect(gatePrd().code).toBe(1);
    expectTreeUnchanged(before);
    expect(repo.read(SPEC_REL)).not.toContain("gate_verdicts");
  });

  it("refuses a closed gate whose PRD would now FAIL — no FAIL is stamped over a passed gate", () => {
    seed({ stage: "plan", prd: true, design: true, plan: false, verdicts: { prd: "PASS" } });
    repo.write(`${WS}/prd/agent.md`, "# PRD — Demo Feature\n\n## Problem\n\nx.\n");
    const before = snapshot();
    expect(gatePrd().code).toBe(1);
    expectTreeUnchanged(before);
    expect(state().gateVerdicts.prd).toBe("PASS");
  });

  it("refuses before checking inputs: a closed gate with its PRD gone still writes nothing", () => {
    seed({ stage: "design", prd: true, design: false, plan: false, verdicts: { prd: "PASS" } });
    rmSync(join(repo.root, WS, "prd", "agent.md"));
    rmSync(join(repo.root, WS, "expectations.md"));
    const before = snapshot();
    const { code, io } = gatePrd();
    expect(code).toBe(1);
    expect(refusalOf(io)).toContain("Gate 1 (prd) is closed");
    expectTreeUnchanged(before);
  });

  it("does not resolve the gate's open questions.md entries", () => {
    // An open gate FAILs and files its gaps; the flag is then flipped by hand
    // (the shape a pre-fix stray run, or a hand edit, leaves behind). A
    // re-run must not quietly close those entries.
    seed({ stage: "prd", prd: false, design: false, plan: false });
    repo.write(`${WS}/prd/agent.md`, "# PRD — Demo Feature\n\n## Problem\n\nx.\n");
    expect(gatePrd().code).toBe(1);
    expect(repo.read(QUESTIONS)).toContain("Status: open");
    repo.write(SPEC_REL, repo.read(SPEC_REL).replace("prd_validated: false", "prd_validated: true"));
    repo.write(`${WS}/prd/agent.md`, validPrd());
    const before = snapshot();
    expect(gatePrd().code).toBe(1);
    expectTreeUnchanged(before);
    expect(repo.read(QUESTIONS)).not.toContain("Status: resolved");
  });

  it("names the read-only look and the sanctioned re-open in the refusal", () => {
    seed({ stage: "design", prd: true, design: false, plan: false, verdicts: { prd: "PASS" } });
    const { io } = gatePrd();
    const refusal = refusalOf(io);
    expect(refusal).toContain("`devx workstream position abc123`");
    expect(refusal).toContain("`devx revise abc123 --touched prd`");
    expect(refusal).toContain("verdict: PASS");
  });

  it("re-gates normally once `devx revise` re-opens it — the refusal is not a dead end", () => {
    seed({ stage: "design", prd: true, design: false, plan: false, verdicts: { prd: "CONCERNS" } });
    expect(revise("prd")).toBe(0);
    expect(state().gateStatus.prd_validated).toBe(false);
    const { code, io } = gatePrd();
    expect(code).toBe(0);
    expect((io.json() as { gate: string }).gate).toBe("PASS");
    expect(state().gateStatus.prd_validated).toBe(true);
    expect(state().gateVerdicts.prd).toBe("PASS");
  });
});
