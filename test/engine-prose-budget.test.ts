// Prose-budget canary (v2e101 AC #8; S-1 in v2/02-engine.md §6): the v2
// engine's whole point is killing BMAD's 550KB-per-feature prose load. This
// test sums the bytes of every engine prose surface that ships to agents —
// today the templates in _devx/templates/engine/; v2e102 adds the stage
// skill sections to STAGE_SKILL_SECTIONS below — and fails CI when the
// total regresses past `engine.prose_budget_kb` (default 60KB).
//
// If this test fails you have two honest options: cut prose, or raise the
// budget in devx.config.yaml → engine.prose_budget_kb (planning surface) or
// engine.full_run_prose_budget_kb (full run, D-14) with a PR that says why.
// Do not add exclusions here.

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

// The /devx dispatcher plus the arm bodies one full run loads. Until the
// D-14 arm split (INTERVIEW Q#9 option (b): load only the arm a run needs)
// every arm lived inside devx.md and was counted by being there. The Execute
// arm and the Retro arm are both rows of `v2/02-engine.md` §6's "full
// feature end-to-end", so moving them into their own files moves nothing out
// of this budget: they are counted here exactly as they were inside devx.md.
// Listed explicitly, like STAGE_SKILL_SECTIONS, for the same reason.
const FULL_RUN_DISPATCH_SURFACES: string[] = [
  ".claude/commands/devx.md",
  ".claude/commands/devx-execute.md",
  ".claude/commands/devx-retro.md",
];

// Every OTHER skill body under .claude/commands/, with why one full run does
// not load it. This is not an exclusion list — nothing here was ever in a
// budget except the debug, loop and outcome arms, whose prose left devx.md in
// the arm split precisely because no full run loads it. A body in neither
// list fails the classification test below, so a new skill body cannot sit
// uncounted by default: it is counted, or it is named here with the evidence
// that a full run never loads it. Moving prose a full run DOES load into a
// file listed here is the exclusion the header forbids.
const OFF_THE_FULL_RUN: Record<string, string> = {
  "devx-debug.md": "the bug arm: intake + repro, then the Execute arm; a debug run, not a feature run (§6 has no row for it)",
  "devx-loop.md": "starts the `devx loop` CLI; loop workers get the CLI's own iteration prompt (src/lib/loop/iteration.ts), never this body",
  "devx-outcome.md": "post-ship scoring, weeks after the run's last merge (§6 has no row for it)",
  "devx-address.md": "human review input on an open PR: its own invocation, `/devx address <pr>`",
  "devx-revise.md": "the backward path: reopens an artifact that already passed its gate",
  "devx-walk.md": "the health queue's resolver: its own invocation",
  "devx-interview.md": "walks INTERVIEW.md: its own invocation",
  "devx-test.md": "attended exploratory QA: its own invocation",
  "devx-personalize.md": "the preference interview; a full run reaches only its layout-ask block, once per repo, while `engine.docs_layout` is unset (uncounted before the arm split too)",
  "devx-learn.md": "session mining; a full run reaches only its one marked nudge sentence, and only after friction (uncounted before the arm split too)",
};

const COMMANDS_DIR = join(REAL_REPO_ROOT, ".claude", "commands");

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

function repoEngineConfig(): ReturnType<typeof engineConfigFrom> {
  // engine.* read defensively from the real project config (the `engine:`
  // block doesn't exist until v2x101 — defaults apply).
  let merged: unknown = null;
  try {
    merged = loadMerged({
      projectPath: join(REAL_REPO_ROOT, "devx.config.yaml"),
    });
  } catch {
    merged = null;
  }
  return engineConfigFrom(merged);
}

function budgetBytes(): number {
  return repoEngineConfig().proseBudgetKb * 1024;
}

