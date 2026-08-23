// `devx todo sync <hash>` (hfi103): the mechanical truing primitive.
// Absent todo.md → created from the shipped template BORN CONSISTENT with
// current frontmatter (FR-1 grandfathering); present → derived lines
// trued, free-nested items byte-preserved; no-op exits 0 with an empty
// trued list; resolution errors exit 2.
//
// Spec: dev/dev-hfi103-2026-07-24T10:41-todo-sync-renderers-status.md
// Design: _devx/workstreams/harness-fold-in/design/agent.md §Interfaces

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTodoSync } from "../src/commands/todo.js";
import { parseTodo } from "../src/lib/engine/todo.js";
import { type EngineRepo, captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const SPEC_REL = "plan/plan-abc123-2026-07-24T10:41-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";
const TODO_REL = `${WS}/todo.md`;

function seedSpec(flags: {
  stage: string;
  prd?: boolean;
  design?: boolean;
  plan?: boolean;
  evals?: boolean;
}): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${flags.stage}`,
      "gate_status:",
      `  prd_validated: ${flags.prd ?? false}`,
      `  design_verified: ${flags.design ?? false}`,
      `  plan_verified: ${flags.plan ?? false}`,
      `  evals_red: ${flags.evals ?? false}`,
      `workstream: ${WS}`,
      "---",
      "body",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
}

interface SyncJson {
  hash: string;
  created: boolean;
  trued: string[];
}

function sync(hash = "abc123"): { code: number; io: ReturnType<typeof captureIo> } {
  const io = captureIo();
  const code = runTodoSync([hash], { ...io, projectPath: repo.configPath });
  return { code, io };
}

describe("devx todo sync — FR-1 grandfathering (absent todo.md)", () => {
  it("creates a skeleton born consistent with mid-pipeline frontmatter", () => {
    // Mid-pipeline: stage red, first three gates passed.
    seedSpec({ stage: "red", prd: true, design: true, plan: true });
    const { code, io } = sync();
    expect(code).toBe(0);
    const json = io.json() as SyncJson;
    expect(json).toMatchObject({ hash: "abc123", created: true });

    const content = repo.read(TODO_REL);
    // Title substitution from the slug, same as the scaffold.
    expect(content).toContain("Demo Feature");
    const doc = parseTodo(content);
    expect(doc.unparsedTopLevel).toEqual([]);
    const byText = new Map(doc.items.map((i) => [i.text, i.checked]));
    // Stages the ordinal already passed are checked; the current one isn't.
    expect(byText.get("Stage: PRD")).toBe(true);
    expect(byText.get("Stage: Design")).toBe(true);
    expect(byText.get("Stage: Plan")).toBe(true);
    expect(byText.get("Stage: RED")).toBe(false);
    expect(byText.get("Stage: Execute")).toBe(false);
    // Gate checkboxes mirror the flags.
    expect(byText.get("Gate: prd")).toBe(true);
    expect(byText.get("Gate: coverage(design)")).toBe(true);
    expect(byText.get("Gate: coverage(plan)")).toBe(true);
    expect(byText.get("Gate: evals")).toBe(false);
    // Retro/Outcome key off status/outcome, both unset here.
    expect(byText.get("Stage: Retro")).toBe(false);
    expect(byText.get("Stage: Outcome")).toBe(false);
  });
});

describe("devx todo sync — truing a present todo.md", () => {
  it("trues derived lines, preserves free items byte-exact, then no-ops", () => {
    seedSpec({ stage: "design", prd: true });
    repo.write(
      TODO_REL,
      [
        "- [ ] Stage: PRD", // should true → checked (stage past prd)
        "  - [ ] a free intake leftover   (weird  spacing preserved)",
        "- [ ] Gate: prd", // should true → checked (flag true)
        "- [x] Stage: Design", // should true → unchecked (stage IS design)
        "- [ ] Gate: coverage(design)",
        "- [ ] Stage: Execute",
        "  - [ ] Phase 1: phase one → abc999", // dev spec absent → stays unchecked
        "",
      ].join("\n"),
    );

    const first = sync();
    expect(first.code).toBe(0);
    const firstJson = first.io.json() as SyncJson;
    expect(firstJson.created).toBe(false);
    expect(firstJson.trued.length).toBe(3);

    const content = repo.read(TODO_REL);
    expect(content).toContain("- [x] Stage: PRD");
    expect(content).toContain("- [x] Gate: prd");
    expect(content).toContain("- [ ] Stage: Design");
    // Free-nested line byte-preserved, including its odd spacing.
    expect(content).toContain(
      "  - [ ] a free intake leftover   (weird  spacing preserved)",
    );
    // Pointer with no resolvable dev spec reads not-done → unchecked.
    expect(content).toContain("  - [ ] Phase 1: phase one → abc999");

    // Second run is a no-op: exit 0, empty trued, file untouched.
    const before = repo.read(TODO_REL);
    const second = sync();
    expect(second.code).toBe(0);
    expect((second.io.json() as SyncJson).trued).toEqual([]);
    expect(repo.read(TODO_REL)).toBe(before);
  });

  it("never trues a checkbox-shaped line inside an HTML comment block", () => {
    // The template's header comment documents the contract with example
    // lines; a column-0 `- [ ] Stage: …` inside `<!-- … -->` must not parse
    // as a derived item — sync writing through it would corrupt the comment.
    seedSpec({ stage: "design", prd: true });
    repo.write(
      TODO_REL,
      [
        "<!-- header contract",
        "- [ ] Stage: PRD",
        "-->",
        "- [ ] Stage: PRD",
        "- [ ] Gate: prd",
        "",
      ].join("\n"),
    );
    const { code } = sync();
    expect(code).toBe(0);
    const content = repo.read(TODO_REL);
    // In-comment example untouched; the real lines trued.
    expect(content).toContain("<!-- header contract\n- [ ] Stage: PRD\n-->");
    expect(content).toContain("-->\n- [x] Stage: PRD");
    expect(content).toContain("- [x] Gate: prd");
  });

  it("checks a phase pointer when the linked dev spec is done", () => {
    seedSpec({ stage: "executing", prd: true, design: true, plan: true, evals: true });
    repo.write(
      "dev/dev-abc999-2026-07-24T10:41-phase-one.md",
      ["---", "hash: abc999", "type: dev", "status: done", "---", "body", ""].join("\n"),
    );
    repo.write(
      TODO_REL,
      [
        "- [x] Stage: PRD",
        "- [x] Gate: prd",
        "- [x] Stage: Design",
        "- [x] Gate: coverage(design)",
        "- [x] Stage: Plan",
        "- [x] Gate: coverage(plan)",
        "- [x] Stage: RED",
        "- [x] Gate: evals",
        "- [ ] Stage: Execute",
        "  - [ ] Phase 1: phase one → abc999",
        "- [ ] Stage: Retro",
        "- [ ] Stage: Outcome",
        "",
      ].join("\n"),
    );
    const { code, io } = sync();
    expect(code).toBe(0);
    expect((io.json() as SyncJson).trued).toEqual(["Phase 1 → checked"]);
    expect(repo.read(TODO_REL)).toContain("  - [x] Phase 1: phase one → abc999");
  });
});

describe("devx todo sync — error contract", () => {
  it("unknown hash exits 2 with nothing written", () => {
    seedSpec({ stage: "prd" });
    const { code, io } = sync("ffffff");
    expect(code).toBe(2);
    expect(io.stderr()).toContain("no plan spec for hash");
    expect(repo.exists(TODO_REL)).toBe(false);
  });

  it("usage error (no args) exits 2", () => {
    const io = captureIo();
    expect(runTodoSync([], { ...io, projectPath: repo.configPath })).toBe(2);
    expect(io.stderr()).toContain("usage: devx todo sync <hash>");
  });
});
