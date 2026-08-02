// E-6 (P0): backfill is mechanical-first, adds-only, idempotent (G-2,
// UC-4, CAP-5, FR-5). RED until Phase 6 merges. Runnable standalone:
// `npx tsx <this file>`.
//
// One fixture combining the audited dialect shapes from E-4 plus: a
// workstream reachable only via dev-spec `from:` (no PLAN.md row), a
// workstream dir with no plan.md, a non-directory file inside the
// workstreams root, and one spec whose ordering is mechanically
// underivable. Runs `devx graph backfill` with --dry-run first (0 writes,
// report still printed), then for real (missing edge sides written in
// canonical `blocked_by` underscore form, derived edges from durable
// state, underivable reported, nothing deleted), then a second time
// (0-file no-op).
// Permanent suite: test/graph-backfill.test.ts.

import { rmSync } from "node:fs";
import { git, mkFx, row, runCli, specRel } from "./_fixture.js";

const failures: string[] = [];
const fx = mkFx({ prefix: "e6-backfill" });

/** Frontmatter block of a spec file. */
function fm(rel: string): string {
  const m = /^---\n([\s\S]*?)\n---/.exec(fx.read(rel));
  return m ? m[1] : "";
}

try {
  const relPal111 = fx.writeSpec({ type: "dev", hash: "pal111", slug: "flow-one", title: "Flow one", status: "ready" });
  fx.writeSpec({ type: "dev", hash: "pal222", slug: "flow-two", title: "Flow two", status: "in-progress" });
  const relPal333 = fx.writeSpec({ type: "dev", hash: "pal333", slug: "side-one", title: "Side one", status: "ready", fm: ["blocked-by: [pal111]"] });
  const relPal444 = fx.writeSpec({ type: "dev", hash: "pal444", slug: "side-two", title: "Side two", status: "blocked", fm: ["blocked_by: [pal222]"] });
  fx.writeSpec({ type: "dev", hash: "ffm111", slug: "widget-core", title: "Widget core", status: "done" });
  const relFfm222 = fx.writeSpec({ type: "dev", hash: "ffm222", slug: "widget-polish", title: "Widget polish", status: "done", fm: ["blocked_by: [ffm111]"] });
  // Derived-ordering workstream (phase: frontmatter is the durable signal).
  const wsSteps = "_devx/workstreams/ws-steps";
  fx.write(`${wsSteps}/plan.md`, "# Plan — ws-steps\n");
  fx.writeSpec({ type: "dev", hash: "stp111", slug: "step-one", title: "Step one", status: "done", fm: [`plan: ${wsSteps}`, "phase: 1"] });
  const relStp222 = fx.writeSpec({ type: "dev", hash: "stp222", slug: "step-two", title: "Step two", status: "ready", fm: [`plan: ${wsSteps}`, "phase: 2"] });
  // Workstream reachable only via `from:` — no PLAN.md row anywhere.
  const wsOrphan = "_devx/workstreams/ws-orphan";
  fx.write(`${wsOrphan}/plan.md`, "# Plan — ws-orphan\n\nOrdering lives in narrative prose only.\n");
  fx.writeSpec({ type: "dev", hash: "orp111", slug: "orphan-one", title: "Orphan one", status: "ready", fm: [`from: ${wsOrphan}/plan.md`, "phase: 1"] });
  // Mechanically underivable ordering: same workstream, no phase, no pointers.
  fx.writeSpec({ type: "dev", hash: "und111", slug: "orphan-und", title: "Orphan und", status: "ready", fm: [`from: ${wsOrphan}/plan.md`] });
  // Workstream dir with no plan.md + a non-directory file in the root.
  fx.write("_devx/workstreams/ws-noplan/todo.md", "# Todo — ws-noplan\n");
  fx.write("_devx/workstreams/notes.md", "stray non-workstream file\n");

  const pal444Row = row("-", "dev", "pal444", "side-two", "Side two", "blocked", ["Blocked-by: pal111."]);
  fx.write("DEV.md", [
    "# DEV",
    "",
    "### ffm-widget (workstream wsf001)",
    "",
    `- [x] \`${specRel("dev", "ffm111", "widget-core")}\` — Widget core. PR: https://github.com/x/y/pull/1 (merged abc1234). Status: done.`,
    `- [x] \`${specRel("dev", "ffm222", "widget-polish")}\` — Widget polish. PR: https://github.com/x/y/pull/2 (merged def5678). Status: done.`,
    "",
    "## Epic — palate-flow (plan: wsp001) — batch 2 of the rebuild",
    "",
    row(" ", "dev", "pal111", "flow-one", "Flow one", "ready", ["Blocked-by: pal222."]),
    row("/", "dev", "pal222", "flow-two", "Flow two", "in-progress"),
    row(" ", "dev", "pal333", "side-one", "Side one", "ready"),
    pal444Row,
    "",
    "## Steps and orphans",
    "",
    row("x", "dev", "stp111", "step-one", "Step one", "done"),
    row(" ", "dev", "stp222", "step-two", "Step two", "ready"),
    row(" ", "dev", "orp111", "orphan-one", "Orphan one", "ready"),
    row(" ", "dev", "und111", "orphan-und", "Orphan und", "ready"),
    "",
  ].join("\n"));
  fx.commitAll("fixture: drifted board");

  // ---- dry-run: report, zero writes ----------------------------------
  const dry = runCli(["graph", "backfill", "--dry-run"], fx.root);
  if (dry.status !== 0) {
    failures.push(
      `\`devx graph backfill --dry-run\` exited ${dry.status} — backfill is not implemented yet (Phase 6, T6.5): ${(dry.stderr || dry.stdout).slice(0, 200)}`,
    );
  } else {
    if (git(fx.root, "status", "--porcelain").trim() !== "") {
      failures.push("--dry-run wrote files (working tree dirty after dry-run)");
    }
    if (!dry.stdout.includes("und111")) {
      failures.push("--dry-run report does not list the underivable spec und111");
    }
  }

  // ---- real run: adds-only completion --------------------------------
  const run1 = runCli(["graph", "backfill"], fx.root);
  if (run1.status !== 0) {
    failures.push(
      `\`devx graph backfill\` exited ${run1.status} on the drifted fixture (expected 0): ${(run1.stderr || run1.stdout).slice(0, 200)}`,
    );
  } else {
    // Prose-only row edge → frontmatter, canonical underscore form.
    if (!/blocked_by:/.test(fm(relPal111)) || !fm(relPal111).includes("pal222")) {
      failures.push("pal111's row-only edge (→ pal222) was not written to frontmatter in canonical blocked_by form");
    }
    // Hyphen key normalized to underscore.
    const f333 = fm(relPal333);
    if (!/blocked_by:/.test(f333) || !f333.includes("pal111")) {
      failures.push("pal333's hyphenated blocked-by: key was not normalized to canonical blocked_by form");
    }
    // Disagreeing spec: union written to both sides.
    const f444 = fm(relPal444);
    if (!f444.includes("pal111") || !f444.includes("pal222")) {
      failures.push("pal444's frontmatter does not carry the full edge union (pal111 + pal222)");
    }
    const dev = fx.read("DEV.md");
    const pal444Line = dev.split("\n").find((l) => l.includes("pal444")) ?? "";
    if (!pal444Line.includes("pal222")) {
      failures.push("pal444's live Blocked-by-bearing row did not receive the missing edge (pal222)");
    }
    // ffm done rows: frontmatter only — the done row must NOT grow prose.
    const ffm222Line = dev.split("\n").find((l) => l.includes("ffm222")) ?? "";
    if (/Blocked-by:/i.test(ffm222Line)) {
      failures.push("backfill wrote a Blocked-by annotation onto an ffm done row (must be frontmatter-only)");
    }
    if (!fm(relFfm222).includes("ffm111")) {
      failures.push("backfill deleted ffm222's existing frontmatter edge (adds-only violated)");
    }
    // Derived edge from durable phase: ordering.
    const f222 = fm(relStp222);
    if (!/blocked_by:/.test(f222) || !f222.includes("stp111")) {
      failures.push("phase-ordering edge stp222 → stp111 was not derived from durable `phase:` frontmatter");
    }
    // Adds-only: the original row annotation survives.
    const pal111Line = dev.split("\n").find((l) => l.includes("pal111") && l.includes("`dev/")) ?? "";
    if (!pal111Line.includes("pal222")) {
      failures.push("pal111's original row Blocked-by annotation was deleted (adds-only violated)");
    }
    // Underivable reported, not guessed.
    if (!run1.stdout.includes("und111")) {
      failures.push("backfill report does not list the underivable spec und111");
    }
    if (fm(`dev/dev-und111-2026-08-01T08:00-orphan-und.md`).includes("orp111")) {
      failures.push("backfill guessed an ordering edge for und111 instead of reporting it");
    }

    // ---- second run: 0-file no-op ------------------------------------
    fx.commitAll("fixture: after backfill");
    const run2 = runCli(["graph", "backfill"], fx.root);
    if (run2.status !== 0) {
      failures.push(`second \`devx graph backfill\` exited ${run2.status}`);
    } else if (git(fx.root, "status", "--porcelain").trim() !== "") {
      failures.push("second backfill run changed files (not idempotent):\n" + git(fx.root, "status", "--porcelain"));
    }
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-6 RED — backfill is not implemented (or not adds-only/idempotent):");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-6 GREEN — mechanical union written canonically, underivable reported, 0 deletions, second run a 0-file no-op.");
