// E-4 permanent suite (hfi103): todo-drift detection is mechanical and
// ADVISORY. computeTodoDrift's two contradiction classes (gate-flag,
// phase-pointer — either direction) surface through both `devx next`
// forms, and the advisory contract holds at the CLI: the exit code is
// unchanged vs a no-drift fixture and NOTHING is written to disk (CAP-2 —
// drift is reported, never blocking, never mutating).
//
// Spec: dev/dev-hfi103-2026-07-24T10:41-todo-sync-renderers-status.md
// Eval: _devx/workstreams/harness-fold-in/evals/E-4_next-todo-drift.ts

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runNext } from "../src/commands/next.js";
import { type EngineRepo, captureIo, makeEngineRepo, validPrd } from "./fixtures/engine-repo.js";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const SPEC_REL = "plan/plan-abc123-2026-07-24T10:41-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";
const TODO_REL = `${WS}/todo.md`;
const DEV_SPEC_REL = "dev/dev-abc999-2026-07-24T10:41-phase-one.md";

/** Mid-pipeline (stage prd) so the repo-level table lands on row 9. */
function seedWorkstream(): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      "stage: prd",
      "gate_status:",
      "  prd_validated: false",
      "  design_verified: false",
      "  plan_verified: false",
      "  evals_red: false",
      `workstream: ${WS}`,
      "---",
      "body",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd/agent.md`, validPrd());
}

/** Linked dev spec with status done — the phase-pointer ground truth. */
function seedDoneDevSpec(): void {
  repo.write(
    DEV_SPEC_REL,
    ["---", "hash: abc999", "type: dev", "status: done", "---", "body", ""].join("\n"),
  );
}

// Gate `prd` CHECKED while its flag is false (gate-flag class); the Phase 1
// pointer UNCHECKED while the linked dev spec is done (phase-pointer class).
const DRIFTED_TODO = [
  "- [ ] Stage: PRD",
  "- [x] Gate: prd",
  "- [ ] Stage: Design",
  "- [ ] Gate: coverage(design)",
  "- [ ] Stage: Plan",
  "- [ ] Gate: coverage(plan)",
  "- [ ] Stage: RED",
  "- [ ] Gate: evals",
  "- [ ] Stage: Execute",
  "  - [ ] Phase 1: phase one → abc999",
  "- [ ] Stage: Retro",
  "- [ ] Stage: Outcome",
  "",
].join("\n");

const NO_DRIFT_TODO = DRIFTED_TODO.replace("- [x] Gate: prd", "- [ ] Gate: prd").replace(
  "  - [ ] Phase 1: phase one → abc999",
  "  - [x] Phase 1: phase one → abc999",
);

interface DriftRow {
  class: string;
  line: number;
  message: string;
  /** Repo-level rows are workstream-stamped (WorkstreamTodoDrift). */
  hash?: string;
  slug?: string;
}

function repoNext(io = captureIo()): { code: number; io: typeof io } {
  const code = runNext(["--no-gh"], { ...io, projectPath: repo.configPath });
  return { code, io };
}

describe("E-4 — repo-level `devx next` advisory todo-drift rows", () => {
  it("detects both drift classes, keeps exit code unchanged vs no-drift, writes 0 files", () => {
    seedWorkstream();
    seedDoneDevSpec();
    repo.write(TODO_REL, DRIFTED_TODO);
    const todoBefore = repo.read(TODO_REL);
    const specBefore = repo.read(SPEC_REL);

    const drifted = repoNext();
    expect(drifted.code).toBe(0);
    const driftedJson = drifted.io.json() as { row: number; todo_drift: DriftRow[] };
    expect(driftedJson.row).toBe(9);
    const classes = new Set(driftedJson.todo_drift.map((d) => d.class));
    expect(classes).toEqual(new Set(["gate-flag", "phase-pointer"]));
    for (const d of driftedJson.todo_drift) {
      expect(d.line).toBeGreaterThanOrEqual(1);
      expect(d.message).toContain(`todo line ${d.line}`);
      expect(d.hash).toBe("abc123");
      expect(d.slug).toBe("demo-feature");
    }
    // Advisory rows render on stderr under the decision line.
    expect(drifted.io.stderr()).toContain("todo-drift (gate-flag)");
    expect(drifted.io.stderr()).toContain("todo-drift (phase-pointer)");

    // CAP-2: 0 file writes — todo.md and the spec are byte-identical.
    expect(repo.read(TODO_REL)).toBe(todoBefore);
    expect(repo.read(SPEC_REL)).toBe(specBefore);

    // Exit code unchanged vs the no-drift fixture.
    repo.write(TODO_REL, NO_DRIFT_TODO);
    const clean = repoNext();
    expect(clean.code).toBe(drifted.code);
    const cleanJson = clean.io.json() as { todo_drift: DriftRow[] };
    expect(cleanJson.todo_drift).toEqual([]);
    expect(clean.io.stderr()).not.toContain("todo-drift");
  });

  it("absent todo.md (grandfathered workstream) reports empty drift", () => {
    seedWorkstream();
    const { code, io } = repoNext();
    expect(code).toBe(0);
    const json = io.json() as { row: number; todo_drift: DriftRow[] };
    expect(json.row).toBe(9);
    expect(json.todo_drift).toEqual([]);
  });

  it("executing-stage workstreams (outside midPipeline) still surface drift", () => {
    // All gates passed + stage executing → v1 row 12 → NOT a row-9
    // midPipeline signal. The advisory drift must surface anyway — the
    // execute phase is where phase-pointer drift is most likely (BH#1).
    seedWorkstream();
    repo.write(
      SPEC_REL,
      repo
        .read(SPEC_REL)
        .replace("stage: prd", "stage: executing")
        .replace(/: false/g, ": true"),
    );
    // Full artifact set so no earlier v1 row (4/6/8) reopens a stage —
    // existence checks only, content is irrelevant here.
    for (const f of ["expectations.md", "design/agent.md", "plan/agent.md"]) {
      repo.write(`${WS}/${f}`, "x");
    }
    seedDoneDevSpec();
    repo.write(
      TODO_REL,
      DRIFTED_TODO.replace("- [x] Gate: prd", "- [ ] Gate: prd"), // gate-flag drift the other direction (flag true, box unchecked)
    );
    const { code, io } = repoNext();
    expect(code).toBe(0);
    const json = io.json() as { row: number; todo_drift: DriftRow[] };
    expect(json.row).not.toBe(9); // decision is about something else entirely
    expect(new Set(json.todo_drift.map((d) => d.class))).toEqual(
      new Set(["gate-flag", "phase-pointer"]),
    );
    expect(io.stderr()).toContain("todo-drift (phase-pointer) demo-feature:");
  });
});

describe("E-4 — workstream-form `devx next <hash>` carries the same drift", () => {
  it("emits both classes in todo_drift and writes nothing", () => {
    seedWorkstream();
    seedDoneDevSpec();
    repo.write(TODO_REL, DRIFTED_TODO);
    const before = repo.read(TODO_REL);

    const io = captureIo();
    const code = runNext(["abc123"], { ...io, projectPath: repo.configPath });
    expect(code).toBe(0);
    const json = io.json() as { todo_drift: DriftRow[] };
    expect(new Set(json.todo_drift.map((d) => d.class))).toEqual(
      new Set(["gate-flag", "phase-pointer"]),
    );
    expect(repo.read(TODO_REL)).toBe(before);
  });
});
