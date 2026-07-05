// CLI + library tests for `devx devx-helper verify-claim <hash>` (roc101).
//
// Strategy mirrors devx-helper-cli.test.ts:
//   - Build a per-test fixture project on a temp dir with a minimal
//     dev/dev-<hash>-…md spec (configurable status/owner) and an optional
//     .devx-cache/locks/spec-<hash>.lock (configurable content).
//   - Drive runVerifyClaim() through its test seams (`repoRoot`).
//   - Assert (exitCode, stdout JSON, stderr message).
//
// The four exit codes (0/3/4/2, plus 64 usage) round-trip every shell-side
// branch the /devx Phase 1 resume-detection subsection needs to handle.
// Coverage is cartesian over lock-exists × token-matches × spec-status per
// the spec AC.
//
// Spec: dev/dev-roc101-2026-05-07T08:50-devx-resume-owner-check.md

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  VerifyClaimError,
  normalizeSessionToken,
  parseLockOwner,
  parseSpecClaimFields,
  verifyClaim,
} from "../src/lib/devx/verify-claim.js";
import { runVerifyClaim } from "../src/commands/devx-helper.js";

const HASH = "roc101";
const OWNER_SID = "2026-07-05T0953-22822";

interface Fixture {
  dir: string;
  specPath: string;
  lockPath: string;
}

interface FixtureOpts {
  hash?: string;
  /** Spec frontmatter status line value. Default "in-progress". */
  specStatus?: string;
  /** Spec frontmatter owner value; null omits the line. Default `/devx-<OWNER_SID>`. */
  specOwner?: string | null;
  /** Lock file body; undefined = no lock file (and no locks dir unless mkLockDir). */
  lockBody?: string;
  /** Create the .devx-cache/locks dir even without a lock file. */
  mkLockDir?: boolean;
  /** Skip writing the spec file entirely. */
  noSpec?: boolean;
  /** Raw spec content override (skips the canonical composition). */
  rawSpec?: string;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-verify-claim-"));
  const hash = opts.hash ?? HASH;
  const specDir = join(dir, "dev");
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, `dev-${hash}-2026-05-07T08:50-fixture.md`);
  if (!opts.noSpec) {
    if (opts.rawSpec !== undefined) {
      writeFileSync(specPath, opts.rawSpec);
    } else {
      const status = opts.specStatus ?? "in-progress";
      const owner =
        opts.specOwner === undefined ? `/devx-${OWNER_SID}` : opts.specOwner;
      writeFileSync(
        specPath,
        [
          "---",
          `hash: ${hash}`,
          "type: dev",
          "created: 2026-05-07T08:50:00-06:00",
          "title: Fixture",
          `status: ${status}`,
          ...(owner === null ? [] : [`owner: ${owner}`]),
          `branch: feat/dev-${hash}`,
          "---",
          "",
          "## Goal",
          "",
          "Test.",
          "",
          "## Status log",
          "",
          "- 2026-05-07T08:50 — created by /devx-plan",
          "",
        ].join("\n"),
      );
    }
  }

  const lockPath = join(dir, ".devx-cache", "locks", `spec-${hash}.lock`);
  if (opts.lockBody !== undefined || opts.mkLockDir) {
    mkdirSync(join(dir, ".devx-cache", "locks"), { recursive: true });
  }
  if (opts.lockBody !== undefined) {
    writeFileSync(lockPath, opts.lockBody);
  }

  return { dir, specPath, lockPath };
}

