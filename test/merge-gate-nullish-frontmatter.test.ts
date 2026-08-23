// Regression tests for debug-7b3e2a: `branch: null` read as the STRING "null".
//
// readFrontmatter hand-rolls a scalar read, and before this fix it assigned the
// raw text — so YAML's three unquoted null spellings (`null`, `~`, and an empty
// value) all became non-empty strings. runMergeGate's branch fallback guards
// with `typeof fm.branch === "string" && fm.branch.length > 0`, which "null"
// passes, so deriveBranch never ran and the gate queried
// `gh pr list --head null`, got `[]`, and returned exit-2 "no PR yet" forever —
// permanently stranding green CI'd PRs on the derived branch.
//
// The assertion that matters is WHICH branch name reaches `gh pr list --head`:
// that is the single observable that separates "used the frontmatter value"
// from "fell through to deriveBranch".
//
// Spec: debug/debug-7b3e2a-2026-08-07T12:40-merge-gate-reads-yaml-null-branch-as-string.md

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type ExecResult,
  readFrontmatter,
  runMergeGate,
} from "../src/commands/merge-gate.js";

interface Fixture {
  configPath: string;
  cleanup: () => void;
}

/** Build a throwaway project whose spec frontmatter carries `branchLine` verbatim
 *  (pass null to omit the key entirely). */
function makeFixture(hash: string, branchLine: string | null): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-merge-gate-nullish-"));
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(
    configPath,
    [
      "mode: YOLO",
      "promotion:",
      "  autonomy:",
      "    count: 0",
      "    initial_n: 0",
      "coverage:",
      "  enabled: false",
      "git:",
      "  default_branch: main",
      "  branch_prefix: feat/",
      "",
    ].join("\n"),
  );

  const specDir = join(dir, "debug");
  mkdirSync(specDir, { recursive: true });
  const fm = ["---", `hash: ${hash}`, "type: debug", "title: nullish branch fixture"];
  if (branchLine !== null) fm.push(branchLine);
  fm.push("---", "", "## Goal", "", "fixture", "");
  writeFileSync(join(specDir, `debug-${hash}-2026-08-07T12:40-fixture.md`), fm.join("\n"));

  return { configPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const greenView: ExecResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    statusCheckRollup: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" }],
    reviews: [],
  }),
  stderr: "",
};

interface RunResult {
  code: number;
  decision: { merge: boolean; reason?: string } | null;
  /** The `--head <branch>` argument the gate asked `gh pr list` for. */
  headArg: string | undefined;
}

