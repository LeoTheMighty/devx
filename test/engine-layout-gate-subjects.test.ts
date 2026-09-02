// E-1 permanent suite (dlr102): a gate resolves its subject through
// `engine.docs_layout` and returns the IDENTICAL verdict for identical
// content in either shape — docs/CONFIG.md §15 rule 5.
//
// The invariant is pinned three ways, because any one of them alone is
// satisfiable by a broken gate:
//
//   (a) Equality — the two layouts agree, for content that is byte-identical
//       and differs only in where it lives.
//   (b) Absolute pins — every one of the 8 layout×gate combinations is PASS
//       on the good fixture and FAIL on a deliberately-broken one. Equality
//       alone goes green the moment a regression breaks BOTH layouts the
//       same way, which is exactly the shape this workstream introduces.
//   (c) Printed-path existence — under `project-level`, every path a gate
//       PRINTS resolves on the fixture disk. A `location:` naming
//       `prd/agent.md` in a repo whose file is `prd.md` is a verdict
//       difference wearing a message's clothes: the gate's `location:` and
//       `message:` fields are part of its OUTPUT contract, not decoration.
//
// The layout is never a gate INPUT — only subject resolution branches on it.
// The pure evaluators receive an already-resolved path and cannot see the
// layout at all; that is what makes (a) structural rather than lucky.
//
// SCOPE — read before trusting a green run here.
//
// These fixtures hand-write `workstream: .` into the plan spec to put the doc
// set at the repo root. NO devx command emits that today: `createWorkstream`
// and the filename-slug fallback both write `<workstreams_root>/<slug>`
// whatever the layout says. So this file evidences the RESOLVER, not a
// configuration a user can currently reach end-to-end — `resolveWorkstream`
// is still layout-blind until dlr103 (plan phase 3, T3.2), and E-4 is
// correctly still RED.
//
// The trap that creates: if dlr103 lands ANY base spelling other than the one
// below, every test here stays green while the real command breaks. The
// spelling is therefore a named constant rather than a literal, and dlr103
// changing it must change it HERE, in one place, on purpose.
//
// Eval: _devx/workstreams/docs-layout-resolution/evals/E-1_gate-subjects.ts
// Spec: dev/dev-dlr102-2026-09-02T09:14-gate-subject-resolution.md

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  runGateCoverage,
  runGateEvalsCli,
  runGatePrd,
} from "../src/commands/gate.js";
import {
  type EngineRepo,
  REAL_REPO_ROOT,
  captureIo,
  makeEngineRepo,
} from "./fixtures/engine-repo.js";

const LAYOUTS = ["workstream", "project-level"] as const;
type Layout = (typeof LAYOUTS)[number];

const HASH = "abc123";
const SLUG = "demo";
const FIXED_NOW = () => new Date(2026, 8, 2, 12, 0, 0);

// ---------------------------------------------------------------------------
// Where each artifact lands, per layout.
//
// Spelled out BY HAND on purpose. Routing this through `stageSubject()` — the
// resolver under test — would make every assertion below tautological: a
// resolver that agreed with itself about a wrong answer would pass. This
// table is the §15 contract transcribed, and it is the control.
// ---------------------------------------------------------------------------

const WS_DIR = "_devx/workstreams/demo";

/** The `workstream:` frontmatter value that puts the doc set at the repo
 *  root. Pinned here because dlr103 must produce exactly this — see the
 *  SCOPE note in the file header for why a different spelling would leave
 *  this whole suite green over a broken command. */
const PROJECT_LEVEL_BASE = ".";

/** Repo-relative workstream dir; the root marker when the doc set IS the
 *  repo root. */
const docSetRel = (layout: Layout): string =>
  layout === "project-level" ? PROJECT_LEVEL_BASE : WS_DIR;

