// Morning report rendering + write-both-copies (v2l101 —
// src/lib/loop/report.ts). Includes the golden-shape test the spec AC pins.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  renderMorningReport,
  writeMorningReport,
  type RunSummary,
} from "../src/lib/loop/report.js";
import { reportPath, reportsCopyPath } from "../src/lib/loop/state.js";

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: "loop-2026-07-05T22-00-00-000-77",
    mode: "YOLO",
    startedAt: "2026-07-05T22:00:00.000Z",
    endedAt: "2026-07-06T07:30:00.000Z",
    abortReason: null,
    stopReason: "--until deadline reached (07:30)",
    budgets: {
      maxItems: 10,
      maxTotalTokens: 10_000_000,
      maxIterationsPerItem: 8,
      maxTokensPerItem: 2_000_000,
      until: "2026-07-06T07:30:00.000Z",
    },
    items: [
      {
        hash: "aaa111",
        type: "dev",
        title: "ship the widget",
        specPath: "dev/dev-aaa111-2026-07-05T13:00-widget.md",
        outcome: "merged",
        iterationsGood: 4,
        iterationsFailed: 1,
        tokens: { input: 120_000, output: 40_000, estimated: true },
        prUrl: "https://github.com/x/y/pull/70",
        tourUrl: "https://htmlpreview.github.io/?tour",
        diff: { filesChanged: 6, linesAdded: 210, linesDeleted: 12 },
      },
      {
        hash: "bbb222",
        type: "debug",
        title: "flaky test",
        specPath: "debug/debug-bbb222-2026-07-05T13:01-flaky.md",
        outcome: "abandoned",
        iterationsGood: 0,
        iterationsFailed: 3,
        tokens: { input: 50_000, output: 9_000, estimated: true },
        worktreePath: ".worktrees/debug-bbb222",
        lastFailure: "test still flakes under --repeat 50",
        detail: "3 consecutive failures on this item",
      },
      {
        hash: "ccc333",
        type: "dev",
        title: "half-done thing",
        specPath: "dev/dev-ccc333-2026-07-05T13:02-half.md",
        outcome: "handed-off",
        iterationsGood: 2,
        iterationsFailed: 0,
        tokens: { input: 30_000, output: 8_000, estimated: true },
        prUrl: "https://github.com/x/y/pull/71",
        detail: "remote CI concluded 'failure' — not merging",
        lastFailure: "ci red on devx-ci.yml",
      },
    ],
    totals: { input: 200_000, output: 57_000, estimated: true },
    ...overrides,
  };
}

describe("renderMorningReport (v2/04 §5)", () => {
  const body = renderMorningReport(summary());

  it("carries the header counts: attempted/merged/handed-off/abandoned/blocked", () => {
    expect(body).toContain(
      "**Items:** 3 attempted · 1 merged · 1 handed off · 1 abandoned · 0 blocked on human",
    );
  });

  it("prefixes estimated tokens with ~ (never presents estimates as facts)", () => {
    expect(body).toContain("**Tokens:** ~200,000 in / ~57,000 out");
  });

  it("shows wall-clock duration", () => {
    expect(body).toContain("Ran 9h 30m");
  });

  it("per-merged-item: PR link, tour link, diff stat", () => {
    expect(body).toContain("https://github.com/x/y/pull/70");
    expect(body).toContain("https://htmlpreview.github.io/?tour");
    expect(body).toContain("6 files, +210/-12");
  });

  it("per-abandoned-item: preserved worktree path + last failure", () => {
    expect(body).toContain("Preserved worktree: `.worktrees/debug-bbb222`");
    expect(body).toContain("Last failure: test still flakes under --repeat 50");
  });

  it("hands-off items say NOT merged, loudly", () => {
    expect(body).toContain("handed off (PR open, NOT merged)");
  });

  it("carries the claims-not-verdicts discipline line (D-11)", () => {
    expect(body).toMatch(/claims.*reconstruct from disk/i);
  });

  it("next steps include exact reproduce/review commands", () => {
    expect(body).toContain("`devx next`");
    expect(body).toContain("gh pr view https://github.com/x/y/pull/70");
    expect(body).toContain("git -C .worktrees/debug-bbb222 log --oneline");
  });

  it("stop reason renders when not aborted", () => {
    expect(body).toContain("Stopped: --until deadline reached (07:30).");
    expect(body).not.toContain("ABORTED");
  });

  it("abort reason renders loudly when aborted", () => {
    const aborted = renderMorningReport(
      summary({ abortReason: "permanent error (credits/auth) — aborting the loop now", stopReason: null }),
    );
    expect(aborted).toContain("**ABORTED: permanent error (credits/auth)");
  });

  it("non-estimated tokens render without the ~ prefix", () => {
    const exact = renderMorningReport(
      summary({ totals: { input: 10, output: 5, estimated: false }, items: [] }),
    );
    expect(exact).toContain("**Tokens:** 10 in / 5 out");
    expect(exact).toContain("_No items were attempted._");
  });
});

describe("writeMorningReport", () => {
  let cacheDir: string;
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "devx-loop-report-"));
  });
  afterEach(() => rmSync(cacheDir, { recursive: true, force: true }));

  it("writes BOTH the run-dir copy and the dispatcher-probed reports/ copy", () => {
    const s = summary();
    const primary = writeMorningReport(cacheDir, s);
    expect(primary).toBe(reportPath(cacheDir, s.runId));
    expect(existsSync(reportPath(cacheDir, s.runId))).toBe(true);
    expect(existsSync(reportsCopyPath(cacheDir, s.runId))).toBe(true);
    expect(readFileSync(reportsCopyPath(cacheDir, s.runId), "utf8")).toBe(
      readFileSync(reportPath(cacheDir, s.runId), "utf8"),
    );
    expect(reportsCopyPath(cacheDir, s.runId).endsWith(".md")).toBe(true);
  });
});
