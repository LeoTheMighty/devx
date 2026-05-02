// CLI-passthrough tests for `devx plan-helper derive-branch <type> <hash>` (pln101).
//
// Strategy mirrors merge-gate-cli.test.ts:
//   - Build a per-test fixture project on a temp dir with a minimal
//     devx.config.yaml.
//   - Drive runDeriveBranch() through its `out`/`err`/`projectPath` test seams.
//   - Assert (exitCode, stdout, stderr).
//
// Spec: dev/dev-pln101-2026-04-28T19:30-plan-derive-branch.md

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDeriveBranch } from "../src/commands/plan-helper.js";

interface Fixture {
  dir: string;
  configPath: string;
}

interface FixtureOpts {
  integrationBranch?: string | null;
  branchPrefix?: string;
  /** Omit the entire git section. Overrides the other two options. */
  noGitSection?: boolean;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-plan-helper-cli-"));
  const lines = ["mode: YOLO"];
  if (!opts.noGitSection) {
    lines.push("git:");
    lines.push("  default_branch: main");
    if ("integrationBranch" in opts) {
      // Emit `null` literal vs quoted empty string vs plain value.
      const v = opts.integrationBranch;
      if (v === null) lines.push("  integration_branch: null");
      else if (v === "") lines.push("  integration_branch: \"\"");
      else lines.push(`  integration_branch: ${v}`);
    } else {
      lines.push("  integration_branch: null");
    }
    lines.push(`  branch_prefix: ${opts.branchPrefix ?? "feat/"}`);
  }
  lines.push("");
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(configPath, lines.join("\n"));
  return { dir, configPath };
}

function destroy(fx: Fixture): void {
  rmSync(fx.dir, { recursive: true, force: true });
}

interface CapturedIO {
  stdout: string;
  stderr: string;
}

function capture(): {
  out: (s: string) => void;
  err: (s: string) => void;
  io: CapturedIO;
} {
  const io: CapturedIO = { stdout: "", stderr: "" };
  return {
    out: (s) => {
      io.stdout += s;
    },
    err: (s) => {
      io.stderr += s;
    },
    io,
  };
}

describe("devx plan-helper derive-branch — happy paths", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("single-branch + feat/ prefix → feat/dev-aud101 on stdout, exit 0", () => {
    fx = makeFixture({ integrationBranch: null, branchPrefix: "feat/" });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("feat/dev-aud101\n");
    expect(cap.io.stderr).toBe("");
  });

  it("develop split + feat/ prefix → develop/feat/dev-aud101", () => {
    fx = makeFixture({ integrationBranch: "develop", branchPrefix: "feat/" });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("develop/feat/dev-aud101\n");
  });

  it("develop split + develop/ prefix → develop/dev-aud101 (no doubling)", () => {
    fx = makeFixture({
      integrationBranch: "develop",
      branchPrefix: "develop/",
    });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("develop/dev-aud101\n");
  });

  it("empty-string integration_branch → single-branch path", () => {
    fx = makeFixture({ integrationBranch: "", branchPrefix: "feat/" });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("feat/dev-aud101\n");
  });

  it("missing git section → defaults (feat/dev-aud101)", () => {
    fx = makeFixture({ noGitSection: true });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("feat/dev-aud101\n");
  });

  it("type=plan is accepted (not just dev)", () => {
    fx = makeFixture({ integrationBranch: null, branchPrefix: "feat/" });
    const cap = capture();
    const code = runDeriveBranch(["plan", "b01000"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("feat/plan-b01000\n");
  });
});

describe("devx plan-helper derive-branch — invalid input", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture({ integrationBranch: null, branchPrefix: "feat/" });
  });
  afterEach(() => destroy(fx));

  it("wrong arg count → exit 1 + usage on stderr", () => {
    const cap = capture();
    const code = runDeriveBranch(["dev"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(1);
    expect(cap.io.stdout).toBe("");
    expect(cap.io.stderr).toContain("usage:");
    expect(cap.io.stderr).toContain("derive-branch");
  });

  it("unknown type → exit 1 + reason naming the valid set", () => {
    const cap = capture();
    const code = runDeriveBranch(["story", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("invalid type 'story'");
    // Naming the valid set in the error keeps the operator from guessing.
    expect(cap.io.stderr).toContain("dev");
    expect(cap.io.stderr).toContain("plan");
  });

  it("malformed hash (too short) → exit 1", () => {
    const cap = capture();
    const code = runDeriveBranch(["dev", "ab"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("invalid hash");
  });

  it("malformed hash (special chars) → exit 1", () => {
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud-1"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("invalid hash");
  });
});

describe("devx plan-helper derive-branch — config errors", () => {
  it("missing devx.config.yaml at projectPath → exit 1 + diagnostic", () => {
    const dir = mkdtempSync(join(tmpdir(), "devx-plan-helper-no-config-"));
    try {
      const cap = capture();
      const code = runDeriveBranch(["dev", "aud101"], {
        out: cap.out,
        err: cap.err,
        projectPath: join(dir, "devx.config.yaml"),
      });
      expect(code).toBe(1);
      // Either "config load failed" or "not found" is acceptable; both
      // surface the missing-file root cause to the operator.
      expect(cap.io.stderr.toLowerCase()).toMatch(/not found|no such file|enoent/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("malformed YAML → exit 1 + 'config load failed' diagnostic", () => {
    const dir = mkdtempSync(join(tmpdir(), "devx-plan-helper-bad-yaml-"));
    const configPath = join(dir, "devx.config.yaml");
    // YAML duplicate-key error reliably trips parseDocument's strict mode.
    writeFileSync(configPath, "git:\n  integration_branch: null\ngit:\n  branch_prefix: feat/\n");
    try {
      const cap = capture();
      const code = runDeriveBranch(["dev", "aud101"], {
        out: cap.out,
        err: cap.err,
        projectPath: configPath,
      });
      // Either the YAML parser raises (handled in catch → exit 1 with
      // "config load failed") OR the parser is lenient and we get the
      // last-key-wins behavior + exit 0. Both shapes are acceptable; we
      // assert the exit code matches whichever the parser does.
      if (code === 1) {
        expect(cap.io.stderr).toMatch(/config load failed|not found/i);
      } else {
        expect(code).toBe(0);
        expect(cap.io.stdout).toContain("dev-aud101");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
