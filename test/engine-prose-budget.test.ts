// Prose-budget canary (v2e101 AC #8; S-1 in v2/02-engine.md §6): the v2
// engine's whole point is killing BMAD's 550KB-per-feature prose load. This
// test sums the bytes of every engine prose surface that ships to agents —
// today the templates in _devx/templates/engine/; v2e102 adds the stage
// skill sections to STAGE_SKILL_SECTIONS below — and fails CI when the
// total regresses past `engine.prose_budget_kb` (default 60KB).
//
// If this test fails you have two honest options: cut prose, or raise the
// budget in devx.config.yaml → engine.prose_budget_kb with a PR that says
// why. Do not add exclusions here.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ENGINE_DEFAULTS, engineConfigFrom } from "../src/lib/engine/config.js";
import { loadMerged } from "../src/lib/config-io.js";
import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

// Repo-relative paths of the stage skill sections, added as v2e102 lands
// them (e.g. ".claude/skills/devx-prd/SKILL.md"). Listed explicitly — not
// globbed — so a new prose surface is a conscious, reviewed addition to
// the budget.
const STAGE_SKILL_SECTIONS: string[] = [
  // v2e102: the four engine stages live in the /devx-plan skill body.
  ".claude/commands/devx-plan.md",
];

const ENGINE_TEMPLATES_DIR = join(REAL_REPO_ROOT, "_devx", "templates", "engine");

/** Every .md under the templates dir, /-joined relative names, recursive —
 *  the folder-per-artifact layout nests stage templates one level deep, and
 *  a flat readdir would silently under-count the budget. */
function listTemplateMdFiles(): string[] {
  const out: string[] = [];
  const walk = (prefix: string): void => {
    const dir = join(ENGINE_TEMPLATES_DIR, ...prefix.split("/").filter(Boolean));
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".md")) out.push(rel);
    }
  };
  walk("");
  return out.sort();
}

function budgetBytes(): number {
  // engine.prose_budget_kb read defensively from the real project config
  // (the `engine:` block doesn't exist until v2x101 — defaults apply).
  let merged: unknown = null;
  try {
    merged = loadMerged({
      projectPath: join(REAL_REPO_ROOT, "devx.config.yaml"),
    });
  } catch {
    merged = null;
  }
  return engineConfigFrom(merged).proseBudgetKb * 1024;
}

