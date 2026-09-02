// engine/artifacts — the central artifact-path resolver. Pins the
// workstream-relative display constants, the abs joiners, and the
// evals/ authored-entry classification that routes `devx next`
// rows 10↔11.

import { describe, expect, it } from "vitest";
import { join } from "node:path";

import {
  type ResolvedBase,
  CHECKPOINTS_DIR_REL,
  DECISIONS_DIR_REL,
  DESIGN_REL,
  EVALS_DIR_REL,
  EXPECTATIONS_REL,
  PLAN_REL,
  PRD_REL,
  RED_REPORT_REL,
  RESULTS_REL,
  SCAFFOLD_SUBDIRS,
  SCAFFOLD_SUBDIR_KINDS,
  TODO_REL,
  artifactAbs,
  artifactRel,
  checkpointsDirAbs,
  decisionsDirAbs,
  designAbs,
  evalsDirAbs,
  expectationsAbs,
  DEFAULT_DOCS_LAYOUT,
  docsLayoutFrom,
  isAuthoredEvalEntry,
  planAbs,
  prdAbs,
  redReportAbs,
  resultsAbs,
  todoAbs,
} from "../src/lib/engine/artifacts.js";
import { PROJECT_LEVEL_WORKSTREAM_REL } from "../src/lib/engine/workstream.js";

const REPO = join("/tmp", "repo");
const WS_REL = "_devx/workstreams/slug";
const WS = join(REPO, "_devx", "workstreams", "slug");

/** The resolved base for a folder-layout workstream — what `resolveWorkstream`
 *  returns, which is why every consumer passes its `ws` straight through. */
const wsBase: ResolvedBase = {
  repoRoot: REPO,
  workstreamRel: WS_REL,
  layout: "workstream",
};
/** The same repo read as a flat one: the doc set IS the root. */
const flatBase: ResolvedBase = {
  repoRoot: REPO,
  workstreamRel: PROJECT_LEVEL_WORKSTREAM_REL,
  layout: "project-level",
};

describe("artifact path resolvers", () => {
  it("joins workstream-relative paths onto the workstream dir", () => {
    expect(prdAbs(wsBase)).toBe(artifactAbs(WS, PRD_REL));
    expect(designAbs(wsBase)).toBe(artifactAbs(WS, DESIGN_REL));
    expect(planAbs(wsBase)).toBe(artifactAbs(WS, PLAN_REL));
    expect(expectationsAbs(wsBase)).toBe(artifactAbs(WS, EXPECTATIONS_REL));
    expect(todoAbs(wsBase)).toBe(artifactAbs(WS, TODO_REL));
    expect(evalsDirAbs(wsBase)).toBe(artifactAbs(WS, EVALS_DIR_REL));
  });

  it("resolves the same ten helpers to the repo root under project-level", () => {
    // dlr104: the helpers used to take a bare `wsAbs` and were therefore
    // layout-BLIND — under this layout every one of them pointed into a
    // `_devx/workstreams/<slug>` directory the repo does not have, which is
    // why `devx next` read every artifact as missing and wedged on row 4.
    expect(prdAbs(flatBase)).toBe(join(REPO, "prd.md"));
    expect(designAbs(flatBase)).toBe(join(REPO, "design.md"));
    expect(planAbs(flatBase)).toBe(join(REPO, "plan.md"));
    // Layout-identical rows still land at the base, wherever the base is.
    expect(expectationsAbs(flatBase)).toBe(join(REPO, EXPECTATIONS_REL));
    expect(todoAbs(flatBase)).toBe(join(REPO, TODO_REL));
    expect(evalsDirAbs(flatBase)).toBe(join(REPO, EVALS_DIR_REL));
    expect(resultsAbs(flatBase)).toBe(join(REPO, RESULTS_REL));
    expect(decisionsDirAbs(flatBase)).toBe(join(REPO, DECISIONS_DIR_REL));
    expect(checkpointsDirAbs(flatBase)).toBe(join(REPO, CHECKPOINTS_DIR_REL));
    expect(redReportAbs(flatBase)).toBe(
      join(REPO, ...RED_REPORT_REL.split("/")),
    );
  });

  it("splits multi-segment rel paths on / so Windows joins stay correct", () => {
    expect(redReportAbs(wsBase)).toBe(join(WS, ...RED_REPORT_REL.split("/")));
  });

  it("keeps the RED report inside the evals dir", () => {
    expect(RED_REPORT_REL.startsWith(`${EVALS_DIR_REL}/`)).toBe(true);
  });

  it("scaffold subdirs include decisions/checkpoints/evals", () => {
    expect(SCAFFOLD_SUBDIRS).toContain(DECISIONS_DIR_REL);
    expect(SCAFFOLD_SUBDIRS).toContain(EVALS_DIR_REL);
    expect(SCAFFOLD_SUBDIRS).toContain("checkpoints");
  });

  it("SCAFFOLD_SUBDIR_KINDS names exactly the SCAFFOLD_SUBDIRS set", () => {
    // Two spellings of one list is how the flat layout ends up scaffolding
    // two of the three. Bound here rather than trusted.
    expect(
      SCAFFOLD_SUBDIR_KINDS.map((k) => artifactRel("workstream", k)).sort(),
    ).toEqual([...SCAFFOLD_SUBDIRS].sort());
  });

  it("artifactRel gives the doc-set-relative NAME each layout uses", () => {
    // The display half: `engine/next.ts`'s row reasons print these, and they
    // have a layout but no base.
    expect(artifactRel("workstream", { kind: "agent", stage: "prd" })).toBe(PRD_REL);
    expect(artifactRel("project-level", { kind: "agent", stage: "prd" })).toBe("prd.md");
    // Layout-identical rows read the same in both, and that is the point:
    // only the rows that MOVE branch.
    for (const layout of ["workstream", "project-level"] as const) {
      expect(artifactRel(layout, { kind: "expectations" })).toBe(EXPECTATIONS_REL);
      expect(artifactRel(layout, { kind: "todo" })).toBe(TODO_REL);
      expect(artifactRel(layout, { kind: "red-report" })).toBe(RED_REPORT_REL);
    }
  });
});

