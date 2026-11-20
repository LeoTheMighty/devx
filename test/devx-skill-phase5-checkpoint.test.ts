// Phase 5 writes the phase checkpoint (A11/B15).
//
// `_devx/templates/engine/checkpoint.md` shipped with v2s101 and nothing wrote
// it for four months: `grep checkpoints/ skills/` was zero hits. The template
// is not the contract — the instruction to USE it is, and un-pinned prose
// drifts (dvx101, mrg102, dvx106, mss104, bqa103 all exist for this reason).
//
// Pins, each one a property that would hollow out the record if it went:
//   • The write lives in Phase 5, where the gates just ran and the exit codes
//     are real — not Phase 6, where they would be filled in from memory.
//   • The command appears verbatim, so the step is mechanical rather than a
//     template fill a reader can interpret.
//   • The verdict is the PHASE's, not the suite's. A checkpoint that reads
//     "PASS" because `npm test` was green says nothing about the phase.
//   • An unobserved exit code is `null`, never `0` — the one substitution that
//     turns an un-run phase into a green record.
//   • `## Drift noted` carries forward. It is the only section a human types,
//     and a re-run that dropped it would destroy the record that the plan
//     itself needs changing.
//   • Phase 6 stages the file with the story, so it lands in the item's diff
//     instead of becoming an orphan.

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

describe("devx skill — Phase 5 writes the phase checkpoint", () => {
  it("the write is in Phase 5, where the exit codes were just observed", () => {
    const skill = loadSkill();
    expect(phaseBody(skill, 5)).toMatch(/devx checkpoint/);
    // Phase 6 may stage it; it must not be where the write lives.
    expect(phaseBody(skill, 6)).not.toMatch(/devx checkpoint </);
  });

  it("names the command verbatim, so the step is mechanical", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toContain("devx checkpoint <hash> --verdict");
    expect(body).toContain("--reason");
    // The three cross-cutting checks the template's own section asks for.
    for (const flag of ["--lint", "--types", "--suite"]) {
      expect(body, `Phase 5 must pass ${flag}`).toContain(flag);
    }
  });

  it("scopes it to workstream stories and says a standalone one skips it", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/workstream stories only/i);
    expect(body).toMatch(/`phase:`/);
    // Explicit-zero, the same shape Phase 4's status-log discipline requires:
    // omission and "not applicable" must not look identical.
    expect(body).toMatch(/standalone story skips it and says so/i);
  });

  it("states that the verdict is the PHASE's, not the suite's", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/this PHASE'?s, not the suite'?s/);
    expect(body).toMatch(/every expectation the plan verifies here/i);
  });

  it("pins the null-not-zero rule for an unobserved exit code", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toMatch(/exit code you did not see is `null`, never `0`/);
  });

  it("names the --runs shape and what omitting it means", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toContain("{eId, type, command, exitCode, detail}");
    // The seeded table is a worklist — stating that is what stops a reader
    // treating a seeded checkpoint as evidence.
    expect(body).toMatch(/a worklist, not evidence/);
  });

  it("pins that `## Drift noted` carries forward across a re-run", () => {
    const body = phaseBody(loadSkill(), 5);
    expect(body).toContain("## Drift noted");
    expect(body).toMatch(/replaces every section but/);
    expect(body).toMatch(/later phases must absorb/);
  });

  it("Phase 6 stages the checkpoint with the story", () => {
    const body = phaseBody(loadSkill(), 6);
    expect(body).toContain("checkpoints/phase-<n>.md");
  });

  it("the shipped mirror carries the same instruction", () => {
    // pin101 already asserts byte-identity; this fails with a message about
    // the CHECKPOINT step rather than about the mirror, which is what a reader
    // of this file needs.
    const mirror = readFileSync(MIRROR_PATH, "utf8");
    expect(phaseBody(mirror, 5)).toContain("devx checkpoint <hash> --verdict");
  });
});
