// End-to-end test: each mode's gate decision flowing through to /devx's
// merge command (dvx106 AC #6).
//
// Two layers:
//   1. `deriveMergeAdvice(decision)` — pure unit tests for the routing
//      mapper (every block path → exactly one of three keywords).
//   2. Full path through `runMergeGate` with mocked gh, asserting that for
//      every (mode, signals) tuple in the spec's behavior table, the
//      JSON emitted to stdout contains the routing keyword the skill
//      body's Phase 8 dispatches on.
//
// The "merge command" in the AC is `gh pr merge <#> --squash --delete-branch`
// (the YOLO bright-line case). Tests assert presence-of-keyword for the
// {merge: true, advice ∅} branch and absence-of-keyword for every block —
// which is the structural invariant the skill body relies on.
//
// Reaffirms:
//   - feedback_yolo_auto_merge.md: YOLO + green CI → merge:true with no
//     trailing advice. If a future change adds "advice" to the YOLO green
//     case, this test fails — that's the regression-prevention goal.
//   - feedback_gh_pr_merge_in_worktree.md: the merge:true branch's expected
//     follow-up commands (`gh pr merge --squash --delete-branch` then
//     `gh pr view --json state,mergeCommit`) are pinned by the
//     skill-body discipline test in `test/devx-skill-phase8-discipline.test.ts`.
//
// Spec: dev/dev-dvx106-2026-04-28T19:30-devx-auto-merge-gate.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ADVICE_INTERVIEW,
  ADVICE_MANUAL,
  ADVICE_WAIT_CI,
  deriveMergeAdvice,
} from "../src/lib/devx/auto-merge-action.js";
import { type ExecResult, runMergeGate } from "../src/commands/merge-gate.js";

// ---------------------------------------------------------------------------
// Layer 1: deriveMergeAdvice unit tests
// ---------------------------------------------------------------------------

