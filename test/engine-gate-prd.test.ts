// Adversarial tests for `devx gate prd` (v2e101 AC #3): seeded-defect
// fixtures (missing threshold, dangling Covers ID, orphan G-, placeholder
// furniture, too-few E-blocks, INTERVIEW blocker) must produce the exact
// refusal; pass flips prd_validated + stage: design; fail writes NOTHING.
// Exit 0 pass / 1 fail / 2 error.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGatePrd } from "../src/commands/gate.js";
import {
  evaluateGatePrd,
  extractDefinedIds,
  findPlaceholder,
  isConcreteVerifiedBy,
  stripExemptSpans,
} from "../src/lib/engine/gate-prd.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
  validExpectations,
  validPrd,
} from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// Pure-fn layer
// ---------------------------------------------------------------------------

function evaluate(overrides: {
  prd?: string;
  expectations?: string;
  blockedBy?: string[];
  expectationsMin?: number;
}) {
  return evaluateGatePrd({
    prd: overrides.prd ?? validPrd(),
    expectations: overrides.expectations ?? validExpectations(),
    blockedBy: overrides.blockedBy ?? [],
    expectationsMin: overrides.expectationsMin ?? 3,
  });
}

function checksOf(result: ReturnType<typeof evaluate>): string[] {
  return result.gaps.map((g) => g.check);
}

describe("evaluateGatePrd — clean fixture", () => {
  it("passes a fully-authored PRD + expectations", () => {
    const result = evaluate({});
    expect(result.gaps).toEqual([]);
    expect(result.verdict).toBe("PASS");
    expect(result.definedIds).toContain("G-1");
    expect(result.definedIds).toContain("FR-1");
  });
});

