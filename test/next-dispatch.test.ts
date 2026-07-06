// S-4 test matrix for `devx next` v2 (v2d101) — the repo-level 12-row
// first-match decision table (v2/05-dispatcher.md §2).
//
// Three layers:
//   1. Pure table (decideRepoNext): every row fires in isolation; the full
//      first-match ordering chain (a snapshot with ALL signals present,
//      stripped one row at a time, must fire rows 1→12 in sequence);
//      `--prefer plan` flips rows 8/9; drift/warnings pass through.
//   2. Gatherer (gatherRepoSnapshot over a real temp repo): heartbeat
//      freshness, gh PR + CI folding, lock ownership, workstream gate
//      resolution, drift detection (reported, never fixed).
//   3. CLI (runNext no-arg form): JSON shape + human line + flag parsing;
//      v1 <hash> form unchanged.
//
// Spec: dev/dev-v2d101-2026-07-05T13:05-universal-dispatcher.md

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  type RepoNextDecision,
  type RepoSnapshot,
  decideRepoNext,
  renderHumanLine,
} from "../src/lib/next/decide.js";
import {
  gatherRepoSnapshot,
  rollupToCi,
} from "../src/lib/next/gather.js";
import { runNext } from "../src/commands/next.js";
import type { Exec } from "../src/lib/tour/exec.js";
import { captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

function emptySnapshot(): RepoSnapshot {
  return {
    loop: {
      live: false,
      source: null,
      pid: null,
      ts: null,
      ageSeconds: null,
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
    blocked: [],
    drift: [],
    warnings: [],
  };
}

/** Every row's trigger present at once — the ordering-chain fixture. */
function fullSnapshot(): RepoSnapshot {
  const s = emptySnapshot();
  s.loop = {
    live: true,
    source: "manager-heartbeat",
    pid: 4242,
    ts: "2026-07-05T08:00:00Z",
    ageSeconds: 30,
    overnightReport: ".devx-cache/reports/2026-07-05.md",
  };
  s.prs = [
    {
      number: 70,
      branch: "feat/dev-red001",
      url: "https://github.com/x/y/pull/70",
      ci: "red",
      specType: "dev",
      hash: "red001",
    },
    {
      number: 71,
      branch: "feat/dev-grn001",
      url: "https://github.com/x/y/pull/71",
      ci: "green",
      specType: "dev",
      hash: "grn001",
    },
  ];
  s.unreconciled = [
    {
      hash: "mrg001",
      backlog: "DEV.md",
      backlogStatus: "in-progress",
      specStatus: "done",
      specPath: "dev/dev-mrg001-x.md",
    },
  ];
  s.claims = [
    { hash: "cla001", backlog: "DEV.md", ownership: "owned", lockOwner: "tok" },
  ];
  s.outcomeDue = [
    { hash: "out001", slug: "shipped-thing", measureBy: "2026-06-01" },
  ];
  s.interviewBlocking = [{ qNum: "9", blocks: ["blk001"] }];
  s.debugReady = [
    {
      hash: "dbg001",
      type: "debug",
      backlog: "DEBUG.md",
      path: "debug/debug-dbg001-x.md",
      title: "Broken thing",
      gate: { required: false, passed: true, workstream: null, reason: null },
    },
  ];
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
  s.midPipeline = [
    {
      hash: "ws0001",
      slug: "demo",
      stage: "prd",
      decision: {
        row: 5,
        command: "devx gate prd ws0001",
        reason: "Gate 1 open",
      },
    },
  ];
  s.planReady = [
    { hash: "pln001", path: "plan/plan-pln001-x.md", title: "Big plan" },
  ];
  s.blocked = [
    {
      hash: "blk001",
      backlog: "DEV.md",
      status: "blocked",
      blocked_by: ["dep001"],
      owner: "/devx-someone",
    },
  ];
  return s;
}

function rowOf(s: RepoSnapshot, preferPlan = false): RepoNextDecision {
  return decideRepoNext(s, { preferPlan });
}

// ---------------------------------------------------------------------------
// 1. Pure table — every row in isolation
// ---------------------------------------------------------------------------

describe("decideRepoNext — each row fires in isolation", () => {
  it("row 1: live loop/manager heartbeat → report-loop (+ morning-review offer)", () => {
    const s = emptySnapshot();
    s.loop = fullSnapshot().loop;
    const d = rowOf(s);
    expect(d.row).toBe(1);
    expect(d.action).toBe("report-loop");
    expect(d.command).toBeNull();
    expect(d.detail).toContain("pid 4242");
    expect(d.detail).toContain(".devx-cache/reports/2026-07-05.md");
  });

  it("row 1 without an overnight report omits the review offer", () => {
    const s = emptySnapshot();
    s.loop = { ...fullSnapshot().loop, overnightReport: null };
    const d = rowOf(s);
    expect(d.row).toBe(1);
    expect(d.detail).not.toContain("report landed overnight");
  });

  it("row 2: own PR with CI red → fix-ci on that branch", () => {
    const s = emptySnapshot();
    s.prs = [fullSnapshot().prs[0]];
    const d = rowOf(s);
    expect(d.row).toBe(2);
    expect(d.action).toBe("fix-ci");
    expect(d.command).toBe("/devx red001");
    expect(d.detail).toContain("#70");
  });

  it("row 2 falls back to gh pr checks when the branch has no derivable hash", () => {
    const s = emptySnapshot();
    s.prs = [{ number: 9, branch: "hotfix", url: "u", ci: "red", specType: null, hash: null }];
    const d = rowOf(s);
    expect(d.row).toBe(2);
    expect(d.command).toBe("gh pr checks 9");
  });

  it("row 3: own PR CI green, unmerged → merge-gate tail (respect devx: hold)", () => {
    const s = emptySnapshot();
    s.prs = [fullSnapshot().prs[1]];
    const d = rowOf(s);
    expect(d.row).toBe(3);
    expect(d.action).toBe("merge-tail");
    expect(d.command).toBe("devx merge-gate grn001");
    expect(d.detail).toContain("devx: hold");
  });

  it("row 3 treats a checks-free PR as merge-tail-eligible (merge-gate decides)", () => {
    const s = emptySnapshot();
    s.prs = [
      { number: 5, branch: "feat/dev-non001", url: "u", ci: "none", specType: "dev", hash: "non001" },
    ];
    const d = rowOf(s);
    expect(d.row).toBe(3);
    expect(d.detail).toContain("no checks reported");
  });

  it("row 3 routes non-dev (debug) PRs through the dispatcher, not merge-gate", () => {
    // merge-gate resolves dev/ specs only — a green feat/debug-<hash> PR
    // must get an executable command (adversarial-review BH#4).
    const s = emptySnapshot();
    s.prs = [
      {
        number: 8,
        branch: "feat/debug-bug001",
        url: "u",
        ci: "green",
        specType: "debug",
        hash: "bug001",
      },
    ];
    const d = rowOf(s);
    expect(d.row).toBe(3);
    expect(d.command).toBe("/devx bug001");
  });

  it("a pending-CI PR fires neither row 2 nor row 3 (falls through)", () => {
    const s = emptySnapshot();
    s.prs = [
      { number: 6, branch: "feat/dev-pnd001", url: "u", ci: "pending", specType: "dev", hash: "pnd001" },
    ];
    const d = rowOf(s);
    expect(d.row).toBe(12);
  });

  it("row 4: done-mismatch (merged but unreconciled) → cleanup", () => {
    const s = emptySnapshot();
    s.unreconciled = fullSnapshot().unreconciled;
    const d = rowOf(s);
    expect(d.row).toBe(4);
    expect(d.action).toBe("reconcile-merge");
    expect(d.command).toBe("/devx mrg001");
    expect(d.detail).toContain("in-progress");
    expect(d.detail).toContain("done");
  });

  it("row 5: claim owned by this session → resume directly", () => {
    const s = emptySnapshot();
    s.claims = fullSnapshot().claims;
    const d = rowOf(s);
    expect(d.row).toBe(5);
    expect(d.action).toBe("resume");
    expect(d.command).toBe("/devx cla001");
  });

  it("row 5: unverified claim → verify-claim first (roc101 owner check), verbatim-executable", () => {
    const s = emptySnapshot();
    s.claims = [
      { hash: "cla002", backlog: "DEV.md", ownership: "unverified", lockOwner: "x" },
    ];
    const d = rowOf(s);
    expect(d.row).toBe(5);
    // No placeholder tokens — machine consumers run `command` as-is; the
    // CLI auto-derives the current session's token when the flag is absent.
    expect(d.command).toBe("devx devx-helper verify-claim cla002");
    expect(d.detail).toContain("--session-token");
  });

  it("row 5: unverified DEBUG.md claim gets --type debug on the verify command", () => {
    const s = emptySnapshot();
    s.claims = [
      {
        hash: "dbg777",
        backlog: "DEBUG.md",
        ownership: "unverified",
        lockOwner: "x",
      },
    ];
    const d = rowOf(s);
    expect(d.row).toBe(5);
    expect(d.command).toBe("devx devx-helper verify-claim dbg777 --type debug");
  });

  it("row 5 does NOT fire for a claim held by another session", () => {
    const s = emptySnapshot();
    s.claims = [
      {
        hash: "cla003",
        backlog: "DEV.md",
        ownership: "other-session",
        lockOwner: "peer",
      },
    ];
    const d = rowOf(s);
    expect(d.row).toBe(12);
  });

  it("row 5.5: due outcome → outcome-due (/devx outcome <hash>)", () => {
    const s = emptySnapshot();
    s.outcomeDue = fullSnapshot().outcomeDue;
    const d = rowOf(s);
    expect(d.row).toBe(5.5);
    expect(d.action).toBe("outcome-due");
    expect(d.command).toBe("/devx outcome out001");
    expect(d.detail).toContain("shipped-thing");
    expect(d.detail).toContain("measure_by 2026-06-01 has passed");
  });

  it("row 5.5 with a null measure_by says so explicitly (due-by-default)", () => {
    const s = emptySnapshot();
    s.outcomeDue = [{ hash: "out002", slug: "odd-one", measureBy: null }];
    const d = rowOf(s);
    expect(d.row).toBe(5.5);
    expect(d.detail).toContain("unset/unparseable");
  });

  it("row 6: unanswered INTERVIEW items blocking ready work → /devx-interview", () => {
    const s = emptySnapshot();
    s.interviewBlocking = fullSnapshot().interviewBlocking;
    const d = rowOf(s);
    expect(d.row).toBe(6);
    expect(d.action).toBe("interview");
    expect(d.command).toBe("/devx-interview");
    expect(d.detail).toContain("Q#9");
    expect(d.detail).toContain("blk001");
  });

  it("row 7: top DEBUG.md ready item → execute (repro-first)", () => {
    const s = emptySnapshot();
    s.debugReady = fullSnapshot().debugReady;
    const d = rowOf(s);
    expect(d.row).toBe(7);
    expect(d.action).toBe("execute-debug");
    expect(d.command).toBe("/devx dbg001");
    expect(d.detail).toContain("repro-first");
  });

  it("row 8: top DEV.md ready item (gate exempt) → execute", () => {
    const s = emptySnapshot();
    s.devReady = fullSnapshot().devReady;
    const d = rowOf(s);
    expect(d.row).toBe(8);
    expect(d.action).toBe("execute-dev");
    expect(d.command).toBe("/devx dev001");
  });

  it("row 8 skips a gated item whose workstream evals_red is false", () => {
    const s = emptySnapshot();
    s.devReady = [
      {
        hash: "gtd001",
        type: "dev",
        backlog: "DEV.md",
        path: "dev/dev-gtd001-x.md",
        title: "Gated",
        gate: {
          required: true,
          passed: false,
          workstream: "_devx/workstreams/demo",
          reason: "evals_red false",
        },
      },
    ];
    const d = rowOf(s);
    expect(d.row).toBe(12); // nothing else present — falls through
  });

  it("row 8 executes the first item that passes its gate, skipping gated ones", () => {
    const s = emptySnapshot();
    s.devReady = [
      {
        hash: "gtd001",
        type: "dev",
        backlog: "DEV.md",
        path: "dev/dev-gtd001-x.md",
        title: "Gated",
        gate: { required: true, passed: false, workstream: "w", reason: "no" },
      },
      {
        hash: "ok0001",
        type: "dev",
        backlog: "DEV.md",
        path: "dev/dev-ok0001-x.md",
        title: "Passing",
        gate: { required: true, passed: true, workstream: "w", reason: "yes" },
      },
    ];
    const d = rowOf(s);
    expect(d.row).toBe(8);
    expect(d.command).toBe("/devx ok0001");
    expect(d.detail).toContain("workstream gate evals_red passed");
  });

  it("row 9: mid-pipeline workstream → its v1 stage command verbatim", () => {
    const s = emptySnapshot();
    s.midPipeline = fullSnapshot().midPipeline;
    const d = rowOf(s);
    expect(d.row).toBe(9);
    expect(d.action).toBe("workstream-stage");
    expect(d.command).toBe("devx gate prd ws0001");
    expect(d.detail).toContain("demo");
  });

  it("row 10: PLAN.md ready item → start its PRD stage", () => {
    const s = emptySnapshot();
    s.planReady = fullSnapshot().planReady;
    const d = rowOf(s);
    expect(d.row).toBe(10);
    expect(d.action).toBe("plan-prd");
    expect(d.command).toBe("/devx prd pln001");
  });

  it("row 11: nothing ready, blocked items exist → report blockers + owners", () => {
    const s = emptySnapshot();
    s.blocked = fullSnapshot().blocked;
    const d = rowOf(s);
    expect(d.row).toBe(11);
    expect(d.action).toBe("report-blocked");
    expect(d.command).toBeNull();
    expect(d.detail).toContain("blk001");
    expect(d.detail).toContain("dep001");
    expect(d.detail).toContain("/devx-someone");
  });

  it("row 12: genuinely empty → propose interviewing for the next objective", () => {
    const d = rowOf(emptySnapshot());
    expect(d.row).toBe(12);
    expect(d.action).toBe("propose-interview");
    expect(d.command).toBe("/devx-interview");
  });
});

// ---------------------------------------------------------------------------
// 1b. First-match ordering — the full 1→12 strip-down chain
// ---------------------------------------------------------------------------

describe("decideRepoNext — first-match ordering (strip-down chain)", () => {
  it("fires rows 1→12 in sequence as each higher signal is removed", () => {
    const s = fullSnapshot();
    expect(rowOf(s).row).toBe(1);

    s.loop = emptySnapshot().loop;
    expect(rowOf(s).row).toBe(2);

    s.prs = s.prs.filter((p) => p.ci !== "red");
    expect(rowOf(s).row).toBe(3);

    s.prs = [];
    expect(rowOf(s).row).toBe(4);

    s.unreconciled = [];
    expect(rowOf(s).row).toBe(5);

    s.claims = [];
    expect(rowOf(s).row).toBe(5.5);

    s.outcomeDue = [];
    expect(rowOf(s).row).toBe(6);

    s.interviewBlocking = [];
    expect(rowOf(s).row).toBe(7);

    s.debugReady = [];
    expect(rowOf(s).row).toBe(8);

    s.devReady = [];
    expect(rowOf(s).row).toBe(9);

    s.midPipeline = [];
    expect(rowOf(s).row).toBe(10);

    s.planReady = [];
    expect(rowOf(s).row).toBe(11);

    s.blocked = [];
    expect(rowOf(s).row).toBe(12);
  });

  it("cartesian spot-check: every earlier row beats every later row", () => {
    // For each pair (i, j) with i < j, a snapshot carrying only signals i
    // and j must fire row i. Signals are injected via targeted setters.
    // Row 5.5 (outcome-due, v2o101) sits between 5 and 6 in the ordering.
    const setters: Array<{ row: number; set: (s: RepoSnapshot) => void }> = [
      { row: 1, set: (s) => { s.loop = fullSnapshot().loop; } },
      { row: 2, set: (s) => { s.prs.push(fullSnapshot().prs[0]); } },
      { row: 3, set: (s) => { s.prs.push(fullSnapshot().prs[1]); } },
      { row: 4, set: (s) => { s.unreconciled = fullSnapshot().unreconciled; } },
      { row: 5, set: (s) => { s.claims = fullSnapshot().claims; } },
      { row: 5.5, set: (s) => { s.outcomeDue = fullSnapshot().outcomeDue; } },
      { row: 6, set: (s) => { s.interviewBlocking = fullSnapshot().interviewBlocking; } },
      { row: 7, set: (s) => { s.debugReady = fullSnapshot().debugReady; } },
      { row: 8, set: (s) => { s.devReady = fullSnapshot().devReady; } },
      { row: 9, set: (s) => { s.midPipeline = fullSnapshot().midPipeline; } },
      { row: 10, set: (s) => { s.planReady = fullSnapshot().planReady; } },
      { row: 11, set: (s) => { s.blocked = fullSnapshot().blocked; } },
    ];
    for (let i = 0; i < setters.length; i++) {
      for (let j = i + 1; j < setters.length; j++) {
        const s = emptySnapshot();
        setters[i].set(s);
        setters[j].set(s);
        expect(
          rowOf(s).row,
          `pair (${setters[i].row}, ${setters[j].row})`,
        ).toBe(setters[i].row);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 1c. --prefer plan flips rows 8/9 (canonical row numbers preserved)
// ---------------------------------------------------------------------------

describe("decideRepoNext — --prefer plan", () => {
  it("canonical order ships row 8 ahead of row 9", () => {
    const s = emptySnapshot();
    s.devReady = fullSnapshot().devReady;
    s.midPipeline = fullSnapshot().midPipeline;
    expect(rowOf(s).row).toBe(8);
  });

  it("preferPlan evaluates row 9 first when both are available", () => {
    const s = emptySnapshot();
    s.devReady = fullSnapshot().devReady;
    s.midPipeline = fullSnapshot().midPipeline;
    const d = rowOf(s, true);
    expect(d.row).toBe(9);
    expect(d.action).toBe("workstream-stage");
  });

  it("preferPlan with only DEV.md work still fires row 8", () => {
    const s = emptySnapshot();
    s.devReady = fullSnapshot().devReady;
    expect(rowOf(s, true).row).toBe(8);
  });

  it("preferPlan does not disturb rows above 8 (row 7 still wins)", () => {
    const s = emptySnapshot();
    s.debugReady = fullSnapshot().debugReady;
    s.midPipeline = fullSnapshot().midPipeline;
    expect(rowOf(s, true).row).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 1d. Drift + warnings pass through; human line
// ---------------------------------------------------------------------------

describe("decideRepoNext — drift is reported, never consumed", () => {
  it("drift entries ride along on every decision", () => {
    const s = emptySnapshot();
    s.drift = [
      {
        hash: "dft001",
        backlog: "DEV.md",
        kind: "status-mismatch",
        backlogStatus: "ready",
        specStatus: "in-progress",
        detail: "mismatch",
      },
    ];
    s.warnings = ["gh unavailable"];
    const d = rowOf(s);
    expect(d.row).toBe(12); // drift alone never changes the routed row
    expect(d.drift).toHaveLength(1);
    expect(d.drift[0].hash).toBe("dft001");
    expect(d.warnings).toEqual(["gh unavailable"]);
  });

  it("renderHumanLine carries row, action, command, and drift count", () => {
    const s = emptySnapshot();
    s.devReady = fullSnapshot().devReady;
    s.drift = [
      {
        hash: "d1",
        backlog: "DEV.md",
        kind: "status-mismatch",
        detail: "x",
      },
      {
        hash: "d2",
        backlog: "DEBUG.md",
        kind: "in-progress-without-lock",
        detail: "y",
      },
    ];
    const line = renderHumanLine(rowOf(s));
    expect(line).toContain("[row 8/execute-dev]");
    expect(line).toContain("run: /devx dev001");
    expect(line).toContain("drift: 2");
  });
});

// ---------------------------------------------------------------------------
// 2. Gatherer — real temp repo
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-05T12:00:00Z");

/** Fake gh exec: `gh pr list` returns the given payload; git untouched. */
function fakeGh(prs: unknown[] | { fail: string }): Exec {
  return (cmd, args) => {
    if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
      if (!Array.isArray(prs)) {
        return { stdout: "", stderr: prs.fail, exitCode: 1 };
      }
      return { stdout: JSON.stringify(prs), stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: `unexpected exec: ${cmd} ${args.join(" ")}`, exitCode: 127 };
  };
}

function specBody(
  type: string,
  hash: string,
  status: string,
  extraFm: string[] = [],
): string {
  return [
    "---",
    `hash: ${hash}`,
    `type: ${type}`,
    `title: Fixture ${hash}`,
    `status: ${status}`,
    ...extraFm,
    "---",
    "",
    "## Goal",
    "",
    "Fixture.",
    "",
    "## Status log",
    "",
    `- 2026-07-05T12:00 — created.`,
    "",
  ].join("\n");
}

function backlogRow(type: string, hash: string, status: string): string {
  return `- [${checkboxFor(status)}] \`${type}/${type}-${hash}-2026-07-05T12:00-fixture.md\` — Fixture ${hash}. Status: ${status}.`;
}

function checkboxFor(status: string): string {
  switch (status) {
    case "ready":
      return " ";
    case "in-progress":
      return "/";
    case "blocked":
      return "-";
    case "done":
      return "x";
    default:
      return " ";
  }
}

function writeSpec(
  repo: ReturnType<typeof makeEngineRepo>,
  type: string,
  hash: string,
  status: string,
  extraFm: string[] = [],
): void {
  repo.write(
    `${type}/${type}-${hash}-2026-07-05T12:00-fixture.md`,
    specBody(type, hash, status, extraFm),
  );
}

function gather(
  repo: ReturnType<typeof makeEngineRepo>,
  opts: {
    exec?: Exec;
    sessionToken?: string;
    skipGh?: boolean;
  } = {},
) {
  return gatherRepoSnapshot({
    repoRoot: repo.root,
    merged: {},
    engine: {
      workstreamsRoot: "_devx/workstreams",
      expectationsMin: 3,
      proseBudgetKb: 60,
    },
    exec: opts.exec ?? fakeGh([]),
    now: () => NOW,
    sessionToken: opts.sessionToken,
    skipGh: opts.skipGh,
  });
}

describe("gatherRepoSnapshot — heartbeat (row 1 inputs)", () => {
  it("fresh manager heartbeat → live", () => {
    const repo = makeEngineRepo();
    try {
      const ts = new Date(NOW.getTime() - 30_000).toISOString();
      repo.write(
        ".devx-cache/state/heartbeat.json",
        JSON.stringify({ ts, pid: 777, generation: 3 }),
      );
      const s = gather(repo);
      expect(s.loop.live).toBe(true);
      expect(s.loop.source).toBe("manager-heartbeat");
      expect(s.loop.pid).toBe(777);
      expect(s.loop.ageSeconds).toBe(30);
    } finally {
      repo.cleanup();
    }
  });

  it("stale heartbeat (beyond 3× interval) → not live", () => {
    const repo = makeEngineRepo();
    try {
      const ts = new Date(NOW.getTime() - 3_600_000).toISOString();
      repo.write(
        ".devx-cache/state/heartbeat.json",
        JSON.stringify({ ts, pid: 777, generation: 3 }),
      );
      const s = gather(repo);
      expect(s.loop.live).toBe(false);
      expect(s.loop.source).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it("no loop state at all degrades gracefully (pre-v2l101)", () => {
    const repo = makeEngineRepo();
    try {
      const s = gather(repo);
      expect(s.loop.live).toBe(false);
      expect(s.loop.overnightReport).toBeNull();
      expect(s.warnings).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });

  it("v2l101 loop state (status: running) wins the attribution", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(
        ".devx-cache/loop/state.json",
        JSON.stringify({ status: "running", pid: 999, ts: NOW.toISOString() }),
      );
      const s = gather(repo);
      expect(s.loop.live).toBe(true);
      expect(s.loop.source).toBe("loop-state");
      expect(s.loop.pid).toBe(999);
    } finally {
      repo.cleanup();
    }
  });

  it("an overnight report within 24h is surfaced", () => {
    const repo = makeEngineRepo();
    try {
      const ts = new Date(NOW.getTime() - 10_000).toISOString();
      repo.write(
        ".devx-cache/state/heartbeat.json",
        JSON.stringify({ ts, pid: 1, generation: 1 }),
      );
      repo.write(".devx-cache/reports/2026-07-05-morning.md", "# report");
      const s = gather(repo);
      expect(s.loop.overnightReport).toBe(
        ".devx-cache/reports/2026-07-05-morning.md",
      );
    } finally {
      repo.cleanup();
    }
  });
});

describe("gatherRepoSnapshot — gh PRs (rows 2–3 inputs)", () => {
  it("folds CheckRun conclusions to red and derives the hash from the branch", () => {
    const repo = makeEngineRepo();
    try {
      const s = gather(repo, {
        exec: fakeGh([
          {
            number: 70,
            headRefName: "feat/dev-abc123",
            url: "https://github.com/x/y/pull/70",
            statusCheckRollup: [
              { status: "COMPLETED", conclusion: "SUCCESS" },
              { status: "COMPLETED", conclusion: "FAILURE" },
            ],
          },
        ]),
      });
      expect(s.prs).toHaveLength(1);
      expect(s.prs[0].ci).toBe("red");
      expect(s.prs[0].hash).toBe("abc123");
    } finally {
      repo.cleanup();
    }
  });

  it("gh failure degrades to no PRs + a warning (rows 2–3 skipped)", () => {
    const repo = makeEngineRepo();
    try {
      const s = gather(repo, { exec: fakeGh({ fail: "gh: not logged in" }) });
      expect(s.prs).toEqual([]);
      expect(s.warnings.some((w) => w.includes("gh pr list failed"))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("skipGh bypasses the probe entirely (no warning)", () => {
    const repo = makeEngineRepo();
    try {
      const s = gather(repo, {
        exec: () => {
          throw new Error("exec must not run under skipGh");
        },
        skipGh: true,
      });
      expect(s.prs).toEqual([]);
      expect(s.warnings).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});

describe("rollupToCi — folding table", () => {
  it("empty / missing → none", () => {
    expect(rollupToCi([])).toBe("none");
    expect(rollupToCi(undefined)).toBe("none");
  });
  it("any failure conclusion wins", () => {
    expect(
      rollupToCi([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "IN_PROGRESS", conclusion: "" },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ]),
    ).toBe("red");
  });
  it("pending beats green", () => {
    expect(
      rollupToCi([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "QUEUED", conclusion: "" },
      ]),
    ).toBe("pending");
  });
  it("all success → green (StatusContext state shape included)", () => {
    expect(
      rollupToCi([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { state: "SUCCESS" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
      ]),
    ).toBe("green");
  });
  it("StatusContext failure states → red; unknown shapes → pending", () => {
    expect(rollupToCi([{ state: "ERROR" }])).toBe("red");
    expect(rollupToCi([{ mystery: true }])).toBe("pending");
  });
});

describe("gatherRepoSnapshot — backlogs, drift, claims, gates", () => {
  it("reports status-mismatch drift without fixing anything", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "aaa111", "in-progress");
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "aaa111", "ready")}\n`);
      const before = repo.read("DEV.md");
      const s = gather(repo);
      expect(s.drift).toHaveLength(2); // status-mismatch + in-progress-without-lock
      expect(s.drift[0].kind).toBe("status-mismatch");
      expect(s.drift[0].backlogStatus).toBe("ready");
      expect(s.drift[0].specStatus).toBe("in-progress");
      // Never silently fixed: file byte-identical after the gather.
      expect(repo.read("DEV.md")).toBe(before);
      expect(repo.read("dev/dev-aaa111-2026-07-05T12:00-fixture.md")).toContain(
        "status: in-progress",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("done-mismatch lands in unreconciled (row 4 input)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "bbb222", "done");
      repo.write(
        "DEV.md",
        `# DEV\n\n${backlogRow("dev", "bbb222", "in-progress")}\n`,
      );
      const s = gather(repo);
      expect(s.unreconciled).toHaveLength(1);
      expect(s.unreconciled[0].hash).toBe("bbb222");
      const d = decideRepoNext(s);
      expect(d.row).toBe(4);
    } finally {
      repo.cleanup();
    }
  });

  it("in-progress + lock owned by the session token → owned claim (row 5)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "ccc333", "in-progress", ["owner: /devx-tok-1"]);
      repo.write(
        "DEV.md",
        `# DEV\n\n${backlogRow("dev", "ccc333", "in-progress")}\n`,
      );
      repo.write(".devx-cache/locks/spec-ccc333.lock", "tok-1\npid=1\n");
      const s = gather(repo, { sessionToken: "tok-1" });
      expect(s.claims).toEqual([
        {
          hash: "ccc333",
          backlog: "DEV.md",
          ownership: "owned",
          lockOwner: "tok-1",
        },
      ]);
      expect(decideRepoNext(s).command).toBe("/devx ccc333");
    } finally {
      repo.cleanup();
    }
  });

  it("lock held by a different token → other-session (row 5 does not fire)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "ddd444", "in-progress");
      repo.write(
        "DEV.md",
        `# DEV\n\n${backlogRow("dev", "ddd444", "in-progress")}\n`,
      );
      repo.write(".devx-cache/locks/spec-ddd444.lock", "peer-tok\npid=2\n");
      const s = gather(repo, { sessionToken: "tok-1" });
      expect(s.claims[0].ownership).toBe("other-session");
      expect(decideRepoNext(s).row).toBe(12);
    } finally {
      repo.cleanup();
    }
  });

  it("in-progress without a lock → drift defect (orphaned claim)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "eee555", "in-progress");
      repo.write(
        "DEV.md",
        `# DEV\n\n${backlogRow("dev", "eee555", "in-progress")}\n`,
      );
      const s = gather(repo);
      expect(s.drift.some((d) => d.kind === "in-progress-without-lock")).toBe(
        true,
      );
      expect(s.claims[0].ownership).toBe("no-lock");
      expect(decideRepoNext(s).row).toBe(12); // orphan is not resumable
    } finally {
      repo.cleanup();
    }
  });

  it("DEBUG.md items parse identically to DEV.md and route to row 7", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "debug", "fff666", "ready");
      repo.write(
        "DEBUG.md",
        `# DEBUG\n\n${backlogRow("debug", "fff666", "ready")}\n`,
      );
      const s = gather(repo);
      expect(s.debugReady).toHaveLength(1);
      expect(s.debugReady[0].hash).toBe("fff666");
      expect(s.debugReady[0].gate.required).toBe(false);
      const d = decideRepoNext(s);
      expect(d.row).toBe(7);
      expect(d.command).toBe("/devx fff666");
    } finally {
      repo.cleanup();
    }
  });

  it("debug ready beats dev ready (row 7 before row 8)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "debug", "ggg777", "ready");
      writeSpec(repo, "dev", "hhh888", "ready");
      repo.write("DEBUG.md", `# DEBUG\n\n${backlogRow("debug", "ggg777", "ready")}\n`);
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "hhh888", "ready")}\n`);
      const d = decideRepoNext(gather(repo));
      expect(d.row).toBe(7);
      expect(d.command).toBe("/devx ggg777");
    } finally {
      repo.cleanup();
    }
  });

  it("blocked-by rows are excluded from ready and land in the row-11 report", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "iii999", "ready");
      repo.write(
        "DEV.md",
        `# DEV\n\n- [ ] \`dev/dev-iii999-2026-07-05T12:00-fixture.md\` — Fixture. Status: ready. Blocked-by: zzz000.\n`,
      );
      const s = gather(repo);
      expect(s.devReady).toEqual([]);
      const d = decideRepoNext(s);
      expect(d.row).toBe(11);
      expect(d.detail).toContain("iii999");
    } finally {
      repo.cleanup();
    }
  });

  it("unanswered INTERVIEW question blocking a backlog item → row 6", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "jjj111", "blocked");
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "jjj111", "blocked")}\n`);
      repo.write(
        "INTERVIEW.md",
        [
          "# INTERVIEW",
          "",
          "- [ ] **Q#4 — pick a database.**",
          "  - Blocks: jjj111.",
          "",
        ].join("\n"),
      );
      const s = gather(repo);
      expect(s.interviewBlocking).toEqual([{ qNum: "4", blocks: ["jjj111"] }]);
      expect(decideRepoNext(s).row).toBe(6);
    } finally {
      repo.cleanup();
    }
  });

  it("answered INTERVIEW questions do not block (row 6 silent)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "kkk222", "blocked");
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "kkk222", "blocked")}\n`);
      repo.write(
        "INTERVIEW.md",
        [
          "# INTERVIEW",
          "",
          "- [x] **Q#4 — pick a database.**",
          "  - Blocks: kkk222.",
          "  → Answer: postgres.",
          "",
        ].join("\n"),
      );
      const s = gather(repo);
      expect(s.interviewBlocking).toEqual([]);
      expect(decideRepoNext(s).row).toBe(11); // blocked item still reported
    } finally {
      repo.cleanup();
    }
  });

  it("workstream-gated dev item: evals_red false → gated (row 9 takes over)", () => {
    const repo = makeEngineRepo();
    try {
      // Plan spec mid-pipeline claiming the workstream; gate open.
      repo.write(
        "plan/plan-ws0001-2026-07-05T12:00-demo.md",
        [
          "---",
          "hash: ws0001",
          "type: plan",
          "status: in-progress",
          "stage: red",
          "gate_status:",
          "  prd_validated: true",
          "  design_verified: true",
          "  plan_verified: true",
          "  evals_red: false",
          "workstream: _devx/workstreams/demo",
          "---",
          "body",
          "",
        ].join("\n"),
      );
      repo.mkdir("_devx/workstreams/demo/evals");
      repo.write("_devx/workstreams/demo/prd.md", "x");
      repo.write("_devx/workstreams/demo/expectations.md", "x");
      repo.write("_devx/workstreams/demo/design.md", "x");
      repo.write("_devx/workstreams/demo/plan.md", "x");
      // Dev item emitted from that workstream.
      writeSpec(repo, "dev", "lll333", "ready", [
        "from: _devx/workstreams/demo/plan.md",
      ]);
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "lll333", "ready")}\n`);

      const s = gather(repo);
      expect(s.devReady[0].gate).toMatchObject({
        required: true,
        passed: false,
        workstream: "_devx/workstreams/demo",
      });
      const d = decideRepoNext(s);
      expect(d.row).toBe(9);
      expect(d.command).toBe("/devx red ws0001"); // evals/ empty → author RED
    } finally {
      repo.cleanup();
    }
  });

  it("workstream-gated dev item: evals_red true → row 8 executes it", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(
        "plan/plan-ws0002-2026-07-05T12:00-demo2.md",
        [
          "---",
          "hash: ws0002",
          "type: plan",
          "status: in-progress",
          "stage: executing",
          "gate_status:",
          "  prd_validated: true",
          "  design_verified: true",
          "  plan_verified: true",
          "  evals_red: true",
          "workstream: _devx/workstreams/demo2",
          "---",
          "body",
          "",
        ].join("\n"),
      );
      repo.mkdir("_devx/workstreams/demo2/evals");
      repo.write("_devx/workstreams/demo2/prd.md", "x");
      repo.write("_devx/workstreams/demo2/expectations.md", "x");
      repo.write("_devx/workstreams/demo2/design.md", "x");
      repo.write("_devx/workstreams/demo2/plan.md", "x");
      repo.write("_devx/workstreams/demo2/evals/E-1_smoke.md", "eval");
      writeSpec(repo, "dev", "mmm444", "ready", [
        "workstream: _devx/workstreams/demo2",
      ]);
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "mmm444", "ready")}\n`);

      const s = gather(repo);
      expect(s.devReady[0].gate).toMatchObject({ required: true, passed: true });
      // The executing workstream is NOT mid-pipeline (v1 row 12 excluded).
      expect(s.midPipeline).toEqual([]);
      const d = decideRepoNext(s);
      expect(d.row).toBe(8);
      expect(d.command).toBe("/devx mmm444");
    } finally {
      repo.cleanup();
    }
  });

  it("standalone spec (from: an epic file) is gate-exempt", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "nnn555", "ready", [
        "from: _bmad-output/planning-artifacts/epic-old.md",
      ]);
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "nnn555", "ready")}\n`);
      const s = gather(repo);
      expect(s.devReady[0].gate.required).toBe(false);
      expect(decideRepoNext(s).row).toBe(8);
    } finally {
      repo.cleanup();
    }
  });

  it("named-but-unresolvable workstream → exempt + warning (no silent block)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "ooo666", "ready", [
        "workstream: _devx/workstreams/ghost",
      ]);
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "ooo666", "ready")}\n`);
      const s = gather(repo);
      expect(s.devReady[0].gate.required).toBe(false);
      expect(s.warnings.some((w) => w.includes("ghost"))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("legacy plan spec (no engine frontmatter) named by from: is exempt", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(
        "plan/plan-old001-2026-07-05T12:00-legacy.md",
        specBody("plan", "old001", "ready"),
      );
      writeSpec(repo, "dev", "ppp777", "ready", [
        "from: plan/plan-old001-2026-07-05T12:00-legacy.md",
      ]);
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "ppp777", "ready")}\n`);
      const s = gather(repo);
      expect(s.devReady[0].gate.required).toBe(false);
      expect(decideRepoNext(s).row).toBe(8);
    } finally {
      repo.cleanup();
    }
  });

  it("PLAN.md ready row routes to row 10 (/devx prd)", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(
        "plan/plan-qqq888-2026-07-05T12:00-fixture.md",
        specBody("plan", "qqq888", "ready"),
      );
      repo.write("PLAN.md", `# PLAN\n\n${backlogRow("plan", "qqq888", "ready")}\n`);
      const s = gather(repo);
      expect(s.planReady).toHaveLength(1);
      const d = decideRepoNext(s);
      expect(d.row).toBe(10);
      expect(d.command).toBe("/devx prd qqq888");
    } finally {
      repo.cleanup();
    }
  });

  it("in-progress PLAN.md rows never produce lock drift (planning owns them)", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(
        "plan/plan-rrr999-2026-07-05T12:00-fixture.md",
        specBody("plan", "rrr999", "in-progress"),
      );
      repo.write(
        "PLAN.md",
        `# PLAN\n\n${backlogRow("plan", "rrr999", "in-progress")}\n`,
      );
      const s = gather(repo);
      expect(s.claims).toEqual([]);
      expect(s.drift).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });

  it("a ready row pointing at a missing spec is warned about, not routed", () => {
    const repo = makeEngineRepo();
    try {
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "sss000", "ready")}\n`);
      const s = gather(repo);
      expect(s.devReady).toEqual([]);
      expect(s.warnings.some((w) => w.includes("missing spec"))).toBe(true);
      expect(decideRepoNext(s).row).toBe(12);
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 2a-bis. Outcome-due gathering (row 5.5, v2o101)
// ---------------------------------------------------------------------------

describe("gatherRepoSnapshot — outcome-due workstreams (row 5.5)", () => {
  function writeClosedWorkstream(
    repo: ReturnType<typeof makeEngineRepo>,
    hash: string,
    slug: string,
    outcomeLines: string[],
  ): void {
    repo.write(
      `plan/plan-${hash}-2026-07-05T12:00-${slug}.md`,
      [
        "---",
        `hash: ${hash}`,
        "type: plan",
        "status: done",
        "stage: done",
        "gate_status:",
        "  prd_validated: true",
        "  design_verified: true",
        "  plan_verified: true",
        "  evals_red: true",
        ...outcomeLines,
        `workstream: _devx/workstreams/${slug}`,
        "---",
        "body",
        "",
      ].join("\n"),
    );
    repo.mkdir(`_devx/workstreams/${slug}`);
  }

  it("pending + past measure_by → outcomeDue signal → row 5.5", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "out001", "shipped", [
        "outcome:",
        "  status: pending",
        "  measure_by: 2026-06-01",
      ]);
      const s = gather(repo);
      expect(s.outcomeDue).toEqual([
        { hash: "out001", slug: "shipped", measureBy: "2026-06-01" },
      ]);
      const d = decideRepoNext(s);
      expect(d.row).toBe(5.5);
      expect(d.command).toBe("/devx outcome out001");
    } finally {
      repo.cleanup();
    }
  });

  it("pending + future measure_by → NOT due, NOT mid-pipeline (waiting)", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "out002", "waiting", [
        "outcome:",
        "  status: pending",
        "  measure_by: 2026-12-31",
      ]);
      const s = gather(repo);
      expect(s.outcomeDue).toEqual([]);
      // v1 row 3 (pending-not-due) yields command null → row 9 stays quiet.
      expect(s.midPipeline).toEqual([]);
      expect(decideRepoNext(s).row).toBe(12);
    } finally {
      repo.cleanup();
    }
  });

  it("unarmed (outcome null) done workstream still surfaces at row 9 (arm it)", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "out003", "unarmed", [
        "outcome:",
        "  status: null",
        "  measure_by: null",
      ]);
      const s = gather(repo);
      expect(s.outcomeDue).toEqual([]);
      const d = decideRepoNext(s);
      expect(d.row).toBe(9);
      expect(d.command).toBe("/devx outcome out003");
    } finally {
      repo.cleanup();
    }
  });

  it("scored outcome (keep) is silent — no due signal, no stage row", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "out004", "kept", [
        "outcome:",
        "  status: keep",
        "  measure_by: 2026-06-01",
      ]);
      const s = gather(repo);
      expect(s.outcomeDue).toEqual([]);
      expect(s.midPipeline).toEqual([]);
      expect(decideRepoNext(s).row).toBe(12);
    } finally {
      repo.cleanup();
    }
  });

  it("pending with a malformed measure_by counts as due (never waits forever)", () => {
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "out005", "garbled", [
        "outcome:",
        "  status: pending",
        "  measure_by: whenever",
      ]);
      const s = gather(repo);
      expect(s.outcomeDue).toEqual([
        { hash: "out005", slug: "garbled", measureBy: "whenever" },
      ]);
      expect(decideRepoNext(s).row).toBe(5.5);
    } finally {
      repo.cleanup();
    }
  });

  it("pending + due but stage rolled back (revise) does NOT fire 5.5 — no livelock on an un-scorable command", () => {
    // `devx outcome score` refuses unless stage is done; emitting its
    // command for a revised workstream would shadow rows 6-12 forever
    // (adversarial-review BH#1). The workstream's stage rows surface at
    // row 9 instead.
    const repo = makeEngineRepo();
    try {
      writeClosedWorkstream(repo, "out006", "revised", [
        "outcome:",
        "  status: pending",
        "  measure_by: 2026-06-01",
      ]);
      const content = repo.read("plan/plan-out006-2026-07-05T12:00-revised.md");
      repo.write(
        "plan/plan-out006-2026-07-05T12:00-revised.md",
        content
          .replace("stage: done", "stage: red")
          .replace("  evals_red: true", "  evals_red: false"),
      );
      for (const f of ["prd.md", "expectations.md", "design.md", "plan.md"]) {
        repo.write(`_devx/workstreams/revised/${f}`, "x");
      }
      const s = gather(repo);
      expect(s.outcomeDue).toEqual([]);
      const d = decideRepoNext(s);
      expect(d.row).toBe(9);
      expect(d.command).toBe("/devx red out006"); // evals/ empty → author RED
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 2b. Gatherer hardening (adversarial-review fixes)
// ---------------------------------------------------------------------------

describe("gatherRepoSnapshot — staleness + normalization hardening", () => {
  it("crash-orphaned loop state (status running, stale ts) is NOT live", () => {
    const repo = makeEngineRepo();
    try {
      const staleTs = new Date(NOW.getTime() - 3 * 24 * 3600 * 1000).toISOString();
      repo.write(
        ".devx-cache/loop/state.json",
        JSON.stringify({ status: "running", pid: 12345, ts: staleTs }),
      );
      const s = gather(repo);
      expect(s.loop.live).toBe(false);
      expect(s.warnings.some((w) => w.includes("stale/skewed"))).toBe(true);
      expect(decideRepoNext(s).row).toBe(12); // not wedged at row 1
    } finally {
      repo.cleanup();
    }
  });

  it("loop state running WITHOUT a ts is not trusted (fail-safe + warning)", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(
        ".devx-cache/loop/state.json",
        JSON.stringify({ status: "running", pid: 12345 }),
      );
      const s = gather(repo);
      expect(s.loop.live).toBe(false);
      expect(s.warnings.some((w) => w.includes("missing/unparseable"))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("a future-dated heartbeat (clock skew) beyond the window is NOT live", () => {
    const repo = makeEngineRepo();
    try {
      const futureTs = new Date(NOW.getTime() + 365 * 24 * 3600 * 1000).toISOString();
      repo.write(
        ".devx-cache/state/heartbeat.json",
        JSON.stringify({ ts: futureTs, pid: 1, generation: 1 }),
      );
      const s = gather(repo);
      expect(s.loop.live).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it("spec status is compared case-insensitively — `status: Done` is not drift", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "cse111", "Done");
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "cse111", "done")}\n`);
      const s = gather(repo);
      expect(s.drift).toEqual([]);
      expect(s.unreconciled).toEqual([]);
      expect(decideRepoNext(s).row).toBe(12);
    } finally {
      repo.cleanup();
    }
  });

  it("a `Status: Done` blocker still resolves its dependents", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "dep111", "Done");
      writeSpec(repo, "dev", "kid111", "ready");
      repo.write(
        "DEV.md",
        [
          "# DEV",
          "",
          backlogRow("dev", "dep111", "done"),
          `- [ ] \`dev/dev-kid111-2026-07-05T12:00-fixture.md\` — Kid. Status: ready. Blocked-by: dep111.`,
          "",
        ].join("\n"),
      );
      const s = gather(repo);
      expect(s.devReady.map((i) => i.hash)).toEqual(["kid111"]);
    } finally {
      repo.cleanup();
    }
  });

  it("a struck (~~deleted~~) blocker unblocks its dependents (matches mgr103 reconcile)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "liv111", "ready");
      repo.write(
        "DEV.md",
        [
          "# DEV",
          "",
          "- ~~`dev/dev-gon111-2026-07-05T12:00-fixture.md` — Gone. Status: deleted.~~",
          `- [ ] \`dev/dev-liv111-2026-07-05T12:00-fixture.md\` — Live. Status: ready. Blocked-by: gon111.`,
          "",
        ].join("\n"),
      );
      const s = gather(repo);
      expect(s.devReady.map((i) => i.hash)).toEqual(["liv111"]);
      const d = decideRepoNext(s);
      expect(d.row).toBe(8);
      expect(d.command).toBe("/devx liv111");
    } finally {
      repo.cleanup();
    }
  });

  it("a PLAN.md done-mismatch is drift only — row 4 never targets plan specs", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(
        "plan/plan-pl4444-2026-07-05T12:00-fixture.md",
        specBody("plan", "pl4444", "in-progress"),
      );
      repo.write(
        "PLAN.md",
        `# PLAN\n\n${backlogRow("plan", "pl4444", "done")}\n`,
      );
      const s = gather(repo);
      expect(s.drift).toHaveLength(1);
      expect(s.drift[0].kind).toBe("status-mismatch");
      expect(s.unreconciled).toEqual([]);
      expect(decideRepoNext(s).row).toBe(12); // reported, not routed
    } finally {
      repo.cleanup();
    }
  });

  it("other-session claims surface a warning (a dead peer must not vanish into 'empty')", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "peer11", "in-progress");
      repo.write(
        "DEV.md",
        `# DEV\n\n${backlogRow("dev", "peer11", "in-progress")}\n`,
      );
      repo.write(".devx-cache/locks/spec-peer11.lock", "peer-tok\npid=2\n");
      const s = gather(repo, { sessionToken: "my-tok" });
      expect(s.claims[0].ownership).toBe("other-session");
      expect(
        s.warnings.some(
          (w) => w.includes("peer11") && w.includes("another session"),
        ),
      ).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("an existing-but-unreadable backlog file warns instead of reporting 'empty'", () => {
    const repo = makeEngineRepo();
    try {
      repo.write("DEV.md", "# DEV\n");
      const s = gatherRepoSnapshot({
        repoRoot: repo.root,
        merged: {},
        engine: {
          workstreamsRoot: "_devx/workstreams",
          expectationsMin: 3,
          proseBudgetKb: 60,
        },
        exec: fakeGh([]),
        now: () => NOW,
        fs: {
          readFile: (p: string) => {
            if (p.endsWith("DEV.md")) throw new Error("EACCES: permission denied");
            throw new Error(`ENOENT: ${p}`);
          },
        },
      });
      expect(s.warnings.some((w) => w.includes("DEV.md exists but is unreadable"))).toBe(
        true,
      );
    } finally {
      repo.cleanup();
    }
  });

  it("an unreadable spec de-routes its ready row (no fail-open gate)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "bad111", "ready");
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "bad111", "ready")}\n`);
      const specSuffix = "dev/dev-bad111-2026-07-05T12:00-fixture.md";
      const s = gatherRepoSnapshot({
        repoRoot: repo.root,
        merged: {},
        engine: {
          workstreamsRoot: "_devx/workstreams",
          expectationsMin: 3,
          proseBudgetKb: 60,
        },
        exec: fakeGh([]),
        now: () => NOW,
        fs: {
          readFile: (p: string) => {
            if (p.endsWith(specSuffix)) throw new Error("EIO");
            return readFileSync(p, "utf8");
          },
        },
      });
      expect(s.devReady).toEqual([]);
      expect(s.warnings.some((w) => w.includes("spec unreadable"))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("an overnight report is surfaced on the decision even when no loop is live", () => {
    const repo = makeEngineRepo();
    try {
      repo.write(".devx-cache/reports/2026-07-05-morning.md", "# report");
      const s = gather(repo);
      expect(s.loop.live).toBe(false);
      const d = decideRepoNext(s);
      expect(d.row).toBe(12);
      expect(d.overnightReport).toBe(".devx-cache/reports/2026-07-05-morning.md");
      expect(renderHumanLine(d)).toContain("review it first");
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. CLI — runNext no-arg form
// ---------------------------------------------------------------------------

describe("devx next — repo-level CLI form", () => {
  it("empty repo → row 12 JSON on stdout + human line on stderr", () => {
    const repo = makeEngineRepo();
    try {
      const io = captureIo();
      const code = runNext(["--no-gh"], {
        ...io,
        projectPath: repo.configPath,
        now: () => NOW,
      });
      expect(code).toBe(0);
      const j = JSON.parse(io.stdout().trim()) as Record<string, unknown>;
      expect(j.row).toBe(12);
      expect(j.action).toBe("propose-interview");
      expect(j.command).toBe("/devx-interview");
      expect(j.drift).toEqual([]);
      expect(io.stderr()).toContain("[row 12/propose-interview]");
    } finally {
      repo.cleanup();
    }
  });

  it("--prefer plan is honored end-to-end", () => {
    const repo = makeEngineRepo();
    try {
      // Both a ready DEV item and a mid-pipeline workstream.
      writeSpec(repo, "dev", "ttt111", "ready");
      repo.write("DEV.md", `# DEV\n\n${backlogRow("dev", "ttt111", "ready")}\n`);
      repo.write(
        "plan/plan-uuu222-2026-07-05T12:00-mid.md",
        [
          "---",
          "hash: uuu222",
          "type: plan",
          "status: in-progress",
          "stage: prd",
          "gate_status:",
          "  prd_validated: false",
          "  design_verified: false",
          "  plan_verified: false",
          "  evals_red: false",
          "workstream: _devx/workstreams/mid",
          "---",
          "",
        ].join("\n"),
      );
      repo.mkdir("_devx/workstreams/mid");

      const canonical = captureIo();
      expect(
        runNext(["--no-gh"], {
          ...canonical,
          projectPath: repo.configPath,
          now: () => NOW,
        }),
      ).toBe(0);
      expect((JSON.parse(canonical.stdout().trim()) as { row: number }).row).toBe(8);

      const preferred = captureIo();
      expect(
        runNext(["--no-gh", "--prefer", "plan"], {
          ...preferred,
          projectPath: repo.configPath,
          now: () => NOW,
        }),
      ).toBe(0);
      const j = JSON.parse(preferred.stdout().trim()) as {
        row: number;
        command: string;
      };
      expect(j.row).toBe(9);
      expect(j.command).toBe("/devx prd uuu222");
    } finally {
      repo.cleanup();
    }
  });

  it("--session-token drives the row-5 owned-claim resume", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "vvv333", "in-progress", ["owner: /devx-me-1"]);
      repo.write(
        "DEV.md",
        `# DEV\n\n${backlogRow("dev", "vvv333", "in-progress")}\n`,
      );
      repo.write(".devx-cache/locks/spec-vvv333.lock", "me-1\npid=9\n");
      const io = captureIo();
      const code = runNext(["--no-gh", "--session-token", "me-1"], {
        ...io,
        projectPath: repo.configPath,
        now: () => NOW,
      });
      expect(code).toBe(0);
      const j = JSON.parse(io.stdout().trim()) as {
        row: number;
        command: string;
      };
      expect(j.row).toBe(5);
      expect(j.command).toBe("/devx vvv333");
    } finally {
      repo.cleanup();
    }
  });

  it("rejects unknown flags and bad --prefer values with exit 2", () => {
    const repo = makeEngineRepo();
    try {
      const a = captureIo();
      expect(runNext(["--bogus"], { ...a, projectPath: repo.configPath })).toBe(2);
      expect(a.stderr()).toContain("unknown flag");

      const b = captureIo();
      expect(
        runNext(["--prefer", "dev"], { ...b, projectPath: repo.configPath }),
      ).toBe(2);
      expect(b.stderr()).toContain("--prefer accepts only 'plan'");
    } finally {
      repo.cleanup();
    }
  });

  it("rejects a flag-shaped --session-token value (must not swallow --no-gh)", () => {
    const repo = makeEngineRepo();
    try {
      const io = captureIo();
      expect(
        runNext(["--session-token", "--no-gh"], {
          ...io,
          projectPath: repo.configPath,
        }),
      ).toBe(2);
      expect(io.stderr()).toContain("--session-token requires a non-empty value");
    } finally {
      repo.cleanup();
    }
  });

  it("rejects repo-level flags on the workstream <hash> form (no silent ignore)", () => {
    const repo = makeEngineRepo();
    try {
      const io = captureIo();
      expect(
        runNext(["abc123", "--prefer", "plan"], {
          ...io,
          projectPath: repo.configPath,
        }),
      ).toBe(2);
      expect(io.stderr()).toContain("repo-level form only");
    } finally {
      repo.cleanup();
    }
  });

  it("drift is present in the CLI JSON (reported, not fixed)", () => {
    const repo = makeEngineRepo();
    try {
      writeSpec(repo, "dev", "www444", "done");
      repo.write(
        "DEV.md",
        `# DEV\n\n${backlogRow("dev", "www444", "in-progress")}\n`,
      );
      const io = captureIo();
      expect(
        runNext(["--no-gh"], {
          ...io,
          projectPath: repo.configPath,
          now: () => NOW,
        }),
      ).toBe(0);
      const j = JSON.parse(io.stdout().trim()) as {
        row: number;
        drift: Array<{ kind: string; hash: string }>;
      };
      expect(j.row).toBe(4);
      expect(j.drift).toHaveLength(1);
      expect(j.drift[0]).toMatchObject({
        kind: "status-mismatch",
        hash: "www444",
      });
      // The mismatch is still on disk — nothing was fixed.
      expect(repo.read("DEV.md")).toContain("- [/]");
      expect(
        repo.read("dev/dev-www444-2026-07-05T12:00-fixture.md"),
      ).toContain("status: done");
    } finally {
      repo.cleanup();
    }
  });
});
