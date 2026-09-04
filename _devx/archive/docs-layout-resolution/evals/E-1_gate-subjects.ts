// E-1 (P0): a gate resolves its subject through the layout (G-1, G-4, UC-2,
// CAP-1, FR-1). RED until Phase 2 merges. Runnable standalone: `npx tsx <this file>`.
//
// Threshold: all four gates (prd, coverage×design, coverage×plan, evals) run
// on BYTE-IDENTICAL subject content under both layouts — 8 combinations, 0
// verdict differences.
//
// Equality alone is not the assertion. An equality-only check goes green the
// moment a regression breaks BOTH layouts identically, which is exactly the
// shape this workstream is about to introduce. So every combination is pinned
// to an absolute verdict as well: PASS on the good fixture, FAIL on a
// deliberately-broken one. Plus: every path a project-level gate PRINTS must
// exist on the fixture disk — a `location:` naming prd/agent.md in a repo
// whose file is prd.md is a verdict difference wearing a message's clothes.

import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LAYOUTS,
  type Layout,
  assertRan,
  mkWorkstreamFixture,
  repoRoot,
  runCli,
  type WsFixture,
} from "./_fixture.js";

const failures: string[] = [];

/** An eval artifact that exits nonzero — a RED expectation, as gate evals
 *  requires of every P0. Its GREEN twin is what "broken" means for that gate. */
const RED_EVAL = "process.exit(1);\n";
const GREEN_EVAL = "process.exit(0);\n";

type GateName = "prd" | "coverage-design" | "coverage-plan" | "evals";
const GATES: GateName[] = ["prd", "coverage-design", "coverage-plan", "evals"];

/** Build the fixture each gate needs, staged so that gate is the NEXT one. */
function fixtureFor(gate: GateName, layout: Layout, broken: boolean): WsFixture {
  const prefix = `e1-${gate}-${layout === "project-level" ? "flat" : "ws"}`;
  // "Broken" is gate-specific: each gate gets content IT must fail on, and
  // that content is identical across layouts. A single global break would
  // leave three of the four gates failing for a reason they do not own.
  const common = {
    prefix,
    layout,
    brokenPrd: gate === "prd" && broken,
    withDocs: true,
  } as const;
  switch (gate) {
    case "prd":
      return mkWorkstreamFixture({ ...common, stage: "prd" });
    case "coverage-design":
      return mkWorkstreamFixture({
        ...common,
        stage: "design",
        withDesign: true,
        gateStatus: {
          prd_validated: true,
          design_verified: false,
          plan_verified: false,
          evals_red: false,
        },
      });
    case "coverage-plan":
      return mkWorkstreamFixture({
        ...common,
        stage: "plan",
        withDesign: true,
        withPlan: true,
        gateStatus: {
          prd_validated: true,
          design_verified: true,
          plan_verified: false,
          evals_red: false,
        },
      });
    case "evals":
      return mkWorkstreamFixture({
        ...common,
        stage: "red",
        withDesign: true,
        withPlan: true,
        evalArtifacts: {
          // Broken = the P0 eval passes, i.e. it was never RED. That is the
          // gate-evals failure this gate exists to catch.
          "E-1_fixture.ts": broken ? GREEN_EVAL : RED_EVAL,
          "E-2_fixture.ts": RED_EVAL,
          "E-3_fixture.ts": RED_EVAL,
        },
        gateStatus: {
          prd_validated: true,
          design_verified: true,
          plan_verified: true,
          evals_red: false,
        },
      });
  }
}

/** The coverage --table the gate needs, matched to the mode. Written outside
 *  the fixture repo so it never perturbs `git status`.
 *
 *  The table is layout-INDEPENDENT input by construction — it names PRD/E ids
 *  and eval artifacts, never a stage-subject path. That is what makes it a
 *  fair control: if the two layouts disagree, the disagreement came from
 *  subject resolution, not from the judgment handed to the gate. */
function coverageTable(
  gate: "coverage-design" | "coverage-plan",
  dir: string,
  broken: boolean,
): string {
  const rows =
    gate === "coverage-design"
      ? [
          { id: "G-1", status: broken ? "\u274c" : "\u2705", where: broken ? "" : "Design \u00a7 Overview", note: "" },
          { id: "UC-1", status: "\u2705", where: "Design \u00a7 Overview", note: "" },
          { id: "CAP-1", status: "\u2705", where: "Design \u00a7 The resolver", note: "" },
          { id: "FR-1", status: "\u2705", where: "Design \u00a7 The resolver", note: "" },
        ]
      : [
          {
            id: "E-1",
            status: broken ? "\u274c" : "\u2705",
            where: "Phase 1",
            artifact: "evals/E-1_fixture.ts",
            note: "",
          },
          { id: "E-2", status: "\u2705", where: "Phase 1", artifact: "evals/E-2_fixture.ts", note: "" },
          { id: "E-3", status: "\u2705", where: "Phase 1", artifact: "evals/E-3_fixture.ts", note: "" },
        ];
  const p = join(dir, `${gate}-${broken ? "broken" : "good"}.json`);
  writeFileSync(p, JSON.stringify({ rows }));
  return p;
}

