// D-5 review-hold check tests (v2t101) — library + CLI exit codes.
//
// The contract (v2/07-decisions.md D-5): a `devx: hold` comment or an
// unresolved requested-changes review before CI-green blocks the merge
// tail; SILENCE MERGES. Exit codes: 0 no-hold / 3 hold / 2 gh failure /
// 64 usage.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

import { describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../src/lib/tour/exec.js";
import {
  HOLD_MARKER,
  HoldCheckError,
  checkHold,
  containsHoldMarker,
} from "../src/lib/devx/hold-check.js";
import { runCheckHold } from "../src/commands/devx-helper.js";

const ok = (stdout: string): ExecResult => ({ stdout, stderr: "", exitCode: 0 });

function ghExec(payload: unknown): Exec {
  return (cmd, args) => {
    if (cmd !== "gh") throw new Error(`unexpected cmd ${cmd}`);
    expect(args.slice(0, 3)).toEqual(["pr", "view", "17"]);
    return ok(JSON.stringify(payload));
  };
}

const REPO = "/tmp/fake-repo";

describe("containsHoldMarker", () => {
  it("matches the canonical marker, case-insensitively, with flexible spacing", () => {
    expect(containsHoldMarker("devx: hold")).toBe(true);
    expect(containsHoldMarker("please DEVX:  HOLD this one")).toBe(true);
    expect(containsHoldMarker("devx:hold")).toBe(true);
    expect(containsHoldMarker("nice tour! ship it")).toBe(false);
    expect(containsHoldMarker("devx: holdover budget")).toBe(true); // substring semantics: holding is intentional-safe
  });
});

describe("checkHold — hold triggers", () => {
  it("holds on a `devx: hold` conversation comment (with author in reason)", () => {
    const r = checkHold(17, {
      repoRoot: REPO,
      exec: ghExec({
        comments: [
          { body: "looks fine", author: { login: "bot" } },
          { body: "devx: hold — want to take the tour first", author: { login: "leo" } },
        ],
        reviews: [],
      }),
    });
    expect(r.hold).toBe(true);
    expect(r.reason).toContain(HOLD_MARKER);
    expect(r.reason).toContain("leo");
  });

  it("holds on a `devx: hold` typed into a review body", () => {
    const r = checkHold(17, {
      repoRoot: REPO,
      exec: ghExec({
        comments: [],
        reviews: [{ state: "COMMENTED", body: "devx: hold", author: { login: "leo" } }],
      }),
    });
    expect(r.hold).toBe(true);
    expect(r.reason).toContain("review");
  });

  it("holds on an unresolved requested-changes review", () => {
    const r = checkHold(17, {
      repoRoot: REPO,
      exec: ghExec({
        comments: [],
        reviews: [
          { state: "CHANGES_REQUESTED", body: "", author: { login: "leo" } },
        ],
      }),
    });
    expect(r.hold).toBe(true);
    expect(r.reason).toContain("requested-changes");
  });

  it("a later APPROVED dismisses an earlier CHANGES_REQUESTED (GitHub semantics)", () => {
    const r = checkHold(17, {
      repoRoot: REPO,
      exec: ghExec({
        comments: [],
        reviews: [
          { state: "CHANGES_REQUESTED", body: "", author: { login: "leo" } },
          { state: "APPROVED", body: "", author: { login: "leo" } },
        ],
      }),
    });
    expect(r.hold).toBe(false);
  });
});

describe("checkHold — silence merges (D-5)", () => {
  it("no comments, no reviews → no hold", () => {
    const r = checkHold(17, {
      repoRoot: REPO,
      exec: ghExec({ comments: [], reviews: [] }),
    });
    expect(r).toEqual({ hold: false });
  });

  it("ordinary comments and approvals → no hold", () => {
    const r = checkHold(17, {
      repoRoot: REPO,
      exec: ghExec({
        comments: [{ body: "took the tour, stop 3 is neat", author: { login: "leo" } }],
        reviews: [{ state: "APPROVED", body: "lgtm", author: { login: "leo" } }],
      }),
    });
    expect(r).toEqual({ hold: false });
  });

  it("missing comments/reviews keys degrade to empty arrays", () => {
    const r = checkHold(17, { repoRoot: REPO, exec: ghExec({}) });
    expect(r).toEqual({ hold: false });
  });
});

describe("checkHold — gh failure paths", () => {
  it("throws stage:gh-view on non-zero gh exit", () => {
    const exec: Exec = () => ({ stdout: "", stderr: "auth required", exitCode: 1 });
    try {
      checkHold(17, { repoRoot: REPO, exec });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HoldCheckError);
      expect((e as HoldCheckError).stage).toBe("gh-view");
    }
  });

  it("throws stage:gh-parse on malformed JSON", () => {
    const exec: Exec = () => ok("not json {");
    try {
      checkHold(17, { repoRoot: REPO, exec });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as HoldCheckError).stage).toBe("gh-parse");
    }
  });
});

describe("runCheckHold CLI — exit codes", () => {
  function run(
    args: string[],
    exec: Exec,
  ): { code: number; stdout: string; stderr: string } {
    let stdout = "";
    let stderr = "";
    const code = runCheckHold(args, {
      out: (s) => {
        stdout += s;
      },
      err: (s) => {
        stderr += s;
      },
      repoRoot: REPO,
      holdOpts: { exec },
    });
    return { code, stdout, stderr };
  }

  it("exit 0 + {hold:false} on silence", () => {
    const r = run(["17"], ghExec({ comments: [], reviews: [] }));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ hold: false });
    expect(r.stderr).toBe("");
  });

  it("exit 3 + {hold:true, reason} on a hold comment", () => {
    const r = run(
      ["17"],
      ghExec({ comments: [{ body: "devx: hold" }], reviews: [] }),
    );
    expect(r.code).toBe(3);
    const parsed = JSON.parse(r.stdout) as { hold: boolean; reason: string };
    expect(parsed.hold).toBe(true);
    expect(parsed.reason).toContain(HOLD_MARKER);
    expect(r.stderr).toContain("HOLD");
  });

  it("exit 3 on requested changes", () => {
    const r = run(
      ["17"],
      ghExec({
        comments: [],
        reviews: [{ state: "CHANGES_REQUESTED", author: { login: "leo" } }],
      }),
    );
    expect(r.code).toBe(3);
  });

  it("exit 2 + {error, stage} JSON on gh failure", () => {
    const exec: Exec = () => ({ stdout: "", stderr: "boom", exitCode: 1 });
    const r = run(["17"], exec);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({
      error: "hold-check-failed",
      stage: "gh-view",
    });
  });

  it("exit 64 on usage errors (no arg, non-numeric, zero, extra args)", () => {
    const exec: Exec = () => ok("{}");
    expect(run([], exec).code).toBe(64);
    expect(run(["abc"], exec).code).toBe(64);
    expect(run(["0"], exec).code).toBe(64);
    expect(run(["-3"], exec).code).toBe(64);
    expect(run(["17", "18"], exec).code).toBe(64);
  });
});
