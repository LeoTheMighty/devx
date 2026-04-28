// CLI-passthrough tests for `devx merge-gate <hash>` (mrg102).
//
// Strategy:
//   - Build a per-test fixture project on a temp dir with a minimal
//     devx.config.yaml + dev/dev-<hash>-…md spec file.
//   - Drive runMergeGate() through its `exec` test seam — no real `gh` call,
//     no network, no subprocess. Each test asserts (exitCode, JSON-on-stdout,
//     stderr-shape).
//
// Coverage targets per the mrg102 spec ACs and the locked decisions in
// epic-merge-gate-modes.md (party-mode 2026-04-28):
//   1. Each mode's pass + block edges.
//   2. Three exit codes (0 / 1 / 2) consumed by the shell-style /devx caller.
//   3. Three exit-2 paths: no PR yet / gh non-zero / gh malformed JSON.
//   4. Coverage signal: --coverage flag wins; null when coverage.enabled is
//      false; null when enabled but no value supplied (PROD safe-default).
//   5. Status-check rollup distillation (pending > failure > success).
//   6. Review-state collapse (latest-wins per reviewer; COMMENTED ignored).
//
// Spec: dev/dev-mrg102-2026-04-28T19:30-merge-gate-cli.md
// Epic: _bmad-output/planning-artifacts/epic-merge-gate-modes.md

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  aggregateChecks,
  blockingReviewCount,
  type ExecResult,
  runMergeGate,
} from "../src/commands/merge-gate.js";

interface Fixture {
  dir: string;
  configPath: string;
  specPath: string;
}

interface ExecCall {
  cmd: string;
  args: string[];
}

interface FixtureOpts {
  mode?: string;
  coverageEnabled?: boolean;
  trustCount?: number;
  trustInitialN?: number;
  hash?: string;
  branch?: string;
  /** Inject a `pr: <n>` line into spec frontmatter. */
  prInFrontmatter?: number;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-merge-gate-cli-"));
  const hash = opts.hash ?? "test01";
  const branch = opts.branch ?? `feat/dev-${hash}`;
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
  const fmLines = [
    "---",
    `hash: ${hash}`,
    "type: dev",
    "title: test spec for mrg102 cli",
    "status: in-progress",
    `branch: ${branch}`,
  ];
  if (opts.prInFrontmatter !== undefined) fmLines.push(`pr: ${opts.prInFrontmatter}`);
  fmLines.push("---", "", "## Goal", "", "test fixture", "");
  writeFileSync(specPath, fmLines.join("\n"));

  return { dir, configPath, specPath };
}

function destroy(fx: Fixture): void {
  rmSync(fx.dir, { recursive: true, force: true });
}

interface ExecScript {
  /** Map from `${cmd} ${args.join(" ")}` substring to ExecResult. */
  responses: Array<{ match: string; result: ExecResult }>;
  calls: ExecCall[];
}

function makeExec(script: ExecScript): (cmd: string, args: string[]) => ExecResult {
  return (cmd, args) => {
    script.calls.push({ cmd, args });
    const joined = `${cmd} ${args.join(" ")}`;
    for (const r of script.responses) {
      if (joined.includes(r.match)) return r.result;
    }
    throw new Error(`unexpected exec call: ${joined}`);
  };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  decision: { merge: boolean; reason?: string; advice?: string[] } | null;
}

function run(
  fx: Fixture,
  hash: string,
  exec: (cmd: string, args: string[]) => ExecResult,
  flags: { coverage?: number | null } = {},
): RunResult {
  let stdout = "";
  let stderr = "";
  const code = runMergeGate(
    [hash],
    flags,
    {
      out: (s) => {
        stdout += s;
      },
      err: (s) => {
        stderr += s;
      },
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
  return { code, stdout, stderr, decision };
}

const successView: ExecResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    statusCheckRollup: [
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    reviews: [],
  }),
  stderr: "",
};

