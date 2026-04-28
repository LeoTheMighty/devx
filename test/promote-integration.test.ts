// promoteIntegrationToDefault tests (mrg103).
//
// Exhaustive coverage per the party-mode locked decision in
// epic-merge-gate-modes:
//   "test/promote-integration.test.ts covers ALL gate-decision paths
//    (4 modes × success/failure CI × trust-gradient on/off); promote
//    function is exercised in CI even though no production code calls it."
//
// The promote wrapper is dead code today, so the test suite IS the regression
// guard. Without exhaustive coverage, the gate could drift between /devx
// Phase 8 and the latent split-branch path and we wouldn't notice until the
// first split-branch user filed a bug.
//
// Each test asserts both the {promoted, reason} return and whether the
// `gh api … merges` call was actually executed — the second assertion is the
// load-bearing one because a wrapper that says promoted:false but DOES hit
// the API is doing the wrong thing on a merge:false gate decision.
//
// Spec: dev/dev-mrg103-2026-04-28T19:30-promote-integration.md
// Epic: _bmad-output/planning-artifacts/epic-merge-gate-modes.md

import { describe, expect, it } from "vitest";

import { type GateSignals } from "../src/lib/merge-gate.js";
import { promoteIntegrationToDefault } from "../src/lib/manage/promote.js";

interface ExecCall {
  cmd: string;
  args: string[];
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function makeExec(responses: Record<string, ExecResult>) {
  const calls: ExecCall[] = [];
  const exec = (cmd: string, args: string[]): ExecResult => {
    calls.push({ cmd, args });
    const joined = `${cmd} ${args.join(" ")}`;
    for (const [match, result] of Object.entries(responses)) {
      if (joined.includes(match)) return result;
    }
    throw new Error(`unexpected exec call: ${joined}`);
  };
  return { exec, calls };
}

const NEUTRAL_TRUST = { count: 0, initialN: 0 };

function signals(overrides: Partial<GateSignals>): GateSignals {
  return {
    ciConclusion: "success",
    lockdownActive: false,
    blockingReviewComments: 0,
    coveragePctTouched: null,
    ...NEUTRAL_TRUST,
    ...overrides,
  };
}

const FIXED_REPO = { owner: "leo", repo: "devx" };

const apiSuccess: ExecResult = {
  exitCode: 0,
  stdout: '{"sha":"abc123"}',
  stderr: "",
};

function findApiCall(calls: ExecCall[]): ExecCall | undefined {
  return calls.find(
    (c) =>
      c.cmd === "gh" &&
      c.args[0] === "api" &&
      c.args.some((a) => a.includes("/merges")),
  );
}

describe("promoteIntegrationToDefault — gate-says-merge paths", () => {
  it("YOLO + ci=success → calls API + returns promoted:true", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault("YOLO", signals({}), {
      exec,
      ownerRepo: FIXED_REPO,
    });
    expect(r.promoted).toBe(true);
    expect(r.reason).toContain("develop → main");
    const api = findApiCall(calls);
    expect(api).toBeDefined();
    expect(api?.args).toContain("repos/leo/devx/merges");
    expect(api?.args).toContain("base=main");
    expect(api?.args).toContain("head=develop");
  });

  it("BETA + ci=success + 0 blocking comments → calls API + promoted:true", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault("BETA", signals({}), {
      exec,
      ownerRepo: FIXED_REPO,
    });
    expect(r.promoted).toBe(true);
    expect(findApiCall(calls)).toBeDefined();
  });

  it("PROD + ci=success + 0 comments + cov=1.0 → calls API + promoted:true", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault(
      "PROD",
      signals({ coveragePctTouched: 1.0 }),
      { exec, ownerRepo: FIXED_REPO },
    );
    expect(r.promoted).toBe(true);
    expect(findApiCall(calls)).toBeDefined();
  });

  it("custom branch pair (head=staging, base=main) → forwards to API", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault("YOLO", signals({}), {
      exec,
      ownerRepo: FIXED_REPO,
      branches: { head: "staging", base: "main" },
    });
    expect(r.promoted).toBe(true);
    const api = findApiCall(calls);
    expect(api?.args).toContain("head=staging");
    expect(api?.args).toContain("base=main");
  });
});

