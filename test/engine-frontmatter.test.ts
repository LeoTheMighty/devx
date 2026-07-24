// Tests for src/lib/engine/frontmatter.ts (v2e101 AC #2): the engine
// frontmatter fields parse defensively and round-trip without disturbing
// unknown fields, YAML comments, key order, or the status-log body.

import { describe, expect, it } from "vitest";

import {
  FLAG_TO_GATE_KEY,
  GATE_FLAGS,
  GATE_KEYS,
  applyEnginePatch,
  ensureEngineFrontmatter,
  findSpecForHashIn,
  readEngineState,
  splitFrontmatter,
  stageIndex,
} from "../src/lib/engine/frontmatter.js";
import { makeEngineRepo } from "./fixtures/engine-repo.js";

const FULL_SPEC = [
  "---",
  "hash: f3a9c1",
  "type: plan",
  "created: 2026-07-05T13:00:00-06:00",
  "title: Demo",
  "status: in-progress   # v1 field, unchanged",
  "stage: design",
  "entered_at: prd",
  "gate_status:",
  "  prd_validated: true",
  "  design_verified: false",
  "  plan_verified: false",
  "  evals_red: false",
  "gate_verdicts:",
  "  prd: PASS",
  "  design: FAIL",
  "outcome:",
  "  status: null",
  "  measure_by: null",
  "workstream: _devx/workstreams/demo",
  "blocked_by: [q7, q9]",
  "custom_field: keep-me",
  "---",
  "",
  "## Goal",
  "",
  "Body prose.",
  "",
  "## Status log",
  "",
  "- 2026-07-05T13:00 — created.",
  "",
].join("\n");

describe("readEngineState", () => {
  it("reads every engine field from a fully-populated spec", () => {
    const s = readEngineState(FULL_SPEC);
    expect(s.hash).toBe("f3a9c1");
    expect(s.type).toBe("plan");
    expect(s.status).toBe("in-progress");
    expect(s.stage).toBe("design");
    expect(s.enteredAt).toBe("prd");
    expect(s.gateStatus).toEqual({
      prd_validated: true,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
    });
    expect(s.gateVerdicts).toEqual({
      prd: "PASS",
      design: "FAIL",
      plan: null,
      evals: null,
    });
    expect(s.outcome).toEqual({ status: null, measure_by: null });
    expect(s.workstream).toBe("_devx/workstreams/demo");
    expect(s.blockedBy).toEqual(["q7", "q9"]);
  });

  it("defaults every engine field on a v1 spec without them", () => {
    const s = readEngineState(
      "---\nhash: abc123\ntype: plan\nstatus: ready\n---\n\n## Goal\n",
    );
    expect(s.stage).toBeNull();
    expect(s.enteredAt).toBeNull();
    expect(s.gateStatus).toEqual({
      prd_validated: false,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
    });
    expect(s.gateVerdicts).toEqual({
      prd: null,
      design: null,
      plan: null,
      evals: null,
    });
    expect(s.outcome).toEqual({ status: null, measure_by: null });
    expect(s.workstream).toBeNull();
    expect(s.blockedBy).toEqual([]);
  });

  it("fails closed: gate flags only count when literally true", () => {
    const s = readEngineState(
      '---\nhash: a\ngate_status:\n  prd_validated: "true"\n  design_verified: yes-ish\n  plan_verified: 1\n---\nbody\n',
    );
    expect(s.gateStatus.prd_validated).toBe(false);
    expect(s.gateStatus.design_verified).toBe(false);
    expect(s.gateStatus.plan_verified).toBe(false);
  });

  it("rejects unknown stage values instead of propagating them", () => {
    const s = readEngineState("---\nstage: shipping\n---\nbody\n");
    expect(s.stage).toBeNull();
  });

  it("tolerates a scalar blocked_by", () => {
    const s = readEngineState("---\nblocked_by: q7\n---\nbody\n");
    expect(s.blockedBy).toEqual(["q7"]);
  });

  it("returns pure defaults on a file with no frontmatter", () => {
    const s = readEngineState("just a body\n");
    expect(s.hash).toBeNull();
    expect(s.gateStatus.evals_red).toBe(false);
  });

  it("returns pure defaults on malformed YAML frontmatter", () => {
    const s = readEngineState("---\n[:::\n---\nbody\n");
    expect(s.hash).toBeNull();
  });
});

