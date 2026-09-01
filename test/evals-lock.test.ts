// RED step-body locking — "fix the code, not the eval."
// Port of mycase/8am-harness #59 play 1.
import { describe, expect, it } from "vitest";

import {
  blocksVerification,
  evalsGuardDecision,
  isEvalArtifactPath,
  isResultOfRecordLine,
  stampEvalShas,
  stepBody,
  stepBodySha,
  verifyStepBodies,
} from "../src/lib/engine/evals-lock.js";

const EVAL = `# E-1 — usage window pauses the loop

**Status:** RED
**Last run:** 2026-08-31

## Steps

1. Drive the governor to 96% of the window.
2. Assert the loop refuses to claim a new item.

## Runs

| date | verdict | note |
|---|---|---|
| 2026-08-31 | RED | no governor yet |
`;

describe("isResultOfRecordLine", () => {
  it("recognizes the record fields", () => {
    expect(isResultOfRecordLine("**Status:** RED")).toBe(true);
    expect(isResultOfRecordLine("**Last run:** 2026-08-31")).toBe(true);
    expect(isResultOfRecordLine("- Result: pass")).toBe(true);
    expect(isResultOfRecordLine("| 2026-08-31 | RED | note |")).toBe(true);
  });

  it("does not swallow step content", () => {
    expect(isResultOfRecordLine("1. Drive the governor to 96%.")).toBe(false);
    expect(isResultOfRecordLine("## Steps")).toBe(false);
    expect(isResultOfRecordLine("Assert the status code is 200")).toBe(false);
  });
});

describe("stepBody / stepBodySha", () => {
  it("drops result-of-record lines from the body", () => {
    const b = stepBody(EVAL);
    expect(b).toContain("Drive the governor");
    expect(b).not.toContain("**Status:**");
    expect(b).not.toContain("2026-08-31 | RED");
  });

  it("is stable across a result-of-record update — the gate must stay runnable", () => {
    const after = EVAL.replace("**Status:** RED", "**Status:** GREEN").replace(
      "| 2026-08-31 | RED | no governor yet |",
      "| 2026-08-31 | RED | no governor yet |\n| 2026-09-01 | GREEN | governor landed |",
    );
    expect(stepBodySha(after)).toBe(stepBodySha(EVAL));
  });

  it("is stable across whitespace churn — the lock must not cry wolf", () => {
    const reflowed = EVAL.replace(/\n/g, "\r\n").replace("## Steps", "## Steps   ");
    expect(stepBodySha(reflowed)).toBe(stepBodySha(EVAL));
  });

  it("MOVES when a step is softened", () => {
    const softened = EVAL.replace(
      "Assert the loop refuses to claim a new item.",
      "Assert the loop logs a warning.",
    );
    expect(stepBodySha(softened)).not.toBe(stepBodySha(EVAL));
  });

  it("moves when a step is deleted outright", () => {
    const gutted = EVAL.replace("2. Assert the loop refuses to claim a new item.\n", "");
    expect(stepBodySha(gutted)).not.toBe(stepBodySha(EVAL));
  });
});

describe("verifyStepBodies", () => {
  const stamped = stampEvalShas({ "evals/E-1_window.md": EVAL });

  it("passes an untouched eval", () => {
    const f = verifyStepBodies(stamped, { "evals/E-1_window.md": EVAL });
    expect(f).toEqual([]);
    expect(blocksVerification(f)).toBe(false);
  });

  it("passes an eval whose only change is its recorded result", () => {
    const ran = EVAL.replace("**Status:** RED", "**Status:** GREEN");
    const f = verifyStepBodies(stamped, { "evals/E-1_window.md": ran });
    expect(f).toEqual([]);
  });

  it("flags a moved step body, naming the eval", () => {
    const softened = EVAL.replace("refuses to claim", "warns about claiming");
    const f = verifyStepBodies(stamped, { "evals/E-1_window.md": softened });
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("moved");
    expect(f[0].evalPath).toBe("evals/E-1_window.md");
    expect(f[0].message).toContain("fix the code, not the eval");
    expect(blocksVerification(f)).toBe(true);
  });

  it("flags a stamped eval that was deleted", () => {
    const f = verifyStepBodies(stamped, {});
    expect(f[0].kind).toBe("missing");
    expect(blocksVerification(f)).toBe(true);
  });

  it("reports an unstamped eval without blocking (grandfathering)", () => {
    const f = verifyStepBodies(stamped, {
      "evals/E-1_window.md": EVAL,
      "evals/E-2_new.md": "# E-2\n\n## Steps\n\n1. Something new.\n",
    });
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("unstamped");
    expect(blocksVerification(f)).toBe(false);
  });
});

describe("isEvalArtifactPath", () => {
  it("matches E-* files inside an evals dir", () => {
    expect(isEvalArtifactPath("_devx/workstreams/x/evals/E-1_thing.md")).toBe(true);
    expect(isEvalArtifactPath("/abs/repo/_devx/workstreams/x/evals/E-2.ts")).toBe(true);
    expect(isEvalArtifactPath("evals\\E-3.md")).toBe(true);
  });

  it("does not match the gate's own report or non-eval files", () => {
    expect(isEvalArtifactPath("_devx/workstreams/x/evals/RED-report.md")).toBe(false);
    expect(isEvalArtifactPath("_devx/workstreams/x/evals/notes.md")).toBe(false);
    expect(isEvalArtifactPath("src/evals.ts")).toBe(false);
    expect(isEvalArtifactPath("E-1.md")).toBe(false);
  });
});

describe("evalsGuardDecision", () => {
  const payload = {
    tool_name: "Edit",
    tool_input: { file_path: "/r/_devx/workstreams/x/evals/E-1_window.md" },
  };

  it("denies an edit to a locked eval, and says what to do instead", () => {
    const d = evalsGuardDecision({ payload, evalsRed: true });
    expect(d.deny).toBe(true);
    expect(d.reason).toContain("RED-locked");
    expect(d.reason).toContain("devx gate evals");
  });

  it("allows the same edit when the workstream is not RED-locked", () => {
    // An eval is fully writable while it is being authored — the lock is
    // scoped by STATE, not by path alone.
    expect(evalsGuardDecision({ payload, evalsRed: false }).deny).toBe(false);
  });

  it("allows edits to non-eval paths while locked", () => {
    const d = evalsGuardDecision({
      payload: { tool_name: "Edit", tool_input: { file_path: "src/lib/loop/driver.ts" } },
      evalsRed: true,
    });
    expect(d.deny).toBe(false);
  });

  it("allows read-shaped tools while locked", () => {
    const d = evalsGuardDecision({
      payload: {
        tool_name: "Read",
        tool_input: { file_path: "/r/_devx/workstreams/x/evals/E-1.md" },
      },
      evalsRed: true,
    });
    expect(d.deny).toBe(false);
  });

  it("allows on malformed input — the guard must never brick unrelated tool use", () => {
    expect(evalsGuardDecision({ payload: null, evalsRed: true }).deny).toBe(false);
    expect(evalsGuardDecision({ payload: "nope", evalsRed: true }).deny).toBe(false);
    expect(
      evalsGuardDecision({ payload: { tool_name: "Edit" }, evalsRed: true }).deny,
    ).toBe(false);
  });
});
