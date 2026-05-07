// mgr105 integration tests:
//   - Stub `claude` binary that always exits 42; runManagerOnce drives the
//     full cycle (5 ticks) advancing the injected clock past each backoff
//     window. After tick 5, DEV.md is flipped [/]→[-], spec frontmatter
//     status: blocked, status-log line appended, INTERVIEW.md row added.
//   - Manager-restart PID-recovery: pre-seeded roster with a dead PID gets
//     a synthetic exit on next tick (crash_count incremented, last_exit_code
//     == "manager-restart-detected").
//
// Test uses fake-clock injection (`now: () => fakeDate`) per AC #5: avoids
// real backoff waits.

import { type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runManagerOnce } from "../src/lib/manage/loop.js";
import {
  readManagerState,
  writeManagerState,
} from "../src/lib/manage/state.js";

let tmpRoot: string;
let cacheDir: string;
let logDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "devx-mgr105-loop-"));
  cacheDir = join(tmpRoot, ".devx-cache");
  logDir = join(tmpRoot, "worker-logs");
  mkdirSync(cacheDir, { recursive: true });
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFixture({
  hash,
  status = "ready",
}: {
  hash: string;
  status?: "ready" | "in-progress" | "blocked";
}) {
  const checkbox =
    status === "ready" ? "[ ]" : status === "in-progress" ? "[/]" : "[-]";
  const devMd = `# DEV — Features to build

### Epic — Test fixture
- ${checkbox} \`dev/dev-${hash}-2026-05-07T11:00-fixture.md\` — fixture. Status: ${status}.
`;
  writeFileSync(join(tmpRoot, "DEV.md"), devMd, "utf8");
  // Spec file with the matching status frontmatter.
  mkdirSync(join(tmpRoot, "dev"), { recursive: true });
  const specPath = join(
    tmpRoot,
    "dev",
    `dev-${hash}-2026-05-07T11:00-fixture.md`,
  );
  writeFileSync(
    specPath,
    `---
hash: ${hash}
type: dev
status: ${status}
---

## Goal
fixture goal

## Status log
- 2026-05-07T11:00 — created
`,
    "utf8",
  );
  // Seed an INTERVIEW.md preamble so blocking-row append slots in cleanly.
  writeFileSync(
    join(tmpRoot, "INTERVIEW.md"),
    "# INTERVIEW — Questions for the user\n\n",
    "utf8",
  );
}

function writeStubClaude(exitCode: number, sleepMs = 30): string {
  const path = join(tmpRoot, `stub-claude-${exitCode}.sh`);
  writeFileSync(
    path,
    `#!/bin/sh\necho "stub claude exit ${exitCode}"\nsleep ${sleepMs / 1000}\nexit ${exitCode}\n`,
    "utf8",
  );
  chmodSync(path, 0o755);
  return path;
}

function awaitChildExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      // Drain microtasks so the on-exit handler that registered FIRST
      // (spawnWorker's internal one) has run.
      setImmediate(resolve);
      return;
    }
    child.on("exit", () => setImmediate(resolve));
  });
}

