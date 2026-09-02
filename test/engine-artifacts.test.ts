// engine/artifacts — the central artifact-path resolver. Pins the
// workstream-relative display constants, the abs joiners, and the
// evals/ authored-entry classification that routes `devx next`
// rows 10↔11.

import { describe, expect, it } from "vitest";
import { join } from "node:path";

import {
  type ArtifactKind,
  type ResolvedBase,
  DECISIONS_DIR_REL,
  EVALS_DIR_REL,
  SCAFFOLD_SUBDIRS,
  SCAFFOLD_SUBDIR_KINDS,
  artifactRel,
  decisionsDirAbs,
  evalsDirAbs,
  DEFAULT_DOCS_LAYOUT,
  docsLayoutFrom,
  isAuthoredEvalEntry,
  planAbs,
  stageSubject,
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

/** Every kind the §15 table names, so the two layout sweeps below cannot
 *  quietly stop covering one. `artifactRel` is the display half; the
 *  assertions state the SPELLING rather than re-deriving it, which is the
 *  only way a resolver test can fail when the resolver is wrong. */
const EVERY_KIND: ReadonlyArray<[ArtifactKind, string, string]> = [
  [{ kind: "agent", stage: "prd" }, "prd/agent.md", "prd.md"],
  [{ kind: "agent", stage: "design" }, "design/agent.md", "design.md"],
  [{ kind: "agent", stage: "plan" }, "plan/agent.md", "plan.md"],
  [{ kind: "expectations" }, "expectations.md", "expectations.md"],
  [{ kind: "todo" }, "todo.md", "todo.md"],
  [{ kind: "results" }, "RESULTS.md", "RESULTS.md"],
  [{ kind: "evals-dir" }, "evals", "evals"],
  [{ kind: "decisions-dir" }, "decisions", "decisions"],
  [{ kind: "checkpoints-dir" }, "checkpoints", "checkpoints"],
  [{ kind: "red-report" }, "evals/RED-report.md", "evals/RED-report.md"],
];

describe("artifact path resolvers", () => {
  it("resolves every kind under the workstream layout", () => {
    for (const [kind, wsRel] of EVERY_KIND) {
      const subject = stageSubject("workstream", wsBase, kind);
      expect(artifactRel("workstream", kind), JSON.stringify(kind)).toBe(wsRel);
      // Split on `/` so a multi-segment rel joins with the platform
      // separator — a Windows join of `evals/RED-report.md` is two segments.
      expect(subject.abs, JSON.stringify(kind)).toBe(join(WS, ...wsRel.split("/")));
    }
  });

  it("resolves every kind to the repo root under project-level", () => {
    // dlr104: the helpers used to take a bare `wsAbs` and were therefore
    // layout-BLIND — under this layout every one of them pointed into a
    // `_devx/workstreams/<slug>` directory the repo does not have, which is
    // why `devx next` read every artifact as missing and wedged on row 4.
    for (const [kind, , flatRel] of EVERY_KIND) {
      expect(artifactRel("project-level", kind), JSON.stringify(kind)).toBe(flatRel);
      expect(stageSubject("project-level", flatBase, kind).abs, JSON.stringify(kind)).toBe(
        join(REPO, ...flatRel.split("/")),
      );
    }
  });

  it("the four surviving *Abs helpers agree with the map", () => {
    // dlr105 deleted the six that never acquired a caller (E-2: an exported
    // resolver nobody calls is a bypass waiting for its first one). These
    // four are sugar over `stageSubject(...).abs` and must stay that.
    for (const base of [wsBase, flatBase]) {
      expect(planAbs(base)).toBe(stageSubject(base.layout, base, { kind: "agent", stage: "plan" }).abs);
      expect(todoAbs(base)).toBe(stageSubject(base.layout, base, { kind: "todo" }).abs);
      expect(evalsDirAbs(base)).toBe(stageSubject(base.layout, base, { kind: "evals-dir" }).abs);
      expect(decisionsDirAbs(base)).toBe(
        stageSubject(base.layout, base, { kind: "decisions-dir" }).abs,
      );
    }
  });

  it("keeps the RED report inside the evals dir", () => {
    for (const layout of ["workstream", "project-level"] as const) {
      expect(
        artifactRel(layout, { kind: "red-report" }).startsWith(
          `${artifactRel(layout, { kind: "evals-dir" })}/`,
        ),
      ).toBe(true);
    }
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

  it("only the rows that MOVE differ between layouts", () => {
    // The corollary of the two sweeps above, stated as its own claim: a
    // layout-identical row that started branching would be a silent
    // relocation of a file nothing agreed to move.
    const moves = EVERY_KIND.filter(([, ws, flat]) => ws !== flat).map(([, ws]) => ws);
    expect(moves.sort()).toEqual(["design/agent.md", "plan/agent.md", "prd/agent.md"]);
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