describe("evaluateGatePrd — seeded defects", () => {
  it("missing threshold → expectation-threshold-missing", () => {
    const exp = validExpectations().replace(
      "- **Threshold:** tour present on 100% of PRs\n",
      "",
    );
    const result = evaluate({ expectations: exp });
    expect(result.verdict).toBe("FAIL");
    expect(checksOf(result)).toContain("expectation-threshold-missing");
  });

  it("non-numeric threshold → expectation-threshold-not-numeric", () => {
    const exp = validExpectations().replace(
      "- **Threshold:** tour present on 100% of PRs",
      "- **Threshold:** the tour should feel fast",
    );
    const result = evaluate({ expectations: exp });
    expect(checksOf(result)).toContain("expectation-threshold-not-numeric");
    expect(result.gaps.find((g) => g.check === "expectation-threshold-not-numeric")!.message).toContain("E-1");
  });

  it("dangling Covers ID → covers-id-dangling naming the ID", () => {
    const exp = validExpectations().replace("`G-1, UC-1, FR-1`", "`G-1, UC-9, FR-1`");
    const result = evaluate({ expectations: exp });
    expect(result.verdict).toBe("FAIL");
    const gap = result.gaps.find((g) => g.check === "covers-id-dangling");
    expect(gap).toBeDefined();
    expect(gap!.message).toContain("UC-9");
    expect(gap!.message).toContain("E-1");
  });

  it("orphan G- goal (defined but never covered) → goal-uncovered", () => {
    const prd = validPrd().replace(
      "- **G-2**: zero silent scope-creep incidents per month",
      "- **G-2**: zero silent scope-creep incidents per month\n- **G-3**: onboarding under 5 minutes",
    );
    const result = evaluate({ prd });
    expect(result.verdict).toBe("FAIL");
    const gap = result.gaps.find((g) => g.check === "goal-uncovered");
    expect(gap!.message).toContain("G-3");
    expect(gap!.location).toMatch(/^prd\.md:\d+$/);
  });

  it("uncovered UC-/CAP-/FR- IDs do NOT fail the gate (only G- is bidirectional)", () => {
    const prd = validPrd().replace(
      "- **CAP-1**: tour generation from diffs",
      "- **CAP-1**: tour generation from diffs\n- **CAP-2**: uncovered capability",
    );
    const result = evaluate({ prd });
    expect(checksOf(result)).not.toContain("goal-uncovered");
    expect(result.verdict).toBe("PASS");
  });

  it("template EARS line (placeholder that matches the regex) → placeholder gap", () => {
    const exp = validExpectations().replace(
      "When a PR is opened, the system SHALL attach a tour.",
      "When <trigger>, the system SHALL <behavior>.",
    );
    const result = evaluate({ expectations: exp });
    expect(checksOf(result)).toContain("expectation-ears-placeholder");
    expect(checksOf(result)).not.toContain("expectation-ears-shape");
  });

  it("non-EARS expectation → expectation-ears-shape", () => {
    const exp = validExpectations().replace(
      "When a PR is opened, the system SHALL attach a tour.",
      "The tour must always be attached to a PR.",
    );
    const result = evaluate({ expectations: exp });
    expect(checksOf(result)).toContain("expectation-ears-shape");
  });

  it("invalid priority → expectation-priority-invalid", () => {
    const exp = validExpectations().replace("- **Priority:** P0", "- **Priority:** high");
    const result = evaluate({ expectations: exp });
    expect(checksOf(result)).toContain("expectation-priority-invalid");
  });

  it("vague Verified-by prose → expectation-verified-by-vague", () => {
    const exp = validExpectations().replace(
      "- **Verified by:** test/demo.test.mjs",
      "- **Verified by:** manual QA on staging",
    );
    const result = evaluate({ expectations: exp });
    expect(checksOf(result)).toContain("expectation-verified-by-vague");
  });

  it("fewer E-blocks than expectations_min → expectations-too-few", () => {
    const exp = validExpectations().split("## E-3")[0];
    const result = evaluate({ expectations: exp });
    const gap = result.gaps.find((g) => g.check === "expectations-too-few");
    expect(gap!.message).toContain("2 E-block(s)");
    expect(gap!.message).toContain("3");
  });

  it("expectations_min is config-driven (2 blocks pass when min is 2)", () => {
    const exp = validExpectations().split("## E-3")[0];
    // E-3 covered G-1 too, but E-1 still covers G-1 — stays clean.
    const result = evaluate({ expectations: exp, expectationsMin: 2 });
    expect(result.verdict).toBe("PASS");
  });

  it("placeholder PRD section → prd-section-placeholder naming the furniture", () => {
    const prd = validPrd().replace(
      "Reviews take too long and scope creep goes unnoticed.",
      "<what hurts, for whom, and why now>",
    );
    const result = evaluate({ prd });
    const gap = result.gaps.find((g) => g.check === "prd-section-placeholder");
    expect(gap!.message).toContain("## Problem");
    expect(gap!.message).toContain("<what hurts");
  });

  it("missing PRD section → prd-section-missing", () => {
    const prd = validPrd().replace("## Non-goals\n\n- Rewriting the CI system.\n\n", "");
    const result = evaluate({ prd });
    const gap = result.gaps.find((g) => g.check === "prd-section-missing");
    expect(gap!.message).toContain("Non-goals");
  });

  it("empty PRD section → prd-section-empty", () => {
    const prd = validPrd().replace("- Rewriting the CI system.", "");
    const result = evaluate({ prd });
    expect(checksOf(result)).toContain("prd-section-empty");
  });

  it("INTERVIEW blocker (blocked_by non-empty) → interview-blocker", () => {
    const result = evaluate({ blockedBy: ["q7"] });
    const gap = result.gaps.find((g) => g.check === "interview-blocker");
    expect(gap!.message).toContain("q7");
  });

  it("collects EVERY gap, not just the first", () => {
    const exp = validExpectations()
      .replace("- **Priority:** P0", "- **Priority:** urgent")
      .replace("`G-1, UC-1, FR-1`", "`G-9`");
    const result = evaluate({ expectations: exp, blockedBy: ["q1"] });
    const checks = checksOf(result);
    expect(checks).toContain("expectation-priority-invalid");
    expect(checks).toContain("covers-id-dangling");
    expect(checks).toContain("interview-blocker");
    // G-1 lost its only... no: E-3 also covers G-1. G-1 covered; nothing else.
  });
});