describe("engine prose-budget canary (S-1)", () => {
  it("templates + stage skill sections fit inside engine.prose_budget_kb", () => {
    const surfaces: Array<{ path: string; bytes: number }> = [];

    for (const name of listTemplateMdFiles()) {
      const abs = join(ENGINE_TEMPLATES_DIR, ...name.split("/"));
      surfaces.push({
        path: `_devx/templates/engine/${name}`,
        bytes: statSync(abs).size,
      });
    }
    for (const rel of STAGE_SKILL_SECTIONS) {
      const abs = join(REAL_REPO_ROOT, ...rel.split("/"));
      surfaces.push({ path: rel, bytes: Buffer.byteLength(readFileSync(abs)) });
    }

    const total = surfaces.reduce((sum, s) => sum + s.bytes, 0);
    const budget = budgetBytes();

    expect(
      total,
      [
        `engine prose is ${total} bytes — over the ${budget}-byte budget (engine.prose_budget_kb).`,
        "Per-surface breakdown:",
        ...surfaces.map((s) => `  ${s.bytes}\t${s.path}`),
        "Cut prose or raise the budget in devx.config.yaml with an explanation.",
      ].join("\n"),
    ).toBeLessThanOrEqual(budget);
  });

  it("counts at least the nine v2s101 templates plus the nested stage files (canary isn't scanning an empty dir)", () => {
    const found = listTemplateMdFiles();
    // 8 flat survivors + 3 stage agent.md + 3×3 stage companions +
    // 3 evals companions + OUTLINE.md = 24 shipped today; ≥21 leaves
    // headroom for deliberate removals. The ≥9 floor predates the layout.
    expect(found.length).toBeGreaterThanOrEqual(21);
    // The nested walk actually descends — a flat readdir would miss these.
    expect(found).toContain("prd/agent.md");
    expect(found).toContain("evals/outline.md");
  });

  // S-1 full-run measurement (v2o101, migration retro): the prose actually
  // loadable across one full PRD→merge run is the planning surface above
  // PLUS the /devx dispatcher body (.claude/commands/devx.md), which
  // carries the execute arm — a surface the BMAD era also paid
  // (~48KB/story dev-story + code-review) inside its ~550KB total.
  //
  // Measured at v2o101 (2026-07-05): planning surface 24,426 B (~23.9KB);
  // full run incl. devx.md 65,767 B (~64.2KB). Re-measured at the
  // outline-folders restructure (2026-08-23): planning surface ~37.5KB
  // (nested stage templates + the outline/human rules in devx-plan.md —
  // still well inside the 60KB budget, no raise needed); full run incl.
  // devx.md ~96.6KB — a real jump this change knowingly paid for the
  // outline discipline prose, still under the 2× tripwire. INTERVIEW Q#9
  // (the full-surface budget question) remains the open product call:
  // trim devx.md (six arms: execute/debug/address/retro/loop/dispatch) or
  // raise the budget — not a test's decision. This assertion is a drift
  // tripwire only — 2× budget — so unnoticed growth still fails CI
  // without this test quietly re-deciding the budget question.
  it("S-1 full-run surface (+ devx.md execute arm) stays under the 2x drift tripwire", () => {
    let total = 0;
    for (const name of listTemplateMdFiles()) {
      total += statSync(join(ENGINE_TEMPLATES_DIR, ...name.split("/"))).size;
    }
    for (const rel of [...STAGE_SKILL_SECTIONS, ".claude/commands/devx.md"]) {
      total += Buffer.byteLength(
        readFileSync(join(REAL_REPO_ROOT, ...rel.split("/"))),
      );
    }
    expect(
      total,
      `S-1 full-run prose is ${total} bytes — past the 2x-budget drift tripwire; re-measure and re-record the retro verdict`,
    ).toBeLessThanOrEqual(budgetBytes() * 2);
  });
});

describe("engineConfigFrom — defensive engine.* reads (AC #12)", () => {
  it("returns the design defaults when engine: is absent (today's config)", () => {
    expect(engineConfigFrom({ mode: "YOLO" })).toEqual(ENGINE_DEFAULTS);
    expect(engineConfigFrom(null)).toEqual(ENGINE_DEFAULTS);
    expect(engineConfigFrom("nonsense")).toEqual(ENGINE_DEFAULTS);
  });

  it("defaults match v2/02-engine.md §7", () => {
    expect(ENGINE_DEFAULTS).toEqual({
      workstreamsRoot: "_devx/workstreams",
      expectationsMin: 3,
      proseBudgetKb: 60,
      // §31 Reading Guide columns — defaults to the plan-stage critique
      // lenses so a repo has one reviewer vocabulary, not two.
      readingGuideRoles: ["pm", "architect", "dev", "qa"],
      // §15 artifact-tree shape, plus where the resolution found it.
      // `default` is what `devx next`'s advisory nag reads.
      docsLayout: "workstream",
      layoutSource: "default",
    });
  });

  it("honors a partial engine: block per-key", () => {
    const cfg = engineConfigFrom({ engine: { prose_budget_kb: 40 } });
    expect(cfg.proseBudgetKb).toBe(40);
    expect(cfg.expectationsMin).toBe(3);
    expect(cfg.workstreamsRoot).toBe("_devx/workstreams");
  });

  it("falls back on malformed values instead of crashing", () => {
    const cfg = engineConfigFrom({
      engine: {
        workstreams_root: 42,
        expectations_min: -1,
        prose_budget_kb: "sixty",
      },
    });
    expect(cfg).toEqual(ENGINE_DEFAULTS);
  });

  it("strips a trailing slash off workstreams_root", () => {
    const cfg = engineConfigFrom({ engine: { workstreams_root: "streams/" } });
    expect(cfg.workstreamsRoot).toBe("streams");
  });

  it("floors a fractional expectations_min", () => {
    expect(engineConfigFrom({ engine: { expectations_min: 4.7 } }).expectationsMin).toBe(4);
  });
});
