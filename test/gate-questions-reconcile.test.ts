// `devx gate …` → questions.md, end to end (B11/C11).
//
// The contract under test is the one the gap analysis named: a Gate-2 or
// Gate-3 FAIL/CONCERNS run leaves Q-N entries carrying Kind / Severity /
// Blocks / Recommendation / Status, and a re-run that passes resolves them.
// Gates 1 and 4 reconcile the same way, on their own `Blocks:` scope.
//
// Also pins the posture: the reconcile is bookkeeping, so it can never move
// an exit code, and a broken queue is a warning rather than a failed gate.

import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  runGateCoverage,
  runGateEvalsCli,
  runGatePrd,
} from "../src/commands/gate.js";
import {
  healthCounts,
  parseQuestions,
} from "../src/lib/engine/questions.js";
import { formatDate } from "../src/lib/engine/verdict.js";
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

const WS = "_devx/workstreams/demo-feature";
const SPEC_REL = "plan/plan-abc123-2026-07-24T10:41-demo-feature.md";
const QUESTIONS = `${WS}/questions.md`;
const FIXED_NOW = () => new Date(2026, 10, 20, 12, 0, 0);
const DATE = formatDate(FIXED_NOW());

function spec(flags: {
  stage: string;
  prd_validated?: boolean;
  design_verified?: boolean;
  plan_verified?: boolean;
}): string {
  return [
    "---",
    "hash: abc123",
    "type: plan",
    "status: in-progress",
    `stage: ${flags.stage}`,
    "gate_status:",
    `  prd_validated: ${flags.prd_validated ?? false}`,
    `  design_verified: ${flags.design_verified ?? false}`,
    `  plan_verified: ${flags.plan_verified ?? false}`,
    "  evals_red: false",
    `workstream: ${WS}`,
    "---",
    "body",
    "",
  ].join("\n");
}

