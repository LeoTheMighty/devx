// Folder-per-artifact migration integrity: every REAL workstream in this
// repo resolves through the central artifact resolver, no flat-era file
// survives, and the resolver's constants agree with what is actually on
// disk. Read-only against the real repo → parallel pass.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type ArtifactKind,
  SUBJECT_STAGES,
  stageSubject,
} from "../src/lib/engine/artifacts.js";
import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

const WS_ROOT = join(REAL_REPO_ROOT, "_devx", "workstreams");

const slugs = readdirSync(WS_ROOT).filter((n) =>
  statSync(join(WS_ROOT, n)).isDirectory(),
);

/** This repo runs `engine.docs_layout: workstream`, and every assertion below
 *  is about THAT tree — so the layout is pinned here rather than resolved.
 *
 *  Through the map because the `*_REL` constants this file used to read went
 *  module-private at dlr105: privatizing them is exactly what makes
 *  `artifactAbs(wsAbs, "prd/agent.md")` unwritable, and a test that kept a
 *  private spelling alive would be the first caller of the bypass. The map
 *  answers the same question from the outside. */
const subjectAbs = (slug: string, kind: ArtifactKind): string =>
  stageSubject("workstream", { repoRoot: WS_ROOT, workstreamRel: slug }, kind).abs;

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

    it(`${slug}: a stage folder with agent-side content carries agent.md`, () => {
      // A stage dir holding ONLY human-side companions is legal — the
      // human can `devx outline init` a stage before the agent authors it
      // (artifacts.ts documents exactly this ordering). What must never
      // exist is agent-side stage content without its agent.md.
      const HUMAN_SIDE = new Set(["outline.md", "outline-critique.md", "human.md"]);
      // Driven by SUBJECT_STAGES rather than a hand-kept triple: a fourth
      // authored stage would otherwise arrive unchecked.
      for (const stage of SUBJECT_STAGES) {
        const stageDir = join(wsAbs, stage);
        if (!existsSync(stageDir)) continue; // stage not reached — legal
        const entries = readdirSync(stageDir).filter((n) => !n.startsWith("."));
        const agentSide = entries.filter((n) => !HUMAN_SIDE.has(n));
        if (agentSide.length === 0) continue; // outline-first — legal
        expect(
          existsSync(subjectAbs(slug, { kind: "agent", stage })),
          `${slug}/${stage}/ holds agent-side files (${agentSide.join(", ")}) without agent.md`,
        ).toBe(true);
      }
    });

    it(`${slug}: expectations.md stays at the workstream root`, () => {
      expect(existsSync(subjectAbs(slug, { kind: "expectations" }))).toBe(true);
    });
  }
});
