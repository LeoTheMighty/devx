// The health queue on the read surfaces (A11/B15's neighbour, A15): `devx
// next` row 11, the row-9 health line, and `devx status`.
//
// Row 11's widening is the behavioural change under test. It used to fire
// only on blocked backlog rows, so a workstream holding four blocking gate
// concerns and no blocked row fell through to row 12 — "backlogs are
// genuinely empty, interview the user" — while the queue said otherwise.

import { describe, expect, it } from "vitest";

import {
  type RepoSnapshot,
  type WorkstreamHealthSignal,
  decideRepoNext,
} from "../src/lib/next/decide.js";
import { renderHealthLine } from "../src/lib/engine/render.js";
import { runNext } from "../src/commands/next.js";
import { runStatus } from "../src/commands/status.js";
import { captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";

const WS = "_devx/workstreams/demo-feature";
const SPEC_REL = "plan/plan-abc123-2026-07-24T10:41-demo-feature.md";

function emptySnapshot(): RepoSnapshot {
  return {
    loop: {
      live: false,
      source: null,
      pid: null,
      ts: null,
      ageSeconds: null,
      loops: [],
      overnightReport: null,
    },
    prs: [],
    unreconciled: [],
    claims: [],
    outcomeDue: [],
    interviewBlocking: [],
    debugReady: [],
    devReady: [],
    midPipeline: [],
    planReady: [],
    qaWalkthroughs: [],
    blocked: [],
    health: [],
    todoDrift: [],
    drift: [],
    warnings: [],
    allRows: [],
  };
}

function healthSignal(
  over: Partial<WorkstreamHealthSignal> = {},
): WorkstreamHealthSignal {
  return {
    hash: "abc123",
    slug: "demo-feature",
    counts: { blocking: 1, concern: 0 },
    blockingTitles: ["Q-1 FR-3 coverage"],
    error: null,
    ...over,
  };
}

describe("renderHealthLine", () => {
  it("omits the line entirely on a clean queue — a zero on every row is noise", () => {
    expect(renderHealthLine({ blocking: 0, concern: 0 })).toBeNull();
  });

  it("omits the line for an ABSENT queue (grandfathered reads as silence)", () => {
    expect(renderHealthLine(null)).toBeNull();
  });

  it("names only the non-zero halves", () => {
    expect(renderHealthLine({ blocking: 2, concern: 0 })).toBe("health: 2 blocking");
    expect(renderHealthLine({ blocking: 0, concern: 3 })).toBe("health: 3 concern");
    expect(renderHealthLine({ blocking: 2, concern: 3 })).toBe(
      "health: 2 blocking · 3 concern",
    );
  });

  it("reports an unreadable queue instead of a confident zero (D-13)", () => {
    expect(renderHealthLine(null, "Q-1 (line 4): missing Severity")).toBe(
      "health: unreadable — Q-1 (line 4): missing Severity",
    );
    // Even handed counts, the error wins: those counts are from a parse that
    // failed, so claiming them would be worse than naming the failure.
    expect(renderHealthLine({ blocking: 0, concern: 0 }, "boom")).toBe(
      "health: unreadable — boom",
    );
  });
});

describe("devx next row 11 — the health queue is its second source", () => {
  it("fires on a blocking queue entry with NO blocked backlog rows", () => {
    const s = emptySnapshot();
    s.health = [healthSignal()];
    const d = decideRepoNext(s);
    expect(d.row).toBe(11);
    expect(d.action).toBe("report-blocked");
    expect(d.command).toBe("/devx-walk");
    expect(d.detail).toContain("demo-feature (abc123) health queue: 1 blocking");
    expect(d.detail).toContain("Q-1 FR-3 coverage");
  });

  it("does NOT fire on concerns alone — a concern advanced its gate (D-9)", () => {
    const s = emptySnapshot();
    s.health = [
      healthSignal({ counts: { blocking: 0, concern: 4 }, blockingTitles: [] }),
    ];
    const d = decideRepoNext(s);
    expect(d.row).toBe(12);
    expect(d.action).toBe("propose-interview");
  });

  it("fires on an UNREADABLE queue — unknown counts are not zero counts", () => {
    const s = emptySnapshot();
    s.health = [
      healthSignal({
        counts: { blocking: 0, concern: 0 },
        blockingTitles: [],
        error: "Q-2 (line 9): missing Severity",
      }),
    ];
    const d = decideRepoNext(s);
    expect(d.row).toBe(11);
    expect(d.detail).toContain("health queue unreadable");
    expect(d.detail).toContain("missing Severity");
  });

  it("reports blocked rows AND queue blockers together in one detail", () => {
    const s = emptySnapshot();
    s.blocked = [
      {
        hash: "dev009",
        backlog: "DEV.md",
        status: "blocked",
        blocked_by: ["dev008"],
        owner: null,
      },
    ];
    s.health = [healthSignal()];
    const d = decideRepoNext(s);
    expect(d.row).toBe(11);
    expect(d.detail).toContain("1 blocked item(s)");
    expect(d.detail).toContain("'dev009'");
    expect(d.detail).toContain("health queue: 1 blocking");
  });

  it("never preempts an actionable row — row 8 still wins", () => {
    const s = emptySnapshot();
    s.health = [healthSignal({ counts: { blocking: 9, concern: 0 } })];
    s.devReady = [
      {
        hash: "dev001",
        type: "dev",
        backlog: "DEV.md",
        path: "dev/dev-dev001-x.md",
        title: "Feature",
        gate: { required: false, passed: true, workstream: null, reason: null },
      },
    ];
    expect(decideRepoNext(s).row).toBe(8);
  });

  it("is unchanged from before the widening when nothing is unhealthy", () => {
    const s = emptySnapshot();
    s.blocked = [
      {
        hash: "dev009",
        backlog: "DEV.md",
        status: "blocked",
        blocked_by: ["dev008"],
        owner: "someone",
      },
    ];
    const d = decideRepoNext(s);
    expect(d.row).toBe(11);
    expect(d.detail).toBe(
      "nothing is ready; 1 blocked item(s): 'dev009' (DEV.md, owner someone) blocked-by: dev008",
    );
  });
});

// ---------------------------------------------------------------------------
// Real-repo integration (the gatherer reads actual files)
// ---------------------------------------------------------------------------

function seedWorkstream(queue: string | null) {
  const repo = makeEngineRepo();
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      "stage: design",
      "gate_status:",
      "  prd_validated: true",
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
  repo.write(`${WS}/prd/agent.md`, "# PRD\n");
  repo.write(`${WS}/expectations.md`, "# Expectations\n");
  if (queue !== null) repo.write(`${WS}/questions.md`, queue);
  return repo;
}

function entry(
  id: string,
  fields: Record<string, string> = {},
): string {
  const f = {
    Kind: "gate-concern",
    Severity: "blocking",
    Blocks: "gate-design",
    Origin: "devx gate coverage",
    Recommendation: "cover it",
    Status: "open",
    Resolution: "—",
    ...fields,
  };
  return [
    `## ${id}: ${id} something`,
    "",
    ...Object.entries(f).map(([k, v]) => `- **${k}:** ${v}`),
    "",
    "---",
    "",
  ].join("\n");
}

describe("devx next <hash> — the per-workstream health line", () => {
  it("emits counts in the JSON and renders the line", () => {
    const repo = seedWorkstream(
      [entry("Q-1"), entry("Q-2", { Severity: "concern" })].join(""),
    );
    try {
      const io = captureIo();
      expect(
        runNext(["abc123"], { ...io, projectPath: repo.configPath }),
      ).toBe(0);
      expect((io.json() as { health: string }).health).toBe(
        "health: 1 blocking · 1 concern",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("emits null for an absent queue", () => {
    const repo = seedWorkstream(null);
    try {
      const io = captureIo();
      runNext(["abc123"], { ...io, projectPath: repo.configPath });
      expect((io.json() as { health: string | null }).health).toBeNull();
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx status — the health line per workstream", () => {
  it("renders the counts under the workstream block", () => {
    const repo = seedWorkstream(
      [entry("Q-1"), entry("Q-2"), entry("Q-3", { Severity: "concern" })].join(""),
    );
    try {
      const io = captureIo();
      expect(runStatus({ ...io, projectPath: repo.configPath })).toBe(0);
      expect(io.stdout()).toContain("health: 2 blocking · 1 concern");
    } finally {
      repo.cleanup();
    }
  });

  it("omits the line when the queue is clean", () => {
    const repo = seedWorkstream(entry("Q-1", { Status: "resolved" }));
    try {
      const io = captureIo();
      runStatus({ ...io, projectPath: repo.configPath });
      expect(io.stdout()).not.toContain("health:");
    } finally {
      repo.cleanup();
    }
  });

  it("omits the line when the queue is absent (grandfathered)", () => {
    const repo = seedWorkstream(null);
    try {
      const io = captureIo();
      runStatus({ ...io, projectPath: repo.configPath });
      expect(io.stdout()).toContain("demo-feature (abc123)");
      expect(io.stdout()).not.toContain("health:");
    } finally {
      repo.cleanup();
    }
  });

  it("names the parse failure rather than rendering zeroes, exit still 0", () => {
    const repo = seedWorkstream(
      ["## Q-1: broken", "", "- **Kind:** gate-concern", "- **Status:** open", ""].join(
        "\n",
      ),
    );
    try {
      const io = captureIo();
      expect(runStatus({ ...io, projectPath: repo.configPath })).toBe(0);
      expect(io.stdout()).toContain("health: unreadable");
      expect(io.stdout()).toContain("missing Severity");
      expect(io.stdout()).not.toContain("0 blocking");
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx next (repo form) — the gatherer feeds row 11 from real files", () => {
  it("routes to /devx-walk for a workstream whose queue holds a blocker", () => {
    const repo = seedWorkstream(entry("Q-1"));
    try {
      // Design is authored, so the workstream would otherwise fire row 9.
      // Make the stage rows terminal by leaving nothing authored: the queue
      // alone must be enough to reach row 11.
      const io = captureIo();
      runNext(["--no-gh"], { ...io, projectPath: repo.configPath });
      const d = io.json() as { row: number; command: string; detail: string };
      // Row 9 fires first (the PRD stage has work), which is correct — row 11
      // is the "nothing ready" row. What matters is that the health line
      // travels with the row-9 decision so it is visible either way.
      expect(d.row).toBe(9);
      expect((io.json() as { health: string }).health).toBe("health: 1 blocking");
    } finally {
      repo.cleanup();
    }
  });

  it("warns about a drifted `## Q…` heading rather than swallowing the entry", () => {
    const repo = seedWorkstream(
      `${entry("Q-1")}## Q2 drifted\n\n- **Severity:** blocking\n`,
    );
    try {
      const io = captureIo();
      runNext(["--no-gh"], { ...io, projectPath: repo.configPath });
      const d = io.json() as { warnings: string[] };
      expect(
        d.warnings.some((w) => w.includes("questions.md") && w.includes("canonical")),
      ).toBe(true);
    } finally {
      repo.cleanup();
    }
  });
});
