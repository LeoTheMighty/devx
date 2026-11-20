// v2e102 discipline pins (dvx103/dvx107 pattern): the /devx-plan skill body
// is prose the harness can't type-check, so this test pins its load-bearing
// structure — the four stage sections, the verbatim CLI invocations each
// stage delegates to, and the BMAD-free guarantee — against silent drift.
// If an edit legitimately changes one of these, update the pin in the same
// PR and say why in the PR body.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

const SKILL_PATH = join(REAL_REPO_ROOT, ".claude", "commands", "devx-plan.md");
const body = readFileSync(SKILL_PATH, "utf8");

describe("/devx-plan stage discipline (v2e102)", () => {
  it("carries exactly the four engine stage sections, in pipeline order", () => {
    const stages = [...body.matchAll(/^## Stage: (.+)$/gm)].map((m) => m[1]);
    expect(stages).toEqual(["PRD", "Design", "Plan", "RED"]);
  });

  it.each([
    ["PRD gate", "devx gate prd <hash>"],
    ["coverage gate", "devx gate coverage <hash> --table <path>"],
    ["RED gate", "devx gate evals <hash>"],
    ["workstream scaffold", "devx workstream new <slug>"],
    ["next-command print", "devx next <hash>"],
    ["revision cascade", "devx revise"],
    ["branch derivation", "devx plan-helper derive-branch"],
    ["retro co-emission", "devx plan-helper emit-retro-story"],
    ["emission validation", "devx plan-helper validate-emit"],
  ])("delegates %s to the CLI verbatim (%s)", (_label, invocation) => {
    expect(body).toContain(invocation);
  });

  it("contains zero BMAD references (D-1)", () => {
    expect(body.match(/bmad/i)).toBeNull();
  });

  it("contains zero external-tracker references (D-10)", () => {
    expect(body.match(/jira|confluence|atlassian/i)).toBeNull();
  });

  it("references the E-block template rather than inlining EARS shapes", () => {
    // The EARS sentence template lives in _devx/templates/engine/
    // expectations.md; the skill body must point there, not fork it.
    expect(body).toContain("_devx/templates/engine/");
    expect(body.match(/the system SHALL/)).toBeNull();
  });

  it("pins the load-bearing stage rules", () => {
    for (const rule of [
      "Gates gate passing and execution, not authoring",
      "No phases, no tasks — design is the\napproach, not the sequence",
      "sized to land as a single reviewable PR",
      "every lens claim citing a file must be grep-verified or dropped",
      "fail *for the right reason*",
      "Stage skips are legal and recorded",
    ]) {
      expect(body, `missing rule pin: ${rule}`).toContain(rule);
    }
  });

  it("keeps the critique step thoroughness-gated, not unconditional", () => {
    expect(body).toContain("engine.critique.min_surfaces");
    expect(body).toContain("engine.critique.lenses");
  });

  // harness-s4 — the planning-stage quality rules (gap analysis A3, B6, A6,
  // B8, B9). Each pin is the load-bearing clause, not the surrounding prose.
  const section = (h: string): string => {
    const start = body.indexOf(`## Stage: ${h}`);
    const end = body.indexOf("\n## ", start + 1);
    return body.slice(start, end === -1 ? undefined : end);
  };

  it("PRD critique holds the altitude and ends with a risk register (A3)", () => {
    const prd = section("PRD");
    expect(prd).toMatch(/an item naming only mechanism/);
    expect(prd).toMatch(/`Risk \| Mitigation \|\s+Proven by`/);
    expect(prd).toMatch(/high-severity risk with none is a finding/);
  });

  it("Design captures blind research before drafting, and refreshes on re-entry (B6)", () => {
    const design = section("Design");
    expect(design).toContain("design/research-questions.md");
    expect(design).toContain("design/research.md");
    expect(design).toMatch(/intent kept OUT/);
    expect(design).toMatch(/ONLY that file\s+\(no PRD\)/);
    expect(design).toMatch(/Re-entry refreshes, never\s+redoes/);
    // Research comes before the template is filled.
    expect(design.indexOf("research-questions.md")).toBeLessThan(design.indexOf("Fill the template"));
  });

  it("the coverage subagent returns the four hygiene kinds, which never FAIL (A6)", () => {
    const design = section("Design");
    for (const kind of ["`residue`", "`duplication`", "`ungrounded`", "`bare-decision`"]) {
      expect(design).toContain(kind);
    }
    expect(design).toMatch(/hygiene\s+holds CONCERNS at most, never FAIL/);
    expect(design).not.toMatch(/Resolved \+ Unresolved/);
    expect(design).toMatch(/Decision log \(links only\)/);
  });

  it("rule 9 runs the render lint before the gate; rule 8 names the critique form (B8, B9)", () => {
    expect(body).toContain("devx render lint <hash> <stage>");
    expect(body).toMatch(/fix every HARD finding/);
    expect(body).toMatch(/annotated reproduction, one redraw, Gap \/ Content \/\s+Framing findings/);
    expect(body).toMatch(/A critique is regenerated, never amended/);
  });
});
