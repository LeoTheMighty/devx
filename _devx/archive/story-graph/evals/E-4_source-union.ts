// E-4 (P0): edge-source union + heading tolerance across repo dialects
// (G-2, CAP-1, CAP-3, FR-3). RED until Phase 3 merges (heading tolerance
// is Phase 1; asserted end-to-end through the CLI). Runnable standalone:
// `npx tsx <this file>`.
//
// Two fixtures modeled on the research/ audits:
//  - ffm-shape: done rows whose Blocked-by prose was replaced by PR
//    narration, edges only in frontmatter `blocked_by:`, heading
//    `### <slug> (workstream <hash>)`.
//  - palateful-shape: prose-only row edges, the hyphenated `blocked-by:`
//    frontmatter key, mixed ##/### epic headings with prose suffixes, and
//    one spec whose frontmatter and row edge sets disagree.
// Asserts the exact unioned edge set (0 missing, 0 extra), grouping under
// both heading variants, the hyphen-key normalization warning, and the
// edge-drift warning on exactly the disagreeing spec.
// Permanent suite: test/backlog-parse-epic.test.ts, test/graph-model.test.ts.

import { rmSync } from "node:fs";
import { mkFx, row, runCli, specRel } from "./_fixture.js";

interface Model {
  nodes: Array<{ hash: string; group: string | null }>;
  edges: Array<{ from: string; to: string; kind: string }>;
  warnings: Array<{ code: string; hash?: string; source?: string; message: string }>;
}

function blockEdgeSet(m: Model): string[] {
  return m.edges
    .filter((e) => e.kind === "blocks")
    .map((e) => `${e.from}->${e.to}`)
    .sort();
}

const failures: string[] = [];
const fxFfm = mkFx({ prefix: "e4-ffm" });
const fxPal = mkFx({ prefix: "e4-pal" });