function artifactRel(layout: Layout, kind: string): string {
  const flat = layout === "project-level";
  const under = (p: string) => (flat ? p : `${WS_DIR}/${p}`);
  switch (kind) {
    case "prd":
      return under(flat ? "prd.md" : "prd/agent.md");
    case "design":
      return under(flat ? "design.md" : "design/agent.md");
    case "plan":
      return under(flat ? "plan.md" : "plan/agent.md");
    case "expectations":
      return under("expectations.md");
    case "evals":
      return under("evals");
    default:
      throw new Error(`unknown artifact kind '${kind}'`);
  }
}

// ---------------------------------------------------------------------------
// Content. IDENTICAL across layouts — only the path moves.
// ---------------------------------------------------------------------------

/** Passes Gate 1. `broken` breaks CONTENT, never structure: a structurally
 *  invalid PRD would fail in both layouts for a reason that has nothing to do
 *  with subject resolution, which is the mutual-failure trap (b) closes. */
function prdBody(broken: boolean): string {
  return [
    "# PRD — Demo",
    "",
    "## Problem",
    "",
    "The artifact tree has two shapes and one of them is unimplemented.",
    "",
    "## Goals",
    "",
    "- **G-1**: cut layout-path defects to 0 by 2026-12-31.",
    ...(broken
      ? // An orphan goal: defined, covered by nothing. Content-only, and it
        // reaches the gate identically in both layouts.
        ["- **G-2**: an uncovered goal, so Gate 1 must FAIL."]
      : []),
    "",
    "## Non-goals",
    "",
    "- A third layout.",
    "",
    "## Users",
    "",
    "- A solo author running the engine on one repo.",
    "",
    "## Use cases",
    "",
    "- **UC-1**: An author runs a gate on a flat-layout repo.",
    "",
    "## Capabilities",
    "",
    "- **CAP-1**: Layout-aware subject resolution.",
    "",
    "## Feature requirements",
    "",
    "- **FR-1**: A gate resolves its subject through the layout.",
    "",
  ].join("\n");
}

/** Three E-blocks. `Verified by:` deliberately names an artifact that does
 *  NOT exist — the plan's coverage table names the real one. `gate evals`
 *  prefers the plan row and falls back here only when it cannot read the
 *  plan, so this divergence is what makes the PLAN subject read observable
 *  through the evals gate instead of silently uniform. */
function expectationsBody(): string {
  const block = (n: number, prio: string): string =>
    [
      `## E-${n}: Layout-independent verdict ${n}`,
      "",
      `- **Priority:** ${prio}`,
      "- **Covers:** `G-1, UC-1, CAP-1, FR-1`",
      `- **Trigger:** \`devx gate\` under each layout, run ${n}.`,
      "- **Expectation (EARS):** When a gate runs under either layout, the system SHALL return the identical verdict for identical content.",
      "- **Threshold:** 0 verdict differences across both layouts.",
      `- **Verified by:** \`evals/E-${n}_deferred.mjs\``,
      "",
    ].join("\n");
  return ["# Expectations — Demo", "", block(1, "P0"), block(2, "P1"), block(3, "P1")].join("\n");
}

function designBody(): string {
  return [
    "# Design — Demo",
    "",
    "## Overview",
    "",
    "One resolver owns the layout decision. Covers G-1, UC-1, CAP-1, FR-1.",
    "",
    "## Constraints",
    "",
    "- Layout is never a gate input.",
    "",
  ].join("\n");
}

/** The coverage table `gate evals` reads its targets out of — naming the
 *  artifacts that DO exist (see `expectationsBody`). */
function planBody(): string {
  return [
    "# Plan — Demo",
    "",
    "## Expectation coverage",
    "",
    "| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |",
    "|---|---|---|---|---|---|",
    "| E-1 | P0 | 1 | tests-first | `evals/E-1_real.mjs` | full |",
    "| E-2 | P1 | 1 | tests-first | `evals/E-2_real.mjs` | full |",
    "| E-3 | P1 | 1 | tests-first | `evals/E-3_real.mjs` | full |",
    "",
  ].join("\n");
}

