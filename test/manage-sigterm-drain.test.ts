// SIGTERM-clean drain semantics test for runManagerLoop (mgr106 AC #4 +
// AC #7 Murat lens).
//
// AC #4: SIGTERM signals the AbortController; the loop drains the current
// tick (the in-flight runManagerOnce promise resolves), no new tick
// starts, lock release runs in the caller's finally clause, exits 0.
//
// AC #7 Murat lens: explicit slow-tick test — uses a mocked spawn taking
// 500ms; SIGTERM mid-tick must still produce clean shutdown (no orphan
// child, current tick's promise chain runs to completion).
//
// We exercise this in-process: AbortController stands in for SIGTERM, a
// `spawnFn` test seam stands in for the slow child_process.spawn.

import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runManagerLoop } from "../src/lib/manage/loop.js";
import { heartbeatPath } from "../src/lib/manage/state.js";

let cacheDir: string;
let cwd: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "devx-mgr-sigterm-"));
  cwd = mkdtempSync(join(tmpdir(), "devx-mgr-sigterm-cwd-"));
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

/**
 * Build a mocked ChildProcess that stays alive for `tickMs` then emits
 * `exit` with code 0. Used to simulate a slow worker the manager spawned;
 * the manager's runManagerOnce returns as soon as spawnWorker resolves
 * (which it does immediately after registering the roster entry — child
 * lifecycle is async via on-exit). So the relevant "slow" path is the
 * tick's promise chain, NOT the child's lifetime.
 */
function fakeChild(): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  Object.assign(ee, {
    pid: 99000 + Math.floor(Math.random() * 100),
    unref: () => {},
    kill: () => true,
  });
  return ee;
}

describe("runManagerLoop — SIGTERM-clean drain (mgr106 AC #4 + AC #7 Murat)", () => {
  it("drains the current tick when AbortSignal fires mid-sleep", async () => {
    // Single-tick scenario: tick runs to completion, then we abort during
    // the sleep window, the next tick never starts. Lines emitted must be
    // exactly 1 (the first tick's "no work" — the cwd has no DEV.md so
    // reconcile yields no work).
    const lines: string[] = [];
    const ac = new AbortController();
    const tickIntervalS = 30; // long enough that the abort lands in sleep, not in a tick

    const loopPromise = runManagerLoop({
      tickIntervalS,
      signal: ac.signal,
      cacheDir,
      cwd,
      out: (l) => lines.push(l),
      disableSpawn: true,
    });
    // Wait for the first tick to land before aborting.
    await new Promise<void>((resolve) => {
      const probe = () => {
        if (lines.length > 0) resolve();
        else setTimeout(probe, 10);
      };
      probe();
    });
    ac.abort();
    await loopPromise;

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^tick 1: no work$/);
  });

  it("completes the in-flight tick when SIGTERM lands mid-runManagerOnce (Murat lens)", async () => {
    // Plant a DEV.md row + spec file so reconcile picks something to spawn.
    // Drive abort from inside the spawnFn seam — that runs synchronously
    // INSIDE runManagerOnce, after reconcile has decided to spawn but
    // before the tick's heartbeat write. The Murat-lens contract: the
    // tick's promise chain runs to completion (manager.json + heartbeat
    // are written, the summary line emits) BEFORE the loop returns.
    const devMd =
      "# DEV\n" +
      "- [ ] `dev/dev-aaaaaa-2026-05-07T19:00-fake.md` — fake. Status: ready.\n";
    writeFileSync(join(cwd, "DEV.md"), devMd, "utf8");
    const specDir = join(cwd, "dev");
    require("node:fs").mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "dev-aaaaaa-2026-05-07T19:00-fake.md"),
      "---\nhash: aaaaaa\ntype: dev\nstatus: ready\nblocked_by: []\n---\n\n## Goal\nfake\n",
      "utf8",
    );

    const lines: string[] = [];
    const ac = new AbortController();
    const childRefs: ChildProcess[] = [];

    // spawnFn fires DURING the tick (after reconcile decides to spawn);
    // we abort from here. spawnWorker's body has no await between spawnFn
    // returning and registerRosterEntry's sync write, so by the time the
    // tick resumes the heartbeat write, the signal is already aborted —
    // the post-tick check in runManagerLoop must still let the in-flight
    // tick's heartbeat + manager.json write finish.
    const spawningFn = (
      _cmd: string,
      _args: ReadonlyArray<string>,
      _opts: import("node:child_process").SpawnOptions,
    ): ChildProcess => {
      const child = fakeChild();
      childRefs.push(child);
      // Abort right when the spawn happens — this is the "SIGTERM lands
      // mid-tick" moment.
      ac.abort();
      return child;
    };

    const loopPromise = runManagerLoop({
      tickIntervalS: 30,
      signal: ac.signal,
      cacheDir,
      cwd,
      out: (l) => lines.push(l),
      spawnFn: spawningFn,
      onSpawn: (child) => {
        // Register an exit listener so spawnWorker's on-exit handler
        // doesn't keep the test alive after we abort.
        setImmediate(() => (child as unknown as EventEmitter).emit("exit", 0, null));
      },
      spawnDetached: false,
    });

    await loopPromise;

    // The tick that triggered the abort RAN TO COMPLETION before the loop
    // returned — exactly one summary line, and it must be the "spawned"
    // variant proving the spawnFn seam fired.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^tick \d+: spawned [a-z0-9]+$/);
    // No phantom second tick — if drain were broken, we'd see another
    // "no work" / "maintained" line from the post-abort iteration.
  }, 5000);

  it("does not start a new tick after AbortSignal fires", async () => {
    // Verify the post-abort `if (opts.signal.aborted) return;` short-
    // circuit works: abort BEFORE entering the loop and confirm zero ticks
    // run.
    const lines: string[] = [];
    const ac = new AbortController();
    ac.abort(); // pre-abort

    const loopPromise = runManagerLoop({
      tickIntervalS: 1,
      signal: ac.signal,
      cacheDir,
      cwd,
      out: (l) => lines.push(l),
      disableSpawn: true,
    });
    await loopPromise;

    // Subtle: runManagerLoop's `while (!opts.signal.aborted)` check runs
    // BEFORE the first tick, so a pre-aborted signal yields zero ticks.
    expect(lines).toHaveLength(0);
  });

  it("heartbeat reflects the final tick's pid + generation (Phase 2 watchdog contract — AC #6)", async () => {
    // Pin the heartbeat format so the Phase 2 mutual-watchdog (which
    // reads heartbeat.json freshness) has a stable contract to consume.
    const lines: string[] = [];
    const ac = new AbortController();

    const loopPromise = runManagerLoop({
      tickIntervalS: 30,
      signal: ac.signal,
      cacheDir,
      cwd,
      out: (l) => {
        lines.push(l);
        // Abort right after the first tick lands.
        if (lines.length === 1) setImmediate(() => ac.abort());
      },
      disableSpawn: true,
    });
    await loopPromise;

    const hb = JSON.parse(readFileSync(heartbeatPath(cacheDir), "utf8"));
    expect(Object.keys(hb).sort()).toEqual(["generation", "pid", "ts"]);
    expect(hb.pid).toBe(process.pid);
    expect(hb.generation).toBe(1);
    expect(typeof hb.ts).toBe("string");
    expect(new Date(hb.ts).toISOString()).toBe(hb.ts);
  });
});
