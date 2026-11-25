// `devx workstream split` / `devx workstream combine` (D-18).
//
// The claims that matter are about what was NOT written. A refusal is held to
// byte-identity of the whole fixture tree — "exit 1" and "wrote nothing" are
// different claims, and only the second is the guarantee (the idiom is
// `test/gate-closed-rerun.test.ts`'s). The happy paths are held to the gate
// claims: no child, and no survivor, ends up with a verdict covering work no
// gate examined, and the only way forward is the gates themselves.

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import { runGatePrd } from "../src/commands/gate.js";
import { runRevise } from "../src/commands/revise.js";
import { runWorkstreamCombine, runWorkstreamSplit } from "../src/commands/workstream-lifecycle.js";
import { SETTLED_STATUSES as GRAPH_SETTLED } from "../src/lib/graph/model.js";
import {
  applyEnginePatch,
  readBlockedByAllSpellings,
  readEngineState,
} from "../src/lib/engine/frontmatter.js";
import { parseExpectations } from "../src/lib/engine/expectations.js";
import { donePhasesFor } from "../src/lib/engine/gate-evals.js";
import { evaluateGatePrd } from "../src/lib/engine/gate-prd.js";
import { SETTLED_STATUSES, sliceExpectations } from "../src/lib/engine/lifecycle.js";
import { type EngineRepo, captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXED_NOW = () => new Date(2026, 10, 24, 10, 30, 0);
const TODAY = "2026-11-24";
const PARTITION = "partition.json"; // the caller's input: outside the snapshot

interface WsSpec {
  hash: string;
  slug: string;
  stage?: string;
  status?: string;
  flags?: Partial<Record<"prd_validated" | "design_verified" | "plan_verified" | "evals_red", boolean>>;
  verdicts?: Record<string, string>;
  extraFm?: string[];
}

const specRel = (w: WsSpec) => `plan/plan-${w.hash}-2026-11-20T09:00-${w.slug}.md`;
const wsRel = (w: WsSpec) => `_devx/workstreams/${w.slug}`;

const PARENT: WsSpec = {
  hash: "abc123",
  slug: "demo-feature",
  stage: "design",
  flags: { prd_validated: true },
  verdicts: { prd: "PASS" },
};
const SURVIVOR: WsSpec = {
  hash: "aaa111",
  slug: "alpha",
  stage: "plan",
  flags: { prd_validated: true, design_verified: true },
  verdicts: { prd: "PASS", design: "PASS" },
};
const ABSORBED: WsSpec = {
  hash: "bbb222",
  slug: "beta",
  stage: "design",
  flags: { prd_validated: true },
  verdicts: { prd: "CONCERNS" },
};

function specText(w: WsSpec): string {
  const f = { prd_validated: false, design_verified: false, plan_verified: false, evals_red: false, ...w.flags };
  return [
    "---",
    `hash: ${w.hash}`,
    "type: plan",
    `title: ${w.slug}`,
    `status: ${w.status ?? "in-progress"}`,
    `stage: ${w.stage ?? "prd"}`,
    "entered_at: prd",
    "gate_status:",
    ...Object.entries(f).map(([k, v]) => `  ${k}: ${v}`),
    ...(w.verdicts ? ["gate_verdicts:", ...Object.entries(w.verdicts).map(([k, v]) => `  ${k}: ${v}`)] : []),
    "outcome:",
    "  status: null",
    "  measure_by: null",
    `workstream: ${wsRel(w)}`,
    ...(w.extraFm ?? []),
    "---",
    "",
    "## Goal",
    "",
    "demo.",
    "",
    "## Status log",
    "",
    "- 2026-11-20T09:00 — created.",
    "",
  ].join("\n");
}

/** A PRD defining exactly `ids` (G-/UC-/CAP-/FR-), with every required
 *  section real — the PRD a child's author writes before Gate 1. */
function prdDefining(title: string, ids: string[]): string {
  const of = (p: string) => ids.filter((i) => i.startsWith(`${p}-`));
  return [
    `# PRD — ${title}`,
    "",
    "## Problem",
    "",
    "Scope creep goes unnoticed and reviews stall.",
    "",
    "## Goals",
    "",
    ...of("G").map((i) => `- **${i}**: maintainers see scope drift before merge`),
    "",
    "## Non-goals",
    "",
    "- Rewriting CI.",
    "",
    "## Users",
    "",
    "- **Primary**: solo maintainer",
    "",
    "## Use cases",
    "",
    ...of("UC").map((i) => `- **${i}**: maintainer reviews a change`),
    "",
    "## Capabilities",
    "",
    ...of("CAP").map((i) => `- **${i}**: diff classification`),
    "",
    "## Feature requirements",
    "",
    ...of("FR").flatMap((i) => [`### ${i}: requirement`, "", "Flags undeclared surfaces.", ""]),
  ].join("\n");
}

const PARENT_IDS = ["G-1", "G-2", "UC-1", "UC-2", "CAP-1", "CAP-2", "FR-1", "FR-2"];

function eBlock(id: string, name: string, priority: string, covers: string, verifiedBy: string): string {
  return [
    `## ${id}: ${name}`,
    "",
    `- **Priority:** ${priority}`,
    `- **Covers:** \`${covers}\``,
    "- **Trigger:** a change under review",
    `- **Expectation (EARS):** When ${name} is exercised, the system SHALL report it.`,
    "- **Threshold:** 100% of cases flagged",
    `- **Verified by:** ${verifiedBy}`,
  ].join("\n");
}

/** Six blocks: E-1..E-3 are the "auth" half (G-1/UC-1/CAP-1/FR-1),
 *  E-4..E-6 the "billing" half (G-2/UC-2/CAP-2/FR-2). */
function parentExpectations(): string {
  return [
    "# Expectations — Demo Feature",
    "",
    "<!-- Gate 1 input. -->",
    "",
    eBlock("E-1", "login check", "P0", "G-1, UC-1, FR-1", "test/a.test.mjs"),
    "",
    eBlock("E-2", "session audit", "P1", "G-1, CAP-1", "test/a.test.mjs"),
    "",
    eBlock("E-3", "auth perf", "P2", "UC-1", "evals/E-3_perf.md"),
    "",
    eBlock("E-4", "invoice check", "P0", "G-2, UC-2, FR-2", "test/b.test.mjs"),
    "",
    eBlock("E-5", "ledger audit", "P1", "G-2, CAP-2", "test/b.test.mjs"),
    "",
    eBlock("E-6", "billing perf", "P2", "UC-2", "evals/E-6_perf.md"),
    "",
  ].join("\n");
}

const SPLIT_PARTITION = {
  expectations: {
    "E-1": ["auth"],
    "E-2": ["auth"],
    "E-3": ["auth", "billing"],
    "E-4": ["billing"],
    "E-5": ["billing"],
    "E-6": ["billing"],
  },
};

let repo: EngineRepo;
let regenCalls = 0;
beforeEach(() => {
  repo = makeEngineRepo();
  regenCalls = 0;
});
afterEach(() => repo.cleanup());

function seedWs(w: WsSpec, opts: { expectations?: string; prd?: string; questions?: string } = {}): void {
  repo.write(specRel(w), specText(w));
  repo.write(`${wsRel(w)}/prd/agent.md`, opts.prd ?? prdDefining(w.slug, PARENT_IDS));
  repo.write(`${wsRel(w)}/expectations.md`, opts.expectations ?? parentExpectations());
  repo.write(`${wsRel(w)}/design/agent.md`, "## Design\n\nreal.\n");
  repo.write(`${wsRel(w)}/decisions/2026-11-21-design-verify.md`, "# verify\n");
  repo.write(`${wsRel(w)}/prd/outline.md`, "- the human's own bullet\n");
  if (opts.questions !== undefined) repo.write(`${wsRel(w)}/questions.md`, opts.questions);
  repo.mkdir(`${wsRel(w)}/checkpoints`);
  repo.mkdir(`${wsRel(w)}/evals`);
}

function devSpec(hash: string, fm: string[]): void {
  repo.write(
    `dev/dev-${hash}-2026-11-21T09:00-x.md`,
    ["---", `hash: ${hash}`, "type: dev", ...fm, "---", "", "## Status log", "", "- made.", ""].join("\n"),
  );
}

function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(repo.root, abs);
      if (rel === PARTITION) continue;
      if (statSync(abs).isDirectory()) {
        out.set(`${rel}/`, "<dir>");
        walk(abs);
      } else out.set(rel, readFileSync(abs, "latin1"));
    }
  };
  walk(repo.root);
  return out;
}