describe("deriveMergeAdvice (pure)", () => {
  it("merge:true → empty array", () => {
    expect(deriveMergeAdvice({ merge: true })).toEqual([]);
  });

  it("trust-gradient block (existing advice) → preserved verbatim", () => {
    expect(
      deriveMergeAdvice({ merge: false, advice: [ADVICE_INTERVIEW] }),
    ).toEqual([ADVICE_INTERVIEW]);
  });

  it("filters out non-canonical advice values, keeps canonical ones", () => {
    // mrg101 only emits canonical keywords today, but if a future change
    // sneaks in a freeform string we drop it rather than letting it leak
    // through to the skill body's switch (which would silently fall into
    // the default branch instead of producing an explicit error).
    const result = deriveMergeAdvice({
      merge: false,
      advice: ["something garbage", ADVICE_INTERVIEW],
    });
    expect(result).toEqual([ADVICE_INTERVIEW]);
  });

  it("advice present but all non-canonical → defaults to MANUAL (NOT reason-fallthrough)", () => {
    // Critical regression-prevention: if mrg101 ever emits non-canonical
    // advice (e.g. a typo), we MUST NOT fall through to reason-matching —
    // that would silently overwrite the gate's explicit routing decision
    // with a derived guess. Defaulting to MANUAL preserves "the gate said
    // something, we don't recognize it, ask a human" semantics.
    const result = deriveMergeAdvice({
      merge: false,
      advice: ["totally bogus value"],
      // Reason that WOULD match `^CI not green` if we fell through —
      // proving the function does NOT take that path.
      reason: "CI not green (conclusion=failure)",
    });
    expect(result).toEqual([ADVICE_MANUAL]);
  });

  it("advice present but empty array → still preserves explicit-gate semantics; defaults to MANUAL", () => {
    // Same regression-prevention as above: an explicitly-empty advice
    // array is the gate signaling "I have an opinion but nothing to say."
    // Don't reason-match; default to MANUAL.
    const result = deriveMergeAdvice({
      merge: false,
      advice: [],
      reason: "CI not green (conclusion=failure)",
    });
    expect(result).toEqual([ADVICE_MANUAL]);
  });

  it("CI not green (conclusion=failure) → 'wait for CI' (Phase 7 fix-forwards)", () => {
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "CI not green (conclusion=failure)",
      }),
    ).toEqual([ADVICE_WAIT_CI]);
  });

  it("CI not green (conclusion=pending) → 'wait for CI' (re-poll resolves)", () => {
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "CI not green (conclusion=pending)",
      }),
    ).toEqual([ADVICE_WAIT_CI]);
  });

  it("CI not green (conclusion=cancelled) → 'manual merge required' (user cancelled; won't auto-restart)", () => {
    // A cancelled workflow is not auto-recoverable — re-polling would loop
    // forever. Per AC #3 "wait for CI" means "re-enter Phase 7 polling";
    // cancelled needs human action (re-trigger or abandon), so it routes
    // to MANUAL.md instead.
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "CI not green (conclusion=cancelled)",
      }),
    ).toEqual([ADVICE_MANUAL]);
  });

  it("CI not green (conclusion=action_required) → 'manual merge required' (workflow needs human approval)", () => {
    // action_required means a deployment-protection-rule or environment
    // approval gate is blocking. Polling won't help; a human must approve.
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "CI not green (conclusion=action_required)",
      }),
    ).toEqual([ADVICE_MANUAL]);
  });

  it("lockdown reason → 'manual merge required'", () => {
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "lockdown active; manual merge required",
      }),
    ).toEqual([ADVICE_MANUAL]);
  });

  it("runtime lockdown reason → 'manual merge required'", () => {
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "runtime lockdown flag set; manual merge required",
      }),
    ).toEqual([ADVICE_MANUAL]);
  });

  it("blocking reviewer comments reason → 'manual merge required'", () => {
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "2 blocking reviewer comments unresolved",
      }),
    ).toEqual([ADVICE_MANUAL]);
  });

  it("PROD coverage missing reason → 'manual merge required'", () => {
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "PROD: coverage data missing",
      }),
    ).toEqual([ADVICE_MANUAL]);
  });

  it("PROD coverage below threshold reason → 'manual merge required'", () => {
    expect(
      deriveMergeAdvice({
        merge: false,
        reason: "PROD: touched-line coverage 85.0% < 100%",
      }),
    ).toEqual([ADVICE_MANUAL]);
  });

  it("unknown mode reason → 'manual merge required' (config fix needed)", () => {
    expect(
      deriveMergeAdvice({ merge: false, reason: "unknown mode: STAGING" }),
    ).toEqual([ADVICE_MANUAL]);
  });

  it("merge:false with no reason at all → defaults to 'manual merge required' (safe default)", () => {
    expect(deriveMergeAdvice({ merge: false })).toEqual([ADVICE_MANUAL]);
  });

  it("the three keywords are exact strings (skill body parses by ===)", () => {
    // Pin the keyword strings so a typo in either auto-merge-action.ts or
    // the skill body shows up as a test failure rather than a silent
    // dispatch-fallthrough.
    expect(ADVICE_INTERVIEW).toBe("file INTERVIEW for approval");
    expect(ADVICE_WAIT_CI).toBe("wait for CI");
    expect(ADVICE_MANUAL).toBe("manual merge required");
  });
});

// ---------------------------------------------------------------------------
// Layer 2: end-to-end through runMergeGate (mocked gh)
// ---------------------------------------------------------------------------

interface Fixture {
  dir: string;
  configPath: string;
}

interface FixtureOpts {
  mode?: string;
  coverageEnabled?: boolean;
  trustCount?: number;
  trustInitialN?: number;
  hash?: string;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-auto-merge-flow-"));
  const hash = opts.hash ?? "test01";
  const branch = `feat/dev-${hash}`;
  const config = [
    `mode: ${opts.mode ?? "YOLO"}`,
    "promotion:",
    "  autonomy:",
    `    count: ${opts.trustCount ?? 0}`,
    `    initial_n: ${opts.trustInitialN ?? 0}`,
    "coverage:",
    `  enabled: ${opts.coverageEnabled === true ? "true" : "false"}`,
    "git:",
    "  default_branch: main",
    "  branch_prefix: feat/",
    "",
  ].join("\n");
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(configPath, config);

  const specDir = join(dir, "dev");
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, `dev-${hash}-2026-04-28T22:30-test.md`);
  writeFileSync(
    specPath,
    [
      "---",
      `hash: ${hash}`,
      "type: dev",
      "title: e2e flow fixture",
      "status: in-progress",
      `branch: ${branch}`,
      "---",
      "",
      "## Goal",
      "",
      "fixture",
      "",
    ].join("\n"),
  );

  return { dir, configPath };
}

function destroy(fx: Fixture): void {
  rmSync(fx.dir, { recursive: true, force: true });
}

interface ExecScript {
  responses: Array<{ match: string; result: ExecResult }>;
}

