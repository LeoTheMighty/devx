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
    // debug-evlk01 H: a table row is NOT decided line by line any more — it
    // is result of record only inside a `Runs` section, which stepBody tracks.
    expect(isResultOfRecordLine("| 2026-08-31 | RED | note |")).toBe(false);
  });

  it("debug-evlk01 H: `Run:` is a step, not a result of record", () => {
    expect(isResultOfRecordLine("Run: node bench.mjs --lines 10000")).toBe(false);
    expect(isResultOfRecordLine("**Run:** npx vitest run test/e2e")).toBe(false);
    expect(isResultOfRecordLine("Expected: p95 under 8s")).toBe(false);
    expect(isResultOfRecordLine("Threshold: 100% of PRs")).toBe(false);
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
    // debug-evlk01 D: the sanctioned path for a genuinely changed expectation
    // is `devx revise`. This used to assert the message recommended re-running
    // `devx gate evals` — the path that cannot re-stamp an eval once it passes,
    // so the test was pinning the very advice decision D ruled out.
    expect(d.reason).toContain("devx revise");
    expect(d.reason).not.toMatch(/re-run `devx gate evals[^`]*` — that is the sanctioned path/);
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
    // …whereas in markdown the same row, under a `## Runs` heading, IS a Runs
    // row and is stripped (debug-evlk01 H scopes stripping to that section).
    const md = "# E-1\n\n## Runs\n\n| date | RED |\n";
    expect(stepBodySha("evals/E-1.md", md.replace("RED", "GREEN"))).toBe(stepBodySha("evals/E-1.md", md));
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

// ---------------------------------------------------------------------------
// debug-evlk01 H — what a markdown eval locks (Leo's decision, 2026-09-21)
// ---------------------------------------------------------------------------

describe("stepBody — the evlk01 result-of-record convention", () => {
  const p = "_devx/workstreams/demo/evals/E-3_perf.md";
  const base = [
    "# E-3 perf",
    "",
    "## Steps",
    "",
    "Run: node bench.mjs --lines 10000",
    "Expected: p95 under 8s",
    "",
    "| step | limit |",
    "|---|---|",
    "| build | < 8s |",
    "",
    "## Runs",
    "",
    "| date | verdict |",
    "|---|---|",
    "| 2026-09-21 | RED |",
    "",
    "Result: p95 was 11s",
    "Status: RED",
    "",
  ].join("\n");
  const sha = (s: string) => stepBodySha(p, s);

  it("locks the command: `Run: --lines 10000` → `--lines 10` reads as moved", () => {
    // The reproduced bypass: before evlk01 this gave an IDENTICAL sha.
    expect(sha(base.replace("--lines 10000", "--lines 10"))).not.toBe(sha(base));
  });

  it("locks the bar: `Expected:` is a step", () => {
    expect(sha(base.replace("under 8s", "under 800s"))).not.toBe(sha(base));
  });

  it("locks a table OUTSIDE a Runs section (a steps / thresholds table)", () => {
    expect(sha(base.replace("| build | < 8s |", "| build | < 800s |"))).not.toBe(sha(base));
  });

  it("leaves the Runs table writable — recording a run is not an edit", () => {
    const recorded = base.replace(
      "| 2026-09-21 | RED |",
      "| 2026-09-21 | RED |\n| 2026-09-22 | GREEN |",
    );
    expect(sha(recorded)).toBe(sha(base));
  });

  it("leaves `Result:` (the OBSERVED result) and `Status:` writable", () => {
    const after = base.replace("p95 was 11s", "p95 was 6s").replace("Status: RED", "Status: GREEN");
    expect(sha(after)).toBe(sha(base));
  });

  it("a Runs section ends at the next heading of the same level", () => {
    // A table after the Runs section closes is a step again.
    const withAfter = `${base}\n## Notes\n\n| k | v |\n|---|---|\n| a | 1 |\n`;
    expect(sha(withAfter.replace("| a | 1 |", "| a | 2 |"))).not.toBe(sha(withAfter));
  });

  it("a deeper sub-heading stays inside the Runs section", () => {
    const nested = base.replace(
      "## Runs\n",
      "## Runs\n\n### 2026-09\n",
    );
    const recorded = nested.replace("| 2026-09-21 | RED |", "| 2026-09-21 | RED |\n| 2026-09-30 | GREEN |");
    expect(sha(recorded)).toBe(sha(nested));
  });
});

// ---------------------------------------------------------------------------
// Phase 4 review of debug-evlk01 — stepBody boundaries.
// ---------------------------------------------------------------------------

describe("stepBody — Phase 4 of evlk01", () => {
  const p = "_devx/workstreams/demo/evals/E-3_perf.md";
  const sha = (s: string) => stepBodySha(p, s);
  const THRESH = "## Thresholds\n\n| p95 | < 8s |\n";

  it("M1: a `# Runs` comment inside a fenced code block does NOT open a Runs section", () => {
    const md = "## Steps\n\n```bash\n# Runs the benchmark\nnode bench.mjs\n```\n\n| p95 | < 8s |\n";
    expect(sha(md.replace("< 8s", "< 800s"))).not.toBe(sha(md));
  });

  it("M1: a fenced `## Runs` does not either", () => {
    const md = "## Steps\n\n```md\n## Runs\n```\n\n### Thresholds\n\n| p95 | < 8s |\n";
    expect(sha(md.replace("< 8s", "< 800s"))).not.toBe(sha(md));
  });

  it("M1: a fence inside a Runs section does not close it", () => {
    const md = "## Runs\n\n```\n# re-run with --verbose\n```\n\n| 2026-09-21 | RED |\n";
    expect(sha(md.replace("| 2026-09-21 | RED |", "| 2026-09-21 | RED |\n| 2026-09-22 | GREEN |"))).toBe(sha(md));
  });

  it("M1: `Result:` and `Status:` inside a fence are code, so they are locked", () => {
    const md = "## Steps\n\n```\nResult: must be under 8s\n```\n";
    expect(sha(md.replace("under 8s", "under 800s"))).not.toBe(sha(md));
  });

  it("M1: a 4-space-indented `# Runs` is a code line, not a heading", () => {
    const md = `## Steps\n\n    # Runs the bench\n\n${THRESH}`.replace("## Thresholds\n\n", "");
    expect(sha(md.replace("< 8s", "< 800s"))).not.toBe(sha(md));
  });

  it("M2: `Runs per worker` and `Runs-per-second thresholds` are NOT Runs sections", () => {
    for (const h of ["## Runs per worker", "## Runs-per-second thresholds", "## Runs and thresholds"]) {
      const md = `${h}\n\n| p95 | < 8s |\n`;
      expect(sha(md.replace("< 8s", "< 800s"))).not.toBe(sha(md));
    }
  });

  it("M2: `Runs`, `Runs (2026)`, `Runs:` and `## Runs ##` ARE Runs sections", () => {
    for (const h of ["## Runs", "## Runs (2026)", "## Runs:", "## Runs ##", "### runs"]) {
      const md = `${h}\n\n| 2026-09-21 | RED |\n`;
      expect(sha(md.replace("| 2026-09-21 | RED |", "| 2026-09-21 | RED |\n| 2026-09-22 | GREEN |"))).toBe(sha(md));
    }
  });

  it("L3: a setext `Runs` heading is recognized, so recording a run is not a change", () => {
    const md = "Runs\n----\n\n| 2026-09-21 | RED |\n";
    expect(sha(md.replace("| 2026-09-21 | RED |", "| 2026-09-21 | RED |\n| 2026-09-22 | GREEN |"))).toBe(sha(md));
  });

  it("L3: `Status:` over a `---` rule is still a result line, not a heading", () => {
    const md = "# E-1\n\nStatus: RED\n---\n\n## Steps\n\n1. do it\n";
    expect(sha(md.replace("Status: RED", "Status: GREEN"))).toBe(sha(md));
  });

  it("L3: a `Runs:` field line is result of record; `Run:` still is not", () => {
    expect(isResultOfRecordLine("Runs: 3")).toBe(true);
    expect(isResultOfRecordLine("Run: node bench.mjs")).toBe(false);
  });
});