const bytesOf = (rel: string): string => readFileSync(join(repo.root, rel), "latin1");

function expectTreeUnchanged(before: Map<string, string>): void {
  const after = snapshot();
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [rel, bytes] of before) expect(after.get(rel), rel).toBe(bytes);
}

const regen = () => {
  regenCalls++;
  return { ok: true as const, path: "GRAPH.md" };
};

function split(into: string, partition: unknown = SPLIT_PARTITION, dryRun = false) {
  if (partition !== null) repo.write(PARTITION, JSON.stringify(partition));
  const io = captureIo();
  const code = runWorkstreamSplit(
    [PARENT.hash],
    { into, partition: partition === null ? undefined : join(repo.root, PARTITION), dryRun },
    { ...io, projectPath: repo.configPath, now: FIXED_NOW, regen },
  );
  return { code, io, json: () => io.json() as Record<string, any> };
}

function combine(into = SURVIVOR.hash, from = ABSORBED.hash, dryRun = false) {
  const io = captureIo();
  const code = runWorkstreamCombine([into, from], { dryRun }, { ...io, projectPath: repo.configPath, now: FIXED_NOW, regen });
  return { code, io, json: () => io.json() as Record<string, any> };
}

function gatePrd(hash: string) {
  const io = captureIo();
  const code = runGatePrd([hash], { ...io, projectPath: repo.configPath, now: FIXED_NOW });
  return { code, io, json: () => io.json() as { gate: string; gaps?: Array<{ check: string; message: string }> } };
}

const codes = (j: Record<string, any>): string[] => (j.refusals as Array<{ code: string }>).map((r) => r.code);
const stateOf = (rel: string) => readEngineState(repo.read(rel));
const childSpec = (slug: string): string => {
  const name = readdirSync(join(repo.root, "plan")).find((n) => n.endsWith(`-${slug}.md`));
  if (!name) throw new Error(`no spec for ${slug}`);
  return `plan/${name}`;
};

// ---------------------------------------------------------------------------
// split — the happy path, held to the gate claims
// ---------------------------------------------------------------------------

