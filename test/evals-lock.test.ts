import { createHash } from "node:crypto";
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
    expect(stepBodySha("evals/E-1.md", after)).toBe(stepBodySha("evals/E-1.md", EVAL));
  });

  it("is stable across whitespace churn — the lock must not cry wolf", () => {
    const reflowed = EVAL.replace(/\n/g, "\r\n").replace("## Steps", "## Steps   ");
    expect(stepBodySha("evals/E-1.md", reflowed)).toBe(stepBodySha("evals/E-1.md", EVAL));
  });

  it("MOVES when a step is softened", () => {
    const softened = EVAL.replace(
      "Assert the loop refuses to claim a new item.",
      "Assert the loop logs a warning.",
    );
    expect(stepBodySha("evals/E-1.md", softened)).not.toBe(stepBodySha("evals/E-1.md", EVAL));
  });

  it("moves when a step is deleted outright", () => {
    const gutted = EVAL.replace("2. Assert the loop refuses to claim a new item.\n", "");
    expect(stepBodySha("evals/E-1.md", gutted)).not.toBe(stepBodySha("evals/E-1.md", EVAL));
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

// ---------------------------------------------------------------------------
// Review of #164 — AC 4 and the non-md normalization (both were untested:
// reverting either passed the whole suite, mutations M9 / M2).
// ---------------------------------------------------------------------------

describe("lockableBody — non-markdown evals (review of #164)", () => {
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

  it("AC 4: a .ts eval is hashed WHOLE — a `| … |` line is step body, not result of record", () => {
    // stepBody() strips table rows as Runs-table results. Applied to source
    // that would silently drop a real line from the eval's own hash.
    const src = "const rows = `\n| date | RED |\n`;\nexpect(run()).toBe(1);\n";
    const edited = src.replace("| date | RED |", "| date | GREEN |");
    expect(stepBodySha("test/e.test.ts", edited)).not.toBe(stepBodySha("test/e.test.ts", src));
    // …whereas in markdown the same line IS a Runs row and is stripped.
    expect(stepBodySha("evals/E-1.md", edited)).toBe(stepBodySha("evals/E-1.md", src));
  });

  it("F: CRLF and trailing whitespace do not change a non-md eval's sha", () => {
    const lf = "process.exit(1);\nconst x = 1;\n";
    expect(stepBodySha("test/e.test.mjs", "process.exit(1);\r\nconst x = 1;  \r\n")).toBe(
      stepBodySha("test/e.test.mjs", lf),
    );
  });

  it("F: normalization is the IDENTITY on a clean LF file — every existing stamp still verifies", () => {
    // The guarantee that makes the normalization safe to ship: a stamp taken
    // before it (sha256 of the raw bytes) is unchanged for any file that was
    // already LF with no trailing whitespace.
    const clean = "import { run } from './x';\n\nexpect(run()).toBe(1);\n";
    expect(stepBodySha("test/e.test.ts", clean)).toBe(sha(clean));
  });

  it("F: a real edit to a non-md eval still changes its sha", () => {
    const a = "process.exit(1);\n";
    expect(stepBodySha("test/e.test.mjs", "process.exit(0);\n")).not.toBe(stepBodySha("test/e.test.mjs", a));
  });
});