const prListOk = (n: number): ExecResult => ({
  exitCode: 0,
  stdout: JSON.stringify([{ number: n, state: "OPEN" }]),
  stderr: "",
});

const prListEmpty: ExecResult = { exitCode: 0, stdout: "[]", stderr: "" };

describe("aggregateChecks (unit)", () => {
  it("returns null on empty array", () => {
    expect(aggregateChecks([])).toBe(null);
  });

  it("returns 'pending' when any check is not COMPLETED, even if a sibling failed", () => {
    expect(
      aggregateChecks([
        { status: "COMPLETED", conclusion: "FAILURE" },
        { status: "IN_PROGRESS", conclusion: null },
      ]),
    ).toBe("pending");
  });

  it("returns 'failure' on any FAILURE conclusion", () => {
    expect(
      aggregateChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ]),
    ).toBe("failure");
  });

  it("returns 'cancelled' on any CANCELLED conclusion (no FAILURE present)", () => {
    expect(
      aggregateChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "CANCELLED" },
      ]),
    ).toBe("cancelled");
  });

  it("returns 'action_required' on any ACTION_REQUIRED (no FAILURE/CANCELLED)", () => {
    expect(
      aggregateChecks([
        { status: "COMPLETED", conclusion: "ACTION_REQUIRED" },
      ]),
    ).toBe("action_required");
  });

  it("collapses SKIPPED + NEUTRAL with SUCCESS to overall 'success'", () => {
    expect(
      aggregateChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
        { status: "COMPLETED", conclusion: "NEUTRAL" },
      ]),
    ).toBe("success");
  });
});

describe("blockingReviewCount (unit)", () => {
  it("returns 0 on empty array", () => {
    expect(blockingReviewCount([])).toBe(0);
  });

  it("counts a CHANGES_REQUESTED reviewer as 1", () => {
    expect(
      blockingReviewCount([
        { state: "CHANGES_REQUESTED", author: { login: "alice" } },
      ]),
    ).toBe(1);
  });

  it("dismisses an earlier CHANGES_REQUESTED with a later APPROVED (latest wins)", () => {
    expect(
      blockingReviewCount([
        { state: "CHANGES_REQUESTED", author: { login: "alice" } },
        { state: "APPROVED", author: { login: "alice" } },
      ]),
    ).toBe(0);
  });

  it("ignores COMMENTED / PENDING / DISMISSED reviews entirely", () => {
    expect(
      blockingReviewCount([
        { state: "COMMENTED", author: { login: "alice" } },
        { state: "PENDING", author: { login: "alice" } },
        { state: "DISMISSED", author: { login: "alice" } },
      ]),
    ).toBe(0);
  });

  it("counts distinct reviewers (each reviewer's latest state matters)", () => {
    expect(
      blockingReviewCount([
        { state: "CHANGES_REQUESTED", author: { login: "alice" } },
        { state: "CHANGES_REQUESTED", author: { login: "bob" } },
        { state: "APPROVED", author: { login: "carol" } },
      ]),
    ).toBe(2);
  });

  it("counts CHANGES_REQUESTED only after the latest APPROVED is overridden", () => {
    expect(
      blockingReviewCount([
        { state: "APPROVED", author: { login: "alice" } },
        { state: "CHANGES_REQUESTED", author: { login: "alice" } },
      ]),
    ).toBe(1);
  });
});

describe("runMergeGate — argument validation", () => {
  it("missing args → exit 64 + usage to stderr", () => {
    let stdout = "";
    let stderr = "";
    const code = runMergeGate(
      [],
      {},
      {
        out: (s) => {
          stdout += s;
        },
        err: (s) => {
          stderr += s;
        },
      },
    );
    expect(code).toBe(64);
    expect(stderr).toContain("usage:");
    expect(stdout).toBe("");
  });

  it("invalid hash → exit 64 + error to stderr", () => {
    let stderr = "";
    const code = runMergeGate(
      ["../../etc/passwd"],
      {},
      {
        err: (s) => {
          stderr += s;
        },
      },
    );
    expect(code).toBe(64);
    expect(stderr).toContain("invalid hash");
  });
});

