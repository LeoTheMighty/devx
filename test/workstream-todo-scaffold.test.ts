// E-1 permanent suite (hfi101, workstream harness-fold-in): the todo.md
// scaffold honors the parse contract. A fresh `createWorkstream` scaffold
// writes todo.md with 100% of the lifecycle skeleton in template order, and
// `parseTodo` extracts every lifecycle item with 0 unparsed top-level lines.
// Acceptance twin: _devx/workstreams/harness-fold-in/evals/E-1_todo-scaffold.ts.
//
// Spec: dev/dev-hfi101-2026-07-24T10:41-todo-core.md

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";
import { DERIVED_LINE_RE, parseTodo } from "../src/lib/engine/todo.js";
import { createWorkstream } from "../src/lib/engine/workstream.js";
import { type EngineRepo, REAL_REPO_ROOT, makeEngineRepo } from "./fixtures/engine-repo.js";

// The fixed skeleton from design §"todo.md parse contract" — template order.
const SKELETON = [
  "- [ ] Stage: PRD",
  "- [ ] Gate: prd",
  "- [ ] Stage: Design",
  "- [ ] Gate: coverage(design)",
  "- [ ] Stage: Plan",
  "- [ ] Gate: coverage(plan)",
  "- [ ] Stage: RED",
  "- [ ] Gate: evals",
  "- [ ] Stage: Execute",
  "- [ ] Stage: Retro",
  "- [ ] Stage: Outcome",
];

/** Every top-level checkbox line, in file order. */
function topLevelCheckboxes(content: string): string[] {
  return content.split("\n").filter((l) => l.startsWith("- ["));
}

function expectSkeleton(content: string): void {
  const topLevel = topLevelCheckboxes(content);
  // 100% of skeleton items, in template order, nothing extra at top level.
  expect(topLevel).toEqual(SKELETON);
  for (const line of topLevel) {
    expect(line, `'${line}' violates the parse contract regex`).toMatch(
      DERIVED_LINE_RE,
    );
  }
}

describe("shipped template _devx/templates/engine/todo.md", () => {
  const template = readFileSync(
    join(REAL_REPO_ROOT, "_devx", "templates", "engine", "todo.md"),
    "utf8",
  );

  it("opens with the header-contract HTML comment", () => {
    expect(template.startsWith("<!--")).toBe(true);
    expect(template).toContain("Never a gate input");
  });

  it("carries the 11-line lifecycle skeleton in template order", () => {
    expectSkeleton(template);
  });
});

describe("fresh createWorkstream scaffold (E-1)", () => {
  let repo: EngineRepo;
  beforeEach(() => {
    repo = makeEngineRepo();
  });
  afterEach(() => repo.cleanup());

  function scaffold() {
    return createWorkstream({
      repoRoot: repo.root,
      slug: "e1-fixture",
      hash: "abc123",
      engine: ENGINE_DEFAULTS,
      now: () => new Date(2026, 6, 24, 10, 41, 0),
    });
  }

  it("writes todo.md with the full skeleton in template order", () => {
    const result = scaffold();
    expect(result.created.todo).toBe(true);
    const content = repo.read("_devx/workstreams/e1-fixture/todo.md");
    expectSkeleton(content);
  });

  it("parseTodo extracts all lifecycle items with 0 unparsed top-level lines", () => {
    scaffold();
    const doc = parseTodo(repo.read("_devx/workstreams/e1-fixture/todo.md"));
    expect(doc.unparsedTopLevel).toEqual([]);
    const lifecycle = doc.items.filter(
      (i) => i.kind === "stage" || i.kind === "gate",
    );
    expect(lifecycle).toHaveLength(SKELETON.length);
    expect(lifecycle.every((i) => !i.checked)).toBe(true);
    expect(
      doc.items.filter((i) => i.kind === "gate").map((i) => i.label),
    ).toEqual(["prd", "coverage(design)", "coverage(plan)", "evals"]);
  });

  it("re-run is write-if-missing: hand-edited todo.md survives untouched", () => {
    scaffold();
    const rel = "_devx/workstreams/e1-fixture/todo.md";
    const edited = repo.read(rel) + "  - [ ] a hand-written free item\n";
    repo.write(rel, edited);
    const second = scaffold();
    expect(second.created.todo).toBe(false);
    expect(second.noop).toBe(true);
    expect(repo.read(rel)).toBe(edited);
  });
});