describe("devx workstream split — what a successful split writes", () => {
  it("retires the parent as history and scaffolds children that inherit no gate state", () => {
    seedWs(PARENT);
    const parentBefore = snapshot();
    const { code, json } = split("auth,billing");
    expect(code).toBe(0);
    const out = json();

    // Parent: frontmatter flips to retired/superseded/spawned; NOTHING else of
    // it changes — every artifact, verdict, decision and outline is history.
    const pState = stateOf(specRel(PARENT));
    expect(pState.stage).toBe("retired");
    expect(pState.status).toBe("superseded");
    expect(pState.gateStatus.prd_validated).toBe(true);
    expect(pState.gateVerdicts.prd).toBe("PASS");
    // Parsed, not regexed: an all-digit hash is (correctly) YAML-quoted.
    const fm = parseDocument(repo.read(specRel(PARENT)).split("---")[1]).toJS() as { spawned: string[] };
    expect(fm.spawned).toEqual([out.children[0].hash, out.children[1].hash]);
    for (const [rel, bytes] of parentBefore) {
      if (rel === specRel(PARENT) || rel.endsWith("/")) continue;
      expect(bytesOf(rel), rel).toBe(bytes);
    }

    for (const child of out.children as Array<{ slug: string; hash: string; spec: string }>) {
      const st = stateOf(child.spec);
      expect(st.stage).toBe("prd");
      expect(st.gateStatus).toEqual({ prd_validated: false, design_verified: false, plan_verified: false, evals_red: false });
      expect(Object.values(st.gateVerdicts).every((v) => v === null)).toBe(true);
      expect(st.evalsLocked).toBe(false);
      expect(st.redEvalShas).toEqual({});
      expect(repo.read(child.spec)).not.toContain("gate_verdicts");
      expect(repo.read(child.spec)).toContain(`from: ${specRel(PARENT)}`);
      // Template PRD, not the parent's.
      expect(repo.read(`_devx/workstreams/${child.slug}/prd/agent.md`)).toContain("<numeric goal");
      // No design, plan, outline, or evals came across.
      for (const absent of ["design/agent.md", "plan/agent.md", "prd/outline.md"]) {
        expect(repo.exists(`_devx/workstreams/${child.slug}/${absent}`), absent).toBe(false);
      }
      expect(readdirSync(join(repo.root, "_devx/workstreams", child.slug, "evals"))).toEqual([]);
      expect(repo.exists(`_devx/workstreams/${child.slug}/decisions/${TODAY}-split-from-demo-feature.md`)).toBe(true);
    }
    expect(repo.exists(`${wsRel(PARENT)}/decisions/${TODAY}-split.md`)).toBe(true);
    expect(regenCalls).toBeGreaterThan(0);
  });

  it("carries each assigned E-block byte-identical, and a shared one into both children", () => {
    seedWs(PARENT);
    expect(split("auth,billing").code).toBe(0);
    const parentBlocks = new Map(sliceExpectations(parentExpectations()).blocks.map((b) => [b.id, b.text]));
    const auth = sliceExpectations(repo.read("_devx/workstreams/auth/expectations.md")).blocks;
    const billing = sliceExpectations(repo.read("_devx/workstreams/billing/expectations.md")).blocks;
    expect(auth.map((b) => b.id)).toEqual(["E-1", "E-2", "E-3"]);
    expect(billing.map((b) => b.id)).toEqual(["E-3", "E-4", "E-5", "E-6"]);
    for (const b of [...auth, ...billing]) expect(b.text).toBe(parentBlocks.get(b.id));
  });

  it("a child cannot pass Gate 1 until its own PRD is written — and then it can", () => {
    seedWs(PARENT);
    const out = split("auth,billing").json();
    const auth = (out.children as Array<{ slug: string; hash: string }>).find((c) => c.slug === "auth")!;
    // The template: placeholder furniture in every required section — FAIL.
    const first = gatePrd(auth.hash);
    expect(first.code).toBe(1);
    expect(first.json().gaps!.map((g) => g.check)).toContain("prd-section-placeholder");
    // The trap a copied PRD would have set: the parent's whole PRD here leaves
    // the sibling's G-2 uncovered — which is why the scaffold does not copy it.
    repo.write("_devx/workstreams/auth/prd/agent.md", prdDefining("auth", PARENT_IDS));
    const copied = gatePrd(auth.hash);
    expect(copied.code).toBe(1);
    expect(copied.json().gaps!.map((g) => g.message).join("\n")).toContain("'G-2' is not covered");
    // The PRD the record tells the author to write: exactly the IDs carried.
    repo.write("_devx/workstreams/auth/prd/agent.md", prdDefining("auth", out.children[0].covers_to_define));
    const real = gatePrd(auth.hash);
    expect(real.json().gate).toBe("PASS");
    expect(stateOf(childSpec("auth")).gateStatus.prd_validated).toBe(true);
  });

  it("copies the parent's blocked_by into every child — a dropped INTERVIEW blocker would open Gate 1", () => {
    seedWs({ ...PARENT, extraFm: ["blocked_by: [INTERVIEW-Q12]", "blocked-by: [ddd444]"] });
    const out = split("auth,billing").json();
    for (const c of out.children as Array<{ slug: string; hash: string; spec: string }>) {
      expect(readBlockedByAllSpellings(repo.read(c.spec))).toEqual(["INTERVIEW-Q12", "ddd444"]);
      repo.write(`_devx/workstreams/${c.slug}/prd/agent.md`, prdDefining(c.slug, (out.children.find((x: any) => x.slug === c.slug)).covers_to_define));
      const g = gatePrd(c.hash);
      expect(g.code).toBe(1);
      expect(g.json().gaps!.map((x) => x.check)).toContain("interview-blocker");
    }
  });

  it("leaves shipped dev specs pointing at the parent, byte-identical — a child's Gate 4 sees no shipped phase", () => {
    seedWs(PARENT);
    repo.write(`${wsRel(PARENT)}/plan/agent.md`, [
      "| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |",
      "|---|---|---|---|---|---|",
      "| E-1 | P0 | 1 | tests-first | test/a.test.mjs | full |",
      "| E-4 | P0 | 2 | tests-first | test/b.test.mjs | full |",
      "",
    ].join("\n"));
    devSpec("dev111", ["status: done", `plan: ${wsRel(PARENT)}`, "phase: 1"]);
    const shippedBefore = repo.read("dev/dev-dev111-2026-11-21T09:00-x.md");
    const out = split("auth,billing").json();
    expect(repo.read("dev/dev-dev111-2026-11-21T09:00-x.md")).toBe(shippedBefore);
    const auth = out.children.find((c: any) => c.slug === "auth");
    expect(auth.shipped_in_parent).toEqual([{ id: "E-1", phase: 1, specs: ["dev111"] }]);
    // The child has no shipped phase of its own: its phase 1 is NOT deferred.
    const fsSeam = { exists: (p: string) => repo.exists(relative(repo.root, p)), readdir: (p: string) => readdirSync(p), readFile: (p: string) => readFileSync(p, "utf8") };
    expect([...donePhasesFor(fsSeam, repo.root, { workstreamRel: "_devx/workstreams/auth", specRel: auth.spec })]).toEqual([]);
    expect(repo.read(auth.record)).toContain("E-1: parent phase 1, shipped by dev111");
  });

  it("regenerates GRAPH.md with the children and their lineage edges (no regen seam)", () => {
    seedWs(PARENT);
    const io = captureIo();
    repo.write(PARTITION, JSON.stringify(SPLIT_PARTITION));
    const code = runWorkstreamSplit([PARENT.hash], { into: "auth,billing", partition: join(repo.root, PARTITION) }, { ...io, projectPath: repo.configPath, now: FIXED_NOW });
    expect(code, io.stderr()).toBe(0);
    const j = io.json() as { graph: string; children: Array<{ hash: string }> };
    expect(j.graph).toBe("regenerated");
    const graph = repo.read("GRAPH.md");
    // A fully-settled parent collapses to its group's summary node, and the
    // lineage edge is drawn from there.
    for (const c of j.children) expect(graph).toMatch(new RegExp(`(?:${PARENT.hash}|grp_demo_feature) -\\.-> ${c.hash}`));
    expect(graph).not.toMatch(/^ {2}\S+ --> \S+$/m); // no blocks edge was written
  });

  it("a failure while flushing exits 2 and names every file that landed", () => {
    seedWs(PARENT);
    repo.write(PARTITION, JSON.stringify(SPLIT_PARTITION));
    const io = captureIo();
    const landed: string[] = [];
    const code = runWorkstreamSplit([PARENT.hash], { into: "auth,billing", partition: join(repo.root, PARTITION) }, {
      ...io,
      projectPath: repo.configPath,
      now: FIXED_NOW,
      regen,
      fs: {
        writeFile: (p: string, c: string) => {
          if (p.includes("billing") && p.endsWith("expectations.md")) throw new Error("disk full");
          landed.push(p);
          writeFileSync(p, c);
        },
      },
    });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("disk full");
    for (const p of landed) expect(io.stderr()).toContain(relative(repo.root, p));
    // The parent spec is patched LAST of the specs only by luck of map order;
    // what matters is that the report is complete, and regen never ran.
    expect(regenCalls).toBe(0);
  });

  it("--dry-run plans everything and writes nothing", () => {
    seedWs(PARENT);
    const before = snapshot();
    const { code, json } = split("auth,billing", SPLIT_PARTITION, true);
    expect(code).toBe(0);
    expect(json().dry_run).toBe(true);
    expect(json().children).toHaveLength(2);
    expectTreeUnchanged(before);
    expect(regenCalls).toBe(0);
  });

  it("warns when a child carries fewer E-blocks than Gate 1 requires", () => {
    seedWs(PARENT);
    const p = { expectations: { ...SPLIT_PARTITION.expectations, "E-3": ["billing"], "E-2": ["billing"] } };
    const { code, io } = split("auth,billing", p);
    expect(code).toBe(0);
    expect(io.stderr()).toContain("child 'auth' carries 1 E-block(s); Gate 1 requires 3");
  });
});

