// Loop driver unit tests for src/lib/manage/loop.ts (mgr101).
//
// Covers:
//   - runManagerOnce(): writes manager.json + heartbeat.json, emits the
//     locked summary-line format, increments generation across ticks.
//   - runManagerLoop(): drains current tick + exits cleanly on AbortSignal,
//     respects tickIntervalS, doesn't fire post-abort.
//   - End-to-end smoke: spawning `node dist/cli.js manage --once` against
//     an empty cacheDir produces the two state files + exits 0 (mgr101 AC #6).

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  TICK_SUMMARY_RE,
  type TickResult,
  runManagerLoop,
  runManagerOnce,
} from "../src/lib/manage/loop.js";
import {
  heartbeatPath,
  managerStatePath,
  readManagerState,
} from "../src/lib/manage/state.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLI_DIST = join(REPO_ROOT, "dist", "cli.js");

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "devx-mgr-loop-"));
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

function captureOut(): { lines: string[]; out: (line: string) => void } {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
}

describe("runManagerOnce", () => {
  it("writes manager.json + heartbeat.json + emits summary line on first tick", async () => {
    const { lines, out } = captureOut();
    const result: TickResult = await runManagerOnce({
      cacheDir,
      cwd: cacheDir,
      now: () => new Date("2026-05-07T10:00:00.000Z"),
      out,
    });

    expect(result).toEqual({
      generation: 1,
      outcome: "no-work",
      summary: "tick 1: no work",
    });
    expect(lines).toEqual(["tick 1: no work"]);

    expect(existsSync(managerStatePath(cacheDir))).toBe(true);
    expect(existsSync(heartbeatPath(cacheDir))).toBe(true);

    const state = readManagerState(cacheDir);
    expect(state.generation).toBe(1);
    expect(state.started_at).toBe("2026-05-07T10:00:00.000Z");
    expect(state.last_tick_at).toBe("2026-05-07T10:00:00.000Z");
    expect(state.ticks).toEqual([
      { generation: 1, ts: "2026-05-07T10:00:00.000Z", outcome: "no-work" },
    ]);
    expect(state.roster).toEqual([]);

    const heartbeat = JSON.parse(readFileSync(heartbeatPath(cacheDir), "utf8"));
    expect(heartbeat).toEqual({
      ts: "2026-05-07T10:00:00.000Z",
      pid: process.pid,
      generation: 1,
    });
  });

  it("preserves started_at and increments generation across ticks", async () => {
    let n = 0;
    const dates = ["2026-05-07T10:00:00.000Z", "2026-05-07T10:01:00.000Z"];
    const { lines, out } = captureOut();

    await runManagerOnce({
      cacheDir,
      cwd: cacheDir,
      now: () => new Date(dates[n++]!),
      out,
    });
    const second = await runManagerOnce({
      cacheDir,
      cwd: cacheDir,
      now: () => new Date(dates[n++]!),
      out,
    });

    expect(second.generation).toBe(2);
    expect(second.summary).toBe("tick 2: no work");
    expect(lines).toEqual(["tick 1: no work", "tick 2: no work"]);

    const state = readManagerState(cacheDir);
    expect(state.generation).toBe(2);
    expect(state.started_at).toBe(dates[0]); // pinned from first tick
    expect(state.last_tick_at).toBe(dates[1]); // updated on second tick
    expect(state.ticks?.length).toBe(2);
  });

  it("bounds the ticks log to 100 entries", async () => {
    // Pre-seed a state with 100 ticks already in the log; one more should
    // displace the oldest, not unbounded-grow.
    const ticks = Array.from({ length: 100 }, (_, i) => ({
      generation: i + 1,
      ts: `2026-05-07T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
      outcome: "no-work" as const,
    }));
    const { writeManagerState } = await import("../src/lib/manage/state.js");
    writeManagerState(cacheDir, { generation: 100, roster: [], ticks });

    const { out } = captureOut();
    await runManagerOnce({
      cacheDir,
      cwd: cacheDir,
      now: () => new Date("2026-05-07T11:00:00.000Z"),
      out,
    });

    const state = readManagerState(cacheDir);
    expect(state.ticks?.length).toBe(100);
    expect(state.ticks?.[0]?.generation).toBe(2); // oldest displaced
    expect(state.ticks?.[99]?.generation).toBe(101);
  });
});

describe("TICK_SUMMARY_RE (mgr101 AC #7 — pinned format for all 3 branches)", () => {
  // Mgr101 ships only the "no work" branch; mgr103/104 fill in the others.
  // The regex is exported now so future stories must update one centralized
  // pattern, not drift the format silently.
  it.each([
    "tick 1: no work",
    "tick 99: no work",
    "tick 12: spawned a1b2c3",
    "tick 5: spawned ffffff",
    "tick 99: maintained a1b2c3 (pid 12345)",
    "tick 100000: maintained 0a1b2c (pid 1)",
  ])("matches %s", (line) => {
    expect(TICK_SUMMARY_RE.test(line)).toBe(true);
  });

  it.each([
    "Tick 1: no work", // capitalization
    "tick 1: NO WORK",
    "tick 1:  no work", // double space
    "tick 1 : no work", // space before colon
    "tick a: no work", // non-numeric gen
    "tick 1: spawned XYZ", // non-hex hash
    "tick 1: maintained abc (pid x)", // non-numeric pid
    "tick 1: spawned a1b2c3 ", // trailing space
    "tick -1: no work", // negative gen
    "tick 1: no work\n", // trailing newline (callers should trim)
  ])("rejects %s", (line) => {
    expect(TICK_SUMMARY_RE.test(line)).toBe(false);
  });
});

describe("runManagerLoop", () => {
  it("throws when tickIntervalS is not a positive finite number", async () => {
    const ac = new AbortController();
    const baseOpts = { signal: ac.signal, cacheDir, cwd: cacheDir };
    await expect(runManagerLoop({ ...baseOpts, tickIntervalS: 0 })).rejects.toThrow(
      /positive finite number/,
    );
    await expect(runManagerLoop({ ...baseOpts, tickIntervalS: -1 })).rejects.toThrow(
      /positive finite number/,
    );
    await expect(runManagerLoop({ ...baseOpts, tickIntervalS: NaN })).rejects.toThrow(
      /positive finite number/,
    );
    await expect(runManagerLoop({ ...baseOpts, tickIntervalS: Infinity })).rejects.toThrow(
      /positive finite number/,
    );
  });

  it("throws when tickIntervalS exceeds the 24h ceiling (likely a ms-vs-s mistake)", async () => {
    const ac = new AbortController();
    await expect(
      runManagerLoop({ tickIntervalS: 90000, signal: ac.signal, cacheDir, cwd: cacheDir }),
    ).rejects.toThrow(/24h ceiling/);
  });


  it("drains current tick + returns cleanly on AbortSignal", async () => {
    const { lines, out } = captureOut();
    const ac = new AbortController();
    let tickCount = 0;
    const now = () => {
      // Abort after the first tick fires.
      if (tickCount === 1) ac.abort();
      tickCount += 1;
      return new Date("2026-05-07T10:00:00.000Z");
    };

    await runManagerLoop({
      tickIntervalS: 0.01, // 10ms — tight for tests
      signal: ac.signal,
      cacheDir,
      cwd: cacheDir,
      now,
      out,
    });

    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toBe("tick 1: no work");
    expect(readManagerState(cacheDir).generation).toBeGreaterThanOrEqual(1);
  });

  it("returns immediately if signal is already aborted", async () => {
    const { lines, out } = captureOut();
    const ac = new AbortController();
    ac.abort();

    await runManagerLoop({
      tickIntervalS: 60,
      signal: ac.signal,
      cacheDir,
      cwd: cacheDir,
      out,
    });

    expect(lines).toEqual([]);
    // No tick fired → no manager.json written.
    expect(existsSync(managerStatePath(cacheDir))).toBe(false);
  });

  it("runs multiple ticks at tickIntervalS cadence before abort", async () => {
    const { lines, out } = captureOut();
    const ac = new AbortController();

    // Abort after ~30ms — at 10ms cadence we expect ≥2 ticks.
    setTimeout(() => ac.abort(), 35);

    await runManagerLoop({
      tickIntervalS: 0.01,
      signal: ac.signal,
      cacheDir,
      cwd: cacheDir,
      out,
    });

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toBe("tick 1: no work");
  });
});

// End-to-end smoke against the built CLI. Skipped if dist/cli.js doesn't
// exist (e.g., running vitest before `npm run build`); local CI always
// builds first per package.json `test` script.
const cliExists = existsSync(CLI_DIST);
const cliDescribe = cliExists ? describe : describe.skip;

cliDescribe("`devx manage --once` smoke (mgr101 AC #6)", () => {
  // TODO(mgr103): once reconcile() lands and DEV.md is actually parsed, this
  // smoke must drive a fixture DEV.md to assert the "no spawn" guarantee
  // structurally instead of by absence-of-DEV.md coincidence. mgr101 ships
  // only the hardcoded "no-work" branch (loop.ts:62), so the current test
  // can't tell the difference between "DEV.md had no ready specs" and
  // "loop.ts ignores DEV.md entirely."
  it("writes manager.json + heartbeat.json against an empty cache, exits 0", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devx-mgr-cli-"));
    try {
      const r = spawnSync("node", [CLI_DIST, "manage", "--once"], {
        cwd,
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^tick 1: no work\n?$/);
      expect(existsSync(join(cwd, ".devx-cache", "state", "manager.json"))).toBe(true);
      expect(existsSync(join(cwd, ".devx-cache", "state", "heartbeat.json"))).toBe(true);
      expect(existsSync(join(cwd, ".devx-cache", "locks", "manager.lock"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("exits 1 with stderr message when the manager lock is already held", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devx-mgr-cli-held-"));
    try {
      // Simulate a held lock by pre-creating the file.
      mkdirSync(join(cwd, ".devx-cache", "locks"), { recursive: true });
      writeFileSync(
        join(cwd, ".devx-cache", "locks", "manager.lock"),
        JSON.stringify({ pid: 99999, acquired_at: new Date().toISOString() }),
        "utf8",
      );
      const r = spawnSync("node", [CLI_DIST, "manage", "--once"], {
        cwd,
        encoding: "utf8",
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("manager lock already held");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// AC #3 throw-path: when runManagerOnce throws, the lock must still release.
cliDescribe("`devx manage --once` lock release on tick-throw (mgr101 AC #3)", () => {
  it("releases the lock when state-IO fails mid-tick", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devx-mgr-cli-throw-"));
    try {
      // Plant a regular file at `.devx-cache/state` so writeAtomic's mkdirSync
      // fails with ENOTDIR — runManagerOnce will throw partway through, but
      // the CLI's try/finally must still release the lock.
      mkdirSync(join(cwd, ".devx-cache"), { recursive: true });
      writeFileSync(join(cwd, ".devx-cache", "state"), "not-a-dir", "utf8");
      const r = spawnSync("node", [CLI_DIST, "manage", "--once"], {
        cwd,
        encoding: "utf8",
      });
      expect(r.status).not.toBe(0); // throw propagates → non-zero exit
      // Critical contract: the lock must be released on throw.
      expect(existsSync(join(cwd, ".devx-cache", "locks", "manager.lock"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// AC #4 end-to-end: spawn `devx manage` (default loop), let it tick a few
// times, send SIGTERM, verify the process exits 0 with the lock released.
cliDescribe("`devx manage` SIGTERM-clean exit (mgr101 AC #4)", () => {
  it("exits 0 with the lock released after SIGTERM", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "devx-mgr-cli-sigterm-"));
    try {
      // Seed a project config that sets a tight tick interval so the loop
      // ticks at least once before SIGTERM. loadMerged() reads from cwd's
      // devx.config.yaml; without it, readTickIntervalS falls back to 60s
      // which would make this test slow.
      writeFileSync(
        join(cwd, "devx.config.yaml"),
        "manager:\n  heartbeat_interval_s: 0.05\n",
        "utf8",
      );
      const { spawn } = await import("node:child_process");
      const child = spawn("node", [CLI_DIST, "manage"], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutChunks: string[] = [];
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c: string) => stdoutChunks.push(c));
      // Wait for the first tick to arrive — confirms the loop is running.
      await new Promise<void>((resolve) => {
        const onData = (chunk: string) => {
          if (chunk.includes("tick")) {
            child.stdout.off("data", onData);
            resolve();
          }
        };
        child.stdout.on("data", onData);
      });
      child.kill("SIGTERM");
      const exitCode = await new Promise<number>((resolve) => {
        child.on("exit", (code) => resolve(code ?? -1));
      });
      expect(exitCode).toBe(0);
      const stdoutLines = stdoutChunks.join("").split("\n").filter((l) => l.length > 0);
      expect(stdoutLines.length).toBeGreaterThanOrEqual(1);
      // Every emitted line must match the locked summary regex.
      for (const line of stdoutLines) {
        expect(line).toMatch(TICK_SUMMARY_RE);
      }
      expect(existsSync(join(cwd, ".devx-cache", "locks", "manager.lock"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 10000);
});