describe("splitFrontmatter", () => {
  it("splits fm and body, body preserved verbatim", () => {
    const split = splitFrontmatter("---\na: 1\n---\nbody line\n");
    expect(split).not.toBeNull();
    expect(split!.fmText).toBe("a: 1");
    expect(split!.body).toBe("body line\n");
  });

  it("returns null when the file has no frontmatter", () => {
    expect(splitFrontmatter("no fm here\n")).toBeNull();
  });
});

describe("applyEnginePatch — round-trip safety (AC #2)", () => {
  it("flips one gate flag without touching anything else", () => {
    const updated = applyEnginePatch(FULL_SPEC, {
      gateStatus: { design_verified: true },
      stage: "plan",
    });
    const s = readEngineState(updated);
    expect(s.gateStatus.design_verified).toBe(true);
    expect(s.gateStatus.prd_validated).toBe(true);
    expect(s.stage).toBe("plan");
    // Unknown field survives.
    expect(updated).toContain("custom_field: keep-me");
    // Inline YAML comment survives (parseDocument round-trip).
    expect(updated).toContain("# v1 field, unchanged");
    // Body survives byte-for-byte.
    expect(updated).toContain("- 2026-07-05T13:00 — created.");
    expect(updated.split("## Status log").length).toBe(2);
  });

  it("preserves frontmatter key order", () => {
    const updated = applyEnginePatch(FULL_SPEC, {
      gateStatus: { evals_red: true },
    });
    const hashIdx = updated.indexOf("hash:");
    const stageIdx = updated.indexOf("stage:");
    const customIdx = updated.indexOf("custom_field:");
    expect(hashIdx).toBeGreaterThan(-1);
    expect(hashIdx).toBeLessThan(stageIdx);
    expect(stageIdx).toBeLessThan(customIdx);
  });

  it("is idempotent: applying the same patch twice yields identical text", () => {
    const once = applyEnginePatch(FULL_SPEC, {
      gateStatus: { design_verified: true },
      stage: "plan",
    });
    const twice = applyEnginePatch(once, {
      gateStatus: { design_verified: true },
      stage: "plan",
    });
    expect(twice).toBe(once);
  });

  it("creates gate_status/outcome maps when the spec lacks them", () => {
    const v1Spec = "---\nhash: abc123\nstatus: ready\n---\n\nbody\n";
    const updated = applyEnginePatch(v1Spec, {
      gateStatus: { prd_validated: true },
      outcome: { status: "pending" },
    });
    const s = readEngineState(updated);
    expect(s.gateStatus.prd_validated).toBe(true);
    expect(s.outcome.status).toBe("pending");
    expect(updated).toContain("body");
  });

  it("throws on a spec with no frontmatter", () => {
    expect(() => applyEnginePatch("no fm\n", { stage: "prd" })).toThrow(
      /no frontmatter/,
    );
  });

  it("round-trips a parse→patch→parse cycle stably", () => {
    const updated = applyEnginePatch(FULL_SPEC, { stage: "red" });
    const s = readEngineState(updated);
    expect(s.stage).toBe("red");
    expect(s.blockedBy).toEqual(["q7", "q9"]);
  });

  it("does NOT fold long scalar lines (self-review finding: yaml lineWidth)", () => {
    const longTitle = `title: ${"word ".repeat(30).trim()}`;
    const spec = `---\nhash: abc123\n${longTitle}\nstatus: ready\n---\nbody\n`;
    const updated = applyEnginePatch(spec, { stage: "prd" });
    expect(updated).toContain(`\n${longTitle}\n`);
  });
});

