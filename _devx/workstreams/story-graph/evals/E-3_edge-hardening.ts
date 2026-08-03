// E-3 (P0): edge hardening — phantoms dropped, markup stripped, cycles
// fail (CAP-3, FR-3). RED until Phase 3 merges (tokenization hardening is
// Phase 1; this asserts it end-to-end through the CLI). Runnable
// standalone: `npx tsx <this file>`.
//
// Fixture A reproduces the audited palateful shapes: a Blocked-by with
// trailing prose whose tokens are not spec hashes (dropped + warned, zero
// phantoms), markup-wrapped real hashes (~~rsh101~~ / **now debug-rshrd1**
// — recovered), and a spec-path blocker (resolved cross-type). Fixtures
// B/C: a mutual-block cycle and a self-block — both exit non-zero
// enumerating every participant and write no GRAPH.md.
// Permanent suite: test/backlog-parse.test.ts, test/graph-model.test.ts.

import { rmSync } from "node:fs";
import { mkFx, row, runCli, specRel } from "./_fixture.js";

interface Model {
  nodes: Array<{ hash: string }>;
  edges: Array<{ from: string; to: string; kind: string }>;
  warnings: Array<{ code: string; source?: string; message: string }>;
}

const failures: string[] = [];
const fx = mkFx({ prefix: "e3-harden" });
const fxCycle = mkFx({ prefix: "e3-cycle" });
const fxSelf = mkFx({ prefix: "e3-self" });

