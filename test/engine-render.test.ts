// Tests for renderGateSummary (hfi102 AC 4): the per-gate verdict line with
// the verdict → legacy-flag-PASS → never-run fallback chain, and the FAIL
// fix-path lines (report pointer + re-run command). Pure-module tests —
// the decisions/ listing is caller-supplied, no disk involved.

import { describe, expect, it } from "vitest";

import {
  type EngineState,
  type GateVerdicts,
} from "../src/lib/engine/frontmatter.js";
import {
  newestDecisionReport,
  renderGateSummary,
} from "../src/lib/engine/render.js";

function state(overrides?: {
  hash?: string | null;
  gates?: Partial<EngineState["gateStatus"]>;
  verdicts?: Partial<GateVerdicts>;
}): EngineState {
  return {
    hash: overrides?.hash === undefined ? "eac479" : overrides.hash,
    type: "plan",
    status: "in-progress",
    stage: "design",
    enteredAt: null,
    gateStatus: {
      prd_validated: false,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
      ...(overrides?.gates ?? {}),
    },
    gateVerdicts: {
      prd: null,
      design: null,
      plan: null,
      evals: null,
      ...(overrides?.verdicts ?? {}),
    },
    outcome: { status: null, measure_by: null },
    workstream: null,
    blockedBy: [],
  };
}

describe("renderGateSummary — fallback chain", () => {
  it("renders all-never-run as em-dashes with no fix-path lines", () => {
    expect(renderGateSummary(state())).toBe(
      "gates: prd — · design — · plan — · evals —",
    );
  });

  it("renders a legacy flag-true gate (no verdict) as PASS — the migration path", () => {
    const s = state({
      gates: { prd_validated: true, design_verified: true },
    });
    expect(renderGateSummary(s)).toBe(
      "gates: prd PASS · design PASS · plan — · evals —",
    );
  });

  it("a non-null verdict wins over the flag — FAIL renders distinct from never-run", () => {
    const s = state({
      verdicts: { prd: "PASS", design: "FAIL" },
    });
    const lines = renderGateSummary(s).split("\n");
    expect(lines[0]).toBe("gates: prd PASS · design FAIL · plan — · evals —");
  });

  it("renders CONCERNS and WAIVED verbatim, with no fix-path line", () => {
    const s = state({
      verdicts: { design: "CONCERNS", evals: "WAIVED" },
    });
    expect(renderGateSummary(s)).toBe(
      "gates: prd — · design CONCERNS · plan — · evals WAIVED",
    );
  });
});

describe("renderGateSummary — FAIL fix-path lines", () => {
  const WS = "_devx/workstreams/harness-fold-in";

  it("design FAIL points at the newest design-verify report + coverage re-run", () => {
    const s = state({ verdicts: { design: "FAIL" } });
    const out = renderGateSummary(s, {
      workstreamRel: WS,
      decisionNames: [
        "2026-07-20-design-verify.md",
        "2026-07-24-design-verify.md",
        "2026-07-23-plan-verify.md",
      ],
    });
    expect(out.split("\n")[1]).toBe(
      `  design FAIL → report: ${WS}/decisions/2026-07-24-design-verify.md · re-run: devx gate coverage eac479`,
    );
  });

  it("plan FAIL selects plan-verify reports, not design ones", () => {
    const s = state({ verdicts: { plan: "FAIL" } });
    const out = renderGateSummary(s, {
      workstreamRel: WS,
      decisionNames: [
        "2026-07-24-design-verify.md",
        "2026-07-22-plan-verify.md",
      ],
    });
    expect(out.split("\n")[1]).toBe(
      `  plan FAIL → report: ${WS}/decisions/2026-07-22-plan-verify.md · re-run: devx gate coverage eac479`,
    );
  });

  it("evals FAIL points at the fixed RED-report path", () => {
    const s = state({ verdicts: { evals: "FAIL" } });
    const out = renderGateSummary(s, { workstreamRel: WS });
    expect(out.split("\n")[1]).toBe(
      `  evals FAIL → report: ${WS}/evals/RED-report.md · re-run: devx gate evals eac479`,
    );
  });

  it("prd FAIL carries the re-run command only — no report artifact exists", () => {
    const s = state({ verdicts: { prd: "FAIL" } });
    const out = renderGateSummary(s, {
      workstreamRel: WS,
      decisionNames: ["2026-07-24-design-verify.md"],
    });
    expect(out.split("\n")[1]).toBe(
      "  prd FAIL → re-run: devx gate prd eac479",
    );
  });

  it("degrades to re-run-only when no workstream dir is known", () => {
    const s = state({ verdicts: { design: "FAIL" } });
    expect(renderGateSummary(s).split("\n")[1]).toBe(
      "  design FAIL → re-run: devx gate coverage eac479",
    );
  });

  it("degrades to re-run-only when no matching decision report exists", () => {
    const s = state({ verdicts: { design: "FAIL" } });
    const out = renderGateSummary(s, {
      workstreamRel: WS,
      decisionNames: ["2026-07-22-plan-verify.md", "notes.md"],
    });
    expect(out.split("\n")[1]).toBe(
      "  design FAIL → re-run: devx gate coverage eac479",
    );
  });

  it("emits one fix-path line per FAILed gate, in gate order", () => {
    const s = state({
      verdicts: { design: "FAIL", evals: "FAIL" },
      gates: { prd_validated: true },
    });
    const lines = renderGateSummary(s, { workstreamRel: WS }).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("gates: prd PASS · design FAIL · plan — · evals FAIL");
    expect(lines[1]).toContain("design FAIL →");
    expect(lines[2]).toContain("evals FAIL →");
  });

  it("prefers ctx.hash over state.hash for the re-run command", () => {
    const s = state({ hash: "aaaaaa", verdicts: { prd: "FAIL" } });
    const out = renderGateSummary(s, { hash: "bbbbbb" });
    expect(out).toContain("devx gate prd bbbbbb");
  });

  it("falls back to state.hash, then a literal placeholder", () => {
    const s = state({ hash: null, verdicts: { prd: "FAIL" } });
    expect(renderGateSummary(s)).toContain("devx gate prd <hash>");
    expect(
      renderGateSummary(state({ verdicts: { prd: "FAIL" } })),
    ).toContain("devx gate prd eac479");
  });
});

describe("newestDecisionReport", () => {
  it("picks the lexicographically newest ISO-dated report for the mode", () => {
    expect(
      newestDecisionReport(
        [
          "2026-07-05-design-verify.md",
          "2026-07-24-design-verify.md",
          "2026-07-19-design-verify.md",
        ],
        "design",
      ),
    ).toBe("2026-07-24-design-verify.md");
  });

  it("ignores other modes and non-report files; empty → null", () => {
    expect(
      newestDecisionReport(
        ["2026-07-24-plan-verify.md", "README.md", "design-verify.md"],
        "design",
      ),
    ).toBeNull();
    expect(newestDecisionReport([], "plan")).toBeNull();
  });
});
