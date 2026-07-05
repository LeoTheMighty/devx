// v2 refit of the pln105 discipline (v2e102): the v1 Phase 6.5 party-mode /
// focus-group mode predicate is superseded by the engine's thoroughness-
// gated critique step + the top-level LOCKDOWN pause rule. What this file
// pins now: (a) mode is read once and LOCKDOWN pauses planning; (b) the
// critique step's gating is structural (config keys, not vibes); (c) the
// closed LEARN.md mode-gate-ambiguity pattern stays closed — the gating
// predicate lives in exactly one place (the Plan stage's critique step),
// not paraphrased per-stage. Lineage: pln105 → v2e102.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skillPath = join(process.cwd(), ".claude/commands/devx-plan.md");
const body = readFileSync(skillPath, "utf-8");

function section(heading: RegExp, label: string): string {
  const m = heading.exec(body);
  if (m === null) throw new Error(`could not locate ${label} in devx-plan.md`);
  const rest = body.slice(m.index + 1);
  const end = /\n## /.exec(rest);
  return body.slice(m.index, end === null ? body.length : m.index + 1 + end.index);
}

const planStage = section(/^## Stage: Plan\b/m, "## Stage: Plan");

describe("/devx-plan mode gate (pln105 lineage, v2 shape)", () => {
  it("mode + thoroughness are read once from devx.config.yaml", () => {
    expect(body).toMatch(/Mode \+ thoroughness.*come from `devx\.config\.yaml` \(read once\)/s);
  });

  it("LOCKDOWN pauses planning and requires asking first", () => {
    expect(body).toMatch(/LOCKDOWN pauses planning — ask first/);
  });

  it("critique gating is structural: config keys, in the Plan stage only", () => {
    expect(planStage).toContain("engine.critique.min_surfaces");
    expect(planStage).toContain("engine.critique.lenses");
    // The predicate must not be paraphrased in other stages (the closed
    // LEARN.md mode-gate-ambiguity pattern): min_surfaces appears exactly
    // once in the whole body.
    expect(body.split("engine.critique.min_surfaces").length - 1).toBe(1);
  });

  it("critique is thoroughness-gated with the send-it skip documented", () => {
    expect(planStage).toMatch(/thoroughness-gated.*skip at\s+send-it/s);
  });

  it("lens findings are grounded: file claims grep-verified or dropped", () => {
    expect(planStage).toMatch(/every lens claim citing a file must be grep-verified or dropped/);
  });

  it("critique pass is recorded via the refined marker + decisions entry", () => {
    expect(planStage).toMatch(/<!-- refined: critique <date> \(lenses: …\) -->/);
    expect(planStage).toMatch(/decisions\/ entry/);
  });
});
