// E-7 permanent suite (hfi105, workstream harness-fold-in Phase 5; dvx103
// discipline-pin pattern): the lifecycle skill bodies are prose the harness
// can't type-check, so this test pins the working-memory wiring against
// silent drift — (a) all four /devx-plan stage sections plus the /devx
// execute arm carry the `devx todo sync` step (5/5), (b) the
// friction-observed learn nudge is defined in exactly one place (the
// `<!-- nudge-canonical -->` marker in devx-learn.md) and referenced — not
// restated — by both lifecycle bodies, and (c) the S-1 prose-budget canary
// still holds after the added prose. If an edit legitimately changes one of
// these, update the pin in the same PR and say why in the PR body.
//
// Acceptance twin: _devx/workstreams/harness-fold-in/evals/E-7_skill-todo-discipline.ts
// Spec: dev/dev-hfi105-2026-07-24T10:41-lifecycle-skill-wiring.md

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { engineConfigFrom } from "../src/lib/engine/config.js";
import { loadMerged } from "../src/lib/config-io.js";
import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

const commandsDir = join(REAL_REPO_ROOT, ".claude", "commands");
const planBody = readFileSync(join(commandsDir, "devx-plan.md"), "utf8");
const devxBody = readFileSync(join(commandsDir, "devx.md"), "utf8");
const learnBody = readFileSync(join(commandsDir, "devx-learn.md"), "utf8");

/**
 * The body of one `## `-delimited section (empty string when absent).
 * Anchored to a full header line so a prose mention or a longer header
 * (e.g. `## Stage: Planning`) can't bind (Phase 4 review, Edge Case
 * Hunter #2).
 */
function sectionOf(body: string, header: string): string {
  const start = body.indexOf(`\n${header}\n`);
  if (start === -1) return "";
  const rest = body.slice(start + header.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("skill todo discipline (E-7) — todo steps in 5/5 lifecycle sections", () => {
  it.each(["## Stage: PRD", "## Stage: Design", "## Stage: Plan", "## Stage: RED"])(
    "devx-plan.md '%s' carries the `devx todo sync` step",
    (header) => {
      const section = sectionOf(planBody, header);
      expect(section, `${header} section not found`).not.toBe("");
      expect(
        section,
        `${header} lost its todo step — run \`devx todo sync\` must appear in-section (T5.1)`,
      ).toContain("devx todo sync");
    },
  );

  it("devx.md execute arm (## Execution Loop section) carries the `devx todo sync` step", () => {
    // Bounded at the section end — a stray mention in a later arm
    // (Loop / Retro / Address) must not mask deletion of the Phase 2 step
    // (Phase 4 review, Edge Case Hunter #1). Stricter than the E-7 eval's
    // slice-to-EOF; the eval is the frozen acceptance twin.
    const section = sectionOf(devxBody, "## Execution Loop");
    expect(section, "devx.md '## Execution Loop' section not found").not.toBe("");
    expect(section, "execute arm lost its todo step (T5.2)").toContain("devx todo sync");
  });

  it("RED stage emits the per-spec phase pointer line shape", () => {
    expect(sectionOf(planBody, "## Stage: RED")).toContain(
      "- [ ] Phase <n>: <title> → <dev-hash>",
    );
  });
});

describe("skill todo discipline (E-7) — nudge single-sourcing", () => {
  const marker = "<!-- nudge-canonical -->";
  const countIn = (body: string) => body.split(marker).length - 1;

  it("devx-learn.md defines the nudge canonical exactly once", () => {
    expect(countIn(learnBody)).toBe(1);
  });

  it("the marker appears exactly once across all three skill bodies (referenced, not restated)", () => {
    expect(countIn(planBody) + countIn(devxBody) + countIn(learnBody)).toBe(1);
  });

  it.each([
    ["devx-plan.md", planBody],
    ["devx.md", devxBody],
  ])("%s references the nudge by marker name and file", (_name, body) => {
    // Stronger than the eval's /nudge/i: the reference must name the
    // marker and point at the canonical file (Phase 4 review, Blind
    // Hunter #5). The backticked name doesn't collide with the
    // marker-count pin above, which splits on the full HTML comment.
    expect(body).toContain("`nudge-canonical`");
    expect(body).toContain("devx-learn.md");
  });

  it("neither lifecycle body restates the canonical sentence (referenced, not restated)", () => {
    // The canonical sentence is the paragraph immediately after the
    // marker; a verbatim copy elsewhere would silently drift when the
    // canonical is edited (Phase 4 review, Blind Hunter #1).
    const paragraph = (learnBody.split(marker)[1] ?? "")
      .trim()
      .split(/\n\n/)[0]
      .replace(/\s+/g, " ")
      .trim();
    expect(paragraph.length, "canonical sentence not found after the marker").toBeGreaterThan(20);
    for (const [name, body] of [
      ["devx-plan.md", planBody],
      ["devx.md", devxBody],
    ] as const) {
      expect(
        body.replace(/\s+/g, " "),
        `${name} restates the canonical nudge sentence`,
      ).not.toContain(paragraph);
    }
  });
});

describe("skill todo discipline (E-7) — S-1 prose-budget canary", () => {
  // Mirrors test/engine-prose-budget.test.ts's gated set (engine templates +
  // devx-plan.md ≤ engine.prose_budget_kb; devx.md sits under that test's
  // separate 2× drift tripwire per INTERVIEW Q#9) so a fat todo/nudge edit
  // fails here with the E-7 label, not just in the generic canary.
  it("gated set still fits inside engine.prose_budget_kb after the todo/nudge prose", () => {
    const templatesDir = join(REAL_REPO_ROOT, "_devx", "templates", "engine");
    let total = 0;
    for (const name of readdirSync(templatesDir).sort()) {
      if (name.endsWith(".md")) total += statSync(join(templatesDir, name)).size;
    }
    total += statSync(join(commandsDir, "devx-plan.md")).size;

    let merged: unknown = null;
    try {
      merged = loadMerged({ projectPath: join(REAL_REPO_ROOT, "devx.config.yaml") });
    } catch {
      merged = null;
    }
    const budget = engineConfigFrom(merged).proseBudgetKb * 1024;
    expect(total).toBeLessThanOrEqual(budget);
  });
});
