// Spec-lock lifecycle tests (mlc103) — JSON v1 body compose/parse, legacy
// body support, classification (dead / recycled / live / conservative-held
// kinds), acquire-time reap with the bounded retry, guarded release, and
// pick-time live-held masking. Companion to the E-3 eval
// (_devx/workstreams/multi-loop-concurrency/evals/E-3_spec-lock-lifecycle.ts):
// the eval proves the CLI end-to-end; this suite pins the module semantics —
// in particular the two postures the eval can't isolate:
//   - legacy live-PID bodies are NEVER reaped, even with an ancient
//     claimed_at (liveness-only classification — no recycling cross-check);
//   - JSON v1 recycling is detected via the RECORDED pid_started_at.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SPEC_LOCK_LIVE_WARN_MS,
  SpecLockHeldError,
  acquireSpecLock,
  classifySpecLock,
  composeSpecLockBody,
  isReapableSpecLock,
  parseSpecLockBody,
  releaseSpecLockGuarded,
  specLockOwnedBy,
  specLockOwner,
  specLockPath,
  type SpecLockAcquireFs,
} from "../src/lib/devx/spec-lock.js";
import { parseLockOwner } from "../src/lib/devx/verify-claim.js";
import { pickNextItem } from "../src/lib/loop/driver.js";
import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";

/** A PID that provably belonged to an already-exited process. */
function deadPid(): number {
  const child = spawnSync("true");
  return child.pid ?? 999_999;
}

function legacyBody(session: string, pid: number, claimedAt = "2026-07-28T08:00:00-06:00"): string {
  return `${session}\npid=${pid}\nclaimed_at=${claimedAt}\n`;
}

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function tmpLock(body: string | null): string {
  tmp = mkdtempSync(join(tmpdir(), "devx-spec-lock-"));
  const lockPath = join(tmp, "spec-abc123.lock");
  if (body !== null) writeFileSync(lockPath, body, "utf8");
  return lockPath;
}

// ---------------------------------------------------------------------------
// Body compose / parse
// ---------------------------------------------------------------------------