function makeExec(script: ExecScript): (cmd: string, args: string[]) => ExecResult {
  return (cmd, args) => {
    const joined = `${cmd} ${args.join(" ")}`;
    for (const r of script.responses) {
      if (joined.includes(r.match)) return r.result;
    }
    throw new Error(`unexpected exec call: ${joined}`);
  };
}

interface RunResult {
  code: number;
  decision: { merge: boolean; reason?: string; advice?: string[] } | null;
}

function run(
  fx: Fixture,
  hash: string,
  exec: (cmd: string, args: string[]) => ExecResult,
  flags: { coverage?: number | null } = {},
): RunResult {
  let stdout = "";
  const code = runMergeGate(
    [hash],
    flags,
    {
      out: (s) => {
        stdout += s;
      },
      err: () => {},
      projectPath: fx.configPath,
      exec,
    },
  );
  let decision: RunResult["decision"] = null;
  if (stdout.trim().length > 0) {
    try {
      decision = JSON.parse(stdout.trim());
    } catch {
      decision = null;
    }
  }
  return { code, decision };
}

const successView: ExecResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    statusCheckRollup: [
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    reviews: [],
  }),
  stderr: "",
};

const failView: ExecResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    statusCheckRollup: [
      { name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
    ],
    reviews: [],
  }),
  stderr: "",
};

const blockingReviewView: ExecResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    statusCheckRollup: [
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    reviews: [{ state: "CHANGES_REQUESTED", author: { login: "alice" } }],
  }),
  stderr: "",
};

const prListOk = (n: number): ExecResult => ({
  exitCode: 0,
  stdout: JSON.stringify([{ number: n, state: "OPEN" }]),
  stderr: "",
});

interface ScenarioRow {
  name: string;
  mode: string;
  signals: ExecResult;
  trustCount?: number;
  trustInitialN?: number;
  coverageEnabled?: boolean;
  coverage?: number | null;
  expectedExit: 0 | 1;
  /** When merge:true, advice is undefined; otherwise an array with one keyword. */
  expectedAdvice?: string[] | undefined;
}

const scenarios: ScenarioRow[] = [
  // YOLO bright-line: green → merge (the feedback_yolo_auto_merge.md case)
  {
    name: "YOLO + ci=success → merge",
    mode: "YOLO",
    signals: successView,
    expectedExit: 0,
    expectedAdvice: undefined,
  },
  // YOLO + CI failure → wait for CI
  {
    name: "YOLO + ci=failure → 'wait for CI'",
    mode: "YOLO",
    signals: failView,
    expectedExit: 1,
    expectedAdvice: [ADVICE_WAIT_CI],
  },
  // BETA + green + no comments → merge
  {
    name: "BETA + ci=success + no comments → merge",
    mode: "BETA",
    signals: successView,
    expectedExit: 0,
    expectedAdvice: undefined,
  },
  // BETA + green + 1 blocking comment → manual
  {
    name: "BETA + green + 1 blocking comment → 'manual merge required'",
    mode: "BETA",
    signals: blockingReviewView,
    expectedExit: 1,
    expectedAdvice: [ADVICE_MANUAL],
  },
  // PROD + green + cov=1.0 → merge
  {
    name: "PROD + green + cov=1.0 → merge",
    mode: "PROD",
    signals: successView,
    coverageEnabled: true,
    coverage: 1.0,
    expectedExit: 0,
    expectedAdvice: undefined,
  },
  // PROD + green + cov missing → manual (coverage fix)
  {
    name: "PROD + green + coverage missing → 'manual merge required'",
    mode: "PROD",
    signals: successView,
    coverageEnabled: true,
    coverage: undefined,
    expectedExit: 1,
    expectedAdvice: [ADVICE_MANUAL],
  },
  // PROD + green + cov below threshold → manual
  {
    name: "PROD + green + cov=0.85 → 'manual merge required'",
    mode: "PROD",
    signals: successView,
    coverageEnabled: true,
    coverage: 0.85,
    expectedExit: 1,
    expectedAdvice: [ADVICE_MANUAL],
  },
  // LOCKDOWN → manual (mode change required)
  {
    name: "LOCKDOWN + green → 'manual merge required'",
    mode: "LOCKDOWN",
    signals: successView,
    expectedExit: 1,
    expectedAdvice: [ADVICE_MANUAL],
  },
  // Trust-gradient block override on otherwise-green YOLO
  {
    name: "trust-gradient block (count=0, initialN=10) → 'file INTERVIEW for approval'",
    mode: "YOLO",
    signals: successView,
    trustCount: 0,
    trustInitialN: 10,
    expectedExit: 1,
    expectedAdvice: [ADVICE_INTERVIEW],
  },
  // Trust-gradient block ALSO overrides PROD failure cases
  {
    name: "trust-gradient block (count=2, initialN=5) under PROD → INTERVIEW (override > mode)",
    mode: "PROD",
    signals: successView,
    coverageEnabled: true,
    coverage: 0.5,
    trustCount: 2,
    trustInitialN: 5,
    expectedExit: 1,
    expectedAdvice: [ADVICE_INTERVIEW],
  },
  // Trust-gradient ALSO overrides LOCKDOWN — override runs before mode logic
  {
    name: "trust-gradient block (count=0, initialN=3) under LOCKDOWN → INTERVIEW (override > LOCKDOWN)",
    mode: "LOCKDOWN",
    signals: successView,
    trustCount: 0,
    trustInitialN: 3,
    expectedExit: 1,
    expectedAdvice: [ADVICE_INTERVIEW],
  },
];