/** The judgment table each coverage mode is handed. Layout-INDEPENDENT input
 *  by construction — it names PRD/E ids, never a stage-subject path. That is
 *  what makes it a fair control: if the layouts disagree, the disagreement
 *  came from subject resolution, not from the judgment. */
function coverageTable(mode: "design" | "plan", broken: boolean): string {
  const rows =
    mode === "design"
      ? ["G-1", "UC-1", "CAP-1", "FR-1"].map((id, i) => ({
          id,
          status: broken && i === 0 ? "missing" : "covered",
          where: "Design §Overview",
        }))
      : ["E-1", "E-2", "E-3"].map((id, i) => ({
          id,
          status: broken && i === 0 ? "missing" : "covered",
          where: "Phase 1",
          artifact: `evals/E-${i + 1}_real.mjs`,
        }));
  return JSON.stringify({ rows });
}

// ---------------------------------------------------------------------------
// Fixture repo.
// ---------------------------------------------------------------------------

type GateName = "prd" | "coverage-design" | "coverage-plan" | "evals";
const GATES: readonly GateName[] = ["prd", "coverage-design", "coverage-plan", "evals"];

function configFor(layout: Layout): string {
  return [
    "mode: YOLO",
    "engine:",
    "  workstreams_root: _devx/workstreams",
    `  docs_layout: ${layout}`,
    "  expectations_min: 3",
    "projects:",
    // ONE project on purpose. Two would let `resolveRunner`'s
    // longest-prefix pick differ by layout, and this test would then be
    // measuring runner selection rather than subject resolution.
    "  - name: cli",
    "    path: .",
    '    test: "node --eval \\"process.exit(1)\\" --"',
    "",
  ].join("\n");
}

/** Stage + gate flags each gate needs to be the NEXT one to run. */
const STAGING: Record<GateName, { stage: string; flags: Record<string, boolean> }> = {
  prd: {
    stage: "prd",
    flags: { prd_validated: false, design_verified: false, plan_verified: false },
  },
  "coverage-design": {
    stage: "design",
    flags: { prd_validated: true, design_verified: false, plan_verified: false },
  },
  "coverage-plan": {
    stage: "plan",
    flags: { prd_validated: true, design_verified: true, plan_verified: false },
  },
  evals: {
    stage: "red",
    flags: { prd_validated: true, design_verified: true, plan_verified: true },
  },
};

function seedRepo(gate: GateName, layout: Layout, broken: boolean): EngineRepo {
  const repo = makeEngineRepo({ config: configFor(layout) });
  const { stage, flags } = STAGING[gate];
  repo.write(
    `plan/plan-${HASH}-2026-09-02T09:00-${SLUG}.md`,
    [
      "---",
      `hash: ${HASH}`,
      "type: plan",
      `title: Fixture ${SLUG}`,
      "status: in-progress",
      `stage: ${stage}`,
      "entered_at: prd",
      "gate_status:",
      ...Object.entries(flags).map(([k, v]) => `  ${k}: ${v}`),
      "  evals_red: false",
      "outcome:",
      "  status: null",
      "  measure_by: null",
      `workstream: ${docSetRel(layout)}`,
      "---",
      "",
      "## Goal",
      "",
      "Fixture.",
      "",
    ].join("\n"),
  );

  const put = (kind: string, body: string): void =>
    repo.write(artifactRel(layout, kind), body);
  put("prd", prdBody(gate === "prd" && broken));
  put("expectations", expectationsBody());
  if (gate !== "prd") put("design", designBody());
  if (gate === "coverage-plan" || gate === "evals") put("plan", planBody());
  if (gate === "evals") {
    for (const n of [1, 2, 3]) {
      repo.write(`${artifactRel(layout, "evals")}/E-${n}_real.mjs`, "process.exit(1);\n");
    }
  }
  return repo;
}

// ---------------------------------------------------------------------------
// Observation.
// ---------------------------------------------------------------------------