describe("placeholder helpers", () => {
  it("stripExemptSpans removes comments, fences, and inline code", () => {
    const text = [
      "real prose",
      "<!-- template guidance <keep out> -->",
      "```ts",
      "const x: Map<string, number> = new Map();",
      "```",
      "uses `Array<number>` inline",
    ].join("\n");
    const stripped = stripExemptSpans(text);
    expect(findPlaceholder(stripped)).toBeNull();
  });

  it("findPlaceholder catches bare template furniture", () => {
    expect(findPlaceholder("- **G-1**: <numeric goal>")).toBe("<numeric goal>");
  });

  it("comparator prose is NOT furniture (self-review finding)", () => {
    expect(findPlaceholder("p95 latency < 8s and retries > 3")).toBeNull();
    const exp = validExpectations().replace(
      "- **Threshold:** tour present on 100% of PRs",
      "- **Threshold:** p95 < 8s and error rate > 0 flagged",
    );
    const result = evaluate({ expectations: exp });
    expect(result.verdict).toBe("PASS");
  });

  it("isConcreteVerifiedBy accepts paths, rejects prose + placeholders", () => {
    expect(isConcreteVerifiedBy("test/demo.test.ts")).toBe(true);
    expect(isConcreteVerifiedBy("`evals/E-1_smoke.md`")).toBe(true);
    expect(isConcreteVerifiedBy("demo.test.ts")).toBe(true);
    expect(isConcreteVerifiedBy("manual QA")).toBe(false);
    expect(isConcreteVerifiedBy("<test path>")).toBe(false);
    expect(isConcreteVerifiedBy("")).toBe(false);
    expect(isConcreteVerifiedBy("somewordwithnodotorslash")).toBe(false);
  });

  it("extractDefinedIds finds bold bullets and headings, deduped", () => {
    const ids = extractDefinedIds(validPrd()).map((r) => r.id);
    expect(ids).toEqual(["G-1", "G-2", "UC-1", "CAP-1", "FR-1"]);
  });

  it("extractDefinedIds ignores prose mentions", () => {
    const ids = extractDefinedIds("We should keep G-1 in mind here.\n").map((r) => r.id);
    expect(ids).toEqual([]);
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

function seedWorkstream(opts: { blockedBy?: string } = {}): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      "stage: prd",
      "entered_at: prd",
      "gate_status:",
      "  prd_validated: false",
      "  design_verified: false",
      "  plan_verified: false",
      "  evals_red: false",
      "outcome:",
      "  status: null",
      "  measure_by: null",
      `workstream: ${WS}`,
      ...(opts.blockedBy ? [`blocked_by: [${opts.blockedBy}]`] : []),
      "---",
      "",
      "## Status log",
      "",
      "- created.",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
}

function gatePrd() {
  const io = captureIo();
  const code = runGatePrd(["abc123"], { ...io, projectPath: repo.configPath });
  return { code, io };
}

describe("devx gate prd — CLI driver", () => {
  it("PASS: exit 0, flips prd_validated + stage: design", () => {
    seedWorkstream();
    const { code, io } = gatePrd();
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.gate).toBe("PASS");
    const state = readEngineState(repo.read(SPEC_REL));
    expect(state.gateStatus.prd_validated).toBe(true);
    expect(state.stage).toBe("design");
  });

  it("PASS on a later-stage spec does not regress the stage", () => {
    seedWorkstream();
    repo.write(SPEC_REL, repo.read(SPEC_REL).replace("stage: prd", "stage: plan"));
    const { code } = gatePrd();
    expect(code).toBe(0);
    expect(readEngineState(repo.read(SPEC_REL)).stage).toBe("plan");
  });

  it("FAIL: exit 1, gap report on stdout, spec untouched", () => {
    seedWorkstream();
    const before = repo.read(SPEC_REL);
    repo.write(
      `${WS}/expectations.md`,
      validExpectations().replace("- **Threshold:** tour present on 100% of PRs\n", ""),
    );
    const { code, io } = gatePrd();
    expect(code).toBe(1);
    const j = io.json() as { gate: string; gaps: Array<{ check: string }> };
    expect(j.gate).toBe("FAIL");
    expect(j.gaps.some((g) => g.check === "expectation-threshold-missing")).toBe(true);
    // Writes NOTHING on fail.
    expect(repo.read(SPEC_REL)).toBe(before);
  });

  it("FAIL on the raw template (all furniture) with per-section gaps", () => {
    seedWorkstream();
    // Overwrite with the shipped templates (title substituted, rest furniture).
    repo.write(`${WS}/prd.md`, repo.read("_devx/templates/engine/prd.md"));
    repo.write(`${WS}/expectations.md`, repo.read("_devx/templates/engine/expectations.md"));
    const { code, io } = gatePrd();
    expect(code).toBe(1);
    const j = io.json() as { gaps: Array<{ check: string }> };
    expect(j.gaps.some((g) => g.check === "prd-section-placeholder")).toBe(true);
  });

  it("FAIL with interview-blocker when blocked_by is non-empty", () => {
    seedWorkstream({ blockedBy: "q7" });
    const { code, io } = gatePrd();
    expect(code).toBe(1);
    const j = io.json() as { gaps: Array<{ check: string; message: string }> };
    const gap = j.gaps.find((g) => g.check === "interview-blocker");
    expect(gap!.message).toContain("q7");
  });

  it("missing prd.md → exit 1 with gate-input-missing (refusal, not error)", () => {
    seedWorkstream();
    repo.write(`${WS}/prd.md`, ""); // can't unlink via fixture; use fs seam instead
    const io = captureIo();
    const code = runGatePrd(["abc123"], {
      ...io,
      projectPath: repo.configPath,
      fs: {
        exists: (p: string) => !p.endsWith("prd.md") || p.includes("templates"),
      },
    });
    expect(code).toBe(1);
    const j = io.json() as { gaps: Array<{ check: string; message: string }> };
    expect(j.gaps[0].check).toBe("gate-input-missing");
    expect(j.gaps[0].message).toContain("/devx prd abc123");
  });

  it("unknown hash → exit 2, nothing on stdout", () => {
    const io = captureIo();
    const code = runGatePrd(["zz9999"], { ...io, projectPath: repo.configPath });
    expect(code).toBe(2);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toContain("no plan spec");
  });

  it("wrong argc → exit 2 with usage", () => {
    const io = captureIo();
    const code = runGatePrd([], { ...io, projectPath: repo.configPath });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("usage:");
  });

  it("respects engine.expectations_min from config", () => {
    const strict = makeEngineRepo({
      config: "mode: YOLO\nengine:\n  expectations_min: 4\n",
    });
    try {
      // Build the same workstream inside the strict repo.
      strict.write(
        SPEC_REL,
        `---\nhash: abc123\ntype: plan\nstatus: in-progress\nstage: prd\nworkstream: ${WS}\n---\nbody\n`,
      );
      strict.mkdir(WS);
      strict.write(`${WS}/prd.md`, validPrd());
      strict.write(`${WS}/expectations.md`, validExpectations());
      const io = captureIo();
      const code = runGatePrd(["abc123"], { ...io, projectPath: strict.configPath });
      expect(code).toBe(1);
      const j = io.json() as { gaps: Array<{ check: string; message: string }> };
      const gap = j.gaps.find((g) => g.check === "expectations-too-few");
      expect(gap!.message).toContain("engine.expectations_min is 4");
    } finally {
      strict.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// v2e102 dogfood regression: house style wraps field values at ~78 chars;
// the parser must fold indented continuation lines into one value. First
// surfaced by the first real `gate prd` run (see the v2x101 workstream's
// decisions/2026-07-05-prd-gate-seeded-defect.md).
// ---------------------------------------------------------------------------

describe("parseExpectations — wrapped field values (v2e102)", () => {
  it("folds a line-wrapped EARS sentence into one value", () => {
    const exp = validExpectations().replace(
      /- \*\*Expectation \(EARS\):\*\* ([^\n]+)\n/,
      "- **Expectation (EARS):** When the artifact builds after a merge,\n" +
        "  the system SHALL keep the wrapped value intact.\n",
    );
    const result = evaluate({ expectations: exp });
    expect(checksOf(result)).not.toContain("expectation-ears-shape");
  });

  it("folds a wrapped Verified-by target", () => {
    const exp = validExpectations().replace(
      /- \*\*Verified by:\*\* ([^\n]+)\n/,
      "- **Verified by:**\n  test/tour-build.test.ts\n",
    );
    const result = evaluate({ expectations: exp });
    expect(checksOf(result)).not.toContain("expectation-verified-by-vague");
  });

  it("does not bleed a continuation into the next field", () => {
    const exp = validExpectations().replace(
      /- \*\*Trigger:\*\* ([^\n]+)\n/,
      "- **Trigger:** a wrapped trigger sentence\n  continuing here\n",
    );
    const result = evaluate({ expectations: exp });
    // Threshold and Verified-by on the following lines must stay intact.
    expect(checksOf(result)).not.toContain("expectation-threshold-missing");
    expect(checksOf(result)).not.toContain("expectation-verified-by-vague");
  });

  it("blank line closes an open field (no over-folding)", () => {
    const exp = validExpectations().replace(
      /- \*\*Verified by:\*\* ([^\n]+)\n/,
      "- **Verified by:** $1\n\n  stray indented prose after a blank line\n",
    );
    const result = evaluate({ expectations: exp });
    expect(checksOf(result)).not.toContain("expectation-verified-by-vague");
  });
});