describe("runManagerOnce — mgr105 plain-crash respawn cycle", () => {
  it(
    "stub claude exits 42 5x → DEV.md flipped [/]→[-], spec blocked, INTERVIEW.md appended",
    async () => {
      writeFixture({ hash: "abc123" });
      const stub = writeStubClaude(42, 30);

      // Fake clock — advance manually to step past each backoff window.
      // Default backoff: [10, 30, 90, 300] seconds. We run 5 crashes:
      //   crash 1 → wait 10s; crash 2 → 30s; crash 3 → 90s; crash 4 → 300s;
      //   crash 5 → mark blocked.
      // Use one tick per crash; advance time between ticks so reconcile
      // releases the backoff guard.
      let fakeNow = new Date("2026-05-07T12:00:00.000Z");
      const advance = (sec: number) => {
        fakeNow = new Date(fakeNow.getTime() + sec * 1000);
      };

      for (let crash = 1; crash <= 4; crash++) {
        let childRef: ChildProcess | null = null;
        await runManagerOnce({
          cacheDir,
          cwd: tmpRoot,
          out: () => {},
          claudeBin: stub,
          workerLogDir: logDir,
          spawnDetached: false,
          now: () => fakeNow,
          onSpawn: (c) => {
            childRef = c;
          },
        });
        // Wait for stub to exit so its on-exit handler has written the crash.
        if (!childRef) throw new Error(`tick ${crash}: child not spawned`);
        await awaitChildExit(childRef!);
        // Verify crash record bookkeeping.
        const s = readManagerState(cacheDir);
        expect(s.crashes).toHaveLength(1);
        expect(s.crashes![0].spec_hash).toBe("abc123");
        expect(s.crashes![0].crash_count).toBe(crash);
        expect(s.crashes![0].last_exit_code).toBe(42);
        // Advance past the corresponding backoff window: 10, 30, 90, 300.
        const window = [10, 30, 90, 300][crash - 1];
        advance(window + 1);
      }

      // Tick 5 — reconcile sees crash_count=4 < 5, but the backoff for the
      // 5th crash hasn't fired yet (we advanced past 300s; that's enough
      // for crash_count=4 → backoff[3]=300s window to elapse, so the tick
      // spawns the 5th worker). The 5th crash brings count to 5; tick 6
      // emits desiredBlocking.
      let crash5Child: ChildProcess | null = null;
      await runManagerOnce({
        cacheDir,
        cwd: tmpRoot,
        out: () => {},
        claudeBin: stub,
        workerLogDir: logDir,
        spawnDetached: false,
        now: () => fakeNow,
        onSpawn: (c) => {
          crash5Child = c;
        },
      });
      if (!crash5Child) throw new Error("tick 5: 5th worker not spawned");
      await awaitChildExit(crash5Child!);

      // Check we now have crash_count=5.
      expect(readManagerState(cacheDir).crashes![0].crash_count).toBe(5);

      // Tick 6: with maxRestarts=5 (default), reconcile emits desiredBlocking.
      // Loop applies the file edits + clears crashes record.
      advance(301);
      await runManagerOnce({
        cacheDir,
        cwd: tmpRoot,
        out: () => {},
        claudeBin: stub,
        workerLogDir: logDir,
        spawnDetached: false,
        now: () => fakeNow,
        // No onSpawn — reconcile should NOT spawn this tick (block fires
        // first; spawn-eligibility filter rejects the maxed-out spec).
      });

      // DEV.md flipped [/]→[-] (or [ ]→[-] if claim never happened).
      const devMd = readFileSync(join(tmpRoot, "DEV.md"), "utf8");
      expect(devMd).toMatch(/\[-\]\s+`dev\/dev-abc123-/);

      // Spec frontmatter status: blocked.
      const specContent = readFileSync(
        join(tmpRoot, "dev", "dev-abc123-2026-05-07T11:00-fixture.md"),
        "utf8",
      );
      expect(specContent).toMatch(/^status: blocked$/m);
      // Status-log line per AC #3 — verbatim format.
      expect(specContent).toContain(
        "manager: max restarts exceeded (5x exit-42)",
      );

      // INTERVIEW.md appended with a Q-numbered row.
      const interview = readFileSync(join(tmpRoot, "INTERVIEW.md"), "utf8");
      expect(interview).toMatch(/Q#\d+ — Worker for abc123 hit max restarts \(5x exit-42\)/);
      expect(interview).toContain("Blocks: abc123");

      // Crashes record cleared.
      const finalState = readManagerState(cacheDir);
      expect(finalState.crashes).toBeUndefined();
    },
    30000,
  );

  it("respects the backoff window — a tick too soon after a crash emits no spawn", async () => {
    writeFixture({ hash: "wait01" });
    const stub = writeStubClaude(42, 30);

    let fakeNow = new Date("2026-05-07T12:00:00.000Z");

    // Tick 1: spawn + crash.
    let childRef: ChildProcess | null = null;
    await runManagerOnce({
      cacheDir,
      cwd: tmpRoot,
      out: () => {},
      claudeBin: stub,
      workerLogDir: logDir,
      spawnDetached: false,
      now: () => fakeNow,
      onSpawn: (c) => {
        childRef = c;
      },
    });
    if (!childRef) throw new Error("tick 1: child not spawned");
    await awaitChildExit(childRef!);
    expect(readManagerState(cacheDir).crashes![0].crash_count).toBe(1);

    // Advance only 5s — under the 10s backoff window.
    fakeNow = new Date(fakeNow.getTime() + 5_000);

    // Tick 2: reconcile should skip; no spawn.
    let secondSpawned = false;
    const result = await runManagerOnce({
      cacheDir,
      cwd: tmpRoot,
      out: () => {},
      claudeBin: stub,
      workerLogDir: logDir,
      spawnDetached: false,
      now: () => fakeNow,
      onSpawn: () => {
        secondSpawned = true;
      },
    });
    expect(secondSpawned).toBe(false);
    expect(result.outcome).toBe("no-work");
    // Crash count unchanged.
    expect(readManagerState(cacheDir).crashes![0].crash_count).toBe(1);
  }, 15000);

  it("manager-restart PID-recovery: dead PID gets a synthetic exit on next tick", async () => {
    writeFixture({ hash: "ghost1", status: "in-progress" });
    // Pre-seed manager.json with a roster entry whose PID is not alive.
    writeManagerState(cacheDir, {
      generation: 4,
      started_at: "2026-05-07T11:30:00.000Z",
      roster: [
        {
          pid: 999999, // very unlikely to be a live PID owned by this test
          spec_hash: "ghost1",
          started_at: "2026-05-07T11:30:00.000Z",
          crash_count: 0,
          worker_class: "dev",
        },
      ],
    });

    const fakeNow = new Date("2026-05-07T12:00:00.000Z");
    await runManagerOnce({
      cacheDir,
      cwd: tmpRoot,
      out: () => {},
      now: () => fakeNow,
      // Force the PID to be dead so the test isn't sensitive to actual
      // process state. (The default probe would report 999999 as ESRCH on
      // most kernels, but Node containers / CI workers occasionally have
      // higher PID limits.)
      pidAlive: () => false,
      disableSpawn: true,
    });

    const s = readManagerState(cacheDir);
    expect(s.roster).toEqual([]);
    expect(s.crashes).toHaveLength(1);
    expect(s.crashes![0]).toMatchObject({
      spec_hash: "ghost1",
      crash_count: 1,
      last_exit_code: "manager-restart-detected",
    });
  }, 10000);

  it("manager-restart PID-recovery: live PID is left alone", async () => {
    writeFixture({ hash: "alive1", status: "in-progress" });
    writeManagerState(cacheDir, {
      generation: 4,
      roster: [
        {
          pid: 12345,
          spec_hash: "alive1",
          started_at: "2026-05-07T11:30:00.000Z",
          crash_count: 0,
          worker_class: "dev",
        },
      ],
    });

    const fakeNow = new Date("2026-05-07T12:00:00.000Z");
    await runManagerOnce({
      cacheDir,
      cwd: tmpRoot,
      out: () => {},
      now: () => fakeNow,
      pidAlive: () => true,
      disableSpawn: true,
    });

    const s = readManagerState(cacheDir);
    expect(s.roster).toHaveLength(1);
    expect(s.crashes ?? []).toEqual([]);
  });

  it("idempotent: applying the same desiredBlocking twice doesn't double-write the spec", async () => {
    writeFixture({ hash: "twice1", status: "in-progress" });
    // Pre-seed crashes record at the threshold.
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [],
      crashes: [
        {
          spec_hash: "twice1",
          crash_count: 5,
          last_exit_at: "2026-05-07T11:00:00.000Z",
          last_exit_code: 42,
        },
      ],
    });

    const fakeNow1 = new Date("2026-05-07T12:00:00.000Z");
    await runManagerOnce({
      cacheDir,
      cwd: tmpRoot,
      out: () => {},
      now: () => fakeNow1,
      pidAlive: () => true,
      disableSpawn: true,
    });

    const specPath = join(
      tmpRoot,
      "dev",
      "dev-twice1-2026-05-07T11:00-fixture.md",
    );
    const after1 = readFileSync(specPath, "utf8");
    const matches1 = (
      after1.match(/manager: max restarts exceeded \(5x exit-42\)/g) ?? []
    ).length;
    expect(matches1).toBe(1);

    // Re-seed crashes (simulating a partial-failure on tick 1 where step 5
    // failed); applyBlocking should NOT add a duplicate status-log line.
    writeManagerState(cacheDir, {
      ...readManagerState(cacheDir),
      crashes: [
        {
          spec_hash: "twice1",
          crash_count: 5,
          last_exit_at: "2026-05-07T11:00:00.000Z",
          last_exit_code: 42,
        },
      ],
    });
    const fakeNow2 = new Date("2026-05-07T12:01:00.000Z");
    await runManagerOnce({
      cacheDir,
      cwd: tmpRoot,
      out: () => {},
      now: () => fakeNow2,
      pidAlive: () => true,
      disableSpawn: true,
    });
    const after2 = readFileSync(specPath, "utf8");
    const matches2 = (
      after2.match(/manager: max restarts exceeded \(5x exit-42\)/g) ?? []
    ).length;
    expect(matches2).toBe(1); // still exactly one — dedup'd.
  });
});