interface Observation {
  verdict: string;
  raw: string;
  status: number;
  /** Repo-relative paths the gate printed. */
  printedPaths: string[];
}

const PATH_RE =
  /(?:^|[\s"'`(])((?:[A-Za-z0-9._-]+\/)*(?:prd|design|plan)(?:\/agent)?\.md|(?:[A-Za-z0-9._-]+\/)*expectations\.md|(?:[A-Za-z0-9._-]+\/)*evals\/RED-report\.md)/g;

function observe(
  gate: GateName,
  fx: WsFixture,
  tableDir: string,
  broken: boolean,
): Observation | null {
  const args: string[] =
    gate === "prd"
      ? ["gate", "prd", fx.hash]
      : gate === "evals"
        ? ["gate", "evals", fx.hash]
        : ["gate", "coverage", fx.hash, "--table", coverageTable(gate, tableDir, broken)];

  const res = runCli(args, fx.root);
  const infra = assertRan(res, `devx ${args.join(" ")}`);
  if (infra !== null) {
    failures.push(`${gate}/${fx.layout}: ${infra}`);
    return null;
  }
  const raw = `${res.stdout}\n${res.stderr}`;
  let verdict = "UNPARSEABLE";
  for (const line of res.stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const j = JSON.parse(t) as { gate?: string };
      if (typeof j.gate === "string") verdict = j.gate;
    } catch {
      /* not the verdict line */
    }
  }
  const printedPaths = [...raw.matchAll(PATH_RE)].map((m) => m[1]);
  return { verdict, raw, status: res.status, printedPaths };
}

const tableDir = mkdtempSync(join(tmpdir(), "e1-tables-"));

for (const gate of GATES) {
  for (const broken of [false, true]) {
    const expected = broken ? "FAIL" : "PASS";
    const seen: Partial<Record<Layout, Observation>> = {};
    const built: WsFixture[] = [];
    try {
      for (const layout of LAYOUTS) {
        const fx = fixtureFor(gate, layout, broken);
        built.push(fx);
        const obs = observe(gate, fx, tableDir, broken);
        if (obs === null) continue;
        seen[layout] = obs;

        // Absolute pin — the leg that survives a both-layouts regression.
        if (obs.verdict !== expected) {
          failures.push(
            `${gate} under '${layout}' (${broken ? "broken" : "good"} fixture) returned ${obs.verdict}, expected ${expected} — exit ${obs.status}: ${obs.raw.trim().slice(0, 300)}`,
          );
        }

        // Every printed path must exist. Under project-level a gate that
        // still prints `prd/agent.md` names a file that is not there.
        if (layout === "project-level") {
          for (const p of new Set(obs.printedPaths)) {
            const norm = p.replace(/^\.\//, "");
            if (!existsSync(join(fx.root, ...norm.split("/")))) {
              failures.push(
                `${gate} under 'project-level' (${broken ? "broken" : "good"}) printed '${p}', which does not exist on the fixture disk — the gate's output contract still names the folder layout`,
              );
            }
          }
        }
      }

      const a = seen.workstream;
      const b = seen["project-level"];
      if (a && b && a.verdict !== b.verdict) {
        failures.push(
          `${gate} (${broken ? "broken" : "good"} fixture): verdict differs by layout — workstream=${a.verdict}, project-level=${b.verdict}. Content is byte-identical; only the path moved.`,
        );
      }
    } finally {
      for (const fx of built) fx.cleanup();
    }
  }
}

rmSync(tableDir, { recursive: true, force: true });

// The invariant must also be pinned in the default suite, not only here.
if (!existsSync(join(repoRoot, "test", "engine-layout-gate-subjects.test.ts"))) {
  failures.push(
    "test/engine-layout-gate-subjects.test.ts missing — the 8-combination verdict-equality invariant is not pinned in `npm test` (feature missing, T2.1)",
  );
}

if (failures.length > 0) {
  console.error("E-1 RED — gates do not resolve their subject through the layout:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-1 GREEN — all 8 layout×gate combinations agree, are pinned absolutely, and print only paths that exist.",
);
