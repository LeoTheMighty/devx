// E-5 (P0): scaffolding produces the shape the layout names (G-1, UC-1,
// CAP-3, FR-4). RED until Phase 4 merges. Runnable standalone: `npx tsx <this file>`.
//
// Four combinations, not the two the threshold pinned: the trigger names
// slug × layout, and "with a slug under project-level" is the one a real
// adopter hits first — they have a name for the thing they are building and
// no reason to think the tool would object. The slug must name the plan spec
// and nothing on disk.
//
// The no-slug cases are unreachable until the commander argument becomes
// `[slug]` (T4.10): commander rejects the invocation before any devx code
// runs, so a refusal written inside `runWorkstreamNew` would never be seen.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, repoRoot, runCli, assertRan } from "./_fixture.js";

const failures: string[] = [];

/** A bare repo — no workstream yet. `devx workstream new` is the thing under
 *  test, so the fixture must not pre-scaffold what it is supposed to create. */
function bareRepo(layout: string): string {
  const root = mkdtempSync(join(tmpdir(), `e5-${layout === "project-level" ? "flat" : "ws"}-`));
  git(root, "init", "-b", "main");
  writeFileSync(
    join(root, "devx.config.yaml"),
    [
      "mode: YOLO",
      "git:",
      "  default_branch: main",
      "  integration_branch: null",
      "engine:",
      "  workstreams_root: _devx/workstreams",
      `  docs_layout: ${layout}`,
      "  expectations_min: 3",
      "",
    ].join("\n"),
  );
  for (const f of ["DEV.md", "PLAN.md", "MANUAL.md", "INTERVIEW.md"]) {
    writeFileSync(join(root, f), `# ${f.replace(".md", "")}\n`);
  }
  mkdirSync(join(root, "plan"), { recursive: true });
  cpSync(join(repoRoot, "_devx", "templates", "engine"), join(root, "_devx", "templates", "engine"), {
    recursive: true,
  });
  git(root, "add", "-A");
  git(root, "commit", "-m", "fixture: bare repo", "--no-gpg-sign");
  return root;
}

function planSpec(root: string): string | null {
  const dir = join(root, "plan");
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((n) => n.startsWith("plan-") && n.endsWith(".md"));
  return f ? join(dir, f) : null;
}

// --- 1. project-level, NO slug: a complete root doc set. --------------------
{
  const root = bareRepo("project-level");
  try {
    const res = runCli(["workstream", "new"], root);
    const infra = assertRan(res, "devx workstream new");
    if (infra !== null) {
      failures.push(infra);
    } else if (res.status !== 0) {
      failures.push(
        `[project-level, no slug] exited ${res.status} — UC-1's primary path is refused: ${(res.stderr || res.stdout).trim().slice(0, 300)}`,
      );
    } else {
      const want = ["prd.md", "expectations.md", "todo.md", "decisions", "checkpoints", "evals"];
      const missing = want.filter((w) => !existsSync(join(root, w)));
      if (missing.length > 0) {
        failures.push(
          `[project-level, no slug] root doc set is ${want.length - missing.length} of ${want.length} — missing: ${missing.join(", ")}`,
        );
      }
      const spec = planSpec(root);
      if (spec === null) {
        failures.push("[project-level, no slug] no plan spec was written under plan/");
      } else {
        const fm = readFileSync(spec, "utf8");
        if (!/^workstream:\s*\.\s*$/m.test(fm)) {
          failures.push(
            `[project-level, no slug] plan spec's \`workstream:\` is not '.' — got ${JSON.stringify(/^workstream:.*$/m.exec(fm)?.[0] ?? "(absent)")}`,
          );
        }
      }
      if (existsSync(join(root, "_devx", "workstreams"))) {
        failures.push("[project-level, no slug] a _devx/workstreams/ tree was created — project-level has no slug directories");
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- 2. workstream layout, NO slug: refuse, naming the layout. --------------
{
  const root = bareRepo("workstream");
  try {
    const res = runCli(["workstream", "new"], root);
    const infra = assertRan(res, "devx workstream new");
    if (infra !== null) {
      failures.push(infra);
    } else {
      if (res.status !== 1) {
        failures.push(
          `[workstream, no slug] exited ${res.status}, expected 1 — a missing slug is a refusal, not a usage error or a success`,
        );
      }
      const text = `${res.stdout}${res.stderr}`;
      if (!text.includes("engine.docs_layout: workstream")) {
        failures.push(
          `[workstream, no slug] the refusal does not name \`engine.docs_layout: workstream\` as the reason the slug is required — got: ${text.trim().slice(0, 240)}`,
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- 3. project-level WITH a slug: the slug names the spec, not a dir. ------
{
  const root = bareRepo("project-level");
  try {
    const res = runCli(["workstream", "new", "scene-engine"], root);
    const infra = assertRan(res, "devx workstream new scene-engine");
    if (infra !== null) {
      failures.push(infra);
    } else if (res.status !== 0) {
      failures.push(
        `[project-level, with slug] exited ${res.status}: ${(res.stderr || res.stdout).trim().slice(0, 300)}`,
      );
    } else {
      if (!existsSync(join(root, "prd.md"))) {
        failures.push("[project-level, with slug] the doc set did not land at the repo root");
      }
      if (existsSync(join(root, "_devx", "workstreams", "scene-engine"))) {
        failures.push("[project-level, with slug] the slug created a directory — under this layout it names the plan spec only");
      }
      const spec = planSpec(root);
      if (spec === null || !spec.includes("scene-engine")) {
        failures.push(`[project-level, with slug] the slug does not name the plan spec's filename — got ${spec ?? "(no spec)"}`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- 4. Control: workstream layout with a slug is unchanged. ----------------
{
  const root = bareRepo("workstream");
  try {
    const res = runCli(["workstream", "new", "scene-engine"], root);
    if (res.status !== 0) {
      failures.push(
        `control: [workstream, with slug] exited ${res.status} — devx's own scaffolding path regressed: ${(res.stderr || res.stdout).trim().slice(0, 300)}`,
      );
    } else if (!existsSync(join(root, "_devx", "workstreams", "scene-engine", "prd", "agent.md"))) {
      failures.push("control: [workstream, with slug] did not produce the folder-per-artifact tree");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (!existsSync(join(repoRoot, "test", "engine-layout-scaffold.test.ts"))) {
  failures.push(
    "test/engine-layout-scaffold.test.ts missing — the 4-combination scaffolding invariant is not pinned in `npm test` (feature missing, T4.2)",
  );
}

if (failures.length > 0) {
  console.error("E-5 RED — scaffolding does not produce the shape the layout names:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-5 GREEN — all 4 slug×layout combinations scaffold the shape their layout names.");