// ---------------------------------------------------------------------------
// split — every refusal writes nothing
// ---------------------------------------------------------------------------

interface Case {
  name: string;
  setup: () => void;
  into?: string;
  partition?: unknown;
  code: string;
}

const SPLIT_REFUSALS: Case[] = [
  { name: "no partition — hands back the template", setup: () => seedWs(PARENT), partition: null, code: "partition-required" },
  { name: "an E-id left unassigned", setup: () => seedWs(PARENT), partition: { expectations: { ...SPLIT_PARTITION.expectations, "E-6": [] } }, code: "partition-unassigned" },
  {
    name: "an E-id missing from the partition",
    setup: () => seedWs(PARENT),
    partition: { expectations: Object.fromEntries(Object.entries(SPLIT_PARTITION.expectations).filter(([k]) => k !== "E-5")) },
    code: "partition-unassigned",
  },
  { name: "an unknown E-id", setup: () => seedWs(PARENT), partition: { expectations: { ...SPLIT_PARTITION.expectations, "E-9": ["auth"] } }, code: "partition-unknown-expectation" },
  { name: "a child not in --into", setup: () => seedWs(PARENT), partition: { expectations: { ...SPLIT_PARTITION.expectations, "E-6": ["payments"] } }, code: "partition-unknown-child" },
  { name: "a child with no expectations", setup: () => seedWs(PARENT), into: "auth,billing,extra", code: "partition-empty-child" },
  { name: "a malformed partition", setup: () => seedWs(PARENT), partition: { expectations: { "E-1": "auth" } }, code: "partition-invalid" },
  { name: "only one child", setup: () => seedWs(PARENT), into: "auth", partition: { expectations: Object.fromEntries(Object.keys(SPLIT_PARTITION.expectations).map((k) => [k, ["auth"]])) }, code: "split-needs-two" },
  { name: "a child slug whose directory exists", setup: () => { seedWs(PARENT); repo.mkdir("_devx/workstreams/auth"); }, code: "child-slug-taken" },
  { name: "a child slug another plan spec uses", setup: () => { seedWs(PARENT); repo.write("plan/plan-fff999-2026-01-01T00:00-auth.md", "---\nhash: fff999\n---\n"); }, code: "child-slug-taken" },
  { name: "the parent's own slug", setup: () => seedWs(PARENT), into: "demo-feature,billing", partition: { expectations: { ...SPLIT_PARTITION.expectations, "E-1": ["demo-feature"], "E-2": ["demo-feature"], "E-3": ["demo-feature"] } }, code: "child-slug-taken" },
  { name: "a closed RED stage (evals_red)", setup: () => seedWs({ ...PARENT, stage: "executing", flags: { prd_validated: true, design_verified: true, plan_verified: true, evals_red: true } }), code: "red-closed" },
  { name: "a lock marker with the flag cleared", setup: () => seedWs(PARENT), code: "red-closed" },
  { name: "a ready emitted phase", setup: () => { seedWs(PARENT); devSpec("dev222", ["status: ready", `plan: ${wsRel(PARENT)}`, "phase: 1"]); }, code: "emitted-specs-live" },
  { name: "an in-progress emitted phase (plan-spec pointer)", setup: () => { seedWs(PARENT); devSpec("dev333", ["status: in-progress", `plan: ${specRel(PARENT)}`, "phase: 2"]); }, code: "emitted-specs-live" },
  { name: "a blocked emitted phase", setup: () => { seedWs(PARENT); devSpec("dev444", ["status: blocked", `plan: ${wsRel(PARENT)}`]); }, code: "emitted-specs-live" },
  { name: "an emitted spec with an unrecognized status", setup: () => { seedWs(PARENT); devSpec("dev555", ["status: parked", `plan: ${wsRel(PARENT)}`]); }, code: "emitted-specs-live" },
  { name: "an unsettled dependent", setup: () => { seedWs(PARENT); devSpec("dep666", ["status: ready", `blocked_by: [${PARENT.hash}]`]); }, code: "dependents-unsettled" },
  { name: "a parked human question", setup: () => seedWs(PARENT, { questions: questionsWith("open-question", "open") }), code: "questions-parked" },
  { name: "an unreadable questions.md", setup: () => seedWs(PARENT, { questions: "## Q-1: x\n\n- **Kind:** open-question\n- **Status:** open\n" }), code: "questions-unreadable" },
  { name: "an outcome in flight", setup: () => seedWs(PARENT), code: "outcome-in-flight" },
  { name: "a done workstream", setup: () => seedWs({ ...PARENT, stage: "done" }), code: "workstream-closed" },
  { name: "a retired workstream", setup: () => seedWs({ ...PARENT, stage: "retired" }), code: "workstream-closed" },
  { name: "unreadable frontmatter", setup: () => { seedWs(PARENT); repo.write(specRel(PARENT), repo.read(specRel(PARENT)).replace("title: demo-feature", "title: demo: feature: [")); }, code: "frontmatter-unreadable" },
  { name: "no expectations.md", setup: () => { seedWs(PARENT); rmSync(join(repo.root, wsRel(PARENT), "expectations.md")); }, partition: null, code: "expectations-missing" },
  { name: "a duplicated E-id", setup: () => seedWs(PARENT, { expectations: `${parentExpectations()}\n${eBlock("E-2", "again", "P1", "G-1", "test/a.test.mjs")}\n` }), code: "expectations-duplicate-id" },
  { name: "an E heading the parser would skip", setup: () => seedWs(PARENT, { expectations: `${parentExpectations()}\n## E-7 no colon\n\n- **Priority:** P1\n` }), code: "expectations-heading-drift" },
  { name: "an existing split record", setup: () => { seedWs(PARENT); repo.write(`${wsRel(PARENT)}/decisions/${TODAY}-split.md`, "# earlier\n"); }, code: "record-exists" },
];