describe("promoteIntegrationToDefault — gate-says-no-merge paths (API NOT called)", () => {
  it("YOLO + ci=failure → no API call + reason carries CI detail", async () => {
    const { exec, calls } = makeExec({
      "/merges": apiSuccess, // would succeed if called — but must not be called
    });
    const r = await promoteIntegrationToDefault(
      "YOLO",
      signals({ ciConclusion: "failure" }),
      { exec, ownerRepo: FIXED_REPO },
    );
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("CI");
    expect(findApiCall(calls)).toBeUndefined();
  });

  it("BETA + 1 blocking review comment → no API call + reason carries 'comment'", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault(
      "BETA",
      signals({ blockingReviewComments: 1 }),
      { exec, ownerRepo: FIXED_REPO },
    );
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("comment");
    expect(findApiCall(calls)).toBeUndefined();
  });

  it("PROD + cov=null → no API call + 'coverage data missing'", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault("PROD", signals({}), {
      exec,
      ownerRepo: FIXED_REPO,
    });
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("coverage data missing");
    expect(findApiCall(calls)).toBeUndefined();
  });

  it("PROD + cov=0.85 → no API call + reason carries 'coverage'", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault(
      "PROD",
      signals({ coveragePctTouched: 0.85 }),
      { exec, ownerRepo: FIXED_REPO },
    );
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("coverage");
    expect(findApiCall(calls)).toBeUndefined();
  });

  it("LOCKDOWN → no API call + fixed reason", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault("LOCKDOWN", signals({}), {
      exec,
      ownerRepo: FIXED_REPO,
    });
    expect(r.promoted).toBe(false);
    expect(r.reason).toBe("lockdown active; manual merge required");
    expect(findApiCall(calls)).toBeUndefined();
  });

  it("trust-gradient block (count<initialN) → no API + advice surfaced as reason", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault(
      "YOLO",
      signals({ count: 0, initialN: 3 }),
      { exec, ownerRepo: FIXED_REPO },
    );
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("file INTERVIEW for approval");
    expect(findApiCall(calls)).toBeUndefined();
  });

  it("runtime lockdownActive=true under YOLO → no API call", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault(
      "YOLO",
      signals({ lockdownActive: true }),
      { exec, ownerRepo: FIXED_REPO },
    );
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("runtime lockdown");
    expect(findApiCall(calls)).toBeUndefined();
  });

  it("unknown mode → no API call + 'unknown mode'", async () => {
    const { exec, calls } = makeExec({ "/merges": apiSuccess });
    const r = await promoteIntegrationToDefault("STAGING", signals({}), {
      exec,
      ownerRepo: FIXED_REPO,
    });
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("unknown mode");
    expect(findApiCall(calls)).toBeUndefined();
  });
});

describe("promoteIntegrationToDefault — full 4×2×2 gate-decision matrix", () => {
  // 4 modes × 2 CI states × 2 trust-gradient states = 16 cases.
  // Each cell asserts the API was/was-not called and that .promoted matches
  // the gate's verdict at the same (mode, signals) tuple. Using a matrix here
  // (rather than 16 hand-written tests) keeps the regression suite readable
  // and makes it obvious which cell breaks if mergeGateFor's truth table
  // shifts.
  const modes = ["YOLO", "BETA", "PROD", "LOCKDOWN"] as const;
  const ciStates = [
    { name: "success", value: "success" as const },
    { name: "failure", value: "failure" as const },
  ];
  const trustStates = [
    { name: "trust-ok", count: 0, initialN: 0 },
    { name: "trust-blocked", count: 0, initialN: 5 },
  ];

  // Expected `promoted` per (mode, ci, trust). Trust-blocked always blocks
  // (overrides mode). LOCKDOWN always blocks. PROD requires cov=null OR
  // cov<1.0 to fail; we send cov=1.0 so PROD passes when CI green + trust OK.
  function expectedPromoted(
    mode: string,
    ci: "success" | "failure",
    trustBlocked: boolean,
  ): boolean {
    if (trustBlocked) return false;
    if (mode === "LOCKDOWN") return false;
    if (ci !== "success") return false;
    // YOLO/BETA/PROD: with comments=0, cov=1.0, lockdownActive=false → all pass
    return true;
  }

  for (const mode of modes) {
    for (const ci of ciStates) {
      for (const trust of trustStates) {
        const trustBlocked = trust.count < trust.initialN;
        const want = expectedPromoted(mode, ci.value, trustBlocked);
        it(`${mode} + ci=${ci.name} + ${trust.name} → promoted=${want}, API ${want ? "called" : "NOT called"}`, async () => {
          const { exec, calls } = makeExec({ "/merges": apiSuccess });
          const r = await promoteIntegrationToDefault(
            mode,
            signals({
              ciConclusion: ci.value,
              coveragePctTouched: 1.0,
              count: trust.count,
              initialN: trust.initialN,
            }),
            { exec, ownerRepo: FIXED_REPO },
          );
          expect(r.promoted).toBe(want);
          expect(findApiCall(calls) !== undefined).toBe(want);
        });
      }
    }
  }
});

describe("promoteIntegrationToDefault — gh api failure modes", () => {
  it("gh api non-2xx → promoted:false + stderr surfaced in reason", async () => {
    const { exec, calls } = makeExec({
      "/merges": {
        exitCode: 1,
        stdout: "",
        stderr: '{"message":"merge_conflict"}',
      },
    });
    const r = await promoteIntegrationToDefault("YOLO", signals({}), {
      exec,
      ownerRepo: FIXED_REPO,
    });
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("merge_conflict");
    expect(r.reason).toContain("repos/leo/devx/merges");
    // API WAS called (gate said yes; gh failed) — distinct from the
    // gate-blocked path where the API isn't called at all.
    expect(findApiCall(calls)).toBeDefined();
  });

  it("owner/repo resolution failure (gh repo view non-zero) → no merges call", async () => {
    // No ownerRepo passed → wrapper falls back to `gh repo view`. We script
    // that to fail, and assert we never reach the merges endpoint.
    const { exec, calls } = makeExec({
      "repo view": { exitCode: 1, stdout: "", stderr: "auth required" },
      "/merges": apiSuccess, // would succeed if reached — must not be reached
    });
    const r = await promoteIntegrationToDefault("YOLO", signals({}), { exec });
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("could not resolve owner/repo");
    expect(findApiCall(calls)).toBeUndefined();
  });

  it("owner/repo resolution returns malformed JSON → no merges call", async () => {
    const { exec, calls } = makeExec({
      "repo view": { exitCode: 0, stdout: "garbage", stderr: "" },
      "/merges": apiSuccess,
    });
    const r = await promoteIntegrationToDefault("YOLO", signals({}), { exec });
    expect(r.promoted).toBe(false);
    expect(r.reason).toContain("could not resolve owner/repo");
    expect(findApiCall(calls)).toBeUndefined();
  });
});