function seed(flags: Parameters<typeof spec>[0]): EngineRepo {
  const repo = makeEngineRepo();
  repo.write(SPEC_REL, spec(flags));
  repo.mkdir(WS);
  repo.write(`${WS}/prd/agent.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
  return repo;
}

function queue(repo: EngineRepo) {
  return parseQuestions(repo.read(QUESTIONS));
}

/** One `devx gate coverage` run in design mode, with a judgment table. */
function runDesign(
  repo: EngineRepo,
  table: string,
): { code: number; stderr: string } {
  const io = captureIo();
  repo.write("table.json", table);
  // harness-s4: without captured research Gate 2's hygiene lens adds its own
  // `concern` entry; these cases count coverage entries, so seed it.
  if (!repo.exists(`${WS}/design/research.md`)) repo.write(`${WS}/design/research.md`, "# Research\n");
  const code = runGateCoverage(
    ["abc123"],
    { table: join(repo.root, "table.json") },
    { ...io, projectPath: repo.configPath, now: FIXED_NOW },
  );
  return { code, stderr: io.stderr() };
}

describe("devx gate coverage (design) → health queue", () => {
  it("a FAIL leaves a blocking entry with all five required fields", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      const { code } = runDesign(repo, designTable({ "FR-1": "missing" }));
      expect(code).toBe(1);

      const entries = queue(repo).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: "Q-1",
        title: "FR-1 coverage",
        kind: "gate-concern",
        severity: "blocking",
        blocks: "gate-design",
        status: "open",
      });
      expect(entries[0].recommendation).toContain("FR-1 is ❌ missing");
      expect(entries[0].origin).toContain("devx gate coverage");
      expect(healthCounts(entries)).toEqual({ blocking: 1, concern: 0 });
    } finally {
      repo.cleanup();
    }
  });

  it("a CONCERNS run records the partial as a concern, not a blocker", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      const { code } = runDesign(repo, designTable({ "CAP-1": "partial" }));
      // CONCERNS advances — exit 0 (D-9 semantics).
      expect(code).toBe(0);
      const entries = queue(repo).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        title: "CAP-1 coverage",
        severity: "concern",
        status: "open",
      });
      expect(healthCounts(entries)).toEqual({ blocking: 0, concern: 1 });
    } finally {
      repo.cleanup();
    }
  });

  it("one entry per ID even when it contributes several reasons", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      runDesign(
        repo,
        designTable({ "FR-1": "missing", "G-1": "partial", "G-2": "missing" }),
      );
      const entries = queue(repo).entries;
      expect(entries.map((q) => q.title)).toEqual([
        "G-1 coverage",
        "G-2 coverage",
        "FR-1 coverage",
      ]);
      expect(healthCounts(entries)).toEqual({ blocking: 2, concern: 1 });
    } finally {
      repo.cleanup();
    }
  });

  it("a re-run that PASSES resolves the prior FAIL's entries, pointing at the report", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      expect(runDesign(repo, designTable({ "FR-1": "missing" })).code).toBe(1);
      expect(healthCounts(queue(repo).entries)).toEqual({
        blocking: 1,
        concern: 0,
      });

      // Same ids, now fully covered — a clean re-run.
      expect(runDesign(repo, designTable()).code).toBe(0);
      const entries = queue(repo).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: "Q-1", status: "resolved" });
      expect(entries[0].resolution).toBe(
        `${WS}/decisions/${DATE}-design-verify.md`,
      );
      expect(healthCounts(entries)).toEqual({ blocking: 0, concern: 0 });
    } finally {
      repo.cleanup();
    }
  });

  it("a re-run that improves a finding UPDATES the same Q-id rather than adding one", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      runDesign(repo, designTable({ "FR-1": "missing" }));
      // design_verified is now false (FAIL), so the gate re-runs in design mode.
      runDesign(repo, designTable({ "FR-1": "partial" }));
      const entries = queue(repo).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: "Q-1",
        severity: "concern",
        status: "open",
      });
      expect(entries[0].recommendation).toContain("⚠️ partial");
    } finally {
      repo.cleanup();
    }
  });

  it("instantiates the queue from the shipped template on a grandfathered workstream", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      expect(repo.exists(QUESTIONS)).toBe(false);
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      const { stderr } = runDesign(repo, designTable({ "FR-1": "missing" }));
      expect(repo.exists(QUESTIONS)).toBe(true);
      expect(repo.read(QUESTIONS).startsWith("<!-- questions.md")).toBe(true);
      // Title substituted from the workstream slug, not left as the placeholder.
      expect(repo.read(QUESTIONS)).toContain("Demo Feature");
      expect(repo.read(QUESTIONS)).not.toContain("<workstream title>");
      expect(stderr).toContain("health queue");
      expect(stderr).toContain("created");
    } finally {
      repo.cleanup();
    }
  });

  it("a PASS on a workstream with no queue and no findings writes nothing", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      expect(runDesign(repo, designTable()).code).toBe(0);
      // Created-and-empty is still a create, so the file exists; what matters
      // is that it holds no entries and the gate said so.
      expect(queue(repo).entries).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx gate coverage (plan) → health queue", () => {
  it("scopes its entries to gate-plan and leaves gate-design's alone", () => {
    const repo = seed({
      stage: "plan",
      prd_validated: true,
      design_verified: true,
    });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n");
      repo.write(`${WS}/plan/agent.md`, validPlan());
      // A live Gate-2 entry that this run must not touch.
      repo.write(
        QUESTIONS,
        [
          "## Q-1: an old design concern",
          "",
          "- **Kind:** gate-concern",
          "- **Severity:** blocking",
          "- **Blocks:** gate-design",
          "- **Origin:** devx gate coverage",
          "- **Recommendation:** fix the design",
          "- **Status:** open",
          "- **Resolution:** —",
          "",
          "---",
          "",
        ].join("\n"),
      );
      const io = captureIo();
      repo.write("table.json", planTable({ "E-2": { status: "partial" } }));
      const code = runGateCoverage(
        ["abc123"],
        { table: join(repo.root, "table.json") },
        { ...io, projectPath: repo.configPath, now: FIXED_NOW },
      );
      expect(code).toBe(0); // E-2 is P1 — partial is CONCERNS, not FAIL

      const entries = queue(repo).entries;
      expect(entries.map((q) => [q.id, q.blocks, q.status])).toEqual([
        ["Q-1", "gate-design", "open"],
        ["Q-2", "gate-plan", "open"],
      ]);
      expect(healthCounts(entries)).toEqual({ blocking: 1, concern: 1 });
    } finally {
      repo.cleanup();
    }
  });

  it("a P0 shortfall is blocking even when its row is only partial", () => {
    const repo = seed({
      stage: "plan",
      prd_validated: true,
      design_verified: true,
    });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n");
      repo.write(`${WS}/plan/agent.md`, validPlan());
      const io = captureIo();
      // E-1 is P0 in validExpectations().
      repo.write("table.json", planTable({ "E-1": { status: "partial" } }));
      const code = runGateCoverage(
        ["abc123"],
        { table: join(repo.root, "table.json") },
        { ...io, projectPath: repo.configPath, now: FIXED_NOW },
      );
      expect(code).toBe(1);
      const entries = queue(repo).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        title: "E-1 coverage",
        severity: "blocking",
      });
      expect(entries[0].recommendation).toContain("P0 floor unmet");
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx gate prd → health queue", () => {
  it("records every gap as blocking under gate-prd, then resolves on PASS", () => {
    const repo = seed({ stage: "prd" });
    try {
      // A PRD missing a required section → FAIL with gaps.
      repo.write(`${WS}/prd/agent.md`, "# PRD — Demo Feature\n\n## Problem\n\nx.\n");
      const io = captureIo();
      const code = runGatePrd(["abc123"], {
        ...io,
        projectPath: repo.configPath,
        now: FIXED_NOW,
      });
      expect(code).toBe(1);
      const entries = queue(repo).entries;
      expect(entries.length).toBeGreaterThan(0);
      for (const q of entries) {
        expect(q.kind).toBe("gate-concern");
        expect(q.blocks).toBe("gate-prd");
        expect(q.severity).toBe("blocking");
        expect(q.status).toBe("open");
        expect(q.recommendation).not.toBe("");
      }

      // Fix the PRD; the re-run passes and clears the whole scope.
      repo.write(`${WS}/prd/agent.md`, validPrd());
      const io2 = captureIo();
      expect(
        runGatePrd(["abc123"], {
          ...io2,
          projectPath: repo.configPath,
          now: FIXED_NOW,
        }),
      ).toBe(0);
      expect(healthCounts(queue(repo).entries)).toEqual({
        blocking: 0,
        concern: 0,
      });
      // Gate 1 has no report artifact, so a resolved entry points at the spec
      // whose frontmatter records the passing verdict.
      expect(queue(repo).entries[0].resolution).toBe(SPEC_REL);
    } finally {
      repo.cleanup();
    }
  });

  it("writes nothing when the gate REFUSES for a missing input", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(SPEC_REL, spec({ stage: "prd" }));
      repo.mkdir(WS);
      const io = captureIo();
      // No prd/agent.md and no expectations.md — a refusal, not a verdict.
      expect(
        runGatePrd(["abc123"], { ...io, projectPath: repo.configPath }),
      ).toBe(1);
      expect(repo.exists(QUESTIONS)).toBe(false);
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx gate evals → health queue", () => {
  it("takes severity from the eval's own blocking flag, under gate-evals", () => {
    const repo = seed({
      stage: "red",
      prd_validated: true,
      design_verified: true,
      plan_verified: true,
    });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n");
      repo.write(`${WS}/plan/agent.md`, validPlan());
      repo.write("test/demo.test.mjs", "process.exit(1);\n");
      repo.write("test/perf.test.mjs", "process.exit(1);\n");
      const io = captureIo();
      // Every eval observed GREEN where RED was required → gaps.
      const code = runGateEvalsCli(["abc123"], {}, {
        ...io,
        projectPath: repo.configPath,
        now: FIXED_NOW,
        exec: () => ({ stdout: "", stderr: "", exitCode: 0 }),
      });
      expect(code).toBe(1);
      const entries = queue(repo).entries;
      expect(entries.length).toBeGreaterThan(0);
      for (const q of entries) {
        expect(q.blocks).toBe("gate-evals");
        expect(q.kind).toBe("gate-concern");
      }
      expect(entries.some((q) => q.severity === "blocking")).toBe(true);
      expect(queue(repo).entries[0].resolution).toBe("");
    } finally {
      repo.cleanup();
    }
  });

  it("--dry-run and --verify write nothing (they compute no verdict)", () => {
    const repo = seed({
      stage: "red",
      prd_validated: true,
      design_verified: true,
      plan_verified: true,
    });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n");
      repo.write(`${WS}/plan/agent.md`, validPlan());
      const io = captureIo();
      runGateEvalsCli(["abc123"], { dryRun: true }, {
        ...io,
        projectPath: repo.configPath,
      });
      expect(repo.exists(QUESTIONS)).toBe(false);
      runGateEvalsCli(["abc123"], { verify: true }, {
        ...io,
        projectPath: repo.configPath,
      });
      expect(repo.exists(QUESTIONS)).toBe(false);
    } finally {
      repo.cleanup();
    }
  });
});

describe("the reconcile is bookkeeping — it never moves a verdict", () => {
  it("an unparseable queue warns and leaves the file untouched, exit unchanged", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      const broken = [
        "## Q-1: hand-broken",
        "",
        "- **Kind:** gate-concern",
        "- **Blocks:** gate-design",
        "- **Status:** open",
        "",
      ].join("\n");
      repo.write(QUESTIONS, broken);
      const { code, stderr } = runDesign(repo, designTable({ "FR-1": "missing" }));
      // The VERDICT is unaffected by the paperwork.
      expect(code).toBe(1);
      expect(stderr).toContain("does not parse");
      expect(stderr).toContain("missing Severity");
      expect(repo.read(QUESTIONS)).toBe(broken);
    } finally {
      repo.cleanup();
    }
  });

  it("a missing shipped template still records the findings, with a warning", () => {
    const repo = seed({ stage: "design", prd_validated: true });
    try {
      repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
      // Simulate a repo whose templates were never installed.
      rmSync(join(repo.root, "_devx", "templates", "engine", "questions.md"));
      const { code, stderr } = runDesign(repo, designTable({ "FR-1": "missing" }));
      expect(code).toBe(1);
      expect(stderr).toContain("engine template missing");
      const entries = queue(repo).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe("FR-1 coverage");
      // No stray leading blank line on a header-less queue.
      expect(repo.read(QUESTIONS).startsWith("## Q-1:")).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("the gate never READS the queue — the verdict is identical with and without one", () => {
    const trace = (seedQueue: string | null) => {
      const repo = seed({ stage: "design", prd_validated: true });
      try {
        repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
        if (seedQueue !== null) repo.write(QUESTIONS, seedQueue);
        const io = captureIo();
        repo.write("table.json", designTable({ "FR-1": "missing" }));
        const code = runGateCoverage(
          ["abc123"],
          { table: join(repo.root, "table.json") },
          { ...io, projectPath: repo.configPath, now: FIXED_NOW },
        );
        return {
          code,
          stdout: io.stdout(),
          spec: repo.read(SPEC_REL),
          report: repo.read(`${WS}/decisions/${DATE}-design-verify.md`),
        };
      } finally {
        repo.cleanup();
      }
    };
    const baseline = trace(null);
    const seeded = trace(
      [
        "## Q-9: a blocking entry from another era",
        "",
        "- **Kind:** gate-concern",
        "- **Severity:** blocking",
        "- **Blocks:** gate-evals",
        "- **Status:** open",
        "",
        "---",
        "",
      ].join("\n"),
    );
    expect(seeded.code).toBe(baseline.code);
    expect(seeded.stdout).toBe(baseline.stdout);
    expect(seeded.spec).toBe(baseline.spec);
    expect(seeded.report).toBe(baseline.report);
  });
});