describe("composeSpecLockBody / parseSpecLockBody", () => {
  it("round-trips the JSON v1 body", () => {
    const raw = composeSpecLockBody({
      session: "sid-1",
      claimedAt: "2026-07-28T10:00:00-06:00",
      pid: 4242,
      pidStartedAt: "2026-07-28T09:59:58-06:00",
    });
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.schema).toBe(1);
    const body = parseSpecLockBody(raw);
    expect(body).toEqual({
      format: "json-v1",
      pid: 4242,
      pidStartedAt: "2026-07-28T09:59:58-06:00",
      session: "sid-1",
      claimedAt: "2026-07-28T10:00:00-06:00",
    });
  });

  it("defaults pid to process.pid and records a probe-or-null start time", () => {
    const body = parseSpecLockBody(
      composeSpecLockBody({ session: "s", claimedAt: "2026-07-28T10:00" }),
    );
    expect(body?.pid).toBe(process.pid);
    // Probe result is platform-dependent; the contract is string-or-null,
    // never undefined.
    expect(body?.pidStartedAt === null || typeof body?.pidStartedAt === "string").toBe(true);
  });

  it("parses legacy 3-line bodies via their pid= line", () => {
    const body = parseSpecLockBody(legacyBody("/devx-sid-9", 777));
    expect(body).toEqual({
      format: "legacy",
      pid: 777,
      pidStartedAt: null,
      session: "/devx-sid-9",
      claimedAt: "2026-07-28T08:00:00-06:00",
    });
  });

  it("legacy body without a pid= line parses with pid null", () => {
    const body = parseSpecLockBody("some-token\nclaimed_at=2026-07-28T08:00\n");
    expect(body?.format).toBe("legacy");
    expect(body?.pid).toBeNull();
    expect(body?.session).toBe("some-token");
  });

  it("legacy body whose FIRST line is pid= still yields a classifiable pid (EC-5)", () => {
    const body = parseSpecLockBody("pid=777\nclaimed_at=2026-07-28T08:00\n");
    expect(body?.session).toBe("pid=777"); // historic first-line contract
    expect(body?.pid).toBe(777); // …but the pid is not lost
  });

  it("JSON v1 with a PRESENT-but-invalid pid is unparseable (reapable), absent pid is unknown (EC-3)", () => {
    for (const bad of [0, -5, 3.5, "123"]) {
      expect(parseSpecLockBody(JSON.stringify({ schema: 1, pid: bad, session: "s" }))).toBeNull();
    }
    const absent = parseSpecLockBody(JSON.stringify({ schema: 1, session: "s" }));
    expect(absent?.pid).toBeNull();
    expect(absent?.session).toBe("s");
  });

  it("unknown future schema drops the pid → conservative held, session still attributable (EC-6)", () => {
    const body = parseSpecLockBody(
      JSON.stringify({ schema: 2, pid: process.pid, session: "future-sid" }),
    );
    expect(body?.pid).toBeNull();
    expect(body?.session).toBe("future-sid");
    // Unknown schema beats the invalid-pid corruption rule: a v2 body
    // whose pid field is legally shaped differently must classify held
    // (unknown-pid), never reapable-unparseable.
    const v2WeirdPid = parseSpecLockBody(
      JSON.stringify({ schema: 2, pid: "v2-shape", session: "future-sid" }),
    );
    expect(v2WeirdPid?.pid).toBeNull();
    expect(v2WeirdPid?.session).toBe("future-sid");
  });

  it("returns null for empty and for JSON-object-looking-but-broken content", () => {
    expect(parseSpecLockBody("")).toBeNull();
    expect(parseSpecLockBody("   \n  ")).toBeNull();
    expect(parseSpecLockBody("{not json")).toBeNull();
    // Non-`{` content takes the legacy path: first line becomes the owner
    // token (historic parseLockOwner contract), pid stays null → the
    // classifier's conservative unknown-pid/held, never a reap.
    expect(parseSpecLockBody("[1,2]")?.format).toBe("legacy");
    expect(parseSpecLockBody("[1,2]")?.pid).toBeNull();
  });
});