try {
  // ---- ffm-shape ----------------------------------------------------
  fxFfm.writeSpec({ type: "dev", hash: "ffm111", slug: "widget-core", title: "Widget core", status: "done" });
  fxFfm.writeSpec({ type: "dev", hash: "ffm222", slug: "widget-polish", title: "Widget polish", status: "done", fm: ["blocked_by: [ffm111]"] });
  fxFfm.write("DEV.md", [
    "# DEV",
    "",
    "### ffm-widget (workstream wsf001)",
    "",
    // Done rows: Blocked-by prose replaced by PR narration (the audit shape).
    `- [x] \`${specRel("dev", "ffm111", "widget-core")}\` — Widget core. PR: https://github.com/x/y/pull/1 (merged abc1234). Status: done.`,
    `- [x] \`${specRel("dev", "ffm222", "widget-polish")}\` — Widget polish. PR: https://github.com/x/y/pull/2 (merged def5678). Status: done.`,
    "",
  ].join("\n"));
  fxFfm.commitAll("fixture: ffm dialect");

  const rFfm = runCli(["graph", "--format", "json"], fxFfm.root);
  if (rFfm.status !== 0) {
    failures.push(
      `ffm fixture: \`devx graph --format json\` exited ${rFfm.status} — graph CLI / heading tolerance not implemented yet (Phases 1+3): ${(rFfm.stderr || rFfm.stdout).slice(0, 200)}`,
    );
  } else {
    try {
      const m = JSON.parse(rFfm.stdout) as Model;
      const got = blockEdgeSet(m);
      const want = ["ffm222->ffm111"];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures.push(`ffm edge set mismatch — want ${JSON.stringify(want)}, got ${JSON.stringify(got)} (frontmatter-only edges on done rows must be read)`);
      }
      for (const h of ["ffm111", "ffm222"]) {
        const n = m.nodes.find((x) => x.hash === h);
        if (!n || n.group === null) {
          failures.push(`ffm node ${h} not grouped under the \`### <slug> (workstream <hash>)\` heading variant`);
        }
      }
      if (m.warnings.some((w) => w.code === "heading-fallback")) {
        failures.push("ffm heading variant fell back instead of resolving its workstream hash");
      }
    } catch {
      failures.push("ffm fixture: --format json stdout is not pure JSON");
    }
  }

  // ---- palateful-shape ----------------------------------------------
  fxPal.writeSpec({ type: "dev", hash: "pal111", slug: "flow-one", title: "Flow one", status: "ready" });
  fxPal.writeSpec({ type: "dev", hash: "pal222", slug: "flow-two", title: "Flow two", status: "in-progress" });
  // Hyphenated frontmatter key (the palateful drift shape).
  fxPal.writeSpec({ type: "dev", hash: "pal333", slug: "side-one", title: "Side one", status: "ready", fm: ["blocked-by: [pal111]"] });
  // Row and frontmatter disagree.
  fxPal.writeSpec({ type: "dev", hash: "pal444", slug: "side-two", title: "Side two", status: "blocked", fm: ["blocked_by: [pal222]"] });
  fxPal.write("DEV.md", [
    "# DEV",
    "",
    "## Epic — palate-flow (plan: wsp001) — batch 2 of the rebuild",
    "",
    // Prose-only edge: row annotation, no frontmatter.
    row(" ", "dev", "pal111", "flow-one", "Flow one", "ready", ["Blocked-by: pal222."]),
    row("/", "dev", "pal222", "flow-two", "Flow two", "in-progress"),
    "",
    "### Epic — palate-side (plan: wsp002), continued from batch 1",
    "",
    row(" ", "dev", "pal333", "side-one", "Side one", "ready"),
    row("-", "dev", "pal444", "side-two", "Side two", "blocked", ["Blocked-by: pal111."]),
    "",
  ].join("\n"));
  fxPal.commitAll("fixture: palateful dialect");

  const rPal = runCli(["graph", "--format", "json"], fxPal.root);
  if (rPal.status !== 0) {
    failures.push(
      `palateful fixture: \`devx graph --format json\` exited ${rPal.status} — graph CLI / source union not implemented yet: ${(rPal.stderr || rPal.stdout).slice(0, 200)}`,
    );
  } else {
    try {
      const m = JSON.parse(rPal.stdout) as Model;
      const got = blockEdgeSet(m);
      const want = [
        "pal111->pal222", // row-only
        "pal333->pal111", // hyphen-key frontmatter
        "pal444->pal111", // row side of the disagreement
        "pal444->pal222", // frontmatter side of the disagreement
      ].sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures.push(`palateful edge set mismatch — want ${JSON.stringify(want)}, got ${JSON.stringify(got)} (union of row + frontmatter, deduped)`);
      }
      if (!m.warnings.some((w) => w.code === "hyphen-key" && `${w.hash ?? ""} ${w.message}`.includes("pal333"))) {
        failures.push("no hyphen-key normalization warning naming pal333");
      }
      const drift = m.warnings.filter((w) => w.code === "edge-drift");
      if (!drift.some((w) => `${w.hash ?? ""} ${w.message}`.includes("pal444"))) {
        failures.push("no edge-drift warning naming the disagreeing spec pal444");
      }
      for (const h of ["pal111", "pal444"]) {
        if (drift.some((w) => w.hash === h && h !== "pal444")) {
          failures.push(`edge-drift warning fired on ${h}, which does not disagree`);
        }
      }
      for (const h of ["pal111", "pal333"]) {
        const n = m.nodes.find((x) => x.hash === h);
        if (!n || n.group === null) {
          failures.push(`palateful node ${h} not grouped under its prose-suffixed ##/### heading`);
        }
      }
    } catch {
      failures.push("palateful fixture: --format json stdout is not pure JSON");
    }
  }
} finally {
  rmSync(fxFfm.root, { recursive: true, force: true });
  rmSync(fxPal.root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-4 RED — edge-source union / heading tolerance not in place yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-4 GREEN — full edge union recovered from both dialects, both heading variants grouped, hyphen + drift warnings fire precisely.");