describe("runMergeGate — spec resolution", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => {
    destroy(fx);
  });

  it("returns exit 1 + 'no spec file' when hash matches no file", () => {
    const r = run(fx, "missing", () => {
      throw new Error("exec should not be called when spec missing");
    });
    expect(r.code).toBe(1);
    expect(r.decision).toEqual({
      merge: false,
      reason: expect.stringContaining("no spec file for hash 'missing'"),
    });
  });
});

describe("runMergeGate — PR resolution", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => {
    destroy(fx);
  });

  it("returns exit 2 + 'no PR yet' when gh pr list returns []", () => {
    const script: ExecScript = {
      responses: [{ match: "pr list", result: prListEmpty }],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(2);
    expect(r.decision).toEqual({ merge: false, reason: "no PR yet" });
  });

  it("returns exit 2 + 'gh signal collection failed' when gh pr list exits non-zero", () => {
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: { exitCode: 4, stdout: "", stderr: "auth error" } },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(2);
    expect(r.decision).toEqual({
      merge: false,
      reason: "gh signal collection failed",
    });
    expect(r.stderr).toContain("auth error");
  });

  it("returns exit 2 + safe default when gh pr list returns malformed JSON", () => {
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: { exitCode: 0, stdout: "not json", stderr: "" } },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(2);
    expect(r.decision).toEqual({
      merge: false,
      reason: "gh signal collection failed",
    });
  });

  it("returns exit 2 + safe default when gh pr view returns malformed JSON", () => {
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(123) },
        { match: "pr view", result: { exitCode: 0, stdout: "garbage", stderr: "" } },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(2);
    expect(r.decision?.reason).toBe("gh signal collection failed");
  });

  it("uses frontmatter `pr` when present (skips gh pr list)", () => {
    const fxWithPr = makeFixture({ prInFrontmatter: 99 });
    const script: ExecScript = {
      responses: [{ match: "pr view", result: successView }],
      calls: [],
    };
    const r = run(fxWithPr, "test01", makeExec(script));
    expect(r.code).toBe(0);
    // Only `gh pr view 99` should have been called — no pr list lookup.
    expect(script.calls.some((c) => c.args.includes("list"))).toBe(false);
    expect(script.calls.some((c) => c.args.includes("view") && c.args.includes("99"))).toBe(true);
    destroy(fxWithPr);
  });
});

