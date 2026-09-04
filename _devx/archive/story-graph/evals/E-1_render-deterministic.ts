// E-1 (P0): mechanical, deterministic render (G-1, UC-1, CAP-1, CAP-2,
// FR-1, FR-2). RED until Phase 3 (renderer + `devx graph` CLI) merges.
// Runnable standalone: `npx tsx <this file>`.
//
// Fixture leg: a board with two active workstreams (ready/in-progress/
// blocked/done specs, blocking edges within and across workstreams, a
// parallel-safe pair, a `spawned:` lineage chain, a cross-type dev→debug
// edge), one fully-done workstream, ad-hoc specs with no workstream, and a
// fenced code-block example row in DEV.md. Asserts the enumerated GRAPH.md
// structure and a byte-identical second run.
// Live leg: the BUILT CLI (dist/cli.js — the stale-dist false-red class is
// handled in _fixture.runBuiltCli) against the real devx repo in --stdout /
// --format json mode (no write): < 2s, byte-identical double render, and
// 0 phantom nodes (every node hash resolves to a spec file on disk).
// Permanent suite: test/graph-render.test.ts, test/graph-cli.test.ts.

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  linesWithBoth,
  mermaidBlock,
  mkFx,
  repoRoot,
  row,
  runBuiltCli,
  runCli,
  specRel,
} from "./_fixture.js";

const failures: string[] = [];
const fx = mkFx({ prefix: "e1-render" });