function questionsWith(kind: string, status: string): string {
  return ["# Questions", "", "## Q-1: which store?", "", `- **Kind:** ${kind}`, "- **Severity:** concern", "- **Blocks:** —", "- **Origin:** human", "- **Recommendation:** pick one", `- **Status:** ${status}`, "- **Resolution:** —", ""].join("\n");
}

// Two cases above need state the seed helper cannot spell inline.
const PATCHES: Record<string, () => void> = {
  "a lock marker with the flag cleared": () =>
    repo.write(specRel(PARENT), applyEnginePatch(repo.read(specRel(PARENT)), { evalsLocked: true })),
  "an outcome in flight": () =>
    repo.write(specRel(PARENT), applyEnginePatch(repo.read(specRel(PARENT)), { outcome: { status: "pending" } })),
};

describe("devx workstream split — every refusal leaves the tree byte-identical", () => {
  for (const c of SPLIT_REFUSALS) {
    it(`refuses ${c.name} [${c.code}]`, () => {
      c.setup();
      PATCHES[c.name]?.();
      const before = snapshot();
      const { code, json, io } = split(c.into ?? "auth,billing", c.partition === undefined ? SPLIT_PARTITION : c.partition);
      expect(code, io.stderr()).toBe(1);
      expect(json().refused).toBe(true);
      expect(codes(json())).toContain(c.code);
      expect(io.stderr()).toContain("nothing written");
      expectTreeUnchanged(before);
      expect(regenCalls).toBe(0);
    });
  }

  it("the partition-required refusal carries a template naming every E-id", () => {
    seedWs(PARENT);
    const j = split("auth,billing", null).json();
    expect(Object.keys(j.template.expectations)).toEqual(["E-1", "E-2", "E-3", "E-4", "E-5", "E-6"]);
    expect(j.template.catalog[0]).toMatchObject({ id: "E-1", priority: "P0", covers: ["G-1", "UC-1", "FR-1"], verified_by: "test/a.test.mjs" });
  });

  it("reports every refusal the state has earned, not just the first", () => {
    seedWs({ ...PARENT, stage: "executing", flags: { evals_red: true } });
    devSpec("dev222", ["status: ready", `plan: ${wsRel(PARENT)}`]);
    devSpec("dep666", ["status: ready", `blocked_by: [${PARENT.hash}]`]);
    const before = snapshot();
    const j = split("auth,billing").json();
    expect(codes(j)).toEqual(expect.arrayContaining(["red-closed", "emitted-specs-live", "dependents-unsettled"]));
    expectTreeUnchanged(before);
  });

  it("a closed RED stage is passable only through `devx revise`, the one sanctioned lock-clearer", () => {
    seedWs({ ...PARENT, stage: "executing", flags: { prd_validated: true, design_verified: true, plan_verified: true, evals_red: true } });
    repo.write(specRel(PARENT), applyEnginePatch(repo.read(specRel(PARENT)), { evalsLocked: true, redEvalShas: { "test/a.test.mjs": "x" } }));
    expect(codes(split("auth,billing").json())).toContain("red-closed");
    const io = captureIo();
    expect(runRevise([PARENT.hash], { touched: "plan" }, { ...io, projectPath: repo.configPath })).toBe(0);
    expect(split("auth,billing").code).toBe(0);
  });

  it("settled emitted specs and settled dependents do not refuse", () => {
    seedWs(PARENT);
    devSpec("dev777", ["status: done", `plan: ${wsRel(PARENT)}`, "phase: 1"]);
    devSpec("dev888", ["status: deleted", `plan: ${wsRel(PARENT)}`]);
    devSpec("dep999", ["status: done", `blocked_by: [${PARENT.hash}]`]);
    expect(split("auth,billing").code).toBe(0);
  });

  it("open gate concerns do not refuse — the children's gates re-derive their own", () => {
    seedWs(PARENT, { questions: questionsWith("gate-concern", "open") });
    expect(split("auth,billing").code).toBe(0);
  });

  it("refuses under engine.docs_layout: project-level", () => {
    repo.write("devx.config.yaml", `${repo.read("devx.config.yaml")}engine:\n  docs_layout: project-level\n`);
    repo.write(specRel(PARENT), specText(PARENT).replace(`workstream: ${wsRel(PARENT)}`, "workstream: ."));
    repo.write("prd.md", prdDefining("x", PARENT_IDS));
    repo.write("expectations.md", parentExpectations());
    const before = snapshot();
    const r = split("auth,billing");
    expect(r.code).toBe(1);
    expect(codes(r.json())).toContain("layout-project-level");
    expectTreeUnchanged(before);
  });

  it("usage errors exit 2 and write nothing", () => {
    seedWs(PARENT);
    const before = snapshot();
    expect(split("Auth,billing").code).toBe(2);
    expect(split("auth,auth").code).toBe(2);
    repo.write(PARTITION, "{not json");
    const io = captureIo();
    expect(runWorkstreamSplit([PARENT.hash], { into: "auth,billing", partition: join(repo.root, PARTITION) }, { ...io, projectPath: repo.configPath })).toBe(2);
    expectTreeUnchanged(before);
  });
});

