// E-5 (P1): state-flipping flows leave GRAPH.md fresh (G-3, UC-2, UC-3,
// CAP-4, FR-4). RED until Phase 5 merges (claim + emission hooks are
// Phase 4; the mark-done host is Phase 5 — this eval needs all three).
// Runnable standalone: `npx tsx <this file>`.
//
// In a fixture repo with a committed, fresh GRAPH.md: the claim helper,
// the merge-cleanup path (`devx devx-helper mark-done`), and the RED-stage
// emission path (`devx plan-helper emit-retro-story`) each run, and after
// each `devx graph --check` must exit 0 with no manual regen in between.
// Permanent suite: test/devx-helper-mark-done.test.ts + claim/emission
// regen cases.

import { rmSync } from "node:fs";
import { git, mkFx, row, runCli, specRel } from "./_fixture.js";

const failures: string[] = [];
const fx = mkFx({ prefix: "e5-fresh", withOrigin: true });

function checkFresh(flow: string, missing: string): void {
  const chk = runCli(["graph", "--check"], fx.root);
  if (chk.status !== 0) {
    failures.push(
      `after the ${flow} flow, \`devx graph --check\` exited ${chk.status} — ${missing}: ${(chk.stderr || chk.stdout).slice(0, 150)}`,
    );
  }
}

try {
  const ws = "_devx/workstreams/ws-flow";
  fx.write(`${ws}/plan.md`, "# Plan — ws-flow\n\n## Phase checklist\n\n- [ ] Phase 1: Flow one\n");
  const planRel = fx.writeSpec({
    type: "plan", hash: "wfl001", slug: "ws-flow", title: "Workstream ws-flow",
    status: "in-progress", fm: [`workstream: ${ws}`],
  });
  fx.writeSpec({ type: "dev", hash: "flw111", slug: "flow-one", title: "Flow one", status: "ready", fm: [`plan: ${ws}`, "phase: 1"] });
  fx.write("DEV.md", [
    "# DEV",
    "",
    "### Epic — ws-flow (plan: wfl001)",
    "",
    row(" ", "dev", "flw111", "flow-one", "Flow one", "ready"),
    "",
  ].join("\n"));
  fx.write("PLAN.md", ["# PLAN", "", row("/", "plan", "wfl001", "ws-flow", "Workstream ws-flow", "in-progress"), ""].join("\n"));
  fx.commitAll("fixture: board");
  git(fx.root, "push", "origin", "main");

  // Baseline: a committed, fresh GRAPH.md.
  const gen = runCli(["graph"], fx.root);
  if (gen.status !== 0) {
    failures.push(
      `\`devx graph\` exited ${gen.status} — no graph CLI, so no flow can keep GRAPH.md fresh (Phases 3–5 unimplemented): ${(gen.stderr || gen.stdout).slice(0, 200)}`,
    );
  } else {
    fx.commitAll("chore: initial GRAPH.md");
    git(fx.root, "push", "origin", "main");

    // Flow 1: claim → in-progress.
    const claim = runCli(["devx-helper", "claim", "flw111"], fx.root);
    if (claim.status !== 0) {
      failures.push(`\`devx devx-helper claim flw111\` exited ${claim.status} (fixture flow could not start): ${(claim.stderr || claim.stdout).slice(0, 200)}`);
    } else {
      checkFresh("claim", "the claim helper does not regenerate GRAPH.md (Phase 4, T4.2)");

      // Flow 2: merge-cleanup → done, via the mark-done host.
      const done = runCli(
        ["devx-helper", "mark-done", "flw111", "--pr", "1", "--merge-sha", "deadbee"],
        fx.root,
      );
      if (done.status !== 0) {
        failures.push(
          `\`devx devx-helper mark-done\` exited ${done.status} — the merge-cleanup host does not exist yet (Phase 5, T5.1/T5.2): ${(done.stderr || done.stdout).slice(0, 200)}`,
        );
      } else {
        checkFresh("merge-cleanup (mark-done)", "mark-done does not regenerate GRAPH.md (Phase 5)");
      }
    }

    // Flow 3: RED-stage emission (retro co-emission appends to DEV.md).
    const emit = runCli(
      ["plan-helper", "emit-retro-story", "--epic-slug", "ws-flow", "--parents", "flw111", "--plan", planRel],
      fx.root,
    );
    if (emit.status !== 0) {
      failures.push(`\`devx plan-helper emit-retro-story\` exited ${emit.status} (fixture flow could not start): ${(emit.stderr || emit.stdout).slice(0, 200)}`);
    } else {
      checkFresh("emission", "the emission path does not regenerate GRAPH.md (Phase 4, T4.3)");
    }
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
  if (fx.originDir) rmSync(fx.originDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-5 RED — state-flipping flows leave GRAPH.md stale:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-5 GREEN — claim, mark-done, and emission each leave `devx graph --check` at exit 0 with no manual regen.");
