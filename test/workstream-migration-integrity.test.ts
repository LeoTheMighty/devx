// Folder-per-artifact migration integrity: every REAL workstream in this
// repo resolves through the central artifact resolver, no flat-era file
// survives, and the resolver's constants agree with what is actually on
// disk. Read-only against the real repo → parallel pass.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DESIGN_REL,
  EXPECTATIONS_REL,
  PLAN_REL,
  PRD_REL,
  artifactAbs,
} from "../src/lib/engine/artifacts.js";
import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

const WS_ROOT = join(REAL_REPO_ROOT, "_devx", "workstreams");

const slugs = readdirSync(WS_ROOT).filter((n) =>
  statSync(join(WS_ROOT, n)).isDirectory(),
);

describe("workstream migration integrity (folder-per-artifact)", () => {
  it("found the real workstreams (scan isn't running on an empty dir)", () => {
    expect(slugs.length).toBeGreaterThanOrEqual(9);
  });

  for (const slug of slugs) {
    const wsAbs = join(WS_ROOT, slug);

    it(`${slug}: no flat-era prd.md/design.md/plan.md survives`, () => {
      for (const flat of ["prd.md", "design.md", "plan.md"]) {
        expect(
          existsSync(join(wsAbs, flat)),
          `${slug}/${flat} is flat-era — the engine reads ${flat.replace(".md", "/agent.md")}`,
        ).toBe(false);
      }
    });

    it(`${slug}: every present stage folder carries its agent.md`, () => {
      for (const [stage, rel] of [
        ["prd", PRD_REL],
        ["design", DESIGN_REL],
        ["plan", PLAN_REL],
      ] as const) {
        const stageDir = join(wsAbs, stage);
        if (!existsSync(stageDir)) continue; // stage not reached — legal
        expect(
          existsSync(artifactAbs(wsAbs, rel)),
          `${slug}/${stage}/ exists without agent.md`,
        ).toBe(true);
      }
    });

    it(`${slug}: expectations.md stays at the workstream root`, () => {
      expect(existsSync(artifactAbs(wsAbs, EXPECTATIONS_REL))).toBe(true);
    });
  }
});