describe("runMergeGate — mode-derived decisions (full path)", () => {
  it("YOLO + ci=success → merge:true, exit 0", () => {
    const fx = makeFixture({ mode: "YOLO" });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        { match: "pr view", result: successView },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(0);
    expect(r.decision).toEqual({ merge: true });
    destroy(fx);
  });

  it("YOLO + one failed check → merge:false, exit 1, reason mentions CI", () => {
    const fx = makeFixture({ mode: "YOLO" });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        {
          match: "pr view",
          result: {
            exitCode: 0,
            stdout: JSON.stringify({
              statusCheckRollup: [
                { name: "test", status: "COMPLETED", conclusion: "FAILURE" },
              ],
              reviews: [],
            }),
            stderr: "",
          },
        },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(1);
    expect(r.decision?.merge).toBe(false);
    expect(r.decision?.reason).toContain("CI");
    destroy(fx);
  });

  it("YOLO + no checks at all (empty rollup) → null ciConclusion → merge:true", () => {
    // Per the mrg101 contract: `ciConclusion: null` ↔ "no remote CI configured"
    // — local gates were authoritative; YOLO accepts this as merge.
    const fx = makeFixture({ mode: "YOLO" });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        {
          match: "pr view",
          result: {
            exitCode: 0,
            stdout: JSON.stringify({ statusCheckRollup: [], reviews: [] }),
            stderr: "",
          },
        },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(0);
    expect(r.decision).toEqual({ merge: true });
    destroy(fx);
  });

  it("BETA + ci=success + 2 CHANGES_REQUESTED reviewers → merge:false, exit 1", () => {
    const fx = makeFixture({ mode: "BETA" });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        {
          match: "pr view",
          result: {
            exitCode: 0,
            stdout: JSON.stringify({
              statusCheckRollup: [
                { name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
              ],
              reviews: [
                { state: "CHANGES_REQUESTED", author: { login: "alice" } },
                { state: "CHANGES_REQUESTED", author: { login: "bob" } },
              ],
            }),
            stderr: "",
          },
        },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(1);
    expect(r.decision?.reason).toContain("2 blocking reviewer comments");
    destroy(fx);
  });

  it("PROD + coverage.enabled=true + no --coverage → merge:false, 'coverage data missing'", () => {
    const fx = makeFixture({ mode: "PROD", coverageEnabled: true });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        { match: "pr view", result: successView },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(1);
    expect(r.decision?.reason).toContain("coverage data missing");
    destroy(fx);
  });

  it("PROD + coverage.enabled=true + --coverage 1.0 → merge:true, exit 0", () => {
    const fx = makeFixture({ mode: "PROD", coverageEnabled: true });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        { match: "pr view", result: successView },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script), { coverage: 1.0 });
    expect(r.code).toBe(0);
    expect(r.decision).toEqual({ merge: true });
    destroy(fx);
  });

  it("PROD + coverage.enabled=false + --coverage 1.0 → still blocks ('coverage data missing'); flag is ignored when config disables coverage", () => {
    // When coverage.enabled=false the signal is forced to null even if a
    // value is supplied via --coverage. Under PROD that null becomes the
    // safe-default block ("coverage data missing"). Mirrors the cfg policy
    // that disabling coverage in config disables it everywhere — overrides
    // included — so a misconfigured project can't accidentally pass the gate.
    const fx = makeFixture({ mode: "PROD", coverageEnabled: false });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        { match: "pr view", result: successView },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script), { coverage: 1.0 });
    expect(r.code).toBe(1);
    expect(r.decision?.reason).toContain("coverage data missing");
    destroy(fx);
  });

  it("LOCKDOWN mode → merge:false, fixed reason", () => {
    const fx = makeFixture({ mode: "LOCKDOWN" });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        { match: "pr view", result: successView },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(1);
    expect(r.decision?.reason).toBe("lockdown active; manual merge required");
    destroy(fx);
  });

  it("trust-gradient block (count < initialN) → merge:false + advice (overrides mode success)", () => {
    const fx = makeFixture({ mode: "YOLO", trustCount: 0, trustInitialN: 3 });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        { match: "pr view", result: successView },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(1);
    expect(r.decision?.merge).toBe(false);
    expect(r.decision?.advice).toEqual(["file INTERVIEW for approval"]);
    destroy(fx);
  });

  it("a single pending check → ciConclusion=pending → blocked under YOLO", () => {
    // Locked decision: non-success conclusions other than `cancelled` (here:
    // a still-running check) are treated as failure for the gate's purposes.
    const fx = makeFixture({ mode: "YOLO" });
    const script: ExecScript = {
      responses: [
        { match: "pr list", result: prListOk(31) },
        {
          match: "pr view",
          result: {
            exitCode: 0,
            stdout: JSON.stringify({
              statusCheckRollup: [
                { name: "test", status: "IN_PROGRESS", conclusion: null },
              ],
              reviews: [],
            }),
            stderr: "",
          },
        },
      ],
      calls: [],
    };
    const r = run(fx, "test01", makeExec(script));
    expect(r.code).toBe(1);
    expect(r.decision?.reason).toContain("pending");
    destroy(fx);
  });
});