try {
  // ---- fixture A: phantom / markup / spec-path shapes ----------------
  fx.writeSpec({ type: "dev", hash: "rsh101", slug: "rsh-one", title: "Rsh one", status: "in-progress" });
  fx.writeSpec({ type: "debug", hash: "rshrd1", slug: "rsh-red", title: "Rsh red", status: "ready" });
  fx.writeSpec({ type: "debug", hash: "dbg001", slug: "some-bug", title: "Some bug", status: "ready" });
  fx.writeSpec({ type: "dev", hash: "tgt111", slug: "target-one", title: "Target one", status: "in-progress" });
  fx.writeSpec({ type: "dev", hash: "tgt222", slug: "target-two", title: "Target two", status: "ready" });
  fx.writeSpec({ type: "dev", hash: "tgt333", slug: "target-three", title: "Target three", status: "blocked" });
  fx.write("DEV.md", [
    "# DEV",
    "",
    // Audited shape 1: trailing prose, tokens that are not known hashes.
    row("/", "dev", "tgt111", "target-one", "Target one", "in-progress",
      ["Blocked-by: ifh3, ifh4 (consumes their `failed: true` records)."]),
    // Audited shape 2: markup-wrapped real hashes.
    row(" ", "dev", "tgt222", "target-two", "Target two", "ready",
      ["Blocked-by: ~~rsh101~~ (superseded), **now debug-rshrd1**: rerun."]),
    // Audited shape 3: spec-path blocker, cross-type.
    row("-", "dev", "tgt333", "target-three", "Target three", "blocked",
      [`Blocked-by: ${specRel("debug", "dbg001", "some-bug")}.`]),
    row("/", "dev", "rsh101", "rsh-one", "Rsh one", "in-progress"),
    "",
  ].join("\n"));
  fx.write("DEBUG.md", [
    "# DEBUG", "",
    row(" ", "debug", "rshrd1", "rsh-red", "Rsh red", "ready"),
    row(" ", "debug", "dbg001", "some-bug", "Some bug", "ready"),
    "",
  ].join("\n"));
  fx.commitAll("fixture: audited shapes");

  const res = runCli(["graph", "--format", "json"], fx.root);
  if (res.status !== 0) {
    failures.push(
      `\`devx graph --format json\` exited ${res.status} — the graph CLI is not implemented yet (Phase 3 / Phase 1 tokenization): ${(res.stderr || res.stdout).slice(0, 200)}`,
    );
  } else {
    let model: Model | null = null;
    try {
      model = JSON.parse(res.stdout) as Model;
    } catch {
      failures.push("--format json stdout is not pure JSON (warnings must go to stderr)");
    }
    if (model) {
      // Phantoms dropped, warned with the source row named.
      for (const phantom of ["ifh3", "ifh4"]) {
        if (model.nodes.some((n) => n.hash === phantom)) {
          failures.push(`phantom node rendered for unknown token '${phantom}'`);
        }
      }
      const unknownWarns = model.warnings.filter((w) => w.code === "unknown-blocker");
      const named = unknownWarns.some(
        (w) => `${w.source ?? ""} ${w.message}`.includes("tgt111"),
      );
      if (!named) {
        failures.push("no unknown-blocker warning naming the source row (tgt111) for the dropped tokens");
      }
      // Markup-wrapped real hashes recovered.
      const blocks = model.edges.filter((e) => e.kind === "blocks");
      if (!blocks.some((e) => e.from === "tgt222" && e.to === "rsh101")) {
        failures.push("edge tgt222 → rsh101 not recovered from ~~rsh101~~ markup");
      }
      if (!blocks.some((e) => e.from === "tgt222" && e.to === "rshrd1")) {
        failures.push("edge tgt222 → rshrd1 not recovered from **now debug-rshrd1** markup");
      }
      // Spec-path blocker resolved cross-type.
      if (!blocks.some((e) => e.from === "tgt333" && e.to === "dbg001")) {
        failures.push("spec-path blocker not resolved to its hash (tgt333 → dbg001, cross-type)");
      }
    }
  }

  // ---- fixture B: mutual-block cycle ---------------------------------
  fxCycle.writeSpec({ type: "dev", hash: "cyc111", slug: "cycle-one", title: "Cycle one", status: "ready", fm: ["blocked_by: [cyc222]"] });
  fxCycle.writeSpec({ type: "dev", hash: "cyc222", slug: "cycle-two", title: "Cycle two", status: "ready", fm: ["blocked_by: [cyc111]"] });
  fxCycle.write("DEV.md", [
    "# DEV", "",
    row(" ", "dev", "cyc111", "cycle-one", "Cycle one", "ready", ["Blocked-by: cyc222."]),
    row(" ", "dev", "cyc222", "cycle-two", "Cycle two", "ready", ["Blocked-by: cyc111."]),
    "",
  ].join("\n"));
  fxCycle.commitAll("fixture: cycle");
  const cyc = runCli(["graph"], fxCycle.root);
  if (cyc.status === 0) {
    failures.push("`devx graph` exited 0 on a mutual-block cycle (must fail)");
  } else {
    const out = cyc.stdout + cyc.stderr;
    for (const h of ["cyc111", "cyc222"]) {
      if (!out.includes(h)) failures.push(`cycle error does not enumerate ${h}`);
    }
  }
  if (fxCycle.exists("GRAPH.md")) {
    failures.push("GRAPH.md was written despite the cycle failure");
  }

  // ---- fixture C: self-block cycle -----------------------------------
  fxSelf.writeSpec({ type: "dev", hash: "slf111", slug: "self-one", title: "Self one", status: "ready", fm: ["blocked_by: [slf111]"] });
  fxSelf.write("DEV.md", [
    "# DEV", "",
    row(" ", "dev", "slf111", "self-one", "Self one", "ready", ["Blocked-by: slf111."]),
    "",
  ].join("\n"));
  fxSelf.commitAll("fixture: self-block");
  const self = runCli(["graph"], fxSelf.root);
  if (self.status === 0) {
    failures.push("`devx graph` exited 0 on a self-blocking spec (must fail)");
  } else if (!(self.stdout + self.stderr).includes("slf111")) {
    failures.push("self-block cycle error does not name slf111");
  }
  if (fxSelf.exists("GRAPH.md")) {
    failures.push("GRAPH.md was written despite the self-block failure");
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
  rmSync(fxCycle.root, { recursive: true, force: true });
  rmSync(fxSelf.root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-3 RED — edge hardening is not in place yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-3 GREEN — phantoms dropped with named warnings, markup/path edges recovered, both cycle cases fail naming all participants.");