describe("specLockOwner ↔ parseLockOwner", () => {
  it("extracts the session from JSON v1 bodies", () => {
    const raw = composeSpecLockBody({ session: "sid-x", claimedAt: "2026-07-28T10:00" });
    expect(specLockOwner(raw)).toBe("sid-x");
    expect(parseLockOwner(raw)).toBe("sid-x");
  });
  it("extracts the first non-empty line from legacy bodies (historic contract)", () => {
    const raw = legacyBody("/devx-2026-07-05T0953-22822", 22822);
    expect(specLockOwner(raw)).toBe("/devx-2026-07-05T0953-22822");
    expect(parseLockOwner(raw)).toBe("/devx-2026-07-05T0953-22822");
  });
  it("returns null for empty bodies; degenerate `{`-bodies keep the historic first-line contract", () => {
    expect(specLockOwner("")).toBeNull();
    expect(parseLockOwner("  \n ")).toBeNull();
    // Corrupt-JSON and sessionless-JSON bodies fall back to the first
    // non-empty line (review BH-F4) so verify-claim/gather keep returning
    // an ownership verdict instead of degrading to unverifiable.
    expect(specLockOwner("{garbage")).toBe("{garbage");
    expect(specLockOwner('{"schema":1,"pid":1}')).toBe('{"schema":1,"pid":1}');
  });
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("classifySpecLock", () => {
  it("missing / empty / unparseable kinds", () => {
    expect(classifySpecLock(tmpLock(null) + ".nope").kind).toBe("missing");
    expect(classifySpecLock(tmpLock("")).kind).toBe("empty");
    rmSync(tmp!, { recursive: true, force: true });
    tmp = null;
    expect(classifySpecLock(tmpLock("{broken")).kind).toBe("unparseable");
  });

  it("dead-PID locks classify dead (reapable) for both formats", () => {
    const pid = deadPid();
    const legacy = classifySpecLock(tmpLock(legacyBody("s", pid)));
    expect(legacy.kind).toBe("dead");
    expect(isReapableSpecLock(legacy)).toBe(true);
    rmSync(tmp!, { recursive: true, force: true });
    tmp = null;
    const v1 = classifySpecLock(
      tmpLock(composeSpecLockBody({ session: "s", claimedAt: "2026-07-28T08:00", pid })),
    );
    expect(v1.kind).toBe("dead");
  });

  it("legacy live-PID lock is LIVE even with an ancient claimed_at (E-3(b) posture — no recycling cross-check)", () => {
    // process.pid started long after 2020-01-01; the mgr106 start-time-vs-
    // acquired_at heuristic would call this recycled. Legacy bodies must
    // classify on liveness alone.
    const cls = classifySpecLock(tmpLock(legacyBody("s", process.pid, "2020-01-01T00:00:00Z")));
    expect(cls.kind).toBe("live");
    expect(isReapableSpecLock(cls)).toBe(false);
  });

  it("JSON v1 recycling: probed start far after the RECORDED start ⇒ recycled", () => {
    const body = composeSpecLockBody({
      session: "s",
      claimedAt: "2026-07-28T08:00:00Z",
      pid: process.pid,
      pidStartedAt: "2026-07-28T08:00:00Z",
    });
    const cls = classifySpecLock(tmpLock(body), {
      pidStartedAt: () => new Date("2026-07-28T09:00:00Z"),
    });
    expect(cls.kind).toBe("recycled");
    expect(isReapableSpecLock(cls)).toBe(true);
  });

  it("JSON v1 with matching recorded start stays live and reports ageMs", () => {
    const body = composeSpecLockBody({
      session: "s",
      claimedAt: "2026-07-28T08:00:00Z",
      pid: process.pid,
      pidStartedAt: "2026-07-28T07:59:00Z",
    });
    const cls = classifySpecLock(tmpLock(body), {
      pidStartedAt: () => new Date("2026-07-28T07:59:00.500Z"),
      now: () => new Date("2026-07-28T11:00:00Z"),
    });
    expect(cls.kind).toBe("live");
    if (cls.kind === "live") expect(cls.ageMs).toBe(3 * 3_600_000);
  });

  it("JSON v1 without a recorded start falls back to claimed_at for recycling", () => {
    const body = composeSpecLockBody({
      session: "s",
      claimedAt: "2026-07-28T08:00:00Z",
      pid: process.pid,
      pidStartedAt: null,
    });
    const cls = classifySpecLock(tmpLock(body), {
      pidStartedAt: () => new Date("2026-07-28T09:00:00Z"),
    });
    expect(cls.kind).toBe("recycled");
  });

  it("parseable body without a pid classifies unknown-pid (held, not reapable)", () => {
    const cls = classifySpecLock(tmpLock("token-only\nclaimed_at=2026-07-28T08:00\n"));
    expect(cls.kind).toBe("unknown-pid");
    expect(isReapableSpecLock(cls)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Acquire (reap + retry once)
// ---------------------------------------------------------------------------

function realAcquireFs(): SpecLockAcquireFs {
  const fs = require("node:fs") as typeof import("node:fs");
  return {
    openExclusive: (p, contents) => {
      const fd = fs.openSync(p, "wx");
      try {
        fs.writeFileSync(fd, contents, "utf8");
      } finally {
        fs.closeSync(fd);
      }
    },
    readFile: (p) => fs.readFileSync(p, "utf8"),
    unlink: (p) => fs.unlinkSync(p),
  };
}

describe("acquireSpecLock", () => {
  it("reaps a dead-owner lock and acquires in the same call (≤1 retry)", () => {
    const lockPath = tmpLock(legacyBody("stale-owner", deadPid()));
    const warns: string[] = [];
    const body = composeSpecLockBody({ session: "new-owner", claimedAt: "2026-07-28T10:00" });
    acquireSpecLock(lockPath, body, { fs: realAcquireFs(), warn: (m) => warns.push(m) });
    expect(specLockOwner(realAcquireFs().readFile(lockPath))).toBe("new-owner");
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("not running");
  });

  it("throws SpecLockHeldError for a live legacy holder", () => {
    const lockPath = tmpLock(legacyBody("live-owner", process.pid));
    expect(() =>
      acquireSpecLock(lockPath, composeSpecLockBody({ session: "me", claimedAt: "t" }), {
        fs: realAcquireFs(),
      }),
    ).toThrow(SpecLockHeldError);
    // Holder's lock untouched.
    expect(specLockOwner(realAcquireFs().readFile(lockPath))).toBe("live-owner");
  });

  it("reaps an unparseable lock body", () => {
    const lockPath = tmpLock("{corrupt");
    acquireSpecLock(lockPath, composeSpecLockBody({ session: "me", claimedAt: "t" }), {
      fs: realAcquireFs(),
    });
    expect(specLockOwner(realAcquireFs().readFile(lockPath))).toBe("me");
  });

  it("refuses to reap a dead-pid lock when allowReap says the row is not claimable (BH-F1)", () => {
    // The interactive-claim shape: `devx devx-helper claim` exits seconds
    // after claiming, so a HEALTHY claim's lock records a dead pid. With
    // the row in-progress, the reap must not fire — pre-mlc103 refusal.
    const lockPath = tmpLock(legacyBody("live-session-dead-pid", deadPid()));
    expect(() =>
      acquireSpecLock(lockPath, composeSpecLockBody({ session: "me", claimedAt: "t" }), {
        fs: realAcquireFs(),
        allowReap: () => false,
      }),
    ).toThrow(SpecLockHeldError);
    expect(specLockOwner(realAcquireFs().readFile(lockPath))).toBe("live-session-dead-pid");
  });

  it("is bounded: a lock re-created between unlink and reopen surfaces as held", () => {
    const lockPath = tmpLock(legacyBody("stale", deadPid()));
    const real = realAcquireFs();
    const fs: SpecLockAcquireFs = {
      ...real,
      unlink: (p) => {
        // Simulate a peer winning the re-create race: reap happens, but the
        // path is immediately occupied again by a live holder.
        real.unlink(p);
        real.openExclusive(p, legacyBody("peer", process.pid));
      },
    };
    expect(() =>
      acquireSpecLock(lockPath, composeSpecLockBody({ session: "me", claimedAt: "t" }), { fs }),
    ).toThrow(SpecLockHeldError);
    expect(specLockOwner(real.readFile(lockPath))).toBe("peer");
  });
});

// ---------------------------------------------------------------------------
// Guarded release + ownership probe
// ---------------------------------------------------------------------------

describe("releaseSpecLockGuarded / specLockOwnedBy", () => {
  it("unlinks on session match (JSON v1)", () => {
    const lockPath = tmpLock(composeSpecLockBody({ session: "sid-1", claimedAt: "t" }));
    expect(specLockOwnedBy(lockPath, "sid-1")).toBe(true);
    expect(releaseSpecLockGuarded(lockPath, "sid-1")).toEqual({ released: true });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("normalizes the /devx- prefix on either side (verify-claim parity)", () => {
    const lockPath = tmpLock(composeSpecLockBody({ session: "/devx-sid-2", claimedAt: "t" }));
    expect(specLockOwnedBy(lockPath, "sid-2")).toBe(true);
    expect(releaseSpecLockGuarded(lockPath, "sid-2")).toEqual({ released: true });
  });

  it("refuses to unlink a peer's re-claim (R7)", () => {
    const lockPath = tmpLock(composeSpecLockBody({ session: "peer-sid", claimedAt: "t" }));
    expect(specLockOwnedBy(lockPath, "my-sid")).toBe(false);
    const res = releaseSpecLockGuarded(lockPath, "my-sid");
    expect(res).toEqual({ released: false, reason: "not-owner", owner: "peer-sid" });
    expect(existsSync(lockPath)).toBe(true);
  });

  it("releases legacy-format locks owned by the same session", () => {
    const lockPath = tmpLock(legacyBody("/devx-legacy-sid", process.pid));
    expect(releaseSpecLockGuarded(lockPath, "legacy-sid")).toEqual({ released: true });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("missing lock is a benign no-op; an EMPTY body is our own lost write and unlinks (EC-1)", () => {
    const lockPath = tmpLock(null);
    expect(releaseSpecLockGuarded(lockPath, "sid")).toEqual({
      released: false,
      reason: "missing",
    });
    // Empty body at RELEASE time cannot be a peer's mid-write (release
    // runs under the backlog lock, and so does every acquire) — leaving
    // it would wedge the hash behind the conservative empty→held classify.
    writeFileSync(lockPath, "", "utf8");
    expect(releaseSpecLockGuarded(lockPath, "sid")).toEqual({ released: true });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("unparseable body reads as a junk owner → not-owner, left for the claim-time reap", () => {
    const lockPath = tmpLock("{garbage");
    const res = releaseSpecLockGuarded(lockPath, "sid");
    expect(res).toEqual({ released: false, reason: "not-owner", owner: "{garbage" });
    expect(existsSync(lockPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pick-time masking (driver integration)
// ---------------------------------------------------------------------------

function pickFixture(rows: Array<{ hash: string }>): string {
  tmp = mkdtempSync(join(tmpdir(), "devx-spec-lock-pick-"));
  const lines = ["# DEV — backlog", ""];
  for (const r of rows) {
    lines.push(
      `- [ ] \`dev/dev-${r.hash}-2026-07-28T09:00-item-${r.hash}.md\` — Item ${r.hash}. Status: ready.`,
    );
  }
  writeFileSync(join(tmp, "DEV.md"), lines.join("\n") + "\n", "utf8");
  mkdirSync(join(tmp, ".devx-cache", "locks"), { recursive: true });
  return tmp;
}

describe("pickNextItem spec-lock masking", () => {
  const opts = { excluded: new Set<string>(), model: "m", now: () => new Date() };

  it("masks a ready row whose spec lock is live-held; dead locks stay pickable", () => {
    const repoRoot = pickFixture([{ hash: "aaa111" }, { hash: "bbb222" }]);
    writeFileSync(specLockPath(repoRoot, "aaa111"), legacyBody("peer", process.pid), "utf8");
    expect(pickNextItem(repoRoot, opts)?.hash).toBe("bbb222");
    // Swap to a dead owner — the row becomes pickable again (claim-time
    // reap will clear the lock).
    writeFileSync(specLockPath(repoRoot, "aaa111"), legacyBody("peer", deadPid()), "utf8");
    expect(pickNextItem(repoRoot, opts)?.hash).toBe("aaa111");
  });

  it("WARNs (never reaps) on a live lock older than 2h", () => {
    const repoRoot = pickFixture([{ hash: "ccc333" }]);
    const oldClaim = new Date(Date.now() - SPEC_LOCK_LIVE_WARN_MS - 60_000).toISOString();
    const lockPath = specLockPath(repoRoot, "ccc333");
    writeFileSync(
      lockPath,
      composeSpecLockBody({ session: "peer", claimedAt: oldClaim, pid: process.pid }),
      "utf8",
    );
    const warns: string[] = [];
    expect(pickNextItem(repoRoot, { ...opts, warn: (m) => warns.push(m) })).toBeNull();
    expect(warns.some((w) => w.includes("ccc333") && w.includes("never auto-reaped"))).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
  });

  it("WARNs when masking the non-live conservative-held kinds (BH-F3)", () => {
    const repoRoot = pickFixture([{ hash: "ddd444" }]);
    // 0-byte lock — the SIGKILL-between-open-and-write shape.
    writeFileSync(specLockPath(repoRoot, "ddd444"), "", "utf8");
    const warns: string[] = [];
    expect(pickNextItem(repoRoot, { ...opts, warn: (m) => warns.push(m) })).toBeNull();
    expect(
      warns.some((w) => w.includes("ddd444") && w.includes("'empty'") && w.includes("never be picked")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// devx next drift + warning surfaces (gather integration)
// ---------------------------------------------------------------------------

describe("gather spec-lock surfaces", () => {
  const ENGINE = { ...ENGINE_DEFAULTS };

  function gatherFixture(status: "in-progress" | "ready", lockBody: string | null): string {
    tmp = mkdtempSync(join(tmpdir(), "devx-spec-lock-gather-"));
    const rel = `dev/dev-eee555-2026-07-28T09:00-item-eee555.md`;
    const marker = status === "in-progress" ? "[/]" : "[ ]";
    writeFileSync(
      join(tmp, "DEV.md"),
      `# DEV\n\n- ${marker} \`${rel}\` — Item eee555. Status: ${status}.\n`,
      "utf8",
    );
    mkdirSync(join(tmp, "dev"), { recursive: true });
    writeFileSync(
      join(tmp, rel),
      `---\nhash: eee555\ntype: dev\nstatus: ${status}\nowner: ${status === "in-progress" ? "peer-sid" : "null"}\n---\n\n## Goal\n\nx\n`,
      "utf8",
    );
    mkdirSync(join(tmp, ".devx-cache", "locks"), { recursive: true });
    if (lockBody !== null) {
      writeFileSync(join(tmp, ".devx-cache", "locks", "spec-eee555.lock"), lockBody, "utf8");
    }
    return tmp;
  }

  it("emits the stale-live-lock drift row for a PEER's >2h live lock, not for our own", async () => {
    const { gatherRepoSnapshot } = await import("../src/lib/next/gather.js");
    const oldClaim = "2026-07-28T06:00:00Z";
    const repoRoot = gatherFixture(
      "in-progress",
      composeSpecLockBody({
        session: "peer-sid",
        claimedAt: oldClaim,
        pid: 4242,
        pidStartedAt: "2026-07-28T05:59:00Z",
      }),
    );
    const base = {
      repoRoot,
      merged: {},
      engine: ENGINE,
      skipGh: true,
      now: () => new Date("2026-07-28T12:00:00Z"),
      lockProbes: {
        pidAlive: () => true,
        pidStartedAt: () => new Date("2026-07-28T05:59:00Z"),
      },
    };
    const asPeer = gatherRepoSnapshot({ ...base, sessionToken: "someone-else" });
    expect(
      asPeer.drift.some((d) => d.kind === "stale-live-lock" && d.hash === "eee555"),
    ).toBe(true);
    // Same repo, but the lock is OURS → exempt (EC-4a).
    const asOwner = gatherRepoSnapshot({ ...base, sessionToken: "peer-sid" });
    expect(asOwner.drift.some((d) => d.kind === "stale-live-lock")).toBe(false);
  });

  it("warns about a READY row masked by a corrupt (empty) lock (BH-F3)", async () => {
    const { gatherRepoSnapshot } = await import("../src/lib/next/gather.js");
    const repoRoot = gatherFixture("ready", "");
    const snap = gatherRepoSnapshot({
      repoRoot,
      merged: {},
      engine: ENGINE,
      skipGh: true,
      now: () => new Date("2026-07-28T12:00:00Z"),
    });
    expect(
      snap.warnings.some((w) => w.includes("eee555") && w.includes("'empty'")),
    ).toBe(true);
  });
});