// ---------------------------------------------------------------------------
// combine
// ---------------------------------------------------------------------------

/** Survivor: G-1/UC-1/CAP-1/FR-1, blocks E-1..E-3. Absorbed: its OWN G-1/… —
 *  the same ID strings, meaning different things. */
function seedPair(opts: { survivor?: Partial<WsSpec>; absorbed?: Partial<WsSpec>; absorbedQuestions?: string } = {}): void {
  const half = (slug: string) =>
    [
      `# Expectations — ${slug}`,
      "",
      eBlock("E-1", `${slug} check`, "P0", "G-1, UC-1, FR-1", "test/a.test.mjs"),
      "",
      eBlock("E-2", `${slug} audit`, "P1", "G-1, CAP-1", "test/a.test.mjs"),
      "",
      eBlock("E-3", `${slug} perf`, "P2", "UC-1", `evals/E-3_${slug}.md`),
      "",
    ].join("\n");
  const ids = ["G-1", "UC-1", "CAP-1", "FR-1"];
  seedWs({ ...SURVIVOR, ...opts.survivor }, { expectations: half("alpha"), prd: prdDefining("alpha", ids) });
  seedWs({ ...ABSORBED, ...opts.absorbed }, { expectations: half("beta"), prd: prdDefining("beta", ids), questions: opts.absorbedQuestions });
}