describe("runMergeGate end-to-end: each mode → /devx merge command", () => {
  for (const sc of scenarios) {
    let fx: Fixture | null = null;
    afterEach(() => {
      if (fx) destroy(fx);
      fx = null;
    });

    // eslint-disable-next-line @typescript-eslint/no-loop-func
    it(sc.name, () => {
      fx = makeFixture({
        mode: sc.mode,
        coverageEnabled: sc.coverageEnabled,
        trustCount: sc.trustCount,
        trustInitialN: sc.trustInitialN,
      });
      const script: ExecScript = {
        responses: [
          { match: "pr list", result: prListOk(31) },
          { match: "pr view", result: sc.signals },
        ],
      };
      const flags: { coverage?: number | null } = {};
      if (sc.coverage !== undefined) flags.coverage = sc.coverage;
      const r = run(fx, "test01", makeExec(script), flags);
      expect(r.code).toBe(sc.expectedExit);
      if (sc.expectedExit === 0) {
        // The "merge command" is the gate green-light. /devx Phase 8
        // invokes `gh pr merge <#> --squash --delete-branch` next.
        expect(r.decision).toEqual({ merge: true });
      } else {
        expect(r.decision?.merge).toBe(false);
        expect(r.decision?.advice).toEqual(sc.expectedAdvice);
      }
    });
  }

  it("the routing keyword set has exactly three values (no silent additions)", () => {
    // If a future change adds a fourth keyword without updating the skill
    // body's Phase 8 dispatch, this assertion fails so the discrepancy
    // surfaces at PR-review time rather than at runtime.
    const all = [ADVICE_INTERVIEW, ADVICE_WAIT_CI, ADVICE_MANUAL];
    expect(new Set(all).size).toBe(3);
  });
});

describe("YOLO auto-merge invariant (reaffirms feedback_yolo_auto_merge.md)", () => {
  // The memory says: YOLO means /devx merges its own PRs; never stop at "PR
  // awaiting human merge" in YOLO. The structural assertion here: under
  // YOLO + green CI, the gate returns merge:true with no advice — there is
  // nothing for /devx to "leave for the user to do."
  it("YOLO + green CI + open PR → merge:true with no advice or reason", () => {
    const fx = makeFixture({ mode: "YOLO" });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(99) },
        { match: "pr view", result: successView },
      ],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(0);
    expect(r.decision).toEqual({ merge: true });
    // Targeted negative assertions: the regression we're guarding against
    // is "advice or reason snuck in on a green merge" (which would prompt
    // the skill body to dispatch instead of merging). We don't ossify the
    // exact key set — additive telemetry fields (gateVersion, decisionId)
    // are fine; advice/reason are not.
    expect(r.decision).not.toHaveProperty("advice");
    expect(r.decision).not.toHaveProperty("reason");
    destroy(fx);
  });

  it("YOLO + green + null statusCheckRollup (no remote CI configured) → merge:true", () => {
    // Phase 7 returns state=no-workflow when no GitHub Actions are wired;
    // local CI is authoritative. Under YOLO the gate STILL says merge.
    const fx = makeFixture({ mode: "YOLO" });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(99) },
        {
          match: "pr view",
          result: {
            exitCode: 0,
            stdout: JSON.stringify({ statusCheckRollup: [], reviews: [] }),
            stderr: "",
          },
        },
      ],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(0);
    expect(r.decision).toEqual({ merge: true });
    destroy(fx);
  });
});