describe("isAuthoredEvalEntry", () => {
  it("counts E-* runnables and fixtures as authored", () => {
    expect(isAuthoredEvalEntry("E-1_check-drift.ts")).toBe(true);
    expect(isAuthoredEvalEntry("E-8_degenerate-case.md")).toBe(true);
    expect(isAuthoredEvalEntry("_fixture.ts")).toBe(true);
  });

  it("excludes the gate's own report", () => {
    expect(isAuthoredEvalEntry("RED-report.md")).toBe(false);
  });

  it("excludes human-facing companion docs (folder layout)", () => {
    expect(isAuthoredEvalEntry("human.md")).toBe(false);
    expect(isAuthoredEvalEntry("outline.md")).toBe(false);
    expect(isAuthoredEvalEntry("outline-critique.md")).toBe(false);
  });

  it("excludes dotfiles", () => {
    expect(isAuthoredEvalEntry(".DS_Store")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// docsLayoutFrom — the layout is CONFIG (engine.docs_layout), not a preference
// ---------------------------------------------------------------------------

describe("docsLayoutFrom", () => {
  it("reads engine.docs_layout", () => {
    expect(docsLayoutFrom({ engine: { docs_layout: "project-level" } })).toBe(
      "project-level",
    );
    expect(docsLayoutFrom({ engine: { docs_layout: "workstream" } })).toBe("workstream");
    expect(docsLayoutFrom({ engine: { docs_layout: "  project-level  " } })).toBe(
      "project-level",
    );
  });

  it("falls back to the legacy bank key so an upgrade never flips a layout", () => {
    expect(docsLayoutFrom({ personalization: { "docs.layout": "project-level" } })).toBe(
      "project-level",
    );
  });

  it("prefers engine.docs_layout when both are present", () => {
    expect(
      docsLayoutFrom({
        engine: { docs_layout: "workstream" },
        personalization: { "docs.layout": "project-level" },
      }),
    ).toBe("workstream");
  });

  it("defaults on absent, malformed, or out-of-enum input", () => {
    for (const merged of [
      undefined,
      null,
      {},
      "nonsense",
      { engine: null },
      { engine: "flat" },
      { engine: { docs_layout: "flat" } },
      { engine: { docs_layout: 7 } },
      { engine: {}, personalization: { "docs.layout": "sideways" } },
    ]) {
      expect(docsLayoutFrom(merged), JSON.stringify(merged ?? null)).toBe(
        DEFAULT_DOCS_LAYOUT,
      );
    }
  });
});
