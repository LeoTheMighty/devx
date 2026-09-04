// E-7 (P0): the migration refuses rather than half-moving (G-3, CAP-4, FR-7).
// RED until Phase 6 merges. Runnable standalone: `npx tsx <this file>`.
//
// Three refusals, each a state where moving would LOSE information — which is
// why there is no `--force`. The assertion is not "it exited nonzero": a
// command that refuses after moving four of eight files has done the damage
// the refusal exists to prevent. So every case compares `git status` byte for
// byte across the attempt. The dry-run case is here too, on the SUCCESS path,
// because non-destructive `--dry-run` is the mitigation R-5 leans on and an
// untested one is a promise.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertRan, gitSafe, mkWorkstreamFixture, repoRoot, runCli, type WsFixture } from "./_fixture.js";

const failures: string[] = [];

/** Everything git can see, including untracked — the whole tree state. */
function treeState(root: string): string {
  return gitSafe(root, "status", "--porcelain=v1", "-uall").stdout;
}

interface Case {
  name: string;
  /** Text the refusal must name, so the operator knows what to do next. */
  mustSay: RegExp;
  build: () => WsFixture;
  /** Extra setup after the fixture is built (post-commit). */
  after?: (fx: WsFixture) => void;
}

const CASES: Case[] = [
  {
    name: "two live workstreams",
    mustSay: /workstream/i,
    build: () =>
      mkWorkstreamFixture({
        prefix: "e7-two",
        layout: "workstream",
        stage: "plan",
        extraFiles: {
          // A second plan spec, stage: design — live by the `stage !== done
          // && stage !== retired` rule, so the flat layout cannot hold both.
          "plan/plan-c1d2e3-2026-09-02T10:00-second-thing.md": [
            "---",
            "hash: c1d2e3",
            "type: plan",
            "created: 2026-09-02T10:00:00-06:00",
            "title: Second thing",
            "status: in-progress",
            "stage: design",
            "workstream: _devx/workstreams/second-thing",
            "---",
            "",
            "## Goal",
            "",
            "A second live workstream.",
            "",
          ].join("\n"),
          "_devx/workstreams/second-thing/prd/agent.md": "# PRD — second thing\n",
        },
      }),
  },
  {
    name: "doc set already at the destination",
    mustSay: /prd\.md|doc set|already/i,
    build: () =>
      mkWorkstreamFixture({
        prefix: "e7-dest",
        layout: "workstream",
        stage: "plan",
        // A root prd.md is exactly what a half-finished migration leaves.
        extraFiles: { "prd.md": "# PRD — a doc set is already here\n" },
      }),
  },
  {
    name: "dirty working tree",
    mustSay: /dirty|uncommitted|clean/i,
    build: () =>
      mkWorkstreamFixture({ prefix: "e7-dirty", layout: "workstream", stage: "plan", dirty: true }),
  },
];

for (const c of CASES) {
  const fx = c.build();
  c.after?.(fx);
  try {
    const before = treeState(fx.root);
    const res = runCli(["layout", "migrate", "--to", "project-level"], fx.root);
    const after = treeState(fx.root);
    const infra = assertRan(res, "devx layout migrate --to project-level");
    if (infra !== null) {
      failures.push(`[${c.name}] ${infra}`);
      continue;
    }
    if (res.status === 0) {
      failures.push(`[${c.name}] the migration SUCCEEDED — this state must be refused, not migrated`);
    } else if (res.status !== 1) {
      failures.push(
        `[${c.name}] exited ${res.status}, expected 1 — a contradicted repo state is a refusal, not a hard error: ${(res.stderr || res.stdout).trim().slice(0, 260)}`,
      );
    }
    const text = `${res.stdout}${res.stderr}`;
    if (!c.mustSay.test(text)) {
      failures.push(
        `[${c.name}] the refusal does not name what it found (expected to match ${c.mustSay}) — got: ${text.trim().slice(0, 240)}`,
      );
    }
    if (after !== before) {
      failures.push(
        `[${c.name}] the working tree CHANGED across a refusal — files moved before the state was checked.\n      before: ${JSON.stringify(before)}\n      after:  ${JSON.stringify(after)}`,
      );
    }
  } finally {
    fx.cleanup();
  }
}

// --- --dry-run on the SUCCESS path moves nothing. ---------------------------
{
  const fx = mkWorkstreamFixture({ prefix: "e7-dry", layout: "workstream", stage: "plan" });
  try {
    const before = treeState(fx.root);
    const res = runCli(["layout", "migrate", "--to", "project-level", "--dry-run"], fx.root);
    const after = treeState(fx.root);
    const infra = assertRan(res, "devx layout migrate --dry-run");
    if (infra !== null) {
      failures.push(infra);
    } else {
      if (res.status !== 0) {
        failures.push(
          `[--dry-run] exited ${res.status} on a migratable repo — the plan must render without executing: ${(res.stderr || res.stdout).trim().slice(0, 260)}`,
        );
      }
      if (after !== before) {
        failures.push("[--dry-run] the working tree changed — a dry run moved files");
      }
      if (existsSync(join(fx.root, "prd.md"))) {
        failures.push("[--dry-run] prd.md exists at the repo root — the dry run performed the migration");
      }
      if (!/prd\.md/.test(`${res.stdout}${res.stderr}`)) {
        failures.push("[--dry-run] the rendered plan does not name the moves it would make");
      }
    }
  } finally {
    fx.cleanup();
  }
}

if (!existsSync(join(repoRoot, "test", "engine-layout-migrate-refusals.test.ts"))) {
  failures.push(
    "test/engine-layout-migrate-refusals.test.ts missing — the refusal invariant is not pinned in `npm test` (feature missing, T6.1)",
  );
}

if (failures.length > 0) {
  console.error("E-7 RED — there is no migration to refuse:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-7 GREEN — 3 of 3 refusal conditions exit 1 with 0 files moved; --dry-run moves nothing.");
