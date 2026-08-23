// E-5 permanent suite (hfi103): the current-focus line derives from the
// FRONTMATTER stage, never from checkbox state. renderFocusLine roots the
// walk at the stage's skeleton section on all three fixtures (mid-intake,
// mid-execute, stale hand-checked stage parent — the checkbox must not
// move the focus head), and the absent-file contract holds at the CLI:
// exit 0, no focus line rendered, focus null in the JSON.
//
// Spec: dev/dev-hfi103-2026-07-24T10:41-todo-sync-renderers-status.md
// Eval: _devx/workstreams/harness-fold-in/evals/E-5_next-current-focus.ts

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runNext } from "../src/commands/next.js";
import { runStatus } from "../src/commands/status.js";
import { renderFocusLine } from "../src/lib/engine/render.js";
import { parseTodo } from "../src/lib/engine/todo.js";
import { type EngineRepo, captureIo, makeEngineRepo, validPrd } from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// The three fixtures (mirroring the E-5 eval verbatim)
// ---------------------------------------------------------------------------

const MID_INTAKE = [
  "- [ ] Stage: PRD",
  "  - [x] interview the user",
  "  - [ ] promote the evals seed",
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
  "",
].join("\n");

const MID_EXECUTE = [
  "- [x] Stage: PRD",
  "- [x] Gate: prd",
  "- [x] Stage: Design",
  "- [x] Gate: coverage(design)",
  "- [x] Stage: Plan",
  "- [x] Gate: coverage(plan)",
  "- [x] Stage: RED",
  "- [x] Gate: evals",
  "- [ ] Stage: Execute",
  "  - [x] Phase 1: ground layer → abc123",
  "  - [ ] Phase 2: verdicts → def456",
  "- [ ] Stage: Retro",
  "- [ ] Stage: Outcome",
  "",
].join("\n");

// Someone hand-checked the Stage: Design parent AND left an unchecked free
// item under PRD — with stage=executing the focus must still come from the
// Execute section (checkbox state never roots the walk).
const STALE_HAND_CHECKED = [
  "- [ ] Stage: PRD",
  "  - [ ] a stale unchecked intake leftover",
  "- [x] Gate: prd",
  "- [x] Stage: Design",
  "- [x] Gate: coverage(design)",
  "- [x] Stage: Plan",
  "- [x] Gate: coverage(plan)",
  "- [x] Stage: RED",
  "- [x] Gate: evals",
  "- [ ] Stage: Execute",
  "  - [ ] Phase 1: ground layer → abc123",
  "- [ ] Stage: Retro",
  "- [ ] Stage: Outcome",
  "",
].join("\n");

describe("E-5 — renderFocusLine roots at the frontmatter stage", () => {
  it("mid-intake (stage prd): first unchecked deepest item under Stage: PRD", () => {
    expect(renderFocusLine(parseTodo(MID_INTAKE), "prd")).toBe(
      "focus: promote the evals seed",
    );
  });

  it("mid-execute (stage executing): the unchecked Phase 2 pointer", () => {
    expect(renderFocusLine(parseTodo(MID_EXECUTE), "executing")).toBe(
      "focus: Phase 2: verdicts → def456",
    );
  });

  it("stale hand-checked parent must not move the focus head", () => {
    expect(renderFocusLine(parseTodo(STALE_HAND_CHECKED), "executing")).toBe(
      "focus: Phase 1: ground layer → abc123",
    );
  });

  it("null doc (absent todo.md) and retired stage render no line", () => {
    expect(renderFocusLine(null, "prd")).toBeNull();
    expect(renderFocusLine(parseTodo(MID_INTAKE), "retired")).toBeNull();
    expect(renderFocusLine(parseTodo(MID_INTAKE), null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CLI wiring — both `devx next` forms + `devx status`
// ---------------------------------------------------------------------------

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const SPEC_REL = "plan/plan-abc123-2026-07-24T10:41-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";

function seedWorkstream(stage: string): void {
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${stage}`,
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

describe("E-5 — focus line at the CLI surfaces", () => {
  it("repo-level `devx next` renders the focus line under the row-9 decision", () => {
    seedWorkstream("prd");
    repo.write(`${WS}/todo.md`, MID_INTAKE);
    const io = captureIo();
    const code = runNext(["--no-gh"], { ...io, projectPath: repo.configPath });
    expect(code).toBe(0);
    const json = io.json() as { row: number; focus: string | null };
    expect(json.row).toBe(9);
    expect(json.focus).toBe("focus: promote the evals seed");
    expect(io.stderr()).toContain("  focus: promote the evals seed");
  });

  it("workstream-form `devx next <hash>` carries focus in the JSON (stage executing)", () => {
    seedWorkstream("executing");
    repo.write(`${WS}/todo.md`, MID_EXECUTE);
    const io = captureIo();
    const code = runNext(["abc123"], { ...io, projectPath: repo.configPath });
    expect(code).toBe(0);
    expect((io.json() as { focus: string | null }).focus).toBe(
      "focus: Phase 2: verdicts → def456",
    );
  });

  it("absent todo.md: exit 0, focus null, no focus line rendered anywhere", () => {
    seedWorkstream("prd");

    const repoForm = captureIo();
    expect(runNext(["--no-gh"], { ...repoForm, projectPath: repo.configPath })).toBe(0);
    expect((repoForm.json() as { focus: string | null }).focus).toBeNull();
    expect(repoForm.stderr()).not.toContain("focus:");

    const wsForm = captureIo();
    expect(runNext(["abc123"], { ...wsForm, projectPath: repo.configPath })).toBe(0);
    expect((wsForm.json() as { focus: string | null }).focus).toBeNull();

    const status = captureIo();
    expect(runStatus({ ...status, projectPath: repo.configPath })).toBe(0);
    expect(status.stdout()).toContain("demo-feature (abc123)  stage: prd");
    expect(status.stdout()).not.toContain("focus:");
  });

  it("`devx status` renders stage + gate summary + focus per active workstream", () => {
    seedWorkstream("executing");
    repo.write(`${WS}/todo.md`, MID_EXECUTE);
    const io = captureIo();
    expect(runStatus({ ...io, projectPath: repo.configPath })).toBe(0);
    const outText = io.stdout();
    expect(outText).toContain("demo-feature (abc123)  stage: executing");
    expect(outText).toContain("gates: prd — · design — · plan — · evals —");
    expect(outText).toContain("focus: Phase 2: verdicts → def456");
  });

  it("`devx status` skips done/retired workstreams (no active → says so)", () => {
    seedWorkstream("retired");
    const io = captureIo();
    expect(runStatus({ ...io, projectPath: repo.configPath })).toBe(0);
    expect(io.stdout()).toBe("no active workstreams\n");
  });
});