describe("gate_verdicts (hfi102)", () => {
  it("keys and flags map 1:1 (GATE_KEYS ↔ GATE_FLAGS via FLAG_TO_GATE_KEY)", () => {
    expect(GATE_KEYS).toEqual(["prd", "design", "plan", "evals"]);
    expect(Object.keys(FLAG_TO_GATE_KEY).sort()).toEqual([...GATE_FLAGS].sort());
    expect(Object.values(FLAG_TO_GATE_KEY).sort()).toEqual([...GATE_KEYS].sort());
  });

  it("parses defensively: value outside the D-9 vocabulary reads null", () => {
    const s = readEngineState(
      "---\nhash: a\ngate_verdicts:\n  prd: PASSED\n  design: pass\n  plan: CONCERNS\n  evals: 1\n---\nbody\n",
    );
    expect(s.gateVerdicts).toEqual({
      prd: null,
      design: null,
      plan: "CONCERNS",
      evals: null,
    });
  });

  it("treats a non-map gate_verdicts as all-null", () => {
    const s = readEngineState("---\nhash: a\ngate_verdicts: PASS\n---\nbody\n");
    expect(s.gateVerdicts).toEqual({
      prd: null,
      design: null,
      plan: null,
      evals: null,
    });
  });

  it("verdict-only patch (the FAIL-run shape) leaves flags, stage, and body alone", () => {
    const updated = applyEnginePatch(FULL_SPEC, {
      gateVerdicts: { plan: "FAIL" },
    });
    const s = readEngineState(updated);
    expect(s.gateVerdicts.plan).toBe("FAIL");
    // Siblings untouched; unwritten gate stays null.
    expect(s.gateVerdicts.prd).toBe("PASS");
    expect(s.gateVerdicts.evals).toBeNull();
    // Booleans and stage byte-untouched.
    expect(s.gateStatus).toEqual({
      prd_validated: true,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
    });
    expect(s.stage).toBe("design");
    // Round-trip hygiene holds for the new map too.
    expect(updated).toContain("custom_field: keep-me");
    expect(updated).toContain("# v1 field, unchanged");
    expect(updated).toContain("- 2026-07-05T13:00 — created.");
  });

  it("null in a patch clears a verdict back to never-evaluated (revise shape)", () => {
    const updated = applyEnginePatch(FULL_SPEC, {
      gateVerdicts: { prd: null, design: null },
    });
    const s = readEngineState(updated);
    expect(s.gateVerdicts).toEqual({
      prd: null,
      design: null,
      plan: null,
      evals: null,
    });
    // Clearing verdicts never touches the booleans (revise.ts owns those).
    expect(s.gateStatus.prd_validated).toBe(true);
  });

  it("combined pass patch (flag + stage + verdict) lands atomically", () => {
    const updated = applyEnginePatch(FULL_SPEC, {
      stage: "plan",
      gateStatus: { design_verified: true },
      gateVerdicts: { design: "PASS" },
    });
    const s = readEngineState(updated);
    expect(s.stage).toBe("plan");
    expect(s.gateStatus.design_verified).toBe(true);
    expect(s.gateVerdicts.design).toBe("PASS");
  });

  it("creates the gate_verdicts map on a spec that lacks it (legacy migration)", () => {
    const v1Spec = "---\nhash: abc123\nstatus: ready\n---\n\nbody\n";
    const updated = applyEnginePatch(v1Spec, {
      gateVerdicts: { evals: "CONCERNS" },
    });
    const s = readEngineState(updated);
    expect(s.gateVerdicts.evals).toBe("CONCERNS");
    expect(s.gateVerdicts.prd).toBeNull();
    expect(updated).toContain("body");
  });

  it("is idempotent: same verdict patch twice yields identical text", () => {
    const once = applyEnginePatch(FULL_SPEC, { gateVerdicts: { evals: "PASS" } });
    const twice = applyEnginePatch(once, { gateVerdicts: { evals: "PASS" } });
    expect(twice).toBe(once);
  });
});

