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
  // v2e102: /devx prd, /devx design, /devx plan, /devx red sections.
];

const ENGINE_TEMPLATES_DIR = join(REAL_REPO_ROOT, "_devx", "templates", "engine");

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

    for (const name of readdirSync(ENGINE_TEMPLATES_DIR).sort()) {
      if (!name.endsWith(".md")) continue;
      const abs = join(ENGINE_TEMPLATES_DIR, name);
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

  it("counts at least the nine v2s101 templates (canary isn't scanning an empty dir)", () => {
    const found = readdirSync(ENGINE_TEMPLATES_DIR).filter((n) => n.endsWith(".md"));
    expect(found.length).toBeGreaterThanOrEqual(9);
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
