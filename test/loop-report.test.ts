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
        tokens: { input: 120_000, output: 40_000, cacheCreation: 0, cacheRead: 0, estimated: true },
        prUrl: "https://github.com/x/y/pull/70",
        diff: { filesChanged: 6, linesAdded: 210, linesDeleted: 12 },
        warnings: ["main is ahead of origin — push failed after a loop-owned commit: mock"],
      },
      {
        hash: "bbb222",
        type: "debug",
        title: "flaky test",
        specPath: "debug/debug-bbb222-2026-07-05T13:01-flaky.md",
        outcome: "abandoned",
        iterationsGood: 0,
        iterationsFailed: 3,
        tokens: { input: 50_000, output: 9_000, cacheCreation: 0, cacheRead: 0, estimated: true },
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
        tokens: { input: 30_000, output: 8_000, cacheCreation: 0, cacheRead: 0, estimated: true },
        prUrl: "https://github.com/x/y/pull/71",
        detail: "remote CI concluded 'failure' — not merging",
        lastFailure: "ci red on devx-ci.yml",
      },
    ],
    totals: { input: 200_000, output: 57_000, cacheCreation: 0, cacheRead: 0, estimated: true },
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

  it("per-merged-item: PR link, honest test-delta line, diff stat (LOW-14)", () => {
    expect(body).toContain("https://github.com/x/y/pull/70");
    // No dead tour plumbing — the review tour retired at tur101 and the loop
    // never parsed test counts; say the latter explicitly rather than
    // pretending, and say nothing at all about tours.
    expect(body).not.toContain("Tour:");
    expect(body).toContain("Test delta: not tracked (v1 bound)");
    expect(body).toContain("6 files, +210/-12");
  });

  it("loop-owned WARN lines reach the item section (LOW-10/LOW-11)", () => {
    expect(body).toContain("- WARN: main is ahead of origin — push failed after a loop-owned commit: mock");
  });

  it("non-merged items carry no test-delta noise", () => {
    // The honest-unavailable line is merged-item furniture; an abandoned
    // item's section must not render it.
    const section = body.split("### `bbb222`")[1].split("### ")[0];
    expect(section).not.toContain("Test delta:");
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
      summary({ totals: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0, estimated: false }, items: [] }),
    );
    expect(exact).toContain("**Tokens:** 10 in / 5 out");
    expect(exact).toContain("_No items were attempted._");
  });

  it("cache figures render as a breakdown when present (debug-494590)", () => {
    const exact = renderMorningReport(
      summary({
        totals: { input: 96_000, output: 168, cacheCreation: 2_400_000, cacheRead: 6_800_000, estimated: false },
        items: [],
      }),
    );
    expect(exact).toContain("**Tokens:** 96,000 in / 168 out (cache 2,400,000 write / 6,800,000 read)");
  });

  it("released items say environment failure — item not at fault, left ready (dc7514 AC6)", () => {
    const released = renderMorningReport(
      summary({
        abortReason:
          "environment failure: 3 consecutive report-less worker deaths (timeout/spawn, ~zero output) — the item is not at fault; aborting the run",
        stopReason: null,
        items: [
          {
            hash: "hng001",
            type: "dev",
            title: "innocent item",
            specPath: "dev/dev-hng001-2026-07-24T21:00-innocent.md",
            outcome: "released",
            leftState: "ready",
            iterationsGood: 0,
            iterationsFailed: 0,
            iterationsInfra: 3,
            tokens: { input: 1_500, output: 96, cacheCreation: 0, cacheRead: 0, estimated: true },
            detail: "environment failure: 3 consecutive report-less worker deaths",
          },
        ],
      }),
    );
    expect(released).toContain("released (environment failure — item not at fault, left ready)");
    expect(released).toContain("3 infra (environment — not charged to the item)");
    expect(released).toContain("1 released (environment)");
    // Next steps route to the environment, not the item.
    expect(released).toMatch(/fix the environment/);
  });

  it("ownership-lost releases say the backlog was left untouched — never 'left ready' (review MED)", () => {
    const body = renderMorningReport(
      summary({
        items: [
          {
            hash: "own001",
            type: "dev",
            title: "stolen claim",
            specPath: "dev/dev-own001-2026-07-24T21:00-stolen.md",
            outcome: "released",
            // no leftState — the rollback was deliberately skipped
            iterationsGood: 0,
            iterationsFailed: 0,
            tokens: { input: 100, output: 10, cacheCreation: 0, cacheRead: 0, estimated: true },
            detail: "environment failure; claim ownership lost mid-run — spec/backlog left untouched",
          },
        ],
      }),
    );
    expect(body).toContain("claim ownership lost; backlog left untouched");
    expect(body).not.toContain("released (environment failure — item not at fault, left ready)");
    expect(body).toContain("verify the current owner");
  });

  it("abandoned-to-ready items (bookkeeping-only worktree discarded) render distinctly (dc7514 AC4)", () => {
    const body = renderMorningReport(
      summary({
        items: [
          {
            hash: "hyg001",
            type: "dev",
            title: "failed clean",
            specPath: "dev/dev-hyg001-2026-07-24T21:00-clean.md",
            outcome: "abandoned",
            leftState: "ready",
            iterationsGood: 0,
            iterationsFailed: 3,
            tokens: { input: 1_000, output: 500, cacheCreation: 0, cacheRead: 0, estimated: true },
            lastFailure: "tests never passed",
            detail: "3 consecutive failures on this item",
          },
        ],
      }),
    );
    expect(body).toContain("abandoned (nothing preserved — left ready)");
    expect(body).not.toContain("Preserved worktree:");
    expect(body).toMatch(/left `\[ \]` ready/);
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

// ---------------------------------------------------------------------------
// The `split` outcome (mss103)
// ---------------------------------------------------------------------------

describe("renderMorningReport — split outcome (mss103)", () => {
  const splitItem = (over: Partial<RunSummary["items"][number]> = {}) => ({
    hash: "spl111",
    type: "dev",
    title: "big thing",
    specPath: "dev/dev-spl111-2026-07-05T13:00-big.md",
    outcome: "split" as const,
    leftState: "ready" as const,
    iterationsGood: 3,
    iterationsFailed: 0,
    tokens: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0, estimated: false },
    followUpSpecPath: "dev/dev-fol222-2026-07-06T02:00-continue-big-thing.md",
    detail: "iteration budget exhausted (8 iterations without acs_met)",
    ...over,
  });

  it("labels the outcome, renders the follow-up path, and counts it in the header", () => {
    const body = renderMorningReport(summary({ items: [splitItem()] }));
    expect(body).toContain(
      "**split (budget exhausted with real progress — follow-up spec filed)**",
    );
    expect(body).toContain("- Follow-up: `dev/dev-fol222-2026-07-06T02:00-continue-big-thing.md`");
    expect(body).toContain("· 1 split");
  });

  it("next steps name the claimable follow-up hash as a /devx command", () => {
    const body = renderMorningReport(summary({ items: [splitItem()] }));
    expect(body).toContain("split → follow-up ready: `/devx fol222`");
    expect(body).toContain("the parent is superseded");
  });

  it("falls back to a literal <hash> placeholder when the follow-up path is unparseable", () => {
    const body = renderMorningReport(
      summary({ items: [splitItem({ followUpSpecPath: "not-a-spec-path" })] }),
    );
    expect(body).toContain("`/devx <hash>`");
    expect(body).toContain("- Follow-up: `not-a-spec-path`");
  });

  it("omits the split count from the header when no item split (no zero-noise)", () => {
    expect(renderMorningReport(summary())).not.toContain("split");
  });

  it("a merged item whose split FAILED reads as reduced-scope + blocked, not a clean merge (AA-7)", () => {
    const body = renderMorningReport(
      summary({
        items: [
          {
            hash: "red111",
            type: "dev",
            title: "reduced thing",
            specPath: "dev/dev-red111-2026-07-05T13:00-reduced.md",
            outcome: "merged",
            leftState: "blocked",
            iterationsGood: 2,
            iterationsFailed: 0,
            tokens: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0, estimated: false },
            prUrl: "https://github.com/x/y/pull/72",
          },
        ],
      }),
    );
    expect(body).toContain("**merged at reduced scope — split FAILED, spec left blocked**");
    expect(body).toContain("merged at REDUCED SCOPE but its split failed");
    expect(body).toContain("devx split red111");
    // The clean-merge next step must NOT also fire for this item.
    expect(body).not.toContain("verify the merge claim for `red111`");
  });
});