/** Repo-relative-looking artifact paths a gate printed.
 *
 *  The first three alternatives mirror the regex in the locked E-1 eval, so
 *  the two surfaces cannot drift on what counts as a path claim. The fourth
 *  is a deliberate WIDENING the eval does not carry: `gate coverage` prints
 *  its verify-report path on success, and "every path a gate prints" should
 *  mean that one too (review AA). The eval's copy is stamped and stays as
 *  it is; this one is free to be stricter. */
const PATH_RE =
  /(?:^|[\s"'`(])((?:[A-Za-z0-9._-]+\/)*(?:prd|design|plan)(?:\/agent)?\.md|(?:[A-Za-z0-9._-]+\/)*expectations\.md|(?:[A-Za-z0-9._-]+\/)*evals\/RED-report\.md|(?:[A-Za-z0-9._-]+\/)*decisions\/[0-9-]+-(?:design|plan)-verify\.md)/g;

interface Observation {
  verdict: string;
  code: number;
  raw: string;
  printedPaths: string[];
}

/** Last JSON object printed on stdout carries the verdict (`gate` field). */
function verdictOf(stdout: string): string {
  let verdict = "UNPARSEABLE";
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const j = JSON.parse(t) as { gate?: string };
      if (typeof j.gate === "string") verdict = j.gate;
    } catch {
      /* not the verdict line */
    }
  }
  return verdict;
}

const repos: EngineRepo[] = [];
afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
});

function observe(gate: GateName, layout: Layout, broken: boolean): Observation {
  const repo = seedRepo(gate, layout, broken);
  repos.push(repo);
  const io = captureIo();
  const common = { ...io, projectPath: repo.configPath, now: FIXED_NOW };
  let code: number;
  if (gate === "prd") {
    code = runGatePrd([HASH], common);
  } else if (gate === "evals") {
    code = runGateEvalsCli([HASH], {}, {
      ...common,
      // Seam, not a real subprocess. `broken` = the P0 eval PASSES, i.e. it
      // was never RED — the gate-evals failure this gate exists to catch.
      exec: () => ({ stdout: "", stderr: "", exitCode: broken ? 0 : 1 }),
    });
  } else {
    const mode = gate === "coverage-design" ? "design" : "plan";
    repo.write("table.json", coverageTable(mode, broken));
    code = runGateCoverage([HASH], { table: join(repo.root, "table.json") }, common);
  }
  const raw = `${io.stdout()}\n${io.stderr()}`;
  return {
    verdict: verdictOf(io.stdout()),
    code,
    raw,
    printedPaths: [...raw.matchAll(PATH_RE)].map((m) => m[1]),
  };
}

// ---------------------------------------------------------------------------
// The 8 combinations.
// ---------------------------------------------------------------------------

describe("gate subject resolution — 8 layout×gate combinations", () => {
  for (const gate of GATES) {
    for (const broken of [false, true]) {
      const fixture = broken ? "broken" : "good";
      const expected = broken ? "FAIL" : "PASS";

      it(`${gate}: both layouts return ${expected} on the ${fixture} fixture`, () => {
        const seen = LAYOUTS.map((layout) => ({
          layout,
          obs: observe(gate, layout, broken),
        }));

        // (b) Absolute pin — the leg that survives a both-layouts regression.
        for (const { layout, obs } of seen) {
          expect(
            { layout, verdict: obs.verdict, exit: obs.code },
            `${gate} under '${layout}' (${fixture}): ${obs.raw.trim().slice(0, 400)}`,
          ).toEqual({ layout, verdict: expected, exit: broken ? 1 : 0 });
        }

        // (a) Equality — content is byte-identical; only the path moved.
        expect(seen[0].obs.verdict).toBe(seen[1].obs.verdict);
        expect(seen[0].obs.code).toBe(seen[1].obs.code);
      });
    }
  }
});

