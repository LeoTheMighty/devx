// Phase 5 QA-walkthrough emission discipline (bqa103).
//
// The walkthrough is only worth emitting if it is emitted where the evidence
// is real: Phase 5, with the gates just run and the services still up. The
// PRD's earlier "Phase 6 emits" phrasing is superseded — at commit time the
// stack is already torn down and `machine` items get filled in from memory,
// which is exactly the failure this contract exists to prevent.
//
// Pins:
//   • The emission step lives in Phase 5, not Phase 6 — asserted by slicing
//     the Phase 5 body and looking for it there.
//   • The emitted path and the engine-template path appear VERBATIM (roc101
//     pattern — a paraphrased path is a path the consumer-side eval can't
//     glob). The emitted path is canonical spec form with the walkthrough's
//     OWN fresh hash (`test/test-<new-hash>-<ts>-<slug>.md`); reusing the
//     story's hash is debug-ea4f41 — it makes the story unresolvable by every
//     by-hash CLI, `devx merge-gate` included. Cross-checked repo-wide by
//     test/spec-hash-uniqueness.test.ts.
//   • The walkthrough carries canonical spec frontmatter, so it indexes like
//     every other TEST.md row instead of as a bare markdown file.
//   • Both halves of the item contract survive: machine items are EXECUTED at
//     emission (checked, evidence pasted), human items stay unchecked with an
//     inline "how to verify:" hint. Losing either half produces a walkthrough
//     that reads complete and proves nothing.
//   • A failing machine item routes back to the gate-fix loop rather than
//     being downgraded to `human` — the cheap escape hatch that would hollow
//     out the whole contract.
//   • Phase 6 still stages the file with the story, so the walkthrough lands
//     in the item's own diff instead of becoming an orphan follow-up.
//
// Why a discipline test on a markdown file: same reason as dvx101, mrg102,
// dvx106 and mss104 — the skill body is the program, and un-pinned prose
// drifts. Parse contract mirrored from the consumer eval
// (`e3_walkthrough_emission.sh`) and from test/engine-templates.test.ts,
// which pins the template shape this step points at.
//
// Spec: dev/dev-bqa103-2026-07-27T11:41-upstream-walkthrough-template.md

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..");
const SKILL_PATH = resolve(REPO_ROOT, ".claude/commands/devx.md");
const MIRROR_PATH = resolve(REPO_ROOT, "skills/devx.md");

function loadSkill(): string {
  return readFileSync(SKILL_PATH, "utf8");
}

/** Slice `### Phase N: …` up to the next `### ` / `## ` heading or EOF. */
function phaseBody(skill: string, n: number): string {
  const start = skill.match(new RegExp(`^### Phase ${n}:[^\\n]*\\n`, "m"));
  if (!start) throw new Error(`Phase ${n} heading not found in skill body`);
  const offset = (start.index ?? 0) + start[0].length;
  const rest = skill.slice(offset);
  const next = rest.match(/^(### |## )/m);
  return next ? rest.slice(0, next.index) : rest;
}

describe("devx skill — Phase 5 emits the QA walkthrough (bqa103 AC #2)", () => {
  it("the emission step is in Phase 5, not Phase 6", () => {
    const skill = loadSkill();
    expect(phaseBody(skill, 5)).toMatch(/QA walkthrough/i);
    // Phase 6 may *stage* the file, but it must not be where authoring lives —
    // that's the regression the supersession exists to foreclose.
    expect(phaseBody(skill, 6)).not.toMatch(/Author `?test\/test-</);
  });

  it("names the emitted path and the source template verbatim", () => {
    const body = phaseBody(loadSkill(), 5);
    // The consumer eval globs `test/test-*-qa-walkthrough.md`; the template
    // installs at the engine path. Both are literal contracts, not prose.
    expect(body).toContain("test/test-<new-hash>-<ts>-<slug>.md");
    expect(body).toContain("_devx/templates/engine/qa-walkthrough.md");
    // …and the slug keeps the suffix that glob depends on.
    expect(body).toContain("<story-hash>-qa-walkthrough");
  });

  it("mints a fresh hash for the walkthrough rather than reusing the story's (ea4f41 AC 1)", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/FRESH hash[\s\S]*never reuse the story's/);
    // The reason has to survive too — an instruction whose cost isn't stated
    // is the first one an agent optimizes away under time pressure.
    expect(body).toMatch(/spec resolution failed/);
    // A mechanical minting step, not "pick something random": the collision
    // check is the half that actually holds the invariant.
    expect(body).toMatch(/openssl rand -hex 3/);
  });

  it("requires canonical spec frontmatter on the emitted walkthrough (ea4f41 AC 2)", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/frontmatter/);
    for (const field of ["`type: test`", "`status: ready`", "`from:`"]) {
      expect(body, `frontmatter field ${field} unnamed`).toContain(field);
    }
  });

  it("scopes emission to user-visible surfaces", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/user-visible surface/);
  });

  it("requires machine items to be executed inline with pasted evidence", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/machine/);
    expect(body).toMatch(/Execute every `machine` item inline/);
    // Checked box + real output — the two things that make the item evidence
    // rather than an intention.
    expect(body).toMatch(/paste the real output/i);
    expect(body).toMatch(/check the box `\[x\]`/);
  });

  it("requires human items to stay unchecked with an inline verify hint", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/Leave every `human` item unchecked/);
    // The eval greps human checkbox lines for /verify/i — the hint token is
    // the machine-readable half of this instruction.
    expect(body).toMatch(/how to verify:/);
  });

  it("routes a failing machine item back to the gate-fix loop", () => {
    const body = phaseBody(loadSkill(), 5);
    // Without this, "downgrade it to human" is the path of least resistance
    // and every red check quietly becomes someone else's problem.
    expect(body).toMatch(/If a machine item fails[\s\S]*don't downgrade/);
  });

  it("appends a TEST.md row for the emitted walkthrough", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/TEST\.md/);
  });
});

describe("devx skill — the walkthrough commits with the story (bqa103 AC #2)", () => {
  it("Phase 6 stages the walkthrough as part of the item", () => {
    const body = phaseBody(loadSkill(), 6);
    expect(body).toContain("test/test-<new-hash>-<ts>-<slug>.md");
    expect(body).toMatch(/stage them with it|part of this item/);
  });

  it("Phase 5 says the file commits with the story, not as a follow-up", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/commits \*\*with the story\*\* in Phase 6/);
  });
});

describe("devx skill — the packaged mirror carries the emission step", () => {
  it("skills/devx.md contains the same contract", () => {
    // Byte-identity is asserted by test/skills-sync.test.ts; asserted here
    // independently so a mirror that ships without the step fails by name.
    const mirror = readFileSync(MIRROR_PATH, "utf8");
    expect(mirror).toContain("test/test-<new-hash>-<ts>-<slug>.md");
    expect(mirror).toMatch(/Execute every `machine` item inline/);
    expect(mirror).toMatch(/FRESH hash[\s\S]*never reuse the story's/);
  });
});