try {
  // ---- board fixture -------------------------------------------------
  const wsAlpha = "_devx/workstreams/ws-alpha";
  const wsBeta = "_devx/workstreams/ws-beta";
  const wsDone = "_devx/workstreams/ws-done";
  for (const [dir, hash, slug] of [
    [wsAlpha, "wsa001", "ws-alpha"],
    [wsBeta, "wsb001", "ws-beta"],
    [wsDone, "wsd001", "ws-done"],
  ] as const) {
    fx.write(`${dir}/plan.md`, `# Plan — ${slug}\n`);
    fx.writeSpec({
      type: "plan",
      hash,
      slug,
      title: `Workstream ${slug}`,
      status: hash === "wsd001" ? "done" : "in-progress",
      fm: [`workstream: ${dir}`],
    });
  }

  // ws-alpha: the four statuses + a parallel-safe pair + an internal edge.
  fx.writeSpec({ type: "dev", hash: "aaa111", slug: "alpha-one", title: "Alpha one", status: "ready", fm: [`plan: ${wsAlpha}`, "phase: 1"] });
  fx.writeSpec({ type: "dev", hash: "aaa222", slug: "alpha-two", title: "Alpha two", status: "in-progress", fm: [`plan: ${wsAlpha}`, "phase: 2"] });
  fx.writeSpec({ type: "dev", hash: "aaa333", slug: "alpha-three", title: "Alpha three", status: "blocked", fm: [`plan: ${wsAlpha}`, "phase: 3", "blocked_by: [aaa222]"] });
  fx.writeSpec({ type: "dev", hash: "aaa444", slug: "alpha-four", title: "Alpha four", status: "done", fm: [`plan: ${wsAlpha}`, "phase: 4"] });
  // ws-beta: cross-workstream edge, lineage chain, cross-type edge.
  fx.writeSpec({ type: "dev", hash: "bbb111", slug: "beta-one", title: "Beta one", status: "ready", fm: [`plan: ${wsBeta}`, "phase: 1", "blocked_by: [aaa111]"] });
  fx.writeSpec({ type: "dev", hash: "bbb222", slug: "beta-two", title: "Beta two", status: "in-progress", fm: [`plan: ${wsBeta}`, "phase: 2", "spawned: [bbb333]"] });
  fx.writeSpec({ type: "dev", hash: "bbb333", slug: "beta-three", title: "Beta three", status: "ready", fm: [`plan: ${wsBeta}`, "phase: 3", `from: ${specRel("dev", "bbb222", "beta-two")}`] });
  fx.writeSpec({ type: "dev", hash: "bbb444", slug: "beta-four", title: "Beta four", status: "blocked", fm: [`plan: ${wsBeta}`, "phase: 4", "blocked_by: [dbg111]"] });
  fx.writeSpec({ type: "debug", hash: "dbg111", slug: "beta-bug", title: "Beta bug", status: "in-progress" });
  // ws-done: fully-done workstream — must collapse.
  fx.writeSpec({ type: "dev", hash: "ddd111", slug: "done-one", title: "Done one", status: "done", fm: [`plan: ${wsDone}`, "phase: 1"] });
  fx.writeSpec({ type: "dev", hash: "ddd222", slug: "done-two", title: "Done two", status: "done", fm: [`plan: ${wsDone}`, "phase: 2"] });
  // Ad-hoc: no workstream anywhere.
  fx.writeSpec({ type: "dev", hash: "adh111", slug: "adhoc-one", title: "Adhoc one", status: "ready" });

  fx.write("DEV.md", [
    "# DEV",
    "",
    "### Epic — ws-alpha (plan: wsa001)",
    "",
    row(" ", "dev", "aaa111", "alpha-one", "Alpha one", "ready", ["Parallel-safe with aaa222."]),
    row("/", "dev", "aaa222", "alpha-two", "Alpha two", "in-progress"),
    row("-", "dev", "aaa333", "alpha-three", "Alpha three", "blocked", ["Blocked-by: aaa222."]),
    row("x", "dev", "aaa444", "alpha-four", "Alpha four", "done"),
    "",
    "### Epic — ws-beta (plan: wsb001)",
    "",
    row(" ", "dev", "bbb111", "beta-one", "Beta one", "ready", ["Blocked-by: aaa111."]),
    row("/", "dev", "bbb222", "beta-two", "Beta two", "in-progress"),
    row(" ", "dev", "bbb333", "beta-three", "Beta three", "ready"),
    row("-", "dev", "bbb444", "beta-four", "Beta four", "blocked", ["Blocked-by: dbg111."]),
    "",
    "### Epic — ws-done (plan: wsd001)",
    "",
    row("x", "dev", "ddd111", "done-one", "Done one", "done"),
    row("x", "dev", "ddd222", "done-two", "Done two", "done"),
    "",
    "## Ad-hoc",
    "",
    row(" ", "dev", "adh111", "adhoc-one", "Adhoc one", "ready"),
    "",
    "Example row shape (illustrative only — must NOT render):",
    "",
    "```",
    row(" ", "dev", "ffffff", "example", "Example row", "ready"),
    "```",
    "",
  ].join("\n"));
  fx.write("DEBUG.md", ["# DEBUG", "", row("/", "debug", "dbg111", "beta-bug", "Beta bug", "in-progress"), ""].join("\n"));
  fx.write("PLAN.md", [
    "# PLAN",
    "",
    row("/", "plan", "wsa001", "ws-alpha", "Workstream ws-alpha", "in-progress"),
    row("/", "plan", "wsb001", "ws-beta", "Workstream ws-beta", "in-progress"),
    row("x", "plan", "wsd001", "ws-done", "Workstream ws-done", "done"),
    "",
  ].join("\n"));
  fx.commitAll("fixture: board");

  // ---- run 1: write GRAPH.md ----------------------------------------
  const r1 = runCli(["graph"], fx.root);
  if (r1.status !== 0) {
    failures.push(
      `\`devx graph\` exited ${r1.status} — the graph CLI is not implemented yet (Phase 3, T3.2): ${(r1.stderr || r1.stdout).slice(0, 200)}`,
    );
  } else if (!fx.exists("GRAPH.md")) {
    failures.push("`devx graph` exited 0 but wrote no GRAPH.md at the repo root (FR-1)");
  } else {
    const g1 = fx.read("GRAPH.md");

    // Banner + legend.
    const head = g1.split("\n").slice(0, 8).join("\n");
    if (!/generated/i.test(head)) {
      failures.push("GRAPH.md has no generated-file banner in its opening lines");
    }
    if (!/devx graph/.test(head)) {
      failures.push("GRAPH.md banner does not name the regen command (`devx graph`)");
    }
    if (!/legend/i.test(g1)) failures.push("GRAPH.md has no legend");

    const mm = mermaidBlock(g1);
    if (mm === null) {
      failures.push("GRAPH.md does not contain exactly one fenced ```mermaid block");
    } else {
      if (!/flowchart/.test(mm)) failures.push("mermaid block is not a flowchart");
      // Subgraph per ACTIVE workstream.
      for (const ws of ["ws-alpha", "ws-beta"]) {
        if (!new RegExp(`subgraph[^\\n]*${ws}`).test(mm)) {
          failures.push(`no subgraph for active workstream ${ws}`);
        }
      }
      // Status-styled nodes labeled `<hash> <short-title>`.
      if (!/classDef|:::|style /.test(mm)) {
        failures.push("no status styling (classDef/:::/style) in the mermaid block");
      }
      for (const [h, t] of [
        ["aaa111", "Alpha one"], ["aaa222", "Alpha two"], ["aaa333", "Alpha three"],
        ["aaa444", "Alpha four"], ["bbb111", "Beta one"], ["adh111", "Adhoc one"],
        ["dbg111", "Beta bug"],
      ]) {
        if (!new RegExp(`${h}[^\\n]*${t}`).test(mm)) {
          failures.push(`node for ${h} is not labeled \`<hash> <short-title>\` (expected "${h} … ${t}")`);
        }
      }
      // Solid blocking edge (within ws-alpha).
      const blockEdge = linesWithBoth(mm, "aaa222", "aaa333").filter((l) => l.includes("-->"));
      if (blockEdge.length === 0) {
        failures.push("no solid (-->) blocking edge between aaa333 and aaa222");
      }
      // Cross-workstream blocking edge.
      if (linesWithBoth(mm, "aaa111", "bbb111").length === 0) {
        failures.push("no cross-workstream edge between bbb111 and aaa111");
      }
      // Parallel-safe hint distinct from the solid blocking arrow.
      const par = linesWithBoth(mm, "aaa111", "aaa222");
      const parDistinct = par.some((l) => !/-->/.test(l) || /\|/.test(l));
      if (!parDistinct) {
        failures.push("no distinct parallel-safe hint between aaa111 and aaa222 (indistinguishable from a blocking edge)");
      }
      // Dotted lineage edge.
      const lin = linesWithBoth(mm, "bbb222", "bbb333");
      if (!lin.some((l) => /-\./.test(l))) {
        failures.push("no dotted lineage edge for the bbb222 spawned: bbb333 chain");
      }
      // Cross-type dev→debug edge.
      if (linesWithBoth(mm, "bbb444", "dbg111").length === 0) {
        failures.push("no cross-group edge for the dev bbb444 → debug dbg111 blocker");
      }
      // Fully-done workstream collapses to one summary node.
      if (/ddd111|ddd222/.test(mm)) {
        failures.push("fully-done workstream ws-done renders member nodes instead of a collapsed summary");
      }
      if (!/ws-done/.test(mm)) {
        failures.push("no collapsed summary node for the fully-done workstream ws-done");
      }
      // No phantom node for the fenced example row.
      if (/ffffff/.test(g1)) {
        failures.push("the fenced code-block example row (ffffff) leaked into GRAPH.md");
      }
    }

    // ---- run 2: byte-identical --------------------------------------
    const r2 = runCli(["graph"], fx.root);
    if (r2.status !== 0) {
      failures.push(`second \`devx graph\` run exited ${r2.status}`);
    } else if (fx.read("GRAPH.md") !== g1) {
      failures.push("second run with unchanged state produced a different GRAPH.md (not deterministic)");
    }
  }

  // ---- live leg: built CLI against the real devx repo ----------------
  if (failures.length === 0) {
    const t0 = Date.now();
    const live1 = runBuiltCli(["graph", "--stdout"], repoRoot);
    const dt = Date.now() - t0;
    if (live1.status !== 0) {
      failures.push(
        `built CLI \`devx graph --stdout\` on the live repo exited ${live1.status}: ${(live1.stderr || live1.stdout).slice(0, 200)}`,
      );
    } else {
      if (dt >= 2000) failures.push(`live-repo render took ${dt}ms (threshold < 2000ms)`);
      const live2 = runBuiltCli(["graph", "--stdout"], repoRoot);
      if (live2.stdout !== live1.stdout) {
        failures.push("live-repo double render is not byte-identical");
      }
      // 0 phantom nodes: every node hash in --format json resolves to a spec.
      const json = runBuiltCli(["graph", "--format", "json"], repoRoot);
      if (json.status !== 0) {
        failures.push(`\`devx graph --format json\` exited ${json.status} on the live repo`);
      } else {
        try {
          const model = JSON.parse(json.stdout) as {
            nodes: Array<{ hash: string; type: string }>;
          };
          const known = new Set<string>();
          for (const dir of ["dev", "plan", "test", "debug", "focus", "learn", "qa"]) {
            const abs = join(repoRoot, dir);
            if (!existsSync(abs)) continue;
            for (const name of readdirSync(abs)) {
              const m = /^[a-z]+-([a-z0-9]{3,12})-/.exec(name);
              if (m) known.add(m[1]);
            }
          }
          const phantoms = model.nodes.filter((n) => !known.has(n.hash));
          if (phantoms.length > 0) {
            failures.push(
              `live-repo render has ${phantoms.length} phantom node(s) with no spec file: ${phantoms.slice(0, 5).map((n) => n.hash).join(", ")}`,
            );
          }
        } catch {
          failures.push("`devx graph --format json` stdout is not pure JSON");
        }
      }
    }
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-1 RED — the story graph does not render mechanically yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-1 GREEN — GRAPH.md renders deterministically with the full structural contract; live repo < 2s, 0 phantoms.",
);