describe("gate output contract — project-level prints only paths that exist", () => {
  for (const gate of GATES) {
    for (const broken of [false, true]) {
      const fixture = broken ? "broken" : "good";

      it(`${gate} (${fixture}) names no folder-layout path under project-level`, () => {
        const obs = observe(gate, "project-level", broken);
        const repo = repos[repos.length - 1];
        const printed = [...new Set(obs.printedPaths)];
        const missing = printed.filter(
          (p) => !existsSync(join(repo.root, ...p.replace(/^\.\//, "").split("/"))),
        );
        expect(
          missing,
          `printed under project-level but absent on disk — the output contract still names the folder layout. Raw: ${obs.raw.trim().slice(0, 400)}`,
        ).toEqual([]);
        // The existence check ALONE cannot see the regression this phase
        // closes. `path.join` collapses a leading `./`, so a re-introduced
        // `${workstreamRel}/${PRD_REL}` — which yields exactly `./prd.md`
        // under project-level, the bug named at gate.ts's gate-input-missing
        // comment — resolves on disk and passes (review EC-1). The spelling
        // is the assertion, not just the resolution.
        expect(
          printed.filter((p) => p.startsWith("./")),
          "a printed path is `./`-prefixed — the base is being re-joined onto an already-resolved rel",
        ).toEqual([]);
      });
    }
  }
});

// The three refusal strings AC 3 exists to fix are on paths no verdict
// combination reaches: they need a doc set with its artifacts MISSING, and
// every fixture above authors them. Reached explicitly here, under
// project-level, because that is the layout their old `${workstreamRel}/`
// prefix lied in (review EC-1).
describe("gate refusals name the resolved subject, not a re-joined base", () => {
  /** A repo whose doc set exists but holds none of the Gate-1 inputs. */
  function bareRepo(layout: Layout, flags: Record<string, boolean>): EngineRepo {
    const repo = makeEngineRepo({ config: configFor(layout) });
    repos.push(repo);
    repo.write(
      `plan/plan-${HASH}-2026-09-02T09:00-${SLUG}.md`,
      [
        "---",
        `hash: ${HASH}`,
        "type: plan",
        "status: in-progress",
        "stage: prd",
        "gate_status:",
        ...Object.entries(flags).map(([k, v]) => `  ${k}: ${v}`),
        `workstream: ${docSetRel(layout)}`,
        "---",
        "",
      ].join("\n"),
    );
    if (docSetRel(layout) !== ".") repo.mkdir(docSetRel(layout));
    return repo;
  }

  it("gate prd's gate-input-missing names prd.md, never ./prd/agent.md", () => {
    for (const layout of LAYOUTS) {
      const repo = bareRepo(layout, {
        prd_validated: false,
        design_verified: false,
        plan_verified: false,
        evals_red: false,
      });
      const io = captureIo();
      const code = runGatePrd([HASH], {
        ...io,
        projectPath: repo.configPath,
        now: FIXED_NOW,
      });
      expect(code).toBe(1);
      const gaps = (JSON.parse(io.stdout().trim()) as {
        gaps: Array<{ message: string }>;
      }).gaps;
      expect(gaps).toHaveLength(2);
      expect(gaps[0].message).toContain(`${artifactRel(layout, "prd")} does not exist`);
      expect(gaps[1].message).toContain(
        `${artifactRel(layout, "expectations")} does not exist`,
      );
      for (const g of gaps) expect(g.message.startsWith("./")).toBe(false);
    }
  });

  it("gate evals' missing-expectations refusal names the resolved subject", () => {
    for (const layout of LAYOUTS) {
      // plan_verified true with no expectations on disk — the inconsistent
      // state that refusal exists to report.
      const repo = bareRepo(layout, {
        prd_validated: true,
        design_verified: true,
        plan_verified: true,
        evals_red: false,
      });
      const io = captureIo();
      const code = runGateEvalsCli([HASH], {}, {
        ...io,
        projectPath: repo.configPath,
        now: FIXED_NOW,
      });
      expect(code).toBe(2);
      expect(io.stderr()).toContain(
        `${artifactRel(layout, "expectations")} not found`,
      );
      expect(io.stderr()).not.toContain("./expectations.md");
    }
  });

  it("gate evals' unknown-waiver refusal names the resolved subject", () => {
    for (const layout of LAYOUTS) {
      const repo = bareRepo(layout, {
        prd_validated: true,
        design_verified: true,
        plan_verified: true,
        evals_red: false,
      });
      repo.write(artifactRel(layout, "expectations"), expectationsBody());
      const io = captureIo();
      const code = runGateEvalsCli(
        [HASH],
        { waive: ["E-9"], reason: "not real", approver: "qa" },
        { ...io, projectPath: repo.configPath, now: FIXED_NOW },
      );
      expect(code).toBe(2);
      expect(io.stderr()).toContain(
        `no such expectation in ${artifactRel(layout, "expectations")}`,
      );
      expect(io.stderr()).not.toContain("./expectations.md");
    }
  });
});

// The check above is satisfied vacuously by a run that prints no path at
// all — and a PASSING gate legitimately prints none. These two pin the
// positive: where a gate DOES name its subject, the name is the resolved
// one. Without them the whole output-contract leg could go green by the
// gates falling silent.
describe("gate output contract — the resolved subject is what gets named", () => {
  it("gate prd's gaps carry the layout's own spelling", () => {
    const flat = observe("prd", "project-level", true);
    const folder = observe("prd", "workstream", true);

    const locations = (raw: string): string[] =>
      (JSON.parse(raw.trim().split("\n")[0]) as { gaps: Array<{ location?: string }> }).gaps
        .map((g) => g.location)
        .filter((l): l is string => l !== undefined);

    // Same content, same gap, two spellings — each one its repo's real file.
    expect(locations(flat.raw).every((l) => l.startsWith("prd.md"))).toBe(true);
    expect(
      locations(folder.raw).every((l) => l.startsWith(`${WS_DIR}/prd/agent.md`)),
    ).toBe(true);
    expect(locations(flat.raw).length).toBeGreaterThan(0);
    expect(locations(flat.raw).length).toBe(locations(folder.raw).length);
  });

  it("gate coverage's verify report names the layout's own subject", () => {
    for (const layout of LAYOUTS) {
      observe("coverage-design", layout, false);
      const repo = repos[repos.length - 1];
      const reportRel = `${docSetRel(layout) === "." ? "" : `${docSetRel(layout)}/`}decisions/2026-09-02-design-verify.md`;
      const report = repo.read(reportRel);
      expect(report).toContain(`\`${artifactRel(layout, "design")}\``);
      expect(report).toContain(`\`${artifactRel(layout, "prd")}\``);
      // And the file it names is really there.
      for (const kind of ["design", "prd"]) {
        expect(repo.exists(artifactRel(layout, kind))).toBe(true);
      }
    }
  });

  it("the committed records land where the layout says, and title themselves", () => {
    for (const layout of LAYOUTS) {
      // evals writes its own report before printing the path, so
      // `existsSync` on what it printed is true wherever it resolved — the
      // check proves resolution only if the EXPECTED location is named
      // independently (review EC-LOW1).
      observe("evals", layout, false);
      const repo = repos[repos.length - 1];
      const redRel =
        docSetRel(layout) === "."
          ? "evals/RED-report.md"
          : `${docSetRel(layout)}/evals/RED-report.md`;
      expect(repo.exists(redRel), `RED report absent at ${redRel}`).toBe(true);

      // A title of `.` is a true path and a useless record heading.
      const label = docSetRel(layout) === "." ? "<repo root>" : docSetRel(layout);
      expect(repo.read(redRel)).toContain(`# RED report — ${label} —`);
    }
  });

  it("the verify report titles itself with the doc set, never a bare dot", () => {
    for (const layout of LAYOUTS) {
      observe("coverage-design", layout, false);
      const repo = repos[repos.length - 1];
      const reportRel = `${docSetRel(layout) === "." ? "" : `${docSetRel(layout)}/`}decisions/2026-09-02-design-verify.md`;
      const label = docSetRel(layout) === "." ? "<repo root>" : docSetRel(layout);
      expect(repo.read(reportRel)).toContain(`# Verify — ${label} —`);
      expect(repo.read(reportRel)).not.toContain("# Verify — . —");
    }
  });

  it("gate coverage's refusal names the subject the author must go write", () => {
    for (const layout of LAYOUTS) {
      const repo = makeEngineRepo({ config: configFor(layout) });
      repos.push(repo);
      repo.write(
        `plan/plan-${HASH}-2026-09-02T09:00-${SLUG}.md`,
        [
          "---",
          `hash: ${HASH}`,
          "type: plan",
          "status: in-progress",
          "stage: design",
          "gate_status:",
          "  prd_validated: true",
          "  design_verified: false",
          "  plan_verified: false",
          "  evals_red: false",
          `workstream: ${docSetRel(layout)}`,
          "---",
          "",
        ].join("\n"),
      );
      // The doc set exists; the design artifact does not. Under
      // `project-level` the doc set IS the repo root, already there.
      if (docSetRel(layout) !== ".") repo.mkdir(docSetRel(layout));
      // No design artifact anywhere: the gate must refuse, naming the file
      // THIS repo would have had.
      const io = captureIo();
      const code = runGateCoverage([HASH], {}, {
        ...io,
        projectPath: repo.configPath,
        now: FIXED_NOW,
      });
      expect(code).toBe(1);
      expect(io.stdout()).toContain(artifactRel(layout, "design"));
    }
  });
});

// ---------------------------------------------------------------------------
// The layout is never a gate INPUT (AC 5).
// ---------------------------------------------------------------------------
//
// The behavioral legs above prove the two layouts AGREE. This one proves WHY
// they must: the pure evaluators cannot see the layout, so there is no branch
// in them that could ever disagree. Without it, a future change could
// reintroduce a layout branch inside a gate body and every test above would
// still pass — until the day the two branches drifted.

const EVALUATOR_MODULES = [
  "src/lib/engine/gate-prd.ts",
  "src/lib/engine/gate-coverage.ts",
  "src/lib/engine/gate-evals.ts",
];

/** Import statements only. Scanning whole files would flag the doc comments
 *  that EXPLAIN the contract, which is the opposite of what we want: a
 *  module is layout-blind when it does not IMPORT the layout, not when it
 *  declines to mention it. */
function importedSymbols(rel: string): string {
  const src = readFileSync(join(REAL_REPO_ROOT, ...rel.split("/")), "utf8");
  return [...src.matchAll(/^import\s[\s\S]*?from\s+"[^"]+";$/gm)]
    .map((m) => m[0])
    .join("\n");
}

describe("the layout is never a gate input", () => {
  for (const rel of EVALUATOR_MODULES) {
    it(`${rel} imports no layout symbol`, () => {
      const imports = importedSymbols(rel);
      expect(imports).not.toMatch(/DocsLayout|docsLayout|resolveDocsLayout/);
      expect(imports).not.toMatch(/stageSubject|ArtifactKind|StageSubject/);
    });
  }

  it("the evaluators take their subject spellings as inputs, not constants", () => {
    // The corollary: a gate that stopped taking the resolved path would have
    // to go back to a `*_REL` constant, and that is the regression this
    // phase closes. Neither evaluator may reach for one again.
    for (const rel of ["src/lib/engine/gate-prd.ts", "src/lib/engine/gate-coverage.ts"]) {
      const imports = importedSymbols(rel);
      expect(imports, `${rel} re-imported a hardcoded subject path`).not.toMatch(
        /\bPRD_REL\b|\bDESIGN_REL\b|\bPLAN_REL\b|\bEXPECTATIONS_REL\b/,
      );
    }
  });
});
