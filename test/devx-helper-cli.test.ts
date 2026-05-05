// CLI-passthrough tests for `devx devx-helper claim <hash>` (dvx101).
//
// Strategy mirrors plan-helper-cli.test.ts:
//   - Build a per-test fixture project on a temp dir with a minimal
//     devx.config.yaml + DEV.md + dev/dev-<hash>-…md.
//   - Drive runClaim() through its test seams (`projectPath`, `repoRoot`,
//     `claimOpts.fs/exec`).
//   - Assert (exitCode, stdout JSON, stderr message).
//
// The four exit codes (0/1/2/64) round-trip every shell-side branch the
// /devx Phase 1 step needs to handle.
//
// Spec: dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type ClaimFs,
  type ExecResult,
} from "../src/lib/devx/claim.js";
import { runClaim } from "../src/commands/devx-helper.js";

interface Fixture {
  dir: string;
  configPath: string;
  specPath: string;
  devMdPath: string;
}

interface FixtureOpts {
  hash?: string;
  prefilledLock?: boolean;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-helper-claim-cli-"));
  const hash = opts.hash ?? "dvx101";
  const config = [
    "mode: YOLO",
    "git:",
    "  default_branch: main",
    "  integration_branch: null",
    "  branch_prefix: feat/",
    "",
  ].join("\n");
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(configPath, config);

  const devMdPath = join(dir, "DEV.md");
  writeFileSync(
    devMdPath,
    [
      "# DEV",
      "",
      "### Epic test",
      `- [ ] \`dev/dev-${hash}-2026-04-28T19:30-fixture.md\` — Fixture. Status: ready. Blocked-by: none.`,
      "",
    ].join("\n"),
  );

  const specDir = join(dir, "dev");
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, `dev-${hash}-2026-04-28T19:30-fixture.md`);
  writeFileSync(
    specPath,
    [
      "---",
      `hash: ${hash}`,
      "type: dev",
      "created: 2026-04-28T19:30:00-07:00",
      "title: Fixture",
      "status: ready",
      "branch: feat/dev-" + hash,
      "---",
      "",
      "## Goal",
      "",
      "Test.",
      "",
      "## Status log",
      "",
      "- 2026-04-28T19:30 — created by /devx-plan",
      "",
    ].join("\n"),
  );

  if (opts.prefilledLock) {
    const lockDir = join(dir, ".devx-cache", "locks");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, `spec-${hash}.lock`), "prior\n");
  }

  return { dir, configPath, specPath, devMdPath };
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

/**
 * Stub git so the CLI tests don't shell out. mirrors merge-gate-cli's
 * `exec` seam pattern.
 */
function stubExec(
  opts: { failOn?: string } = {},
): (cmd: string, args: string[]) => ExecResult {
  return (cmd, args) => {
    const joined = `${cmd} ${args.join(" ")}`;
    if (opts.failOn && joined.includes(opts.failOn)) {
      return { stdout: "", stderr: `mock fail: ${joined}`, exitCode: 1 };
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
      return { stdout: "deadbeef\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("devx devx-helper claim — happy path", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("exit 0 + JSON {branch, lockPath, claimSha} on stdout", async () => {
    fx = makeFixture();
    const cap = capture();
    const code = await runClaim(["dvx101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
      sessionId: "test-sid",
      claimOpts: { exec: stubExec() },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.branch).toBe("feat/dev-dvx101");
    expect(parsed.lockPath).toBe(
      join(fx.dir, ".devx-cache", "locks", "spec-dvx101.lock"),
    );
    expect(parsed.claimSha).toBe("deadbeef");
  });
});

describe("devx devx-helper claim — exit 1 (lock held)", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("emits {error, lockPath} on stdout + stderr message + exit 1", async () => {
    fx = makeFixture({ prefilledLock: true });
    const cap = capture();
    const code = await runClaim(["dvx101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
      sessionId: "test-sid",
      claimOpts: { exec: stubExec() },
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.error).toBe("lock held");
    expect(parsed.lockPath).toBe(
      join(fx.dir, ".devx-cache", "locks", "spec-dvx101.lock"),
    );
    expect(cap.io.stderr).toMatch(/spec lock already held/);
  });
});

describe("devx devx-helper claim — exit 2 (rollback)", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("emits {error, stage} on stdout + stderr detail + exit 2 when commit fails", async () => {
    fx = makeFixture();
    const cap = capture();
    const code = await runClaim(["dvx101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
      sessionId: "test-sid",
      claimOpts: { exec: stubExec({ failOn: "commit" }) },
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.error).toBe("rollback");
    expect(parsed.stage).toBe("git-commit");
    expect(cap.io.stderr).toMatch(/git-commit/);
  });

  it("emits exit 2 when no spec file matches the hash", async () => {
    fx = makeFixture();
    const cap = capture();
    const code = await runClaim(["zzz999"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
      sessionId: "test-sid",
      claimOpts: { exec: stubExec() },
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.error).toBe("rollback");
    expect(parsed.stage).toBe("resolve");
  });
});

describe("devx devx-helper claim — exit 64 (usage)", () => {
  it("missing hash arg → exit 64 + stderr usage", async () => {
    const cap = capture();
    const code = await runClaim([], { out: cap.out, err: cap.err });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/usage:/);
  });

  it("invalid hash shape → exit 64", async () => {
    const cap = capture();
    const code = await runClaim(["../bad"], { out: cap.out, err: cap.err });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/invalid hash/);
  });

  it("missing devx.config.yaml → exit 2 with JSON {error, stage: 'config-load'} on stdout", async () => {
    const cap = capture();
    const code = await runClaim(["dvx101"], {
      out: cap.out,
      err: cap.err,
      projectPath: "/nonexistent/devx.config.yaml",
    });
    // Adversarial-review-surfaced contract gap: exit 2 must always emit
    // the {error, stage} JSON shape on stdout (file header lines 25-26).
    // Pre-fix this branch wrote nothing to stdout.
    expect(code).toBe(2);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.error).toBe("rollback");
    expect(parsed.stage).toBe("config-load");
  });
});