/** Canonical lock body — the exact shape claimSpec writes (claim.ts step 1). */
function lockBodyFor(sid: string): string {
  return `${sid}\npid=12345\nclaimed_at=2026-07-05T09:53:48-06:00\n`;
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

async function run(
  fx: Fixture,
  args: string[],
): Promise<{ code: number; io: CapturedIO }> {
  const cap = capture();
  const code = await runVerifyClaim(args, {
    out: cap.out,
    err: cap.err,
    repoRoot: fx.dir,
  });
  return { code, io: cap.io };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("normalizeSessionToken", () => {
  it("passes a raw sessionId through (trimmed)", () => {
    expect(normalizeSessionToken(`  ${OWNER_SID} `)).toBe(OWNER_SID);
  });

  it("strips a single leading /devx- prefix", () => {
    expect(normalizeSessionToken(`/devx-${OWNER_SID}`)).toBe(OWNER_SID);
  });

  it("strips only ONE prefix (a sid that itself starts with /devx- keeps the inner)", () => {
    expect(normalizeSessionToken("/devx-/devx-abc")).toBe("/devx-abc");
  });

  it("does not strip a mid-string /devx-", () => {
    expect(normalizeSessionToken("x/devx-abc")).toBe("x/devx-abc");
  });
});

describe("parseLockOwner", () => {
  it("returns the first line of the canonical claimSpec lock body", () => {
    expect(parseLockOwner(lockBodyFor(OWNER_SID))).toBe(OWNER_SID);
  });

  it("skips leading blank lines", () => {
    expect(parseLockOwner(`\n  \n${OWNER_SID}\n`)).toBe(OWNER_SID);
  });

  it("returns null on empty / whitespace-only content", () => {
    expect(parseLockOwner("")).toBeNull();
    expect(parseLockOwner("  \n \n")).toBeNull();
  });
});

describe("parseSpecClaimFields", () => {
  it("extracts owner + status from frontmatter", () => {
    const content = [
      "---",
      "hash: roc101",
      "status: in-progress",
      `owner: /devx-${OWNER_SID}`,
      "---",
      "body",
    ].join("\n");
    expect(parseSpecClaimFields(content)).toEqual({
      owner: `/devx-${OWNER_SID}`,
      status: "in-progress",
    });
  });

  it("returns null owner when the field is absent", () => {
    const content = ["---", "hash: roc101", "status: ready", "---"].join("\n");
    expect(parseSpecClaimFields(content)).toEqual({
      owner: null,
      status: "ready",
    });
  });

  it("throws VerifyClaimError(spec-parse) when frontmatter is missing", () => {
    expect(() => parseSpecClaimFields("# no frontmatter here")).toThrowError(
      VerifyClaimError,
    );
    try {
      parseSpecClaimFields("# no frontmatter here");
    } catch (e) {
      expect((e as VerifyClaimError).stage).toBe("spec-parse");
    }
  });

  it("only reads the frontmatter block — a body 'status:' line is ignored", () => {
    const content = [
      "---",
      "status: in-progress",
      "---",
      "",
      "status: done",
      "owner: /devx-evil",
    ].join("\n");
    expect(parseSpecClaimFields(content)).toEqual({
      owner: null,
      status: "in-progress",
    });
  });
});

// ---------------------------------------------------------------------------
// Exit 0 — owned
// ---------------------------------------------------------------------------

describe("devx devx-helper verify-claim — exit 0 (owned)", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("lock exists + token matches + spec in-progress → exit 0, JSON {hash, owned, sessionToken}", async () => {
    fx = makeFixture({ lockBody: lockBodyFor(OWNER_SID) });
    const { code, io } = await run(fx, [
      HASH,
      "--session-token",
      OWNER_SID,
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(io.stdout)).toEqual({
      hash: HASH,
      owned: true,
      sessionToken: OWNER_SID,
    });
    expect(io.stderr).toBe("");
  });

  it("accepts the /devx-<sid> owner-shaped token (normalization)", async () => {
    fx = makeFixture({ lockBody: lockBodyFor(OWNER_SID) });
    const { code, io } = await run(fx, [
      HASH,
      "--session-token",
      `/devx-${OWNER_SID}`,
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(io.stdout).sessionToken).toBe(OWNER_SID);
  });

  it("matches when the LOCK records the prefixed shape and the flag is raw", async () => {
    fx = makeFixture({ lockBody: lockBodyFor(`/devx-${OWNER_SID}`) });
    const { code } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(0);
  });

  it("lock exists + token matches + spec status NOT in-progress → still exit 0 (lock is authoritative) with a stderr status-drift WARN", async () => {
    fx = makeFixture({
      lockBody: lockBodyFor(OWNER_SID),
      specStatus: "ready",
    });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(0);
    expect(JSON.parse(io.stdout).owned).toBe(true);
    expect(io.stderr).toMatch(/WARN.*not 'in-progress'/);
  });

  it("lock matches but spec owner: disagrees → exit 0 with a stderr owner-drift WARN (lock wins)", async () => {
    fx = makeFixture({
      lockBody: lockBodyFor(OWNER_SID),
      specOwner: "/devx-someone-else",
    });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(0);
    expect(io.stderr).toMatch(/WARN.*disagrees with lock owner/);
  });

  it("spec owner: absent + lock matches → exit 0, no drift warning", async () => {
    fx = makeFixture({
      lockBody: lockBodyFor(OWNER_SID),
      specOwner: null,
    });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(0);
    expect(io.stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Exit 3 — owned-by-other-session
// ---------------------------------------------------------------------------

describe("devx devx-helper verify-claim — exit 3 (owned-by-other-session)", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("lock exists + token mismatch + spec in-progress → exit 3, JSON {error, hash, lockOwner, currentSession}", async () => {
    fx = makeFixture({ lockBody: lockBodyFor(OWNER_SID) });
    const { code, io } = await run(fx, [
      HASH,
      "--session-token",
      "2026-07-05T1200-99999",
    ]);
    expect(code).toBe(3);
    expect(JSON.parse(io.stdout)).toEqual({
      error: "owned-by-other-session",
      hash: HASH,
      lockOwner: OWNER_SID,
      currentSession: "2026-07-05T1200-99999",
    });
    expect(io.stderr).toMatch(/held by another session/);
    expect(io.stderr).toMatch(/halt without touching the worktree/);
  });

  it("lock exists + token mismatch + spec status ready → still exit 3 (lock presence dominates)", async () => {
    fx = makeFixture({
      lockBody: lockBodyFor(OWNER_SID),
      specStatus: "ready",
    });
    const { code, io } = await run(fx, [HASH, "--session-token", "other-sid"]);
    expect(code).toBe(3);
    expect(JSON.parse(io.stdout).error).toBe("owned-by-other-session");
  });

  it("token comparison is case-sensitive after normalization", async () => {
    fx = makeFixture({ lockBody: lockBodyFor("AbC-123") });
    const { code } = await run(fx, [HASH, "--session-token", "abc-123"]);
    expect(code).toBe(3);
  });

  it("a token that is a strict prefix of the lock owner does NOT match", async () => {
    fx = makeFixture({ lockBody: lockBodyFor(OWNER_SID) });
    const { code } = await run(fx, [
      HASH,
      "--session-token",
      OWNER_SID.slice(0, -2),
    ]);
    expect(code).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Exit 4 — in-progress-without-lock
// ---------------------------------------------------------------------------

describe("devx devx-helper verify-claim — exit 4 (in-progress-without-lock)", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("no lock file + spec in-progress → exit 4, JSON {error, hash}", async () => {
    fx = makeFixture(); // no lockBody → no lock file, no locks dir
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(4);
    expect(JSON.parse(io.stdout)).toEqual({
      error: "in-progress-without-lock",
      hash: HASH,
    });
    expect(io.stderr).toMatch(/orphaned claim/);
    expect(io.stderr).toMatch(/INTERVIEW\.md/);
  });

  it("locks dir exists but lock FILE is missing → same exit 4 (dir-vs-file indistinguishable, both mean no lock)", async () => {
    fx = makeFixture({ mkLockDir: true });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(4);
    expect(JSON.parse(io.stdout).error).toBe("in-progress-without-lock");
  });

  it("exit 4 is token-independent — any session sees the same drift", async () => {
    fx = makeFixture({ specOwner: null });
    const { code } = await run(fx, [HASH, "--session-token", "whoever"]);
    expect(code).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Exit 2 — everything else
// ---------------------------------------------------------------------------

describe("devx devx-helper verify-claim — exit 2 (other errors)", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("no lock + spec status NOT in-progress → exit 2 {error: 'spec-not-in-progress', hash}", async () => {
    fx = makeFixture({ specStatus: "ready", specOwner: null });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(2);
    expect(JSON.parse(io.stdout)).toEqual({
      error: "spec-not-in-progress",
      hash: HASH,
    });
    expect(io.stderr).toMatch(/nothing to resume/);
  });

  it("no lock + spec status done → exit 2 (same branch, cartesian third status)", async () => {
    fx = makeFixture({ specStatus: "done" });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(2);
    expect(JSON.parse(io.stdout).error).toBe("spec-not-in-progress");
  });

  it("no spec file for the hash → exit 2 {error: 'resolve', hash}", async () => {
    fx = makeFixture({ noSpec: true, lockBody: lockBodyFor(OWNER_SID) });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(2);
    expect(JSON.parse(io.stdout)).toEqual({ error: "resolve", hash: HASH });
  });

  it("spec resolve failure wins over a present lock (garbage hash ≠ exit 0/3)", async () => {
    fx = makeFixture({ lockBody: lockBodyFor(OWNER_SID) });
    const { code, io } = await run(fx, ["zzz999", "--session-token", OWNER_SID]);
    expect(code).toBe(2);
    expect(JSON.parse(io.stdout)).toEqual({ error: "resolve", hash: "zzz999" });
  });

  it("spec without frontmatter → exit 2 {error: 'spec-parse', hash}", async () => {
    fx = makeFixture({
      rawSpec: "# not a spec\n",
      lockBody: lockBodyFor(OWNER_SID),
    });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(2);
    expect(JSON.parse(io.stdout)).toEqual({ error: "spec-parse", hash: HASH });
  });

  it("empty/whitespace-only lock file → exit 2 {error: 'lock-unparseable', hash}", async () => {
    fx = makeFixture({ lockBody: "  \n\n" });
    const { code, io } = await run(fx, [HASH, "--session-token", OWNER_SID]);
    expect(code).toBe(2);
    expect(JSON.parse(io.stdout)).toEqual({
      error: "lock-unparseable",
      hash: HASH,
    });
  });

  it("lock read failure (fs seam throws) → exit 2 {error: 'read-lock', hash}", async () => {
    fx = makeFixture({ lockBody: lockBodyFor(OWNER_SID) });
    const cap = capture();
    const code = await runVerifyClaim([HASH, "--session-token", OWNER_SID], {
      out: cap.out,
      err: cap.err,
      repoRoot: fx.dir,
      verifyOpts: {
        fs: {
          readFile: (p: string) => {
            if (p.endsWith(".lock")) {
              throw new Error("EACCES: permission denied");
            }
            // Delegate spec reads to the real file.
            return readFileSync(p, "utf8");
          },
        },
      },
    });
    expect(code).toBe(2);
    expect(JSON.parse(cap.io.stdout)).toEqual({
      error: "read-lock",
      hash: HASH,
    });
    expect(cap.io.stderr).toMatch(/EACCES/);
  });

  it("library-level: whitespace-only session token → VerifyClaimError(validate) → exit 2 at the lib boundary", () => {
    fx = makeFixture({ lockBody: lockBodyFor(OWNER_SID) });
    expect(() =>
      verifyClaim(HASH, { sessionToken: "   ", repoRoot: fx.dir }),
    ).toThrowError(VerifyClaimError);
    try {
      verifyClaim(HASH, { sessionToken: "/devx-", repoRoot: fx.dir });
    } catch (e) {
      // `/devx-` normalizes to empty — must be rejected, not silently
      // compared against the lock owner.
      expect((e as VerifyClaimError).stage).toBe("validate");
    }
  });
});

// ---------------------------------------------------------------------------
// Exit 64 — usage
// ---------------------------------------------------------------------------

describe("devx devx-helper verify-claim — exit 64 (usage)", () => {
  it("missing hash arg → 64 + usage on stderr", async () => {
    const cap = capture();
    const code = await runVerifyClaim([], { out: cap.out, err: cap.err });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/usage:/);
    expect(cap.io.stdout).toBe("");
  });

  it("invalid hash shape → 64", async () => {
    const cap = capture();
    const code = await runVerifyClaim(["../bad"], {
      out: cap.out,
      err: cap.err,
    });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/invalid hash/);
  });

  it("--session-token without a value → 64", async () => {
    const cap = capture();
    const code = await runVerifyClaim([HASH, "--session-token"], {
      out: cap.out,
      err: cap.err,
    });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/requires a value/);
  });

  it("empty --session-token value → 64", async () => {
    const cap = capture();
    const code = await runVerifyClaim([HASH, "--session-token", "  "], {
      out: cap.out,
      err: cap.err,
    });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/non-empty/);
  });

  it("unknown flag → 64", async () => {
    const cap = capture();
    const code = await runVerifyClaim([HASH, "--frobnicate"], {
      out: cap.out,
      err: cap.err,
    });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/unknown flag/);
  });

  it("two positional args → 64", async () => {
    const cap = capture();
    const code = await runVerifyClaim([HASH, "extra"], {
      out: cap.out,
      err: cap.err,
    });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/usage:/);
  });

  it("flag order is position-independent (--session-token before hash)", async () => {
    const fx = makeFixture({ lockBody: lockBodyFor(OWNER_SID) });
    try {
      const cap = capture();
      const code = await runVerifyClaim(
        ["--session-token", OWNER_SID, HASH],
        { out: cap.out, err: cap.err, repoRoot: fx.dir },
      );
      expect(code).toBe(0);
    } finally {
      destroy(fx);
    }
  });
});

// ---------------------------------------------------------------------------
// v2d101 — debug-type verify-claim (the debug resume path)
// ---------------------------------------------------------------------------

describe("verifyClaim — debug type (v2d101)", () => {
  function makeDebugFixture(lockBody?: string): Fixture {
    const dir = mkdtempSync(join(tmpdir(), "devx-verify-claim-debug-"));
    const specDir = join(dir, "debug");
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "debug-bug001-2026-07-05T12:00-fixture.md");
    writeFileSync(
      specPath,
      [
        "---",
        "hash: bug001",
        "type: debug",
        "title: Fixture bug",
        "status: in-progress",
        `owner: /devx-${OWNER_SID}`,
        "branch: feat/debug-bug001",
        "---",
        "",
        "## Status log",
        "",
        "- 2026-07-05T12:00 — filed.",
        "",
      ].join("\n"),
    );
    const lockPath = join(dir, ".devx-cache", "locks", "spec-bug001.lock");
    if (lockBody !== undefined) {
      mkdirSync(join(dir, ".devx-cache", "locks"), { recursive: true });
      writeFileSync(lockPath, lockBody);
    }
    return { dir, specPath, lockPath };
  }

  it("resolves the spec under debug/ with type: 'debug' → owned", () => {
    const fx = makeDebugFixture(lockBodyFor(OWNER_SID));
    try {
      const r = verifyClaim("bug001", {
        sessionToken: OWNER_SID,
        repoRoot: fx.dir,
        type: "debug",
      });
      expect(r.status).toBe("owned");
    } finally {
      destroy(fx);
    }
  });

  it("default type ('dev') does NOT resolve a debug spec (resolve error, exit-2 class)", () => {
    const fx = makeDebugFixture(lockBodyFor(OWNER_SID));
    try {
      expect(() =>
        verifyClaim("bug001", { sessionToken: OWNER_SID, repoRoot: fx.dir }),
      ).toThrow(/no spec file found at .*dev\/dev-bug001/);
    } finally {
      destroy(fx);
    }
  });

  it("CLI --type debug drives the same resolution (exit 0 owned)", async () => {
    const fx = makeDebugFixture(lockBodyFor(OWNER_SID));
    try {
      const { code, io } = await run(fx, [
        "bug001",
        "--session-token",
        OWNER_SID,
        "--type",
        "debug",
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(io.stdout)).toMatchObject({ hash: "bug001", owned: true });
    } finally {
      destroy(fx);
    }
  });

  it("CLI rejects invalid --type values and flag-shaped values with exit 64", async () => {
    const fx = makeDebugFixture(lockBodyFor(OWNER_SID));
    try {
      const bad = await run(fx, ["bug001", "--type", "plan"]);
      expect(bad.code).toBe(64);
      expect(bad.io.stderr).toContain("invalid --type");

      const swallowed = await run(fx, ["bug001", "--type", "--session-token"]);
      expect(swallowed.code).toBe(64);
      expect(swallowed.io.stderr).toContain("--type requires a value");
    } finally {
      destroy(fx);
    }
  });
});