describe("ensureEngineFrontmatter", () => {
  const V1_SPEC =
    "---\nhash: abc123\ntype: plan\nstatus: ready\n---\n\n## Status log\n\n- created.\n";

  it("adds all engine keys to a v1 spec", () => {
    const { content, changed } = ensureEngineFrontmatter(V1_SPEC, {
      stage: "prd",
      enteredAt: "prd",
      workstream: "_devx/workstreams/demo",
    });
    expect(changed).toBe(true);
    const s = readEngineState(content);
    expect(s.stage).toBe("prd");
    expect(s.enteredAt).toBe("prd");
    expect(s.gateStatus).toEqual({
      prd_validated: false,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
    });
    expect(s.workstream).toBe("_devx/workstreams/demo");
    expect(content).toContain("- created.");
  });

  it("never resets live state on an already-initialized spec (no-op)", () => {
    const { content, changed } = ensureEngineFrontmatter(FULL_SPEC, {
      stage: "prd",
      enteredAt: "prd",
      workstream: "_devx/workstreams/other",
    });
    expect(changed).toBe(false);
    expect(content).toBe(FULL_SPEC);
    const s = readEngineState(content);
    expect(s.stage).toBe("design"); // NOT reset to prd
    expect(s.gateStatus.prd_validated).toBe(true); // NOT reset
    expect(s.workstream).toBe("_devx/workstreams/demo"); // NOT rebound
  });

  it("fills in only the missing gate flags on a partial gate_status", () => {
    const partial =
      "---\nhash: a\nstage: prd\nentered_at: prd\nworkstream: w\ngate_status:\n  prd_validated: true\n---\nbody\n";
    const { content, changed } = ensureEngineFrontmatter(partial, {
      stage: "prd",
      enteredAt: "prd",
      workstream: "w",
    });
    expect(changed).toBe(true);
    const s = readEngineState(content);
    expect(s.gateStatus.prd_validated).toBe(true); // preserved
    expect(s.gateStatus.evals_red).toBe(false); // added
  });
});

describe("stageIndex + GATE_FLAGS", () => {
  it("orders stages for rollback comparisons", () => {
    expect(stageIndex("prd")).toBeLessThan(stageIndex("design"));
    expect(stageIndex("design")).toBeLessThan(stageIndex("plan"));
    expect(stageIndex("plan")).toBeLessThan(stageIndex("red"));
    expect(stageIndex("red")).toBeLessThan(stageIndex("executing"));
  });

  it("exports the four flags in gate order", () => {
    expect(GATE_FLAGS).toEqual([
      "prd_validated",
      "design_verified",
      "plan_verified",
      "evals_red",
    ]);
  });
});

describe("findSpecForHashIn", () => {
  it("resolves a plan spec by hash and rejects prefix collisions", () => {
    const repo = makeEngineRepo();
    try {
      repo.write("plan/plan-ab12-2026-07-05T13:00-short.md", "---\nhash: ab12\n---\n");
      repo.write("plan/plan-ab123-2026-07-05T13:00-long.md", "---\nhash: ab123\n---\n");
      const hit = findSpecForHashIn(repo.root, "plan", "ab12");
      expect(hit).toContain("plan-ab12-2026-07-05T13:00-short.md");
      const hit2 = findSpecForHashIn(repo.root, "plan", "ab123");
      expect(hit2).toContain("plan-ab123-");
      expect(findSpecForHashIn(repo.root, "plan", "zz99")).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it("returns null when the spec dir doesn't exist", () => {
    const repo = makeEngineRepo();
    try {
      expect(findSpecForHashIn(repo.root, "focus", "ab12")).toBeNull();
    } finally {
      repo.cleanup();
    }
  });
});
