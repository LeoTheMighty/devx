// E-2 (P0): `devx graph --check` catches drift (G-3, UC-5, CAP-4, FR-1).
// RED until Phase 3 (renderer + CLI incl. --check) merges. Runnable
// standalone: `npx tsx <this file>`.
//
// Three phases against one fixture: (1) fresh GRAPH.md → exit 0;
// (2) one spec's status flipped (frontmatter + backlog checkbox) without
// regenerating → exit non-zero, message naming GRAPH.md and the regen
// command; (3) regenerated → exit 0 again.
// Permanent suite: test/graph-cli.test.ts.

import { rmSync } from "node:fs";
import { mkFx, row, runCli } from "./_fixture.js";

const failures: string[] = [];
const fx = mkFx({ prefix: "e2-drift" });

try {
  fx.writeSpec({ type: "dev", hash: "chk111", slug: "check-one", title: "Check one", status: "ready" });
  fx.writeSpec({ type: "dev", hash: "chk222", slug: "check-two", title: "Check two", status: "ready", fm: ["blocked_by: [chk111]"] });
  fx.write("DEV.md", [
    "# DEV",
    "",
    row(" ", "dev", "chk111", "check-one", "Check one", "ready"),
    row(" ", "dev", "chk222", "check-two", "Check two", "ready", ["Blocked-by: chk111."]),
    "",
  ].join("\n"));
  fx.commitAll("fixture: board");

  const gen = runCli(["graph"], fx.root);
  if (gen.status !== 0) {
    failures.push(
      `\`devx graph\` exited ${gen.status} — the graph CLI (and with it --check) is not implemented yet (Phase 3, T3.3): ${(gen.stderr || gen.stdout).slice(0, 200)}`,
    );
  } else {
    // Phase 1: fresh → exit 0.
    const fresh = runCli(["graph", "--check"], fx.root);
    if (fresh.status !== 0) {
      failures.push(
        `--check exited ${fresh.status} on a freshly-rendered GRAPH.md (expected 0): ${(fresh.stderr || fresh.stdout).slice(0, 200)}`,
      );
    }

    // Phase 2: flip chk111 ready → in-progress without regenerating.
    const specRelPath = "dev/dev-chk111-2026-08-01T08:00-check-one.md";
    fx.write(specRelPath, fx.read(specRelPath).replace("status: ready", "status: in-progress"));
    fx.write("DEV.md", fx.read("DEV.md").replace(
      row(" ", "dev", "chk111", "check-one", "Check one", "ready"),
      row("/", "dev", "chk111", "check-one", "Check one", "in-progress"),
    ));
    const drifted = runCli(["graph", "--check"], fx.root);
    if (drifted.status === 0) {
      failures.push("--check exited 0 after a status flip with no regen — drift not detected");
    } else {
      const out = drifted.stdout + drifted.stderr;
      if (!out.includes("GRAPH.md")) {
        failures.push(`drift message does not name GRAPH.md: ${out.slice(0, 200)}`);
      }
      if (!/devx graph/.test(out)) {
        failures.push(`drift message does not name the regen command (\`devx graph\`): ${out.slice(0, 200)}`);
      }
    }

    // Phase 3: regenerate → exit 0 again.
    const regen = runCli(["graph"], fx.root);
    if (regen.status !== 0) {
      failures.push(`regen \`devx graph\` exited ${regen.status}`);
    } else {
      const clean = runCli(["graph", "--check"], fx.root);
      if (clean.status !== 0) {
        failures.push(`--check exited ${clean.status} after regeneration (expected 0)`);
      }
    }
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-2 RED — GRAPH.md drift is not detectable yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-2 GREEN — --check is 0 when fresh, non-zero naming GRAPH.md + regen command on drift, 0 after regen.");