function run(fx: Fixture, hash: string, prNumber: number | null): RunResult {
  let headArg: string | undefined;
  let stdout = "";
  const exec = (cmd: string, args: string[]): ExecResult => {
    const joined = `${cmd} ${args.join(" ")}`;
    if (joined.includes("pr list")) {
      headArg = args[args.indexOf("--head") + 1];
      return {
        exitCode: 0,
        stdout: prNumber === null ? "[]" : JSON.stringify([{ number: prNumber, state: "OPEN" }]),
        stderr: "",
      };
    }
    if (joined.includes("pr view")) return greenView;
    if (cmd === "git" && args[0] === "diff") {
      // Outline L2 scan — clean tree in these fixtures.
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected exec call: ${joined}`);
  };
  const code = runMergeGate([hash], {}, {
    out: (s) => {
      stdout += s;
    },
    err: () => {},
    projectPath: fx.configPath,
    exec,
  });
  let decision: RunResult["decision"] = null;
  try {
    decision = JSON.parse(stdout.trim());
  } catch {
    decision = null;
  }
  return { code, decision, headArg };
}

describe("readFrontmatter — YAML nullish scalars (debug-7b3e2a)", () => {
  const cases: Array<[string, string]> = [
    ["bare null", "branch: null"],
    ["tilde", "branch: ~"],
    ["empty value", "branch:"],
    ["empty value with trailing space", "branch: "],
    ["capitalized Null", "branch: Null"],
    ["screaming NULL", "branch: NULL"],
    ["quoted empty string", 'branch: ""'],
    ["null behind an inline comment", "branch: null  # not claimed yet"],
  ];

  for (const [label, line] of cases) {
    it(`reads ${label} as undefined, not a string`, () => {
      const fx = makeFixture("aa0001", line);
      try {
        const specPath = join(
          fx.configPath,
          "..",
          "debug",
          "debug-aa0001-2026-08-07T12:40-fixture.md",
        );
        expect(readFrontmatter(specPath).branch).toBeUndefined();
      } finally {
        fx.cleanup();
      }
    });
  }

  it("keeps a quoted \"null\" as the literal string (YAML says it is one)", () => {
    const fx = makeFixture("aa0002", 'branch: "null"');
    try {
      const specPath = join(
        fx.configPath,
        "..",
        "debug",
        "debug-aa0002-2026-08-07T12:40-fixture.md",
      );
      expect(readFrontmatter(specPath).branch).toBe("null");
    } finally {
      fx.cleanup();
    }
  });

  it("applies the same nullish treatment to status:", () => {
    const dir = mkdtempSync(join(tmpdir(), "devx-merge-gate-nullish-status-"));
    const specPath = join(dir, "spec.md");
    writeFileSync(
      specPath,
      ["---", "hash: aa0003", "status: null", "branch: null", "---", "", "body", ""].join("\n"),
    );
    try {
      const fm = readFrontmatter(specPath);
      expect(fm.status).toBeUndefined();
      expect(fm.status).not.toBe("null");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still reads a real branch value", () => {
    const fx = makeFixture("aa0004", "branch: feat/debug-aa0004");
    try {
      const specPath = join(
        fx.configPath,
        "..",
        "debug",
        "debug-aa0004-2026-08-07T12:40-fixture.md",
      );
      expect(readFrontmatter(specPath).branch).toBe("feat/debug-aa0004");
    } finally {
      fx.cleanup();
    }
  });
});

describe("runMergeGate branch fallback (debug-7b3e2a)", () => {
  const fallbackCases: Array<[string, string | null]> = [
    ["branch: null", "branch: null"],
    ["branch: ~", "branch: ~"],
    ["branch: (empty)", "branch:"],
    ["no branch key at all", null],
  ];

  for (const [label, line] of fallbackCases) {
    it(`${label} falls through to deriveBranch`, () => {
      const fx = makeFixture("bb0001", line);
      try {
        const r = run(fx, "bb0001", 123);
        expect(r.headArg).toBe("feat/debug-bb0001");
        expect(r.headArg).not.toBe("null");
      } finally {
        fx.cleanup();
      }
    });
  }

  it("a real branch value is used verbatim, not re-derived", () => {
    const fx = makeFixture("bb0002", "branch: custom/hand-picked");
    try {
      const r = run(fx, "bb0002", 123);
      expect(r.headArg).toBe("custom/hand-picked");
    } finally {
      fx.cleanup();
    }
  });

  it("gates {merge:true} for a `branch: null` spec with a green PR on the derived branch", () => {
    const fx = makeFixture("bb0003", "branch: null");
    try {
      const r = run(fx, "bb0003", 123);
      expect(r.headArg).toBe("feat/debug-bb0003");
      expect(r.code).toBe(0);
      expect(r.decision).toEqual({ merge: true });
    } finally {
      fx.cleanup();
    }
  });

  it("pre-fix shape: querying --head null would have returned the exit-2 no-PR path", () => {
    // Pins the failure mode itself, so a regression is legible as "we went back
    // to asking for a branch named null" rather than a bare exit-code diff.
    const fx = makeFixture("bb0004", "branch: null");
    try {
      const r = run(fx, "bb0004", null);
      expect(r.code).toBe(2);
      expect(r.decision).toEqual({ merge: false, reason: "no PR yet" });
      expect(r.headArg).toBe("feat/debug-bb0004");
    } finally {
      fx.cleanup();
    }
  });
});