describe("devx workstream combine — what a successful combine writes", () => {
  it("re-keys the absorbed blocks, reopens every survivor gate, and retires the absorbed side as history", () => {
    seedPair();
    const absorbedBefore = snapshot();
    const { code, json } = combine();
    expect(code).toBe(0);
    const j = json();
    expect(j.expectation_map).toEqual({ "E-1": "E-4", "E-2": "E-5", "E-3": "E-6" });
    expect(j.id_map).toEqual({ "G-1": "G-2", "UC-1": "UC-2", "FR-1": "FR-2", "CAP-1": "CAP-2" });

    const sExp = parseExpectations(repo.read(`${wsRel(SURVIVOR)}/expectations.md`));
    expect(sExp.map((b) => b.id)).toEqual(["E-1", "E-2", "E-3", "E-4", "E-5", "E-6"]);
    expect(sExp[3].covers).toBe("`G-2, UC-2, FR-2`");
    expect(sExp[3].name).toBe("beta check");

    const s = stateOf(specRel(SURVIVOR));
    expect(s.stage).toBe("prd");
    expect(s.gateStatus).toEqual({ prd_validated: false, design_verified: false, plan_verified: false, evals_red: false });
    expect(Object.values(s.gateVerdicts).every((v) => v === null)).toBe(true);

    const a = stateOf(specRel(ABSORBED));
    expect(a.stage).toBe("retired");
    expect(a.status).toBe("superseded");
    expect(a.gateVerdicts.prd).toBe("CONCERNS"); // history, untouched
    expect(repo.read(specRel(ABSORBED))).toContain(`superseded_by: ${SURVIVOR.hash}`);
    for (const [rel, bytes] of absorbedBefore) {
      if (!rel.startsWith(wsRel(ABSORBED)) || rel.endsWith("/")) continue;
      expect(bytesOf(rel), rel).toBe(bytes);
    }
    expect(repo.exists(`${wsRel(SURVIVOR)}/decisions/${TODAY}-combine-beta.md`)).toBe(true);
    expect(repo.exists(`${wsRel(ABSORBED)}/decisions/${TODAY}-combined-into-alpha.md`)).toBe(true);
  });

  it("a colliding ID cannot fool Gate 1: verbatim it would PASS, re-keyed it dangles until defined", () => {
    seedPair();
    // The counterfactual: append the absorbed blocks VERBATIM. Gate 1 never
    // checks for duplicate IDs, so the absorbed `G-1` counts as coverage of the
    // survivor's unrelated `G-1` and the gate passes work it never examined.
    const naive = `${repo.read(`${wsRel(SURVIVOR)}/expectations.md`)}\n${repo.read(`${wsRel(ABSORBED)}/expectations.md`).split("\n").slice(2).join("\n")}`;
    const verbatim = evaluateGatePrd({
      prd: repo.read(`${wsRel(SURVIVOR)}/prd/agent.md`),
      expectations: naive,
      blockedBy: [],
      expectationsMin: 3,
      prdRel: "prd/agent.md",
      expectationsRel: "expectations.md",
    });
    expect(verbatim.gaps).toEqual([]);

    expect(combine().code).toBe(0);
    const g = gatePrd(SURVIVOR.hash);
    expect(g.code).toBe(1);
    const dangling = g.json().gaps!.filter((x) => x.check === "covers-id-dangling").map((x) => x.message);
    expect(dangling.join("\n")).toMatch(/'G-2'/);
    // Defining the fresh IDs — the human merging the absorbed PRD — is the way through.
    repo.write(`${wsRel(SURVIVOR)}/prd/agent.md`, prdDefining("alpha", ["G-1", "G-2", "UC-1", "UC-2", "CAP-1", "CAP-2", "FR-1", "FR-2"]));
    expect(gatePrd(SURVIVOR.hash).json().gate).toBe("PASS");
  });

  it("unions the absorbed side's blockers into the survivor", () => {
    seedPair({ absorbed: { extraFm: ["blocked_by: [INTERVIEW-Q7]"] } });
    expect(combine().code).toBe(0);
    expect(readBlockedByAllSpellings(repo.read(specRel(SURVIVOR)))).toEqual(["INTERVIEW-Q7"]);
  });

  it("reports identical expectations as likely duplicates and never merges them", () => {
    seedPair();
    repo.write(`${wsRel(ABSORBED)}/expectations.md`, repo.read(`${wsRel(ABSORBED)}/expectations.md`).replaceAll("beta check", "alpha check"));
    const j = combine().json();
    expect(j.likely_duplicates).toEqual([["E-1", "E-1"]]);
    expect(parseExpectations(repo.read(`${wsRel(SURVIVOR)}/expectations.md`))).toHaveLength(6);
  });

  it("--dry-run plans everything and writes nothing", () => {
    seedPair();
    const before = snapshot();
    const r = combine(SURVIVOR.hash, ABSORBED.hash, true);
    expect(r.code).toBe(0);
    expect(r.json().dry_run).toBe(true);
    expectTreeUnchanged(before);
  });
});