function fullRunBudgetBytes(): number {
  return repoEngineConfig().fullRunProseBudgetKb * 1024;
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

  // S-1 full-run budget (D-14, 5c215e). The prose actually loadable across
  // one full feature run is the planning surface above PLUS the /devx
  // dispatcher and the arm bodies that run loads (FULL_RUN_DISPATCH_SURFACES:
  // Execute and Retro) — a surface the BMAD era also paid (~48KB/story
  // dev-story + code-review, 63KB retro) inside its ~550KB total.
  //
  // History, so the next reader does not re-derive it: measured 65,767 B at
  // v2o101 (2026-07-05), ~96.6KB at the outline-folders restructure
  // (2026-08-23), 122,852 B on 2026-09-21. Until D-14 this surface was
  // gated only by a 2× `prose_budget_kb` "drift tripwire", so the multiplier
  // WAS the budget by accident, and raising it would have loosened the
  // planning gate above as well. It now has its own knob and is gated
  // directly: the number that binds is the number that was chosen.
  // 2026-11-20: the budget bound again (130,547 B, 525 free) and D-14's
  // named lever was pulled instead of a raise — devx.md's arms became their
  // own bodies. The debug/loop/outcome arms (no full run loads them) left
  // the sum; 126,488 B after.
  //
  // If this fails: cut prose, or change `engine.full_run_prose_budget_kb`
  // in a PR that says why (D-14 records the reasoning for the current
  // value). The arm split is spent: what is left counted is what a full run
  // loads.
  it("S-1 full-run surface (planning + dispatcher + its full-run arms) fits engine.full_run_prose_budget_kb", () => {
    const surfaces: Array<{ path: string; bytes: number }> = [];
    for (const name of listTemplateMdFiles()) {
      surfaces.push({
        path: `_devx/templates/engine/${name}`,
        bytes: statSync(join(ENGINE_TEMPLATES_DIR, ...name.split("/"))).size,
      });
    }
    for (const rel of [...STAGE_SKILL_SECTIONS, ...FULL_RUN_DISPATCH_SURFACES]) {
      surfaces.push({
        path: rel,
        bytes: Buffer.byteLength(readFileSync(join(REAL_REPO_ROOT, ...rel.split("/")))),
      });
    }
    const total = surfaces.reduce((sum, s) => sum + s.bytes, 0);
    const budget = fullRunBudgetBytes();
    expect(
      total,
      [
        `S-1 full-run prose is ${total} bytes — over the ${budget}-byte budget (engine.full_run_prose_budget_kb).`,
        "Per-surface breakdown:",
        ...surfaces.map((s) => `  ${s.bytes}\t${s.path}`),
        "Cut prose or change the budget in devx.config.yaml with an explanation (see D-14).",
      ].join("\n"),
    ).toBeLessThanOrEqual(budget);
  });

  // The arm split makes "a separate skill file" the cheapest place to put
  // prose, so the budget is only honest if every skill body is accounted for.
  it("every skill body is counted toward a budget or named as off the full run", () => {
    const counted = new Set(
      [...STAGE_SKILL_SECTIONS, ...FULL_RUN_DISPATCH_SURFACES].map((rel) =>
        rel.replace(".claude/commands/", ""),
      ),
    );
    const bodies = readdirSync(COMMANDS_DIR).filter((n) => n.endsWith(".md")).sort();
    const unclassified = bodies.filter((n) => !counted.has(n) && !(n in OFF_THE_FULL_RUN));
    expect(
      unclassified,
      [
        "skill bodies in neither the counted lists nor OFF_THE_FULL_RUN:",
        ...unclassified.map((n) => `  .claude/commands/${n}`),
        "Count it (STAGE_SKILL_SECTIONS / FULL_RUN_DISPATCH_SURFACES) if any full run",
        "loads it; otherwise name it in OFF_THE_FULL_RUN with why no full run does.",
      ].join("\n"),
    ).toEqual([]);
    // Both sides stay true: no body is both counted and off, and every name
    // in OFF_THE_FULL_RUN is a real file (a stale entry would hide nothing,
    // but would mislead the next reader about what exists).
    expect(Object.keys(OFF_THE_FULL_RUN).filter((n) => counted.has(n))).toEqual([]);
    expect(Object.keys(OFF_THE_FULL_RUN).filter((n) => !bodies.includes(n))).toEqual([]);
    for (const [name, why] of Object.entries(OFF_THE_FULL_RUN)) {
      expect(why.trim().length, `${name} needs a reason`).toBeGreaterThan(20);
    }
  });

  // The two arm bodies counted above must be the ones the dispatcher actually
  // routes a full run to — a rename that left this list pointing at a file
  // Routing no longer names would keep the sum green while measuring nothing.
  it("the dispatcher routes to every full-run arm body it is charged for", () => {
    const dispatcher = readFileSync(join(COMMANDS_DIR, "devx.md"), "utf8");
    for (const rel of FULL_RUN_DISPATCH_SURFACES.filter((r) => !r.endsWith("/devx.md"))) {
      expect(dispatcher, `devx.md never names ${rel}`).toContain(rel.replace(".claude/commands/", ""));
    }
  });

  // The two knobs must stay independent: the whole point of D-14 is that
  // moving one never silently moves the other.
  it("the full-run budget is its own knob, not derived from the planning budget", () => {
    const planningOnly = engineConfigFrom({ engine: { prose_budget_kb: 999 } });
    expect(planningOnly.fullRunProseBudgetKb).toBe(ENGINE_DEFAULTS.fullRunProseBudgetKb);
    const fullOnly = engineConfigFrom({ engine: { full_run_prose_budget_kb: 999 } });
    expect(fullOnly.proseBudgetKb).toBe(ENGINE_DEFAULTS.proseBudgetKb);
    expect(fullOnly.fullRunProseBudgetKb).toBe(999);
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
      // arc101: read by `devx archive`. Until then the key was written into
      // every config and read by nothing.
      archiveRoot: "_devx/archive",
      expectationsMin: 3,
      proseBudgetKb: 60,
      // D-14 (5c215e): the full-run surface's own budget, split from the
      // planning knob so moving one never moves the other.
      fullRunProseBudgetKb: 128,
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
        full_run_prose_budget_kb: 0,
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
