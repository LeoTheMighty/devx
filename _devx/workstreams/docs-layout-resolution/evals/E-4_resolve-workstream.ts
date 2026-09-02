// E-4 (P0): workstream resolution reaches the repo root under project-level
// (G-1, UC-1, CAP-2, FR-3). RED until Phase 3 merges.
// Runnable standalone: `npx tsx <this file>`.
//
// Three frontmatter states, because a real repo produces all three: the key
// written as `.` (a fresh project-level scaffold), the key ABSENT (a
// hand-authored spec), and a stale `_devx/workstreams/<slug>` left behind by
// a half-finished migration. The absent case is the dangerous one —
// `planFilenameWorkstreamRel()` derives a FOLDER path from the spec filename,
// so a flat repo gets pointed at `_devx/workstreams/scene-engine`, a
// directory that does not exist in a repo that has no directories.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { engineConfigFrom } from "../../../../src/lib/engine/config.js";
import { resolveWorkstream } from "../../../../src/lib/engine/workstream.js";
import { mkWorkstreamFixture, repoRoot } from "./_fixture.js";

const failures: string[] = [];

/** The config a project-level repo carries. */
const MERGED = {
  engine: { workstreams_root: "_devx/workstreams", docs_layout: "project-level" },
};

// The layout has to reach the resolver at all before anything below can be
// true. EngineConfig gains `docsLayout` in Phase 1; until it does, every
// resolveWorkstream call site threads a config object that cannot answer the
// question, and a "correct" result here would be an accident.
const engine = engineConfigFrom(MERGED) as ReturnType<typeof engineConfigFrom> & {
  docsLayout?: string;
};
if (engine.docsLayout !== "project-level") {
  failures.push(
    `EngineConfig carries no layout — engineConfigFrom({engine:{docs_layout:"project-level"}}).docsLayout is ${JSON.stringify(engine.docsLayout)}. Every resolver threads this object, so until T1.3 lands the layout is unreachable from resolveWorkstream (T1.3 → T3.2).`,
  );
}

interface Case {
  name: string;
  workstreamValue: string | undefined;
}

const CASES: Case[] = [
  { name: "workstream: .", workstreamValue: "." },
  { name: "workstream: absent", workstreamValue: undefined },
  { name: "workstream: stale folder path", workstreamValue: "_devx/workstreams/scene-engine" },
];

for (const c of CASES) {
  const fx = mkWorkstreamFixture({
    prefix: "e4-resolve",
    layout: "project-level",
    workstreamValue: c.workstreamValue,
  });
  try {
    let rel: string;
    let abs: string;
    try {
      const r = resolveWorkstream(fx.root, fx.hash, engine);
      rel = r.workstreamRel;
      abs = r.workstreamAbs;
    } catch (e) {
      failures.push(
        `[${c.name}] resolveWorkstream threw: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    if (rel !== ".") {
      failures.push(
        `[${c.name}] workstreamRel is '${rel}', expected '.' — under project-level there is exactly one workstream and it is the repo root`,
      );
    }
    if (abs !== fx.root) {
      failures.push(
        `[${c.name}] workstreamAbs is '${abs}', expected the repo root '${fx.root}'`,
      );
    }
    if (rel.includes("/")) {
      failures.push(
        `[${c.name}] workstreamRel '${rel}' is a '<root>/<slug>' folder path — planFilenameWorkstreamRel()'s filename derivation ran under a layout that has no folders (T3.3)`,
      );
    }
  } finally {
    fx.cleanup();
  }
}

// Control: the folder layout must be untouched by all of this.
{
  const fx = mkWorkstreamFixture({ prefix: "e4-control", layout: "workstream" });
  try {
    const wsEngine = engineConfigFrom({
      engine: { workstreams_root: "_devx/workstreams", docs_layout: "workstream" },
    });
    const r = resolveWorkstream(fx.root, fx.hash, wsEngine);
    if (r.workstreamRel !== `_devx/workstreams/${fx.slug}`) {
      failures.push(
        `control: under 'workstream' layout resolveWorkstream returned '${r.workstreamRel}', expected '_devx/workstreams/${fx.slug}' — devx's own resolution regressed`,
      );
    }
  } catch (e) {
    failures.push(`control: resolveWorkstream threw under 'workstream' layout: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    fx.cleanup();
  }
}

if (!existsSync(join(repoRoot, "test", "engine-layout-resolve-workstream.test.ts"))) {
  failures.push(
    "test/engine-layout-resolve-workstream.test.ts missing — the 3-state resolution invariant is not pinned in `npm test` (feature missing, T3.1)",
  );
}

if (failures.length > 0) {
  console.error("E-4 RED — workstream resolution does not reach the repo root under project-level:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-4 GREEN — all 3 frontmatter states resolve to the repo root under project-level; the folder layout is unchanged.",
);
