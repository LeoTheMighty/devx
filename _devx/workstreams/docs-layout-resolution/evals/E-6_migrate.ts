// E-6 (P0): a mid-flight migration preserves every gate verdict (G-3, UC-4,
// CAP-4, FR-7). RED until Phase 6 merges. Runnable standalone: `npx tsx <this file>`.
//
// The fixture reproduces ClassyLights `b7e38f` as it actually stands: stage
// plan, Gates 1 and 2 already passed, eight files on disk. Those two passes
// are the thing at risk — they cost a full stage round-trip each to re-earn,
// so a migration that "works" but resets them has destroyed the reason anyone
// would run it. gate_status and gate_verdicts live in the plan SPEC, not the
// tree, so surviving is a property of touching only `workstream:` — which is
// what this asserts, rather than that the numbers happen to match.
//
// G-3's real evidence is the ClassyLights run itself (MANUAL.md MV-a494be.1).
// This fixture proves the mechanism; it cannot prove the migration on a repo
// devx does not own, and it does not claim to.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertRan, git, gitSafe, mkWorkstreamFixture, repoRoot, runCli } from "./_fixture.js";

const failures: string[] = [];

/** The eight files the b7e38f tree carries, workstream spelling → flat. */
const MOVES: Array<[string, string]> = [
  ["prd/agent.md", "prd.md"],
  ["prd/human.md", "prd-human.md"],
  ["design/agent.md", "design.md"],
  ["design/human.md", "design-human.md"],
  ["expectations.md", "expectations.md"],
  ["todo.md", "todo.md"],
  ["decisions/2026-08-01-design-verify.md", "decisions/2026-08-01-design-verify.md"],
  ["decisions/2026-08-02-prd-critique.md", "decisions/2026-08-02-prd-critique.md"],
];

const GATE_STATUS = {
  prd_validated: true,
  design_verified: true,
  plan_verified: false,
  evals_red: false,
};
const GATE_VERDICTS = { prd: "PASS", design: "PASS" };

const fx = mkWorkstreamFixture({
  prefix: "e6-migrate",
  layout: "workstream",
  stage: "plan",
  withDocs: true,
  withDesign: true,
  gateStatus: GATE_STATUS,
  gateVerdicts: GATE_VERDICTS,
  extraFiles: {
    "_devx/workstreams/scene-engine/decisions/2026-08-01-design-verify.md":
      "# Design verify\n\nPASS.\n",
    "_devx/workstreams/scene-engine/decisions/2026-08-02-prd-critique.md":
      "# PRD critique\n\nFindings.\n",
  },
});

/** Frontmatter block of the plan spec, verbatim. */
function specFrontmatter(): string {
  const body = readFileSync(join(fx.root, ...fx.specRel.split("/")), "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(body);
  return m ? m[1] : "(unparseable)";
}
/** Just the two blocks that must not move. */
function gateBlocks(fm: string): string {
  return fm
    .split("\n")
    .filter((l) => /^(gate_status:|gate_verdicts:|\s{2}(prd_validated|design_verified|plan_verified|evals_red|prd|design|plan|evals):)/.test(l))
    .join("\n");
}

const before = gateBlocks(specFrontmatter());

try {
  const res = runCli(["layout", "migrate", "--to", "project-level"], fx.root);
  const infra = assertRan(res, "devx layout migrate --to project-level");
  if (infra !== null) {
    // A command that does not exist DOES print to stderr, so this only fires
    // on a genuine spawn failure.
    failures.push(infra);
  } else if (res.status !== 0) {
    failures.push(
      `\`devx layout migrate --to project-level\` exited ${res.status} — the migration surface does not exist yet (T6.5): ${(res.stderr || res.stdout).trim().slice(0, 300)}`,
    );
  } else {
    // 8 of 8 at their §15 counterparts.
    let landed = 0;
    for (const [from, to] of MOVES) {
      const dest = join(fx.root, ...to.split("/"));
      const src = join(fx.root, "_devx", "workstreams", "scene-engine", ...from.split("/"));
      if (!existsSync(dest)) {
        failures.push(`${from} did not land at its counterpart '${to}'`);
        continue;
      }
      if (existsSync(src)) {
        failures.push(`${from} was COPIED, not moved — the workstream-shaped original is still on disk`);
        continue;
      }
      landed++;
    }
    if (landed !== MOVES.length) {
      failures.push(`${landed} of ${MOVES.length} files landed at their §15-table counterparts`);
    }

    // git rename detection intact — `git mv`, not delete+create.
    const status = gitSafe(fx.root, "status", "--porcelain=v1", "-uall", "--find-renames");
    const renames = status.stdout.split("\n").filter((l) => /^R/.test(l.trim()));
    if (renames.length === 0) {
      failures.push(
        "git sees no renames after the migration — the moves were not made with `git mv`, so the history of every artifact is severed",
      );
    }

    // The whole point: passed gates survive.
    const after = gateBlocks(specFrontmatter());
    if (after !== before) {
      failures.push(
        `gate_status/gate_verdicts changed across the migration.\n      before: ${JSON.stringify(before)}\n      after:  ${JSON.stringify(after)}`,
      );
    }

    // And the next gate still runs on the migrated tree.
    git(fx.root, "add", "-A");
    git(fx.root, "commit", "-m", "migrate", "--no-gpg-sign");
    const tablePath = join(fx.root, "coverage.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      tablePath,
      JSON.stringify({
        rows: [
          { id: "E-1", status: "✅", where: "Phase 1", artifact: "evals/E-1_fixture.ts", note: "" },
          { id: "E-2", status: "✅", where: "Phase 1", artifact: "evals/E-2_fixture.ts", note: "" },
          { id: "E-3", status: "✅", where: "Phase 1", artifact: "evals/E-3_fixture.ts", note: "" },
        ],
      }),
    );
    const gate = runCli(["gate", "coverage", fx.hash, "--table", tablePath], fx.root);
    if (!/"gate":"(PASS|CONCERNS|FAIL)"/.test(gate.stdout)) {
      failures.push(
        `\`devx gate coverage ${fx.hash}\` did not run to a verdict on the migrated tree (exit ${gate.status}): ${(gate.stderr || gate.stdout).trim().slice(0, 300)}`,
      );
    }
  }
} finally {
  fx.cleanup();
}

if (!existsSync(join(repoRoot, "test", "engine-layout-migrate.test.ts"))) {
  failures.push(
    "test/engine-layout-migrate.test.ts missing — the verdict-preservation invariant is not pinned in `npm test` (feature missing, T6.1)",
  );
}

if (failures.length > 0) {
  console.error("E-6 RED — there is no migration that preserves gate verdicts:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-6 GREEN — 8 of 8 files migrated by git mv; gate_status and gate_verdicts byte-identical; the next gate runs.");