const COMBINE_REFUSALS: Array<{ name: string; setup: () => void; into?: string; from?: string; code: string }> = [
  { name: "a workstream absorbing itself", setup: () => seedPair(), from: SURVIVOR.hash, code: "same-workstream" },
  { name: "a closed RED stage on the survivor", setup: () => seedPair({ survivor: { stage: "executing", flags: { evals_red: true } } }), code: "red-closed" },
  { name: "a closed RED stage on the absorbed side", setup: () => seedPair({ absorbed: { stage: "executing", flags: { evals_red: true } } }), code: "red-closed" },
  { name: "a live phase on the survivor", setup: () => { seedPair(); devSpec("dev222", ["status: ready", `plan: ${wsRel(SURVIVOR)}`]); }, code: "emitted-specs-live" },
  { name: "a live phase on the absorbed side", setup: () => { seedPair(); devSpec("dev333", ["status: in-progress", `plan: ${specRel(ABSORBED)}`]); }, code: "emitted-specs-live" },
  { name: "an unsettled dependent of the absorbed side", setup: () => { seedPair(); devSpec("dep444", ["status: ready", `blocked_by: [${ABSORBED.hash}]`]); }, code: "dependents-unsettled" },
  { name: "a parked question on the absorbed side", setup: () => seedPair({ absorbedQuestions: questionsWith("needs-revision", "asked") }), code: "questions-parked" },
  { name: "a done survivor", setup: () => seedPair({ survivor: { stage: "done" } }), code: "workstream-closed" },
  { name: "a retired absorbed side", setup: () => seedPair({ absorbed: { stage: "retired" } }), code: "workstream-closed" },
  { name: "absorbed expectations missing", setup: () => { seedPair(); rmSync(join(repo.root, wsRel(ABSORBED), "expectations.md")); }, code: "expectations-missing" },
  { name: "absorbed expectations with no E-blocks", setup: () => { seedPair(); repo.write(`${wsRel(ABSORBED)}/expectations.md`, "# Expectations\n"); }, code: "expectations-empty" },
  {
    name: "a workstream-local eval name the survivor already has",
    setup: () => {
      seedPair();
      repo.write(`${wsRel(ABSORBED)}/expectations.md`, repo.read(`${wsRel(ABSORBED)}/expectations.md`).replace("evals/E-3_beta.md", "evals/E-3_alpha.md"));
      repo.write(`${wsRel(SURVIVOR)}/evals/E-3_alpha.md`, "# the survivor's own eval\n");
    },
    code: "eval-path-collision",
  },
  { name: "an existing combine record", setup: () => { seedPair(); repo.write(`${wsRel(SURVIVOR)}/decisions/${TODAY}-combine-beta.md`, "# earlier\n"); }, code: "record-exists" },
];

describe("devx workstream combine — every refusal leaves the tree byte-identical", () => {
  for (const c of COMBINE_REFUSALS) {
    it(`refuses ${c.name} [${c.code}]`, () => {
      c.setup();
      const before = snapshot();
      const { code, json, io } = combine(c.into ?? SURVIVOR.hash, c.from ?? ABSORBED.hash);
      expect(code, io.stderr()).toBe(1);
      expect(codes(json())).toContain(c.code);
      expectTreeUnchanged(before);
      expect(regenCalls).toBe(0);
    });
  }

  it("the survivor's own dependents and parked questions do not refuse — it stays live", () => {
    seedPair();
    repo.write(`${wsRel(SURVIVOR)}/questions.md`, questionsWith("open-question", "open"));
    devSpec("dep555", ["status: ready", `blocked_by: [${SURVIVOR.hash}]`]);
    expect(combine().code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

describe("lifecycle pieces", () => {
  it("SETTLED_STATUSES agrees with the story graph's", () => {
    expect([...SETTLED_STATUSES].sort()).toEqual([...GRAPH_SETTLED].sort());
  });

  it("sliceExpectations agrees with parseExpectations on every block boundary", () => {
    const text = `${parentExpectations()}\n## Notes\n\nprose no block owns.\n`;
    const slice = sliceExpectations(text);
    expect(slice.blocks.map((b) => b.id)).toEqual(parseExpectations(text).map((b) => b.id));
    expect(slice.otherSections).toEqual(["Notes"]);
    expect(slice.preamble.startsWith("# Expectations")).toBe(true);
  });

  it("spawnedAppend appends and deduplicates, in every shape `spawned:` takes", () => {
    const base = "---\nhash: x\nspawned:\n  - aaa111\n---\nbody\n";
    const out = applyEnginePatch(base, { spawnedAppend: ["bbb222", "aaa111"] });
    expect(out).toContain("spawned: [aaa111, bbb222]");
    expect(applyEnginePatch("---\nhash: x\nspawned: ccc333\n---\n", { spawnedAppend: ["ddd444"] })).toContain("spawned: [ccc333, ddd444]");
    expect(out.endsWith("body\n")).toBe(true);
  });
});
